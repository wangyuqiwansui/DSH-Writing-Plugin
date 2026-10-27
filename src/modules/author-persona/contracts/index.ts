import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { VersionRef } from '../../../shared/contracts/index.js'
import type { PROMPT_TEMPLATE_ID } from './prompt-template.js'
export * from './prompt-template.js'

export const PERSONA_SCHEMA = 'writing-author-persona-v2' as const
export const LEGACY_PERSONA_SCHEMA = 'writing-author-persona-v1' as const
export const PERSONA_API_VERSION = 'writing-author-persona-api-v2' as const
export const PERSONA_LIBRARY = 'writing-author-persona-library' as const
export const BRIEF_FIELDS = ['stance', 'voice', 'rhythm', 'dialogue', 'avoid'] as const
export type BriefField = typeof BRIEF_FIELDS[number]
/** Local author-authored profile, deliberately distinct from OpenClaw's evidence-qualified schemas. */
export interface PersonaDocument {
  schemaVersion: typeof PERSONA_SCHEMA
  name: string
  description: string
  templateId: typeof PROMPT_TEMPLATE_ID
  prompt: string
  sourceNote: string
}
/** Read compatibility only; all new edits and commands use PersonaDocument. */
export interface LegacyPersonaDocument {
  schemaVersion: typeof LEGACY_PERSONA_SCHEMA
  name: string
  description: string
  mode: 'brief' | 'full_prompt'
  brief: Record<BriefField, string>
  fullPrompt: string
  sourceNote: string
}
export type StoredPersonaDocument = PersonaDocument | LegacyPersonaDocument
export interface PersonaIssue { code: string; path: string; message: string; blocking: boolean }
export interface PersonaVersion {
  personaId: string; revision: number; status: 'draft' | 'published'; document: StoredPersonaDocument
  createdAt: string; previous: VersionRef | null; issues: PersonaIssue[]
  confirmation: { actor: 'author'; policy: 'manual-expression-v1' | 'prompt-template-v1'; confirmedAt: string } | null
  qualification: { sourceReview: 'not_run'; literaryTrial: 'not_run' }
  /** SHA-256 of UTF-8 expression text; not a source-file byte hash. */
  textHash: string
}
export interface PersonaDetail { ref: VersionRef; version: PersonaVersion }
export interface PersonaSummary { personaId: string; name: string; revision: number; status: PersonaVersion['status']; updatedAt: string; published: VersionRef | null }
export interface PersonaOverview { apiVersion: typeof PERSONA_API_VERSION; ready: boolean; message: string; pluginInstanceId: string | null; personas: PersonaSummary[] }
/** Only this projection crosses into a writing consumer. It grants no execution authority. */
interface ProjectionContent {
  sourceVersion: VersionRef
  name: string; purpose: 'writing_style'; authority: 'expression_only'
  text: string; textHash: string; literaryTrial: 'not_run'
}
export type PersonaProjection = ProjectionContent & (
  { schemaVersion: 'writing-author-persona-projection-v2'; templateId: typeof PROMPT_TEMPLATE_ID }
  | { schemaVersion: 'writing-author-persona-projection-v1'; mode: LegacyPersonaDocument['mode'] }
)
export interface PersonaCommand {
  pluginInstanceId: string; operationId: string; personaId: string; expectedRevision: number
  action: 'save' | 'publish'; document: PersonaDocument; authorConfirmed: boolean
}
export interface PersonaCommandResult { detail: PersonaDetail; unchanged: boolean }
export type PersonaRequest = { action: 'overview' }
  | { action: 'read'; pluginInstanceId: string; personaId: string; revision: number | null }
  | { action: 'history'; pluginInstanceId: string; personaId: string }
  | { action: 'projection'; pluginInstanceId: string; personaId: string; revision: number }
  | { action: 'receipt'; pluginInstanceId: string; operationId: string }
  | { action: 'command'; command: PersonaCommand }
export type PersonaReply = { ok: true; data: PersonaOverview | PersonaDetail | PersonaDetail[] | PersonaProjection | PersonaCommandResult | null }
  | { ok: false; code: string; message: string; issues: PersonaIssue[] }
export interface PersonaBackend { invoke(request: PersonaRequest, signal: AbortSignal): Promise<PersonaReply> }
export interface PersonaApi { invoke(request: PersonaRequest, signal?: AbortSignal): Promise<PersonaReply> }

const descriptors: readonly InvocationDescriptor[] = [{
  id: 'dsh-writing-workbench#writingAuthorPersonaRemote/invoke', service: 'writingAuthorPersonaRemote', namespace: 'writingAuthorPersonaRemote', method: 'invoke',
  invocation: { kind: 'direct' }, cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
  parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'PersonaRequest', create: () => ({ parse(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('作者人格请求无效')
    return value as PersonaRequest
  } }) } }],
}]
export const personaRemote: TypertRemoteContribution = { package: 'dsh-writing-workbench', descriptors }
declare module '@deepseek-ai/cordis' { interface Context { writingAuthorPersona: PersonaApi } }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { writingAuthorPersonaRemote: { invoke(request: PersonaRequest, signal?: AbortSignal): Promise<RemoteResult<PersonaReply>> } }
  interface RemoteErrorDetailsMap { 'writing-persona/owner-required': {} }
}
