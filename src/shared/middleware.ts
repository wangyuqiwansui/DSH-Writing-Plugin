import type { KnowledgeDataPort } from './knowledge-data.js'
import type { WritingStorage, StorageRepository } from './contracts/index.js'
import type { DatabaseInspection } from '../modules/database/contracts/management.js'

export const REQUEST_MODULES = ['knowledge', 'knowledge-query', 'database', 'wiki', 'worldbuilding', 'author-persona', 'quality', 'models', 'chat'] as const
export type RequestModule = typeof REQUEST_MODULES[number]
export interface RequestContext {
  readonly id: string
  readonly parentId: string | null
  readonly module: RequestModule
  readonly operation: string
  readonly layer: 'request' | 'data'
  readonly origin: 'remote' | 'internal'
  readonly startedAt: string
}
export interface RequestCompletion extends RequestContext {
  readonly outcome: 'succeeded' | 'failed' | 'cancelled'
  readonly durationMs: number
  readonly errorCode: string | null
}
/** Synchronous gates run before dispatch. Observers cannot change a committed result. */
export interface RequestHook {
  readonly id: string
  before?(request: RequestContext): void
  after?(completion: RequestCompletion): void
}
export type ReadDataPort = Pick<WritingStorage, 'status' | 'instanceId' | 'listProjects' | 'openSnapshot'>
export type WorldDataPort = Pick<ReadDataPort, 'status' | 'instanceId' | 'openSnapshot'> & Pick<WritingStorage, 'repositoryFor'>
export type PersonaDataPort = Pick<ReadDataPort, 'status' | 'instanceId' | 'openSnapshot'> & {
  repositoryFor(owner: 'story', project: string): Pick<StorageRepository, 'command'>
}
export type QualityDataPort = Pick<WritingStorage, 'status' | 'instanceId' | 'listProjects' | 'openQualitySnapshot' | 'qualityCommand'>
export interface DatabaseDataPort { inspect(path?: string, signal?: AbortSignal): DatabaseInspection }
export interface ModuleDataPorts { knowledge: KnowledgeDataPort; database: DatabaseDataPort; wiki: ReadDataPort; worldbuilding: WorldDataPort; 'author-persona': PersonaDataPort; quality: QualityDataPort }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'writing-middleware/owner-required': {}
    'writing-middleware/unavailable': {}
    'writing-middleware/invalid-request': {}
    'writing-middleware/forbidden': {}
    'writing-middleware/async-hook': {}
  }
}
