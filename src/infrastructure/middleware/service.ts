import { knowledgeData } from '../storage/knowledge-data.js'
import type { KnowledgeDataPort } from '../../shared/knowledge-data.js'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { ModuleDataPorts, PersonaDataPort, QualityDataPort, ReadDataPort, WorldDataPort } from '../../shared/middleware.js'
import type { WritingStorage, StorageRepository } from '../../shared/contracts/index.js'
import { inspectDatabaseSettings } from '../storage/database-inspection.js'
import { RequestPipeline } from './pipeline.js'

/** Modules receive capabilities, never the storage provider, database handle or SQL. */
export class WritingMiddleware extends RequestPipeline {
  private readonly ports: ModuleDataPorts
  constructor(storage: WritingStorage) {
    super()
    const read = (module: 'wiki' | 'worldbuilding'): ReadDataPort => Object.freeze({
      status: signal => this.dataCall(module, 'status', s => storage.status(s), signal),
      instanceId: () => this.dataCall(module, 'instanceId', () => storage.instanceId()),
      listProjects: signal => this.dataCall(module, 'listProjects', s => storage.listProjects(s), signal),
      openSnapshot: (project, work, signal) => this.dataCall(module, 'openSnapshot', s => storage.openSnapshot(project, work, s), signal),
    })
    const worldRead = read('worldbuilding')
    const world: WorldDataPort = Object.freeze({ status: worldRead.status, instanceId: worldRead.instanceId,
      openSnapshot: (project, work, signal) => this.dataCall('worldbuilding', 'openSnapshot', s => {
        if (project !== 'writing-world-library') throw new RemoteError('writing-middleware/forbidden', '世界观只能读取自己的资料库', {})
        return storage.openSnapshot(project, work, s)
      }, signal), repositoryFor: (owner, project) => {
      // The world library cannot acquire writer, publication, context or other project ownership.
      const repository = this.dataCall('worldbuilding', 'repositoryFor', () => {
        if (owner !== 'story' || project !== 'writing-world-library') throw new RemoteError('writing-middleware/forbidden', '世界观只能写入自己的资料库', {})
        return storage.repositoryFor(owner, project)
      })
      return Object.freeze<StorageRepository>({
        command: (request, work, signal) => this.dataCall('worldbuilding', 'command', s => repository.command(request, work, s), signal),
        consume: (event, operation, work, signal) => this.dataCall('worldbuilding', 'consume', s => repository.consume(event, operation, work, s), signal),
      })
    } })
    const persona: PersonaDataPort = Object.freeze({
      status: signal => this.dataCall('author-persona', 'status', s => storage.status(s), signal),
      instanceId: () => this.dataCall('author-persona', 'instanceId', () => storage.instanceId()),
      openSnapshot: (project, work, signal) => this.dataCall('author-persona', 'openSnapshot', s => {
        if (project !== 'writing-author-persona-library') throw new RemoteError('writing-middleware/forbidden', '作者人格只能读取自己的资料库', {})
        return storage.openSnapshot(project, work, s)
      }, signal),
      repositoryFor: (owner, project) => {
        const repository = this.dataCall('author-persona', 'repositoryFor', () => {
          if (owner !== 'story' || project !== 'writing-author-persona-library') throw new RemoteError('writing-middleware/forbidden', '作者人格只能写入自己的资料库', {})
          return storage.repositoryFor(owner, project)
        })
        return Object.freeze<Pick<StorageRepository, 'command'>>({ command: (request, work, signal) => this.dataCall('author-persona', 'command', s => repository.command(request, work, s), signal) })
      },
    })
    const quality: QualityDataPort = Object.freeze({
      status: signal => this.dataCall('quality', 'status', s => storage.status(s), signal),
      instanceId: () => this.dataCall('quality', 'instanceId', () => storage.instanceId()),
      listProjects: signal => this.dataCall('quality', 'listProjects', s => storage.listProjects(s), signal),
      openQualitySnapshot: (scope, work, signal) => this.dataCall('quality', 'openQualitySnapshot', s => storage.openQualitySnapshot(scope, work, s), signal),
      qualityCommand: (request, work, signal) => this.dataCall('quality', 'qualityCommand', s => storage.qualityCommand(request, work, s), signal),
    })
    const kb = knowledgeData(storage)
    const knowledge = Object.freeze<KnowledgeDataPort>({
      status: signal => this.dataCall('knowledge','status',s=>kb.status(s),signal),
      instanceId: () => this.dataCall('knowledge','instanceId',()=>kb.instanceId()),
      listProjects: signal => this.dataCall('knowledge','listProjects',s=>kb.listProjects(s),signal),
      createProject: (instance,operation,title,signal) => this.dataCall('knowledge','createProject',s=>kb.createProject(instance,operation,title,s),signal),
      snapshot: (project,read,signal) => this.dataCall('knowledge','snapshot',s=>kb.snapshot(project,read,s),signal),
      command: (request,work,signal) => this.dataCall('knowledge','command',s=>kb.command(request,work,s),signal),
    })
    this.ports = Object.freeze({ knowledge, wiki: read('wiki'), worldbuilding: world, 'author-persona': persona, quality,
      database: Object.freeze({ inspect: (path?: string, signal?: AbortSignal) => this.dataCall('database', 'inspect', s => inspectDatabaseSettings(path, s), signal) }) })
  }
  data<K extends keyof ModuleDataPorts>(module: K): ModuleDataPorts[K] {
    if (!Object.hasOwn(this.ports, module)) throw new RemoteError('writing-middleware/forbidden', '该模块没有数据库访问权限', {})
    return this.ports[module]
  }
}
