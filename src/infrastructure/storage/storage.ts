import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import {
  CONTRACT_VERSION, OWNERS, CommandEnvelopeSchema, canonicalJson, nonempty, requireValue,
  type CommandEnvelope, type CommandResult, type Owner, type OutboxEvent, type StorageRepository,
  type StorageSnapshot, type StorageTransaction, type WritingStorage, type StoryProject,
} from '../../shared/contracts/index.js'
import { inspectDatabase, requireDatabase } from './database-status.js'
import { validateSchema } from './database-schema.js'
import { Session, hash } from './session.js'
import { qualityStore, qualityScopeKey } from './quality-store.js'
import type { QualityScope } from '../../modules/quality/contracts.js'
import type { QualitySnapshot, QualityTransaction, QualityCommandEnvelope } from '../../modules/quality/storage-contracts.js'

function synchronous<T>(value: T): T {
  const candidate = value as { then?: unknown } | null
  if (candidate && typeof candidate.then === 'function') {
    // Late asynchronous continuations see a revoked session; observe their rejection.
    void Promise.resolve(value).catch(() => {})
  }
  requireValue(!candidate || typeof candidate.then !== 'function', 'ASYNC_TRANSACTION', 'Storage callbacks must be synchronous; do model work before the transaction')
  return value
}

