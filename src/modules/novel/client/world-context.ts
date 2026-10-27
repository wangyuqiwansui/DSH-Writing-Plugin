import { canonicalJson, type VersionRef } from '../../../shared/contracts/index.js'
import type { WorldBackend, WorldQueryResult, WorldReferenceRepair } from '../../worldbuilding/contracts/index.js'

export interface NovelWorldBinding { projectId: string; sourceVersion: VersionRef }
export interface NovelWorldContextState {
  connected: boolean; busy: boolean; queryText: string; maxCharacters: number
  result: WorldQueryResult | null; error: string | null
}
/** Transient query state. Authority comes from the current confirmed novel binding. */
export class NovelWorldContext {
  private backend: WorldBackend | null = null
  private active: AbortController | null = null
  private selection: { binding: string; recordIds: string[] } | null = null
  private disposed = false
  private listeners = new Set<() => void>()
  private state: NovelWorldContextState = { connected: false, busy: false, queryText: '', maxCharacters: 8000, result: null, error: null }
  constructor(private readonly binding: () => NovelWorldBinding, private readonly timeoutMs = 15_000,
    private readonly repairSource?: (binding: NovelWorldBinding, repair: WorldReferenceRepair, signal: AbortSignal) => Promise<void>) {}
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { if (!this.disposed) this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(patch: Partial<NovelWorldContextState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }; this.listeners.forEach(l => l())
  }
  invalidate = () => {
    this.active?.abort(new Error('查询范围已变化，请重新查询')); this.active = null
    this.selection = null
    this.update({ busy: false, result: null, error: null })
  }
  setText = (queryText: string) => { this.invalidate(); this.update({ queryText }) }
  setBudget = (maxCharacters: number) => { this.invalidate(); this.update({ maxCharacters }) }
  attach(backend: WorldBackend) {
    this.invalidate(); this.backend = backend; this.update({ connected: true })
    return () => { if (this.backend === backend) { this.backend = null; this.transportLost() } }
  }
  transportLost = () => { this.invalidate(); this.update({ connected: false, error: '世界观连接已断开，恢复连接后重新查询。' }) }
  connected = () => { this.invalidate(); this.update({ connected: !!this.backend }) }
  cancel = () => { this.invalidate(); this.update({ error: '已取消材料查询' }) }
  async search(recordIds: string[] = []): Promise<boolean> {
    if (this.disposed || this.state.busy) return false
    this.update({ result: null, error: null })
    if (!this.backend || !this.state.connected) { this.update({ error: '世界观查询服务未连接' }); return false }
    let binding: NovelWorldBinding
    try { binding = this.binding() } catch (error) { this.update({ error: (error as Error).message }); return false }
    const signature = canonicalJson(binding), request = new AbortController()
    const chosenIds = [...new Set([...(this.selection?.binding === signature ? this.selection.recordIds : []), ...recordIds])]
    this.active = request; this.update({ busy: true })
    const timer = setTimeout(() => request.abort(new Error('材料查询超时，请重试')), this.timeoutMs)
    let rejectAbort = () => {}
    try {
      const cancelled = new Promise<never>((_, reject) => { rejectAbort = () => reject(request.signal.reason); request.signal.addEventListener('abort', rejectAbort, { once: true }) })
      const reply = await Promise.race([this.backend.invoke({
        action: 'query', sourceVersion: binding.sourceVersion,
        query: { text: this.state.queryText, recordIds: chosenIds, maxCharacters: this.state.maxCharacters, maxRecords: 50 },
      }, request.signal), cancelled])
      request.signal.throwIfAborted()
      if (this.active !== request || this.disposed) return false
      if (canonicalJson(this.binding()) !== signature) throw new Error('小说绑定已变化，请重新查询')
      if (!reply.ok) throw new Error(reply.message)
      const result = reply.data as WorldQueryResult | null
      if (!result || result.schemaVersion !== 'writing-world-context-v1' || result.purpose !== 'author_planning') throw new Error('查询结果与当前世界版本不一致')
      let finalBinding = signature
      if (canonicalJson(result.sourceVersion) !== canonicalJson(binding.sourceVersion)) {
        const repair = result.sourceRepair
        if (!this.repairSource || !repair || canonicalJson(repair.before) !== canonicalJson(binding.sourceVersion)
          || canonicalJson(repair.after) !== canonicalJson(result.sourceVersion)) throw new Error('查询结果与当前世界版本不一致')
        await this.repairSource(binding, repair, request.signal)
        request.signal.throwIfAborted()
        if (this.active !== request || this.disposed) return false
        finalBinding = canonicalJson({ ...binding, sourceVersion: repair.after })
        if (canonicalJson(this.binding()) !== finalBinding) throw new Error('小说绑定已变化，请重新查询')
      }
      this.selection = { binding: finalBinding, recordIds: chosenIds }
      this.update({ result }); return true
    } catch (error) {
      if (this.active === request) this.update({ error: (error as Error).message || '材料查询未完成' })
      return false
    } finally {
      clearTimeout(timer); request.signal.removeEventListener('abort', rejectAbort)
      if (this.active === request) { this.active = null; this.update({ busy: false }) }
    }
  }
  dispose() { this.invalidate(); this.disposed = true; this.backend = null; this.listeners.clear() }
}
