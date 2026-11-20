import {hash,random,safePath,validatePaths,type State,type LocalPort,type DrivePort,type Remote,type Choice} from './model';

/** Drive identity, rather than equal names or bytes, is the authority for remote moves. */
export class Moves {
  constructor(private local:LocalPort,private drive:DrivePort,private state:State,private save:()=>Promise<void>){
    state.moves=Object.assign(Object.create(null),state.moves);
  }
  private async migrate(from:string,to:string){
    this.state.base[to]=this.state.base[from];delete this.state.base[from];delete this.state.conflicts[from];
    delete this.state.moves![from];delete this.state.journal;await this.save();
  }
  async scan(remotes:Remote[],limit:number):Promise<Set<string>>{
    const blocked=new Set<string>(),byId=new Map(remotes.map(r=>[r.id,r]));
    const pending=this.state.journal;
    if(pending?.kind==='move-local'){
      const from=pending.path,to=pending.to!,b=this.state.base[from],r=byId.get(pending.id!);
      if(!b||!r||r.path!==to)throw Error('中断した移動の確認が必要です。履歴と移動元・移動先を確認してください。');
      const source=await this.local.read(from),target=await this.local.read(to);
      if(!source&&target&&await hash(target)===pending.hash)await this.migrate(from,to);
      else if(source&&!target&&await hash(source)===pending.hash){
        if(!await this.local.move(from,to,pending.hash!))throw Error('中断した移動を再開できません。');
        await this.migrate(from,to);
      }else throw Error('中断した移動のファイルが変更されています。上書きせず停止しました。');
    }
    for(const [from,b] of Object.entries(this.state.base)){
      const r=byId.get(b.remoteId);
      if(!r||r.path===from){delete this.state.moves![from];continue;}
      const to=r.path;blocked.add(from);blocked.add(to);
      const source=await this.local.read(from),target=await this.local.read(to);
      if(this.state.base[to]&&this.state.base[to].remoteId!==r.id)continue;
      if(!source)continue;
      if(source.byteLength>=limit||r.size>=limit||(target&&target.byteLength>=limit))continue;
      const sourceHash=await hash(source);
      if(target){
        this.state.moves![from]={from,to,remoteId:r.id,version:r.version,sourceHash,targetHash:await hash(target)};
        continue;
      }
      const latest=await this.drive.fresh(r);
      if(latest.version!==r.version)throw Error('Driveで移動中の編集を検出しました。再同期してください。');
      this.state.journal={path:from,to,kind:'move-local',id:r.id,hash:sourceHash,at:Date.now()};await this.save();
      if(!await this.local.move(from,to,sourceHash))throw Error('移動中に端末のファイルが変わりました。再同期してください。');
      await this.migrate(from,to);blocked.delete(from);blocked.delete(to);
    }
    await this.save();return blocked;
  }
  async unique(path:string,occupied:Set<string>,label='端末コピー'):Promise<string>{
    const dot=path.lastIndexOf('.'),slash=path.lastIndexOf('/');
    const stem=dot>slash?path.slice(0,dot):path,ext=dot>slash?path.slice(dot):'';
    for(let n=1;n<10000;n++){
      const candidate=`${stem} (${label} ${n})${ext}`;
      if(!occupied.has(candidate)&&!await this.local.read(candidate)){validatePaths([candidate]);occupied.add(candidate);return candidate;}
    }
    throw Error('コピー先の名前を決められません。');
  }
  async choose(from:string,choice:Choice,limit:number){
    const conflict=this.state.moves?.[from];if(!conflict)throw Error('移動の競合がありません。再同期してください。');
    const remotes=await this.drive.list();validatePaths(remotes.map(r=>r.path));
    const r=remotes.find(r=>r.id===conflict.remoteId&&r.path===conflict.to);
    const source=await this.local.read(from),target=await this.local.read(conflict.to);
    if(!r||r.version!==conflict.version||!source||!target||await hash(source)!==conflict.sourceHash||await hash(target)!==conflict.targetHash)throw Error('選択後にファイルが変わりました。再同期して選び直してください。');
    const rd=await this.drive.read(r),latest=await this.drive.fresh(r);
    if(latest.version!==r.version)throw Error('Driveの内容が変わりました。再同期してください。');
    if([source,target,rd].some(d=>d.byteLength>=limit))throw Error('容量上限以上のため選択を適用できません。');
    const occupied=new Set([...(await this.local.list()).map(f=>f.path),...remotes.map(f=>f.path)]);
    // Preserve every displaced local file by renaming, never deleting or overwriting it.
    const folder=`AI Drive Sync/history/${Date.now()}-${random().slice(0,10)}`;
    const actions:{from:string;to:string;hash:string}[]=[];
    if(choice!=='local')actions.push({from:conflict.to,to:choice==='both'?await this.unique(conflict.to,occupied):`${folder}/target/${conflict.to}`,hash:conflict.targetHash});
    actions.push({from,to:choice==='both'?await this.unique(from,occupied,'移動前の端末コピー'):`${folder}/source/${from}`,hash:conflict.sourceHash});
    // Save a resumable plan before the first local mutation.
    this.state.resolution={from,to:conflict.to,remoteId:r.id,version:r.version,remoteHash:await hash(rd),resultHash:choice==='local'?conflict.targetHash:await hash(rd),choice,actions};await this.save();
    await this.resume(limit);
  }
  async resume(limit:number){
    const plan=this.state.resolution;if(!plan)return;
    if(!safePath(plan.from)||!safePath(plan.to)||!Array.isArray(plan.actions)||!['both','remote','local'].includes(plan.choice)
      ||plan.actions.some(a=>!safePath(a.from)||!(a.to.startsWith('AI Drive Sync/history/')?safePath(a.to.slice('AI Drive Sync/history/'.length)):safePath(a.to))))throw Error('中断した選択処理のパスが不正です。処理を停止しました。');
    const remotes=await this.drive.list(),r=remotes.find(f=>f.id===plan.remoteId&&f.path===plan.to);
    if(!r)throw Error('選択処理中にDriveのファイルが移動しました。履歴を確認してください。');
    const rd=await this.drive.read(r),latest=await this.drive.fresh(r),rh=await hash(rd);
    if(latest.version!==r.version||rd.byteLength>=limit)throw Error('選択処理を安全に再開できません。Driveの変更・容量を確認してください。');
    if(rh!==plan.remoteHash&&!(plan.choice==='local'&&rh===plan.resultHash))throw Error('選択処理中にDrive本文が変わりました。上書きせず停止しました。保存済みのコピーは履歴に残っています。');
    let result=latest;
    if(plan.choice==='local'){
      const data=await this.local.read(plan.to);
      if(!data||data.byteLength>=limit||await hash(data)!==plan.resultHash)throw Error('選択した端末ファイルが変わりました。上書きせず停止しました。');
      if(rh!==plan.resultHash){await this.local.archive(plan.to,rd,'history');result=await this.drive.put(plan.to,data,r.id,latest);}
    }
    for(const a of plan.actions){
      const source=await this.local.read(a.from),target=await this.local.read(a.to);
      if(!source&&target&&await hash(target)===a.hash)continue;
      if(!source||target||await hash(source)!==a.hash||!await this.local.move(a.from,a.to,a.hash))throw Error('選択処理中の端末変更を検出しました。保存済みのコピーを残して停止しました。');
    }
    const current=await this.local.read(plan.to);
    if(!current)await this.local.create(plan.to,rd);
    else if(await hash(current)!==plan.resultHash)throw Error('移動先が変更されました。上書きせず停止しました。');
    this.state.base[plan.to]={remoteId:r.id,version:result.version,hash:plan.resultHash};
    if(plan.from!==plan.to)delete this.state.base[plan.from];
    delete this.state.moves![plan.from];delete this.state.conflicts[plan.from];delete this.state.conflicts[plan.to];
    delete this.state.resolution;delete this.state.journal;await this.save();
  }
  async chooseContent(path:string,choice:Choice,limit:number){
    const c=this.state.conflicts[path];if(!c?.remoteId)throw Error('再同期してから競合を選択してください。');
    const remotes=await this.drive.list();validatePaths(remotes.map(r=>r.path));
    const r=remotes.find(f=>f.path===path&&f.id===c.remoteId),data=await this.local.read(path);
    if(!r||r.version!==c.version||!data||await hash(data)!==c.localHash)throw Error('ファイルが変わりました。再同期して選び直してください。');
    const rd=await this.drive.read(r),latest=await this.drive.fresh(r),rh=await hash(rd);
    if(latest.version!==r.version||data.byteLength>=limit||rd.byteLength>=limit)throw Error('Driveの変更または容量上限を検出しました。再同期してください。');
    const occupied=new Set([...(await this.local.list()).map(f=>f.path),...remotes.map(f=>f.path)]);
    const actions=choice==='local'?[]:[{from:path,to:choice==='both'?await this.unique(path,occupied):`AI Drive Sync/history/${Date.now()}-${random().slice(0,10)}/${path}`,hash:c.localHash}];
    this.state.resolution={from:path,to:path,remoteId:r.id,version:r.version,remoteHash:rh,resultHash:choice==='local'?c.localHash:rh,choice,actions};await this.save();await this.resume(limit);
  }
}
