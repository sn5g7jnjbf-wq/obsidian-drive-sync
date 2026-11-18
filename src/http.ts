import {requestUrl, type RequestUrlParam, type RequestUrlResponse} from 'obsidian';
export class HttpError extends Error {constructor(readonly status:number){super(`通信エラー (${status})。設定・権限・接続を確認してください。`);}}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function http(req:RequestUrlParam,retry=true):Promise<RequestUrlResponse> {
  for(let n=0;;n++) {
    let r:RequestUrlResponse;
    try {r=await requestUrl({...req,throw:false});}
    catch {throw new Error('ネットワークに接続できません。次回同期で再試行します。');}
    let rate=false;
    if(r.status===403) {try {rate=r.json.error?.errors?.some((e:{reason:string})=>['rateLimitExceeded','userRateLimitExceeded'].includes(e.reason));} catch { /* never expose response body */ }}
    if(retry&&n<4&&(r.status===429||r.status>=500||rate)) {
      const raw=r.headers['retry-after']; const seconds=raw?Number(raw):NaN;
      const requested=Number.isFinite(seconds)?seconds*1000:raw?Date.parse(raw)-Date.now():0;
      const ms=Math.max(requested||0,1000*2**n+Math.random()*500);
      if(ms>30000) throw new Error('APIの待機時間が長いため中断しました。後で再同期してください。');
      await wait(ms);continue;
    }
    if(r.status>=400) throw new HttpError(r.status);
    return r;
  }
}
