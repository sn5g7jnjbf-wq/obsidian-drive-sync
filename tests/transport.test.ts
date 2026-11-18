import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {runInNewContext} from 'node:vm';import {resolve} from 'node:path';
import {seal,FILE_SCOPE} from '../src/pairing';
async function bundle(entry:string,transport:(req:any)=>any){
  const r=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'cjs',alias:{obsidian:resolve('tests/obsidian.mock.ts')}});
  const module={exports:{} as any},delays:number[]=[];
  const ctx:any={module,exports:module.exports,__transport:transport,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,crypto,btoa,atob,Date,Math,setTimeout:(fn:any,ms:number)=>{delays.push(ms);fn();}};
  runInNewContext(r.outputFiles[0].text,ctx);return {api:module.exports,delays};
}
const response=(status:number,json:any={},headers:any={})=>({status,json,headers,arrayBuffer:new ArrayBuffer(0),text:JSON.stringify(json)});
test('bounded backoff honors Retry-After; terminal errors never include provider body',async()=>{let n=0;const x=await bundle('src/http.ts',async()=>++n<3?response(429,{}, {'retry-after':'2'}):response(200));await x.api.http({url:'https://test'});assert.equal(n,3);assert.ok(x.delays.every((v:number)=>v>=2000));const y=await bundle('src/http.ts',async()=>response(403,{secret:'access-token'}));await assert.rejects(y.api.http({url:'https://test'}),e=>String(e).includes('403')&&!String(e).includes('access-token'));});
test('mutations do not retry ambiguous server failures',async()=>{let calls=0;const x=await bundle('src/http.ts',async()=>{calls++;return response(500);});await assert.rejects(x.api.http({url:'https://test',method:'POST'},false));assert.equal(calls,1);});
test('Drive paginates, keeps nested structure and applies If-Match to one media update',async()=>{const requests:any[]=[];const x=await bundle('src/drive.ts',async(req:any)=>{
  requests.push(req);const u=new URL(req.url);
  if(req.method==='PATCH')return response(200,{id:'f',version:'2',size:'3'});
  if(u.pathname.endsWith('/root')&&u.searchParams.get('fields')==='mimeType,trashed')return response(200,{mimeType:'application/vnd.google-apps.folder'});
  if(u.pathname.endsWith('/files')) {const q=u.searchParams.get('q')??'';
    if(q.startsWith("'sub'"))return response(200,{files:[{id:'f',name:'a.md',mimeType:'text/markdown',version:'1',size:'3'}]});
    if(!u.searchParams.has('pageToken'))return response(200,{files:[{id:'sub',name:'notes',mimeType:'application/vnd.google-apps.folder'}],nextPageToken:'page2'});
    return response(200,{files:[]});}
  throw Error('unexpected request');
});const d=new x.api.Drive({token:async()=>'fake-access',invalidate:()=>{}},'root');const files=await d.list();assert.equal(files[0].path,'notes/a.md');const file={...files[0],etag:'"etag1"'};await d.put(file.path,new TextEncoder().encode('new').buffer,file.id,file);const update=requests.find(x=>x.method==='PATCH');assert.equal(update.headers['If-Match'],'"etag1"');assert.equal(new URL(update.url).searchParams.get('uploadType'),'media');assert.equal(requests.filter(x=>x.method==='PATCH').length,1);});
test('Drive without ETag refuses to overwrite',async()=>{let calls=0;const x=await bundle('src/drive.ts',async()=>{calls++;return response(200);});const d=new x.api.Drive({token:async()=>'t'},'root');await assert.rejects(d.put('a.md',new ArrayBuffer(0),'f',{id:'f',path:'a.md',version:'1',size:0}));assert.equal(calls,0);});
const creds={clientId:'test.apps.googleusercontent.com',clientSecret:'desktop-secret',refreshToken:'refresh',scope:FILE_SCOPE};
test('encrypted import verifies with Google then persists credentials only to SecretStorage',async()=>{
  const requests:any[]=[];const x=await bundle('src/auth.ts',async(req:any)=>{requests.push(req);assert.equal(req.url,'https://oauth2.googleapis.com/token');const form=new URLSearchParams(req.body);assert.equal(form.get('grant_type'),'refresh_token');assert.equal(form.get('client_secret'),'desktop-secret');return response(200,{access_token:'access',expires_in:3600});});
  const store=new Map(),settings={secretId:'key'},a=new x.api.Auth({secretStorage:{getSecret:(k:string)=>store.get(k),setSecret:(k:string,v:string)=>store.set(k,v)}},()=>settings);
  const pair=await seal(creds);await a.importSetup(pair.token,pair.code);assert.equal(JSON.parse(store.get('key')).refreshToken,'refresh');assert.equal(await a.token(),'access');assert.equal(requests.length,1);assert.ok(!store.get('key').includes('access'));assert.ok(!JSON.stringify(settings).includes('refresh'));
  a.invalidate();await Promise.all([a.token(),a.token()]);assert.equal(requests.length,2);
});
test('failed Google verification leaves the previous connection intact',async()=>{
  const x=await bundle('src/auth.ts',async()=>response(400,{secret:'should-not-leak'}));const store=new Map([['key',JSON.stringify(creds)]]);const a=new x.api.Auth({secretStorage:{getSecret:(k:string)=>store.get(k),setSecret:(k:string,v:string)=>store.set(k,v)}},()=>({secretId:'key'}));const pair=await seal({...creds,refreshToken:'other'});await assert.rejects(a.importSetup(pair.token,pair.code));assert.equal(JSON.parse(store.get('key')!).refreshToken,'refresh');
});
test('disconnect clears local credentials even when Google revoke is offline',async()=>{
  const x=await bundle('src/auth.ts',async()=>{throw Error('offline');});const store=new Map([['key',JSON.stringify(creds)]]);const a=new x.api.Auth({secretStorage:{getSecret:(k:string)=>store.get(k),setSecret:(k:string,v:string)=>store.set(k,v)}},()=>({secretId:'key'}));await assert.rejects(a.disconnect());assert.equal(a.connected,false);assert.equal(store.get('key'),'');
});
