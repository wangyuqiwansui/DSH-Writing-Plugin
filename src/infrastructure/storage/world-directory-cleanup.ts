import { backup, DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { canonicalJson, CONTRACT_VERSION, JSON_ENCODING, type VersionRef } from '../../shared/contracts/index.js'
import { WORLD_LIBRARY, WORLD_SCHEMA, WORLD_SCHEMAS, worldCleanupKey, type WorldReferenceRepair } from '../../modules/worldbuilding/contracts/index.js'
import { parseWorld, worldSummary } from '../../modules/worldbuilding/domain/world.js'
import { validateSchema } from './database-schema.js'
import { hash } from './session.js'

type Row = Record<string, SQLOutputValue>
const check = (ok: unknown, message: string): void => { if (!ok) throw new Error(message) }
const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"'

/** Explicit offline maintenance only. Never called from startup or a business remote. */
export async function cleanupWorldDirectories(databasePath: string, options: {
  apply?: boolean; signal?: AbortSignal; onProgress?: (stage: string) => void
} = {}) {
  check(isAbsolute(databasePath) && !databasePath.startsWith('\\\\') && !databasePath.startsWith('//'), '需要明确的本机绝对数据库路径')
  const path = realpathSync(databasePath); check(statSync(path).isFile(), '需要现有数据库文件')
  const db = new DatabaseSync(path, { readOnly: !options.apply })
  const progress = (stage: string) => { options.signal?.throwIfAborted(); options.onProgress?.(stage); options.signal?.throwIfAborted() }
  let backupPath: string | null = null
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON; PRAGMA busy_timeout=5000')
    db.exec(options.apply ? 'BEGIN IMMEDIATE' : 'BEGIN')
    const instance = validateSchema(db)
    const rows = db.prepare(`SELECT v.*, a.kind, o.owner FROM artifact_versions v
      JOIN artifacts a ON a.id=v.artifact_id JOIN artifact_owners o ON o.artifact_id=a.id
      WHERE v.project_id=? ORDER BY v.artifact_id,v.revision`).all(WORLD_LIBRARY)
    const refFor = (r: Row): VersionRef => ({ pluginInstanceId: instance, projectId: WORLD_LIBRARY, artifactId: String(r.artifact_id),
      versionId: String(r.id), revision: Number(r.revision), kind: String(r.kind), schemaVersion: String(r.schema_key), contentHash: String(r.content_sha256) })
    const allIds = new Set(rows.map(r => String(r.id))), replacements = new Map<string, WorldReferenceRepair>()
    const changed: { row: Row; content: string; metadata: string; repair: WorldReferenceRepair }[] = []
    const rewrite = (value: unknown): any => {
      if (Array.isArray(value)) return value.map(rewrite)
      if (!isObject(value)) return value
      if (WORLD_SCHEMAS.some(schema => value.schemaVersion === schema) && Array.isArray(value.records)) return parseWorld(value)
      if (typeof value.versionId === 'string' && allIds.has(value.versionId) && 'contentHash' in value) {
        const repair = replacements.get(value.versionId)
        check(repair && canonicalJson(value) === canonicalJson(repair.before), '存在未排序、循环或不一致的世界版本引用')
        return repair!.after
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]))
    }
    for (const row of rows) {
      progress('plan-version')
      check(row.owner === 'story' && row.kind === 'resource' && row.storage_kind === 'json' && WORLD_SCHEMAS.some(s => s === row.schema_key), '世界资料库存在不支持的产物，未清理')
      const raw = String(row.content_json), before = refFor(row), version = JSON.parse(raw)
      check(hash(raw) === before.contentHash && Buffer.byteLength(raw) === row.byte_length, '世界版本原内容校验失败')
      const metadataRow = db.prepare('SELECT * FROM artifact_payload_metadata WHERE version_id=?').get(row.id!)
      check(metadataRow?.encoding === JSON_ENCODING && metadataRow.semantic_sha256 === hash(canonicalJson(version)), '世界版本语义校验失败')
      check(version.document?.schemaVersion === row.schema_key && version.revision === row.revision, '世界版本元数据不一致')
      const content = canonicalJson(rewrite(version)), metadata = canonicalJson(rewrite(JSON.parse(String(row.metadata_json))))
      const after = { ...before, schemaVersion: WORLD_SCHEMA, contentHash: hash(content) }
      const repair = { before, after, summary: worldSummary(parseWorld(version.document)) }
      replacements.set(before.versionId, repair)
      if (content !== raw || metadata !== row.metadata_json || before.schemaVersion !== WORLD_SCHEMA) changed.push({ row, content, metadata, repair })
    }
    const changedIds = new Set(changed.map(v => v.repair.before.versionId))
    const usesChanged = (value: unknown) => typeof value === 'string' && [...changedIds].some(id => value.includes(id))
    const commands = db.prepare('SELECT rowid AS _rowid,* FROM storage_commands').all()
    const outbox = db.prepare('SELECT rowid AS _rowid,* FROM outbox_events').all()
    const commandEdits: { row: Row; request: string; result: string }[] = []
    const eventEdits: { row: Row; payload: string }[] = []
    if (changed.length) {
      for (const row of commands) {
        if (row.project_id !== WORLD_LIBRARY || row.owner !== 'story' || !String(row.operation_id).startsWith('world-') || String(row.operation_id).startsWith('world-directory-cleanup-')) {
          check(!usesChanged(row.request_json) && !usesChanged(row.result_json), '其他业务命令引用受影响版本，需要专用适配，未清理'); continue
        }
        const request = canonicalJson(rewrite(JSON.parse(String(row.request_json)))), result = canonicalJson(rewrite(JSON.parse(String(row.result_json))))
        if (request !== row.request_json || result !== row.result_json) commandEdits.push({ row, request, result })
      }
      for (const row of outbox) {
        if (row.project_id !== WORLD_LIBRARY || row.owner !== 'story' || !String(row.event_type).startsWith('story.world.')) {
          check(!usesChanged(row.payload_json), '其他业务事件引用受影响版本，需要专用适配，未清理'); continue
        }
        const payload = canonicalJson(rewrite(JSON.parse(String(row.payload_json))))
        if (payload !== row.payload_json) eventEdits.push({ row, payload })
      }
      // Unknown derived data must not be made superficially consistent by merely replacing its hash.
      const allowed = new Set(['storage_commands', 'outbox_events', 'artifact_dependencies'])
      for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
        const table = String(t.name); if (allowed.has(table)) continue
        const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c => String(c.name)).filter(c => c.endsWith('_json') || c === 'content_text' || c === 'source_version_id')
        if (!columns.length) continue
        for (const row of db.prepare(`SELECT * FROM ${quote(table)}`).all()) {
          if (table === 'artifact_versions' && allIds.has(String(row.id))) continue
          if (columns.some(c => usesChanged(row[c]))) throw new Error(`存在未适配的派生引用：${table}；本次清理未提交`)
        }
      }
    }
    const report = { applied: false, databasePath: path, pluginInstanceId: instance, backupPath, worldVersions: rows.length,
      changedVersions: changed.length, changedCommands: commandEdits.length, changedEvents: eventEdits.length,
      repairs: changed.map(c => c.repair), schemaVersion: Number(db.prepare('PRAGMA user_version').get()!.user_version) }
    progress('planned')
    if (!options.apply || !changed.length) { db.exec('ROLLBACK'); return report }
    // The writer lock prevents changes between this backup and the transaction's data edits.
    backupPath = path + '-before-world-directory-cleanup-' + randomUUID() + '.bak'
    check(!existsSync(backupPath), '备份路径已存在')
    const reader = new DatabaseSync(path, { readOnly: true })
    try { await backup(reader, backupPath) } finally { reader.close() }
    progress('backed-up')
    const triggerNames = ['version_no_update', 'payload_metadata_no_update', 'command_no_update', 'outbox_no_update']
    const triggers = triggerNames.map(name => {
      const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)
      check(row?.sql, '不可变约束缺失'); return { name, sql: String(row!.sql) }
    })
    for (const trigger of triggers) db.exec('DROP TRIGGER ' + quote(trigger.name))
    for (const item of changed) {
      db.prepare('UPDATE artifact_versions SET schema_key=?,content_json=?,content_sha256=?,byte_length=?,metadata_json=? WHERE id=?')
        .run(WORLD_SCHEMA, item.content, item.repair.after.contentHash, Buffer.byteLength(item.content), item.metadata, item.row.id!)
      db.prepare('UPDATE artifact_payload_metadata SET semantic_sha256=? WHERE version_id=?').run(hash(item.content), item.row.id!)
    }
    for (const item of commandEdits) db.prepare('UPDATE storage_commands SET request_json=?,input_sha256=?,result_json=? WHERE rowid=?')
      .run(item.request, hash(item.request), item.result, item.row._rowid!)
    for (const item of eventEdits) db.prepare('UPDATE outbox_events SET payload_json=? WHERE rowid=?').run(item.payload, item.row._rowid!)
    progress('rewritten')
    for (const trigger of triggers) db.exec(trigger.sql)
    for (const item of changed) {
      const operationId = worldCleanupKey(item.repair.before)
      const request = canonicalJson({ mode: 'command', envelope: { contractVersion: CONTRACT_VERSION, pluginInstanceId: instance,
        projectId: WORLD_LIBRARY, operationId, scope: { targetIds: [item.repair.before.versionId], referenceIds: [] }, expectedVersions: [],
        input: { maintenance: 'remove-world-directory-fields' } } })
      db.prepare('INSERT INTO storage_commands(project_id,owner,operation_id,input_sha256,request_json,result_json) VALUES (?,?,?,?,?,?)')
        .run(WORLD_LIBRARY, 'story', operationId, hash(request), request, canonicalJson(item.repair))
    }
    check(db.prepare('PRAGMA foreign_key_check').all().length === 0, '清理后的外键校验失败')
    check(db.prepare('PRAGMA integrity_check').get()!.integrity_check === 'ok', '清理后的完整性校验失败')
    check(validateSchema(db) === instance, '清理改变了数据库身份或结构')
    progress('verified')
    db.exec('COMMIT')
    return { ...report, applied: true, backupPath }
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  } finally { db.close() }
}
