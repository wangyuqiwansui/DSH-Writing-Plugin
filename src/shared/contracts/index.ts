/** Shared protocol only: no filesystem, database, model calls or Cordis registrations. */
export const CONTRACT_VERSION = 'writing-contract-v1' as const
export const JSON_ENCODING = 'writing-json-v1' as const
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export const ARTIFACT_KINDS = {
  context: ['context_run', 'context_snapshot', 'context_packet', 'context_read_receipt', 'discovery_result'],
  story: ['project_setup', 'resource', 'entity_profile', 'entity_state', 'maintenance_report', 'resource_binding', 'story_confirmation', 'story_snapshot', 'story_generation', 'story_catalog'],
  planning: ['story_macro', 'volume_strategy', 'volume_plot', 'chapter_plot', 'chapter_title'],
  writer: ['writer_packet', 'chapter_body', 'revision_brief'],
  quality: ['planning_review', 'body_review', 'window_review', 'quality_issue', 'wiki_review'],
  publication: ['publication_manifest'],
  workflow: ['workflow_definition', 'workflow_input', 'workflow_checkpoint'],
  execution: ['execution_request', 'execution_output', 'execution_receipt'],
  knowledge: ['knowledge_source', 'source_text', 'knowledge_import_manifest', 'wiki_page', 'wiki_release_manifest', 'retrieval_index_manifest', 'retrieval_trace'],
} as const
export type Owner = keyof typeof ARTIFACT_KINDS
export type ArtifactKind = (typeof ARTIFACT_KINDS)[Owner][number]
export const OWNERS = Object.keys(ARTIFACT_KINDS) as Owner[]
export const EXECUTION_STATES = ['pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled'] as const
export const CONTENT_VERDICTS = ['not_established', 'passed', 'denied', 'not_required'] as const
export const ADMISSION_STATES = ['blocked', 'ready', 'completed'] as const
export interface TaskState {
  executionStatus: typeof EXECUTION_STATES[number]
  contentVerdict: typeof CONTENT_VERDICTS[number]
  admissionStatus: typeof ADMISSION_STATES[number]
}
export interface VersionRef {
  pluginInstanceId: string
  projectId: string
  artifactId: string
  versionId: string
  kind: string
  schemaVersion: string
  contentHash: string
  revision: number
}
export interface Scope { targetIds: string[]; referenceIds: string[] }
export interface ExpectedHead { key: string; revision: number; versionId: string | null }
export interface CommandEnvelope {
  contractVersion: typeof CONTRACT_VERSION
  pluginInstanceId: string
  projectId: string
  operationId: string
  runId?: string
  taskId?: string
  scope: Scope
  expectedVersions: ExpectedHead[]
  input: JsonValue
}
export interface NextAction { owner: Owner; operation: string; input: JsonValue }
export interface Blocker {
  code: string; owner: Owner | 'storage-local'; message: string
  affectedVersions: VersionRef[]; requiresUserInput: boolean; nextAction: NextAction | null
}
export interface TaskResult extends TaskState {
  contractVersion: typeof CONTRACT_VERSION
  outputs: VersionRef[]; blockers: Blocker[]; nextActions: NextAction[]
}
export type StorageErrorCode = 'INVALID_INPUT' | 'UNSUPPORTED_CONTRACT' | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_DISPOSED' | 'SCOPE_CLOSED' | 'CROSS_PROJECT_REFERENCE' | 'VERSION_MISMATCH'
  | 'NOT_FOUND' | 'OWNER_MISMATCH' | 'IDEMPOTENCY_CONFLICT' | 'HEAD_CONFLICT'
  | 'STATE_CONFLICT' | 'ASYNC_TRANSACTION' | 'NESTED_OPERATION' | 'CONTENT_CORRUPT'
