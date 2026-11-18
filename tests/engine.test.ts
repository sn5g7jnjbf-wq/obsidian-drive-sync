import {test} from 'node:test';import assert from 'node:assert/strict';
import {Engine} from '../src/engine';import {emptyState,hash,validatePaths,loadSettings,type LocalPort,type DrivePort,type Remote} from '../src/model';
const bytes=(s:string)=>new TextEncoder().encode(s).buffer;
const text=(b:ArrayBuffer)=>new TextDecoder().decode(b);
class Local implements LocalPort {
  files=new Map<string,ArrayBuffer>();archives:{path:string;data:ArrayBuffer;kind:string}[]=[];reject=false;
  async list(){return [...this.files].map(([path,d])=>({path,size:d.byteLength}));}
  async read(p:string){return this.files.get(p);}
  async create(p:string,d:ArrayBuffer){if(this.files.has(p))throw Error('exists');this.files.set(p,d);}
  async replace(p:string,d:ArrayBuffer,h:string){if(this.reject||!this.files.has(p)||await hash(this.files.get(p)!)!==h)return false;this.files.set(p,d);return true;}
  async archive(p:string,d:ArrayBuffer,kind:'history'|'conflicts'){this.archives.push({path:p,data:d,kind});return 'AI Drive Sync/'+kind+'/'+this.archives.length+'/'+p;}
}
class Drive implements DrivePort {
  files=new Map<string,{meta:Remote;data:ArrayBuffer}>();puts=0;reads=0;ids=0;failAfter=false;stale=false;failBefore=false;
  add(p:string,s:string,id='r'+this.files.size){this.files.set(p,{meta:{path:p,id,version:'1',size:bytes(s).byteLength,etag:'e1'},data:bytes(s)});}
  edit(p:string,s:string){const f=this.files.get(p)!;f.data=bytes(s);f.meta={...f.meta,version:String(Number(f.meta.version)+1),size:f.data.byteLength};}
  async list(){return [...this.files.values()].map(x=>({...x.meta}));}
  async fresh(r:Remote){const m={...this.files.get(r.path)!.meta};if(this.stale)m.version+='x';return m;}
  async read(r:Remote){this.reads++;return this.files.get(r.path)!.data;}
  async generateId(){return 'new'+(++this.ids);}
  async put(p:string,d:ArrayBuffer,id:string,existing?:Remote){this.puts++;if(this.failBefore)throw Error('offline');if(!existing&&[...this.files.values()].some(x=>x.meta.id===id))throw Error('duplicate id');
    const meta={path:p,id,version:String(Number(existing?.version??0)+1),size:d.byteLength,etag:'e'};this.files.set(p,{data:d,meta});if(this.failAfter)throw Error('lost response');return meta;}
}
function setup(){const local=new Local(),drive=new Drive(),state=emptyState('root');let saves=0;const e=new Engine(local,drive,state,async()=>{saves++;});return {local,drive,state,e,saves:()=>saves};}
test('first local file uploads and an unchanged run transfers no content',async()=>{const x=setup();x.local.files.set('a.md',bytes('hello'));await x.e.run(100);assert.equal(text(x.drive.files.get('a.md')!.data),'hello');await x.e.run(100);assert.equal(x.drive.puts,1);assert.equal(x.drive.reads,0);});
test('first remote file downloads including binary and nested paths',async()=>{const x=setup();x.drive.add('sub/a.bin','\0binary');await x.e.run(100);assert.equal(text(x.local.files.get('sub/a.bin')!),'\0binary');});
test('first differing same-name files are never overwritten',async()=>{const x=setup();x.local.files.set('a.md',bytes('local'));x.drive.add('a.md','remote');await x.e.run(100);assert.equal(text(x.local.files.get('a.md')!),'local');assert.equal(text(x.drive.files.get('a.md')!.data),'remote');assert.equal(x.local.archives[0].kind,'conflicts');assert.equal(text(x.local.archives[0].data),'remote');assert.equal(x.state.base['a.md'],undefined);await x.e.run(100);assert.equal(x.local.archives.length,1);});
test('same initial bytes establish baseline without write',async()=>{const x=setup();x.local.files.set('a.md',bytes('same'));x.drive.add('a.md','same');await x.e.run(100);assert.ok(x.state.base['a.md']);assert.equal(x.drive.puts,0);});
async function baseline(p='a.md'){const x=setup();x.local.files.set(p,bytes('v1'));x.drive.add(p,'v1');await x.e.run(100);return x;}
test('local edit uploads and preserves previous remote bytes',async()=>{const x=await baseline();x.local.files.set('a.md',bytes('v2'));await x.e.run(100);assert.equal(text(x.drive.files.get('a.md')!.data),'v2');assert.equal(text(x.local.archives[0].data),'v1');assert.equal(x.local.archives[0].kind,'history');});
test('remote edit updates Markdown with local history',async()=>{const x=await baseline();x.drive.edit('a.md','v2');await x.e.run(100);assert.equal(text(x.local.files.get('a.md')!),'v2');assert.equal(text(x.local.archives[0].data),'v1');});
test('simultaneous edits preserve both and create a conflict copy',async()=>{const x=await baseline();x.local.files.set('a.md',bytes('local2'));x.drive.edit('a.md','remote2');await x.e.run(100);assert.equal(text(x.local.files.get('a.md')!),'local2');assert.equal(text(x.drive.files.get('a.md')!.data),'remote2');assert.ok(x.state.conflicts['a.md']);});
test('binary remote edit uses conflict copy',async()=>{const x=await baseline('a.bin');x.drive.edit('a.bin','v2');await x.e.run(100);assert.equal(text(x.local.files.get('a.bin')!),'v1');assert.equal(x.local.archives[0].kind,'conflicts');});
test('missing tracked side does not propagate deletion or recreate',async()=>{for(const side of ['local','remote']){const x=await baseline();if(side==='local')x.local.files.delete('a.md');else x.drive.files.delete('a.md');await x.e.run(100);assert.equal(x.e.held.length,1);assert.equal(x.drive.puts,0);assert.equal(x.local.archives.length,0);}});
test('threshold includes equal sizes; lowering it never removes remote',async()=>{const x=await baseline();x.local.files.set('a.md',bytes('12345'));await x.e.run(5);assert.deepEqual(x.e.excluded,['a.md']);assert.equal(text(x.drive.files.get('a.md')!.data),'v1');await x.e.run(100);assert.equal(text(x.drive.files.get('a.md')!.data),'12345');});
test('large remote blocks the local upload too',async()=>{const x=await baseline();x.drive.edit('a.md','0123456789');x.local.files.set('a.md',bytes('x'));await x.e.run(10);assert.equal(x.drive.puts,0);assert.equal(x.local.archives.length,0);});
test('ambiguous create response recovers after restart without duplicate upload',async()=>{const x=setup();x.local.files.set('a.md',bytes('v1'));x.drive.failAfter=true;await assert.rejects(x.e.run(100));assert.equal(x.state.journal?.kind,'create');assert.equal(x.state.base['a.md'],undefined);x.drive.failAfter=false;const restarted=new Engine(x.local,x.drive,JSON.parse(JSON.stringify(x.state)),async()=>{});await restarted.run(100);assert.equal(x.drive.files.size,1);assert.equal(x.drive.puts,1);assert.ok(restarted.state.base['a.md']);});
test('failed create before commit reuses persisted generated ID',async()=>{const x=setup();x.local.files.set('a.md',bytes('v1'));x.drive.failBefore=true;await assert.rejects(x.e.run(100));const id=x.state.journal?.id;x.drive.failBefore=false;await x.e.run(100);assert.equal(x.drive.ids,1);assert.equal(x.drive.files.get('a.md')!.meta.id,id);});
test('remote changes during download abort without local overwrite',async()=>{const x=await baseline();x.drive.edit('a.md','v2');x.drive.stale=true;await assert.rejects(x.e.run(100));assert.equal(text(x.local.files.get('a.md')!),'v1');assert.equal(x.state.base['a.md'].version,'1');assert.equal(x.e.running,false);});
test('local changes at apply time keep old baseline',async()=>{const x=await baseline();x.drive.edit('a.md','v2');x.local.reject=true;await x.e.run(100);assert.equal(text(x.local.files.get('a.md')!),'v1');assert.equal(x.state.base['a.md'].version,'1');assert.equal(x.e.held.length,1);});
test('duplicate, traversal, Windows invalid and prefix collisions stop before mutation',async()=>{for(const paths of [['a.md','A.md'],['../a.md'],['con.md'],['a','a/b.md'],['e\u0301.md','é.md'],['a\\b.md']])assert.throws(()=>validatePaths(paths));});
test('re-entrancy is prevented and stop disables future work',async()=>{const x=setup();const first=x.e.run(100);assert.equal(await x.e.run(100),false);await first;x.e.stopped=true;assert.equal(await x.e.run(100),false);});
test('manually equalizing a conflict resolves it',async()=>{const x=setup();x.local.files.set('a.md',bytes('l'));x.drive.add('a.md','r');await x.e.run(100);x.local.files.set('a.md',bytes('r'));await x.e.run(100);assert.equal(Object.keys(x.state.conflicts).length,0);assert.ok(x.state.base['a.md']);});
test('journal persistence failure prevents external mutation',async()=>{const x=setup();x.local.files.set('a.md',bytes('v1'));const e=new Engine(x.local,x.drive,x.state,async()=>{throw Error('disk full');});await assert.rejects(e.run(100));assert.equal(x.drive.puts,0);});
test('prototype-like filenames remain ordinary record keys after restart',async()=>{const x=setup();x.local.files.set('__proto__',bytes('file'));x.local.files.set('constructor',bytes('other'));await x.e.run(100);assert.equal(Object.keys(x.state.base).length,2);const state=JSON.parse(JSON.stringify(x.state));const e=new Engine(x.local,x.drive,state,async()=>{});await e.run(100);assert.equal(x.drive.puts,2);});
test('corrupt saved limits cannot disable the size guard or create invalid timers',async()=>{const s=loadSettings({minutes:-1,delay:NaN,maxMB:Infinity,access_token:'sensitive',broker:'old',secretId:'INVALID'});assert.equal(s.minutes,1);assert.equal(s.delay,1);assert.equal(s.maxMB,1);assert.equal(s.secretId,'');assert.ok(!JSON.stringify(s).includes('sensitive'));const x=setup();for(const limit of [NaN,Infinity,0,-1])await assert.rejects(x.e.run(limit));assert.equal(x.drive.puts,0);});

test('Windows-created Markdown after baseline downloads and accepts later local edits',async()=>{
 const x=await baseline();x.drive.add('Windows/new.md','from Windows','external-id');await x.e.run(100);
 assert.equal(text(x.local.files.get('Windows/new.md')!),'from Windows');assert.equal(x.state.base['Windows/new.md'].remoteId,'external-id');
 x.local.files.set('Windows/new.md',bytes('edited on iPad'));await x.e.run(100);
 assert.equal(text(x.drive.files.get('Windows/new.md')!.data),'edited on iPad');assert.equal(Object.keys(x.state.conflicts).length,0);
});

test('empty remote tekito.md is downloaded and diagnosed, then a repeat run has zero transfers',async()=>{
 const x=setup();x.drive.add('tekito.md','');await x.e.run(100);
 assert.ok(x.local.files.has('tekito.md'));assert.equal(x.local.files.get('tekito.md')!.byteLength,0);
 assert.deepEqual(x.e.remotePaths,['tekito.md']);assert.equal(x.e.downloaded,1);assert.equal(x.e.uploaded,0);
 await x.e.run(100);assert.equal(x.e.downloaded,0);assert.equal(x.e.uploaded,0);assert.deepEqual(x.e.localPaths,['tekito.md']);
});
