import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../../../infrastructure/middleware/host.js'
import type { WorldRequest } from '../contracts/index.js'
import { WorldService } from '../application/service.js'

declare module '@deepseek-ai/cordis' { interface Context { writingWorld: WorldRemoteService } }
export class WorldRemoteService extends TypertRemoteService {
  private readonly service: WorldService
  constructor(ctx: Context) { super(ctx, 'writingWorld'); this.service = new WorldService(ctx.writingMiddleware.data('worldbuilding')) }
  @Remote
  invoke(request: WorldRequest, signal: AbortSignal) {
    return this.ctx.writingMiddleware.request('worldbuilding', 'invoke', this.ctx.invocation?.peer.principal.kind, s => this.service.invoke(request, s), signal)
  }
}
