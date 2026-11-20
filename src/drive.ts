import {type RequestUrlParam} from 'obsidian';
import {Auth} from './auth';
import {http,HttpError} from './http';
import {safePath,type DrivePort,type Remote,type DuplicateGroup} from './model';
const API='https://www.googleapis.com/drive/v3/files';
const FOLDER='application/vnd.google-apps.folder';
interface FileMeta {id:string;name:string;mimeType:string;version:string;size?:string;trashed?:boolean;modifiedTime?:string}
const fields='id,name,mimeType,version,size,trashed,parents,modifiedTime';
const escape=(s:string)=>s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
export class DuplicateFilesError extends Error {
  constructor(readonly groups:DuplicateGroup[]){super('Driveに同名ファイルがあります。設定画面で元の名前を使うファイルを選んでください。他のファイルは別名で残します。');}
}
export class Drive implements DrivePort {
  private folders=new Map<string,string>();
  constructor(readonly auth:Auth,readonly root:string) {this.folders.set('',root);}
  async request(req:RequestUrlParam,retry=true) {
    for(let n=0;;n++) {
      try {return await http({...req,headers:{...req.headers,Authorization:'Bearer '+await this.auth.token()}},retry);}
      catch(e) {if(e instanceof HttpError&&e.status===401&&n===0) {this.auth.invalidate();continue;}throw e;}
    }
  }
  async children(parent:string):Promise<FileMeta[]> {
    const result:FileMeta[]=[];let page='';
    do {
      const q=new URLSearchParams({q:`'${escape(parent)}' in parents and trashed = false`,fields:`nextPageToken,files(${fields})`,pageSize:'1000'});
      if(page) q.set('pageToken',page);
      const r=await this.request({url:API+'?'+q});result.push(...r.json.files);page=r.json.nextPageToken??'';
    }while(page);return result;
  }
  async roots():Promise<{id:string;name:string}[]> {
    const result:FileMeta[]=[];let page='';
    do {const q=new URLSearchParams({q:`mimeType = '${FOLDER}' and trashed = false and 'me' in owners`,fields:'nextPageToken,files(id,name)',pageSize:'1000'});if(page)q.set('pageToken',page);
      const r=await this.request({url:API+'?'+q});result.push(...r.json.files);page=r.json.nextPageToken??'';
    }while(page);return result;
  }
  async createRoot(name:string):Promise<string> {
    const r=await this.request({url:API,method:'POST',contentType:'application/json',body:JSON.stringify({name,mimeType:FOLDER})},false);return r.json.id;
  }
  async list():Promise<Remote[]> {
    const root=await this.request({url:API+'/'+encodeURIComponent(this.root)+'?fields=mimeType,trashed'});
    if(root.json.mimeType!==FOLDER||root.json.trashed) throw new Error('同期先が有効な通常フォルダではありません。');
    const result:Remote[]=[];this.folders=new Map([['',this.root]]);const visited=new Set<string>();
    const walk=async(id:string,prefix:string)=>{
      if(visited.has(id)) throw new Error('Driveフォルダの循環を検出しました。');visited.add(id);
      const siblings=await this.children(id), names=new Set<string>();
      const grouped=new Map<string,FileMeta[]>();
      for(const f of siblings){if(f.name.startsWith('.')||f.name==='AI Drive Sync')continue;const key=f.name.normalize('NFC').toLowerCase();grouped.set(key,[...(grouped.get(key)??[]),f]);}
      const duplicateGroups:DuplicateGroup[]=[];
      for(const group of grouped.values())if(group.length>1){
        if(group.some(f=>f.mimeType.startsWith('application/vnd.google-apps.')))throw Error('Driveに同名フォルダ・Google形式の重複があります。通常ファイル以外はDrive側で名前を整理してください。');
        const files=group.map(f=>({path:prefix+f.name,id:f.id,version:f.version,size:Number(f.size),parentId:id,modifiedTime:f.modifiedTime}));
        if(files.some(f=>!safePath(f.path)||!Number.isFinite(f.size)||f.size<0))throw Error('重複ファイルの名前・容量を確認できません。');
        duplicateGroups.push({path:files[0].path,parentId:id,files});
      }
      if(duplicateGroups.length)throw new DuplicateFilesError(duplicateGroups);
      for(const f of siblings) {
        if(f.name.startsWith('.')||f.name==='AI Drive Sync') continue;
        const path=prefix+f.name;
        if(!safePath(path)) throw new Error('Driveに互換性のないファイル名があります。');
        const key=f.name.normalize('NFC').toLowerCase();if(names.has(key)) throw new Error('Driveに重複名があります。同期を停止しました。');names.add(key);
        if(f.mimeType===FOLDER) {this.folders.set(path,f.id);await walk(f.id,path+'/');}
        else if(f.mimeType.startsWith('application/vnd.google-apps.')) throw new Error('Google Docs形式・ショートカットは専用同期フォルダから移動してください。');
        else {const size=Number(f.size);if(!Number.isFinite(size)||size<0) throw new Error('Driveファイル容量を確認できません。');result.push({path,id:f.id,version:f.version,size,parentId:id,modifiedTime:f.modifiedTime});}
      }
    };await walk(this.root,'');return result;
  }
  async fresh(file:Remote):Promise<Remote> {
    const r=await this.request({url:API+'/'+encodeURIComponent(file.id)+'?fields='+fields});
    if(r.json.trashed) throw new Error('Driveファイルが削除されました。');
    if(r.json.name!==file.path.split('/').pop()||(file.parentId&&!r.json.parents?.includes(file.parentId)))throw new Error('Driveで同期中の移動・名前変更を検出しました。再同期してください。');
    return {...file,version:r.json.version,size:Number(r.json.size),etag:r.headers.etag??r.headers.ETag};
  }
  async read(file:Remote):Promise<ArrayBuffer> {return (await this.request({url:API+'/'+encodeURIComponent(file.id)+'?alt=media'})).arrayBuffer;}
  async generateId():Promise<string> {return (await this.request({url:API+'/generateIds?count=1&space=drive&type=files'})).json.ids[0];}
  async resolveDuplicate(group:DuplicateGroup,preferredId:string){
    const preferred=group.files.find(f=>f.id===preferredId);if(!preferred)throw Error('選択したファイルがありません。');
    const siblings=await this.children(group.parentId),key=preferred.path.split('/').pop()!.normalize('NFC').toLowerCase();
    const current=siblings.filter(f=>f.name.normalize('NFC').toLowerCase()===key);
    if(current.length!==group.files.length||current.some(f=>!group.files.some(old=>old.id===f.id&&old.version===f.version)))throw Error('重複ファイルが変更されました。再同期して選び直してください。');
    const names=new Set(siblings.map(f=>f.name.normalize('NFC').toLowerCase()));
    for(const file of group.files){
      if(file.id===preferredId)continue;
      const latest=await this.fresh(file);if(latest.version!==file.version||!latest.etag)throw Error('変更検出用の情報を確認できないため、Driveの名前変更を停止しました。再同期してください。');
      const old=file.path.split('/').pop()!,dot=old.lastIndexOf('.'),stem=dot>0?old.slice(0,dot):old,ext=dot>0?old.slice(dot):'';
      let name='',n=0;do{name=`${stem.slice(0,100)} (Driveコピー ${++n}-${file.id.slice(-6)})${ext}`;}while(names.has(name.normalize('NFC').toLowerCase()));
      if(!safePath(file.path.slice(0,file.path.lastIndexOf('/')+1)+name))throw Error('別名が長すぎます。Drive側で短い名前に変更してください。');
      names.add(name.normalize('NFC').toLowerCase());
      await this.request({url:API+'/'+encodeURIComponent(file.id)+'?fields='+fields,method:'PATCH',contentType:'application/json',headers:{'If-Match':latest.etag},body:JSON.stringify({name})},false);
    }
  }
  private async parent(path:string):Promise<string> {
    const parts=path.split('/');parts.pop();let prefix='',id=this.root;
    for(const part of parts) {
      prefix=prefix?prefix+'/'+part:part;
      const cached=this.folders.get(prefix);if(cached) {id=cached;continue;}
      // Re-list before creating: do not create a duplicate following an ambiguous prior request.
      const matches=(await this.children(id)).filter(f=>f.name===part);
      if(matches.length>1||(matches.length===1&&matches[0].mimeType!==FOLDER)) throw new Error('フォルダ名が衝突しました。');
      if(matches[0]) id=matches[0].id;
      else id=(await this.request({url:API,method:'POST',contentType:'application/json',body:JSON.stringify({name:part,mimeType:FOLDER,parents:[id]})},false)).json.id;
      this.folders.set(prefix,id);
    }return id;
  }
  async put(path:string,data:ArrayBuffer,id:string,existing?:Remote):Promise<Remote> {
    const headers:Record<string,string>={};
    if(existing) {if(!existing.etag) throw new Error('DriveのETagが得られないため安全に上書きできません。');headers['If-Match']=existing.etag;}
    if(existing) {
      // One conditional content request, avoiding a gap between resumable initiation and commit.
      const r=await this.request({url:'https://www.googleapis.com/upload/drive/v3/files/'+encodeURIComponent(id)+'?uploadType=media&fields='+fields,method:'PATCH',contentType:path.toLowerCase().endsWith('.md')?'text/markdown':'application/octet-stream',headers,body:data},false);
      return {path,id:r.json.id,version:r.json.version,size:Number(r.json.size??data.byteLength)};
    }
    const metadata={id,name:path.split('/').pop(),parents:[await this.parent(path)]};
    const mime=path.toLowerCase().endsWith('.md')?'text/markdown':'application/octet-stream';
    headers['X-Upload-Content-Type']=mime;headers['X-Upload-Content-Length']=String(data.byteLength);
    // Never automatically retry a mutation: the next full scan resolves an ambiguous result.
    const start=await this.request({url:'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields='+fields,method:'POST',contentType:'application/json',headers,body:JSON.stringify(metadata)},false);
    const location=start.headers.location??start.headers.Location;
    if(!location||new URL(location).origin!=='https://www.googleapis.com') throw new Error('アップロード先が不正です。');
    const r=await this.request({url:location,method:'PUT',contentType:mime,body:data},false);
    return {path,id:r.json.id,version:r.json.version,size:Number(r.json.size??data.byteLength)};
  }
}
