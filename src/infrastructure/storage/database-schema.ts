import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export const APPLICATION_ID = 0x44535750
const directory = new URL('../../../storage/migrations/', import.meta.url)
export function migrations() {
  const files = readdirSync(directory).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort()
  if (!files.length) throw new Error('Packaged migrations are missing')
  return files.map((name, index) => {
    const version = Number(name.slice(0, 3))
    if (version !== index + 1) throw new Error('Packaged migration sequence is invalid')
    const bytes = readFileSync(new URL(name, directory))
    return { version, name, sha256: createHash('sha256').update(bytes).digest('hex'), sql: bytes.toString('utf8') }
  })
}
export class SchemaMismatch extends Error {
  constructor(readonly state: 'invalid_database' | 'migration_required', message: string) { super(message) }
}
const SCHEMA_QUERY = "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name"
let schemaCache: { signature: string; definition: string } | undefined
function expectedDefinition(expected: ReturnType<typeof migrations>): string {
  const signature = expected.map(item => item.sha256).join(':')
  if (schemaCache?.signature === signature) return schemaCache.definition
  const reference = new DatabaseSync(':memory:')
  try {
    for (const migration of expected) reference.exec(migration.sql)
    const definition = JSON.stringify(reference.prepare(SCHEMA_QUERY).all())
    schemaCache = { signature, definition }
    return definition
  } finally { reference.close() }
}
export function validateSchema(database: DatabaseSync): string {
  if (database.prepare('PRAGMA application_id').get()?.application_id !== APPLICATION_ID) {
    throw new SchemaMismatch('invalid_database', '该文件不属于小说创作插件数据库；不会覆盖或重建。')
  }
  const expected = migrations()
  if (database.prepare('PRAGMA user_version').get()?.user_version !== expected.length) {
    throw new SchemaMismatch('migration_required', '数据库结构版本不匹配，请运行 npm run db:init -- --db "<absolute-path>" 显式检查和迁移；不会自动升级或降级。')
  }
  const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name))
  const required = ['context_runs', 'context_snapshot_members', 'context_rounds', 'context_calls', 'context_budget_reservations', 'context_evidence', 'context_events', 'schema_migrations', 'projects', 'story_nodes', 'entities', 'artifacts', 'artifact_versions',
    'artifact_dependencies', 'artifact_decisions', 'workflow_runs', 'workflow_tasks', 'task_attempts', 'task_events',
    'reviews', 'review_targets', 'publication_batches', 'publication_members', 'plugin_instances', 'initialization_runs',
    'artifact_owners', 'artifact_payload_metadata', 'artifact_heads', 'storage_commands', 'outbox_events', 'event_consumptions',
    'execution_run_budgets', 'execution_requests', 'execution_controls', 'execution_evidence',
    'knowledge_import_map', 'knowledge_source_catalog', 'knowledge_spans', 'wiki_claim_projection', 'wiki_claim_supports',
    'wiki_links', 'entity_aliases', 'retrieval_generations', 'retrieval_generation_members', 'retrieval_documents', 'retrieval_fts', 'retrieval_vectors']
  if (required.some(name => !tables.has(name))) throw new SchemaMismatch('invalid_database', '数据库缺少必要表；未自动修复。')
  const triggers = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row => row.name))
  const requiredTriggers = ['artifact_owner_no_update', 'artifact_owner_no_delete', 'knowledge_import_no_update',
    'knowledge_import_no_delete', 'retrieval_documents_ai', 'retrieval_documents_ad', 'retrieval_documents_au']
  if (requiredTriggers.some(name => !triggers.has(name))) throw new SchemaMismatch('invalid_database', '数据库缺少必要约束触发器；请检查数据库完整性。')
  if (JSON.stringify(database.prepare(SCHEMA_QUERY).all()) !== expectedDefinition(expected)) {
    throw new SchemaMismatch('invalid_database', '数据库结构或约束偏离迁移定义；未自动修复。')
  }
  const applied = database.prepare('SELECT version, name, sha256 FROM schema_migrations ORDER BY version').all()
  if (applied.length !== expected.length || expected.some((item, i) => {
    const row = applied[i]
    return row?.version !== item.version || row?.name !== item.name || row?.sha256 !== item.sha256
  })) throw new SchemaMismatch('migration_required', '迁移历史与打包文件不一致，请运行 npm run db:init -- --db "<absolute-path>" 检查；不会改写历史。')
  const instance = database.prepare('SELECT id, plugin_key FROM plugin_instances WHERE singleton=1').get()
  if (!instance || instance.plugin_key !== 'dsh-writing-plugin' || typeof instance.id !== 'string' || !instance.id) {
    throw new SchemaMismatch('invalid_database', '数据库缺少插件实例初始化记录，请运行 npm run db:init -- --db "<absolute-path>" 检查。')
  }
  return instance.id
}