/** Opens only existing files; no constructor, runtime operation or reload initializes storage. */
export class LocalStorage implements WritingStorage {
  #disposed = false
  #busy = false
  constructor(private readonly databasePath?: string) {}
  dispose() { this.#disposed = true }
  private alive() { requireValue(!this.#disposed, 'STORAGE_DISPOSED', 'Storage provider was unloaded') }
  status(signal?: AbortSignal) { this.alive(); return inspectDatabase(this.databasePath, signal) }
  private withDatabase<T>(write: boolean, action: (db: DatabaseSync, instance: string) => T, signal?: AbortSignal): T {
    this.alive(); signal?.throwIfAborted()
    requireValue(!this.#busy, 'NESTED_OPERATION', 'Use the current transaction/snapshot instead of opening a nested operation')
    const status = requireDatabase(this.databasePath, signal)
    const uri = pathToFileURL(status.databasePath)
    uri.search = write ? '?mode=rw' : '?mode=ro'
    // URI mode=rw refuses missing files, including deletion between preflight and open.
    const db = new DatabaseSync(uri.href, { readOnly: !write })
    this.#busy = true
    try {
      db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=3000')
      if (write) db.exec('PRAGMA synchronous=FULL')
      db.exec(write ? 'BEGIN IMMEDIATE' : 'BEGIN')
      const instance = validateSchema(db)
      const result = synchronous(action(db, instance))
      this.alive(); signal?.throwIfAborted()
      db.exec('COMMIT')
      return result
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    } finally { this.#busy = false; db.close() }
  }
  instanceId(): string { return this.withDatabase(false, (_db, instance) => instance) }
  private quality<T>(scope: QualityScope, write: boolean, work: (store: QualityTransaction, db: DatabaseSync) => T, signal?: AbortSignal): T {
    nonempty(scope.pluginInstanceId, 'pluginInstanceId')
    if (scope.projectId !== null) nonempty(scope.projectId, 'projectId')
    return this.withDatabase(write, (db, instance) => {
      requireValue(scope.pluginInstanceId === instance, 'CROSS_PROJECT_REFERENCE', '数据库已切换，请刷新质量检测')
      let active = true, failure: unknown
      const port = qualityStore(db, scope, write, () => { requireValue(active, 'SCOPE_CLOSED', '质量数据快照已关闭'); signal?.throwIfAborted() })
      const guarded = Object.freeze(Object.fromEntries(Object.entries(port).map(([key, fn]) => [key, (...args: unknown[]) => {
        if (failure) throw failure
        try { return (fn as (...args: unknown[]) => unknown)(...args) } catch (error) { failure = error; throw error }
      }]))) as unknown as QualityTransaction
      try { const result = synchronous(work(guarded, db)); if (failure) throw failure; return result }
      finally { active = false }
    }, signal)
  }
  openQualitySnapshot<T>(scope: QualityScope, read: (store: QualitySnapshot) => T, signal?: AbortSignal): T {
    return this.quality(scope, false, store => read(store), signal)
  }
  qualityCommand<T>(request: QualityCommandEnvelope, work: (store: QualityTransaction) => T, signal?: AbortSignal): CommandResult<T> {
    nonempty(request.operationId, 'operationId')
    const frozen = JSON.parse(canonicalJson(request)) as QualityCommandEnvelope
    const digest = hash(canonicalJson(frozen))
    return this.quality(frozen, true, (store, db) => {
      const scopeKey = qualityScopeKey(frozen)
      const prior = db.prepare('SELECT * FROM quality_commands WHERE scope_key=? AND operation_id=?').get(scopeKey, frozen.operationId)
      if (prior) {
        requireValue(prior.input_sha256 === digest, 'IDEMPOTENCY_CONFLICT', '操作标识已用于其他输入')
        return { replayed: true, result: JSON.parse(String(prior.result_json)) as T }
      }
      const result = canonicalJson(synchronous(work(store)))
      db.prepare('INSERT INTO quality_commands(scope_key,operation_id,input_sha256,result_json) VALUES (?,?,?,?)').run(scopeKey, frozen.operationId, digest, result)
      return { replayed: false, result: JSON.parse(result) as T }
    }, signal)
  }
  listProjects(signal?: AbortSignal): StoryProject[] {
    return this.withDatabase(false, db => db.prepare('SELECT id,title,status FROM projects ORDER BY id').all()
      .map(row => ({ id: String(row.id), title: String(row.title), status: row.status as StoryProject['status'] })), signal)
  }
  openSnapshot<T>(projectId: string, read: (snapshot: StorageSnapshot) => T, signal?: AbortSignal): T {
    nonempty(projectId, 'projectId')
    return this.withDatabase(false, (db, instance) => {
      const session = new Session(db, instance, projectId, null, signal)
      try { return synchronous(read(session.snapshot())) } finally { session.close() }
    }, signal)
  }
  repositoryFor(owner: Owner, projectId: string): StorageRepository {
    this.alive(); nonempty(projectId, 'projectId')
    requireValue(OWNERS.includes(owner), 'INVALID_INPUT', 'Unknown repository owner')
    const instance = this.instanceId()
    return Object.freeze({
      command: <T>(envelope: CommandEnvelope, work: (tx: StorageTransaction) => T, signal?: AbortSignal) => {
        const command = CommandEnvelopeSchema.parse(envelope)
        requireValue(command.projectId === projectId && command.pluginInstanceId === instance,
          'CROSS_PROJECT_REFERENCE', 'Command belongs to another repository scope')
        return this.commit(owner, projectId, instance, command.operationId, command, work, signal)
      },
      consume: <T>(eventId: string, operationId: string, work: (tx: StorageTransaction, event: OutboxEvent) => T, signal?: AbortSignal) => {
        nonempty(eventId, 'eventId'); nonempty(operationId, 'operationId')
        const envelope: CommandEnvelope = { contractVersion: CONTRACT_VERSION, pluginInstanceId: instance, projectId, operationId,
          scope: { targetIds: [], referenceIds: [] }, expectedVersions: [], input: { eventId, consumerId: owner } }
        return this.commit(owner, projectId, instance, operationId, envelope, work, signal, eventId)
      },
    })
  }
  private commit<T>(owner: Owner, project: string, instance: string, operation: string, envelope: CommandEnvelope,
    work: ((tx: StorageTransaction) => T) | ((tx: StorageTransaction, event: OutboxEvent) => T), signal?: AbortSignal, eventId?: string): CommandResult<T> {
    // Snapshot caller-owned values before opening the transaction.
    const request = canonicalJson({ mode: eventId ? 'consume' : 'command', envelope })
    const digest = hash(request)
    return this.withDatabase(true, (db, currentInstance) => {
      requireValue(currentInstance === instance, 'CROSS_PROJECT_REFERENCE', 'Configured database instance changed')
      const prior = db.prepare('SELECT input_sha256,result_json FROM storage_commands WHERE project_id=? AND owner=? AND operation_id=?')
        .get(project, owner, operation)
      if (prior) {
        requireValue(prior.input_sha256 === digest, 'IDEMPOTENCY_CONFLICT', 'Operation ID was already used with different input')
        return { replayed: true, result: JSON.parse(String(prior.result_json)) as T }
      }
      const session = new Session(db, instance, project, owner, signal)
      try {
        const tx = session.transaction()
        if (envelope.taskId) requireValue(tx.getTask(envelope.taskId).runId === envelope.runId,
          'CROSS_PROJECT_REFERENCE', 'Task is not owned by the specified workflow run')
        for (const expected of envelope.expectedVersions) {
          const actual = tx.getHead(expected.key)
          requireValue((actual?.revision ?? 0) === expected.revision && (actual?.versionId ?? null) === expected.versionId,
            'HEAD_CONFLICT', 'An input head changed before submission')
        }
        let event: OutboxEvent | undefined
        if (eventId) {
          event = session.getEvent(eventId)
          const consumed = db.prepare('SELECT result_json FROM event_consumptions WHERE event_id=? AND consumer_id=?').get(eventId, owner)
          if (consumed) {
            db.prepare('INSERT INTO storage_commands(project_id,owner,operation_id,input_sha256,request_json,result_json) VALUES (?,?,?,?,?,?)')
              .run(project, owner, operation, digest, request, String(consumed.result_json))
            return { replayed: true, result: JSON.parse(String(consumed.result_json)) as T }
          }
        }
        const result = event ? synchronous((work as (tx: StorageTransaction, event: OutboxEvent) => T)(tx, event))
          : synchronous((work as (tx: StorageTransaction) => T)(tx))
        session.assertHealthy()
        const resultJson = canonicalJson(result)
        db.prepare('INSERT INTO storage_commands(project_id,owner,operation_id,input_sha256,request_json,result_json) VALUES (?,?,?,?,?,?)')
          .run(project, owner, operation, digest, request, resultJson)
        if (eventId) db.prepare('INSERT INTO event_consumptions(event_id,project_id,consumer_id,operation_id,result_json) VALUES (?,?,?,?,?)')
          .run(eventId, project, owner, operation, resultJson)
        return { replayed: false, result: JSON.parse(resultJson) as T }
      } finally { session.close() }
    }, signal)
  }
}
