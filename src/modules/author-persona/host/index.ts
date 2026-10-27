import { Service, type Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '../../../infrastructure/middleware/host.js'
import type { PersonaApi, PersonaRequest } from '../contracts/index.js'
import { PersonaService } from '../application/service.js'

export const name = 'writing-author-persona'
export const inject = ['writingMiddleware']
export const Config = { '~standard': { version: 1 as const, vendor: name, validate(value: unknown) {
  if (value === undefined) value = {}
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0 ? { value: {} } : { issues: [{ message: '作者人格模块不接受额外配置' }] }
} } }
/** Host consumers depend on PersonaApi; remote requests additionally pass the owner gate. */
class WritingAuthorPersona extends Service implements PersonaApi {
  private readonly application: PersonaService
  constructor(ctx: Context) { super(ctx, 'writingAuthorPersona'); this.application = new PersonaService(ctx.writingMiddleware.data('author-persona')) }
  invoke(request: PersonaRequest, signal?: AbortSignal) {
    return this.ctx.writingMiddleware.task('author-persona', 'invoke', s => this.application.invoke(request, s), signal)
  }
}
class PersonaRemoteService extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'writingAuthorPersonaRemote') }
  @Remote
  invoke(request: PersonaRequest, signal: AbortSignal) {
    return this.ctx.writingMiddleware.request('author-persona', 'invoke', this.ctx.invocation?.peer.principal.kind, s => this.ctx.writingAuthorPersona.invoke(request, s), signal)
  }
}
export function apply(ctx: Context, _config: Record<string, never> = {}): void {
  new WritingAuthorPersona(ctx)
  ctx.inject(['typert', 'writingAuthorPersona'], child => { new PersonaRemoteService(child) })
}
