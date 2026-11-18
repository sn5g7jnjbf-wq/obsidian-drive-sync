export const requestUrl=(req:unknown)=>(globalThis as any).__transport(req);
export class Plugin {
  app:any; saved:any; saves:any[]=[];
  async loadData(){return this.saved;}
  async saveData(data:any){this.saves.push(data);}
  addSettingTab(){} addCommand(){} addRibbonIcon(){} registerDomEvent(){}
}
export class PluginSettingTab {containerEl:any;constructor(public app:any,public plugin:any){}}
export class Setting {}
export class Notice {constructor(public message:string){}}
export class TFile {}
export class Modal {contentEl:any;constructor(public app:any){}open(){}close(){}}
