import type { JsonValue, VersionRef } from '../../shared/contracts/index.js'

export const KB_SCHEMA = 'writing-kb-document-v1' as const
export const KB_PARSER = 'kb-codepoint-600-overlap-80-v1' as const
export const KB_PREFIX = 'knowledge.kb.'
export type Representation = 'literal' | 'lexical' | 'enriched'
export type PacketFormat = 'json' | 'markdown'
export interface Scope { pluginInstanceId: string; projectId: string }
export interface Chunk {
  id: string; ordinal: number; text: string; startByte: number; endByte: number; hash: string
  title: string; keywords: string[]; summary: string
}
export interface ModelReceipt { config: JsonValue; input: { system: string; user: string }; output: string; usage: JsonValue; durationMs: number }
export interface KbDocument {
  schemaVersion: typeof KB_SCHEMA; documentId: string; title: string; sourceRef: VersionRef; rawRef: VersionRef; wikiRef: VersionRef
  chunks: Chunk[]; analysis: ModelReceipt[]; parserVersion: typeof KB_PARSER
}
export interface DocumentItem { ref: VersionRef; document: KbDocument; decision: string | null; active: VersionRef | null }
export interface Corpus { scope: Scope; documents: { ref: VersionRef; document: KbDocument }[]; digest: string }
export interface Hit { id: string; documentRef: VersionRef; sourceRef: VersionRef; title: string; chunk: Chunk; score: number; rank: number }
export interface Retrieval { corpus: Corpus; question: string; representation: Representation; hits: Hit[]; omitted: number; maxCharacters: number }
export interface Evidence { id: string; sourceRef: VersionRef; documentRef: VersionRef; title: string; text: string; locator: { format: 'utf8-byte-span-v1'; start: number; endExclusive: number; spanHash: string }; parserVersion: string }
export interface Answer { status: 'answered' | 'insufficient' | 'conflict'; claims: { text: string; citations: { evidenceId: string; quote: string }[] }[]; missing: string[] }
export interface AnswerRun { retrieval: Retrieval; evidence: Evidence[]; answer: Answer; receipt: ModelReceipt | null; traceRef: VersionRef; format: PacketFormat }
export interface ModelPort { complete(input: { system: string; user: string }, signal: AbortSignal): Promise<ModelReceipt> }
export interface QueryInput extends Scope { question: string; documents: VersionRef[]; topK: number; maxCharacters: number; representation: Representation }
export type ManagementRequest = { action: 'overview' }
 | { action: 'create'; pluginInstanceId: string; operationId: string; title: string }
 | ({ action: 'list' } & Scope)
 | ({ action: 'ingest'; operationId: string; documentId: string; expectedRevision: number; title: string; text: string } & Scope)
 | ({ action: 'decide'; operationId: string; ref: VersionRef; decision: 'confirmed' | 'revoked' } & Scope)
 | ({ action: 'receipt'; operationId: string } & Scope)
export interface Overview { ready: boolean; message: string; pluginInstanceId: string | null; projects: { id: string; title: string }[] }
export type ManagementResult = Overview | DocumentItem[] | { projectId: string } | { ref: VersionRef } | JsonValue | null
export interface ManagementBackend { invoke(request: ManagementRequest, signal: AbortSignal): Promise<ManagementResult> }
