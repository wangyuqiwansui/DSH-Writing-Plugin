import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../../infrastructure/middleware/host.js'
import { KnowledgeKernel } from './service.js'
import { knowledgeModel } from './model-adapter.js'
import type { ManagementRequest } from './contracts.js'
import { KnowledgeQueryService } from '../knowledge-query/service.js'
import type { KnowledgeQuery } from '../knowledge-query/contracts.js'
class KnowledgeRemote extends TypertRemoteService {
  constructor(ctx:Context,private readonly kernel:KnowledgeKernel){super(ctx,'writingKnowledge')}
  @Remote async invoke(request:ManagementRequest,signal:AbortSignal){return this.ctx.writingMiddleware.request('knowledge','invoke',this.ctx.invocation?.peer.principal.kind,s=>this.kernel.invoke(request,s),signal)}
}
class QueryRemote extends TypertRemoteService {
  constructor(ctx:Context,private readonly query:KnowledgeQueryService){super(ctx,'writingKnowledgeQuery')}
  @Remote async invoke(request:KnowledgeQuery,signal:AbortSignal){return this.ctx.writingMiddleware.request('knowledge-query','invoke',this.ctx.invocation?.peer.principal.kind,s=>this.query.invoke(request,s),signal)}
}
export function mountKnowledge(ctx:Context){ctx.inject(['typert','writingMiddleware'],child=>{
  const kernel=new KnowledgeKernel(child.writingMiddleware.data('knowledge'),knowledgeModel(child))
  const query=new KnowledgeQueryService({policy:kernel.policy.bind(kernel),search:kernel.search.bind(kernel),answer:kernel.answer.bind(kernel)})
  new KnowledgeRemote(child,kernel);new QueryRemote(child,query);child.effect(()=>()=>kernel.dispose())
})}
