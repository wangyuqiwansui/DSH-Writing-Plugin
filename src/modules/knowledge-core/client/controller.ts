import type { DocumentItem, ManagementBackend, Overview } from '../contracts.js'
import type { KnowledgeQuery, KnowledgeResponse, QueryBackend } from '../../knowledge-query/contracts.js'
import type { VersionRef } from '../../../shared/contracts/index.js'
interface State { connected:boolean; busy:boolean; error:string|null; message:string|null; overview:Overview|null; projectId:string; documents:DocumentItem[]; response:KnowledgeResponse|null; operationId:string|null }
export class KnowledgeController {
  private backend:ManagementBackend|null=null
  private queryBackend:QueryBackend|null=null
  private active:AbortController|null=null
  private disposed=false
  private listeners=new Set<()=>void>()
  private state:State={connected:false,busy:false,error:null,message:null,overview:null,projectId:'',documents:[],response:null,operationId:null}
  getSnapshot=()=>this.state
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
  private update(patch:Partial<State>){if(this.disposed)return;this.state={...this.state,...patch};this.listeners.forEach(l=>l())}
  private async run<T>(work:(signal:AbortSignal)=>Promise<T>,done:(value:T)=>void){
    if(this.disposed||this.state.busy||!this.backend)return false
    const active=new AbortController();this.active=active;this.update({busy:true,error:null,message:null})
    const timer=setTimeout(()=>active.abort(new Error('请求超时，请核对操作回执')),30*60*1000)
    let stop=()=>{}
    try{const cancelled=new Promise<never>((_,reject)=>{stop=()=>reject(active.signal.reason);active.signal.addEventListener('abort',stop,{once:true})});const result=await Promise.race([work(active.signal),cancelled]);active.signal.throwIfAborted();if(this.active!==active)return false;done(result);return true}
    catch(e){if(this.active===active)this.update({error:(e as Error).message??'请求失败；输入保留，请核对回执'});return false}
    finally{clearTimeout(timer);active.signal.removeEventListener('abort',stop);if(this.active===active){this.active=null;this.update({busy:false})}}
  }
  attach(backend:ManagementBackend,query:QueryBackend){this.disconnect();this.backend=backend;this.queryBackend=query;this.update({connected:true,error:null});void this.refresh();return()=>{if(this.backend===backend)this.disconnect()}}
  disconnect=()=>{this.active?.abort(new Error('连接已断开'));this.active=null;this.backend=null;this.queryBackend=null;this.update({connected:false,busy:false,overview:null,documents:[],response:null})}
  reset=()=>{this.active?.abort(new Error('数据库或连接已变化'));this.active=null;this.update({busy:false,overview:null,projectId:'',documents:[],response:null,operationId:null});void this.refresh()}
  refresh=async()=>{await this.run(s=>this.backend!.invoke({action:'overview'},s),value=>{const overview=value as Overview;this.update({overview});if(!overview.projects.some(p=>p.id===this.state.projectId))this.update({projectId:overview.projects[0]?.id??'',documents:[],response:null})});if(this.state.projectId)await this.load()}
  setProject=async(projectId:string)=>{this.active?.abort();this.active=null;this.update({projectId,busy:false,documents:[],response:null,error:null,operationId:null});await this.load()}
  private scope(){if(!this.state.overview?.pluginInstanceId||!this.state.projectId)throw new Error('请选择已连接的项目');return {pluginInstanceId:this.state.overview.pluginInstanceId,projectId:this.state.projectId}}
  load=async()=>{await this.run(s=>this.backend!.invoke({action:'list',...this.scope()},s),value=>this.update({documents:value as DocumentItem[]}))}
  create=async(title:string)=>{const operationId=crypto.randomUUID();this.update({operationId});const ok=await this.run(s=>this.backend!.invoke({action:'create',pluginInstanceId:this.state.overview!.pluginInstanceId!,operationId,title},s),value=>this.update({projectId:(value as {projectId:string}).projectId}));if(ok)await this.refresh()}
  ingest=async(title:string,text:string)=>{const operationId=crypto.randomUUID();this.update({operationId});const ok=await this.run(s=>this.backend!.invoke({action:'ingest',...this.scope(),operationId,documentId:crypto.randomUUID(),expectedRevision:0,title,text},s),()=>this.update({message:'资料已整理并保存为候选。审阅后确认即可参与查询。',response:null}));if(ok)await this.load();return ok}
  decide=async(ref:VersionRef,decision:'confirmed'|'revoked')=>{const operationId=crypto.randomUUID();this.update({operationId});const ok=await this.run(s=>this.backend!.invoke({action:'decide',...this.scope(),operationId,ref,decision},s),()=>this.update({response:null}));if(ok)await this.load()}
  query=async(question:string,action:KnowledgeQuery['action'])=>{const operationId=crypto.randomUUID();this.update({operationId:action==='answer'?operationId:null,response:null});await this.run(s=>this.queryBackend!.invoke({schemaVersion:'knowledge-query-v1',action,...this.scope(),operationId,question,sources:[],limit:5,maxCharacters:12000},s),response=>this.update({response}))}
  receipt=async()=>{if(!this.state.operationId)return;await this.run(s=>this.backend!.invoke({action:'receipt',...this.scope(),operationId:this.state.operationId!},s),value=>this.update({message:!value?'未找到入库/问答回执':('state' in (value as object))?`操作状态：${(value as {state:string}).state}；不会自动重复模型调用。`:'操作结果已持久保存，可刷新资料核对结果。'}))}
  reportError=(error:string)=>this.update({error})
  cancel=()=>this.active?.abort(new Error('已取消等待；已提交结果不会撤销，可核对操作回执'))
  dispose(){this.disconnect();this.disposed=true;this.listeners.clear()}
}
