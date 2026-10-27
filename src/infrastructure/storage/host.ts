import * as middleware from '../middleware/host.js'
import { Service, type Context } from '@deepseek-ai/cordis'
import type { WritingStorage } from '../../shared/contracts/index.js'
import { LocalStorage } from './storage.js'
import type { DatabaseConfig } from '../../modules/database/contracts/index.js'
import { DatabaseConfigSchema } from '../../modules/database/host/config.js'

export const name = 'writing-database'
export const Config = DatabaseConfigSchema
declare module '@deepseek-ai/cordis' { interface Context { writingStorage: WritingStorage } }

class StorageService extends Service implements WritingStorage {
  readonly status: WritingStorage['status']
  readonly instanceId: WritingStorage['instanceId']
  readonly listProjects: WritingStorage['listProjects']
  readonly repositoryFor: WritingStorage['repositoryFor']
  readonly openSnapshot: WritingStorage['openSnapshot']
  readonly openQualitySnapshot: WritingStorage['openQualitySnapshot']
  readonly qualityCommand: WritingStorage['qualityCommand']
  constructor(ctx: Context, config: DatabaseConfig) {
    super(ctx, 'writingStorage')
    const storage = new LocalStorage(config.databasePath)
    this.status = storage.status.bind(storage)
    this.instanceId = storage.instanceId.bind(storage)
    this.listProjects = storage.listProjects.bind(storage)
    this.repositoryFor = storage.repositoryFor.bind(storage)
    this.openSnapshot = storage.openSnapshot.bind(storage)
    this.openQualitySnapshot = storage.openQualitySnapshot.bind(storage)
    this.qualityCommand = storage.qualityCommand.bind(storage)
    ctx.effect(() => () => storage.dispose())
  }
}

export function apply(ctx: Context, config: DatabaseConfig = {}) { new StorageService(ctx, config); ctx.plugin(middleware) }
export { LocalStorage }
export { inspectDatabase } from './database-status.js'
