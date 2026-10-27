import type { QualityBackend, QualityAction, QualityRequests, QualityResults, QualityRequest, QualityOverview, Mode,
  RuleRecord, Page, Target, PreparedDetection, ReportDetail, RuleContent, RuleLevel, RuleStatus } from '../contracts.js'
type Slot = 'overview' | 'list' | 'detail' | 'prepare' | 'detect' | 'mutation' | 'recovery'
type Tab = 'detect' | 'rules'
export interface QualityState {
  connected: boolean; overview: QualityOverview | null; projectId: string; tab: Tab
  mode: Mode; level: RuleLevel; ruleStatus: RuleStatus | 'all'
  draft: string; query: string; offset: number; rules: Page<RuleRecord> | null; targets: Page<Target> | null
  prepared: PreparedDetection | null; pendingOperationId: string | null
  detail: ReportDetail | null; currentReportId: string | null; busy: Partial<Record<Slot, boolean>>; error: string | null; notice: string | null
}
export class QualityController {
  private backend: QualityBackend | null = null
  private disposed = false
  private requests = new Map<Slot, AbortController>()
  private listeners = new Set<() => void>()
  private state: QualityState = { connected: false, overview: null, projectId: '', tab: 'rules', mode: 'deterministic', level: 'L0', ruleStatus: 'all',
    draft: '', query: '', offset: 0, rules: null, targets: null, prepared: null, pendingOperationId: null, detail: null, currentReportId: null, busy: {}, error: null, notice: null }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<QualityState>) { if (this.disposed) return; this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()) }
  private abort(slot: Slot) { const old = this.requests.get(slot); this.requests.delete(slot); old?.abort() }
  private reset() { for (const slot of this.requests.keys()) this.abort(slot); this.update({ busy: {}, rules: null, targets: null, prepared: null, pendingOperationId: null, detail: null, currentReportId: null, error: null, notice: null }) }
  private async run<K extends QualityAction>(slot: Slot, action: K, input: QualityRequests[K], accept: (value: QualityResults[K]) => void): Promise<QualityResults[K] | undefined> {
    this.abort(slot)
    if (!this.backend || this.disposed) return
    const request = new AbortController(); this.requests.set(slot, request)
    this.update({ busy: { ...this.state.busy, [slot]: true }, error: null })
    const timer = setTimeout(() => request.abort(new Error(slot === 'detect' ? '检测等待超时，请核对本次结果；没有自动重试。' : '请求超时，请刷新后重试。')), slot === 'detect' ? 310_000 : 20_000)
    let onAbort = () => {}
    try {
      const cancelled = new Promise<never>((_, reject) => { onAbort = () => reject(request.signal.reason); request.signal.addEventListener('abort', onAbort, { once: true }) })
      const reply = await Promise.race([this.backend.invoke({ action, input } as QualityRequest, request.signal), cancelled])
      if (reply.action !== action) throw new Error('服务返回的操作类型不匹配')
      if (this.requests.get(slot) === request && !this.disposed) { const value = reply.data as QualityResults[K]; accept(value); return value }
    } catch (error) {
      if (this.requests.get(slot) === request && !this.disposed) {
        const message = (error as { message?: string })?.message
        this.update({ error: message && /[\u3400-\u9fff]/u.test(message) ? message : '质量检测暂不可用，请检查插件和数据库状态后刷新。' })
      }
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', onAbort)
      if (this.requests.get(slot) === request) { this.requests.delete(slot); this.update({ busy: { ...this.state.busy, [slot]: false } }) }
    }
  }
  attach(backend: QualityBackend) {
    this.reset(); this.backend = backend; this.update({ connected: true }); void this.refresh()
    return () => { if (this.backend === backend) { this.backend = null; this.transportLost() } }
  }
  transportLost() { this.reset(); this.update({ connected: false, overview: null, projectId: '' }) }
  refresh = async () => {
    const previous = this.state.projectId
    this.reset(); this.update({ connected: !!this.backend, overview: null, offset: 0 })
    await this.run('overview', 'overview', {}, overview => {
      const projectId = overview.projects.find(project => project.id === previous)?.id ?? overview.projects[0]?.id ?? ''
      this.update({ overview, projectId }); if (overview.ready) void this.load()
    })
  }
  private scope(projectId: string | null = this.state.projectId || null) { return { pluginInstanceId: this.state.overview?.pluginInstanceId ?? '', projectId } }
  private page() { return { ...this.scope(), query: this.state.query, offset: this.state.offset, limit: 30 } }
  setProject = (projectId: string) => {
    if (projectId && !this.state.overview?.projects.some(project => project.id === projectId)) return
    this.reset(); this.update({ projectId, offset: 0 }); void this.load()
  }
  setTab = (tab: Tab) => { this.reset(); this.update({ tab, draft: '', query: '', offset: 0 }); void this.load() }
  setMode = (mode: Mode) => { this.abort('prepare'); this.update({ mode, prepared: null }) }
  setLevel = (level: RuleLevel) => { this.reset(); this.update({ level, tab: 'rules', draft: '', query: '', offset: 0 }); void this.load() }
  setRuleStatus = (ruleStatus: QualityState['ruleStatus']) => { this.update({ ruleStatus, offset: 0 }); void this.load() }
  setDraft = (draft: string) => this.update({ draft: draft.slice(0, 200) })
  search = () => { this.update({ query: this.state.draft, offset: 0 }); void this.load() }
  paginate = (offset: number) => { this.update({ offset }); void this.load() }
  private load = async () => {
    const { tab, level, ruleStatus, projectId } = this.state
    this.abort('list')
    this.abort('detail'); this.abort('prepare')
    this.update({ rules: null, targets: null, detail: null, currentReportId: null, prepared: null, busy: { ...this.state.busy, list: false, detail: false, prepare: false } })
    if (!this.state.overview?.ready) return
    if (tab === 'rules' && (level === 'L0' || projectId)) await this.run('list', 'rules', { ...this.page(), ...this.scope(level === 'L0' ? null : projectId), level, status: ruleStatus }, rules => this.update({ rules }))
    else if (tab === 'detect' && projectId) await this.run('list', 'targets', { ...this.page(), projectId, dimension: 'body' }, targets => this.update({ targets }))
  }
  prepare = async (target: Target) => {
    if (target.dimension !== 'body' || target.ref.kind !== 'chapter_body') { this.update({ error: '仅支持章节正文质量检测。' }); return }
    this.abort('recovery')
    this.update({ prepared: null, detail: null, currentReportId: null, pendingOperationId: null })
    await this.run('prepare', 'prepare', { ...this.scope(), projectId: this.state.projectId, target: target.ref, mode: this.state.mode }, prepared => this.update({ prepared }))
  }
  detect = async () => {
    const prepared = this.state.prepared
    if (!prepared || this.state.busy.detect || this.state.pendingOperationId) return
    const operationId = crypto.randomUUID()
    this.update({ pendingOperationId: operationId })
    await this.run('detect', 'detect', { ...this.scope(), projectId: this.state.projectId, target: prepared.target.ref, mode: prepared.mode, fingerprint: prepared.fingerprint, operationId }, report => {
      this.update({ prepared: null, pendingOperationId: null, notice: '本次检测结果已保存。' }); void this.openReport(report.id)
    })
  }
  stop = () => { this.requests.get('detect')?.abort(new Error('已请求停止检测，请核对本次结果；远端是否结束仍需确认。')) }
  recoverDetection = async () => {
    const operationId = this.state.pendingOperationId
    if (!operationId || this.state.busy.detect || this.state.busy.recovery) return
    // Read only the submitted operation; never redispatch a model call to recover its result.
    await this.run('recovery', 'reports', { ...this.scope(), projectId: this.state.projectId, query: operationId, offset: 0, limit: 30, dimension: 'body', verdict: 'all' }, page => {
      const report = page.items.find(item => item.operationId === operationId)
      if (report) { this.update({ prepared: null, pendingOperationId: null }); void this.openReport(report.id) }
      else this.update({ notice: '暂未读到本次检测结果，请稍后再次核对。没有重新发起检测。' })
    })
  }
  openReport = async (reportId: string) => {
    this.update({ detail: null, currentReportId: reportId })
    await this.run('detail', 'report', { ...this.scope(), projectId: this.state.projectId, reportId }, detail => this.update({ detail }))
  }
  closeReport = () => { this.abort('detail'); this.update({ detail: null, currentReportId: null, busy: { ...this.state.busy, detail: false } }) }
  saveRule = async (content: RuleContent, level: RuleLevel, before: RuleRecord | null) => {
    if (this.state.busy.mutation) return
    return this.run('mutation', 'saveRule', { ...this.scope(level === 'L0' ? null : this.state.projectId), operationId: crypto.randomUUID(), ruleId: before?.id ?? null,
      expectedRevision: before?.revision ?? 0, level, content: { ...content, dimension: 'body' } }, () => { this.update({ notice: '草稿已保存。启用后才参与检测。' }); void this.load() })
  }
  changeRule = async (rule: RuleRecord, status: 'active' | 'retired') => {
    if (this.state.busy.mutation) return
    await this.run('mutation', 'setRuleStatus', { ...this.scope(rule.current.projectId), operationId: crypto.randomUUID(), ruleId: rule.id, expectedRevision: rule.revision, status }, () => {
      this.update({ notice: status === 'active' ? '规则已启用，后续检测使用此版本。' : '规则已停用，后续检测不再使用此规则。' }); void this.load()
    })
  }
  cancelReport = async (reportId: string) => {
    await this.run('mutation', 'cancel', { ...this.scope(), projectId: this.state.projectId, reportId, operationId: crypto.randomUUID() }, () => { void this.openReport(reportId) })
  }
  dispose() { this.reset(); this.disposed = true; this.backend = null; this.listeners.clear() }
}
