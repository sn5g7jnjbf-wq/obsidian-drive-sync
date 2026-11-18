import {Plugin,PluginSettingTab,Setting,Notice,Modal,type App} from 'obsidian';
import {Auth} from './auth';import {Drive} from './drive';import {Engine} from './engine';import {Local} from './local';
import {defaults,loadSettings,emptyState,random,type Settings,type State} from './model';
import {FILE_SCOPE} from './pairing';

export default class DriveSync extends Plugin {
  settings:Settings={...defaults};state:State=emptyState();auth!:Auth;engine?:Engine;
  status='未同期';ready=false;unloaded=false;authBusy=false;private timer?:number;private startupTimer?:number;
  private saveQueue:Promise<void>=Promise.resolve();private syncing=false;private startupPending=false;
  async onload() {
    const saved=await this.loadData();
    this.settings=loadSettings(saved?.settings);
    this.state=saved?.state??emptyState();
    if(!this.settings.secretId) this.settings.secretId='ai-drive-'+random().slice(0,24);
    if(!this.app.secretStorage) {new Notice('Drive SyncにはObsidian 1.11.4以上が必要です。');return;}
    this.auth=new Auth(this.app,()=>this.settings);await this.persist();
    this.addSettingTab(new SyncSettings(this.app,this));
    this.addCommand({id:'sync',name:'今すぐ同期',callback:()=>void this.sync()});
    this.addRibbonIcon('refresh-cw','Google Driveと同期',()=>void this.sync());
    this.registerDomEvent(document,'visibilitychange',()=>{if(document.visibilityState==='visible') {this.schedule();if(this.settings.auto) void this.sync();}});
    this.app.workspace.onLayoutReady(()=>{this.ready=true;this.schedule();this.startupPending=this.settings.startup;this.startup();});
  }
  persist():Promise<void> {
    // Serialize snapshots so an older slow write cannot roll back the journal/settings.
    const snapshot=JSON.parse(JSON.stringify({settings:this.settings,state:this.state}));
    const next=this.saveQueue.catch(()=>{}).then(()=>this.saveData(snapshot));this.saveQueue=next;return next;
  }
  schedule() {
    if(this.timer) window.clearInterval(this.timer);
    this.timer=undefined;
    if(this.settings.auto&&!this.unloaded) this.timer=window.setInterval(()=>{if(document.visibilityState==='visible') void this.sync();},Math.max(1,this.settings.minutes)*60000);
  }
  startup() {
    if(!this.startupPending||!this.ready||!this.auth.connected||!this.settings.root||this.unloaded) return;
    this.startupPending=false;
    this.startupTimer=window.setTimeout(()=>{this.startupTimer=undefined;void this.sync();},Math.max(0,this.settings.delay)*1000);
  }
  cancelStartup() {this.startupPending=false;if(this.startupTimer)window.clearTimeout(this.startupTimer);this.startupTimer=undefined;}
  async sync() {
    if(this.syncing||this.authBusy||this.unloaded) return;
    if(!this.ready||!this.auth.connected||!this.settings.root||!this.settings.backupConfirmed) {this.status='接続・同期先・バックアップ確認が必要です';return;}
    if(typeof navigator!=='undefined'&&!navigator.onLine) {this.status='オフライン：次回同期で再試行';return;}
    this.syncing=true;this.status='同期中…';
    try {
      if(this.state.root!==this.settings.root) {this.state=emptyState(this.settings.root);await this.persist();}
      this.engine=new Engine(new Local(this.app),new Drive(this.auth,this.settings.root),this.state,()=>this.persist());
      const done=await this.engine.run(this.settings.maxMB*1024*1024);
      this.status=done?`同期完了（Drive検出 ${this.engine.remotePaths.length}、取得 ${this.engine.downloaded}、送信 ${this.engine.uploaded}、除外 ${this.engine.excluded.length}、保留 ${this.engine.held.length}、競合 ${Object.keys(this.state.conflicts).length}）`:'同期を停止しました';
      if(done&&this.auth.scope===FILE_SCOPE)this.status+=' ⚠ 制限付き権限：Windowsで新規作成したファイルは取得できません。Windowsの認証ツールで推奨権限を選び、接続設定を取り込み直してください。';
    } catch(e) {this.status=e instanceof Error?e.message:'同期エラー';new Notice(this.status);}
    finally {this.syncing=false;}
  }
  get busy() {return this.syncing||this.authBusy;}
  onunload() {this.unloaded=true;if(this.engine)this.engine.stopped=true;if(this.timer)window.clearInterval(this.timer);if(this.startupTimer)window.clearTimeout(this.startupTimer);}
}

