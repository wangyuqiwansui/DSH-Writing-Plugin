import { canonicalJson, nonempty, requireValue, VersionRefSchema, type CommandEnvelope, type JsonValue, type TaskResult, type VersionRef } from './index.js'

export const EXECUTION_CONTRACT = 'writing-execution-v1' as const
export interface ExecutionPolicy {
  maxAttempts: number; timeoutMs: number; leaseMs: number; retryDelayMs: number
}
export interface RunBudget { maxAttempts: number; maxOutputTokens: number }
export interface ExecutionRequest {
  contractVersion: typeof EXECUTION_CONTRACT
  role: string; provider: string; model: string; system: string; prompt: string
  maxTokens: number; temperature?: number
  sources: VersionRef[]; policy: ExecutionPolicy
}
export type AttemptStatus = 'prepared' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled'
export interface ExecutionAttempt {
  id: string; taskId: string; number: number; status: AttemptStatus
  worker: string; fence: number; dispatchFence: number | null; leaseUntil: number
  cancelRequested: boolean; retryable: boolean; failureCode: string | null; retryAt: number
  output: VersionRef | null; receipt: VersionRef | null
}
export interface ExecutionRecord {
  taskId: string; runId: string; request: VersionRef; attempts: ExecutionAttempt[]
  budget: RunBudget & { usedAttempts: number; reservedOutputTokens: number; taskMaxAttempts: number }
}
export interface ExecutionEvidence {
  sequence: number; attemptId: string; fence: number; key: string; type: string
  payload: JsonValue; quarantined: boolean; time: number
}
export interface AttemptUpdate {
  status?: AttemptStatus; dispatch?: boolean; cancelRequested?: boolean
  retryable?: boolean; failureCode?: string | null; retryAt?: number
  output?: VersionRef; receipt?: VersionRef
}
export interface ExecutionSnapshot {
  getExecution(taskId: string): ExecutionRecord | null
  executionTasks(): string[]
  executionEvidence(attemptId: string): ExecutionEvidence[]
}
export interface ExecutionTransaction extends ExecutionSnapshot {
  configureExecutionBudget(runId: string, budget: RunBudget): void
  registerExecution(taskId: string, request: VersionRef): void
  reserveAttempt(taskId: string, worker: string, now: number): ExecutionAttempt
  claimAttempt(attemptId: string, worker: string, now: number): ExecutionAttempt
  requestAttemptCancel(attemptId: string): void
  updateAttempt(attemptId: string, worker: string, fence: number, now: number, update: AttemptUpdate): ExecutionAttempt
  recordExecutionEvidence(attemptId: string, fence: number, key: string, type: string, payload: JsonValue, now: number): void
}
export interface ExecutionView extends TaskResult {
  taskId: string; request: VersionRef; attempts: ExecutionAttempt[]
}
export interface WritingExecution {
  submit(command: CommandEnvelope, signal?: AbortSignal): Promise<ExecutionView>
  inspect(projectId: string, taskId: string): ExecutionView
  capture(projectId: string, taskId: string, signal?: AbortSignal): Promise<ExecutionView>
  retry(command: CommandEnvelope, signal?: AbortSignal): Promise<ExecutionView>
  cancel(command: CommandEnvelope): Promise<ExecutionView>
  recover(projectId: string): Promise<ExecutionView[]>
  resolveUnknown(command: CommandEnvelope): ExecutionView
}
function positive(value: unknown, name: string, max = Number.MAX_SAFE_INTEGER) {
  requireValue(Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max, 'INVALID_INPUT', `${name} must be a positive bounded integer`)
}
export function parseExecutionRequest(value: unknown): ExecutionRequest {
  const v = JSON.parse(canonicalJson(value)) as ExecutionRequest
  requireValue(v !== null && typeof v === 'object' && v.contractVersion === EXECUTION_CONTRACT, 'UNSUPPORTED_CONTRACT', 'Unknown execution contract')
  for (const key of ['role', 'provider', 'model', 'prompt'] as const) nonempty(v[key], key)
  requireValue(typeof v.system === 'string', 'INVALID_INPUT', 'system must be text')
  positive(v.maxTokens, 'maxTokens', 10000000)
  requireValue(v.temperature === undefined || (typeof v.temperature === 'number' && v.temperature >= 0 && v.temperature <= 2), 'INVALID_INPUT', 'Invalid temperature')
  requireValue(Array.isArray(v.sources), 'INVALID_INPUT', 'sources must be an array')
  v.sources.forEach(ref => VersionRefSchema.parse(ref))
  requireValue(v.policy !== null && typeof v.policy === 'object', 'INVALID_INPUT', 'Explicit policy required')
  positive(v.policy.maxAttempts, 'maxAttempts', 100)
  positive(v.policy.timeoutMs, 'timeoutMs', 86400000)
  positive(v.policy.leaseMs, 'leaseMs', 86400000)
  requireValue(v.policy.leaseMs >= 1000, 'INVALID_INPUT', 'leaseMs must be at least 1000')
  requireValue(Number.isSafeInteger(v.policy.retryDelayMs) && v.policy.retryDelayMs >= 0 && v.policy.retryDelayMs <= 86400000, 'INVALID_INPUT', 'Invalid retryDelayMs')
  return v
}
export const ExecutionRequestSchema = {
  parse: parseExecutionRequest,
  '~standard': { version: 1 as const, vendor: 'ds-writing', validate(value: unknown) {
    try { return { value: parseExecutionRequest(value) } } catch (error) { return { issues: [{ message: (error as Error).message }] } }
  } },
}
