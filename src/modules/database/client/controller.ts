import { parsePath, type DatabaseBackend, type DatabaseInspection, type DatabaseSettings } from '../contracts/management.js'

export interface DatabasePageState {
  current: DatabaseSettings | null
  draft: string
  inspection: DatabaseInspection | null
  busy: 'load' | 'inspect' | 'save' | null
  connected: boolean
  notice: { kind: 'success' | 'error' | 'info'; message: string } | null
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '数据库服务暂时不可用，请重试。'

/** The page's draft outlives navigation. Late read results can never overwrite an edit. */
export class DatabaseController {
  private backend: DatabaseBackend | null = null
  private disposed = false
  private listeners = new Set<() => void>()
  private request: AbortController | null = null
  private sequence = 0
  private state: DatabasePageState = { current: null, draft: '', inspection: null, busy: null, connected: false, notice: null }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<DatabasePageState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }
  private cancel() { this.sequence++; this.request?.abort(); this.request = null }
  transportLost = () => {
    this.cancel()
    this.update({ connected: false, busy: null, inspection: null,
      notice: { kind: 'error', message: '与 DSH 数据库服务的连接已断开，输入已保留。恢复连接后请刷新核对配置。' } })
  }
  attach(backend: DatabaseBackend): () => void {
    if (this.disposed) return () => {}
    this.backend = backend
    void this.refresh()
    return () => {
      if (this.backend !== backend) return
      this.backend = null
      this.transportLost()
    }
  }
  setDraft = (draft: string) => {
    if (this.state.busy === 'save') return
    this.cancel()
    this.update({ draft, inspection: null, busy: null, notice: null })
  }
  resetDraft = () => this.setDraft(this.state.current?.databasePath ?? '')
  private accept(current: DatabaseSettings) {
    const clean = !this.state.current ? !this.state.draft : this.state.draft === this.state.current.databasePath
    this.update({ current, connected: true, ...(clean ? { draft: current.databasePath, inspection: null } : {}) })
  }
  private async run(busy: NonNullable<DatabasePageState['busy']>, task: (backend: DatabaseBackend, signal: AbortSignal, active: () => boolean) => Promise<void>) {
    if (this.disposed || this.state.busy === 'save') return
    if (!this.backend) {
      this.update({ notice: { kind: 'error', message: '数据库配置需要连接 DSH 宿主。请在 DSH 中打开写作工作台。' } }); return
    }
    this.cancel()
    const generation = this.sequence
    const request = new AbortController()
    this.request = request
    const current = () => !this.disposed && generation === this.sequence
    const active = () => current() && !request.signal.aborted
    const timer = setTimeout(() => request.abort(new Error('请求超时，请刷新核对当前配置。')), 15000)
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(request.signal.reason)
      request.signal.addEventListener('abort', onAbort, { once: true })
    })
    this.update({ busy, notice: null })
    try { await Promise.race([task(this.backend, request.signal, active), aborted]) }
    catch (error) {
      if (current()) this.update({ notice: { kind: 'error', message: busy === 'save'
        ? `未能确认保存结果。${errorMessage(error)} 刷新核对后再保存。` : errorMessage(error) },
        ...(busy === 'load' ? { connected: false } : {}), inspection: null })
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', onAbort)
      if (current()) { this.request = null; this.update({ busy: null }) }
    }
  }
  refresh = () => this.run('load', async (backend, signal, active) => {
    const current = await backend.read(signal)
    if (active()) this.accept(current)
  })
  inspect = () => this.run('inspect', async (backend, signal, active) => {
    const path = parsePath(this.state.draft)
    const result = await backend.inspect(path, signal)
    if (active()) this.update({ inspection: result })
  })
  save = () => this.run('save', async (backend, signal, active) => {
    const current = this.state.current
    const inspection = this.state.inspection
    const path = parsePath(this.state.draft)
    if (!this.state.connected || !current?.editable) throw new Error('当前配置不可编辑。')
    if (inspection?.status.databasePath !== path || !inspection.status.databaseReady || !inspection.writable) {
      throw new Error('请先测试当前输入的数据库连接。')
    }
    try { await backend.save({ databasePath: path, revision: current.revision }, signal) }
    catch (error) {
      // Reconcile, but never silently retry a write whose result may be unknown.
      try { const latest = await backend.read(signal); if (active()) this.accept(latest) } catch { /* keep the last known config */ }
      throw error
    }
    if (!active()) return
    const latest = await backend.read(signal)
    if (!active()) return
    this.accept(latest)
    if (latest.databasePath !== path || !latest.inspection.status.databaseReady) throw new Error('宿主尚未应用所选数据库。')
    this.update({ draft: latest.databasePath, inspection: null,
      notice: { kind: 'success', message: '配置已保存并生效，重启 DSH 后将继续使用此数据库。' } })
  })
  dispose() { this.cancel(); this.disposed = true; this.listeners.clear(); this.backend = null }
}
