import type { Owner, VersionRef } from './index.js'

export const KNOWLEDGE_CONTRACT_VERSION = 'writing-knowledge-storage-v1' as const
export const KNOWLEDGE_NAMESPACES = ['canon', 'planning', 'reference', 'style', 'experience'] as const
export type KnowledgeNamespace = typeof KNOWLEDGE_NAMESPACES[number]
export const FACT_STATUSES = ['candidate', 'confirmed', 'published', 'observed', 'revoked', 'superseded'] as const
export type FactStatus = typeof FACT_STATUSES[number]

/** Unknown time is deliberately distinct from an explicitly timeless reference. */
export type KnowledgeValidity =
  | { mode: 'unknown' | 'timeless' }
  | { mode: 'chapter_range'; fromChapterId: string; toChapterIdExclusive: string | null }

export interface SourceOrigin {
  system: string
  sourceInstanceId: string
  table: string
  rowId: string
  sourceContentHash: string
}
export interface KnowledgeImport {
  origin: SourceOrigin
  targetRef: VersionRef
  importManifestRef: VersionRef
}
/** Read model only: factStatus never grants domain confirmation or query admission. */
export interface KnowledgeCatalogEntry {
  sourceRef: VersionRef
  namespace: KnowledgeNamespace
  factStatus: FactStatus
  validity: KnowledgeValidity
  sourceOwner: Owner
  sourceEventSequence: number
}
export interface Utf8SpanLocator {
  format: 'utf8-byte-span-v1'
  start: number
  endExclusive: number
  spanHash: string
}
export interface KnowledgeSpan {
  id: string
  sourceRef: VersionRef
  parserVersion: string
  ordinal: number
  locator: Utf8SpanLocator
}
export interface KnowledgeSnapshot {
  getKnowledgeImport(origin: SourceOrigin): KnowledgeImport | null
  getKnowledgeSource(ref: VersionRef): KnowledgeCatalogEntry | null
  getKnowledgeSpans(ref: VersionRef, parserVersion: string): KnowledgeSpan[]
  browseKnowledge(request: KnowledgeBrowse): KnowledgeListing
  describeKnowledge(ref: VersionRef): KnowledgeDescription
}
/** Read-only browsing: latest saved revisions, never an implicit release/admission decision. */
export interface KnowledgeBrowse {
  pluginInstanceId: string
  kind: 'sources' | 'pages'
  query: string
  offset: number
  limit: number
  includeInactive: boolean
}
export interface KnowledgeSummary {
  ref: VersionRef
  key: string
  title: string
  createdAt: string
  byteLength: number
  latest: boolean
  catalog: KnowledgeCatalogEntry | null
  catalogCurrent: boolean
  decision: { decision: 'confirmed' | 'rejected' | 'revoked' | 'superseded'; reason: string } | null
  inactive: boolean
}
export interface KnowledgeListing { items: KnowledgeSummary[]; total: number }
export interface KnowledgeDescription extends KnowledgeSummary {
  dependencies: { ref: VersionRef; relation: string }[]
  imports: KnowledgeImport[]
}
export interface KnowledgeTransaction {
  recordKnowledgeImport(input: KnowledgeImport): void
  catalogKnowledgeSource(input: KnowledgeCatalogEntry): void
  putKnowledgeSpan(input: Omit<KnowledgeSpan, 'id'>): KnowledgeSpan
}