class SyncSettings extends PluginSettingTab {
  constructor(app:App,readonly plugin:DriveSync){super(app,plugin);}
  display() {
    const c=this.containerEl,p=this.plugin,s=p.settings;c.empty();c.createEl('h2',{text:'Drive Sync（実験版）'});
    c.createEl('p',{text:'最初はテスト保管庫で検証してください。iCloudとの二重同期は避けてください。設定変更は同期停止中に行ってください。'});
    const action=(name:string,label:string,fn:()=>Promise<void>)=>new Setting(c).setName(name).addButton(b=>b.setButtonText(label).setDisabled(p.busy).onClick(async()=>{if(p.busy)return;b.setDisabled(true);try{await fn();}catch(e){new Notice(e instanceof Error?e.message:'操作に失敗しました。');}finally{this.display();}}));
    const text=(name:string,value:string,save:(v:string)=>void,desc='')=>new Setting(c).setName(name).setDesc(desc).addText(t=>t.setValue(value).setDisabled(p.busy).onChange(async v=>{if(p.busy)return;save(v.trim());await p.persist();}));
    new Setting(c).setName('Googleアカウント').setDesc(p.auth.connected?'接続済み（Googleへ直接接続）':'未接続。Windowsで同梱のgoogle-auth-helper.mjsを実行してください。');
    action('Google接続・再認証','Windowsの接続設定を取り込む',async()=>{new ImportSetup(this.app,p,()=>this.display()).open();});
    if(p.auth.connected)new Setting(c).setName('許可したDrive権限').setDesc(p.auth.scope===FILE_SCOPE?'⚠ 再認証が必要：Windowsで新規作成したノートは取得できません。最新版のWindows認証ツールで「推奨」を選び、新しい接続設定を取り込んでください。接続解除・同期先の作り直しは不要です。':'Windows新規ファイル対応：Drive全体の読み書き権限。同期処理は選んだフォルダ内のみです。');
    action('Googleアカウント接続解除','解除・Googleの許可を失効',async()=>{p.authBusy=true;try{await p.auth.disconnect();p.status='接続解除済み';}finally{p.authBusy=false;}});
    action('同期先フォルダ一覧','取得',async()=>{
      const folders=await new Drive(p.auth,s.root).roots();
      this.folderOptions=folders;
    });
    if(this.folderOptions) new Setting(c).setName('同期先フォルダ選択').addDropdown(d=>{d.addOption('','選択してください');for(const f of this.folderOptions!)d.addOption(f.id,f.name+' ['+f.id+']');d.setValue(s.root).setDisabled(p.busy).onChange(async id=>{if(id&&!p.busy){s.root=id;await p.persist();p.startup();}});});
    action('新しい専用フォルダ','Drive Sync Vaultを作成',async()=>{s.root=await new Drive(p.auth,'').createRoot('Drive Sync Vault');await p.persist();});
    text('同期先フォルダID',s.root,v=>{s.root=v;},'drive.fileではアクセスを許可されたフォルダのみ。切替時は同期基準がリセットされます。');
    const toggle=(name:string,key:'auto'|'startup'|'backupConfirmed',desc='')=>new Setting(c).setName(name).setDesc(desc).addToggle(t=>t.setValue(s[key]).setDisabled(p.busy).onChange(async v=>{if(p.busy)return;s[key]=v;await p.persist();p.schedule();if(key==='startup'&&!v){this.plugin.cancelStartup();}}));
    toggle('バックアップを作成済み','backupConfirmed','実保管庫とは別のコピーを保存してからONにしてください。');
    toggle('自動同期','auto','Obsidian実行中のみ。iOSバックグラウンドでの定刻実行は保証されません。');
    const number=(name:string,key:'minutes'|'delay'|'maxMB',min:number,max:number,integer:boolean)=>new Setting(c).setName(name).addText(t=>t.setValue(String(s[key])).setDisabled(p.busy).onChange(async v=>{const n=Number(v);if(!p.busy&&v.trim()&&Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isInteger(n))){s[key]=n;await p.persist();p.schedule();}}));
    number('同期間隔（分）','minutes',1,10080,true);
    toggle('起動時に同期','startup');number('起動後の待機時間（秒）','delay',0,3600,true);
    number('ファイル容量上限（MB・以上を除外）','maxMB',0.01,100,false);
    action('手動同期','今すぐ同期',async()=>p.sync());
    new Setting(c).setName('最終同期日時').setDesc(p.state.last?new Date(p.state.last).toLocaleString():'未実行');
    new Setting(c).setName('同期状況・エラー').setDesc(p.status);
    action('表示を更新','更新',async()=>{});
    const list=(title:string,items:string[])=>{c.createEl('h3',{text:title});const ul=c.createEl('ul');for(const item of items.length?items:['なし'])ul.createEl('li',{text:item});};
    list('除外ファイル（直近実行）',p.engine?.excluded??[]);list('保留ファイル（直近実行）',p.engine?.held??[]);
    list('Driveで検出したファイル（直近実行・最大100件）',p.engine?.remotePaths.slice(0,100)??[]);
    list('同期開始時のローカルファイル（最大100件）',p.engine?.localPaths.slice(0,100)??[]);
    list('競合ファイル',Object.values(p.state.conflicts).map(x=>x.path+' → '+x.copy));
    c.createEl('p',{text:'競合の原本は両側に残ります。内容を比較し手動で同じ内容にすると次回に解消します。履歴は保管庫内 AI Drive Sync/history に保存します。'});
  }
  private folderOptions?:{id:string;name:string}[];
}

