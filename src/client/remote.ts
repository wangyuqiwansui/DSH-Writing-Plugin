import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { workbenchRemote } from '../shared/remote.js'
import type { WorkbenchController } from './model.js'

async function value<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const reply = await result
  if (!reply.ok) throw reply.error
  return reply.value
}
export function connectWorkbench(ctx: Context, controller: WorkbenchController) {
  ctx.inject(['remote'], async child => {
    await child.remote.$mount(workbenchRemote)
    child.inject(['remote.writingKnowledge','remote.writingKnowledgeQuery'], scoped => {
      const attach=()=>controller.knowledge.attach({invoke:(request,signal)=>value(scoped.remote.writingKnowledge.invoke(request,signal))},{invoke:(request,signal)=>value(scoped.remote.writingKnowledgeQuery.invoke(request,signal))})
      let detach=attach();scoped.effect(()=>()=>detach())
      scoped.on('connection/reset',()=>{detach();detach=attach()})
      let identity:string|null=null
      scoped.effect(()=>controller.database.subscribe(()=>{const current=controller.database.getSnapshot().current;if(!current)return;const next=`${current.databasePath}:${current.inspection.instanceId}`;if(identity!==null&&identity!==next)controller.knowledge.reset();identity=next}))
      const connection=scoped.get('connection');if(connection)scoped.effect(()=>connection.state.subscribe(()=>{if(connection.state.getSnapshot()==='disconnected')controller.knowledge.disconnect()}))
    })
    child.inject(['remote.writingAuthorPersonaRemote'], scoped => {
      scoped.effect(() => controller.persona.attach({ invoke: (request, signal) => value(scoped.remote.writingAuthorPersonaRemote.invoke(request, signal)) }))
      scoped.on('connection/reset', () => { void controller.persona.refresh() })
      let databaseIdentity: string | null = null
      scoped.effect(() => controller.database.subscribe(() => {
        const current = controller.database.getSnapshot().current
        if (!current) return
        const next = `${current.databasePath}:${current.inspection.instanceId}`
        if (databaseIdentity !== null && databaseIdentity !== next) void controller.persona.refresh()
        databaseIdentity = next
      }))
      const connection = scoped.get('connection')
      if (connection) scoped.effect(() => connection.state.subscribe(() => {
        if (connection.state.getSnapshot() === 'disconnected') controller.persona.transportLost()
      }))
    })
    child.inject(['remote.writingChat'], scoped => {
      const attach = () => controller.chat.attach({ async *stream(request, signal) {
        const handle = scoped.remote.writingChat.stream(request, signal)
        try { yield* handle } finally { handle.dispose() }
      } })
      let detach = attach()
      scoped.effect(() => () => detach())
      scoped.on('connection/reset', () => { detach(); detach = attach() })
      const connection = scoped.get('connection')
      if (connection) scoped.effect(() => connection.state.subscribe(() => {
        if (connection.state.getSnapshot() === 'disconnected') controller.chat.transportLost()
      }))
    })
    child.inject(['remote.writingWorld'], scoped => {
      scoped.effect(() => {
        const backend = { invoke: (request: import('../modules/worldbuilding/contracts/index.js').WorldRequest, signal: AbortSignal) => value(scoped.remote.writingWorld.invoke(request, signal)) }
        const detachWorld = controller.world.attach(backend), detachQuery = controller.novel.worldContext.attach(backend)
        return () => { detachQuery(); detachWorld() }
      })
      scoped.on('connection/reset', () => { void controller.world.refresh(); controller.novel.worldContext.connected() })
      let databaseIdentity: string | null = null
      scoped.effect(() => controller.database.subscribe(() => {
        const current = controller.database.getSnapshot().current
        if (!current) return
        const next = `${current.databasePath}:${current.inspection.instanceId}`
        if (databaseIdentity !== null && databaseIdentity !== next) { void controller.world.refresh(); controller.novel.worldContext.invalidate() }
        databaseIdentity = next
      }))
      const connection = scoped.get('connection')
      if (connection) scoped.effect(() => connection.state.subscribe(() => {
        if (connection.state.getSnapshot() === 'disconnected') { controller.world.transportLost(); controller.novel.worldContext.transportLost() }
      }))
    })
    child.inject(['remote.writingQualityRemote'], scoped => {
      scoped.effect(() => controller.quality.attach({ invoke: (request, signal) => value(scoped.remote.writingQualityRemote.invoke(request, signal)) }))
      scoped.on('connection/reset', () => { void controller.quality.refresh() })
      let databaseIdentity: string | null = null
      scoped.effect(() => controller.database.subscribe(() => {
        const current = controller.database.getSnapshot().current
        if (!current) return
        const next = `${current.databasePath}:${current.inspection.instanceId}`
        if (databaseIdentity !== null && databaseIdentity !== next) void controller.quality.refresh()
        databaseIdentity = next
      }))
      const connection = scoped.get('connection')
      if (connection) scoped.effect(() => connection.state.subscribe(() => {
        if (connection.state.getSnapshot() === 'disconnected') controller.quality.transportLost()
      }))
    })
    // Each generated namespace is a separately traced Cordis service.
    child.inject(['remote.writingModels', 'remote.writingDatabase', 'remote.writingWiki'], scoped => {
      const attachModels = () => controller.attachModels({ read: signal => value(scoped.remote.writingModels.read(signal)), save: (request, signal) => value(scoped.remote.writingModels.save(request, signal)) })
      scoped.effect(() => { attachModels(); return () => controller.attachModels() })
      scoped.on('connection/reset', attachModels)
      scoped.effect(() => controller.database.attach({
        read: signal => value(scoped.remote.writingDatabase.read(signal)),
        inspect: (path, signal) => value(scoped.remote.writingDatabase.inspect(path, signal)),
        save: (request, signal) => value(scoped.remote.writingDatabase.save(request, signal)),
      }))
      scoped.effect(() => controller.wiki.attach({
        overview: signal => value(scoped.remote.writingWiki.overview(signal)),
        browse: (request, signal) => value(scoped.remote.writingWiki.browse(request, signal)),
        read: (request, signal) => value(scoped.remote.writingWiki.read(request, signal)),
      }))
      scoped.on('connection/reset', () => { void controller.database.refresh(); void controller.wiki.refresh() })
      // A saved database switch invalidates all Wiki state, even if the Client connection stays alive.
      let identity: string | null = null
      scoped.effect(() => controller.database.subscribe(() => {
        const current = controller.database.getSnapshot().current
        if (!current) return
        const next = `${current.databasePath}:${current.inspection.instanceId}`
        if (identity !== null && identity !== next) void controller.wiki.refresh()
        identity = next
      }))
      const connection = scoped.get('connection')
      if (connection) scoped.effect(() => connection.state.subscribe(() => {
        if (connection.state.getSnapshot() === 'disconnected') { controller.attachModels(); controller.database.transportLost(); controller.wiki.transportLost() }
      }))
    })
  })
}
