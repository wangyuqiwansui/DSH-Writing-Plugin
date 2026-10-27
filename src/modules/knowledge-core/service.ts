import type { KnowledgeDataPort } from '../../shared/knowledge-data.js'
import { canonicalJson, type VersionRef } from '../../shared/contracts/index.js'
import { CorpusStore, json } from './corpus.js'
import { answerPacket, enrich, ingestPacket, parseAnswer } from './model-codecs.js'
import { chunkText, evidence, retrieve } from './retrieval.js'
import { ensure, managementInput, queryInput } from './validation.js'
import type { AnswerRun, Scope, Representation, Corpus, ManagementRequest, ModelReceipt, ModelPort, PacketFormat, QueryInput, Retrieval } from './contracts.js'

/** Core owns ingestion, retrieval and model execution, never the public query DTO or UI. */
export class KnowledgeKernel {
  readonly store:CorpusStore
  private readonly active=new Set<AbortController>()
  private closed=false
  constructor(data:KnowledgeDataPort,private readonly model:ModelPort,private readonly timeoutMs=120000){this.store=new CorpusStore(data)}
  dispose(){this.closed=true;for(const c of this.active)c.abort(new Error('知识库服务已卸载'));this.active.clear()}
  private async bounded<T>(signal:AbortSignal,work:(signal:AbortSignal)=>Promise<T>,timeoutMs=this.timeoutMs):Promise<T>{
    ensure(!this.closed,'知识库服务已卸载','UNAVAILABLE');ensure(this.active.size<2,'知识库正在处理其他任务，请稍后重试','BUSY')
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error('模型或知识库任务超时；请核对操作回执')),timeoutMs)
    const combined=AbortSignal.any([signal,controller.signal]);this.active.add(controller)
    let stop=()=>{}
    try{combined.throwIfAborted();const cancelled=new Promise<never>((_,reject)=>{stop=()=>reject(combined.reason);combined.addEventListener('abort',stop,{once:true})});return await Promise.race([work(combined),cancelled])}
    finally{clearTimeout(timer);combined.removeEventListener('abort',stop);this.active.delete(controller)}
  }
  policy(scope:Scope,documents:VersionRef[],signal?:AbortSignal):{representation:Representation;format:PacketFormat} {
    ensure(!this.closed,'知识库服务已卸载','UNAVAILABLE')
    this.store.capture(scope,documents,signal)
    // Evaluation recommendations never change runtime policy or database state.
    return {representation:'enriched',format:'json'}
  }
  search(raw:QueryInput,signal?:AbortSignal):Retrieval{
    ensure(!this.closed,'知识库服务已卸载','UNAVAILABLE');const input=queryInput(raw),corpus=this.store.capture(input,input.documents,signal)
    return retrieve(corpus,input)
  }
  async answer(raw:QueryInput,operationId:string,format:PacketFormat,signal:AbortSignal):Promise<AnswerRun>{
    const input=queryInput(raw)
    return this.bounded(signal,async signal=>{
      const runInput={kind:'answer',input,format},prior=this.store.begin(input,operationId,runInput,signal)
      if(prior.cached){const cached=prior.cached as unknown as AnswerRun;this.assertFresh(cached.retrieval.corpus,signal);return cached}
      try{
        const retrieval=this.search(input,signal),items=retrieval.hits.map(evidence)
        const packet=answerPacket(input.question,items,format)
        const receipt=items.length?await this.model.complete(packet,signal):null
        signal.throwIfAborted()
        const answer=receipt?parseAnswer(receipt.output,items):{status:'insufficient' as const,claims:[],missing:['没有匹配的已确认资料']}
        this.assertFresh(retrieval.corpus,signal)
        return this.store.finish(input,operationId,runInput,tx=>{
          // Revalidate within the write transaction to close a revocation/commit race.
          for(const d of retrieval.corpus.documents)for(const ref of [d.ref,d.document.rawRef,d.document.sourceRef,d.document.wikiRef])ensure(tx.describeKnowledge(ref).decision?.decision==='confirmed','来源已失效','SOURCE_INACTIVE')
          const traceRef=tx.appendArtifact({key:'kb-answer-'+operationId,kind:'retrieval_trace',schemaVersion:'kb-answer-trace-v1',payload:{format:'json',value:json({input,format,corpusDigest:retrieval.corpus.digest,packet,receipt,answer,evidence:items,ranking:retrieval.hits.map(h=>({id:h.id,score:h.score,rank:h.rank}))})},sources:retrieval.corpus.documents.map(d=>({ref:d.ref,relation:'used'}))})
          return {retrieval,evidence:items,answer,receipt,traceRef,format}
        },signal)
      }catch(error){this.store.fail(input,operationId,error);throw error}
    })
  }
  assertFresh(corpus:Corpus,signal:AbortSignal){const current=this.store.capture(corpus.scope,corpus.documents.map(d=>d.ref),signal);ensure(current.digest===corpus.digest,'来源快照已变化','SOURCE_CHANGED')}
  async invoke(raw:ManagementRequest,signal:AbortSignal){
    ensure(!this.closed,'知识库服务已卸载','UNAVAILABLE')
    const request=managementInput(raw)
    if(request.action==='overview'){const status=this.store.data.status(signal);return {ready:status.databaseReady,message:status.message,pluginInstanceId:status.databaseReady?this.store.data.instanceId():null,projects:status.databaseReady?this.store.data.listProjects(signal):[]}}
    if(request.action==='create'){ensure(request.pluginInstanceId===this.store.data.instanceId(),'数据库实例已变化','DATABASE_CHANGED');return this.store.data.createProject(request.pluginInstanceId,request.operationId,request.title,signal)}
    this.store.check(request)
    if(request.action==='list')return this.store.list(request,signal)
    if(request.action==='decide')return this.store.decide(request,request.operationId,request.ref,request.decision,signal)
    if(request.action==='receipt')return this.store.receipt(request,request.operationId,signal)
    const chunks=chunkText(request.text)
    return this.bounded(signal,async signal=>{
      const prior=this.store.begin(request,request.operationId,request,signal)
      if(prior.cached)return prior.cached
      try{
        const before=this.store.list(request,signal).find(d=>d.document.documentId===request.documentId)
        ensure((before?.ref.revision??0)===request.expectedRevision,'资料已更新，请重新读取','REVISION_CONFLICT')
        const receipts:ModelReceipt[]=[],enriched:typeof chunks=[]
        for(let start=0;start<chunks.length;start+=8){
          const batch=chunks.slice(start,start+8),packet=ingestPacket(request.title,batch)
          const batchSignal=AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)])
          const receipt=await this.model.complete(packet,batchSignal);batchSignal.throwIfAborted()
          ensure(!receipts.length||canonicalJson(receipts[0]!.config)===canonicalJson(receipt.config),'整理期间模型配置变化，请重新运行','MODEL_CHANGED')
          receipts.push(receipt);enriched.push(...enrich(batch,receipt.output))
        }
        return this.store.saveDocument(request,request.operationId,request,enriched,receipts,signal)
      }catch(error){this.store.fail(request,request.operationId,error);throw error}
    },this.timeoutMs*Math.ceil(chunks.length/8))
  }
}
/** Query adapter receives only this port; no ingest, approval, storage or model capabilities. */
export interface KnowledgeReader {
  policy(scope:Scope,documents:VersionRef[],signal?:AbortSignal):{representation:Representation;format:PacketFormat}
  search(input:QueryInput,signal?:AbortSignal):Retrieval
  answer(input:QueryInput,operationId:string,format:PacketFormat,signal:AbortSignal):Promise<AnswerRun>
}
