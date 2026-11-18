import {test} from 'node:test';import assert from 'node:assert/strict';
import {seal,unseal,validateCredentials,FILE_SCOPE} from '../src/pairing';
const c={clientId:'test.apps.googleusercontent.com',clientSecret:'fake-client-secret',refreshToken:'fake-refresh',scope:FILE_SCOPE};
test('AES-GCM pairing round-trips, uses random 128-bit code and contains no plaintext secrets',async()=>{
  const a=await seal(c),b=await seal(c);assert.equal(a.code.replace(/-/g,'').length,32);assert.notEqual(a.code,b.code);assert.notEqual(a.token,b.token);assert.deepEqual(await unseal(a.token,a.code.toUpperCase()),c);assert.ok(!a.token.includes(c.refreshToken));const e=JSON.parse(Buffer.from(a.token.split('.')[1],'base64url').toString());assert.ok(!JSON.stringify(e).includes(c.clientSecret));
});
test('wrong code, modified ciphertext, malformed and oversized inputs fail closed',async()=>{
  const a=await seal(c);await assert.rejects(unseal(a.token,'b'.repeat(32)));const e=JSON.parse(Buffer.from(a.token.split('.')[1],'base64url').toString());const bytes=Buffer.from(e.data,'base64url');bytes[0]^=1;e.data=bytes.toString('base64url');const altered='AIDSYNC1.'+Buffer.from(JSON.stringify(e)).toString('base64url');await assert.rejects(unseal(altered,a.code));await assert.rejects(unseal('AIDSYNC1.'+'a'.repeat(40000),a.code));await assert.rejects(unseal('not-pairing',a.code));
});
test('expired import is rejected even with correct code',async()=>{
  const a=await seal(c),original=Date.now;Date.now=()=>original()+700000;try{await assert.rejects(unseal(a.token,a.code),/有効期限/);}finally{Date.now=original;}
});
test('credentials accept only known Google Drive scopes and bounded fields',()=>{
  assert.throws(()=>validateCredentials({...c,clientId:'evil.example'}));assert.throws(()=>validateCredentials({...c,scope:'email'}));assert.throws(()=>validateCredentials({...c,refreshToken:'x'.repeat(9000)}));
});
