import { mountKnowledge } from './modules/knowledge-core/host.js'
import { mountModels } from './modules/models/host.js'
import { parseSelection, type Selection } from './modules/models/contracts.js'
import type { Context } from '@deepseek-ai/cordis'
import * as database from './modules/database/host/index.js'
import type { DatabaseConfig } from './modules/database/contracts/index.js'
import { mountDatabaseRemote } from './modules/database/host/remote.js'
import { WikiRemoteService } from './modules/wiki/host/remote.js'
import { WorldRemoteService } from './modules/worldbuilding/host/remote.js'
import { workbenchRemote } from './shared/remote.js'
import * as quality from './modules/quality/host.js'
import type { QualityConfig } from './modules/quality/service.js'
import * as chat from './modules/chat/host.js'
import type { ChatConfig } from './modules/chat/service.js'
import * as authorPersona from './modules/author-persona/host/index.js'

/** Host composition. Browser code stays in the separately registered client module. */
export const name = 'writing-workbench'
export const Config = { '~standard': { version: 1 as const, vendor: 'writing', validate(value: unknown) {
 const v = value as Record<string, unknown>
 if (!v || typeof v !== 'object') return { issues: [{ message: 'Invalid config' }] }
 const { defaultModel, quality: qualityConfig, chat: chatConfig, authorPersona: personaConfig, ...rest } = v
 const result = database.Config['~standard'].validate(rest)
 if ('issues' in result) return result
 const qualityResult = qualityConfig === false ? { value: false as const } : quality.Config['~standard'].validate(qualityConfig ?? {})
 if ('issues' in qualityResult) return qualityResult
 const chatResult = chatConfig === false ? { value: false as const } : chat.Config['~standard'].validate(chatConfig ?? {})
 if ('issues' in chatResult) return chatResult
 const personaResult = personaConfig === false ? { value: false as const } : authorPersona.Config['~standard'].validate(personaConfig ?? {})
 if ('issues' in personaResult) return personaResult
 try { return { value: { ...result.value, authorPersona: personaResult.value, quality: qualityResult.value, chat: chatResult.value, ...(defaultModel ? { defaultModel: parseSelection(defaultModel) } : {}) } } } catch { return { issues: [{ message: 'Invalid default model' }] } }
} } }
export function apply(ctx: Context, config: DatabaseConfig & { defaultModel?: Selection; quality?: QualityConfig | false; chat?: ChatConfig | false; authorPersona?: Record<string, never> | false } = {}): void {
  ctx.plugin(database, { databasePath: config.databasePath })
  mountModels(ctx, config.defaultModel)
  mountKnowledge(ctx)
  if (config.chat !== false) ctx.plugin(chat, config.chat ?? { timeoutMs: 180_000, maxTokens: 8192 })
  if (config.quality !== false) ctx.plugin(quality, config.quality ?? { timeoutMs: 120_000 })
  if (config.authorPersona !== false) ctx.plugin(authorPersona, config.authorPersona ?? {})
  mountDatabaseRemote(ctx, config)
  ctx.inject(['typert', 'writingMiddleware'], child => {
    new WikiRemoteService(child)
    new WorldRemoteService(child)
    child.typert.register({ package: workbenchRemote.package, face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: workbenchRemote.descriptors })
  })
}
