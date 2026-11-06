// API simulation for environments unable to launch Electron. This is NOT a VS Code host test.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { fileURLToPath, pathToFileURL } = require('node:url');
const root = path.resolve(__dirname,'..');
class Uri {
  constructor(value) { this.value=value; const url=new URL(value);this.scheme=url.protocol.slice(0,-1);this.path=decodeURIComponent(url.pathname); }
  toString() {return this.value;}
  get fsPath() {return this.scheme==='file'?fileURLToPath(this.value):this.path;}
  static parse(value) {return new Uri(value);}
  static file(value) {return new Uri(pathToFileURL(value).href);}
  static joinPath(base,...parts) {const url=new URL(base.value);url.pathname=path.posix.join(url.pathname,...parts);return new Uri(url.href);}
}
class Position {constructor(line,character){this.line=line;this.character=character;}}
class Range {constructor(start,end){this.start=start;this.end=end;}}
const docs=new Map(), commands=new Map(), providers=new Map();
const noop=()=>({dispose(){}});
class Document {
  constructor(uri,text,language){this.uri=uri;this.text=text;this.languageId=language;this.isDirty=false;this.isUntitled=uri.scheme==='untitled';}
  getText(){return this.text;}
  positionAt(offset){const lines=this.text.slice(0,offset).split('\n');return new Position(lines.length-1,lines.at(-1).length);}
  offsetAt(pos){const lines=this.text.split('\n');return lines.slice(0,pos.line).reduce((n,s)=>n+s.length+1,0)+pos.character;}
  async save(){if(this.isUntitled)return false;await fs.writeFile(this.uri.fsPath,this.text);this.isDirty=false;return true;}
}
class WorkspaceEdit {
  changes=[];
  replace(uri,range,text){this.changes.push({uri,range,text});}
  insert(uri,position,text){this.replace(uri,new Range(position,position),text);}
}
async function main(){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'eyepiece-headless-'));
 await fs.cp(path.join(root,'fixtures/rust'),folder,{recursive:true,filter:p=>!p.includes('/target')});
 const output={append(){},appendLine(line){if(line.includes('FAILED')||line.includes('passed'))console.log(line);},clear(){},show(){},dispose(){}};
 let sequence=0;
 const api={
  Uri,Position,Range,WorkspaceEdit,
  LanguageModelChatMessage:{User:content=>({role:1,content})},
  StatusBarAlignment:{Right:2},ViewColumn:{Beside:2},ProgressLocation:{Notification:15},
  CancellationError:class extends Error{},
  CancellationTokenSource:class {token={isCancellationRequested:false};cancel(){this.token.isCancellationRequested=true;}dispose(){}},
  window:{
   activeTextEditor:undefined,createOutputChannel:()=>output,createStatusBarItem:()=>({...output}),
   async showTextDocument(doc){
    const editor={document:doc,async edit(callback){const e=new WorkspaceEdit();callback({insert:(pos,text)=>e.insert(doc.uri,pos,text)});return api.workspace.applyEdit(e);}};
    this.activeTextEditor=editor;return editor;
   },
   async showQuickPick(){throw new Error('Unexpected interactive prompt');},
   async showWarningMessage(){throw new Error('Unexpected interactive confirmation');},
  },
  workspace:{
   isTrusted:true,workspaceFolders:[{uri:Uri.file(folder)}],
   getWorkspaceFolder(uri){return uri.fsPath.startsWith(folder+path.sep)?this.workspaceFolders[0]:undefined;},
   getConfiguration:()=>({get:key=>key==='provider'?'none':'python'}),onDidChangeConfiguration:noop,
   registerTextDocumentContentProvider(scheme,provider){providers.set(scheme,provider);return {dispose(){providers.delete(scheme);}};},
   fs:{
    async readFile(uri){return fs.readFile(uri.fsPath);},async writeFile(uri,data){return fs.writeFile(uri.fsPath,data);},
    async createDirectory(uri){return fs.mkdir(uri.fsPath,{recursive:true});},async stat(uri){return fs.stat(uri.fsPath);},
    async readDirectory(uri){return (await fs.readdir(uri.fsPath,{withFileTypes:true})).map(e=>[e.name,e.isDirectory()?2:1]);}
   },
   async openTextDocument(input){
    const uri=input instanceof Uri?input:Uri.parse(`untitled:/sample-${++sequence}`);
    if(docs.has(uri.toString()))return docs.get(uri.toString());
    const text=input instanceof Uri?(providers.has(uri.scheme)?providers.get(uri.scheme).provideTextDocumentContent(uri):await fs.readFile(uri.fsPath,'utf8')):input.content;
    const language=input.language??({'.rs':'rust','.py':'python','.md':'markdown'}[path.extname(uri.path)]??'plaintext');
    const doc=new Document(uri,text,language);docs.set(uri.toString(),doc);return doc;
   },
   async applyEdit(edit){
    for(const change of [...edit.changes].reverse()){
     const doc=await this.openTextDocument(change.uri),start=doc.offsetAt(change.range.start),end=doc.offsetAt(change.range.end);
     doc.text=doc.text.slice(0,start)+change.text+doc.text.slice(end);doc.isDirty=true;
    }
    return true;
   }
  },
  commands:{
   registerCommand(name,callback){commands.set(name,callback);return noop();},async getCommands(){return [...commands.keys()];},
   async executeCommand(name,...args){
    if(commands.has(name))return commands.get(name)(...args);
    if(name==='workbench.action.revertAndCloseActiveEditor'){api.window.activeTextEditor=undefined;return;}
    if(name==='vscode.diff'){
     const before=providers.get(args[0].scheme)?.provideTextDocumentContent(args[0]);
     const after=providers.get(args[1].scheme)?.provideTextDocumentContent(args[1]);
     if(typeof before!=='string'||typeof after!=='string'||before===after)throw new Error('Invalid diff');return;
    }
    throw new Error('Unsupported command '+name);
   }
  },
  extensions:{getExtension:()=>extension}
 };
 const extension={extensionPath:root,isActive:false,async activate(){require('../out/src/extension').activate({extensionUri:Uri.file(root),globalStorageUri:Uri.file(path.join(folder,'.storage')),subscriptions:[]});this.isActive=true;}};
 const original=Module._load;
 Module._load=function(id,...args){return id==='vscode'?api:original.call(this,id,...args);};
 try{await require('../out/test/host/index').run();console.log('HEADLESS API SIMULATION PASSED — real filesystem/Cargo, simulated VS Code; desktop acceptance still required.');}
 finally{Module._load=original;await fs.rm(folder,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
