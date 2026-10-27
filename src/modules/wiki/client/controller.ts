import type { KnowledgeListing, VersionRef } from '../../../shared/contracts/index.js'
import type { WikiBackend, WikiDetail, WikiOverview } from '../contracts/index.js'

type Slot = 'overview' | 'list' | 'detail'
export interface WikiState {
  connected: boolean; overview: WikiOverview | null; projectId: string; kind: 'pages' | 'sources'
  draft: string; query: string; includeInactive: boolean; offset: number
  listing: KnowledgeListing | null; detail: WikiDetail | null; trail: VersionRef[]
  busy: Record<Slot, boolean>; error: string | null
}
export class WikiController {
  private backend: WikiBackend | null = null
  private disposed = false
  private requests: Partial<Record<Slot, AbortController>> = {}
  private listeners = new Set<() => void>()
  private state: WikiState = { connected: false, overview: null, projectId: '', kind: 'pages', draft: '', query: '', includeInactive: false,
    offset: 0, listing: null, detail: null, trail: [], busy: { overview: false, list: false, detail: false }, error: null }
  constructor(private readonly timeoutMs = 15_000) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { if (this.disposed) return () => {}; this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<WikiState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(listener => listener())
  }
  private cancel(slot: Slot) { this.requests[slot]?.abort(); delete this.requests[slot] }
  private clearRequests() { for (const slot of ['overview', 'list', 'detail'] as const) this.cancel(slot) }
  private async run<T>(slot: Slot, call: (backend: WikiBackend, signal: AbortSignal) => Promise<T>, accept: (value: T) => void) {
    this.cancel(slot)
    if (!this.backend || this.disposed) return
    const request = new AbortController()
    this.requests[slot] = request
    this.update({ busy: { ...this.state.busy, [slot]: true }, error: null })
    const timer = setTimeout(() => request.abort(new Error('读取超时，请刷新重试。')), this.timeoutMs)
    let onAbort: () => void = () => {}
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(request.signal.reason)
        request.signal.addEventListener('abort', onAbort, { once: true })
      })
      const value = await Promise.race([call(this.backend, request.signal), cancelled])
      if (this.requests[slot] === request && !this.disposed) accept(value)
    } catch (error) {
      if (this.requests[slot] === request && !this.disposed) {
        const message = (error as { message?: unknown })?.message
        this.update({ error: typeof message === 'string' && /[\u3400-\u9fff]/u.test(message) ? message : '读取失败，数据库或引用可能已变化。请刷新后重试。' })
      }
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', onAbort)
      if (this.requests[slot] === request) { delete this.requests[slot]; this.update({ busy: { ...this.state.busy, [slot]: false } }) }
    }
  }
  attach(backend: WikiBackend): () => void {
    this.clearRequests(); this.backend = backend
    this.update({ connected: true })
    void this.refresh()
    return () => { if (this.backend === backend) { this.backend = null; this.transportLost() } }
  }
  transportLost() {
    this.clearRequests()
    this.update({ connected: false, overview: null, projectId: '', listing: null, detail: null, trail: [],
      busy: { overview: false, list: false, detail: false }, error: null })
  }
  refresh = async () => {
    this.clearRequests()
    const previousProject = this.state.projectId
    this.update({ connected: !!this.backend, overview: null, projectId: '', listing: null, detail: null, trail: [], offset: 0,
      busy: { overview: false, list: false, detail: false } })
    await this.run('overview', (backend, signal) => backend.overview(signal), overview => {
      const projectId = overview.projects.find(project => project.id === previousProject)?.id ?? overview.projects[0]?.id ?? ''
      this.update({ overview, projectId })
      if (overview.ready && projectId) void this.load()
    })
  }
  setProject = (projectId: string) => {
    if (!this.state.overview?.projects.some(project => project.id === projectId)) return
    this.update({ projectId, offset: 0 }); void this.load()
  }
  setKind = (kind: 'pages' | 'sources') => { this.update({ kind, offset: 0 }); void this.load() }
  setDraft = (draft: string) => this.update({ draft: draft.slice(0, 200) })
  search = () => { this.update({ query: this.state.draft.trim(), offset: 0 }); void this.load() }
  setInactive = (includeInactive: boolean) => { this.update({ includeInactive, offset: 0 }); void this.load() }
  paginate = (offset: number) => { this.update({ offset }); void this.load() }
  private scope() { return { projectId: this.state.projectId, pluginInstanceId: this.state.overview?.pluginInstanceId ?? '' } }
  private async load() {
    this.cancel('detail')
    this.update({ listing: null, detail: null, trail: [], busy: { ...this.state.busy, detail: false } })
    const scope = this.scope()
    if (!scope.projectId || !scope.pluginInstanceId) return
    const { kind, query, offset, includeInactive } = this.state
    await this.run('list', (backend, signal) => backend.browse({ ...scope, kind, query, offset, includeInactive }, signal), listing => this.update({ listing }))
  }
  open = (ref: VersionRef, follow = false, offset = 0) => {
    const scope = this.scope()
    if (ref.projectId !== scope.projectId || ref.pluginInstanceId !== scope.pluginInstanceId) {
      this.update({ error: '此链接不属于当前项目，无法打开。' }); return
    }
    const trail = follow && this.state.detail ? [...this.state.trail, this.state.detail.record.ref].slice(-20) : follow ? this.state.trail : []
    this.update({ detail: null, trail })
    return this.run('detail', (backend, signal) => backend.read({ ...scope, ref, offset }, signal), detail => this.update({ detail }))
  }
  back = () => {
    const trail = [...this.state.trail]
    const ref = trail.pop()
    if (!ref) return
    this.update({ detail: null, trail }); void this.open(ref, true)
  }
  readChunk = (offset: number) => {
    const ref = this.state.detail?.record.ref
    if (!ref) return
    this.update({ detail: null }); void this.open(ref, true, offset)
  }
  closeDetail = () => { this.cancel('detail'); this.update({ detail: null, trail: [], busy: { ...this.state.busy, detail: false } }) }
  dispose() { this.clearRequests(); this.backend = null; this.disposed = true; this.listeners.clear() }
}
