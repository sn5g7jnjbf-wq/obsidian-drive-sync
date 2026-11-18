import {type App} from 'obsidian';
import {http} from './http';
import {type Settings} from './model';
import {unseal,validateCredentials,type Credentials} from './pairing';
export class Auth {
  private access='';private expires=0;private refreshing?:Promise<string>;private generation=0;
  constructor(private app:App,private settings:()=>Settings) {}
  private credentials():Credentials|null {
    const id=this.settings().secretId;if(!id)return null;
    const value=this.app.secretStorage.getSecret(id);if(!value)return null;
    try{return validateCredentials(JSON.parse(value));}catch{return null;}
  }
  get connected():boolean{return !!this.credentials();}
  get scope():string{return this.credentials()?.scope??'';}
  private async exchange(c:Credentials){
    return http({url:'https://oauth2.googleapis.com/token',method:'POST',contentType:'application/x-www-form-urlencoded',body:new URLSearchParams({client_id:c.clientId,client_secret:c.clientSecret,refresh_token:c.refreshToken,grant_type:'refresh_token'}).toString()});
  }
  async importSetup(token:string,code:string):Promise<void>{
    const c=await unseal(token,code),generation=this.generation;
    // Verify with Google before replacing any valid existing account.
    const r=await this.exchange(c);
    if(generation!==this.generation)throw Error('接続設定が変更されました。');
    if(typeof r.json.access_token!=='string'||!r.json.access_token)throw Error('Googleへの接続確認に失敗しました。');
    const expires=Number(r.json.expires_in);if(!Number.isFinite(expires)||expires<=0)throw Error('Googleの有効期限が不正です。');
    if(r.json.refresh_token)c.refreshToken=r.json.refresh_token;
    validateCredentials(c);this.generation++;
    this.app.secretStorage.setSecret(this.settings().secretId,JSON.stringify(c));
    this.access=r.json.access_token;this.expires=Date.now()+expires*1000-60000;
  }
  async token():Promise<string>{
    if(this.access&&Date.now()<this.expires)return this.access;
    if(this.refreshing)return this.refreshing;
    this.refreshing=this.refresh();try{return await this.refreshing;}finally{this.refreshing=undefined;}
  }
  private async refresh():Promise<string>{
    const c=this.credentials(),generation=this.generation;
    if(!c)throw Error('WindowsでGoogle認証し、接続設定を取り込んでください。');
    const r=await this.exchange(c);
    if(generation!==this.generation)throw Error('接続設定が変更されました。再同期してください。');
    if(typeof r.json.access_token!=='string'||!r.json.access_token)throw Error('Google接続を更新できません。再認証してください。');
    if(r.json.refresh_token){c.refreshToken=r.json.refresh_token;validateCredentials(c);this.app.secretStorage.setSecret(this.settings().secretId,JSON.stringify(c));}
    this.access=r.json.access_token;this.expires=Date.now()+(Number(r.json.expires_in)||3600)*1000-60000;return this.access;
  }
  invalidate(){this.access='';this.expires=0;}
  async disconnect():Promise<void>{
    const c=this.credentials();this.generation++;this.invalidate();this.app.secretStorage.setSecret(this.settings().secretId,'');
    if(c)await http({url:'https://oauth2.googleapis.com/revoke',method:'POST',contentType:'application/x-www-form-urlencoded',body:new URLSearchParams({token:c.refreshToken}).toString()},false);
  }
}
