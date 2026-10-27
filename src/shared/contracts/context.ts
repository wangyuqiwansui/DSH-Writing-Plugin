import type { Head, JsonValue, StoredArtifact, VersionRef } from './index.js'

export const CONTEXT_STORAGE_VERSION = 'writing-context-storage-v1' as const
export const CONTEXT_PHASES = ['preparing', 'deciding', 'reading', 'checking', 'ready', 'blocked', 'unknown', 'cancelling', 'cancelled', 'stale'] as const
export type ContextPhase = typeof CONTEXT_PHASES[number]
export interface ContextBudget {
  maxModelCalls: number; maxToolCalls: number; maxInputTokens: number; maxOutputTokens: number; deadline: number
}
export interface ContextGuard { runId: string; expectedRevision: number; worker: string; fence: number; now: number }
export interface ContextRun {
  id: string; phase: ContextPhase; revision: number; worker: string | null; fence: number; leaseUntil: number
  snapshotRef: VersionRef; scope: JsonValue; budget: ContextBudget; checkpoint: VersionRef | null; stopReason: string | null
}
export interface ContextMember { head: Head; decisionId: string | null; decision: string | null }
export interface ContextCall {
  id: string; kind: 'model' | 'tool'; parameters: JsonValue; status: 'reserved' | 'dispatched' | 'unknown' | 'succeeded' | 'failed' | 'cancelled'
  reservedInput: number; reservedOutput: number; usedInput: number | null; usedOutput: number | null; receipt: VersionRef | null
}
export interface ContextEvent { sequence: number; type: string; data: JsonValue }
export interface ContextRound { number: number; packetRef: VersionRef; sourceRefs: VersionRef[] }
export interface ContextStorageSnapshot {
  getContextRun(runId: string): ContextRun | null
  contextMembers(runId: string): ContextMember[]
  readContextSource(runId: string, source: VersionRef): StoredArtifact
  contextCalls(runId: string): ContextCall[]
  contextRounds(runId: string): ContextRound[]
  contextEvents(runId: string): ContextEvent[]
  contextFreshness(runId: string): { current: boolean; changedKeys: string[] }
}
export interface ContextStorageTransaction extends ContextStorageSnapshot {
  /** Trusted context service supplies scope. This storage port is not an LLM authorization boundary. */
  createContextRun(input: { id: string; scope: JsonValue; sourceHeadPrefixes: string[]; maxMembers: number; budget: ContextBudget }): ContextRun
  claimContextRun(runId: string, expectedRevision: number, worker: string, now: number, leaseMs: number): ContextRun
  transitionContextRun(guard: ContextGuard, phase: ContextPhase, reason: string, checkpoint?: VersionRef): ContextRun
  recordContextRound(guard: ContextGuard, packetRef: VersionRef, sources: VersionRef[]): ContextRun
  reserveContextCall(guard: ContextGuard, input: { id: string; kind: 'model' | 'tool'; parameters: JsonValue; inputTokens: number; outputTokens: number }): ContextRun
  dispatchContextCall(guard: ContextGuard, callId: string): ContextRun
  markContextCallUnknown(guard: ContextGuard, callId: string): ContextRun
  settleContextCall(guard: ContextGuard, input: { id: string; status: 'succeeded' | 'failed' | 'cancelled'; usedInput: number; usedOutput: number; receipt: VersionRef }): ContextRun
  recordContextEvidence(guard: ContextGuard, source: VersionRef, locator: JsonValue, evidenceRef: VersionRef): ContextRun
}
