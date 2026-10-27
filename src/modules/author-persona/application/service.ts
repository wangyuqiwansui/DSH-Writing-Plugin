import { createHash } from 'node:crypto'
import type { PersonaDataPort } from '../../../shared/middleware.js'
import { canonicalJson, CONTRACT_VERSION, type JsonValue, type StorageSnapshot, type VersionRef } from '../../../shared/contracts/index.js'
import { PERSONA_LIBRARY, PERSONA_SCHEMA, LEGACY_PERSONA_SCHEMA, PERSONA_API_VERSION, PROMPT_TEMPLATE_ID, type PersonaCommand, type PersonaCommandResult, type PersonaDetail, type PersonaOverview, type PersonaProjection, type PersonaReply, type PersonaRequest, type PersonaVersion } from '../contracts/index.js'
import { ensure, exact, expressionText, identity, integer, parsePersona, parseStoredPersona, PersonaError, validatePersona } from '../domain/persona.js'

const key = (id: string) => `story.persona.${id}`
const hash = (text: string) => 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex')
/** Single domain owner: immutable versions, release conditions and exact expression projection. */
export class PersonaService {
  constructor(private readonly data: PersonaDataPort) {}
  private scope(instance: unknown) { identity(instance); ensure(instance === this.data.instanceId(), '数据库已切换；请保留草稿并返回原数据库处理', 'DATABASE_CHANGED') }
  private detail(snapshot: StorageSnapshot, ref: VersionRef): PersonaDetail {
    ensure(ref.projectId === PERSONA_LIBRARY && (ref.schemaVersion === PERSONA_SCHEMA || ref.schemaVersion === LEGACY_PERSONA_SCHEMA) && ref.kind === 'resource', '不是作者人格版本', 'INVALID_REFERENCE')
    const artifact = snapshot.getVersion(ref)
    ensure(artifact.payload.format === 'json', '人格版本内容损坏', 'CONTENT_CORRUPT')
    const version = artifact.payload.value as unknown as PersonaVersion
    ensure(version && version.revision === ref.revision && ['draft', 'published'].includes(version.status), '人格版本元数据损坏', 'CONTENT_CORRUPT')
    const document = parseStoredPersona(version.document)
    ensure(document.schemaVersion === ref.schemaVersion, '人格文档与版本格式不一致', 'CONTENT_CORRUPT')
    ensure(hash(expressionText(document)) === version.textHash, '人格表达摘要不一致', 'CONTENT_CORRUPT')
    ensure(version.qualification?.sourceReview === 'not_run' && version.qualification.literaryTrial === 'not_run', '不支持的人格资质', 'CONTENT_CORRUPT')
    return { ref, version }
  }
  overview(signal?: AbortSignal): PersonaOverview {
    const status = this.data.status(signal)
    if (!status.databaseReady) return { apiVersion: PERSONA_API_VERSION, ready: false, message: status.message, pluginInstanceId: null, personas: [] }
    const pluginInstanceId = this.data.instanceId()
    const personas = this.data.openSnapshot(PERSONA_LIBRARY, s => s.listHeads('story.persona.').filter(h => h.key.endsWith('.latest')).map(h => {
      const { version: v } = this.detail(s, h.ref)
      return { personaId: v.personaId, name: v.document.name || '未命名人格', revision: v.revision, status: v.status, updatedAt: v.createdAt, published: s.getHead(`${key(v.personaId)}.published`)?.ref ?? null }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), signal)
    return { apiVersion: PERSONA_API_VERSION, ready: true, message: '作者人格资料库已连接', pluginInstanceId, personas }
  }
  read(instance: string, id: string, revision: number | null, signal?: AbortSignal): PersonaDetail {
    this.scope(instance); identity(id); if (revision !== null) integer(revision, 1)
    return this.data.openSnapshot(PERSONA_LIBRARY, s => {
      const h = s.getHead(`${key(id)}.${revision === null ? 'latest' : `version.${revision}`}`)
      ensure(h, '人格版本不存在', 'NOT_FOUND'); ensure(h.ref.pluginInstanceId === instance, '数据库已切换', 'DATABASE_CHANGED')
      return this.detail(s, h.ref)
    }, signal)
  }
  projection(instance: string, id: string, revision: number, signal?: AbortSignal): PersonaProjection {
    integer(revision, 1)
    const { ref, version: v } = this.read(instance, id, revision, signal)
    ensure(v.status === 'published' && v.confirmation, '只能交付作者确认的已发布精确版本', 'NOT_PUBLISHED')
    const common = { sourceVersion: ref, name: v.document.name, purpose: 'writing_style' as const, authority: 'expression_only' as const,
      text: expressionText(v.document), textHash: v.textHash, literaryTrial: 'not_run' as const }
    if (v.document.schemaVersion === LEGACY_PERSONA_SCHEMA) {
      ensure(v.confirmation.policy === 'manual-expression-v1', '历史发布策略无效', 'CONTENT_CORRUPT')
      return { ...common, schemaVersion: 'writing-author-persona-projection-v1', mode: v.document.mode }
    }
    ensure(v.confirmation.policy === 'prompt-template-v1' && !validatePersona(v.document).some(i => i.blocking), '发布版本未通过统一 Prompt 模板校验', 'NOT_PUBLISHED')
    return { ...common, schemaVersion: 'writing-author-persona-projection-v2', templateId: PROMPT_TEMPLATE_ID }
  }
  save(raw: unknown, signal?: AbortSignal): PersonaCommandResult {
    const c = exact(raw, ['pluginInstanceId', 'operationId', 'personaId', 'expectedRevision', 'action', 'document', 'authorConfirmed'])
    this.scope(c.pluginInstanceId); identity(c.operationId); identity(c.personaId); integer(c.expectedRevision)
    ensure(c.action === 'save' || c.action === 'publish', '人格操作无效'); ensure(typeof c.authorConfirmed === 'boolean', '确认状态无效')
    const request = { ...c, document: parsePersona(c.document) } as unknown as PersonaCommand
    return this.data.repositoryFor('story', PERSONA_LIBRARY).command({ contractVersion: CONTRACT_VERSION, pluginInstanceId: request.pluginInstanceId,
      projectId: PERSONA_LIBRARY, operationId: `persona-${request.operationId}`, scope: { targetIds: [request.personaId], referenceIds: [] }, expectedVersions: [], input: request as unknown as JsonValue }, tx => {
      const prefix = key(request.personaId), head = tx.getHead(`${prefix}.latest`), before = head ? this.detail(tx, head.ref) : null
      ensure((before?.version.revision ?? 0) === request.expectedRevision, '已有新版本；本地输入已保留，请查看最新版本后合并或另存', 'REVISION_CONFLICT')
      const document = request.document, issues = validatePersona(document), same = before && canonicalJson(before.version.document) === canonicalJson(document)
      if (request.action === 'publish') {
        ensure(request.authorConfirmed, '请确认发布已保存的精确版本', 'AUTHOR_CONFIRMATION_REQUIRED')
        ensure(before && same, '请先保存修改，再发布已保存的精确版本', 'SAVE_REQUIRED')
        if (issues.some(i => i.blocking)) throw new PersonaError('PUBLICATION_BLOCKED', '请处理发布阻断项', issues)
      }
      if (same && (request.action === 'save' || before!.version.status === 'published')) return { detail: before!, unchanged: true }
      ensure(request.expectedRevision < 500, '人格已达 500 个版本，请导出归档', 'VERSION_LIMIT')
      if (!tx.getProject()) tx.createProject('作者人格资料库')
      const createdAt = new Date().toISOString(), status = request.action === 'publish' ? 'published' : 'draft'
      const version: PersonaVersion = { personaId: request.personaId, revision: request.expectedRevision + 1, status, document, createdAt, previous: before?.ref ?? null, issues,
        confirmation: status === 'published' ? { actor: 'author', policy: 'prompt-template-v1', confirmedAt: createdAt } : null,
        qualification: { sourceReview: 'not_run', literaryTrial: 'not_run' }, textHash: hash(expressionText(document)) }
      const ref = tx.appendArtifact({ key: `persona-${request.personaId}`, kind: 'resource', schemaVersion: PERSONA_SCHEMA,
        payload: { format: 'json', value: version as unknown as JsonValue }, metadata: { module: 'author-persona', operationId: request.operationId }, sources: before ? [{ ref: before.ref, relation: 'revises' }] : [] })
      tx.setHead(`${prefix}.latest`, ref, head?.revision ?? 0); tx.setHead(`${prefix}.version.${version.revision}`, ref, 0)
      if (status === 'published') {
        tx.setHead(`${prefix}.published`, ref, tx.getHead(`${prefix}.published`)?.revision ?? 0)
        tx.decide(ref, 'confirmed', 'author', '统一 Prompt 模板校验与作者确认；未执行来源审核或文学实测')
      }
      tx.emit(`story.persona.${status}`, { personaId: request.personaId, ref: ref as unknown as JsonValue })
      return { detail: { ref, version }, unchanged: false }
    }, signal).result
  }
  invoke(request: PersonaRequest, signal?: AbortSignal): PersonaReply {
    try {
      signal?.throwIfAborted()
      ensure(request && typeof request === 'object' && !Array.isArray(request), '人格请求无效')
      if (request.action === 'overview') { exact(request, ['action']); return { ok: true, data: this.overview(signal) } }
      if (request.action === 'command') { exact(request, ['action', 'command']); return { ok: true, data: this.save(request.command, signal) } }
      if (request.action === 'read' || request.action === 'projection') {
        exact(request, ['action', 'pluginInstanceId', 'personaId', 'revision'])
        return { ok: true, data: request.action === 'read' ? this.read(request.pluginInstanceId, request.personaId, request.revision, signal) : this.projection(request.pluginInstanceId, request.personaId, request.revision, signal) }
      }
      if (request.action === 'history') {
        exact(request, ['action', 'pluginInstanceId', 'personaId']); this.scope(request.pluginInstanceId); identity(request.personaId)
        return { ok: true, data: this.data.openSnapshot(PERSONA_LIBRARY, s => s.listHeads(`${key(request.personaId)}.version.`).map(h => this.detail(s, h.ref)).sort((a, b) => b.version.revision - a.version.revision), signal) }
      }
      if (request.action === 'receipt') {
        exact(request, ['action', 'pluginInstanceId', 'operationId']); this.scope(request.pluginInstanceId); identity(request.operationId)
        return { ok: true, data: this.data.openSnapshot(PERSONA_LIBRARY, s => s.getCommandReceipt('story', `persona-${request.operationId}`), signal) as unknown as PersonaCommandResult | null }
      }
      throw new PersonaError('INVALID_INPUT', '未知人格操作')
    } catch (error) {
      return { ok: false, code: error instanceof PersonaError ? error.code : (error as { code?: string }).code ?? 'PERSONA_UNAVAILABLE',
        message: error instanceof PersonaError ? error.message : '人格操作未完成，请检查数据库状态后重试', issues: error instanceof PersonaError ? error.issues : [] }
    }
  }
}
