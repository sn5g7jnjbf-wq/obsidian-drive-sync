import {hash,validatePaths, type State,type LocalPort,type DrivePort,type Remote} from './model';

export class Engine {
  running=false; stopped=false;
  excluded: string[]=[]; held: string[]=[];
  localPaths:string[]=[]; remotePaths:string[]=[];
  uploaded=0; downloaded=0;
  constructor(readonly local:LocalPort,readonly drive:DrivePort,readonly state:State,readonly save:()=>Promise<void>) {
    // Vault filenames can be '__proto__' or 'constructor'; never use inherited record keys.
    state.base=Object.assign(Object.create(null),state.base);
    state.conflicts=Object.assign(Object.create(null),state.conflicts);
  }
  async run(limit:number):Promise<boolean> {
    if(this.running||this.stopped) return false;
    if(!Number.isFinite(limit)||limit<=0)throw new Error('容量上限の設定が不正です。');
    this.running=true;
    try {
      this.excluded=[]; this.held=[];
      this.localPaths=[];this.remotePaths=[];this.uploaded=0;this.downloaded=0;
      const locals=await this.local.list(), remotes=await this.drive.list();
      this.localPaths=locals.map(x=>x.path);this.remotePaths=remotes.map(x=>x.path);
      validatePaths(locals.map(x=>x.path)); validatePaths(remotes.map(x=>x.path));
      validatePaths([...new Set([...locals.map(x=>x.path),...remotes.map(x=>x.path)])]);
      const lm=new Map(locals.map(x=>[x.path,x])), rm=new Map(remotes.map(x=>[x.path,x]));
      for(const path of new Set([...lm.keys(),...rm.keys(),...Object.keys(this.state.base)])) {
        if(this.stopped) return false;
        const l=lm.get(path), r=rm.get(path), b=this.state.base[path];
        if((l&&l.size>=limit)||(r&&r.size>=limit)) {this.excluded.push(path);continue;}
        // A missing tracked side is a deletion/move, never a request to recreate or delete.
        if(b&&(!l||!r)) {this.held.push(path+'（片側で削除・移動）');continue;}
        const data=l?await this.local.read(path):undefined;
        if(l&&!data) {this.held.push(path);continue;}
        if(data&&data.byteLength>=limit) {this.excluded.push(path);continue;}
        const lh=data?await hash(data):undefined;
        if(data&&r) {
          if(b&&b.remoteId===r.id&&b.hash===lh&&b.version===r.version) continue;
          // Fetch a stable remote snapshot. Changes during the download abort the run.
          const rd=await this.drive.read(r), latest=await this.drive.fresh(r);
          if(latest.version!==r.version) throw new Error('Driveで同期中の編集を検出しました。再試行してください。');
          if(rd.byteLength>=limit) {this.excluded.push(path);continue;}
          const rh=await hash(rd);
          if(lh===rh) {await this.commit(path,lh!,latest); continue;}
          if(b&&b.remoteId===r.id&&b.version===r.version&&lh!==b.hash) {
            await this.intent(path,'upload',r.id);
            await this.local.archive(path,rd,'history');
            const updated=await this.drive.put(path,data,r.id,latest);
            this.uploaded++;
            await this.commit(path,lh!,updated);
          } else if(b&&b.remoteId===r.id&&lh===b.hash&&path.toLowerCase().endsWith('.md')) {
            await this.intent(path,'download',r.id);
            await this.local.archive(path,data,'history');
            if(await this.local.replace(path,rd,lh!)) {this.downloaded++;await this.commit(path,rh,latest);}
            else this.held.push(path+'（同期中に編集）');
          } else {
            const old=this.state.conflicts[path];
            if(old?.localHash===lh&&old.version===r.version) continue;
            await this.intent(path,'conflict',r.id);
            const copy=await this.local.archive(path,rd,'conflicts');
            this.state.conflicts[path]={path,copy,localHash:lh!,version:r.version,at:Date.now()};
            this.record(path,'競合コピー作成'); delete this.state.journal; await this.save();
          }
        } else if(data) {
          // Reuse a persisted ID after ambiguous network failure. Drive create cannot duplicate this ID.
          const pending=this.state.journal;
          const id=pending?.path===path&&pending.kind==='create'&&pending.id?pending.id:await this.drive.generateId();
          await this.intent(path,'create',id);
          const uploaded=await this.drive.put(path,data,id);
          this.uploaded++;
          await this.commit(path,lh!,uploaded);
        } else if(r) {
          const rd=await this.drive.read(r), latest=await this.drive.fresh(r);
          if(latest.version!==r.version) throw new Error('Driveで同期中の編集を検出しました。');
          if(rd.byteLength>=limit) {this.excluded.push(path);continue;}
          await this.intent(path,'create-local',r.id);
          await this.local.create(path,rd);
          this.downloaded++;
          await this.commit(path,await hash(rd),latest);
        }
      }
      this.state.last=Date.now(); await this.save(); return true;
    } finally {this.running=false;}
  }
  private async intent(path:string,kind:string,id?:string) {
    this.state.journal={path,kind,id,at:Date.now()}; await this.save();
  }
  private record(path:string,action:string) {this.state.history.push({path,action,at:Date.now()});this.state.history=this.state.history.slice(-1000);}
  private async commit(path:string,h:string,r:Remote) {
    this.state.base[path]={hash:h,remoteId:r.id,version:r.version}; delete this.state.conflicts[path];
    delete this.state.journal; this.record(path,'基準更新');await this.save();
  }
}
