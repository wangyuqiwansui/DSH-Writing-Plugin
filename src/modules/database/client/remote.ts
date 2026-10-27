import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { databaseRemote } from '../contracts/management.js'
import type { DatabaseController } from './controller.js'

async function value<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const reply = await result
  if (!reply.ok) throw reply.error
  return reply.value
}
export function connectDatabase(ctx: Context, controller: DatabaseController): void {
  ctx.inject(['remote'], async child => {
    await child.remote.$mount(databaseRemote)
    child.effect(() => controller.attach({
      read: signal => value(child.remote.writingDatabase.read(signal)),
      inspect: (path, signal) => value(child.remote.writingDatabase.inspect(path, signal)),
      save: (request, signal) => value(child.remote.writingDatabase.save(request, signal)),
    }))
    child.on('connection/reset', () => { void controller.refresh() })
    const connection = child.get('connection')
    if (connection) child.effect(() => connection.state.subscribe(() => {
      if (connection.state.getSnapshot() === 'disconnected') controller.transportLost()
    }))
  })
}
