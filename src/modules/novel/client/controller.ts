import { NovelError, NovelService } from '../application/service.js'
import { blankFields } from '../domain/fields.js'
import { NovelWorldContext } from './world-context.js'
import type { WorldDetail } from '../../worldbuilding/contracts/index.js'
import { worldSummary } from '../../worldbuilding/domain/world.js'
import { PERSONA_SCHEMA, LEGACY_PERSONA_SCHEMA, PROMPT_TEMPLATE_ID, PROMPT_MAX_CODEPOINTS, validatePromptTemplate, type PersonaProjection } from '../../author-persona/contracts/index.js'
import { latest, moduleForKind, type AssetKind, type DocumentKind, type Fields, type NovelDraft, type NovelIssue, type NovelModule, type NovelWorkspace } from '../contracts/index.js'

export interface NovelSnapshot {
  workspace: NovelWorkspace; projectId: string | null; module: NovelModule; draft: NovelDraft | null
  busy: boolean; error: string | null; message: string | null; issues: NovelIssue[]
  creation: { title: string; personaId: string; worldId: string; referenceIds: string }
}
const primaryKind: Record<NovelModule, DocumentKind> = { assets: 'assets', settings: 'settings', outline: 'outline', units: 'unit', chapters: 'chapter', body: 'body', characters: 'character' }
const parentKind: Partial<Record<DocumentKind, DocumentKind>> = { volume: 'outline', unit: 'volume', chapter: 'unit', body: 'chapter' }

