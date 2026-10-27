import type { QualityDataPort } from '../../shared/middleware.js'
import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson, requireValue, type JsonValue } from '../../shared/contracts/index.js'
import { DETECTOR_VERSION, QUALITY_VERSION, parseQualityRequest, type DetectCommand, type DetectionInput, type PreparedDetection, type QualityReply, type QualityRequest,
  type QualityReport, type QualityScope, type CancelCommand } from './contracts.js'
import type { QualitySnapshot } from './storage-contracts.js'
import { deterministicChecks, parseSemanticResponse, verdict } from './detectors.js'

export interface SemanticCall { model: Record<string, string>; run(input: PreparedDetection, signal: AbortSignal, onText: (text: string) => void): Promise<void> }
export interface SemanticProvider { available(): boolean; prepare(signal: AbortSignal): Promise<SemanticCall> }
export interface QualityConfig { timeoutMs: number }
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
const safeError = (error: unknown) => error instanceof Error ? error.message.slice(0, 500) : '检测执行失败'
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error('已取消'))
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted)).catch(() => {})
  })
}
/** No model call, rule activation, migration or recovery write occurs during construction. */
export class QualityService {
  readonly generation = randomUUID()
  private closed = false
  private operations = new Map<string, { controller: AbortController; promise: Promise<QualityReport>; report: QualityReport }>()
  constructor(private storage: QualityDataPort, private semantic?: SemanticProvider, private config: QualityConfig = { timeoutMs: 120_000 }) {}
  private alive(signal?: AbortSignal) { requireValue(!this.closed, 'STORAGE_DISPOSED', '质量检测插件已卸载'); signal?.throwIfAborted() }
  private scope(value: QualityScope) { return { pluginInstanceId: value.pluginInstanceId, projectId: value.projectId } }
  private prepareIn(store: QualitySnapshot, input: DetectionInput): PreparedDetection {
    const target = store.target(input.target), rules = store.activeRules(target.dimension)
    requireValue(rules.length <= 100, 'INVALID_INPUT', '单次检测最多支持 100 条生效规则，请缩小规则范围')
    const required = new Set(rules.filter(rule => rule.checkType === 'deterministic' && rule.detector === 'required_literal').map(rule => rule.literal))
    requireValue(!rules.some(rule => rule.checkType === 'deterministic' && rule.detector === 'forbidden_literal' && required.has(rule.literal)), 'STATE_CONFLICT', '生效规则同时要求包含和禁止同一文本，请先处理规则冲突')
    const fingerprint = digest({ target: target.ref, latest: target.latest, rules, mode: input.mode, detectorVersion: DETECTOR_VERSION, timeoutMs: this.config.timeoutMs })
    return { target, rules, mode: input.mode, fingerprint, detectorVersion: DETECTOR_VERSION, semanticAvailable: this.semantic?.available() ?? false, checks: deterministicChecks(target, rules, input.mode) }
  }
  private visible(report: QualityReport): QualityReport {
    if (report.execution === 'running' && report.generation !== this.generation) return { ...report, execution: 'unknown', verdict: 'not_evaluated', error: '先前插件实例已结束，执行结果未知；没有自动重放模型调用。' }
    return report
  }
  async invoke(value: QualityRequest, signal?: AbortSignal): Promise<QualityReply> {
    this.alive(signal)
    const request = parseQualityRequest(value)
    if (request.action === 'overview') {
      const status = this.storage.status(signal), semanticAvailable = this.semantic?.available() ?? false
      return { action: request.action, data: { ready: status.databaseReady, message: status.message, semanticAvailable,
        pluginInstanceId: status.databaseReady ? this.storage.instanceId() : null, projects: status.databaseReady ? this.storage.listProjects(signal) : [] } }
    }
    const input = request.input
    if (request.action === 'detect') return { action: 'detect', data: await this.detect(request.input, signal) }
    if (request.action === 'cancel') return { action: 'cancel', data: this.cancel(request.input) }
    if (request.action === 'saveRule' || request.action === 'setRuleStatus') {
      const data = this.storage.qualityCommand({ ...this.scope(input), operationId: request.input.operationId, input: request as unknown as JsonValue },
        store => request.action === 'saveRule' ? store.saveRule(request.input) : store.setRuleStatus(request.input), signal).result
      return { action: request.action, data }
    }
    return this.storage.openQualitySnapshot(input, store => {
      switch (request.action) {
        case 'rules': return { action: request.action, data: store.rules(request.input) }
        case 'targets': return { action: request.action, data: store.targets(request.input) }
        case 'prepare': return { action: request.action, data: this.prepareIn(store, request.input) }
        case 'reports': {
          const page = store.reports(request.input)
          return { action: request.action, data: { ...page, items: page.items.map(value => value.execution === 'running' && value.generation !== this.generation
            ? { ...value, execution: 'unknown' as const, verdict: 'not_evaluated' as const, error: '先前实例执行结果未知' } : value) } }
        }
        case 'logs': return { action: request.action, data: store.logs(request.input) }
        case 'report': {
          const report = this.visible(store.report(request.input.reportId))
          let current = false, currentReason = '目标或规则已变化，此报告保留历史检查结果。'
          try {
            const prepared = this.prepareIn(store, { ...this.scope(report), projectId: report.projectId, target: report.target.ref, mode: report.mode })
            current = prepared.target.latest && prepared.fingerprint === report.fingerprint
            if (current) currentReason = '目标版本与当前生效规则一致。'
          } catch { currentReason = '当前目标或规则无法核验，报告仅供历史追溯。' }
          return { action: request.action, data: { report, current, currentReason } }
        }
      }
    }, signal) as QualityReply
  }
  private detect(input: DetectCommand, signal?: AbortSignal): Promise<QualityReport> {
    this.alive(signal)
    const begin = this.storage.qualityCommand({ ...this.scope(input), operationId: input.operationId, input: { action: 'detect', input } as unknown as JsonValue }, store => {
      const prepared = this.prepareIn(store, input)
      requireValue(input.fingerprint === prepared.fingerprint, 'HEAD_CONFLICT', '正文或规则已变化，请重新预览检测范围')
      return store.insertReport({ schemaVersion: QUALITY_VERSION, id: randomUUID(), ...this.scope(input), projectId: input.projectId, operationId: input.operationId, generation: this.generation,
        createdAt: new Date().toISOString(), completedAt: null, target: prepared.target, rules: prepared.rules, mode: input.mode,
        fingerprint: prepared.fingerprint, detectorVersion: DETECTOR_VERSION, execution: 'running', verdict: 'not_evaluated', checks: prepared.checks, rawResponse: null, model: null, error: null })
    }, signal)
    const report = begin.result, live = this.operations.get(report.id)
    if (live) return live.promise
    if (begin.replayed) return Promise.resolve(this.visible(this.storage.openQualitySnapshot(input, store => store.report(report.id))))
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason ?? new Error('检测已取消'))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const timer = setTimeout(() => controller.abort(new Error('检测超时；没有自动重试')), this.config.timeoutMs)
    const promise = this.run(report, controller.signal).finally(() => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort); this.operations.delete(report.id)
    })
    this.operations.set(report.id, { controller, promise, report })
    return promise
  }
  private finish(report: QualityReport): QualityReport {
    this.alive()
    return this.storage.qualityCommand({ ...this.scope(report), operationId: `quality.finish:${report.id}`, input: report as unknown as JsonValue }, store => store.finishReport(report)).result
  }
  private async run(initial: QualityReport, signal: AbortSignal): Promise<QualityReport> {
    let report = initial, raw = '', responseComplete = false
    try {
      signal.throwIfAborted()
      if (report.mode !== 'deterministic' && report.checks.some(check => check.type === 'semantic')) {
        requireValue(this.semantic?.available(), 'STORAGE_UNAVAILABLE', '宿主模型服务不可用，语义检查未完成')
        const call = await abortable(this.semantic!.prepare(signal), signal)
        this.alive(signal)
        report = this.storage.qualityCommand({ ...this.scope(report), operationId: `quality.dispatch:${report.id}`, input: { reportId: report.id, generation: this.generation, model: call.model } },
          store => store.bindModel(report.id, this.generation, call.model), signal).result
        report = { ...report, rawResponse: '' }
        const prepared: PreparedDetection = { target: report.target, rules: report.rules, mode: report.mode, fingerprint: report.fingerprint, detectorVersion: report.detectorVersion, semanticAvailable: true, checks: report.checks }
        await abortable(call.run(prepared, signal, chunk => {
          this.alive(signal); requireValue(raw.length + chunk.length <= 200_000, 'INVALID_INPUT', '语义结果超过大小限制'); raw += chunk
        }), signal)
        responseComplete = true
        this.alive(signal)
        report = { ...report, rawResponse: raw, checks: parseSemanticResponse(raw, report.checks, report.target.text) }
      }
      this.alive(signal)
      report = { ...report, execution: 'succeeded', verdict: verdict(report.checks), completedAt: new Date().toISOString() }
    } catch (error) {
      if (this.closed) return { ...report, execution: 'unknown', verdict: 'not_evaluated', error: '插件已卸载，结果待核对。' }
      report = { ...report, rawResponse: raw || report.rawResponse, execution: report.model && !responseComplete ? 'unknown' : signal.aborted ? 'cancelled' : 'failed', verdict: 'not_evaluated',
        error: (report.model && !responseComplete ? '模型调用已发起，远端完成状态未知。' : '') + safeError(signal.aborted ? signal.reason : error), completedAt: new Date().toISOString() }
    }
    // A cancellation command may have already committed a terminal report.
    const stored = this.storage.openQualitySnapshot(report, store => store.report(report.id))
    return stored.execution === 'running' ? this.finish(report) : stored
  }
  private cancel(input: CancelCommand): QualityReport {
    const result = this.storage.qualityCommand({ ...this.scope(input), operationId: input.operationId, input: { action: 'cancel', input } as unknown as JsonValue }, store => {
      const report = store.report(input.reportId)
      if (report.execution !== 'running') return report
      return store.finishReport({ ...report, execution: report.generation === this.generation && report.model === null ? 'cancelled' : 'unknown', verdict: 'not_evaluated', completedAt: new Date().toISOString(),
        error: report.model ? '用户已停止本地等待；模型调用已发起，远端是否结束未知。未自动重试。' : '用户停止本次检测；未自动重试。' })
    }).result
    this.operations.get(result.id)?.controller.abort(new Error('用户取消检测'))
    return result
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const operation of this.operations.values()) operation.controller.abort(new Error('质量检测插件已卸载'))
    // run() races every asynchronous provider boundary against this abort; no shared storage is closed.
    await Promise.allSettled([...this.operations.values()].map(operation => operation.promise))
    this.operations.clear()
  }
}
