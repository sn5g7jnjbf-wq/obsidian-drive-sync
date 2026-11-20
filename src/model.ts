export interface Settings {
  root: string; auto: boolean; minutes: number; startup: boolean;
  delay: number; maxMB: number; backupConfirmed: boolean; secretId: string;
}
export const defaults: Settings = {root:'',auto:false,minutes:1,startup:false,delay:1,maxMB:1,backupConfirmed:false,secretId:''};
export function loadSettings(value:unknown):Settings {
  const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
  const s={...defaults};
  for(const k of ['auto','startup','backupConfirmed'] as const)if(typeof v[k]==='boolean')s[k]=v[k];
  for(const [k,min,max,integer] of [['minutes',1,10080,true],['delay',0,3600,true],['maxMB',0.01,100,false]] as const){
    const n=v[k];if(typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isInteger(n)))s[k]=n;
  }
  if(typeof v.root==='string'&&v.root.length<=256)s.root=v.root.trim();
  if(typeof v.secretId==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.secretId))s.secretId=v.secretId;
  return s;
}
export interface Base { hash: string; remoteId: string; version: string }
export interface Journal { path: string; kind: string; id?: string; at: number; to?:string; hash?:string }
export type Choice='both'|'remote'|'local';
export interface MoveConflict {from:string;to:string;remoteId:string;version:string;sourceHash:string;targetHash:string}
export interface DuplicateGroup {path:string;parentId:string;files:Remote[]}
export interface Conflict {path: string; copy: string; localHash: string; version: string; at: number;remoteId?:string}
export interface State {
  root: string; base: Record<string,Base>; journal?: Journal;
  conflicts: Record<string,Conflict>; history: {path:string; action:string; at:number}[]; last?:number;
  moves?:Record<string,MoveConflict>;
  duplicates?:DuplicateGroup[];
  resolution?:{from:string;to:string;remoteId:string;version:string;remoteHash:string;resultHash:string;choice:Choice;actions:{from:string;to:string;hash:string}[]};
}
export const emptyState = (root=''): State => ({root,base:Object.create(null),conflicts:Object.create(null),history:[]});
export interface Remote {path:string; id:string; version:string; size:number; etag?:string; parentId?:string}
export interface LocalPort {
  list(): Promise<{path:string;size:number}[]>;
  read(path:string): Promise<ArrayBuffer | undefined>;
  create(path:string,data:ArrayBuffer): Promise<void>;
  move(from:string,to:string,expectedHash:string):Promise<boolean>;
  replace(path:string,data:ArrayBuffer,expectedHash:string): Promise<boolean>;
  archive(path:string,data:ArrayBuffer,category:'history'|'conflicts'): Promise<string>;
}
export interface DrivePort {
  list(): Promise<Remote[]>;
  read(file:Remote): Promise<ArrayBuffer>;
  fresh(file:Remote): Promise<Remote>;
  generateId(): Promise<string>;
  put(path:string,data:ArrayBuffer,id:string,existing?:Remote): Promise<Remote>;
}
export async function hash(data:ArrayBuffer):Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)), b=>b.toString(16).padStart(2,'0')).join('');
}
export function random():string {return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
export function safePath(path:string):boolean {
  return path.length>0 && path.length<=220 && path.split('/').every(p=>
    !!p && !p.startsWith('.') && p!=='AI Drive Sync' && !/[\\<>:"|?*\u0000-\u001f]/.test(p)
    && !/[. ]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
export function validatePaths(paths:string[]):void {
  const seen = new Set<string>();
  for(const p of paths) {
    if(!safePath(p)) throw new Error('互換性のないパスを検出しました。名前を確認してください。');
    const key=p.normalize('NFC').toLowerCase();
    if(seen.has(key)) throw new Error('同名または大小文字・Unicodeの衝突があります。同期を停止しました。');
    seen.add(key);
  }
  for(const p of paths) {const parts=p.split('/'); parts.pop(); while(parts.length) {
    if(seen.has(parts.join('/').normalize('NFC').toLowerCase())) throw new Error('ファイルとフォルダの衝突があります。'); parts.pop();
  }}
}
