import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../../../infrastructure/middleware/host.js'
import type { WikiBrowseRequest, WikiReadRequest } from '../contracts/index.js'
import { WikiReader } from './service.js'

declare module '@deepseek-ai/cordis' { interface Context { writingWiki: WikiRemoteService } }
export class WikiRemoteService extends TypertRemoteService {
  private readonly reader: WikiReader
  constructor(ctx: Context) { super(ctx, 'writingWiki'); this.reader = new WikiReader(ctx.writingMiddleware.data('wiki')) }
  @Remote
  overview(signal: AbortSignal) { return this.ctx.writingMiddleware.request('wiki', 'overview', this.ctx.invocation?.peer.principal.kind, s => this.reader.overview(s), signal) }
  @Remote
  browse(request: WikiBrowseRequest, signal: AbortSignal) { return this.ctx.writingMiddleware.request('wiki', 'browse', this.ctx.invocation?.peer.principal.kind, s => this.reader.browse(request, s), signal) }
  @Remote
  read(request: WikiReadRequest, signal: AbortSignal) { return this.ctx.writingMiddleware.request('wiki', 'read', this.ctx.invocation?.peer.principal.kind, s => this.reader.read(request, s), signal) }
}
