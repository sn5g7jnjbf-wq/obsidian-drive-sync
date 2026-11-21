import {Plugin,PluginSettingTab,Setting,Notice,Modal,type App} from 'obsidian';
import {Auth} from './auth';import {Drive,DuplicateFilesError} from './drive';import {Engine} from './engine';import {Local} from './local';
import {defaults,loadSettings,emptyState,random,syncFilter,type Settings,type State,type Choice,type DuplicateGroup} from './model';
import {FILE_SCOPE} from './pairing';
import {lineDiff} from './line-diff';

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
      this.state.duplicates=[];
      this.engine=new Engine(new Local(this.app),new Drive(this.auth,this.settings.root),this.state,()=>this.persist());
      const done=await this.engine.run(this.settings.maxMB*1024*1024,syncFilter(this.settings));
      this.status=done?`同期完了（Drive検出 ${this.engine.remotePaths.length}、取得 ${this.engine.downloaded}、送信 ${this.engine.uploaded}、除外 ${this.engine.excluded.length}、保留 ${this.engine.held.length}、競合 ${Object.keys(this.state.conflicts).length}）`:'同期を停止しました';
      if(done&&this.auth.scope===FILE_SCOPE)this.status+=' ⚠ 制限付き権限：Windowsで新規作成したファイルは取得できません。Windowsの認証ツールで推奨権限を選び、接続設定を取り込み直してください。';
      const count=Object.keys(this.state.moves??{}).length;if(count)this.status+=` 移動先の選択待ち ${count}件（設定画面で選択）`;
    } catch(e) {if(e instanceof DuplicateFilesError){this.state.duplicates=e.groups;await this.persist();}this.status=e instanceof Error?e.message:'同期エラー';new Notice(this.status);}
    finally {this.syncing=false;}
  }
  get busy() {return this.syncing||this.authBusy;}
  async choose(path:string,choice:Choice,move:boolean){
    if(this.busy||this.unloaded)throw Error('同期中です。完了してから選択してください。');
    if(!this.ready||!this.auth.connected||this.state.root!==this.settings.root||!this.settings.backupConfirmed)throw Error('接続・同期先・バックアップ確認後、再同期してください。');
    const includes=syncFilter(this.settings),destination=this.state.moves?.[path]?.to;
    if(!includes(path)||(move&&destination&&!includes(destination)))throw Error('同期対象外のファイルです。');
    this.syncing=true;
    try{
      this.engine=new Engine(new Local(this.app),new Drive(this.auth,this.settings.root),this.state,()=>this.persist());
      await this.engine.resolve(path,choice,move,this.settings.maxMB*1024*1024);this.status='選択を適用しました';
    }finally{this.syncing=false;}
    await this.sync();
  }
  async chooseDuplicate(group:DuplicateGroup,preferredId:string){
    if(this.busy||this.unloaded||!this.auth.connected||this.state.root!==this.settings.root)throw Error('接続・同期先を確認し、同期終了後に選択してください。');
    if(group.files.some(file=>!syncFilter(this.settings)(file.path)))throw Error('同期対象外のファイルです。');
    this.authBusy=true;
    try{await new Drive(this.auth,this.settings.root).resolveDuplicate(group,preferredId);this.state.duplicates=[];await this.persist();}
    finally{this.authBusy=false;}
    await this.sync();
  }
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
    new Setting(c).setName('Markdownだけ同期').setDesc('画像・PDFなどの添付ファイルを除外します。')
      .addToggle(toggle=>toggle.setValue(s.markdownOnly??false).setDisabled(p.busy).onChange(async value=>{
        if(p.busy)return;s.markdownOnly=value;await p.persist();
      }));
    new Setting(c).setName('同期から除外するファイル・フォルダ').setDesc('保管庫からの相対パスを1行に1つ入力します。例: 私用 または 添付/動画')
      .addTextArea(input=>input.setValue(s.excludedPaths??'').setDisabled(p.busy).onChange(async value=>{
        if(p.busy)return;s.excludedPaths=value;await p.persist();
      }));
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
    for(const conflict of Object.values(p.state.conflicts))action(conflict.path,'使う内容を選ぶ',async()=>{new ChooseConflict(this.app,p,conflict.path,false,()=>this.display()).open();});
    c.createEl('h3',{text:'移動先のファイルが重複しています'});
    for(const conflict of Object.values(p.state.moves??{}))action(conflict.from+' → '+conflict.to,'使う内容を選ぶ',async()=>{new ChooseConflict(this.app,p,conflict.from,true,()=>this.display()).open();});
    c.createEl('h3',{text:'Drive内の同名ファイル'});
    for(const group of p.state.duplicates??[])action(group.path,'元の名前で残すファイルを選ぶ',async()=>{new ChooseDuplicate(this.app,p,group,()=>this.display()).open();});
    c.createEl('p',{text:'Drive内の移動・名前変更をファイルIDで追跡します。移動先に別ファイルがあると選択待ちになります。置換前の内容は AI Drive Sync/history に残します。通常の移動・改名ではObsidianの設定に従って内部リンクを更新します。'});
  }
  private folderOptions?:{id:string;name:string}[];
}

function modifiedLabel(value?:string|number):string {
  const time=typeof value==='string'?Date.parse(value):value;
  return '最終更新日時 '+(time && Number.isFinite(time)?new Date(time).toLocaleString('ja-JP'):'不明');
}

