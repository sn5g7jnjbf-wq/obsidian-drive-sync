
import {test} from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {runInNewContext} from 'node:vm';import {resolve} from 'node:path';import {hash} from '../src/model';
async function setup(){
 const r=await build({stdin:{contents:"export {Local} from './src/local';export {TFile} from './tests/obsidian.mock';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'cjs',alias:{obsidian:resolve('tests/obsidian.mock.ts')}});
 const module={exports:{} as any};runInNewContext(r.outputFiles[0].text,{module,exports:module.exports,crypto,TextEncoder,TextDecoder,ArrayBuffer,Uint8Array,Date});
 const {Local,TFile}=module.exports,entries=new Map<string,any>(),f=new TFile();f.path='a.md';f.data=new TextEncoder().encode('body').buffer;entries.set(f.path,f);let renames=0;
 const vault={getAbstractFileByPath:(p:string)=>entries.get(p),readBinary:async(f:any)=>f.data,createFolder:async(p:string)=>{entries.set(p,{folder:true});},rename:async(f:any,to:string)=>{assert.ok(!entries.has(to));entries.delete(f.path);f.path=to;entries.set(to,f);renames++;}};
 return {local:new Local({vault}),entries,f,renames:()=>renames};
}
test('Obsidian local move uses Vault.rename and creates parent folders without touching bytes',async()=>{const x=await setup();const h=await hash(x.f.data);assert.equal(await x.local.move('a.md','sub/b.md',h),true);assert.ok(!x.entries.has('a.md'));assert.equal(x.entries.get('sub/b.md'),x.f);assert.equal(await hash(x.f.data),h);assert.equal(x.renames(),1);});
test('Obsidian local move refuses an occupied destination including folders',async()=>{const x=await setup();x.entries.set('occupied',{folder:true});assert.equal(await x.local.move('a.md','occupied',await hash(x.f.data)),false);assert.ok(x.entries.has('a.md'));assert.equal(x.renames(),0);});
test('Obsidian local move refuses a changed source or a missing source',async()=>{const x=await setup();assert.equal(await x.local.move('a.md','b.md','wrong-hash'),false);assert.equal(await x.local.move('missing.md','b.md','wrong-hash'),false);assert.ok(x.entries.has('a.md'));assert.equal(x.renames(),0);});
