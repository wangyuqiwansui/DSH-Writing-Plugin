import type { KnowledgeDataPort, KnowledgeSnapshot, KnowledgeTransaction } from '../../shared/knowledge-data.js'
import { canonicalJson, CONTRACT_VERSION, type JsonValue, type VersionRef } from '../../shared/contracts/index.js'
import { KB_PREFIX, KB_SCHEMA, KB_PARSER, type Corpus, type DocumentItem, type KbDocument, type Scope, type Chunk, type ModelReceipt } from './contracts.js'
import { digest } from './retrieval.js'
import { ensure } from './validation.js'
const json=(v:unknown)=>JSON.parse(canonicalJson(v)) as JsonValue
const latestKey=(id:string)=>KB_PREFIX+'document.'+id+'.latest'
const activeKey=(id:string)=>KB_PREFIX+'document.'+id+'.active'
export class CorpusStore {
  constructor(readonly data:KnowledgeDataPort){}
  check(scope:Scope) {ensure(scope.pluginInstanceId===this.data.instanceId(),'数据库实例已变化','DATABASE_CHANGED')}
  command<T>(scope:Scope,operationId:string,input:unknown,work:(tx:KnowledgeTransaction)=>T,signal?:AbortSignal):T {
    this.check(scope)
    return this.data.command({contractVersion:CONTRACT_VERSION,...scope,operationId,scope:{targetIds:[],referenceIds:[]},expectedVersions:[],input:json(input)},work,signal).result
  }
  private document(s:KnowledgeSnapshot,ref:VersionRef):KbDocument {
    const value=s.getVersion(ref)
    ensure(value.owner==='knowledge'&&ref.schemaVersion===KB_SCHEMA&&value.payload.format==='json','不是知识库文档','INVALID_SOURCE')
    const doc=value.payload.value as unknown as KbDocument
    ensure(doc.schemaVersion===KB_SCHEMA&&Array.isArray(doc.chunks),'文档结构损坏','INVALID_SOURCE')
    return doc
  }
  list(scope:Scope,signal?:AbortSignal):DocumentItem[] {
    this.check(scope)
    return this.data.snapshot(scope.projectId,s=>s.listHeads(KB_PREFIX+'document.').filter(h=>h.key.endsWith('.latest')).map(h=>({ref:h.ref,document:this.document(s,h.ref),decision:s.describeKnowledge(h.ref).decision?.decision??null,active:s.getHead(activeKey(this.document(s,h.ref).documentId))?.ref??null})),signal)
  }
  capture(scope:Scope,requested:VersionRef[],signal?:AbortSignal):Corpus {
    this.check(scope)
    return this.data.snapshot(scope.projectId,s=>{
      ensure(s.getProject(),'项目不存在','NOT_FOUND')
      const selected=requested.length?requested:s.listHeads(KB_PREFIX+'document.').filter(h=>h.key.endsWith('.active')).map(h=>h.ref).filter(ref=>s.describeKnowledge(ref).decision?.decision==='confirmed')
      ensure(selected.length<=100,'一次查询最多 100 份文档，请缩小范围','CORPUS_LIMIT')
      ensure(new Set(selected.map(r=>r.artifactId)).size===selected.length,'不能在一次查询混用同一文档的多个版本')
      const documents=selected.map(ref=>{
        ensure(ref.pluginInstanceId===scope.pluginInstanceId&&ref.projectId===scope.projectId,'来源超出本项目','FORBIDDEN')
        ensure(s.describeKnowledge(ref).decision?.decision==='confirmed','来源尚未确认或已撤销','SOURCE_INACTIVE')
        const document=this.document(s,ref),source=s.getVersion(document.sourceRef)
        ensure(source.payload.format==='text','原文格式损坏','INVALID_SOURCE')
        for(const dependency of [document.rawRef,document.sourceRef,document.wikiRef]) ensure(s.describeKnowledge(dependency).decision?.decision==='confirmed','依赖资料已撤销或未确认','SOURCE_INACTIVE')
        const bytes=Buffer.from(source.payload.text,'utf8')
        const spans=s.getKnowledgeSpans(document.sourceRef,KB_PARSER)
        for(const chunk of document.chunks) {
          ensure(digest(chunk.text)===chunk.hash&&bytes.subarray(chunk.startByte,chunk.endByte).toString('utf8')===chunk.text,'证据片段与原文不一致','CONTENT_CORRUPT')
          ensure(spans.some(p=>p.ordinal===chunk.ordinal&&p.locator.spanHash===chunk.hash&&p.locator.start===chunk.startByte&&p.locator.endExclusive===chunk.endByte),'证据定位未登记','CONTENT_CORRUPT')
        }
        return {ref,document}
      }).sort((a,b)=>a.ref.versionId.localeCompare(b.ref.versionId))
      ensure(documents.reduce((n,d)=>n+d.document.chunks.length,0)<=5000,'查询片段超过 5000，请缩小范围','CORPUS_LIMIT')
      return {scope,documents,digest:digest(canonicalJson(documents.map(d=>d.ref)))}
    },signal)
  }
  receipt(scope:Scope,operationId:string,signal?:AbortSignal) {
    this.check(scope);return this.data.snapshot(scope.projectId,s=>s.getCommandReceipt('knowledge','kb.finish.'+operationId)??s.getCommandReceipt('knowledge','kb.fail.'+operationId)??s.getCommandReceipt('knowledge','kb.start.'+operationId),signal)
  }
  begin(scope:Scope,operationId:string,input:unknown,signal:AbortSignal):{cached:JsonValue|null} {
    const inputHash=digest(canonicalJson(input));this.check(scope)
    const prior=this.data.snapshot(scope.projectId,s=>({start:s.getCommandReceipt('knowledge','kb.start.'+operationId),finish:s.getCommandReceipt('knowledge','kb.finish.'+operationId)}),signal)
    if(prior.start) {
      ensure((prior.start as {inputHash?:string}).inputHash===inputHash,'操作 ID 已用于不同输入','IDEMPOTENCY_CONFLICT')
      ensure(prior.finish,'操作已派发或失败，请核对回执；不自动重复模型调用','RUN_UNSETTLED')
      return {cached:prior.finish}
    }
    const reserved=this.data.command({contractVersion:CONTRACT_VERSION,...scope,operationId:'kb.start.'+operationId,scope:{targetIds:[],referenceIds:[]},expectedVersions:[],input:json(input)},tx=>{
      ensure(tx.getProject(),'项目不存在','NOT_FOUND')
      const ref=tx.appendArtifact({key:'kb-run-'+operationId,kind:'retrieval_trace',schemaVersion:'kb-run-v1',payload:{format:'json',value:json({operationId,inputHash,state:'started',input})}})
      tx.setHead(KB_PREFIX+'run.'+operationId,ref,0);return {state:'started',inputHash,ref}
    },signal)
    ensure(!reserved.replayed,'相同操作正在处理；请核对回执','RUN_UNSETTLED')
    return {cached:null}
  }
  fail(scope:Scope,operationId:string,error:unknown) {
    // Best-effort diagnostics never replace the original failure; an unrecorded run remains unsettled.
    try {this.command(scope,'kb.fail.'+operationId,{code:(error as {code?:string}).code??'FAILED'},tx=>{
      const head=tx.getHead(KB_PREFIX+'run.'+operationId);ensure(head,'运行不存在')
      const ref=tx.appendArtifact({key:'kb-run-'+operationId,kind:'retrieval_trace',schemaVersion:'kb-run-v1',payload:{format:'json',value:json({operationId,state:'failed_or_unknown',code:(error as {code?:string}).code??'FAILED'})},sources:[{ref:head.ref,relation:'revises'}]})
      tx.setHead(KB_PREFIX+'run.'+operationId,ref,head.revision);return {state:'failed_or_unknown',ref}
    })}catch{/* Keep the original error and durable start receipt. */}
  }
  finish<T>(scope:Scope,operationId:string,input:unknown,work:(tx:KnowledgeTransaction)=>T,signal:AbortSignal):T {
    return this.command(scope,'kb.finish.'+operationId,input,work,signal)
  }
  saveDocument(scope:Scope,operationId:string,input:{documentId:string;expectedRevision:number;title:string;text:string},chunks:Chunk[],analysis:ModelReceipt[],signal:AbortSignal):{ref:VersionRef} {
    return this.finish(scope,operationId,input,tx=>{
      const head=tx.getHead(latestKey(input.documentId));ensure((head?.revision??0)===input.expectedRevision,'资料已更新，请重新读取','REVISION_CONFLICT')
      const rawRef=tx.appendArtifact({key:'kb-raw-'+input.documentId,kind:'knowledge_source',schemaVersion:'kb-raw-v1',payload:{format:'text',text:input.text},metadata:{title:input.title}})
      const sourceRef=tx.appendArtifact({key:'kb-text-'+input.documentId,kind:'source_text',schemaVersion:'kb-text-v1',payload:{format:'text',text:input.text},metadata:{title:input.title},sources:[{ref:rawRef,relation:'derived_from'}]})
      for(const c of chunks) tx.putKnowledgeSpan({sourceRef,parserVersion:KB_PARSER,ordinal:c.ordinal,locator:{format:'utf8-byte-span-v1',start:c.startByte,endExclusive:c.endByte,spanHash:c.hash}})
      const wiki={title:input.title,summary:chunks[0]?.summary??'',markdown:chunks.map(c=>`## ${c.title}\n\n${c.summary}`).join('\n\n'),claims:chunks.map(c=>({id:c.id,statement:c.summary,namespace:'reference',factStatus:'candidate',supportBundleIds:[c.id]})),supportBundles:chunks.map(c=>({id:c.id,supports:[{sourceRef,role:'supports',parserVersion:KB_PARSER,locator:{format:'utf8-byte-span-v1',start:c.startByte,endExclusive:c.endByte,spanHash:c.hash}}]})),sourceRefs:[sourceRef,rawRef],links:[],policyVersion:'kb-author-review-v1',compilerProfileVersion:'kb-ingest-v1',coverage:{chunks:chunks.length},conflicts:[]}
      const wikiRef=tx.appendArtifact({key:'kb-wiki-'+input.documentId,kind:'wiki_page',schemaVersion:'wiki-page-v1',payload:{format:'json',value:json(wiki)},metadata:{title:input.title},sources:[{ref:sourceRef,relation:'derived_from'},{ref:rawRef,relation:'source'}]})
      const document:KbDocument={schemaVersion:KB_SCHEMA,documentId:input.documentId,title:input.title,sourceRef,rawRef,wikiRef,chunks,analysis,parserVersion:KB_PARSER}
      const ref=tx.appendArtifact({key:'kb-document-'+input.documentId,kind:'knowledge_import_manifest',schemaVersion:KB_SCHEMA,payload:{format:'json',value:json(document)},sources:[{ref:sourceRef,relation:'source'},{ref:wikiRef,relation:'compiled'},{ref:rawRef,relation:'original'}]})
      tx.setHead(latestKey(input.documentId),ref,head?.revision??0)
      tx.emit(KB_PREFIX+'ingested',{ref:json(ref)});return {ref}
    },signal)
  }
  decide(scope:Scope,operationId:string,ref:VersionRef,decision:'confirmed'|'revoked',signal:AbortSignal) {
    return this.command(scope,'kb.decide.'+operationId,{ref,decision},tx=>{
      const doc=this.document(tx,ref);ensure(ref.pluginInstanceId===scope.pluginInstanceId&&ref.projectId===scope.projectId,'来源越界','FORBIDDEN')
      if(decision==='confirmed') {ensure(tx.getHead(latestKey(doc.documentId))?.ref.versionId===ref.versionId,'只能确认最新候选','REVISION_CONFLICT');ensure(tx.describeKnowledge(ref).decision?.decision!=='revoked','撤销版本不能重新确认，请新建版本','SOURCE_INACTIVE')}
      for(const source of [ref,doc.rawRef,doc.sourceRef,doc.wikiRef])tx.decide(source,decision,'author','知识库作者审阅')
      if(decision==='confirmed')tx.setHead(activeKey(doc.documentId),ref,tx.getHead(activeKey(doc.documentId))?.revision??0)
      tx.emit(KB_PREFIX+decision,{ref:json(ref)});return {ref}
    },signal)
  }
}
export { json }
