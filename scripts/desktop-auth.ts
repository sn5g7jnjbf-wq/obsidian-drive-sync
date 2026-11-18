/** Local-only Google OAuth helper. Never writes credentials to disk or logs them. */
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {execFile} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {seal,FILE_SCOPE,FULL_SCOPE,validateCredentials} from '../src/pairing';
import {random} from '../src/model';

interface Options {googleFetch?:typeof fetch;timeoutMs?:number}
async function readJson(req:IncomingMessage):Promise<any>{
  if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON形式が必要です。');
  const buffers:Buffer[]=[];let total=0;
  for await(const chunk of req){total+=chunk.length;if(total>32768)throw Error('設定が大きすぎます。');buffers.push(chunk);}
  return JSON.parse(Buffer.concat(buffers).toString('utf8'));
}
function reply(res:ServerResponse,status:number,value:unknown,html=false,nonce=''){
  res.writeHead(status,{'Content-Type':html?'text/html; charset=utf-8':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'`});
  res.end(html?String(value):JSON.stringify(value));
}
export async function createHelper(options:Options={}){
  const googleFetch=options.googleFetch??fetch,nonce=random(),prefix='/setup/'+random();
  let origin='',pending:{clientId:string;clientSecret:string;scope:string;verifier:string;state:string;expires:number}|undefined;
  let pairing:Awaited<ReturnType<typeof seal>>|undefined,busy=false,notice='Google Cloudで作成したデスクトップアプリのクライアントIDとシークレットを入力してください。JSONファイルからも読み込めます。';
  let closed=false;
  const server=createServer(async(req,res)=>{
    try{
      if(req.headers.host!==new URL(origin).host){reply(res,403,{error:'Hostが不正です。'});return;}
      const u=new URL(req.url??'/',origin);
      if(req.method==='GET'&&u.pathname===prefix){reply(res,200,page(prefix,nonce),true,nonce);return;}
      if(req.method==='GET'&&u.pathname===prefix+'/state'){
        if(pairing&&pairing.expiresAt<Date.now()){pairing=undefined;notice='接続設定の10分の期限が切れました。認証をやり直してください。';}
        reply(res,200,{notice,busy,pairing});return;
      }
      if(req.method==='POST'&&u.pathname===prefix+'/authorize'){
        if(req.headers.origin!==origin){reply(res,403,{error:'別サイトからの操作を拒否しました。'});return;}
        if(busy){reply(res,409,{error:'認証処理中です。'});return;}
        const b=await readJson(req),installed=b.credentials?.installed;
        if(!installed||typeof installed.client_id!=='string'||typeof installed.client_secret!=='string')throw Error('Google Cloudの「デスクトップアプリ」のJSONを指定してください。');
        const scope=b.scope??FULL_SCOPE;
        validateCredentials({clientId:installed.client_id,clientSecret:installed.client_secret,refreshToken:'validation-only',scope});
        const verifier=random(),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
        const challenge=Buffer.from(digest).toString('base64url');
        pending={clientId:installed.client_id,clientSecret:installed.client_secret,scope,verifier,state:random(),expires:Date.now()+600000};pairing=undefined;
        const q=new URLSearchParams({client_id:pending.clientId,redirect_uri:origin+'/callback',response_type:'code',scope,state:pending.state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent'});
        notice='Googleの画面で認証してください。この画面は開いたままにします。';
        reply(res,200,{url:'https://accounts.google.com/o/oauth2/v2/auth?'+q});return;
      }
      if(req.method==='GET'&&u.pathname==='/callback'){
        const p=pending;
        if(!p||p.expires<Date.now()||u.searchParams.get('state')!==p.state||busy){reply(res,400,{error:'認証の期限切れ、または不正なstateです。最初からやり直してください。'});return;}
        pending=undefined;busy=true;
        try{
          const code=u.searchParams.get('code');
          if(u.searchParams.has('error')||!code||code.length>8192)throw Error('Googleで認証が取り消されました。');
          const r=await googleFetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:p.clientId,client_secret:p.clientSecret,redirect_uri:origin+'/callback',code_verifier:p.verifier}),signal:AbortSignal.timeout(20000)});
          if(!r.ok)throw Error('Googleで認証コードの交換に失敗しました。設定を確認し、再認証してください。');
          const t=await r.json() as {refresh_token?:string;scope?:string};
          if(!t.refresh_token)throw Error('更新用トークンを取得できません。Google側の同意設定を確認してください。');
          if(!t.scope?.split(' ').includes(p.scope))throw Error('必要なDrive権限が許可されませんでした。');
          pairing=await seal({clientId:p.clientId,clientSecret:p.clientSecret,refreshToken:t.refresh_token,scope:p.scope});
          notice='認証できました。10分以内に接続設定をiPhoneへ取り込んでください。';
          reply(res,200,`<!doctype html><meta charset="utf-8"><title>認証完了</title><p>認証できました。</p><a href="${prefix}">接続設定と解除コードを表示する</a>`,true,nonce);
        }catch(e){notice=e instanceof Error&&e.message.startsWith('Google')?e.message:'認証を完了できませんでした。元の画面からやり直してください。';reply(res,400,{error:notice});}
        finally{busy=false;}return;
      }
      reply(res,404,{error:'ページが見つかりません。ターミナルに表示されたURLを開いてください。'});
    }catch{reply(res,400,{error:'設定を読み取れません。Google Cloudのデスクトップアプリ用JSONを確認してください。'});}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
  const address=server.address();if(!address||typeof address==='string')throw Error('ローカルサーバーを起動できません。');
  origin='http://127.0.0.1:'+address.port;
  const close=()=>{if(closed)return;closed=true;pending=undefined;pairing=undefined;clearTimeout(timer);server.closeAllConnections();server.close();};
  const timer=setTimeout(close,options.timeoutMs??20*60000);timer.unref();
  return {url:origin+prefix,origin,close};
}

function page(prefix:string,nonce:string):string{
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Drive Sync 接続準備</title>
<style>body{font:16px system-ui;max-width:760px;margin:36px auto;padding:0 20px;line-height:1.7}label{display:block;margin-top:20px}textarea{width:100%;min-height:110px;box-sizing:border-box}button{padding:10px 18px;margin:12px 8px 12px 0}code{overflow-wrap:anywhere}#result{border:1px solid #999;padding:16px}small{display:block}</style>
<h1>Drive Sync 接続準備</h1><p>この画面はWindows上だけで動きます。外部サーバー・課金サービスは使いません。通信先はGoogle認証だけです。20分後に自動終了します。</p>
<h2>① Google Cloudのデスクトップアプリ認証情報</h2>
<label>クライアントID<input id="client-id" type="text" autocomplete="off" spellcheck="false" placeholder="…apps.googleusercontent.com" style="display:block;width:100%;box-sizing:border-box"></label>
<label>クライアントシークレット<input id="client-secret" type="password" autocomplete="off" spellcheck="false" style="display:block;width:100%;box-sizing:border-box"></label>
<small>メモしたシークレットはここに貼り付けてください。Windows内の一時サーバーとGoogle認証以外へ送信しません。ファイルやログにも保存しません。</small>
<label>JSONから読み込む場合はこちら（任意）<input id="file" type="file" accept=".json,application/json"></label>
<small>JSONを選んだ場合は、その内容を優先します。手入力した値は使いません。</small>
<label>② Driveの権限<select id="scope"><option value="${FULL_SCOPE}">推奨：Windowsで新規作成したノートも双方向同期（Drive全体の読み書き）</option><option value="${FILE_SCOPE}">制限付き：このアプリのファイルのみ（Windows新規ノートは取得不可）</option></select></label>
<small>Windowsで新規作成したファイルを取得・更新するため、推奨設定はDrive全体の読み書き権限を要求します。Googleの同意画面で確認してください。権限自体はフォルダ限定ではなく、漏洩時の影響範囲が広がります。実際の同期処理は指定フォルダ内だけで行い、自動削除はしません。既存ユーザーも再認証し、iPhone・iPadへ新しい接続設定を取り込む必要があります。</small>
<button id="authorize">③ Googleの認証画面を開く</button><p id="status" role="status"></p>
<section id="result" hidden><h2>④ iPhoneへ渡す接続設定</h2><p>下の接続設定をiPhoneへコピーし、ObsidianのDrive Sync設定へ貼り付けます。解除コードは別に入力してください。両方を一緒に共有しないでください。</p>
<textarea id="token" readonly aria-label="暗号化した接続設定"></textarea><button id="copy">接続設定をコピー</button><p>解除コード：<code id="code"></code></p><p id="expiry"></p><p>暗号化されていても認証情報です。チャットへ貼らず、取込後はコピー履歴や転送用メモを整理してください。期限内の再取込は可能です。使い捨てをサーバーで強制する仕組みではありません。</p></section>
<script nonce="${nonce}">
const base=${JSON.stringify(prefix)};
const el=id=>document.getElementById(id);
el('authorize').onclick=async()=>{const b=el('authorize');b.disabled=true;try{
  const f=el('file').files[0];let credentials;
  if(f){if(f.size>32768)throw Error('32KB以下のクライアントJSONを選んでください。');credentials=JSON.parse(await f.text());}
  else{const client_id=el('client-id').value.trim(),client_secret=el('client-secret').value.trim();if(!client_id||!client_secret)throw Error('クライアントIDとシークレットを両方入力してください。');credentials={installed:{client_id,client_secret}};}
  const r=await fetch(base+'/authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credentials,scope:el('scope').value})});const j=await r.json();if(!r.ok)throw Error(j.error);
  el('file').value='';el('client-secret').value='';window.location.assign(j.url);
}catch(e){el('status').textContent=e.message;}finally{b.disabled=false;}};
// Opening Google in the same tab avoids blocked popups. Use Back after its callback page.
el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(el('token').value);}catch{el('token').focus();el('token').select();}};
async function refresh(){try{const r=await fetch(base+'/state');const j=await r.json();el('status').textContent=j.notice;el('result').hidden=!j.pairing;if(j.pairing){el('token').value=j.pairing.token;el('code').textContent=j.pairing.code;el('expiry').textContent='取込期限：'+new Date(j.pairing.expiresAt).toLocaleTimeString();}else{el('token').value='';el('code').textContent='';}}catch{el('status').textContent='ローカル認証ツールが終了しました。必要ならもう一度起動してください。';el('result').hidden=true;el('token').value='';el('code').textContent='';}}
refresh();setInterval(refresh,2000);
</script></html>`;
}

async function main(){
  const helper=await createHelper();console.log('Drive Sync 接続準備（認証情報は保存・ログ出力しません）');console.log(helper.url);
  if(!process.argv.includes('--no-open')){
    const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
    const args=process.platform==='win32'?['url.dll,FileProtocolHandler',helper.url]:[helper.url];
    execFile(command,args,{windowsHide:true},()=>{});
  }
  process.once('SIGINT',()=>{helper.close();process.exitCode=0;});process.once('SIGTERM',()=>helper.close());
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)void main().catch(()=>{console.error('認証ツールを起動できませんでした。');process.exitCode=1;});
