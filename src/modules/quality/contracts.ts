import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { canonicalJson, requireValue, VersionRefSchema, type VersionRef, type StoryProject } from '../../shared/contracts/index.js'

export const QUALITY_VERSION = 'writing-quality-v1'
export const DETECTOR_VERSION = 'quality-detectors-v1'
export type Dimension = 'body' | 'outline'
export type Mode = 'deterministic' | 'semantic' | 'combined'
export type RuleLevel = 'L0' | 'L1'
export type RuleStatus = 'draft' | 'active' | 'retired'
export type CheckType = 'deterministic' | 'semantic' | 'observation'
export type Detector = 'forbidden_literal' | 'required_literal' | null
export interface QualityScope { pluginInstanceId: string; projectId: string | null }
export interface PageQuery extends QualityScope { query: string; offset: number; limit: number }
export interface Page<T> { items: T[]; total: number; offset: number; limit: number }
export interface RuleContent {
  title: string; description: string; dimension: Dimension | 'all'; checkType: CheckType
  detector: Detector; literal: string; source: string
}
export interface RuleVersion extends RuleContent {
  ruleId: string; versionId: string; version: number; contentHash: string
  pluginInstanceId: string; projectId: string | null; level: RuleLevel; createdAt: string
}
export interface RuleRecord {
  id: string; revision: number; status: RuleStatus; current: RuleVersion; active: RuleVersion | null
}
export interface RuleSave extends QualityScope {
  operationId: string; ruleId: string | null; expectedRevision: number; level: RuleLevel; content: RuleContent
}
export interface RuleChange extends QualityScope {
  operationId: string; ruleId: string; expectedRevision: number; status: 'active' | 'retired'
}
export interface Target { ref: VersionRef; title: string; dimension: Dimension; latest: boolean }
export interface TargetContent extends Target { text: string; format: 'text' | 'json' }
export interface Span { unit: 'unicode_code_point'; start: number; endExclusive: number; quote: string }
export interface Check {
  id: string; title: string; rule: RuleVersion | null; type: CheckType
  status: 'clear' | 'issue' | 'needs_review' | 'not_applicable'
  message: string; evidence: Span[]; pollution: boolean
}
export interface DetectionInput extends QualityScope { projectId: string; target: VersionRef; mode: Mode }
export interface PreparedDetection {
  target: TargetContent; rules: RuleVersion[]; mode: Mode; fingerprint: string
  detectorVersion: string; semanticAvailable: boolean; checks: Check[]
}
export interface DetectCommand extends DetectionInput { operationId: string; fingerprint: string }
export interface QualityReport {
  schemaVersion: typeof QUALITY_VERSION
  id: string; pluginInstanceId: string; projectId: string; operationId: string; generation: string
  createdAt: string; completedAt: string | null; target: TargetContent; rules: RuleVersion[]
  mode: Mode; fingerprint: string; detectorVersion: string
  execution: 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled'
  verdict: 'not_evaluated' | 'passed' | 'issues_found' | 'needs_review'
  checks: Check[]; rawResponse: string | null; model: Record<string, string> | null; error: string | null
}
export type ReportSummary = Omit<QualityReport, 'target' | 'rules' | 'checks' | 'rawResponse'> & { target: Target; checkCount: number; issueCount: number }
export interface ReportDetail { report: QualityReport; current: boolean; currentReason: string }
export interface PollutionLog { reportId: string; target: Target; createdAt: string; check: Check }
export interface QualityOverview {
  ready: boolean; message: string; pluginInstanceId: string | null; projects: StoryProject[]; semanticAvailable: boolean
}
export interface ReportQuery extends PageQuery { projectId: string; dimension: Dimension | 'all'; verdict: QualityReport['verdict'] | 'all' }
export interface ReportRequest extends QualityScope { projectId: string; reportId: string }
export interface CancelCommand extends ReportRequest { operationId: string }

export interface QualityRequests {
  overview: Record<string, never>
  rules: PageQuery & { level: RuleLevel | 'all'; status: RuleStatus | 'all' }
  saveRule: RuleSave
  setRuleStatus: RuleChange
  targets: PageQuery & { projectId: string; dimension: Dimension }
  prepare: DetectionInput
  detect: DetectCommand
  reports: ReportQuery
  report: ReportRequest
  cancel: CancelCommand
  logs: PageQuery & { projectId: string }
}
export interface QualityResults {
  overview: QualityOverview; rules: Page<RuleRecord>; saveRule: RuleRecord; setRuleStatus: RuleRecord
  targets: Page<Target>; prepare: PreparedDetection; detect: QualityReport
  reports: Page<ReportSummary>; report: ReportDetail; cancel: QualityReport; logs: Page<PollutionLog>
}
export type QualityAction = keyof QualityRequests
export type QualityRequest = { [K in QualityAction]: { action: K; input: QualityRequests[K] } }[QualityAction]
export type QualityReply = { [K in QualityAction]: { action: K; data: QualityResults[K] } }[QualityAction]
export interface QualityBackend { invoke(request: QualityRequest, signal?: AbortSignal): Promise<QualityReply> }

