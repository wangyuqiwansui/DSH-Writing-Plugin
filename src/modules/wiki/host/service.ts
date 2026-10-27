import type { ReadDataPort } from '../../../shared/middleware.js'
import { createHash } from 'node:crypto'
import { canonicalJson, requireValue, type StorageSnapshot, type VersionRef } from '../../../shared/contracts/index.js'
import { WIKI_PAGE_SCHEMA, parseBrowse, parseRead, parseWikiDocument, type WikiBrowseRequest, type WikiCitation,
  type WikiDetail, type WikiDocument, type WikiOverview, type WikiReadRequest, type WikiSupport } from '../contracts/index.js'

const same = (a: VersionRef, b: VersionRef) => canonicalJson(a) === canonicalJson(b)
const PAGE_SIZE = 30
const TEXT_CHUNK = 32_768
export class WikiReader {
  constructor(private readonly storage: ReadDataPort) {}
  overview(signal?: AbortSignal): WikiOverview {
    const status = this.storage.status(signal)
    if (!status.databaseReady) return { ready: false, message: status.message, pluginInstanceId: null, projects: [] }
    const pluginInstanceId = this.storage.instanceId()
    const projects = this.storage.listProjects(signal)
    requireValue(this.storage.instanceId() === pluginInstanceId, 'CROSS_PROJECT_REFERENCE', 'Database changed; refresh Wiki')
    return { ready: true, message: '已连接当前数据库', pluginInstanceId, projects }
  }
  browse(value: WikiBrowseRequest, signal?: AbortSignal) {
    const request = parseBrowse(value)
    return this.storage.openSnapshot(request.projectId, snapshot => snapshot.browseKnowledge({ ...request, limit: PAGE_SIZE }), signal)
  }
  read(value: WikiReadRequest, signal?: AbortSignal): WikiDetail {
    const request = parseRead(value)
    return this.storage.openSnapshot(request.projectId, snapshot => {
      const record = snapshot.describeKnowledge(request.ref)
      const stored = snapshot.getVersion(request.ref)
      const base = { record, document: null, text: null, offset: request.offset, nextOffset: null, totalCharacters: 0, citations: [], notice: null }
      if (request.ref.kind === 'wiki_page') {
        if (request.ref.schemaVersion !== WIKI_PAGE_SCHEMA || stored.payload.format !== 'json' || stored.byteLength > 2_000_000) {
          return { ...base, format: 'unsupported', notice: '此 Wiki 页使用尚不支持的格式，或超过 2 MB 阅读上限。原始版本已保留。' }
        }
        let document: WikiDocument
        try { document = parseWikiDocument(stored.payload.value) }
        catch { return { ...base, format: 'unsupported', notice: '此 Wiki 页的内容结构不完整，暂时无法解析。请检查页面正文与引用合同。' } }
        const citations: WikiCitation[] = []
        for (const [i, sourceRef] of document.sourceRefs.entries()) {
          citations.push(this.citation(snapshot, request.ref, record.dependencies, `source-${i}`, `来源 ${i + 1}`, { sourceRef, role: 'supports' }, 'source'))
        }
        for (const [bundleIndex, bundle] of document.supportBundles.entries()) for (const [i, support] of bundle.supports.entries()) {
          citations.push(this.citation(snapshot, request.ref, record.dependencies, `bundle-${bundleIndex}-${i}`, `${bundle.id} · ${i + 1}`, support, support.role))
        }
        return { ...base, document, format: 'wiki', citations, notice: '展示已保存的页面版本；发布与事实采纳状态由各自流程确认。' }
      }
      if (stored.payload.format === 'blob') return { ...base, format: 'blob', notice: '原始文件已保存在数据库中。请选择其解析文本版本阅读正文。' }
      const text = stored.payload.format === 'text' ? stored.payload.text : JSON.stringify(stored.payload.value, null, 2)
      requireValue(request.offset <= text.length, 'INVALID_INPUT', 'Text offset exceeds this version')
      // UTF-16 offsets are only a UI pagination cursor; evidence locators remain original UTF-8 bytes.
      requireValue(!(request.offset > 0 && /[\uDC00-\uDFFF]/u.test(text[request.offset] ?? '') && /[\uD800-\uDBFF]/u.test(text[request.offset - 1] ?? '')), 'INVALID_INPUT', 'Offset splits a Unicode character')
      let end = Math.min(request.offset + TEXT_CHUNK, text.length)
      if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1] ?? '')) end--
      return { ...base, format: stored.payload.format, text: text.slice(request.offset, end), nextOffset: end < text.length ? end : null, totalCharacters: text.length }
    }, signal)
  }
  private citation(snapshot: StorageSnapshot, pageRef: VersionRef, dependencies: { ref: VersionRef }[], id: string, label: string,
    support: WikiSupport, role: WikiCitation['role']): WikiCitation {
    const base = { id, label, sourceRef: support.sourceRef, role, locator: support.locator ?? null }
    try {
      requireValue(support.sourceRef.projectId === pageRef.projectId && support.sourceRef.pluginInstanceId === pageRef.pluginInstanceId,
        'CROSS_PROJECT_REFERENCE', 'Citation belongs to another project')
      requireValue(dependencies.some(dep => same(dep.ref, support.sourceRef)), 'VERSION_MISMATCH', 'Citation is absent from immutable dependencies')
      const source = snapshot.describeKnowledge(support.sourceRef)
      const content = snapshot.getVersion(support.sourceRef)
      let quote: string | null = null
      let readOffset = 0
      if (support.locator) {
        requireValue(content.ref.kind === 'source_text' && content.payload.format === 'text', 'INVALID_INPUT', 'Byte spans require parsed source text')
        const bytes = Buffer.from(content.payload.text, 'utf8')
        const loc = support.locator
        requireValue(snapshot.getKnowledgeSpans(support.sourceRef, support.parserVersion!).some(span => canonicalJson(span.locator) === canonicalJson(loc)),
          'VERSION_MISMATCH', 'Citation parser and span are not registered for this source version')
        requireValue(loc.endExclusive <= bytes.length, 'INVALID_INPUT', 'Citation exceeds source')
        const excerpt = bytes.subarray(loc.start, loc.endExclusive)
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
        quote = decoder.decode(excerpt)
        readOffset = decoder.decode(bytes.subarray(0, loc.start)).length
        requireValue(createHash('sha256').update(excerpt).digest('hex') === loc.spanHash, 'CONTENT_CORRUPT', 'Citation checksum failed')
      }
      const messages = [source.inactive ? '来源已撤回、否决或被替代，仅供历史追溯。' : '来源内容校验通过。']
      if (!source.latest) messages.push('引用的是历史版本。')
      if (!source.catalog || !source.catalogCurrent) messages.push('来源状态目录未核验为最新。')
      if (source.ref.kind === 'wiki_page') messages.push('此引用为 Wiki 概括页，请继续查看其原始证据。')
      return { ...base, verified: true, message: messages.join(' '), quote, readOffset, source }
    } catch {
      return { ...base, verified: false, message: '引用无法验证：版本、项目、内容摘要、定位或依赖关系不匹配。', quote: null, readOffset: 0, source: null }
    }
  }
}
