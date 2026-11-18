import {test} from 'node:test';import assert from 'node:assert/strict';
import {createHelper} from '../scripts/desktop-auth';import {unseal,FILE_SCOPE,FULL_SCOPE} from '../src/pairing';
const installed={client_id:'test.apps.googleusercontent.com',client_secret:'fake-secret'};
for(const scope of [FILE_SCOPE,FULL_SCOPE]) test('desktop helper '+scope+' signs in with PKCE/state, binds loopback, exports encrypted pairing and rejects callback reuse',async()=>{
  let exchanges=0;let auth!:URL;
  const h=await createHelper({googleFetch:async(input:any,init:any)=>{exchanges++;assert.equal(String(input),'https://oauth2.googleapis.com/token');const form=new URLSearchParams(init.body);assert.equal(form.get('redirect_uri'),h.origin+'/callback');assert.equal(form.get('client_secret'),'fake-secret');const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(form.get('code_verifier')!))).toString('base64url');assert.equal(digest,auth.searchParams.get('code_challenge'));return Response.json({refresh_token:'fake-refresh',scope});}});
  try{
    assert.equal(new URL(h.url).hostname,'127.0.0.1');const page=await fetch(h.url);assert.equal(page.status,200);assert.ok(page.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));assert.ok((await page.text()).includes('Drive Sync'));
    const start=await fetch(h.url+'/authorize',{method:'POST',headers:{'Content-Type':'application/json',Origin:h.origin},body:JSON.stringify({credentials:{installed},scope})});auth=new URL((await start.json() as any).url);assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
    assert.equal((await fetch(h.origin+'/callback?state=wrong&code=fake')).status,400);assert.equal(exchanges,0);
    const callback=h.origin+'/callback?'+new URLSearchParams({state:auth.searchParams.get('state')!,code:'fake-code'});assert.equal((await fetch(callback)).status,200);assert.equal((await fetch(callback)).status,400);assert.equal(exchanges,1);
    const state=await(await fetch(h.url+'/state')).json() as any;assert.deepEqual(await unseal(state.pairing.token,state.pairing.code),{clientId:installed.client_id,clientSecret:installed.client_secret,refreshToken:'fake-refresh',scope});
  }finally{h.close();}
});
test('helper rejects cross-site POSTs, Web client files, large JSON and unknown routes',async()=>{
  const h=await createHelper();try{
    const post=(body:any,origin=h.origin)=>fetch(h.url+'/authorize',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post({credentials:{installed}},'https://evil.example')).status,403);
    assert.equal((await post({credentials:{web:installed}})).status,400);
    assert.equal((await post({credentials:'a'.repeat(33000)})).status,400);
    assert.equal((await fetch(h.origin+'/missing')).status,404);
    assert.equal((await fetch(h.origin+'/callback?state=x&code=x')).status,400);
  }finally{h.close();}
});
test('Google denial never yields pairing; errors contain no provider token details',async()=>{
  const h=await createHelper({googleFetch:async()=>new Response('SENSITIVE-DETAIL',{status:400})});try{
    const start=await(await fetch(h.url+'/authorize',{method:'POST',headers:{Origin:h.origin,'Content-Type':'application/json'},body:JSON.stringify({credentials:{installed}})})).json() as any;
    const u=new URL(start.url),r=await fetch(h.origin+'/callback?'+new URLSearchParams({state:u.searchParams.get('state')!,code:'fake'}));assert.equal(r.status,400);assert.ok(!(await r.text()).includes('SENSITIVE'));const state=await(await fetch(h.url+'/state')).json() as any;assert.equal(state.pairing,undefined);
  }finally{h.close();}
});

test('default authorization requests full Drive and refuses narrower grants',async()=>{
 const h=await createHelper({googleFetch:async()=>Response.json({refresh_token:'fake-refresh',scope:FILE_SCOPE})});
 try{
  const page=await(await fetch(h.url)).text();assert.ok(page.indexOf('value="'+FULL_SCOPE+'"')<page.indexOf('value="'+FILE_SCOPE+'"'));
  const start=await(await fetch(h.url+'/authorize',{method:'POST',headers:{Origin:h.origin,'Content-Type':'application/json'},body:JSON.stringify({credentials:{installed}})})).json() as any;
  const u=new URL(start.url);assert.equal(u.searchParams.get('scope'),FULL_SCOPE);
  assert.equal((await fetch(h.origin+'/callback?'+new URLSearchParams({state:u.searchParams.get('state')!,code:'fake'}))).status,400);
  assert.equal(((await(await fetch(h.url+'/state')).json()) as any).pairing,undefined);
  assert.equal((await fetch(h.url+'/authorize',{method:'POST',headers:{Origin:h.origin,'Content-Type':'application/json'},body:JSON.stringify({credentials:{installed},scope:'email'})})).status,400);
 }finally{h.close();}
});
