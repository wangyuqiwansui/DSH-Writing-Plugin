import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue, VersionRef } from '../../../shared/contracts/index.js'

export const LEGACY_WORLD_SCHEMA = 'writing-world-v1' as const
export const WORLD_SCHEMA = 'writing-world-v3' as const
export const WORLD_SCHEMAS = [LEGACY_WORLD_SCHEMA, 'writing-world-v2', WORLD_SCHEMA] as const
export const ENTRY_TYPES = [
  { id: 'power', name: '力量' }, { id: 'faction', name: '势力' }, { id: 'place', name: '地点' },
  { id: 'item', name: '物品' }, { id: 'history', name: '历史' },
] as const
export type EntryType = typeof ENTRY_TYPES[number]['id']
export const WORLD_VALIDATION_POLICY = 'world-validation-v2' as const
export const WORLD_LIBRARY = 'writing-world-library'
export interface WorldScope { mode: 'global' | 'local' | 'undetermined'; time: string; place: string; subjects: string; conditions: string }
export interface WorldRecord {
  /** Optional classification. Absence means an unclassified entry, never missing data. */
  parentId?: string
  entryType?: EntryType
  id: string; kind: 'setting' | 'rule'; name: string; description: string
  importance: 'background' | 'key'; rule: string; conditions: string; cost: string; scope: WorldScope
  confirmation: 'candidate' | 'confirmed'; truth: 'fact' | 'rumor'; validity: 'valid' | 'expired'; expiryReason: string
  rumor: { spreaders: string; range: string; period: string; veracity: 'unknown' | 'true' | 'false' }
  origin: 'author' | 'reference' | 'model'; source: { citation: string; locator: string; period: string }; ruleRefs: string[]
}
export interface WorldRelation { id: string; from: string; to: string; type: string; period: string; condition: string; source: string }
export interface WorldTerm { id: string; name: string; targetId: string; context: string; period: string }
/** Legacy archival data, retained for old-version reads and JSON roundtrips only. */
export interface WorldQuestion {
  id: string; question: string; recordIds: string[]; blocking: boolean; owner: string; status: 'open' | 'resolved'; resolution: string
  /** Exact record contents reviewed by the legacy question workflow; no automatic reopening. */
  basis: Record<string, string>
}
export interface WorldDocument {
  schemaVersion: typeof WORLD_SCHEMA; name: string; description: string; era: string; space: string; reality: 'real' | 'fictional' | 'mixed'
  records: WorldRecord[]; relations: WorldRelation[]; terms: WorldTerm[]
  hardRules: { ruleId: string; exceptions: string; priorityOver: string[] }[]; questions: WorldQuestion[]
  extensions: Record<string, JsonValue>
}
export interface WorldIssue { code: string; path: string; message: string; blocking: boolean; recordId?: string }
export interface WorldVersion {
  worldId: string; revision: number; status: 'draft' | 'active'; document: WorldDocument; createdAt: string; actor: 'author'
  confirmation: { actor: 'author'; confirmedAt: string; policy: 'world-validation-v1' | typeof WORLD_VALIDATION_POLICY } | null
  issues: WorldIssue[]; previous: VersionRef | null
}
export interface WorldDetail { ref: VersionRef; version: WorldVersion }
export interface WorldSummary { worldId: string; name: string; revision: number; status: 'draft' | 'active'; updatedAt: string; active: VersionRef | null }
export interface WorldOverview { ready: boolean; message: string; pluginInstanceId: string | null; worlds: WorldSummary[] }
export interface WorldCommand {
  pluginInstanceId: string; operationId: string; worldId: string; expectedRevision: number
  action: 'save' | 'publish'; document: WorldDocument; authorConfirmed: boolean
}
/** Read-only author planning. It does not authorize a character's knowledge or a model run. */
export interface WorldQuery { text: string; recordIds: string[]; maxCharacters: number; maxRecords: number }
export interface WorldQueryIssue { code: string; message: string }
export interface WorldReferenceRepair { before: VersionRef; after: VersionRef; summary: string }
export const worldCleanupKey = (ref: VersionRef) => `world-directory-cleanup-${ref.versionId}-${ref.contentHash}`
export interface WorldQueryResult {
  sourceRepair?: WorldReferenceRepair
  schemaVersion: 'writing-world-context-v1'; purpose: 'author_planning'; sourceVersion: VersionRef
  complete: boolean; scopeReviewRequired: true; text: string; characters: number
  entries: { id: string; name: string; entryType?: EntryType; reasons: string[] }[]
  ambiguities: { term: string; candidates: { id: string; name: string; context: string }[] }[]
  issues: WorldQueryIssue[]; omittedCount: number
}
export type WorldRequest = { action: 'overview' }
  | { action: 'read'; pluginInstanceId: string; worldId: string; revision: number | null }
  | { action: 'history'; pluginInstanceId: string; worldId: string }
  | { action: 'receipt'; pluginInstanceId: string; operationId: string }
  | { action: 'command'; command: WorldCommand }
  | { action: 'query'; sourceVersion: VersionRef; query: WorldQuery }
export interface WorldCommandResult { detail: WorldDetail; unchanged: boolean }
export type WorldReply = { ok: true; data: WorldOverview | WorldDetail | WorldDetail[] | WorldCommandResult | WorldQueryResult | null }
  | { ok: false; code: string; message: string; issues: WorldIssue[] }
export interface WorldBackend { invoke(request: WorldRequest, signal: AbortSignal): Promise<WorldReply> }

// Request contents are validated by the domain at the authoritative service boundary.
const descriptors: readonly InvocationDescriptor[] = [{ id: 'dsh-writing-workbench#writingWorld/invoke', service: 'writingWorld', namespace: 'writingWorld', method: 'invoke',
  invocation: { kind: 'direct' }, cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'WorldRequest', create: () => ({ parse(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('世界观请求无效')
    return value as WorldRequest
  } }) } }],
}]
export const worldRemote: TypertRemoteContribution = { package: 'dsh-writing-workbench', descriptors }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { writingWorld: { invoke(request: WorldRequest, signal?: AbortSignal): Promise<RemoteResult<WorldReply>> } }
  interface RemoteErrorDetailsMap { 'writing-world/owner-required': {} }
}
