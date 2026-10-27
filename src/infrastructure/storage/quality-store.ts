import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { canonicalJson, requireValue, type VersionRef } from '../../shared/contracts/index.js'
import type { QualityScope, QualityReport, ReportSummary, RuleRecord, RuleVersion, Target, PageQuery, Page, PollutionLog } from '../../modules/quality/contracts.js'
import type { QualityTransaction } from '../../modules/quality/storage-contracts.js'
import { Session, hash } from './session.js'
import { QUALITY_VERSION } from '../../modules/quality/contracts.js'

type Row = Record<string, SQLOutputValue>
export const qualityScopeKey = (scope: QualityScope) => scope.projectId === null ? 'L0' : `L1:${scope.projectId}`
const dimensions: Record<string, 'body' | 'outline'> = { chapter_body: 'body', story_macro: 'outline', volume_strategy: 'outline', volume_plot: 'outline', chapter_plot: 'outline' }
/** Connections stay in LocalStorage; callers receive a revocable, scope-bound domain port. */
export function qualityStore(db: DatabaseSync, scope: QualityScope, writable: boolean, check: () => void): QualityTransaction {
  const scopeKey = qualityScopeKey(scope)
  const project = () => requireValue(scope.projectId !== null && db.prepare('SELECT 1 FROM projects WHERE id=?').get(scope.projectId), 'NOT_FOUND', '项目不存在')
  if (scope.projectId !== null) project()
  const write = () => { check(); requireValue(writable, 'OWNER_MISMATCH', '只读质量快照不能修改数据') }
  const scoped = (value: QualityScope) => requireValue(value.pluginInstanceId === scope.pluginInstanceId && value.projectId === scope.projectId, 'CROSS_PROJECT_REFERENCE', '质量数据范围不匹配')
  const version = (id: string): RuleVersion => {
    const row = db.prepare('SELECT * FROM quality_rule_versions WHERE id=?').get(id)
    requireValue(row, 'NOT_FOUND', '规则版本不存在')
    const payload = String(row.payload_json)
    requireValue(hash(payload) === row.content_sha256, 'CONTENT_CORRUPT', '规则版本内容校验失败')
    return { ...JSON.parse(payload), contentHash: String(row.content_sha256) } as RuleVersion
  }
  const rule = (id: string): RuleRecord => {
    check()
    const row = db.prepare('SELECT * FROM quality_rules WHERE id=? AND (scope_key=? OR scope_key=?)').get(id, scopeKey, 'L0')
    requireValue(row, 'NOT_FOUND', '规则不属于此范围')
    return { id: String(row.id), revision: Number(row.revision), status: row.status as RuleRecord['status'], current: version(String(row.current_version_id)), active: row.active_version_id ? version(String(row.active_version_id)) : null }
  }
  const target = (ref: VersionRef): Target => {
    requireValue(ref.projectId === scope.projectId && ref.pluginInstanceId === scope.pluginInstanceId && dimensions[ref.kind], 'CROSS_PROJECT_REFERENCE', '检测目标类型或范围不匹配')
    const row = db.prepare('SELECT artifact_key,(SELECT MAX(revision) FROM artifact_versions WHERE artifact_id=?) AS latest FROM artifacts WHERE id=? AND project_id=?').get(ref.artifactId, ref.artifactId, scope.projectId)
    requireValue(row, 'NOT_FOUND', '检测目标不存在')
    return { ref, title: String(row.artifact_key), dimension: dimensions[ref.kind]!, latest: row.latest === ref.revision }
  }
  const page = <T>(query: PageQuery, from: string, where: string, parameters: (string | number | null)[], order: string, map: (row: Row) => T, columns = '*'): Page<T> => {
    check(); scoped(query)
    const total = Number(db.prepare(`SELECT COUNT(*) AS n ${from} WHERE ${where}`).get(...parameters)!.n)
    const items = db.prepare(`SELECT ${columns} ${from} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...parameters, query.limit, query.offset).map(map)
    return { items, total, offset: query.offset, limit: query.limit }
  }
  const report = (id: string): QualityReport => {
    check(); project()
    const row = db.prepare('SELECT payload_json FROM quality_reports WHERE id=? AND project_id=?').get(id, scope.projectId)
    requireValue(row, 'NOT_FOUND', '报告不属于此项目')
    const saved = JSON.parse(String(row.payload_json)) as QualityReport
    requireValue(saved.schemaVersion === QUALITY_VERSION, 'UNSUPPORTED_CONTRACT', '此报告格式暂不支持，请使用生成报告的兼容插件版本查看')
    return saved
  }
  return {
    rule,
    rules(query) {
      return page(query, 'FROM quality_rules r JOIN quality_rule_versions v ON r.current_version_id=v.id',
        `(r.scope_key=? OR r.scope_key='L0') AND (?='all' OR r.level=?) AND (?='all' OR r.status=?) AND instr(lower(v.payload_json),lower(?))>0
         AND (json_extract(v.payload_json,'$.dimension') IN ('body','all') OR EXISTS
           (SELECT 1 FROM quality_rule_versions av WHERE av.id=r.active_version_id AND json_extract(av.payload_json,'$.dimension') IN ('body','all')))`,
        [scopeKey, query.level, query.level, query.status, query.status, query.query], 'v.created_at DESC,r.id', row => rule(String(row.rule_id)))
    },
    activeRules(dimension) {
      check()
      return db.prepare("SELECT active_version_id FROM quality_rules WHERE (scope_key=? OR scope_key='L0') AND active_version_id IS NOT NULL ORDER BY level,id")
        .all(scopeKey).map(row => version(String(row.active_version_id))).filter(rule => rule.dimension === 'all' || rule.dimension === dimension)
    },
    saveRule(input) {
      write(); scoped(input); if (scope.projectId !== null) project()
      requireValue((input.level === 'L0') === (scope.projectId === null), 'INVALID_INPUT', 'L0/L1 范围不匹配')
      const before = input.ruleId ? rule(input.ruleId) : null
      requireValue(!before || before.current.projectId === scope.projectId, 'OWNER_MISMATCH', '请切换到 L0 范围修改全局规则')
      requireValue((before?.revision ?? 0) === input.expectedRevision, 'HEAD_CONFLICT', '规则已更新，请刷新后重试')
      const id = before?.id ?? randomUUID(), versionId = randomUUID(), now = new Date().toISOString()
      const payload = canonicalJson({ ...input.content, ruleId: id, versionId, version: (before?.current.version ?? 0) + 1, level: input.level,
        pluginInstanceId: scope.pluginInstanceId, projectId: scope.projectId, createdAt: now })
      if (!before) db.prepare("INSERT INTO quality_rules(id,project_id,level,scope_key,revision,status,current_version_id) VALUES (?,?,?,?,1,'draft',?)").run(id, scope.projectId, input.level, scopeKey, versionId)
      db.prepare('INSERT INTO quality_rule_versions(id,rule_id,version,content_sha256,payload_json,created_at) VALUES (?,?,?,?,?,?)').run(versionId, id, (before?.current.version ?? 0) + 1, hash(payload), payload, now)
      if (before) db.prepare("UPDATE quality_rules SET current_version_id=?,revision=revision+1,status='draft' WHERE id=?").run(versionId, id)
      return rule(id)
    },
    setRuleStatus(input) {
      write(); scoped(input)
      const before = rule(input.ruleId)
      requireValue(before.current.projectId === scope.projectId, 'OWNER_MISMATCH', '规则范围不匹配')
      requireValue(before.revision === input.expectedRevision, 'HEAD_CONFLICT', '规则已更新，请刷新后重试')
      db.prepare('UPDATE quality_rules SET status=?,active_version_id=?,revision=revision+1 WHERE id=?').run(input.status, input.status === 'active' ? before.current.versionId : null, before.id)
      return rule(before.id)
    },
    targets(query) {
      project()
      return page(query, 'FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id',
        `v.project_id=? AND a.kind IN (${Object.keys(dimensions).map(() => '?').join(',')}) AND (?='body' AND a.kind='chapter_body' OR ?='outline' AND a.kind!='chapter_body') AND v.revision=(SELECT MAX(revision) FROM artifact_versions WHERE artifact_id=a.id) AND instr(lower(a.artifact_key),lower(?))>0`,
        [scope.projectId, ...Object.keys(dimensions), query.dimension, query.dimension, query.query], 'a.artifact_key,v.revision DESC', row => target({ pluginInstanceId: scope.pluginInstanceId, projectId: scope.projectId!, artifactId: String(row.artifact_id), versionId: String(row.id), revision: Number(row.revision), kind: String(row.kind), schemaVersion: String(row.schema_key), contentHash: String(row.content_sha256) }), 'v.*,a.kind,a.artifact_key')
    },
    target(ref) {
      check(); project()
      const info = target(ref)
      const session = new Session(db, scope.pluginInstanceId, scope.projectId!, null)
      try {
        const stored = session.snapshot().getVersion(ref)
        requireValue(stored.byteLength <= 800_000 && stored.payload.format !== 'blob', 'INVALID_INPUT', '目标须为不超过 800 KB 的文本或 JSON')
        const text = stored.payload.format === 'text' ? stored.payload.text : stored.payload.rawText ?? canonicalJson(stored.payload.value)
        return { ...info, text, format: stored.payload.format }
      } finally { session.close() }
    },
    report,
    reports(query) {
      project()
      return page(query, 'FROM quality_reports', 'project_id=? AND (?=\'all\' OR dimension=?) AND (?=\'all\' OR verdict=?) AND instr(lower(payload_json),lower(?))>0',
        [scope.projectId, query.dimension, query.dimension, query.verdict, query.verdict, query.query], 'created_at DESC,id DESC', row => ({ ...JSON.parse(String(row.summary_json)), checkCount: Number(row.check_count), issueCount: Number(row.issue_count) } as ReportSummary),
        `json_remove(payload_json,'$.rules','$.checks','$.rawResponse','$.target.text','$.target.format') AS summary_json,
         json_array_length(payload_json,'$.checks') AS check_count,
         (SELECT COUNT(*) FROM json_each(payload_json,'$.checks') WHERE json_extract(value,'$.status')='issue') AS issue_count`)
    },
    logs(query) {
      project()
      const result = page(query, "FROM quality_reports r JOIN json_each(r.payload_json,'$.checks') c", "r.project_id=? AND json_extract(c.value,'$.pollution')=1 AND json_extract(c.value,'$.status') IN ('issue','needs_review') AND instr(lower(c.value),lower(?))>0",
        [scope.projectId, query.query], 'r.created_at DESC,r.id,c.key', row => {
          const saved = JSON.parse(String(row.payload_json)) as QualityReport
          return { reportId: saved.id, target: { ref: saved.target.ref, title: saved.target.title, dimension: saved.target.dimension, latest: saved.target.latest }, createdAt: saved.createdAt, check: JSON.parse(String(row.value)) } as PollutionLog
        })
      return result
    },
    insertReport(value) {
      write(); scoped(value); project()
      requireValue(value.execution === 'running', 'INVALID_INPUT', '初始报告须处于运行中')
      db.prepare('INSERT INTO quality_reports(id,project_id,target_version_id,operation_id,generation,execution,verdict,dimension,title,created_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(value.id, scope.projectId, value.target.ref.versionId, value.operationId, value.generation, value.execution, value.verdict, value.target.dimension, value.target.title, value.createdAt, canonicalJson(value))
      return value
    },
    bindModel(id, generation, model) {
      write()
      const before = report(id)
      requireValue(before.generation === generation && before.execution === 'running' && before.model === null, 'STATE_CONFLICT', '模型派发状态已变化')
      const next = { ...before, model }
      db.prepare('UPDATE quality_reports SET payload_json=? WHERE id=? AND project_id=?').run(canonicalJson(next), id, scope.projectId)
      return next
    },
    finishReport(value) {
      write(); scoped(value)
      const before = report(value.id)
      requireValue(before.execution === 'running' && before.generation === value.generation && value.execution !== 'running', 'STATE_CONFLICT', '报告已完成或属于另一代插件')
      requireValue(before.fingerprint === value.fingerprint && canonicalJson(before.target) === canonicalJson(value.target) && canonicalJson(before.rules) === canonicalJson(value.rules), 'VERSION_MISMATCH', '不可更改冻结的检测输入')
      db.prepare('UPDATE quality_reports SET execution=?,verdict=?,payload_json=? WHERE id=? AND project_id=?').run(value.execution, value.verdict, canonicalJson(value), value.id, scope.projectId)
      return value
    },
  }
}
