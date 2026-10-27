import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { contextStore } from './context-store.js'
import { executionStore } from './execution-store.js'
import { knowledgeStore } from './knowledge-store.js'
import { knowledgeBrowser } from './knowledge-browser.js'
import {
  ARTIFACT_KINDS, CONTRACT_VERSION, JSON_ENCODING, ENTITY_KINDS, TaskStateSchema, VersionRefSchema, canonicalJson, nonempty, requireValue, storyKey,
  type AppendArtifact, type Head, type JsonValue, type OutboxEvent, type Owner, type Payload,
  type StorageSnapshot, type StorageTransaction, type StoredArtifact, type TaskState, type VersionRef,
} from '../../shared/contracts/index.js'

export const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
type Row = Record<string, SQLOutputValue>
const VERSION_QUERY = `SELECT v.*, a.kind, o.owner FROM artifact_versions v
 JOIN artifacts a ON a.id=v.artifact_id LEFT JOIN artifact_owners o ON o.artifact_id=a.id`

/** Transaction-scoped repository. No connection or arbitrary SQL escapes this module. */
export class Session {
  #active = true
  #failure: unknown
  constructor(
    private readonly db: DatabaseSync, private readonly instance: string,
    private readonly project: string, private readonly owner: Owner | null, private readonly signal?: AbortSignal,
  ) {}
  close() { this.#active = false }
  assertHealthy() { if (this.#failure) throw this.#failure }
  private check() {
    requireValue(this.#active, 'SCOPE_CLOSED', 'The storage snapshot/transaction has ended')
    this.signal?.throwIfAborted()
  }
  private write(owner?: Owner) {
    this.check()
    requireValue(this.owner !== null && (!owner || this.owner === owner), 'OWNER_MISMATCH', 'Operation belongs to another plugin')
  }
  private ref(row: Row): VersionRef {
    return { pluginInstanceId: this.instance, projectId: this.project, artifactId: String(row.artifact_id),
      versionId: String(row.id), revision: Number(row.revision), kind: String(row.kind),
      schemaVersion: String(row.schema_key), contentHash: String(row.content_sha256) }
  }
  private row(id: string): Row {
    this.check(); nonempty(id, 'versionId')
    const row = this.db.prepare(VERSION_QUERY + ' WHERE v.id=? AND v.project_id=?').get(id, this.project)
    requireValue(row, 'NOT_FOUND', 'Version is not in this project')
    return row
  }
  private read(ref: VersionRef): StoredArtifact {
    this.check(); VersionRefSchema.parse(ref)
    requireValue(ref.projectId === this.project && ref.pluginInstanceId === this.instance,
      'CROSS_PROJECT_REFERENCE', 'Version belongs to another project or plugin instance')
    const row = this.row(ref.versionId)
    requireValue(canonicalJson(this.ref(row)) === canonicalJson(ref), 'VERSION_MISMATCH', 'Version reference does not match stored identity')
    const format = row.storage_kind
    const raw = format === 'blob' ? row.content_blob as Uint8Array : Buffer.from(String(row[format === 'text' ? 'content_text' : 'content_json']), 'utf8')
    requireValue(raw.byteLength === row.byte_length && hash(raw) === ref.contentHash, 'CONTENT_CORRUPT', 'Stored content checksum failed')
    let payload: Payload
    if (format === 'blob') payload = { format: 'blob', bytes: Uint8Array.from(raw) }
    else if (format === 'text') payload = { format: 'text', text: String(row.content_text) }
    else payload = { format: 'json', value: JSON.parse(String(row.content_json)), rawText: String(row.content_json) }
    return { ref: this.ref(row), owner: (row.owner ?? null) as Owner | null, payload,
      metadata: JSON.parse(String(row.metadata_json)), byteLength: Number(row.byte_length) }
  }
  private head(key: string): Head | null {
    this.check(); nonempty(key, 'head.key')
    const row = this.db.prepare('SELECT * FROM artifact_heads WHERE project_id=? AND head_key=?').get(this.project, key)
    if (!row) return null
    const ref = this.ref(this.row(String(row.version_id)))
    this.read(ref)
    return { key, owner: row.owner as Owner, revision: Number(row.revision), versionId: ref.versionId, ref }
  }
  private task(id: string) {
    this.check(); nonempty(id, 'taskId')
    const row = this.db.prepare('SELECT * FROM workflow_tasks WHERE id=? AND project_id=?').get(id, this.project)
    requireValue(row, 'NOT_FOUND', 'Task is not in this project')
    return { id, runId: String(row.run_id), input: this.ref(this.row(String(row.input_version_id))),
      executionStatus: row.execution_status, contentVerdict: row.content_verdict, admissionStatus: row.admission_status } as TaskState & { id: string; runId: string; input: VersionRef }
  }
  private event(row: Row): OutboxEvent {
    return { id: String(row.id), sequence: Number(row.sequence), projectId: this.project, owner: row.owner as Owner, type: String(row.event_type),
      payload: JSON.parse(String(row.payload_json)), createdAt: String(row.created_at) }
  }
  getEvent(id: string): OutboxEvent {
    this.check(); nonempty(id, 'eventId')
    const row = this.db.prepare('SELECT * FROM outbox_events WHERE id=? AND project_id=?').get(id, this.project)
    requireValue(row, 'NOT_FOUND', 'Event is not in this project')
    return this.event(row)
  }
  snapshot(): StorageSnapshot {
    const execution = this.execution()
    const knowledge = this.knowledge()
    const context = this.context()
    return Object.freeze({
      getCommandReceipt: (owner: Owner, operationId: string) => {
        this.check(); nonempty(operationId, 'operationId')
        requireValue(Object.hasOwn(ARTIFACT_KINDS, owner), 'INVALID_INPUT', 'Unknown command owner')
        const row = this.db.prepare('SELECT result_json FROM storage_commands WHERE project_id=? AND owner=? AND operation_id=?').get(this.project, owner, operationId)
        return row ? JSON.parse(String(row.result_json)) : null
      },
      getContextRun: context.getContextRun, contextMembers: context.contextMembers, readContextSource: context.readContextSource,
      contextCalls: context.contextCalls, contextRounds: context.contextRounds, contextEvents: context.contextEvents, contextFreshness: context.contextFreshness,
      ...knowledgeBrowser(this.db, this.project, this.instance, () => this.check(), id => this.ref(this.row(id)),
        ref => this.read(ref), knowledge.getKnowledgeSource, knowledge.getKnowledgeImport),
      getKnowledgeImport: knowledge.getKnowledgeImport,
      getKnowledgeSource: knowledge.getKnowledgeSource,
      getKnowledgeSpans: knowledge.getKnowledgeSpans,
      getProject: () => {
        this.check()
        const row = this.db.prepare('SELECT id,title,status FROM projects WHERE id=?').get(this.project)
        return row ? { id: String(row.id), title: String(row.title), status: row.status as 'active' | 'archived' } : null
      },
      listHeads: (prefix: string) => {
        this.check(); nonempty(prefix, 'head prefix')
        return this.db.prepare('SELECT head_key FROM artifact_heads WHERE project_id=? AND substr(head_key,1,?)=? ORDER BY head_key')
          .all(this.project, prefix.length, prefix).map(row => this.head(String(row.head_key))!)
      },
      getEntity: (id: string) => this.entity(id),
      listEntities: () => {
        this.check()
        return this.db.prepare('SELECT id FROM entities WHERE project_id=? ORDER BY entity_key').all(this.project).map(row => this.entity(String(row.id)))
      },
      getExecution: execution.getExecution,
      executionTasks: execution.executionTasks,
      executionEvidence: execution.executionEvidence,
      getVersion: (ref: VersionRef) => this.read(ref),
      getHead: (key: string) => this.head(key),
      getTask: (id: string) => this.task(id),
      pendingEvents: (consumerId: Owner, limit = 100) => {
        this.check()
        requireValue(Object.hasOwn(ARTIFACT_KINDS, consumerId), 'INVALID_INPUT', 'Unknown consumer')
        requireValue(Number.isInteger(limit) && limit > 0 && limit <= 1000, 'INVALID_INPUT', 'Event limit must be 1..1000')
        return this.db.prepare(`SELECT e.* FROM outbox_events e WHERE e.project_id=? AND NOT EXISTS
          (SELECT 1 FROM event_consumptions c WHERE c.event_id=e.id AND c.consumer_id=?) ORDER BY e.sequence LIMIT ?`)
          .all(this.project, consumerId, limit).map(row => this.event(row))
      },
    })
  }
  transaction(): StorageTransaction {
    this.write()
    const api: StorageTransaction = {
      ...this.snapshot(),
      ...this.execution(),
      ...this.knowledge(),
      ...this.context(),
      createEntity: (key, kind, displayName) => {
        this.write('story'); storyKey(key); nonempty(displayName, 'displayName')
        requireValue(ENTITY_KINDS.includes(kind), 'INVALID_INPUT', 'Unknown entity kind')
        const id = randomUUID()
        this.db.prepare('INSERT INTO entities(id,project_id,kind,entity_key,display_name) VALUES (?,?,?,?,?)').run(id, this.project, kind, key, displayName)
        return this.entity(id)
      },
      setProjectTitle: title => {
        this.write('story'); nonempty(title, 'title')
        requireValue(this.db.prepare('UPDATE projects SET title=?,updated_at=? WHERE id=?').run(title, new Date().toISOString(), this.project).changes === 1,
          'NOT_FOUND', 'Project does not exist')
      },
      createProject: (title: string) => {
        this.write('story'); nonempty(title, 'title')
        this.db.prepare('INSERT INTO projects(id,title) VALUES (?,?)').run(this.project, title)
      },
      appendArtifact: (input: AppendArtifact) => this.append(input),
      setHead: (key: string, ref: VersionRef, expectedRevision: number) => {
        this.write(); nonempty(key, 'head.key')
        requireValue(key.startsWith(this.owner + '.'), 'OWNER_MISMATCH', 'Head must use its owner namespace')
        requireValue(Number.isSafeInteger(expectedRevision) && expectedRevision >= 0, 'INVALID_INPUT', 'Invalid head revision')
        const artifact = this.read(ref)
        requireValue(artifact.owner === this.owner || (this.owner === 'publication' && artifact.owner === 'writer' && ref.kind === 'chapter_body'),
          'OWNER_MISMATCH', 'Cannot point at another owner\'s artifact')
        const before = this.head(key)
        requireValue(!before || before.owner === this.owner, 'OWNER_MISMATCH', 'Head belongs to another plugin')
        requireValue((before?.revision ?? 0) === expectedRevision, 'HEAD_CONFLICT', 'Current head has changed')
        if (before) this.db.prepare('UPDATE artifact_heads SET version_id=?, revision=revision+1 WHERE project_id=? AND head_key=?')
          .run(ref.versionId, this.project, key)
        else this.db.prepare('INSERT INTO artifact_heads(project_id, head_key, owner, version_id, revision) VALUES (?,?,?,?,1)')
          .run(this.project, key, this.owner!, ref.versionId)
        return this.head(key)!
      },
      decide: (ref: VersionRef, decision: 'confirmed' | 'rejected' | 'revoked' | 'superseded', actor: string, reason = '') => {
        this.write(); nonempty(actor, 'actor')
        requireValue(this.read(ref).owner === this.owner, 'OWNER_MISMATCH', 'Only the artifact owner can append its decisions')
        requireValue(['confirmed', 'rejected', 'revoked', 'superseded'].includes(decision) && typeof reason === 'string', 'INVALID_INPUT', 'Invalid decision')
        const id = randomUUID()
        this.db.prepare('INSERT INTO artifact_decisions(id, project_id, version_id, decision, actor, reason) VALUES (?,?,?,?,?,?)')
          .run(id, this.project, ref.versionId, decision, actor, reason)
        return id
      },
      createRun: (id: string, workflowKey: string, input: VersionRef) => {
        this.write('workflow'); nonempty(id, 'runId'); nonempty(workflowKey, 'workflowKey'); this.read(input)
        this.db.prepare('INSERT INTO workflow_runs(id,project_id,workflow_key,contract_version,input_version_id) VALUES (?,?,?,?,?)')
          .run(id, this.project, workflowKey, CONTRACT_VERSION, input.versionId)
      },
      createTask: (id: string, runId: string, taskKey: string, stageKey: string, input: VersionRef, attemptBudget: number) => {
        this.write('workflow'); [id, runId, taskKey, stageKey].forEach(value => nonempty(value, 'task field')); this.read(input)
        requireValue(Number.isSafeInteger(attemptBudget) && attemptBudget > 0, 'INVALID_INPUT', 'Explicit positive attempt budget required')
        this.db.prepare('INSERT INTO workflow_tasks(id,project_id,run_id,task_key,stage_key,input_version_id,attempt_budget) VALUES (?,?,?,?,?,?,?)')
          .run(id, this.project, runId, taskKey, stageKey, input.versionId, attemptBudget)
      },
      setTaskState: (id: string, expected: TaskState, next: TaskState) => {
        this.write('workflow'); TaskStateSchema.parse(expected); TaskStateSchema.parse(next)
        const before = this.task(id)
        requireValue(before.executionStatus === expected.executionStatus && before.contentVerdict === expected.contentVerdict
          && before.admissionStatus === expected.admissionStatus, 'STATE_CONFLICT', 'Task state has changed')
        this.db.prepare("UPDATE workflow_tasks SET execution_status=?, content_verdict=?, admission_status=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND project_id=?")
          .run(next.executionStatus, next.contentVerdict, next.admissionStatus, id, this.project)
        this.taskEvent(id, 'workflow.state_changed', { before: expected, after: next } as unknown as JsonValue)
      },
      appendTaskEvent: (taskId: string, type: string, payload: JsonValue) => this.taskEvent(taskId, type, payload),
      emit: (type: string, payload: JsonValue) => {
        this.write(); this.eventType(type)
        const id = randomUUID()
        this.db.prepare('INSERT INTO outbox_events(id,project_id,owner,event_type,payload_json) VALUES (?,?,?,?,?)')
          .run(id, this.project, this.owner!, type, canonicalJson(payload))
        return id
      },
    }
    // A caught statement error must not commit partial effects from a multi-statement operation.
    return Object.freeze(Object.fromEntries(Object.entries(api).map(([name, method]) => [name, (...args: unknown[]) => {
      try { this.assertHealthy(); return (method as (...args: unknown[]) => unknown)(...args) }
      catch (error) { this.#failure = error; throw error }
    }]))) as unknown as StorageTransaction
  }
  private context() {
    return contextStore(this.db, this.project, this.owner, () => this.check(), id => this.ref(this.row(id)), ref => this.read(ref), input => this.append(input))
  }
  private execution() {
    return executionStore(this.db, this.project, this.owner, () => this.check(), id => this.ref(this.row(id)), ref => this.read(ref))
  }
  private knowledge() {
    return knowledgeStore(this.db, this.project, this.owner, () => this.check(), id => this.ref(this.row(id)), ref => this.read(ref))
  }
  private entity(id: string): import('../../shared/contracts/index.js').StoryEntity {
    this.check(); nonempty(id, 'entityId')
    const row = this.db.prepare('SELECT * FROM entities WHERE id=? AND project_id=?').get(id, this.project)
    requireValue(row, 'NOT_FOUND', 'Entity is not in this project')
    return { id, key: String(row.entity_key), kind: row.kind as import('../../shared/contracts/index.js').EntityKind, displayName: String(row.display_name) }
  }
  private eventType(type: string) {
    nonempty(type, 'eventType')
    requireValue(type.startsWith(this.owner + '.') && type.length > this.owner!.length + 1, 'OWNER_MISMATCH', 'Events must use the writer owner namespace')
  }
  private taskEvent(taskId: string, type: string, payload: JsonValue) {
    this.write(); this.eventType(type); this.task(taskId)
    const id = randomUUID()
    this.db.prepare('INSERT INTO task_events(event_id,project_id,task_id,event_type,payload_json) VALUES (?,?,?,?,?)')
      .run(id, this.project, taskId, type, canonicalJson(payload))
    return id
  }
  private append(input: AppendArtifact): VersionRef {
    this.write(); nonempty(input.key, 'artifact.key'); nonempty(input.schemaVersion, 'schemaVersion')
    requireValue((ARTIFACT_KINDS[this.owner!] as readonly string[]).includes(input.kind), 'OWNER_MISMATCH', 'Artifact kind belongs to another plugin')
    const sources = input.sources ?? []
    for (const source of sources) { this.read(source.ref); nonempty(source.relation, 'source.relation') }
    let raw: string | Uint8Array; let semantic: string; const payload = input.payload
    requireValue(payload && ['text', 'json', 'blob'].includes(payload.format), 'INVALID_INPUT', 'Complete inline payload required')
    if (payload.format === 'text') {
      requireValue(typeof payload.text === 'string', 'INVALID_INPUT', 'Text payload required')
      canonicalJson(payload.text) // Reject strings that cannot round trip through UTF-8.
      raw = payload.text; semantic = hash(raw)
    } else if (payload.format === 'blob') {
      requireValue(payload.bytes instanceof Uint8Array, 'INVALID_INPUT', 'Inline binary bytes required')
      raw = Uint8Array.from(payload.bytes); semantic = hash(raw)
    } else {
      const canonical = canonicalJson(payload.value)
      raw = payload.rawText ?? canonical
      requireValue(typeof raw === 'string', 'INVALID_INPUT', 'rawText must be JSON text')
      canonicalJson(raw)
      requireValue(canonicalJson(JSON.parse(raw)) === canonical, 'INVALID_INPUT', 'Raw JSON does not match its structured value')
      semantic = hash(canonical)
    }
    const metadata = canonicalJson(input.metadata ?? {})
    let artifact = this.db.prepare('SELECT a.*, o.owner FROM artifacts a LEFT JOIN artifact_owners o ON o.artifact_id=a.id WHERE a.project_id=? AND a.artifact_key=?')
      .get(this.project, input.key)
    if (artifact) {
      requireValue(artifact.owner === this.owner && artifact.kind === input.kind, 'OWNER_MISMATCH', 'Cannot change or adopt artifact ownership/kind')
    } else {
      const id = randomUUID()
      this.db.prepare('INSERT INTO artifacts(id,project_id,artifact_key,kind) VALUES (?,?,?,?)').run(id, this.project, input.key, input.kind)
      this.db.prepare('INSERT INTO artifact_owners(artifact_id,project_id,owner) VALUES (?,?,?)').run(id, this.project, this.owner!)
      artifact = { id }
    }
    const artifactId = String(artifact.id)
    const revision = Number(this.db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM artifact_versions WHERE artifact_id=?').get(artifactId)!.revision)
    const id = randomUUID(); const contentHash = hash(raw)
    const length = typeof raw === 'string' ? Buffer.byteLength(raw, 'utf8') : raw.byteLength
    const mime = payload.format === 'text' ? 'text/plain; charset=utf-8' : payload.format === 'json' ? 'application/json' : 'application/octet-stream'
    this.db.prepare(`INSERT INTO artifact_versions(id,project_id,artifact_id,revision,schema_key,content_type,storage_kind,
      content_text,content_json,content_blob,content_sha256,byte_length,metadata_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, this.project, artifactId, revision, input.schemaVersion, mime, payload.format,
        payload.format === 'text' ? raw as string : null, payload.format === 'json' ? raw as string : null,
        payload.format === 'blob' ? raw : null, contentHash, length, metadata, this.owner!)
    this.db.prepare('INSERT INTO artifact_payload_metadata(version_id,encoding,semantic_sha256) VALUES (?,?,?)')
      .run(id, payload.format === 'json' ? JSON_ENCODING : payload.format === 'text' ? 'utf8-exact' : 'bytes-exact', semantic)
    for (const source of sources) this.db.prepare('INSERT INTO artifact_dependencies(project_id,version_id,source_version_id,relation) VALUES (?,?,?,?)')
      .run(this.project, id, source.ref.versionId, source.relation)
    return this.ref(this.row(id))
  }
}
