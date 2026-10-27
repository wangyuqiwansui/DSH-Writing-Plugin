import type { KnowledgeReader } from '../knowledge-core/service.js'
import { evidence } from '../knowledge-core/retrieval.js'
import { parseQuery } from './validation.js'
import type { KnowledgeQuery, KnowledgeResponse } from './contracts.js'
/** All translation lives here. Consumers never receive core traces or database records. */
export class KnowledgeQueryService {
  constructor(private readonly reader:KnowledgeReader){}
  async invoke(raw:KnowledgeQuery,signal:AbortSignal):Promise<KnowledgeResponse>{
    const q=parseQuery(raw),policy=this.reader.policy(q,q.sources,signal),input={pluginInstanceId:q.pluginInstanceId,projectId:q.projectId,question:q.question,documents:q.sources,topK:q.limit,maxCharacters:q.maxCharacters,representation:policy.representation}
    const run=q.action==='answer'?await this.reader.answer(input,q.operationId,policy.format,signal):null
    const retrieval=run?.retrieval??this.reader.search(input,signal),items=run?.evidence??retrieval.hits.map(evidence)
    signal.throwIfAborted()
    return {schemaVersion:'knowledge-response-v1',status:run?.answer.status??(items.length?'retrieved':'insufficient'),answer:run?run.answer.claims.map(c=>c.text).join('\n'):null,statements:run?.answer.claims??[],evidence:items.map(e=>({id:e.id,title:e.title,text:e.text,source:e.sourceRef,locator:e.locator})),missing:run?.answer.missing??(items.length?[]:['未找到匹配的已确认资料']),warnings:[...(retrieval.omitted?['部分候选未进入材料预算']:[]),'证据定位已校验；语义支持与创作适用性仍需审阅'],provenance:{corpusDigest:retrieval.corpus.digest,sourceVersions:retrieval.corpus.documents.map(d=>d.ref),trace:run?.traceRef??null}}
  }
}
