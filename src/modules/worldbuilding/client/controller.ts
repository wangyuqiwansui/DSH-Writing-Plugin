import { canonicalJson } from '../../../shared/contracts/index.js'
import { ENTRY_TYPES, type EntryType, type WorldBackend, type WorldCommand, type WorldCommandResult, type WorldDetail, type WorldDocument, type WorldIssue, type WorldOverview, type WorldRequest, type WorldQueryResult } from '../contracts/index.js'
import { classifyRecord, emptyWorld, newId, newRecord, parseWorld, referencesTo, validateWorld } from '../domain/world.js'

export type WorldTab = 'scope' | 'records'
export interface WorldState {
  entryFilter: EntryType | 'all' | 'untyped'; shownTypes: EntryType[]
  connected: boolean; overview: WorldOverview | null; worldId: string; instance: string | null; document: WorldDocument | null
  detail: WorldDetail | null; dirty: boolean
  tab: WorldTab; recordId: string | null; query: string; busy: boolean; error: string | null; message: string | null
  issues: WorldIssue[]; pending: WorldCommand | null
  localWorlds: { worldId: string; instance: string; name: string }[]
}
export class WorldController {
  private backend: WorldBackend | null = null
  private request: AbortController | null = null
  private disposed = false
  private listeners = new Set<() => void>()
  private buffers = new Map<string, Pick<WorldState, 'document' | 'detail' | 'dirty'>>()
  private state: WorldState = { connected: false, overview: null, worldId: '', instance: null, document: null, detail: null, dirty: false,
    tab: 'scope', entryFilter: 'all', shownTypes: ENTRY_TYPES.map(t => t.id), recordId: null, query: '', busy: false, error: null, message: null, issues: [], pending: null, localWorlds: [] }
  constructor(private readonly timeoutMs = 15_000) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<WorldState>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach(l => l()) }
  private remember() {
    const { document, instance, worldId, detail, dirty } = this.state
    if (!document || !instance) return
    this.buffers.set(`${instance}:${worldId}`, { document, detail, dirty })
    this.update({ localWorlds: [...this.state.localWorlds.filter(w => w.worldId !== worldId || w.instance !== instance), { worldId, instance, name: document.name || '未命名草稿' }] })
  }
  private async call<T>(request: WorldRequest, signal: AbortSignal): Promise<T> {
    if (!this.backend) throw new Error('世界观服务未连接')
    const result = await this.backend.invoke(request, signal)
    if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code, issues: result.issues, known: true })
    return result.data as T
  }
  private async run(action: (signal: AbortSignal) => Promise<void>, mutation = false): Promise<boolean> {
    if (this.disposed || this.state.busy || !this.backend) return false
    const request = new AbortController(); this.request = request
    this.update({ busy: true, error: null, message: null })
    const timer = setTimeout(() => request.abort(new Error('请求超时，输入仍保留')), this.timeoutMs)
    let rejectAbort = () => {}
    try {
      const cancelled = new Promise<never>((_, reject) => { rejectAbort = () => reject(request.signal.reason); request.signal.addEventListener('abort', rejectAbort, { once: true }) })
      await Promise.race([action(request.signal), cancelled]); return !request.signal.aborted && !this.disposed
    } catch (e) {
      if (this.request === request) {
        const error = e as { message?: string; known?: boolean; issues?: WorldIssue[] }
        this.update({ error: mutation && !error.known ? '提交结果尚未确认。输入已保留，请点击“核对提交结果”后继续。' : error.message ?? '操作未完成', issues: error.issues ?? [],
          ...(mutation && error.known ? { pending: null } : {}) })
      }
      return false
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', rejectAbort)
      if (this.request === request) { this.request = null; this.update({ busy: false }) }
    }
  }
  attach(backend: WorldBackend) {
    this.request?.abort(); this.request = null; this.update({ busy: false })
    this.backend = backend; this.update({ connected: true }); void this.refresh()
    return () => { if (this.backend === backend) { this.transportLost(); this.backend = null } }
  }
  transportLost() { this.request?.abort(new Error('连接已断开')); this.request = null; this.update({ connected: false, overview: null, busy: false, error: this.state.pending ? '连接已断开，提交结果待核对；请恢复连接后查询原回执。' : null }); this.remember() }
  refresh = async () => {
    if (!this.backend) return
    await this.run(async signal => {
      const overview = await this.call<WorldOverview>({ action: 'overview' }, signal); signal.throwIfAborted()
      this.update({ connected: true, overview, error: this.state.instance && overview.pluginInstanceId !== this.state.instance && this.state.document ? '数据库已变化；保留了原库草稿，可导出后切换世界。' : null })
    })
  }
  newWorld = () => {
    if (this.state.busy || this.state.pending || !this.state.overview?.ready) return
    this.remember(); this.update({ worldId: newId(), instance: this.state.overview.pluginInstanceId, document: emptyWorld(), detail: null, dirty: true, tab: 'scope', recordId: null, issues: [], error: null, message: null })
  }
  open = async (worldId: string, reload = false) => {
    if (this.state.busy || this.state.pending || !this.state.overview?.pluginInstanceId) return
    this.remember(); const instance = this.state.overview.pluginInstanceId
    const buffer = this.buffers.get(`${instance}:${worldId}`)
    if (buffer?.dirty && !reload) {
      this.update({ ...buffer, worldId, instance, tab: 'scope', recordId: null, issues: [], error: null }); return
    }
    await this.run(async signal => {
      const detail = await this.call<WorldDetail>({ action: 'read', pluginInstanceId: instance, worldId, revision: null }, signal); signal.throwIfAborted()
      this.update({ worldId, instance, detail, document: detail.version.document, dirty: false, recordId: null, issues: [], tab: 'scope' }); this.remember()
    })
  }
  edit = (change: (doc: WorldDocument) => WorldDocument) => {
    if (!this.state.document || this.state.busy || this.state.pending) return
    this.update({ document: change(this.state.document), dirty: true, issues: [], message: null, error: null }); this.remember()
  }
  setTab = (tab: WorldTab) => this.update({ tab })
  setQuery = (query: string) => this.update({ query })
  selectRecord = (recordId: string) => this.update({ recordId })
  setEntryFilter = (entryFilter: WorldState['entryFilter']) => this.update({ entryFilter, recordId: null })
  showType = (type: EntryType, shown: boolean) => this.update({
    shownTypes: shown ? [...new Set([...this.state.shownTypes, type])] : this.state.shownTypes.filter(t => t !== type),
    ...(!shown && this.state.entryFilter === type ? { entryFilter: 'all' as const } : {}),
  })
  classify = (id: string, type?: EntryType) => this.edit(d => classifyRecord(d, id, type))
  addRecord = () => {
    if (!this.state.document || this.state.busy || this.state.pending) return
    const record = newRecord()
    this.edit(d => {
      const next = { ...d, records: [...d.records, record] }
      return this.state.entryFilter === 'all' || this.state.entryFilter === 'untyped' ? next : classifyRecord(next, record.id, this.state.entryFilter)
    })
    this.update({ recordId: record.id })
  }
  addChild = () => {
    const parentId = this.state.recordId
    this.addRecord()
    if (parentId && this.state.recordId !== parentId) this.moveRecord(this.state.recordId!, parentId)
  }
  moveRecord = (id: string, parentId: string) => {
    try {
      if (!this.state.document) return
      const document = parseWorld({ ...this.state.document, records: this.state.document.records.map(r => {
        if (r.id !== id) return r
        const { parentId: old, ...record } = r
        return parentId ? { ...record, parentId } : record
      }) })
      this.edit(() => document)
    } catch (error) { this.reportError((error as Error).message) }
  }
  removeRecord = (id: string) => {
    if (!this.state.document) return
    const impact = referencesTo(this.state.document, id)
    if (impact.length) { this.update({ error: `此设定仍被引用：${impact.join('；')}。请先处理引用。` }); return }
    this.edit(d => ({ ...d, records: d.records.filter(r => r.id !== id) })); this.update({ recordId: null })
  }
  check = () => { if (this.state.document) this.update({ issues: validateWorld(this.state.document), message: '校验已完成。结构校验之外的语义疑点仍需作者审阅。' }) }
  private accept(result: WorldCommandResult) {
    this.update({ detail: result.detail, document: result.detail.version.document, dirty: false, pending: null, issues: validateWorld(result.detail.version.document),
      message: result.unchanged ? '内容没有变化，已保留当前版本。' : result.detail.version.status === 'active' ? '正式版本已发布；已有小说绑定保持原版本。' : '草稿已保存到共享数据库。' }); this.remember()
  }
  save = async (action: 'save' | 'publish' = 'save', authorConfirmed = false) => {
    if (!this.state.document || !this.state.instance || this.state.pending || this.state.busy || !this.state.connected) return false
    if (this.state.instance !== this.state.overview?.pluginInstanceId) { this.update({ error: '请先连接原数据库，或导出草稿后选择目标库' }); return false }
    const command: WorldCommand = { action, authorConfirmed, pluginInstanceId: this.state.instance, operationId: newId(), worldId: this.state.worldId,
      expectedRevision: this.state.detail?.version.revision ?? 0, document: JSON.parse(canonicalJson(this.state.document)) as WorldDocument }
    this.update({ pending: command })
    const ok = await this.run(async signal => { const result = await this.call<WorldCommandResult>({ action: 'command', command }, signal); signal.throwIfAborted(); this.accept(result) }, true)
    if (ok) { const message = this.state.message; await this.refresh(); this.update({ message }) }
    return ok
  }
  reconcile = async () => {
    const command = this.state.pending; if (!command || this.state.busy) return
    if (command.pluginInstanceId !== this.state.overview?.pluginInstanceId) { this.update({ error: '请恢复原数据库连接后核对回执' }); return }
    const ok = await this.run(async signal => {
      const receipt = await this.call<WorldCommandResult | null>({ action: 'receipt', pluginInstanceId: command.pluginInstanceId, operationId: command.operationId }, signal); signal.throwIfAborted()
      const result = receipt ?? await this.call<WorldCommandResult>({ action: 'command', command }, signal); signal.throwIfAborted(); this.accept(result)
    }, true)
    if (ok) { const message = this.state.message; await this.refresh(); this.update({ message }) }
  }
  cancel = () => this.request?.abort(new Error('已取消请求；已保存内容不受影响'))
  importDocument = (raw: string) => {
    if (this.state.busy || this.state.pending || !this.state.overview?.ready) return
    try {
      if (raw.length > 2_000_000) throw new Error('导入文件超过 200 万字符')
      const value = JSON.parse(raw), document = parseWorld(value.document ?? value)
      this.newWorld()
      this.edit(() => ({ ...document, records: document.records.map(r => ({ ...r, confirmation: 'candidate' })) }))
      this.update({ message: '已导入为新世界草稿；保留设定 ID 与扩展内容，原确认不会自动生效。' })
    } catch (error) { this.update({ error: (error as Error).message }) }
  }
  reportError = (error: string) => this.update({ error })
  dispose() { this.disposed = true; this.request?.abort(); this.request = null; this.backend = null; this.listeners.clear(); this.buffers.clear() }
}
