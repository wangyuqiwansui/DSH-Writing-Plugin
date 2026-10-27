import { PERSONA_API_VERSION, PERSONA_SCHEMA, type PersonaBackend, type PersonaCommand, type PersonaCommandResult, type PersonaDetail, type PersonaDocument, type PersonaIssue, type PersonaOverview, type PersonaProjection, type PersonaRequest } from '../contracts/index.js'
import { emptyPersona, importPersona, importPrompt, parsePersona, toPromptDocument, PersonaError, validatePersona } from '../domain/persona.js'

export interface PersonaEditor { id: string; instance: string | null; document: PersonaDocument; base: PersonaDetail | null; dirty: boolean }
export interface PersonaSnapshot {
  connected: boolean; overview: PersonaOverview | null; editor: PersonaEditor | null; buffers: PersonaEditor[]
  history: PersonaDetail[]; viewing: PersonaDetail | null; busy: boolean; error: string | null; message: string | null
  issues: PersonaIssue[]; pending: PersonaCommand | null
}
const definitive = new Set(['INVALID_INPUT', 'DATABASE_CHANGED', 'REVISION_CONFLICT', 'AUTHOR_CONFIRMATION_REQUIRED', 'SAVE_REQUIRED', 'PUBLICATION_BLOCKED', 'VERSION_LIMIT'])
/** Owns UI buffers and uncertain writes; no storage, SQL, model or consumer implementation. */
export class PersonaController {
  private backend?: PersonaBackend
  private active?: AbortController
  private disposed = false
  private listeners = new Set<() => void>()
  private state: PersonaSnapshot = { connected: false, overview: null, editor: null, buffers: [], history: [], viewing: null, busy: false, error: null, message: null, issues: [], pending: null }
  constructor(private readonly timeoutMs = 15_000) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<PersonaSnapshot>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()) }
  private setEditor(editor: PersonaEditor) {
    const buffers = [...this.state.buffers.filter(b => b.id !== editor.id || b.instance !== editor.instance), editor]
    this.update({ editor, buffers, viewing: null, issues: validatePersona(editor.document) })
  }
  reportError(message: string) { this.update({ error: message }) }
  attach(backend: PersonaBackend): () => void {
    this.active?.abort(); this.backend = backend; this.update({ connected: false, overview: null, busy: false }); void this.refresh()
    return () => { if (this.backend === backend) { this.transportLost(); this.backend = undefined } }
  }
  transportLost() {
    this.active?.abort(); this.active = undefined
    this.update({ connected: false, overview: null, busy: false, error: this.state.pending ? '连接已中断；提交结果待核对，请恢复连接后核对回执。' : '服务未连接；本地输入仍保留。' })
  }
  private async request<T>(request: PersonaRequest, controller: AbortController): Promise<T> {
    if (!this.backend) throw new Error('作者人格服务不可用')
    const signal = controller.signal
    signal.throwIfAborted()
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined
    try {
      const interrupted = new Promise<never>((_, reject) => {
        abort = () => reject(new Error('请求中断，写入结果可能尚未确认'))
        signal.addEventListener('abort', abort, { once: true })
        timer = setTimeout(() => controller.abort(), this.timeoutMs)
      })
      const reply = await Promise.race([this.backend.invoke(request, signal), interrupted])
      signal.throwIfAborted()
      if (!reply.ok) throw new PersonaError(reply.code, reply.message, reply.issues)
      return reply.data as T
    } catch (error) {
      const info = error as { code?: string; message?: string }
      if (info?.code === 'gateway/service-unavailable' || info?.code === 'gateway/invocation-unavailable' || /HTTP 404\b/.test(info?.message ?? '')) {
        if (this.active === controller && !signal.aborted) this.update({ connected: false, overview: null })
        throw new PersonaError('HOST_UNAVAILABLE', '作者人格宿主接口尚未加载（服务缺失或 HTTP 404）。请先导出未保存内容，再重新启动 DSH 以加载最新插件；仅刷新页面不会更新 Host。启动后点击“重新连接”。')
      }
      throw error
    } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort) }
  }
  private async run(work: (controller: AbortController) => Promise<void>): Promise<boolean> {
    if (this.disposed || this.state.busy) return false
    const controller = new AbortController(); this.active = controller
    this.update({ busy: true, error: null, message: null })
    try { await work(controller); return !controller.signal.aborted && !this.disposed }
    catch (error) {
      if (this.active === controller) this.update({ error: error instanceof Error ? error.message : '操作未完成', ...(error instanceof PersonaError ? { issues: error.issues } : {}) })
      return false
    } finally { if (this.active === controller) { this.active = undefined; this.update({ busy: false }) } }
  }
  private async overview(controller: AbortController) {
    const overview = await this.request<PersonaOverview>({ action: 'overview' }, controller)
    if (overview.apiVersion !== PERSONA_API_VERSION) {
      this.update({ connected: false, overview: null })
      throw new PersonaError('HOST_UPDATE_REQUIRED', '作者人格页面与宿主接口版本不一致。请先导出未保存内容，再重新启动 DSH 加载统一 Prompt 模板版本，随后点击“重新连接”。')
    }
    this.update({ overview, connected: true })
  }
  refresh(): Promise<boolean> { return this.run(c => this.overview(c)) }
  create(document = emptyPersona()): void {
    if (this.state.busy || this.state.pending) return
    this.setEditor({ id: crypto.randomUUID(), instance: this.state.overview?.pluginInstanceId ?? null, document: parsePersona(document), base: null, dirty: true })
    this.update({ history: [], error: null, message: '新草稿尚未保存' })
  }
  fork(): void { if (this.state.editor) this.create(toPromptDocument(this.state.viewing?.version.document ?? this.state.editor.document)) }
  edit(document: PersonaDocument): void {
    if (!this.state.editor || this.state.busy || this.state.pending || this.state.viewing) return
    this.setEditor({ ...this.state.editor, document, dirty: true }); this.update({ error: null, message: null })
  }
  import(text: string, kind: 'json' | 'text', name = '导入人格'): boolean {
    if (this.state.busy || this.state.pending) return false
    try { this.create(kind === 'json' ? importPersona(text) : importPrompt(text, name)); return true }
    catch (error) { this.reportError(error instanceof Error ? error.message : '导入失败'); return false }
  }
  export(): string { const document = this.state.viewing?.version.document ?? this.state.editor?.document; return document ? JSON.stringify(document, null, 2) + '\n' : '' }
  resume(buffer: PersonaEditor): void {
    if (this.state.busy || this.state.pending) return
    const stored = this.state.buffers.find(b => b.instance === buffer.instance && b.id === buffer.id)
    if (stored) { this.setEditor(stored); this.update({ history: [], error: null, message: '本地草稿已恢复' }); void this.loadHistory() }
  }
  async open(id: string): Promise<boolean> {
    if (this.state.pending) return false
    return this.run(async c => {
      const instance = this.state.overview?.pluginInstanceId
      if (!instance) throw new Error('请先连接已初始化的共享数据库')
      const existing = this.state.buffers.find(b => b.id === id && b.instance === instance)
      const detail = await this.request<PersonaDetail>({ action: 'read', pluginInstanceId: instance, personaId: id, revision: null }, c)
      this.setEditor(existing ?? { id, instance, document: toPromptDocument(detail.version.document), base: detail, dirty: detail.version.document.schemaVersion !== PERSONA_SCHEMA })
      if (!existing && detail.version.document.schemaVersion !== PERSONA_SCHEMA) this.update({ message: '旧版内容已转为统一 Prompt 草稿；原历史版本保持不变，保存发布前请完成模板校验。' })
      this.update({ history: await this.request<PersonaDetail[]>({ action: 'history', pluginInstanceId: instance, personaId: id }, c) })
    })
  }
  loadHistory(): Promise<boolean> {
    return this.run(async c => {
      const e = this.state.editor
      if (e?.instance && e.base) this.update({ history: await this.request<PersonaDetail[]>({ action: 'history', pluginInstanceId: e.instance, personaId: e.id }, c) })
    })
  }
  view(detail: PersonaDetail | null) { if (!this.state.busy && !this.state.pending) this.update({ viewing: detail }) }
  private accepted(result: PersonaCommandResult) {
    const old = this.state.editor
    if (!old) return
    const editor = { ...old, instance: result.detail.ref.pluginInstanceId, document: toPromptDocument(result.detail.version.document), base: result.detail, dirty: result.detail.version.document.schemaVersion !== PERSONA_SCHEMA }
    this.update({ buffers: this.state.buffers.filter(b => b.id !== old.id || b.instance !== old.instance), pending: null })
    this.setEditor(editor)
    this.update({ history: [result.detail, ...this.state.history.filter(d => d.ref.versionId !== result.detail.ref.versionId)], message: result.unchanged ? '内容未变，已保留原版本' : result.detail.version.status === 'published' ? '已发布作者确认版本；来源审核和写作实测尚未执行' : '草稿已保存' })
  }
  async save(action: 'save' | 'publish', authorConfirmed = false): Promise<boolean> {
    if (this.state.pending || this.state.viewing) return false
    return this.run(async c => {
      const e = this.state.editor, current = this.state.overview?.pluginInstanceId
      if (!e || !current || !this.state.connected) throw new Error('请先连接已初始化的共享数据库')
      if (e.instance && e.instance !== current) throw new Error('当前数据库与草稿不同；请返回原库或另存为新人格')
      if (action === 'publish' && e.dirty) throw new Error('请先保存修改，再发布精确版本')
      const command: PersonaCommand = { pluginInstanceId: current, personaId: e.id, operationId: crypto.randomUUID(), expectedRevision: e.base?.version.revision ?? 0,
        action, authorConfirmed, document: parsePersona(e.document) }
      this.update({ pending: command })
      try { this.accepted(await this.request<PersonaCommandResult>({ action: 'command', command }, c)) }
      catch (error) { if (error instanceof PersonaError && definitive.has(error.code)) this.update({ pending: null }); throw error }
      await this.overview(c)
    })
  }
  reconcile(): Promise<boolean> {
    return this.run(async c => {
      const command = this.state.pending
      if (!command) return
      if (this.state.overview?.pluginInstanceId !== command.pluginInstanceId) throw new Error('请先返回提交时的数据库，不能在另一数据库重试')
      try {
        const receipt = await this.request<PersonaCommandResult | null>({ action: 'receipt', pluginInstanceId: command.pluginInstanceId, operationId: command.operationId }, c)
        this.accepted(receipt ?? await this.request<PersonaCommandResult>({ action: 'command', command }, c))
      } catch (error) { if (error instanceof PersonaError && definitive.has(error.code)) this.update({ pending: null }); throw error }
      await this.overview(c)
    })
  }
  async projection(): Promise<PersonaProjection | null> {
    if (this.state.pending) return null
    let projection: PersonaProjection | null = null
    const ok = await this.run(async c => {
      const detail = this.state.viewing ?? this.state.editor?.base
      if (!detail || (!this.state.viewing && this.state.editor?.dirty)) throw new Error('请选择已保存并发布的精确版本')
      projection = await this.request<PersonaProjection>({ action: 'projection', pluginInstanceId: detail.ref.pluginInstanceId, personaId: detail.version.personaId, revision: detail.version.revision }, c)
    })
    return ok ? projection : null
  }
  dispose() { this.active?.abort(); this.disposed = true; this.active = undefined; this.backend = undefined; this.listeners.clear() }
}
