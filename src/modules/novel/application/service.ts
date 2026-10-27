import type { WorldReferenceRepair } from '../../worldbuilding/contracts/index.js'
import {
  NOVEL_SCHEMA, authority, events, latest, moduleForKind, splitIds,
  type AssetKind, type DocumentKind, type Fields, type NovelAsset, type NovelDocument,
  type NovelIssue, type NovelProject, type NovelRevision, type NovelWorkspace, type SaveDocument, type SourceRef,
} from '../contracts/index.js'
import { blankFields, validateFields } from '../domain/fields.js'
import { VersionRefSchema, type VersionRef } from '../../../shared/contracts/index.js'

export class NovelError extends Error {
  constructor(public readonly code: string, message: string, public readonly issues: NovelIssue[] = []) { super(message) }
}
const fail = (code: string, message: string): never => { throw new NovelError(code, message) }
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze) }
  return value
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}
export async function contentHash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))
  return 'sha256:' + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}
/** Repairs only authenticated directory-cleanup identities; novel prose, IDs and revision status stay intact. */
export async function repairWorldReferences(workspace: NovelWorkspace, repair: WorldReferenceRepair, signal?: AbortSignal): Promise<NovelWorkspace> {
  const before = VersionRefSchema.parse(repair.before), after = VersionRefSchema.parse(repair.after)
  if (before.projectId !== 'writing-world-library' || before.kind !== 'resource' || after.schemaVersion !== 'writing-world-v3'
    || !['pluginInstanceId', 'projectId', 'artifactId', 'versionId', 'revision', 'kind'].every(key => before[key as keyof VersionRef] === after[key as keyof VersionRef])
    || typeof repair.summary !== 'string' || !repair.summary.trim() || repair.summary.length > 500_000) return fail('INVALID_WORLD_REPAIR', '旧目录清理引用无效')
  const next = clone(workspace), changed = new Map<string, { before: string; after: string }>()
  for (const asset of next.assets) {
    if (asset.kind !== 'world' || !asset.sourceVersion || canonical(asset.sourceVersion) !== canonical(before)) continue
    const oldHash = asset.contentHash
    asset.content = repair.summary; asset.sourceVersion = after
    asset.contentHash = await contentHash({ kind: asset.kind, content: asset.content, sourceVersion: after })
    changed.set(asset.id, { before: oldHash, after: asset.contentHash })
  }
  const update = (refs: SourceRef[]) => refs.map(ref => {
    const hashes = ref.type === 'asset' && changed.get(ref.objectId)
    return hashes && ref.contentHash === hashes.before ? { ...ref, contentHash: hashes.after } : ref
  })
  for (const doc of next.documents) for (const r of doc.revisions) {
    r.sourceRefs = update(r.sourceRefs)
    if (r.confirmation) r.confirmation.sourceRefs = update(r.confirmation.sourceRefs)
  }
  signal?.throwIfAborted()
  return next
}
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`
const now = () => new Date().toISOString()
const parentKinds: Partial<Record<DocumentKind, DocumentKind>> = { volume: 'outline', unit: 'volume', chapter: 'unit', body: 'chapter' }
const singletons: DocumentKind[] = ['assets', 'settings', 'outline']
const refFor = (doc: NovelDocument, r: NovelRevision): SourceRef => ({ type: 'document', objectId: doc.id, revision: r.revision, contentHash: r.contentHash, purpose: 'story_fact' })
const assetRef = (asset: NovelAsset): SourceRef => ({ type: 'asset', objectId: asset.id, revision: asset.revision, contentHash: asset.contentHash, purpose: asset.kind === 'persona' ? 'writing_style' : asset.kind === 'world' ? 'story_fact' : 'reference' })

/** Session-only application owner. No Host, storage, SQL, model, or browser persistence dependency. */
export class NovelService {
  private state: NovelWorkspace = freeze({ projects: [], assets: [], documents: [] })
  private disposed = false
  private creations = new Map<string, { signature: string; projectId: string }>()
  getSnapshot = (): NovelWorkspace => this.state
  private alive() { if (this.disposed) fail('DISPOSED', '小说会话已结束') }
  private commit(next: NovelWorkspace) { this.alive(); this.state = freeze(next) }
  project(projectId: string): NovelProject { return this.state.projects.find(p => p.id === projectId) ?? fail('NOT_FOUND', '小说不存在') }
  document(documentId: string, projectId?: string): NovelDocument {
    const doc = this.state.documents.find(d => d.id === documentId && (!projectId || d.projectId === projectId))
    return doc ?? fail('NOT_FOUND', '当前小说中找不到此对象')
  }
  documents(projectId: string, kind?: DocumentKind): NovelDocument[] {
    return this.state.documents.filter(d => d.projectId === projectId && (!kind || d.kind === kind)).sort((a, b) => a.order - b.order)
  }
  private binding(projectId: string): Fields | undefined {
    const doc = this.documents(projectId, 'assets')[0]; return doc && authority(doc)?.fields
  }
  private replace(doc: NovelDocument) {
    this.commit({ ...this.state, documents: [...this.state.documents.filter(d => d.id !== doc.id), doc] })
  }
  async addAsset(kind: AssetKind, name: string, content: string, sourceVersion?: VersionRef): Promise<NovelAsset> {
    this.alive()
    if (!['persona', 'world', 'reference'].includes(kind) || !name.trim() || !content.trim() || name.length > 200 || content.length > 500_000) fail('INVALID_ASSET', '请填写有效的资产类型、名称和内容（内容最多 50 万字符）')
    if (sourceVersion) {
      sourceVersion = VersionRefSchema.parse(sourceVersion)
      const expected = kind === 'world' ? { schemas: ['writing-world-v1', 'writing-world-v2', 'writing-world-v3'], project: 'writing-world-library' } : kind === 'persona' ? { schemas: ['writing-author-persona-v1', 'writing-author-persona-v2'], project: 'writing-author-persona-library' } : null
      if (!expected || !expected.schemas.includes(sourceVersion.schemaVersion) || sourceVersion.projectId !== expected.project || sourceVersion.kind !== 'resource') fail('INVALID_ASSET', '资产精确版本引用无效')
    }
    const hash = await contentHash({ kind, content, ...(sourceVersion ? { sourceVersion } : {}) })
    const prior = sourceVersion && this.state.assets.find(a => a.sourceVersion?.versionId === sourceVersion.versionId && a.sourceVersion.pluginInstanceId === sourceVersion.pluginInstanceId)
    if (prior) {
      if (prior.contentHash !== hash) fail('INVALID_ASSET', '同一资产版本的内容不一致')
      return prior
    }
    const asset: NovelAsset = { id: id('asset'), kind, name: name.trim(), content, revision: sourceVersion?.revision ?? 1, contentHash: hash, available: true, ...(sourceVersion ? { sourceVersion } : {}) }
    this.commit({ ...this.state, assets: [...this.state.assets, asset] }); return asset
  }
  setAssetAvailable(assetId: string, available: boolean): void {
    this.alive()
    if (!this.state.assets.some(a => a.id === assetId)) fail('NOT_FOUND', '资产不存在')
    this.commit({ ...this.state, assets: this.state.assets.map(a => a.id === assetId ? { ...a, available } : a) })
  }
  async repairWorldSource(repair: WorldReferenceRepair, signal?: AbortSignal): Promise<void> {
    this.alive(); const before = this.state
    const next = await repairWorldReferences(before, repair, signal)
    this.alive(); signal?.throwIfAborted()
    if (this.state !== before) fail('REVISION_CONFLICT', '小说内容已变化，请重新查询以同步来源')
    this.commit(next)
  }
  worldSource(projectId: string): VersionRef {
    this.alive(); this.project(projectId)
    const binding = this.documents(projectId, 'assets')[0]
    const confirmed = binding && authority(binding)
    if (!confirmed || this.sourceIssues(binding).length) return fail('INVALID_BINDING', '请先确认当前小说的有效资产绑定')
    const asset = this.selectedAsset(confirmed.fields.worldId!, 'world')
    if (!asset.sourceVersion) return fail('MISSING_WORLD_SOURCE', '手动登记的世界观只有文本；请从世界观页面加入并绑定正式版本后查询')
    return clone(asset.sourceVersion)
  }
  private selectedAsset(assetId: string, kind: AssetKind): NovelAsset {
    return this.state.assets.find(a => a.id === assetId && a.kind === kind && a.available) ?? fail('INVALID_ASSET', `${kind === 'persona' ? '作者人格' : kind === 'world' ? '世界观' : '参考资产'}未指定、类型错误或已停用`)
  }
  async createProject(input: { title: string; personaId: string; worldId: string; referenceIds?: string; idempotencyKey: string }): Promise<NovelProject> {
    this.alive()
    if (!input.title.trim() || !input.idempotencyKey.trim()) fail('INVALID_INPUT', '请填写小说名称')
    const signature = canonical(input)
    const existing = this.creations.get(input.idempotencyKey)
    if (existing) {
      if (existing.signature !== signature) fail('IDEMPOTENCY_CONFLICT', '同一创建请求不能更换内容')
      return this.project(existing.projectId)
    }
    const fields = { title: input.title.trim(), personaId: input.personaId, worldId: input.worldId, referenceIds: input.referenceIds ?? '' }
    const hash = await contentHash(fields)
    // All checks and the final commit run synchronously after hashing, including a duplicate retry.
    this.alive()
    const repeated = this.creations.get(input.idempotencyKey)
    if (repeated) { if (repeated.signature !== signature) fail('IDEMPOTENCY_CONFLICT', '创建请求内容冲突'); return this.project(repeated.projectId) }
    const sourceRefs = [this.selectedAsset(input.personaId, 'persona'), this.selectedAsset(input.worldId, 'world'), ...splitIds(input.referenceIds).map(i => this.selectedAsset(i, 'reference'))].map(assetRef)
    const createdAt = now(), project: NovelProject = { id: id('novel'), title: fields.title, createdAt }
    const revision: NovelRevision = { schemaVersion: NOVEL_SCHEMA, revision: 1, fields, contentHash: hash, sourceRefs, status: 'confirmed', origin: 'manual', createdAt,
      confirmation: { revision: 1, contentHash: hash, sourceRefs: clone(sourceRefs), confirmedAt: createdAt, actor: 'author' } }
    const binding: NovelDocument = { id: id('assets'), projectId: project.id, kind: 'assets', parentId: null, order: 1, revisions: [revision], confirmedRevision: 1, createdAt, updatedAt: createdAt }
    this.commit({ ...this.state, projects: [...this.state.projects, project], documents: [...this.state.documents, binding] })
    this.creations.set(input.idempotencyKey, { signature, projectId: project.id }); return project
  }
  private structure(command: SaveDocument): void {
    this.project(command.projectId)
    if (typeof command.kind !== 'string' || !Object.hasOwn(moduleForKind, command.kind)) fail('INVALID_KIND', '未知小说对象类型')
    const parentKind = parentKinds[command.kind]
    if (parentKind) {
      if (!command.parentId) fail('MISSING_PARENT', `请先选择所属${parentKind === 'outline' ? '总纲' : parentKind === 'volume' ? '卷' : parentKind === 'unit' ? '单元' : '章节'}`)
      if (this.document(command.parentId!, command.projectId).kind !== parentKind) fail('INVALID_PARENT', '所属对象类型不正确')
    } else if (command.parentId !== null) fail('INVALID_PARENT', '此对象不应有父级')
    if (command.id) {
      const doc = this.document(command.id, command.projectId)
      if (doc.kind !== command.kind || doc.parentId !== command.parentId) fail('IDENTITY_CONFLICT', '不能通过编辑改变对象类型或归属')
      if (latest(doc).revision !== command.expectedRevision) fail('REVISION_CONFLICT', '内容已有新版本，请重新打开后再编辑；本次输入仍保留')
    } else {
      if (command.expectedRevision !== 0) fail('REVISION_CONFLICT', '新对象的基准版本必须为 0')
      if (singletons.includes(command.kind) && this.documents(command.projectId, command.kind).length) fail('DUPLICATE', '此小说已经存在该对象，请打开现有版本')
      if (command.kind === 'body' && this.documents(command.projectId, 'body').some(d => d.parentId === command.parentId)) fail('DUPLICATE', '此章节已有正文，请打开现有版本')
    }
  }
  private previous(doc: NovelDocument): NovelDocument | undefined {
    if (!['volume', 'unit', 'chapter'].includes(doc.kind)) return
    return this.documents(doc.projectId, doc.kind).filter(d => d.parentId === doc.parentId && d.order < doc.order).at(-1)
  }
  private sources(doc: NovelDocument, fields: Fields): { refs: SourceRef[]; issues: NovelIssue[] } {
    const refs: SourceRef[] = [], issues: NovelIssue[] = [], module = moduleForKind[doc.kind]
    const missing = (message: string, target?: NovelDocument, destination = module) => issues.push({ code: 'MISSING_SOURCE', message, targetId: target?.id, module: target ? moduleForKind[target.kind] : destination })
    const need = (target?: NovelDocument, label = '上游', destination = module) => {
      const r = target && authority(target)
      if (!target || !r) { missing(`${label}尚未确认`, target, destination); return }
      refs.push(refFor(target, r))
    }
    const binding = doc.kind === 'assets' ? fields : this.binding(doc.projectId)
    const needAsset = (assetId: string | undefined, kind: AssetKind) => {
      const asset = this.state.assets.find(a => a.id === assetId && a.kind === kind && a.available)
      if (!asset) missing(`${kind === 'persona' ? '作者人格' : kind === 'world' ? '世界观' : '参考资产'}不可用，请到资产配置处理`, undefined, 'assets')
      else refs.push(assetRef(asset))
    }
    if (doc.kind === 'assets') {
      needAsset(binding?.personaId, 'persona'); needAsset(binding?.worldId, 'world')
      splitIds(binding?.referenceIds).forEach(i => needAsset(i, 'reference'))
    } else {
      if (!binding) missing('请先确认本小说的双资产绑定', this.documents(doc.projectId, 'assets')[0], 'assets')
      if (['settings', 'character', 'body'].includes(doc.kind)) needAsset(binding?.worldId, 'world')
      if (doc.kind === 'body') { needAsset(binding?.personaId, 'persona'); splitIds(binding?.referenceIds).forEach(i => needAsset(i, 'reference')) }
      if (doc.kind === 'outline' || doc.kind === 'body') need(this.documents(doc.projectId, 'settings')[0], '小说设定', 'settings')
      if (doc.parentId) need(this.document(doc.parentId, doc.projectId), '直接上游')
      const previous = this.previous(doc)
      if (previous) need(previous, '前一项交接')
      let characterIds = splitIds(fields.characterIds)
      if (doc.kind === 'body' && doc.parentId) characterIds = splitIds(authority(this.document(doc.parentId))?.fields.characterIds)
      for (const characterId of characterIds) {
        const character = this.documents(doc.projectId, 'character').find(d => d.id === characterId)
        need(character, `角色 ${characterId}`, 'characters')
      }
      if (doc.kind === 'body' && doc.parentId) {
        const chapter = this.document(doc.parentId)
        const ordered = this.orderedChapters(doc.projectId), position = ordered.findIndex(c => c.id === chapter.id)
        if (position > 0) missing('前序正式事实尚不可用：当前版本未接入正文入库与写后维护，仍可编辑草稿', ordered[position - 1], 'body')
      }
    }
    return { refs: [...new Map(refs.map(r => [r.type + r.objectId, r])).values()], issues }
  }
  orderedChapters(projectId: string): NovelDocument[] {
    return this.documents(projectId, 'volume').flatMap(v => this.documents(projectId, 'unit').filter(u => u.parentId === v.id).flatMap(u => this.documents(projectId, 'chapter').filter(c => c.parentId === u.id)))
  }
  sourceIssues(doc: NovelDocument, revision = latest(doc), visited = new Set<string>()): NovelIssue[] {
    if (visited.has(doc.id)) return [{ code: 'CYCLIC_SOURCE', message: '来源存在循环引用', module: moduleForKind[doc.kind], targetId: doc.id }]
    const path = new Set(visited).add(doc.id), issues: NovelIssue[] = [], binding = this.binding(doc.projectId)
    for (const ref of revision.sourceRefs) {
      if (ref.type === 'asset') {
        const asset = this.state.assets.find(a => a.id === ref.objectId)
        const selected = doc.kind === 'assets' || (asset?.kind === 'world' ? binding?.worldId === asset.id : asset?.kind === 'persona' ? binding?.personaId === asset.id : splitIds(binding?.referenceIds).includes(ref.objectId))
        if (!asset?.available || !selected || asset.revision !== ref.revision || asset.contentHash !== ref.contentHash) issues.push({ code: 'STALE_SOURCE', message: `资产 ${asset?.name ?? ref.objectId} 已更换或不可用`, module: 'assets' })
      } else {
        const target = this.state.documents.find(d => d.id === ref.objectId && d.projectId === doc.projectId), current = target && authority(target)
        if (!target || !current || current.revision !== ref.revision || current.contentHash !== ref.contentHash) issues.push({ code: 'STALE_SOURCE', message: `来源 ${target ? latest(target).fields.title || target.kind : ref.objectId} 已更新或撤销，请复核后另存版本`, module: target ? moduleForKind[target.kind] : moduleForKind[doc.kind], targetId: target?.id })
        else issues.push(...this.sourceIssues(target, current, path))
      }
    }
    return issues
  }
  check(documentId: string, revisionNumber?: number): NovelIssue[] {
    const doc = this.document(documentId), revision = revisionNumber ? doc.revisions.find(r => r.revision === revisionNumber)! : latest(doc)
    if (!revision) fail('NOT_FOUND', '版本不存在')
    const fields = revision.fields, module = moduleForKind[doc.kind]
    const expected = this.sources(doc, fields)
    const issues = [...validateFields(doc.kind, fields, true), ...expected.issues, ...this.sourceIssues(doc, revision)]
    if (canonical(expected.refs) !== canonical(revision.sourceRefs)) issues.push({ code: 'REFRESH_SOURCES', message: '来源清单已变化，请复核并使用“刷新来源并另存版本”', module, targetId: doc.id })
    const add = (message: string, field?: string) => issues.push({ code: 'INVALID_HANDOFF', message, field, module })
    if (doc.kind === 'volume' || doc.kind === 'unit') {
      const list = events(fields.events)
      if (!list.length || list.some(e => !/^[\p{L}\p{N}_-]+$/u.test(e.id) || !e.text) || new Set(list.map(e => e.id)).size !== list.length) add('事件清单需要不重复的 ID 和内容：事件 ID | 内容', 'events')
    }
    if (doc.kind === 'unit' || doc.kind === 'chapter') {
      const parent = this.document(doc.parentId!), parentFields = authority(parent)?.fields
      const allowed = events(parentFields?.events).map(e => e.id), selected = splitIds(fields.sourceEventIds)
      if (selected.some(e => !allowed.includes(e))) add('存在不属于直接上游的事件 ID', 'sourceEventIds')
    }
    if (['volume', 'unit', 'chapter'].includes(doc.kind)) {
      const previous = this.previous(doc), parent = doc.parentId ? this.document(doc.parentId) : undefined
      const entryState = previous ? authority(previous)?.fields.exitState : parent && authority(parent)?.fields.entryState
      if (entryState && fields.entryState?.trim() !== entryState.trim()) add('入口状态与前项出口（或父级入口）不一致，请核对交接文本', 'entryState')
    }
    return issues.filter((issue, index, list) => list.findIndex(x => canonical(x) === canonical(issue)) === index)
  }
  async save(command: SaveDocument): Promise<NovelDocument> {
    this.alive(); command = clone(command); this.structure(command)
    const invalid = validateFields(command.kind, command.fields, false)
    if (invalid.length) throw new NovelError('INVALID_INPUT', invalid[0]!.message, invalid)
    const fields = { ...blankFields(command.kind), ...command.fields }, hash = await contentHash(fields)
    this.alive(); this.structure(command)
    const existing = command.id ? this.document(command.id) : undefined, createdAt = now()
    const doc: NovelDocument = existing ? clone(existing) : { id: id(command.kind), projectId: command.projectId, kind: command.kind, parentId: command.parentId, order: Math.max(0, ...this.documents(command.projectId, command.kind).filter(d => d.parentId === command.parentId).map(d => d.order)) + 1, revisions: [], confirmedRevision: null, createdAt, updatedAt: createdAt }
    const sourceRefs = this.sources(doc, fields).refs
    doc.revisions.push({ schemaVersion: NOVEL_SCHEMA, revision: command.expectedRevision + 1, fields, contentHash: hash, sourceRefs, status: command.origin === 'import' ? 'candidate' : 'draft', origin: command.origin ?? 'manual', createdAt })
    doc.updatedAt = createdAt; this.replace(doc); return this.document(doc.id)
  }
  confirm(documentId: string, expectedRevision: number): NovelDocument {
    this.alive(); const original = this.document(documentId)
    if (latest(original).revision !== expectedRevision) fail('REVISION_CONFLICT', '请确认当前最新版本')
    if (original.kind === 'body') fail('PUBLICATION_UNAVAILABLE', '正文评审与正式入库尚未接入，正文只能保存为草稿或候选')
    if (['rejected', 'revoked'].includes(latest(original).status)) fail('INVALID_STATE', '已拒绝或撤销的版本不能重新确认，请另存新版本')
    const issues = this.check(documentId)
    if (issues.length) throw new NovelError('BLOCKED', issues[0]!.message, issues)
    if (original.confirmedRevision === expectedRevision) return original
    const doc = clone(original), revision = latest(doc)
    revision.status = 'confirmed'
    revision.confirmation = { revision: expectedRevision, contentHash: revision.contentHash, sourceRefs: clone(revision.sourceRefs), confirmedAt: now(), actor: 'author' }
    doc.confirmedRevision = expectedRevision; doc.updatedAt = now(); this.replace(doc)
    if (doc.kind === 'settings') this.commit({ ...this.state, projects: this.state.projects.map(p => p.id === doc.projectId ? { ...p, title: revision.fields.title! } : p) })
    return this.document(doc.id)
  }
  setStatus(documentId: string, expectedRevision: number, status: 'rejected' | 'revoked'): void {
    this.alive(); const doc = clone(this.document(documentId)), revision = latest(doc)
    if (revision.revision !== expectedRevision) fail('REVISION_CONFLICT', '内容已有新版本，请重新打开')
    if (status === 'rejected' && revision.status === 'confirmed') fail('INVALID_STATE', '已确认版本请使用撤销确认')
    if (status === 'revoked' && revision.status !== 'confirmed') fail('INVALID_STATE', '只能撤销已确认版本')
    revision.status = status; if (doc.confirmedRevision === revision.revision) doc.confirmedRevision = null
    doc.updatedAt = now(); this.replace(doc)
  }
  impacted(documentId: string): NovelDocument[] {
    const root = this.document(documentId), found = new Set([documentId])
    let changed = true
    while (changed) {
      changed = false
      for (const doc of this.documents(root.projectId)) if (!found.has(doc.id) && doc.revisions.some(r => r.sourceRefs.some(ref => ref.type === 'document' && found.has(ref.objectId)))) { found.add(doc.id); changed = true }
    }
    return this.documents(root.projectId).filter(d => d.id !== documentId && found.has(d.id))
  }
  assetImpact(projectId: string, proposed: Fields): NovelDocument[] {
    const current = this.binding(projectId), changed = new Set<string>()
    for (const key of ['personaId', 'worldId']) if (current?.[key] && current[key] !== proposed[key]) changed.add(current[key]!)
    for (const key of splitIds(current?.referenceIds)) if (!splitIds(proposed.referenceIds).includes(key)) changed.add(key)
    const direct = this.documents(projectId).filter(d => d.kind !== 'assets' && d.revisions.some(r => r.sourceRefs.some(ref => ref.type === 'asset' && changed.has(ref.objectId))))
    return [...new Map(direct.flatMap(d => [d, ...this.impacted(d.id)]).map(d => [d.id, d])).values()]
  }
  coverage(parentId: string): { missing: string[]; repeated: string[]; complete: boolean; exitMatches: boolean } {
    const parent = this.document(parentId), r = authority(parent), childKind = parent.kind === 'volume' ? 'unit' : 'chapter'
    const children = this.documents(parent.projectId, childKind).filter(d => d.parentId === parentId)
    const assigned = children.flatMap(d => authority(d) ? splitIds(authority(d)!.fields.sourceEventIds) : [])
    const required = events(r?.fields.events).map(e => e.id), missing = required.filter(e => !assigned.includes(e))
    const repeated = [...new Set(assigned.filter((e, i) => assigned.indexOf(e) !== i))]
    const last = children.at(-1), exitMatches = Boolean(last && r?.fields.exitState && authority(last)?.fields.exitState?.trim() === r.fields.exitState.trim())
    const complete = Boolean(r && required.length && children.length && !missing.length && exitMatches && (parent.kind !== 'volume' || !repeated.length) && children.every(d => authority(d) && !this.check(d.id, authority(d)!.revision).length))
    return { missing, repeated, complete, exitMatches }
  }
  exportProject(projectId: string): string {
    this.alive(); const project = this.project(projectId), documents = this.documents(projectId), used = new Set(documents.flatMap(d => d.revisions.flatMap(r => r.sourceRefs.filter(s => s.type === 'asset').map(s => s.objectId))))
    return JSON.stringify({ format: NOVEL_SCHEMA, project, assets: this.state.assets.filter(a => used.has(a.id)), documents }, null, 2)
  }
  async importProject(text: string): Promise<NovelProject> {
    this.alive()
    if (text.length > 10_000_000) fail('INVALID_IMPORT', '文件超过 10 MB，请缩小导入范围')
    let raw: { format: string; project: NovelProject; assets: NovelAsset[]; documents: NovelDocument[] }
    try { raw = JSON.parse(text) } catch { return fail('INVALID_IMPORT', '不是有效的 JSON 文件') }
    if (!raw || raw.format !== NOVEL_SCHEMA || !raw.project || typeof raw.project.id !== 'string' || !raw.project.id.trim() || typeof raw.project.title !== 'string' || !raw.project.title.trim() || !Array.isArray(raw.assets) || !Array.isArray(raw.documents) || raw.assets.length > 1000 || raw.documents.length > 5000) fail('INVALID_IMPORT', '小说文件格式或规模无效')
    // Validate and assemble in a private workspace. A failed import cannot partially mutate this session.
    const staging = new NovelService(), assetMap = new Map<string, string>(), docMap = new Map<string, string>()
    for (const asset of raw.assets) {
      if (!asset || typeof asset.id !== 'string' || assetMap.has(asset.id) || typeof asset.name !== 'string' || typeof asset.content !== 'string') fail('INVALID_IMPORT', '资产记录无效或 ID 重复')
      const added = await staging.addAsset(asset.kind, asset.name, asset.content, asset.sourceVersion); assetMap.set(asset.id, added.id)
    }
    const project = { id: id('novel'), title: `${raw.project.title}（导入候选）`, createdAt: now() }
    staging.commit({ ...staging.state, projects: [project] })
    for (const doc of raw.documents) {
      if (!doc || typeof doc.id !== 'string' || !doc.id.trim() || docMap.has(doc.id) || typeof doc.kind !== 'string' || !Object.hasOwn(moduleForKind, doc.kind) || (doc.parentId !== null && typeof doc.parentId !== 'string') || !Array.isArray(doc.revisions) || !doc.revisions.length || !Number.isSafeInteger(doc.order) || doc.order < 1 || doc.projectId !== raw.project.id) fail('INVALID_IMPORT', '对象身份、类型、版本或顺序无效')
      if (typeof latest(doc)?.fields !== 'object' || !latest(doc).fields || Array.isArray(latest(doc).fields)) fail('INVALID_IMPORT', '对象内容无效')
      docMap.set(doc.id, id(doc.kind))
    }
    const drafts: NovelDocument[] = []
    for (const doc of raw.documents) {
      const fields = clone(latest(doc).fields), invalid = validateFields(doc.kind, fields, false)
      if (invalid.length) fail('INVALID_IMPORT', invalid[0]!.message)
      if (doc.kind === 'assets') {
        fields.personaId = assetMap.get(fields.personaId!) ?? ''; fields.worldId = assetMap.get(fields.worldId!) ?? ''
        fields.referenceIds = splitIds(fields.referenceIds).map(x => assetMap.get(x) ?? fail('INVALID_IMPORT', '参考资产缺失')).join(',')
        staging.selectedAsset(fields.personaId, 'persona'); staging.selectedAsset(fields.worldId, 'world')
      }
      if (fields.characterIds) fields.characterIds = splitIds(fields.characterIds).map(x => docMap.get(x) ?? fail('INVALID_IMPORT', '角色引用缺失')).join(',')
      const createdAt = now(), revision: NovelRevision = { schemaVersion: NOVEL_SCHEMA, revision: 1, fields, contentHash: await contentHash(fields), sourceRefs: [], status: 'candidate', origin: 'import', createdAt }
      drafts.push({ id: docMap.get(doc.id)!, projectId: project.id, kind: doc.kind, parentId: doc.parentId ? docMap.get(doc.parentId) ?? fail('INVALID_IMPORT', '父级引用缺失') : null, order: doc.order, revisions: [revision], confirmedRevision: null, createdAt, updatedAt: createdAt })
    }
    if (drafts.filter(d => d.kind === 'assets').length !== 1) fail('INVALID_IMPORT', '小说需要且只能有一份资产绑定')
    staging.commit({ ...staging.state, documents: drafts })
    const orderKeys = new Set<string>()
    for (const doc of drafts) {
      staging.structure({ ...doc, expectedRevision: 1, fields: latest(doc).fields })
      if (singletons.includes(doc.kind) && drafts.filter(d => d.kind === doc.kind).length > 1) fail('INVALID_IMPORT', '单例对象重复')
      const key = `${doc.kind}:${doc.parentId}:${doc.order}`
      if (orderKeys.has(key) || (doc.kind === 'body' && drafts.filter(d => d.kind === 'body' && d.parentId === doc.parentId).length > 1)) fail('INVALID_IMPORT', '顺序或章节正文重复')
      orderKeys.add(key)
      for (const characterId of splitIds(latest(doc).fields.characterIds)) if (staging.document(characterId).kind !== 'character') fail('INVALID_IMPORT', '角色引用类型错误')
    }
    // Every imported object stays a candidate; source lists are rebound only by explicit review/save.
    this.commit({ projects: [...this.state.projects, project], assets: [...this.state.assets, ...staging.state.assets], documents: [...this.state.documents, ...drafts] })
    return project
  }
  dispose(): void { this.disposed = true; this.creations.clear(); this.state = freeze({ projects: [], assets: [], documents: [] }) }
}
