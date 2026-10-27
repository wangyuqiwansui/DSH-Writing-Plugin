import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { REQUEST_MODULES, type RequestCompletion, type RequestContext, type RequestHook, type RequestModule } from '../../shared/middleware.js'
import type {} from '../../shared/remote.js'

type Scope = { context: RequestContext; signal: AbortSignal; controller: AbortController; started: number; hooks: HookEntry[] }
type HookEntry = { hook: RequestHook; active: boolean }
const ownerErrors = {
  knowledge: 'writing-middleware/owner-required', 'knowledge-query': 'writing-middleware/owner-required',
  database: 'writing-database/owner-required', wiki: 'writing-wiki/owner-required', worldbuilding: 'writing-world/owner-required',
  'author-persona': 'writing-persona/owner-required',
  quality: 'writing-quality/owner-required', chat: 'writing-chat/owner-required', models: 'writing-middleware/owner-required',
} as const

/** One execution boundary for remote requests, internal tasks and data operations. */
export class RequestPipeline {
  private readonly current = new AsyncLocalStorage<RequestContext>()
  private readonly active = new Set<AbortController>()
  private readonly hooks = new Map<string, HookEntry>()
  private readonly history: RequestCompletion[] = []
  private closed = false
  private observerFailures = 0

  use(hook: RequestHook): () => void {
    this.alive()
    if (!/^[\w.-]{1,80}$/.test(hook.id) || this.hooks.has(hook.id)) throw new RemoteError('writing-middleware/invalid-request', '中间件钩子标识无效或重复', {})
    const entry = { hook: Object.freeze({ ...hook }), active: true }
    this.hooks.set(hook.id, entry)
    return () => { entry.active = false; if (this.hooks.get(hook.id) === entry) this.hooks.delete(hook.id) }
  }
  diagnostics() { return { activeRequests: this.active.size, observerFailures: this.observerFailures, recent: this.history.map(item => ({ ...item })) } }
  dispose() {
    if (this.closed) return
    this.closed = true
    for (const controller of this.active) controller.abort(new RemoteError('writing-middleware/unavailable', '请求中间件已卸载', {}))
    for (const entry of this.hooks.values()) entry.active = false
    this.hooks.clear(); this.history.length = 0
  }
  private alive() { if (this.closed) throw new RemoteError('writing-middleware/unavailable', '请求中间件已卸载', {}) }
  private scope(module: RequestModule, operation: string, layer: RequestContext['layer'], origin: RequestContext['origin'], signal?: AbortSignal): Scope {
    this.alive()
    if (!REQUEST_MODULES.includes(module) || !/^[a-z][\w.:-]{0,63}$/i.test(operation)) throw new RemoteError('writing-middleware/invalid-request', '请求模块或操作无效', {})
    const controller = new AbortController()
    this.active.add(controller)
    return { context: Object.freeze({ id: randomUUID(), parentId: this.current.getStore()?.id ?? null, module, operation, layer, origin, startedAt: new Date().toISOString() }),
      signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal, controller, started: performance.now(), hooks: [...this.hooks.values()] }
  }
  private synchronous(value: unknown) {
    if (value && typeof (value as { then?: unknown }).then === 'function') {
      void Promise.resolve(value).catch(() => {})
      throw new RemoteError('writing-middleware/async-hook', '中间件钩子和数据操作必须同步完成', {})
    }
  }
  private enter(scope: Scope, principal?: string) {
    scope.signal.throwIfAborted()
    if (scope.context.origin === 'remote' && principal !== 'owner') throw new RemoteError(ownerErrors[scope.context.module], '只有宿主所有者可以访问写作工作台服务', {})
    for (const entry of scope.hooks) if (entry.active && entry.hook.before) this.synchronous(entry.hook.before(scope.context))
    scope.signal.throwIfAborted(); this.alive()
  }
  private finish(scope: Scope, outcome: RequestCompletion['outcome'], error?: unknown) {
    this.active.delete(scope.controller)
    const rawCode = (error as { code?: unknown } | null)?.code
    const completion: RequestCompletion = Object.freeze({ ...scope.context, outcome, durationMs: Math.max(0, performance.now() - scope.started),
      errorCode: outcome === 'succeeded' ? null : typeof rawCode === 'string' && /^[\w/:-]{1,80}$/.test(rawCode) ? rawCode : outcome === 'cancelled' ? 'CANCELLED' : 'ERROR' })
    if (!this.closed) { this.history.push(completion); if (this.history.length > 200) this.history.shift() }
    // Observability must never turn a committed write into a retryable failure.
    for (const entry of [...scope.hooks].reverse()) if (entry.active && entry.hook.after) {
      try { this.synchronous(entry.hook.after(completion)) } catch { this.observerFailures++ }
    }
  }
  private async execute<T>(module: RequestModule, operation: string, origin: RequestContext['origin'], principal: string | undefined, handler: (signal: AbortSignal) => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    const scope = this.scope(module, operation, 'request', origin, signal)
    return this.current.run(scope.context, async () => {
      try { this.enter(scope, principal); const value = await handler(scope.signal); this.finish(scope, 'succeeded'); return value }
      catch (error) { this.finish(scope, scope.signal.aborted ? 'cancelled' : 'failed', error); throw error }
    })
  }
  request<T>(module: RequestModule, operation: string, principal: string | undefined, handler: (signal: AbortSignal) => T | Promise<T>, signal?: AbortSignal) {
    return this.execute(module, operation, 'remote', principal, handler, signal)
  }
  task<T>(module: RequestModule, operation: string, handler: (signal: AbortSignal) => T | Promise<T>, signal?: AbortSignal) {
    return this.execute(module, operation, 'internal', undefined, handler, signal)
  }
  dataCall<T>(module: RequestModule, operation: string, handler: (signal: AbortSignal) => T, signal?: AbortSignal): T {
    const scope = this.scope(module, operation, 'data', 'internal', signal)
    return this.current.run(scope.context, () => {
      try { this.enter(scope); const result = handler(scope.signal); this.synchronous(result); this.finish(scope, 'succeeded'); return result }
      catch (error) { this.finish(scope, scope.signal.aborted ? 'cancelled' : 'failed', error); throw error }
    })
  }
  async *stream<T>(module: RequestModule, operation: string, principal: string | undefined, handler: (signal: AbortSignal) => AsyncIterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
    const scope = this.scope(module, operation, 'request', 'remote', signal)
    let iterator: AsyncIterator<T> | undefined, complete = false, failed = false, failure: unknown
    try {
      this.current.run(scope.context, () => this.enter(scope, principal))
      iterator = this.current.run(scope.context, () => handler(scope.signal)[Symbol.asyncIterator]())
      while (true) {
        scope.signal.throwIfAborted()
        const step = await this.current.run(scope.context, () => iterator!.next())
        scope.signal.throwIfAborted()
        if (step.done) { complete = true; return }
        yield step.value
      }
    } catch (error) { failed = true; failure = error; throw error }
    finally {
      const cancelled = !complete && (scope.signal.aborted || !failed)
      if (!complete) scope.controller.abort(new Error('请求流已关闭'))
      let cleanupFailed = false, cleanupError: unknown
      try { if (!complete && iterator?.return) await this.current.run(scope.context, () => iterator!.return!()) }
      catch (error) { cleanupFailed = true; cleanupError = error }
      this.finish(scope, complete ? 'succeeded' : cancelled && !cleanupFailed ? 'cancelled' : 'failed', failed ? failure : cleanupError)
      // Cleanup must not replace the original stream failure.
      if (!failed && cleanupFailed) throw cleanupError
    }
  }
}
