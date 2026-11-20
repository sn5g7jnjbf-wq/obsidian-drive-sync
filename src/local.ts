import {type App,TFile} from 'obsidian';
import {hash,random,type LocalPort} from './model';
export class Local implements LocalPort {
  constructor(readonly app:App) {}
  async list() {return this.app.vault.getFiles().filter(f=>!f.path.split('/').some(p=>p.startsWith('.')||p==='AI Drive Sync')).map(f=>({path:f.path,size:f.stat.size}));}
  modifiedTime(path:string) {
    const file=this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile?file.stat.mtime:undefined;
  }
  async read(path:string) {const f=this.app.vault.getAbstractFileByPath(path);return f instanceof TFile?this.app.vault.readBinary(f):undefined;}
  private async parents(path:string) {
    const parts=path.split('/');parts.pop();let p='';
    for(const part of parts) {p=p?p+'/'+part:part;if(!this.app.vault.getAbstractFileByPath(p)) await this.app.vault.createFolder(p);}
  }
  async create(path:string,data:ArrayBuffer) {await this.parents(path);await this.app.vault.createBinary(path,data);}
  async move(from:string,to:string,expectedHash:string) {
    await this.parents(to);
    const f=this.app.vault.getAbstractFileByPath(from);
    if(!(f instanceof TFile)||this.app.vault.getAbstractFileByPath(to))return false;
    if(await hash(await this.app.vault.readBinary(f))!==expectedHash)return false;
    // Do not rewrite links in unrelated files while the sync snapshot is being applied.
    await this.app.vault.rename(f,to);return true;
  }
  async replace(path:string,data:ArrayBuffer,expectedHash:string) {
    const f=this.app.vault.getAbstractFileByPath(path);
    if(!(f instanceof TFile)||!path.toLowerCase().endsWith('.md')) return false;
    const original=await this.app.vault.read(f);
    if(await hash(new TextEncoder().encode(original).buffer)!==expectedHash) return false;
    // Reject invalid UTF-8 rather than corrupting a binary file disguised as Markdown.
    const next=new TextDecoder('utf-8',{fatal:true}).decode(data);
    let changed=false;
    await this.app.vault.process(f,current=>{if(current!==original) return current;changed=true;return next;});
    return changed;
  }
  async archive(path:string,data:ArrayBuffer,category:'history'|'conflicts') {
    const dest=`AI Drive Sync/${category}/${new Date().toISOString().replace(/[:.]/g,'-')}-${random().slice(0,10)}/${path}`;
    await this.create(dest,data);return dest;
  }
}
