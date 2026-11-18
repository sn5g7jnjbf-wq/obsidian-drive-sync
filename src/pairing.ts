/** Shared mobile/desktop pairing; no Node APIs or network access. */
export interface Credentials {clientId:string;clientSecret:string;refreshToken:string;scope:string}
export const FILE_SCOPE='https://www.googleapis.com/auth/drive.file';
export const FULL_SCOPE='https://www.googleapis.com/auth/drive';
const PREFIX='AIDSYNC1.',ITERATIONS=600000;
const AAD=new TextEncoder().encode('obsidian-ai-drive-sync:pair:v1');
function encode(d:Uint8Array):string{return btoa(String.fromCharCode(...d)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decode(s:string,max:number):Uint8Array<ArrayBuffer>{
  if(typeof s!=='string'||!s||s.length>max||!/^[-_A-Za-z0-9]+$/.test(s))throw Error('接続設定の形式が不正です。');
  return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
}
export function validateCredentials(value:unknown):Credentials{
  const c=value as Credentials;
  if(!c||typeof c.clientId!=='string'||!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.clientId)
    ||typeof c.clientSecret!=='string'||!c.clientSecret||c.clientSecret.length>512
    ||typeof c.refreshToken!=='string'||!c.refreshToken||c.refreshToken.length>8192
    ||![FILE_SCOPE,FULL_SCOPE].includes(c.scope))throw Error('Google接続設定が不正です。Windowsで作成し直してください。');
  return {clientId:c.clientId,clientSecret:c.clientSecret,refreshToken:c.refreshToken,scope:c.scope};
}
async function key(code:string,salt:Uint8Array<ArrayBuffer>):Promise<CryptoKey>{
  const c=code.replace(/[\s-]/g,'').toLowerCase();if(!/^[0-9a-f]{32}$/.test(c))throw Error('解除コードが不正です。');
  const m=await crypto.subtle.importKey('raw',new TextEncoder().encode(c),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS},m,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function seal(credentials:Credentials):Promise<{token:string;code:string;expiresAt:number}>{
  const c=validateCredentials(credentials),salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const code=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
  const expiresAt=Date.now()+600000;
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD},await key(code,salt),new TextEncoder().encode(JSON.stringify({credentials:c,expiresAt})));
  const e={v:1,salt:encode(salt),iv:encode(iv),data:encode(new Uint8Array(data))};
  return {token:PREFIX+encode(new TextEncoder().encode(JSON.stringify(e))),code:code.match(/.{4}/g)!.join('-'),expiresAt};
}
export async function unseal(token:string,code:string):Promise<Credentials>{
  const t=token.trim();if(!t.startsWith(PREFIX)||t.length>32768)throw Error('接続設定の形式が不正です。');
  let p:{credentials:unknown;expiresAt:number};
  try{
    const e=JSON.parse(new TextDecoder().decode(decode(t.slice(PREFIX.length),32768)));
    if(e.v!==1)throw Error('version');const salt=decode(e.salt,64),iv=decode(e.iv,32),data=decode(e.data,24000);
    if(salt.length!==16||iv.length!==12)throw Error('format');
    const d=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:AAD},await key(code,salt),data);
    p=JSON.parse(new TextDecoder().decode(d));
  }catch{throw Error('接続設定または解除コードが違います。Windowsで作成し直してください。');}
  if(!Number.isFinite(p.expiresAt)||p.expiresAt<Date.now()||p.expiresAt>Date.now()+660000)throw Error('接続設定の有効期限が切れています。Windowsで作成し直してください。');
  return validateCredentials(p.credentials);
}
