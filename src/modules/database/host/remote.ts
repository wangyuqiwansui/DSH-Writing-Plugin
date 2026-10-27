import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { DatabaseConfig } from '../contracts/index.js'
import { type SaveDatabaseRequest } from '../contracts/management.js'
import { DatabaseManagement, type ConfigurationPort } from './management.js'
import type {} from '../../../infrastructure/middleware/host.js'

declare module '@deepseek-ai/cordis' { interface Context { writingDatabase: DatabaseRemoteService } }

export class DatabaseRemoteService extends TypertRemoteService {
  constructor(ctx: Context, readonly management: DatabaseManagement) { super(ctx, 'writingDatabase') }
  @Remote
  read(signal: AbortSignal) { return this.ctx.writingMiddleware.request('database', 'read', this.ctx.invocation?.peer.principal.kind, s => this.management.read(s), signal) }
  @Remote
  inspect(databasePath: string, signal: AbortSignal) { return this.ctx.writingMiddleware.request('database', 'inspect', this.ctx.invocation?.peer.principal.kind, s => this.management.inspect(databasePath, s), signal) }
  @Remote
  save(request: SaveDatabaseRequest, signal: AbortSignal) { return this.ctx.writingMiddleware.request('database', 'save', this.ctx.invocation?.peer.principal.kind, s => this.management.save(request, s), signal) }
}

/** Optional bridge: storage remains usable in a headless composition without Typert. */
export function mountDatabaseRemote(ctx: Context, config: DatabaseConfig): void {
  const owner: Fiber = ctx.fiber
  ctx.inject(['typert', 'writingMiddleware'], child => {
    const entry = () => child.get('configEditor')?.entries().find(item => item.fiber === owner)
    const port: ConfigurationPort = {
      available: () => entry() !== undefined,
      current: () => entry()?.options.config as Record<string, unknown> ?? { ...config },
      edit: async change => {
        const editor = child.get('configEditor')
        const target = entry()
        if (!editor || !target) throw new RemoteError('writing-database/unavailable', '插件配置入口已失效，请刷新后重试。', {})
        await editor.edit(target, current => change(current))
      },
    }
    new DatabaseRemoteService(child, new DatabaseManagement(config, port, child.writingMiddleware.data('database')))
  })
}