/** UI buffers survive page changes; only service commands change domain records. */
export class NovelController {
  readonly service = new NovelService()
  readonly worldContext = new NovelWorldContext(() => {
    const projectId = this.snapshot.projectId
    if (!projectId) throw new Error('请先选择小说')
    return { projectId, sourceVersion: this.service.worldSource(projectId) }
  }, 15_000, async (binding, repair, signal) => {
    if (binding.projectId !== this.snapshot.projectId) throw new Error('小说已切换，请重新查询')
    await this.service.repairWorldSource(repair, signal)
    this.update({ message: '旧目录数据已清理，小说的同版本来源和历史引用已同步。' })
  })
  private listeners = new Set<() => void>()
  private buffers = new Map<string, NovelDraft>()
  private selections = new Map<string, string>()
  private disposed = false
  private snapshot: NovelSnapshot = { workspace: this.service.getSnapshot(), projectId: null, module: 'assets', draft: null, busy: false, error: null, message: null, issues: [], creation: { title: '', personaId: '', worldId: '', referenceIds: '' } }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<NovelSnapshot>) {
    if (this.disposed) return
    this.snapshot = { ...this.snapshot, ...patch, workspace: this.service.getSnapshot() }; this.listeners.forEach(fn => fn())
  }
  private key(draft: NovelDraft, projectId = this.snapshot.projectId) { return `${projectId}:${draft.id ?? `${draft.kind}:${draft.parentId ?? 'root'}`}` }
  private remember() { if (this.snapshot.draft && this.snapshot.projectId) this.buffers.set(this.key(this.snapshot.draft), this.snapshot.draft) }
  edit(field: string, value: string): void {
    const draft = this.snapshot.draft; if (!draft || this.snapshot.busy) return
    this.update({ draft: { ...draft, fields: { ...draft.fields, [field]: value }, dirty: true }, message: null, error: null, issues: [] }); this.remember()
  }
  editCreation(field: keyof NovelSnapshot['creation'], value: string) { this.update({ creation: { ...this.snapshot.creation, [field]: value }, error: null }) }
  selectProject(projectId: string): void {
    this.worldContext.invalidate()
    if (this.snapshot.busy) return
    this.remember(); this.service.project(projectId); this.update({ projectId, draft: null }); this.openModule(this.snapshot.module)
  }
  newProject(): void {
    this.worldContext.invalidate()
    if (this.snapshot.busy) return
    this.remember(); this.update({ projectId: null, module: 'assets', draft: null, error: null, message: null, issues: [] })
  }
  openModule(module: NovelModule): void {
    this.worldContext.invalidate()
    if (this.snapshot.busy) return
    this.remember(); this.update({ module, draft: null, error: null, message: null, issues: [] })
    const projectId = this.snapshot.projectId; if (!projectId) return
    const selected = this.selections.get(`${projectId}:${module}`), doc = selected && this.snapshot.workspace.documents.find(d => d.id === selected)
    if (doc) { this.openDocument(doc.id); return }
    const first = this.service.documents(projectId, primaryKind[module])[0]
    if (first) this.openDocument(first.id)
    else this.startNew(primaryKind[module])
  }
  openDocument(documentId: string): void {
    this.worldContext.invalidate()
    if (this.snapshot.busy) return
    this.remember(); const doc = this.service.document(documentId), r = latest(doc)
    const draft = this.buffers.get(`${doc.projectId}:${doc.id}`) ?? { kind: doc.kind, id: doc.id, parentId: doc.parentId, expectedRevision: r.revision, fields: { ...r.fields }, dirty: false }
    this.selections.set(`${doc.projectId}:${moduleForKind[doc.kind]}`, doc.id)
    this.update({ projectId: doc.projectId, module: moduleForKind[doc.kind], draft, error: null, message: null, issues: [] })
  }
  startNew(kind: DocumentKind, parentId?: string | null): void {
    this.worldContext.invalidate()
    if (this.snapshot.busy || !this.snapshot.projectId) return
    this.remember(); const projectId = this.snapshot.projectId
    const parent = parentId ?? (parentKind[kind] ? this.service.documents(projectId, parentKind[kind])[0]?.id : null) ?? null
    const duplicate = this.service.documents(projectId, kind).find(d => kind === 'body' ? d.parentId === parent : ['assets', 'settings', 'outline'].includes(kind))
    if (duplicate) { this.openDocument(duplicate.id); return }
    const fresh: NovelDraft = { kind, parentId: parent, expectedRevision: 0, fields: blankFields(kind), dirty: false }
    if (kind === 'settings') fresh.fields.title = this.service.project(projectId).title
    if (kind === 'body' && parent) fresh.fields.title = latest(this.service.document(parent)).fields.title ?? ''
    this.update({ module: moduleForKind[kind], draft: this.buffers.get(this.key(fresh)) ?? fresh, error: null, message: null, issues: [] })
  }
  private async run(action: () => Promise<void> | void): Promise<boolean> {
    if (this.disposed || this.snapshot.busy) return false
    this.update({ busy: true, error: null, issues: [], message: null })
    try { await action(); return !this.disposed } catch (error) {
      this.update({ error: error instanceof Error ? error.message : '操作失败', issues: error instanceof NovelError ? error.issues : [] }); return false
    } finally { this.update({ busy: false }) }
  }
  async addAsset(kind: AssetKind, name: string, content: string): Promise<boolean> {
    return this.run(async () => { await this.service.addAsset(kind, name, content); this.update({ message: '资产已加入本次会话，请明确选择后绑定。' }) })
  }
  async addWorldVersion(detail: WorldDetail): Promise<boolean> {
    return this.run(async () => {
      if (detail.version.status !== 'active' || !detail.version.confirmation) throw new Error('只能引用正式世界版本')
      await this.service.addAsset('world', detail.version.document.name, worldSummary(detail.version.document), detail.ref)
      this.update({ message: '世界观正式版本已加入本次小说会话，请在资产配置中明确选择后绑定。已有绑定未更改。' })
    })
  }
  async addPersonaVersion(projection: PersonaProjection): Promise<boolean> {
    const ok = await this.run(async () => {
      const validFormat = projection.schemaVersion === 'writing-author-persona-projection-v2'
        ? projection.sourceVersion.schemaVersion === PERSONA_SCHEMA && projection.templateId === PROMPT_TEMPLATE_ID && !validatePromptTemplate(projection.text).length
        : projection.schemaVersion === 'writing-author-persona-projection-v1' && projection.sourceVersion.schemaVersion === LEGACY_PERSONA_SCHEMA && ['brief', 'full_prompt'].includes(projection.mode)
      if (!validFormat || projection.authority !== 'expression_only' || projection.purpose !== 'writing_style' || projection.literaryTrial !== 'not_run'
        || projection.sourceVersion.projectId !== 'writing-author-persona-library' || !projection.text.trim() || Array.from(projection.text).length > PROMPT_MAX_CODEPOINTS) throw new Error('作者人格交付未通过统一 Prompt 模板或历史版本格式校验')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(projection.text))
      const textHash = 'sha256:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
      if (textHash !== projection.textHash) throw new Error('作者人格表达摘要不一致')
      await this.service.addAsset('persona', projection.name, projection.text, projection.sourceVersion)
    })
    if (ok) {
      this.openModule('assets')
      this.update({ message: '已加入作者人格的精确版本。请在资产配置中选择绑定；仅用于表达，写作实测未执行。' })
    }
    return ok
  }
  async createProject(): Promise<boolean> {
    let projectId = ''
    const ok = await this.run(async () => {
      const project = await this.service.createProject({ ...this.snapshot.creation, idempotencyKey: crypto.randomUUID() }); projectId = project.id
      this.update({ creation: { title: '', personaId: '', worldId: '', referenceIds: '' } })
    })
    if (ok) { this.selectProject(projectId); this.openModule('settings'); this.update({ message: '小说与双资产绑定已创建，可以开始填写设定。' }) }
    return ok
  }
  async save(): Promise<boolean> {
    this.worldContext.invalidate()
    const draft = this.snapshot.draft, projectId = this.snapshot.projectId
    if (!draft || !projectId) return false
    let savedId = ''
    const ok = await this.run(async () => {
      const doc = await this.service.save({ ...draft, projectId }); savedId = doc.id
      this.buffers.delete(this.key(draft)); this.buffers.delete(`${projectId}:${doc.id}`)
      this.update({ draft: null })
    })
    if (ok) { this.openDocument(savedId); this.update({ message: '已保存到本次会话。离开或刷新前，请导出小说文件。' }) }
    return ok
  }
  async confirm(): Promise<boolean> {
    this.worldContext.invalidate()
    const draft = this.snapshot.draft
    if (!draft?.id || draft.dirty) { this.update({ error: '请先保存修改，再确认精确版本。' }); return false }
    return this.run(() => { this.service.confirm(draft.id!, draft.expectedRevision); this.update({ message: '当前版本已确认；下游会重新核对来源。' }) })
  }
  async setStatus(status: 'rejected' | 'revoked'): Promise<boolean> {
    this.worldContext.invalidate()
    const draft = this.snapshot.draft; if (!draft?.id || draft.dirty) return false
    return this.run(() => { this.service.setStatus(draft.id!, draft.expectedRevision, status); this.update({ message: status === 'revoked' ? '已撤销此版本确认，依赖它的下游需要复核。' : '此候选已拒绝，历史仍保留。' }) })
  }
  async importProject(text: string): Promise<boolean> {
    let projectId = ''
    const ok = await this.run(async () => { projectId = (await this.service.importProject(text)).id })
    if (ok) { this.selectProject(projectId); this.openModule('assets'); this.update({ message: '已导入为独立小说候选。原确认不会自动生效，请从资产配置开始复核来源。' }) }
    return ok
  }
  reportError(message: string) { this.update({ error: message }) }
  dispose(): void { this.worldContext.dispose(); this.disposed = true; this.listeners.clear(); this.buffers.clear(); this.selections.clear(); this.service.dispose(); this.snapshot = { ...this.snapshot, workspace: this.service.getSnapshot(), draft: null, projectId: null, busy: false } }
}