class ChooseDuplicate extends Modal {
  constructor(app:App,private plugin:DriveSync,private group:DuplicateGroup,private refresh:()=>void){super(app);}
  onOpen(){
    this.contentEl.createEl('h2',{text:'Drive内の同名ファイルを整理'});
    this.contentEl.addClass('drive-sync-preview');
    this.contentEl.createEl('p',{text:`${this.group.path} が複数あります。元の名前で残すファイルを選んでください。他のファイルはDrive上で「Driveコピー」を付けた別名に変更し、すべて残します。削除・本文の上書きはしません。`});
    for(const file of this.group.files){
      const preview=this.contentEl.createEl('div');preview.createEl('h4',{text:`${file.path}（${file.size}バイト、ID末尾 ${file.id.slice(-6)}）`});
      preview.createEl('p',{text:modifiedLabel(file.modifiedTime)});
      if(file.size<this.plugin.settings.maxMB*1024*1024)void new Drive(this.plugin.auth,this.plugin.settings.root).read(file).then(data=>{
        try{preview.createEl('pre',{text:new TextDecoder('utf-8',{fatal:true}).decode(data).slice(0,4000)});}catch{preview.createEl('p',{text:'バイナリファイル'});}
      }).catch(()=>preview.createEl('p',{text:'プレビューを取得できませんでした。'}));
      new Setting(this.contentEl).addButton(b=>b.setButtonText('このファイルを元の名前で残す').onClick(async()=>{
        if(this.plugin.busy)return;b.setDisabled(true);
        try{await this.plugin.chooseDuplicate(this.group,file.id);this.close();}
        catch(e){new Notice(e instanceof Error?e.message:'名前変更に失敗しました。');}
        finally{b.setDisabled(false);this.refresh();}
      }));
    }
    new Setting(this.contentEl).addButton(b=>b.setButtonText('後で選ぶ').onClick(()=>this.close()));
  }
  onClose(){this.contentEl.empty();}
}

class ChooseConflict extends Modal {
  private closed=false;
  constructor(app:App,private plugin:DriveSync,private path:string,private move:boolean,private refresh:()=>void){super(app);}
  onOpen(){
    this.contentEl.createEl('h2',{text:'使うファイルを選ぶ'});
    this.contentEl.addClass('drive-sync-preview');
    const m=this.move?this.plugin.state.moves?.[this.path]:undefined;
    this.contentEl.createEl('p',{text:m?`Driveでの移動：${m.from} → ${m.to}。移動先には端末の別ファイルがあります。`:this.path});
    this.contentEl.createEl('p',{text:'適用する直前に両側の変更を再確認します。後から変更されていれば処理を止めます。'});
    const preview=this.contentEl.createEl('div');
    const show=(label:string,data:ArrayBuffer|undefined,modified?:string|number)=>{
      if(this.closed)return;preview.createEl('h4',{text:label});
      preview.createEl('p',{text:modifiedLabel(modified)});
      if(!data){preview.createEl('p',{text:'ファイルを確認できません。再同期してください。'});return;}
      try{const text=new TextDecoder('utf-8',{fatal:true}).decode(data);preview.createEl('pre',{text:text.slice(0,4000)+(text.length>4000?'\n…（先頭4000文字のみ）':'')});}
      catch{preview.createEl('p',{text:`バイナリファイル（${data.byteLength}バイト）`});}
    };
    void (async()=>{
      try{
        const local=new Local(this.app),target=m?.to??this.path;
        if(m)show('移動元の端末版',await local.read(this.path),local.modifiedTime(this.path));
        const localData=await local.read(target);
        show('端末版（移動先）',localData,local.modifiedTime(target));
        const drive=new Drive(this.plugin.auth,this.plugin.settings.root),r=(await drive.list()).find(f=>f.path===target);
        if(!r||this.closed)return;
        const remoteData=r.size<this.plugin.settings.maxMB*1024*1024?await drive.read(r):undefined;
        show('Drive版（現在の内容）',remoteData,r.modifiedTime);
        if(this.closed||!localData||!remoteData||!target.toLowerCase().endsWith('.md'))return;
        preview.createEl('h4',{text:'本文の差分（− 端末版、＋ Drive版）'});
        try{
          const decoder=new TextDecoder('utf-8',{fatal:true});
          preview.createEl('pre',{text:lineDiff(decoder.decode(localData),decoder.decode(remoteData))});
        }catch{preview.createEl('p',{text:'テキストの差分を表示できません。'});}
      }catch{if(!this.closed)preview.createEl('p',{text:'プレビューを取得できませんでした。接続を確認して開き直してください。'});}
    })();
    const choices:[Choice,string,string][]=[
      ['both','両方残す',m?'Drive版を移動先へ取り込み、端末の移動元・移動先は別名で残します。別名コピーも次回以降の同期対象です。':'Drive版を元の名前で取り込み、端末版は別名で残します。別名コピーも同期対象です。'],
      ['remote','Drive側を使う','Drive版を取り込みます。置き換える端末版は履歴へ移し、消去しません。'],
      ['local','端末側を使う',m?'移動先に今ある端末版をDriveへ送信します。移動元の端末版と変更前のDrive版は履歴に残します。':'端末版をDriveへ送信します。変更前のDrive版は履歴に残します。']
    ];
    for(const [choice,label,desc] of choices)new Setting(this.contentEl).setName(label).setDesc(desc).addButton(b=>b.setButtonText(label+'を適用').onClick(async()=>{
      if(this.plugin.busy)return;b.setDisabled(true);
      try{await this.plugin.choose(this.path,choice,this.move);this.close();}
      catch(e){new Notice(e instanceof Error?e.message:'選択を適用できませんでした。');}
      finally{b.setDisabled(false);this.refresh();}
    }));
    new Setting(this.contentEl).addButton(b=>b.setButtonText('後で選ぶ').onClick(()=>this.close()));
  }
  onClose(){this.closed=true;this.contentEl.empty();}
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
