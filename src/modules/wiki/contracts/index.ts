import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { FACT_STATUSES, KNOWLEDGE_NAMESPACES, VersionRefSchema, type FactStatus, type JsonValue, type KnowledgeDescription,
  type KnowledgeListing, type KnowledgeNamespace, type KnowledgeSummary, type StoryProject, type Utf8SpanLocator, type VersionRef } from '../../../shared/contracts/index.js'

export const WIKI_PAGE_SCHEMA = 'wiki-page-v1'
export interface WikiSupport { sourceRef: VersionRef; locator?: Utf8SpanLocator; parserVersion?: string; role: 'supports' | 'contradicts' }
export interface WikiDocument {
  title: string; summary: string; markdown: string
  claims: { id: string; statement: string; namespace: KnowledgeNamespace; factStatus: FactStatus; supportBundleIds: string[] }[]
  supportBundles: { id: string; supports: WikiSupport[] }[]
  sourceRefs: VersionRef[]
  links: { label: string; targetRef: VersionRef }[]
  policyVersion: string; compilerProfileVersion: string
  coverage: JsonValue; conflicts: JsonValue[]
}
export interface WikiScope { pluginInstanceId: string; projectId: string }
export interface WikiBrowseRequest extends WikiScope { kind: 'pages' | 'sources'; query: string; offset: number; includeInactive: boolean }
export interface WikiReadRequest extends WikiScope { ref: VersionRef; offset: number }
export interface WikiOverview { ready: boolean; message: string; pluginInstanceId: string | null; projects: StoryProject[] }
export interface WikiCitation {
  id: string; label: string; sourceRef: VersionRef; role: 'source' | 'supports' | 'contradicts'
  verified: boolean; message: string; quote: string | null; locator: Utf8SpanLocator | null
  readOffset: number
  source: KnowledgeSummary | null
}
export interface WikiDetail {
  record: KnowledgeDescription
  document: WikiDocument | null
  text: string | null; format: 'wiki' | 'text' | 'json' | 'blob' | 'unsupported'
  offset: number; nextOffset: number | null; totalCharacters: number
  citations: WikiCitation[]
  notice: string | null
}
export interface WikiBackend {
  overview(signal: AbortSignal): Promise<WikiOverview>
  browse(request: WikiBrowseRequest, signal: AbortSignal): Promise<KnowledgeListing>
  read(request: WikiReadRequest, signal: AbortSignal): Promise<WikiDetail>
}
function obj(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Wiki 数据格式无效。')
  return value as Record<string, unknown>
}
function str(value: unknown, max = 300): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error('Wiki 文本格式无效。')
  return value
}
function id(value: unknown): string { const text = str(value); if (!text.trim()) throw new Error('缺少 Wiki 身份字段。'); return text }
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Wiki 列表格式无效或超过上限。')
  return value
}
function exact(input: Record<string, unknown>, keys: string[]) {
  if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) throw new Error('Wiki 请求字段无效。')
}
function integer(value: unknown, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) throw new Error('Wiki 分页位置无效。')
  return Number(value)
}
function ref(value: unknown): VersionRef {
  const input = obj(value)
  exact(input, ['pluginInstanceId', 'projectId', 'artifactId', 'versionId', 'kind', 'schemaVersion', 'contentHash', 'revision'])
  for (const key of ['pluginInstanceId', 'projectId', 'artifactId', 'versionId', 'kind', 'schemaVersion']) id(input[key])
  return VersionRefSchema.parse(input)
}
export function parseBrowse(value: unknown): WikiBrowseRequest {
  const input = obj(value)
  exact(input, ['pluginInstanceId', 'projectId', 'kind', 'query', 'offset', 'includeInactive'])
  if (!['pages', 'sources'].includes(input.kind as string) || typeof input.includeInactive !== 'boolean') throw new Error('Wiki 查询范围无效。')
  return { pluginInstanceId: id(input.pluginInstanceId), projectId: id(input.projectId), kind: input.kind as WikiBrowseRequest['kind'],
    query: str(input.query, 200).trim(), offset: integer(input.offset, 1_000_000), includeInactive: input.includeInactive }
}
export function parseRead(value: unknown): WikiReadRequest {
  const input = obj(value)
  exact(input, ['pluginInstanceId', 'projectId', 'ref', 'offset'])
  const result = { pluginInstanceId: id(input.pluginInstanceId), projectId: id(input.projectId), ref: ref(input.ref), offset: integer(input.offset, 1_000_000_000) }
  if (result.ref.pluginInstanceId !== result.pluginInstanceId || result.ref.projectId !== result.projectId) throw new Error('引用不属于当前数据库或项目。')
  return result
}
/** A versioned JSON page is authoritative; projection tables are never rendered as page content. */
export function parseWikiDocument(value: unknown): WikiDocument {
  const input = obj(value)
  const supportBundles = array(input.supportBundles, 100).map(value => {
    const bundle = obj(value)
    return { id: id(bundle.id), supports: array(bundle.supports, 20).map(value => {
      const support = obj(value)
      if (!['supports', 'contradicts'].includes(support.role as string)) throw new Error('引用关系无效。')
      let locator: Utf8SpanLocator | undefined
      if (support.locator !== undefined) {
        const loc = obj(support.locator)
        exact(loc, ['format', 'start', 'endExclusive', 'spanHash'])
        if (loc.format !== 'utf8-byte-span-v1' || typeof loc.spanHash !== 'string' || !/^[a-f0-9]{64}$/.test(loc.spanHash)) throw new Error('引用定位格式无效。')
        locator = { format: loc.format, start: integer(loc.start, 1_000_000_000), endExclusive: integer(loc.endExclusive, 1_000_000_000), spanHash: loc.spanHash }
        if (locator.endExclusive <= locator.start || locator.endExclusive - locator.start > 32_768) throw new Error('引用摘录范围无效或超过 32 KiB。')
        id(support.parserVersion)
      }
      return { sourceRef: ref(support.sourceRef), role: support.role as WikiSupport['role'], ...(locator ? { locator, parserVersion: id(support.parserVersion) } : {}) }
    }) }
  })
  const bundleIds = new Set(supportBundles.map(bundle => bundle.id))
  if (bundleIds.size !== supportBundles.length || supportBundles.reduce((n, bundle) => n + bundle.supports.length, 0) > 100) throw new Error('Wiki 引用过多或编号重复。')
  const claims = array(input.claims, 200).map(value => {
    const claim = obj(value)
    if (!KNOWLEDGE_NAMESPACES.includes(claim.namespace as never) || !FACT_STATUSES.includes(claim.factStatus as never)) throw new Error('Wiki 主张状态无效。')
    const supportBundleIds = array(claim.supportBundleIds, 100).map(value => id(value))
    if (supportBundleIds.some(key => !bundleIds.has(key))) throw new Error('Wiki 主张引用了不存在的证据束。')
    return { id: id(claim.id), statement: str(claim.statement, 16_384), namespace: claim.namespace as KnowledgeNamespace,
      factStatus: claim.factStatus as FactStatus, supportBundleIds }
  })
  if (new Set(claims.map(claim => claim.id)).size !== claims.length) throw new Error('Wiki 主张编号重复。')
  return { title: id(input.title), summary: str(input.summary, 16_384), markdown: str(input.markdown, 1_000_000), claims, supportBundles,
    sourceRefs: array(input.sourceRefs, 100).map(ref), links: array(input.links, 100).map(value => {
      const link = obj(value); return { label: id(link.label), targetRef: ref(link.targetRef) }
    }), policyVersion: id(input.policyVersion), compilerProfileVersion: id(input.compilerProfileVersion),
    coverage: (input.coverage ?? null) as JsonValue, conflicts: array(input.conflicts, 100) as JsonValue[] }
}
const descriptors: readonly InvocationDescriptor[] = [
  { method: 'overview', parameters: [] },
  ...[{ method: 'browse', parse: parseBrowse }, { method: 'read', parse: parseRead }].map(({ method, parse }) => ({ method,
    parameters: [{ name: 'request', wire: 'request', source: 'json' as const,
      codec: { mode: 'strict' as const, typeSymbol: `Wiki${method}Request`, create: () => ({ parse }) } }] })),
].map(method => ({ ...method, id: `dsh-writing-workbench#writingWiki/${method.method}`, service: 'writingWiki', namespace: 'writingWiki',
  invocation: { kind: 'direct' as const }, cancellation: { parameter: 'signal' as const }, result: { mode: 'src-json' as const } }))
export const wikiRemote: TypertRemoteContribution = { package: 'dsh-writing-workbench', descriptors }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap { writingWiki: {
    overview(signal?: AbortSignal): Promise<RemoteResult<WikiOverview>>
    browse(request: WikiBrowseRequest, signal?: AbortSignal): Promise<RemoteResult<KnowledgeListing>>
    read(request: WikiReadRequest, signal?: AbortSignal): Promise<RemoteResult<WikiDetail>>
  } }
  interface RemoteErrorDetailsMap { 'writing-wiki/owner-required': {}; 'writing-wiki/unavailable': {} }
}
