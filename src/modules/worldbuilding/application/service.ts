import type { WorldDataPort } from '../../../shared/middleware.js'
import { canonicalJson, CONTRACT_VERSION, VersionRefSchema, type JsonValue, type StorageSnapshot, type VersionRef } from '../../../shared/contracts/index.js'
import { WORLD_LIBRARY, WORLD_SCHEMA, WORLD_SCHEMAS, worldCleanupKey, type WorldReferenceRepair, WORLD_VALIDATION_POLICY, type WorldCommand, type WorldCommandResult, type WorldDetail, type WorldOverview, type WorldQuery, type WorldQueryResult, type WorldReply, type WorldRequest, type WorldVersion } from '../contracts/index.js'
import { ensure, exact, identity, integer, newId, parseWorld, referencesTo, validateWorld, worldSummary, WorldError } from '../domain/world.js'
import { queryWorld } from '../domain/query.js'

const headKey = (id: string) => `story.world.${id}`
/** Sole world authority. Uses shared immutable artifacts/CAS/receipts, never module-private SQL. */
export class WorldService {
  constructor(private readonly storage: WorldDataPort) {}
  private scope(instance: unknown) { identity(instance); ensure(instance === this.storage.instanceId(), '数据库已切换，请保留草稿并刷新后选择目标库', 'DATABASE_CHANGED') }
  private detail(snapshot: StorageSnapshot, ref: VersionRef): WorldDetail {
    ensure(ref.projectId === WORLD_LIBRARY && WORLD_SCHEMAS.some(schema => schema === ref.schemaVersion) && ref.kind === 'resource', '不是世界观版本', 'INVALID_REFERENCE')
    const artifact = snapshot.getVersion(ref)
    ensure(artifact.payload.format === 'json', '世界观版本内容损坏', 'CONTENT_CORRUPT')
    const version = artifact.payload.value as unknown as WorldVersion
    ensure(version && version.revision === ref.revision && ['draft', 'active'].includes(version.status), '世界观版本元数据损坏', 'CONTENT_CORRUPT')
    ensure(version.document.schemaVersion === ref.schemaVersion, '世界观格式与版本引用不一致', 'CONTENT_CORRUPT')
    return { ref, version: { ...version, document: parseWorld(version.document) } }
  }
  query(source: VersionRef, input: WorldQuery, signal?: AbortSignal): WorldQueryResult {
    const requested = VersionRefSchema.parse(source); this.scope(requested.pluginInstanceId)
    return this.storage.openSnapshot(WORLD_LIBRARY, snapshot => {
      const repair = snapshot.getCommandReceipt('story', worldCleanupKey(requested)) as WorldReferenceRepair | null
      if (repair) {
        ensure(canonicalJson(repair.before) === canonicalJson(requested), '清理回执与请求来源不一致', 'INVALID_REFERENCE')
        const after = VersionRefSchema.parse(repair.after)
        ensure(['pluginInstanceId', 'projectId', 'artifactId', 'versionId', 'revision', 'kind'].every(key => requested[key as keyof VersionRef] === after[key as keyof VersionRef]), '清理不能改绑另一个世界版本', 'INVALID_REFERENCE')
      }
      const ref = repair ? repair.after : requested, detail = this.detail(snapshot, ref)
      ensure(detail.version.status === 'active' && detail.version.confirmation, '查询需要已发布的精确世界版本', 'UNPUBLISHED_SOURCE')
      ensure(snapshot.describeKnowledge(ref).decision?.decision === 'confirmed', '世界版本确认已失效', 'UNCONFIRMED_SOURCE')
      signal?.throwIfAborted()
      return { ...queryWorld(detail.version.document, ref, input, signal), ...(repair ? { sourceRepair: { ...repair, summary: worldSummary(detail.version.document) } } : {}) }
    }, signal)
  }
  overview(signal?: AbortSignal): WorldOverview {
    const status = this.storage.status(signal)
    if (!status.databaseReady) return { ready: false, message: status.message, pluginInstanceId: null, worlds: [] }
    const pluginInstanceId = this.storage.instanceId()
    const worlds = this.storage.openSnapshot(WORLD_LIBRARY, s => s.listHeads('story.world.').filter(h => h.key.endsWith('.latest')).map(h => {
      const { version: v } = this.detail(s, h.ref)
      return { worldId: v.worldId, name: v.document.name || '未命名世界', revision: v.revision, status: v.status, updatedAt: v.createdAt, active: s.getHead(`${headKey(v.worldId)}.active`)?.ref ?? null }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), signal)
    return { ready: true, message: '世界观已连接共享数据库', pluginInstanceId, worlds }
  }
  read(instance: string, id: string, revision: number | null, signal?: AbortSignal): WorldDetail {
    this.scope(instance); identity(id); if (revision !== null) integer(revision)
    return this.storage.openSnapshot(WORLD_LIBRARY, s => {
      const head = s.getHead(`${headKey(id)}.${revision === null ? 'latest' : `version.${revision}`}`)
      ensure(head, '世界观版本不存在', 'NOT_FOUND'); ensure(head.ref.pluginInstanceId === instance, '数据库已切换', 'DATABASE_CHANGED')
      return this.detail(s, head.ref)
    }, signal)
  }
  save(raw: unknown, signal?: AbortSignal): WorldCommandResult {
    const c = exact(raw, ['pluginInstanceId','operationId','worldId','expectedRevision','action','document','authorConfirmed'])
    this.scope(c.pluginInstanceId); identity(c.operationId); identity(c.worldId); integer(c.expectedRevision)
    ensure(c.action === 'save' || c.action === 'publish', '世界观操作无效'); ensure(typeof c.authorConfirmed === 'boolean', '确认状态无效')
    const request = { ...c, document: parseWorld(c.document) } as unknown as WorldCommand
    const key = headKey(request.worldId)
    // The repository checks idempotency before CAS. A lost response never creates a second version.
    return this.storage.repositoryFor('story', WORLD_LIBRARY).command({ contractVersion: CONTRACT_VERSION, pluginInstanceId: request.pluginInstanceId,
      projectId: WORLD_LIBRARY, operationId: `world-${request.operationId}`, scope: { targetIds: [request.worldId], referenceIds: [] }, expectedVersions: [], input: request as unknown as JsonValue }, tx => {
      const head = tx.getHead(`${key}.latest`), before = head ? this.detail(tx, head.ref) : null
      ensure((before?.version.revision ?? 0) === request.expectedRevision, '已有新版本，请保留本地输入，查看最新版本后再合并', 'REVISION_CONFLICT')
      const document = request.document
      if (before && request.action === 'save') for (const old of before.version.document.records) {
        const renamed = document.records.find(r => r.id === old.id)
        if (renamed && old.name.trim() && renamed.name !== old.name && !document.terms.some(t => t.targetId === old.id && t.name === old.name)) {
          document.terms.push({ id: newId(), name: old.name, targetId: old.id, context: `旧称（v${before.version.revision}）`, period: old.scope.time })
        }
      }
      parseWorld(document)
      if (before) for (const record of before.version.document.records) if (!document.records.some(r => r.id === record.id)) {
        const impact = referencesTo(document, record.id)
        ensure(!impact.length, `无法删除“${record.name}”，仍被引用：${impact.join('；')}`, 'REFERENCED_RECORD')
      }
      const issues = validateWorld(document), same = before && before.ref.schemaVersion === WORLD_SCHEMA && canonicalJson(before.version.document) === canonicalJson(document)
      if (request.action === 'publish') {
        ensure(request.authorConfirmed, '发布需要作者确认精确版本', 'AUTHOR_CONFIRMATION_REQUIRED')
        ensure(before && same, '请先保存本次修改，再确认发布已保存的精确版本', 'SAVE_REQUIRED')
        if (issues.some(i => i.blocking)) throw new WorldError('PUBLICATION_BLOCKED', '还有阻断问题，请处理后发布', issues)
      }
      if (same && (request.action === 'save' || before!.version.status === 'active')) return { detail: before!, unchanged: true }
      ensure((before?.version.revision ?? 0) < 500, '当前世界已达 500 个版本上限，请导出归档', 'VERSION_LIMIT')
      if (!tx.getProject()) tx.createProject('世界观资料库')
      const createdAt = new Date().toISOString(), status = request.action === 'publish' ? 'active' : 'draft'
      const version: WorldVersion = { worldId: request.worldId, revision: request.expectedRevision + 1, document, status, createdAt, actor: 'author', previous: before?.ref ?? null, issues,
        confirmation: status === 'active' ? { actor: 'author', confirmedAt: createdAt, policy: WORLD_VALIDATION_POLICY } : null }
      const ref = tx.appendArtifact({ key: `world-${request.worldId}`, kind: 'resource', schemaVersion: document.schemaVersion, payload: { format: 'json', value: version as unknown as JsonValue },
        metadata: { module: 'worldbuilding', operationId: request.operationId }, sources: before ? [{ ref: before.ref, relation: 'revises' }] : [] })
      tx.setHead(`${key}.latest`, ref, head?.revision ?? 0)
      tx.setHead(`${key}.version.${version.revision}`, ref, 0)
      if (status === 'active') {
        tx.setHead(`${key}.active`, ref, tx.getHead(`${key}.active`)?.revision ?? 0)
        tx.decide(ref, 'confirmed', 'author', `作者确认；${WORLD_VALIDATION_POLICY} 校验无阻断`)
      }
      tx.emit(`story.world.${status === 'active' ? 'published' : 'saved'}`, { worldId: request.worldId, ref: ref as unknown as JsonValue })
      return { detail: { ref, version }, unchanged: false }
    }, signal).result
  }
  invoke(request: WorldRequest, signal?: AbortSignal): WorldReply {
    try {
      signal?.throwIfAborted()
      ensure(request && typeof request === 'object' && !Array.isArray(request), '世界观请求无效')
      if (request.action === 'overview') { exact(request, ['action']); return { ok: true, data: this.overview(signal) } }
      if (request.action === 'command') { exact(request, ['action','command']); return { ok: true, data: this.save(request.command, signal) } }
      if (request.action === 'read') { exact(request, ['action','pluginInstanceId','worldId','revision']); return { ok: true, data: this.read(request.pluginInstanceId, request.worldId, request.revision, signal) } }
      if (request.action === 'query') { exact(request, ['action','sourceVersion','query']); return { ok: true, data: this.query(request.sourceVersion, request.query, signal) } }
      if (request.action === 'history') {
        exact(request, ['action','pluginInstanceId','worldId']); this.scope(request.pluginInstanceId); identity(request.worldId)
        return { ok: true, data: this.storage.openSnapshot(WORLD_LIBRARY, s => s.listHeads(`${headKey(request.worldId)}.version.`).map(h => {
          ensure(h.ref.pluginInstanceId === request.pluginInstanceId, '数据库已切换', 'DATABASE_CHANGED'); return this.detail(s, h.ref)
        }).sort((a, b) => b.version.revision - a.version.revision), signal) }
      }
      if (request.action === 'receipt') {
        exact(request, ['action','pluginInstanceId','operationId']); this.scope(request.pluginInstanceId); identity(request.operationId)
        const result = this.storage.openSnapshot(WORLD_LIBRARY, s => s.getCommandReceipt('story', `world-${request.operationId}`), signal) as unknown as WorldCommandResult | null
        if (result) ensure(result.detail.ref.pluginInstanceId === request.pluginInstanceId, '数据库已切换', 'DATABASE_CHANGED')
        return { ok: true, data: result }
      }
      throw new WorldError('INVALID_INPUT', '未知世界观操作')
    } catch (error) {
      return { ok: false, code: error instanceof WorldError ? error.code : (error as { code?: string }).code ?? 'WORLD_UNAVAILABLE',
        message: error instanceof WorldError ? error.message : '世界观操作未完成，请检查数据库状态后重试', issues: error instanceof WorldError ? error.issues : [] }
    }
  }
}