export function record(value: unknown, fields: string[]): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', '请求必须为对象')
  const v = value as Record<string, unknown>
  requireValue(Object.keys(v).length === fields.length && fields.every(key => Object.hasOwn(v, key)), 'INVALID_INPUT', '请求字段缺失或包含未知字段')
  return v
}
export function text(value: unknown, label: string, max = 200, allowEmpty = false): asserts value is string {
  requireValue(typeof value === 'string' && value.length <= max && !value.includes('\0') && (allowEmpty || value.trim().length > 0), 'INVALID_INPUT', `${label}无效或过长`)
}
export function choice<T extends string>(value: unknown, choices: readonly T[]): asserts value is T {
  requireValue(choices.includes(value as T), 'INVALID_INPUT', '不支持的选项')
}
export function integer(value: unknown, min: number, max: number) {
  requireValue(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, 'INVALID_INPUT', '数字超出允许范围')
}
const scopeFields = ['pluginInstanceId', 'projectId']
const pageFields = [...scopeFields, 'query', 'offset', 'limit']
const targetFields = [...scopeFields, 'target', 'mode']
const fields: Record<QualityAction, string[]> = {
  overview: [], rules: [...pageFields, 'level', 'status'], targets: [...pageFields, 'dimension'],
  saveRule: [...scopeFields, 'operationId', 'ruleId', 'expectedRevision', 'level', 'content'],
  setRuleStatus: [...scopeFields, 'operationId', 'ruleId', 'expectedRevision', 'status'],
  prepare: targetFields, detect: [...targetFields, 'operationId', 'fingerprint'],
  reports: [...pageFields, 'dimension', 'verdict'], report: [...scopeFields, 'reportId'],
  cancel: [...scopeFields, 'reportId', 'operationId'], logs: pageFields,
}
export function parseQualityRequest(value: unknown): QualityRequest {
  const outer = record(value, ['action', 'input'])
  choice(outer.action, Object.keys(fields) as QualityAction[])
  const action = outer.action, v = record(outer.input, fields[action])
  if (action !== 'overview') {
    text(v.pluginInstanceId, '数据库实例')
    if (v.projectId !== null) text(v.projectId, '项目')
    if (!['rules', 'saveRule', 'setRuleStatus'].includes(action)) text(v.projectId, '项目')
  }
  if ('query' in v) { text(v.query, '关键词', 200, true); integer(v.offset, 0, 1_000_000); integer(v.limit, 1, 100) }
  if ('operationId' in v) text(v.operationId, '操作标识')
  if ('expectedRevision' in v) integer(v.expectedRevision, 0, 1_000_000)
  if ('reportId' in v) text(v.reportId, '报告标识')
  if (action === 'rules') { choice(v.level, ['all', 'L0', 'L1']); choice(v.status, ['all', 'draft', 'active', 'retired']) }
  if (action === 'setRuleStatus') { text(v.ruleId, '规则标识'); choice(v.status, ['active', 'retired']) }
  if (action === 'saveRule') {
    choice(v.level, ['L0', 'L1'])
    requireValue((v.level === 'L0') === (v.projectId === null), 'INVALID_INPUT', 'L0 使用实例范围；L1 必须指定项目')
    if (v.ruleId !== null) text(v.ruleId, '规则标识')
    requireValue((v.ruleId === null) === (v.expectedRevision === 0), 'INVALID_INPUT', '新规则与现有规则版本不匹配')
    const c = record(v.content, ['title', 'description', 'dimension', 'checkType', 'detector', 'literal', 'source'])
    text(c.title, '名称', 120); text(c.description, '说明', 4000); text(c.source, '来源说明', 2000)
    choice(c.dimension, ['all', 'body']); choice(c.checkType, ['deterministic', 'semantic', 'observation'])
    text(c.literal, '匹配文本', 300, c.checkType === 'semantic')
    if (c.checkType === 'semantic') requireValue(c.detector === null && c.literal === '', 'INVALID_INPUT', '语义规则不使用字符串检测器')
    else choice(c.detector, ['forbidden_literal', 'required_literal'])
  }
  if (action === 'targets') choice(v.dimension, ['body'])
  if (action === 'prepare' || action === 'detect') {
    VersionRefSchema.parse(v.target); choice(v.mode, ['deterministic', 'semantic', 'combined'])
    const ref = v.target as VersionRef
    requireValue(ref.kind === 'chapter_body', 'INVALID_INPUT', '仅支持章节正文质量检测。')
    requireValue(ref.pluginInstanceId === v.pluginInstanceId && ref.projectId === v.projectId, 'CROSS_PROJECT_REFERENCE', '目标不属于所选数据库或项目')
    if (action === 'detect') { text(v.fingerprint, '检查快照'); requireValue(/^[a-f0-9]{64}$/.test(v.fingerprint), 'INVALID_INPUT', '检查快照无效') }
  }
  if (action === 'reports') { choice(v.dimension, ['all', 'body', 'outline']); choice(v.verdict, ['all', 'not_evaluated', 'passed', 'issues_found', 'needs_review']) }
  return JSON.parse(canonicalJson(value)) as QualityRequest
}
export const qualityRemote: TypertRemoteContribution = { package: 'dsh-writing-workbench', descriptors: [{
  id: 'dsh-writing-workbench#writingQualityRemote/invoke', service: 'writingQualityRemote', namespace: 'writingQualityRemote', method: 'invoke',
  invocation: { kind: 'direct' }, cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'QualityRequest', create: () => ({ parse: parseQualityRequest }) } }],
}] }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap { 'writing-quality/owner-required': {}; 'writing-quality/failed': { storageCode: string | null } }
  interface TypertRemoteNamespaceMap { writingQualityRemote: { invoke(request: QualityRequest, signal?: AbortSignal): Promise<RemoteResult<QualityReply>> } }
}
