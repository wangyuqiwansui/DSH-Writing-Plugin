import type { CommandResult, JsonValue } from '../../shared/contracts/index.js'
import type { Page, PollutionLog, QualityRequests, QualityScope, QualityReport, ReportSummary, RuleRecord, RuleVersion, Target, TargetContent } from './contracts.js'

export interface QualitySnapshot {
  rules(query: QualityRequests['rules']): Page<RuleRecord>
  rule(id: string): RuleRecord
  activeRules(dimension: 'body' | 'outline'): RuleVersion[]
  targets(query: QualityRequests['targets']): Page<Target>
  target(ref: Target['ref']): TargetContent
  reports(query: QualityRequests['reports']): Page<ReportSummary>
  report(id: string): QualityReport
  logs(query: QualityRequests['logs']): Page<PollutionLog>
}
export interface QualityTransaction extends QualitySnapshot {
  saveRule(input: QualityRequests['saveRule']): RuleRecord
  setRuleStatus(input: QualityRequests['setRuleStatus']): RuleRecord
  insertReport(report: QualityReport): QualityReport
  bindModel(id: string, generation: string, model: Record<string, string>): QualityReport
  finishReport(report: QualityReport): QualityReport
}
export interface QualityCommandEnvelope extends QualityScope { operationId: string; input: JsonValue }
export interface QualityStorage {
  openQualitySnapshot<T>(scope: QualityScope, read: (store: QualitySnapshot) => T, signal?: AbortSignal): T
  qualityCommand<T>(request: QualityCommandEnvelope, work: (store: QualityTransaction) => T, signal?: AbortSignal): CommandResult<T>
}