class ImportSetup extends Modal {
  private setupToken='';private code='';private disposed=false;
  constructor(app:App,readonly plugin:DriveSync,readonly refresh:()=>void){super(app);}
  onOpen(){
    this.contentEl.createEl('h2',{text:'Windowsの接続設定を取り込む'});
    this.contentEl.createEl('p',{text:'Windowsの認証ツールに表示された接続設定と解除コードを入力します。10分以内に取り込んでください。認証情報をチャットには貼らないでください。'});
    new Setting(this.contentEl).setName('暗号化した接続設定').addTextArea(t=>{t.inputEl.rows=5;t.inputEl.spellcheck=false;t.inputEl.autocomplete='off';t.onChange(v=>this.setupToken=v);});
    new Setting(this.contentEl).setName('解除コード（32桁）').addText(t=>{t.inputEl.type='password';t.inputEl.autocomplete='off';t.onChange(v=>this.code=v);});
    new Setting(this.contentEl).addButton(b=>b.setButtonText('Google接続を確認して取り込む').setCta().onClick(async()=>{
      const p=this.plugin;if(p.busy)return;p.authBusy=true;b.setDisabled(true);
      try{await p.auth.importSetup(this.setupToken,this.code);p.status='Googleアカウント接続済み';p.startup();new Notice(p.status);this.close();}
      catch(e){new Notice(e instanceof Error?e.message:'接続設定を取り込めませんでした。');}
      finally{p.authBusy=false;this.refresh();if(!this.disposed)b.setDisabled(false);}
    }));
  }
  onClose(){this.disposed=true;this.setupToken='';this.code='';this.contentEl.empty();}
}