export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string) {
    super(message)
    this.name = 'StorageError'
  }
}
export function requireValue(condition: unknown, code: StorageErrorCode, message: string): asserts condition {
  if (!condition) throw new StorageError(code, message)
}
export function nonempty(value: unknown, field: string): asserts value is string {
  requireValue(typeof value === 'string' && value.trim().length > 0 && !value.includes('\0'),
    'INVALID_INPUT', `${field} must be a nonempty string without NUL`)
}
function object(value: unknown): asserts value is Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Expected an object')
}
/** Sorted UTF-16 keys, JSON number spelling, exact Unicode. Reject lossy JS values. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>()
  function encode(item: unknown): string {
    if (item === null) return 'null'
    if (typeof item === 'string') {
      requireValue(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(item), 'INVALID_INPUT', 'Unpaired Unicode surrogate')
      return JSON.stringify(item)
    }
    if (typeof item === 'boolean') return String(item)
    if (typeof item === 'number') {
      requireValue(Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item)), 'INVALID_INPUT', 'Nonfinite or unsafe JSON number')
      return JSON.stringify(item)
    }
    requireValue(item !== null && typeof item === 'object' && !active.has(item), 'INVALID_INPUT', 'Unsupported or circular JSON value')
    active.add(item)
    try {
      if (Array.isArray(item)) {
        const keys = Object.keys(item)
        requireValue(keys.length === item.length && keys.every((key, index) => key === String(index))
          && Object.getOwnPropertySymbols(item).length === 0, 'INVALID_INPUT', 'Sparse or extended JSON array')
        return '[' + keys.map(key => {
          const property = Object.getOwnPropertyDescriptor(item, key)!
          requireValue('value' in property, 'INVALID_INPUT', 'JSON getters are not accepted')
          return encode(property.value)
        }).join(',') + ']'
      }
      requireValue(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null,
        'INVALID_INPUT', 'Only plain JSON objects are accepted')
      requireValue(Object.getOwnPropertySymbols(item).length === 0, 'INVALID_INPUT', 'Symbol keys are not JSON')
      return '{' + Object.keys(item).sort().map(key => {
        const property = Object.getOwnPropertyDescriptor(item, key)!
        requireValue('value' in property, 'INVALID_INPUT', 'JSON getters are not accepted')
        return encode(key) + ':' + encode(property.value)
      }).join(',') + '}'
    } finally { active.delete(item) }
  }
  return encode(value)
}
function schema<T>(parse: (value: unknown) => T) {
  return { parse, '~standard': { version: 1 as const, vendor: 'ds-writing', validate(value: unknown) {
    try { return { value: parse(value) } } catch (error) { return { issues: [{ message: (error as Error).message }] } }
  } } }
}
export const VersionRefSchema = schema<VersionRef>(value => {
  object(value)
  for (const field of ['pluginInstanceId', 'projectId', 'artifactId', 'versionId', 'kind', 'schemaVersion']) nonempty(value[field], field)
  requireValue(typeof value.contentHash === 'string' && /^[a-f0-9]{64}$/.test(value.contentHash), 'INVALID_INPUT', 'Invalid content hash')
  requireValue(Number.isSafeInteger(value.revision) && Number(value.revision) > 0, 'INVALID_INPUT', 'Invalid revision')
  return { ...value } as unknown as VersionRef
})
export const TaskStateSchema = schema<TaskState>(value => {
  object(value)
  requireValue(EXECUTION_STATES.includes(value.executionStatus as never) && CONTENT_VERDICTS.includes(value.contentVerdict as never)
    && ADMISSION_STATES.includes(value.admissionStatus as never), 'INVALID_INPUT', 'Invalid task state')
  return { executionStatus: value.executionStatus, contentVerdict: value.contentVerdict, admissionStatus: value.admissionStatus } as TaskState
})
export const CommandEnvelopeSchema = schema<CommandEnvelope>(value => {
  object(value)
  requireValue(value.contractVersion === CONTRACT_VERSION, 'UNSUPPORTED_CONTRACT', 'Unknown shared contract')
  for (const field of ['pluginInstanceId', 'projectId', 'operationId']) nonempty(value[field], field)
  if (value.runId !== undefined || value.taskId !== undefined) {
    nonempty(value.runId, 'runId'); nonempty(value.taskId, 'taskId')
  }
  object(value.scope)
  for (const field of ['targetIds', 'referenceIds']) {
    const ids = value.scope[field]
    requireValue(Array.isArray(ids), 'INVALID_INPUT', `scope.${field} must be an array`)
    ids.forEach(id => nonempty(id, field))
    requireValue(new Set(ids).size === ids.length, 'INVALID_INPUT', 'Duplicate scope member')
  }
  requireValue(!(value.scope.targetIds as string[]).some(id => (value.scope as Scope).referenceIds.includes(id)), 'INVALID_INPUT', 'Target and reference scopes overlap')
  requireValue(Array.isArray(value.expectedVersions), 'INVALID_INPUT', 'expectedVersions required')
  const keys = new Set<string>()
  for (const head of value.expectedVersions) {
    object(head); nonempty(head.key, 'head.key')
    requireValue(!keys.has(head.key) && Number.isSafeInteger(head.revision) && Number(head.revision) >= 0,
      'INVALID_INPUT', 'Duplicate or invalid expected head')
    keys.add(head.key)
    if (head.versionId !== null) nonempty(head.versionId, 'head.versionId')
    requireValue((head.revision === 0) === (head.versionId === null), 'INVALID_INPUT', 'Missing head must use revision 0 and null version')
  }
  return JSON.parse(canonicalJson(value)) as CommandEnvelope
})

export const NextActionSchema = schema<NextAction>(value => {
  object(value)
  requireValue(OWNERS.includes(value.owner as Owner), 'INVALID_INPUT', 'Unknown next-action owner')
  nonempty(value.operation, 'operation'); canonicalJson(value.input)
  return JSON.parse(canonicalJson(value)) as NextAction
})
export const BlockerSchema = schema<Blocker>(value => {
  object(value); nonempty(value.code, 'blocker.code'); nonempty(value.message, 'blocker.message')
  requireValue(value.owner === 'storage-local' || OWNERS.includes(value.owner as Owner), 'INVALID_INPUT', 'Unknown blocker owner')
  requireValue(typeof value.requiresUserInput === 'boolean' && Array.isArray(value.affectedVersions), 'INVALID_INPUT', 'Invalid blocker fields')
  value.affectedVersions.forEach(ref => VersionRefSchema.parse(ref))
  if (value.nextAction !== null) NextActionSchema.parse(value.nextAction)
  return JSON.parse(canonicalJson(value)) as Blocker
})
export const TaskResultSchema = schema<TaskResult>(value => {
  object(value)
  requireValue(value.contractVersion === CONTRACT_VERSION, 'UNSUPPORTED_CONTRACT', 'Unknown task-result contract')
  TaskStateSchema.parse(value)
  for (const field of ['outputs', 'blockers', 'nextActions']) requireValue(Array.isArray(value[field]), 'INVALID_INPUT', `${field} must be an array`)
  ;(value.outputs as unknown[]).forEach(ref => VersionRefSchema.parse(ref))
  ;(value.blockers as unknown[]).forEach(blocker => BlockerSchema.parse(blocker))
  ;(value.nextActions as unknown[]).forEach(action => NextActionSchema.parse(action))
  return JSON.parse(canonicalJson(value)) as TaskResult
})

export type Payload = { format: 'text'; text: string } | { format: 'json'; value: JsonValue; rawText?: string }
  | { format: 'blob'; bytes: Uint8Array }
export interface StoredArtifact { ref: VersionRef; owner: Owner | null; payload: Payload; metadata: JsonValue; byteLength: number }
export interface AppendArtifact {
  key: string; kind: ArtifactKind; schemaVersion: string; payload: Payload
  metadata?: JsonValue; sources?: { ref: VersionRef; relation: string }[]
}
export interface Head extends ExpectedHead { owner: Owner; ref: VersionRef }
export interface OutboxEvent {
  id: string; sequence: number; projectId: string; owner: Owner; type: string; payload: JsonValue; createdAt: string
}
export interface StorageSnapshot extends importExecutionSnapshot, StoryStorageSnapshot, KnowledgeSnapshot, ContextStorageSnapshot {
  getCommandReceipt(owner: Owner, operationId: string): JsonValue | null
  getVersion(ref: VersionRef): StoredArtifact
  getHead(key: string): Head | null
  getTask(id: string): TaskState & { id: string; runId: string; input: VersionRef }
  pendingEvents(consumerId: Owner, limit?: number): OutboxEvent[]
}
export interface StorageTransaction extends StorageSnapshot, importExecutionTransaction, StoryStorageTransaction, KnowledgeTransaction, ContextStorageTransaction {
  createProject(title: string): void
  appendArtifact(input: AppendArtifact): VersionRef
  setHead(key: string, ref: VersionRef, expectedRevision: number): Head
  decide(ref: VersionRef, decision: 'confirmed' | 'rejected' | 'revoked' | 'superseded', actor: string, reason?: string): string
  createRun(id: string, workflowKey: string, input: VersionRef): void
  createTask(id: string, runId: string, taskKey: string, stageKey: string, input: VersionRef, attemptBudget: number): void
  setTaskState(id: string, expected: TaskState, next: TaskState): void
  appendTaskEvent(taskId: string, type: string, payload: JsonValue): string
  emit(type: string, payload: JsonValue): string
}
import type { ExecutionSnapshot as importExecutionSnapshot, ExecutionTransaction as importExecutionTransaction } from './execution.js'
export * from './execution.js'
import type { StoryStorageSnapshot, StoryStorageTransaction } from './story.js'
export * from './story.js'
import type { KnowledgeSnapshot, KnowledgeTransaction } from './knowledge.js'
export * from './knowledge.js'
export interface CommandResult<T> { replayed: boolean; result: T }
export interface StorageRepository {
  command<T>(envelope: CommandEnvelope, work: (tx: StorageTransaction) => T, signal?: AbortSignal): CommandResult<T>
  consume<T>(eventId: string, operationId: string, work: (tx: StorageTransaction, event: OutboxEvent) => T, signal?: AbortSignal): CommandResult<T>
}
export interface StorageStatus {
  state: 'unconfigured' | 'missing' | 'invalid_path' | 'not_a_file' | 'unreadable' | 'invalid_database' | 'migration_required' | 'ready' | 'provider_missing' | 'configuration_conflict'
  databaseReady: boolean; databasePath: string; message: string; nextAction: string; managementCommand: string
}
import type { QualityStorage } from '../../modules/quality/storage-contracts.js'
export interface WritingStorage extends QualityStorage {
  status(signal?: AbortSignal): StorageStatus
  instanceId(): string
  listProjects(signal?: AbortSignal): import('./story.js').StoryProject[]
  repositoryFor(owner: Owner, projectId: string): StorageRepository
  openSnapshot<T>(projectId: string, read: (snapshot: StorageSnapshot) => T, signal?: AbortSignal): T
}

import type { ContextStorageSnapshot, ContextStorageTransaction } from './context.js'
export * from './context.js'
