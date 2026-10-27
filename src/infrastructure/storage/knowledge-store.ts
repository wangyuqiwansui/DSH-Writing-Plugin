import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import {
  FACT_STATUSES, KNOWLEDGE_NAMESPACES, OWNERS, canonicalJson, nonempty, requireValue,
  type KnowledgeCatalogEntry, type KnowledgeImport, type KnowledgeSnapshot, type KnowledgeSpan,
  type KnowledgeTransaction, type KnowledgeValidity, type Owner, type SourceOrigin, type StoredArtifact, type Utf8SpanLocator, type VersionRef,
} from '../../shared/contracts/index.js'

type Row = Record<string, SQLOutputValue>
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')

/** Internal adapter: receives a scoped connection, never returns it to consumers. */
export function knowledgeStore(db: DatabaseSync, project: string, owner: Owner | null, check: () => void,
  version: (id: string) => VersionRef, read: (ref: VersionRef) => StoredArtifact): Omit<KnowledgeSnapshot, 'browseKnowledge' | 'describeKnowledge'> & KnowledgeTransaction {
  function write() { check(); requireValue(owner === 'knowledge', 'OWNER_MISMATCH', 'Knowledge projections belong to knowledge') }
  function origin(input: SourceOrigin) {
    requireValue(input && typeof input === 'object', 'INVALID_INPUT', 'Source origin is required')
    for (const key of ['system', 'sourceInstanceId', 'table', 'rowId'] as const) nonempty(input[key], key)
    requireValue(typeof input.sourceContentHash === 'string' && /^[a-f0-9]{64}$/.test(input.sourceContentHash), 'INVALID_INPUT', 'Invalid source content hash')
    return [project, input.system, input.sourceInstanceId, input.table, input.rowId, input.sourceContentHash]
  }
  function getKnowledgeImport(input: SourceOrigin): KnowledgeImport | null {
    check()
    const row = db.prepare(`SELECT * FROM knowledge_import_map WHERE project_id=? AND origin_system=?
      AND source_instance_id=? AND source_table=? AND source_row_id=? AND source_hash=?`).get(...origin(input))
    if (!row) return null
    const targetRef = version(String(row.target_version_id)), importManifestRef = version(String(row.manifest_version_id))
    read(targetRef); read(importManifestRef)
    return { origin: { ...input }, targetRef, importManifestRef }
  }
  function validity(row: Row): KnowledgeValidity {
    return row.validity_mode === 'chapter_range'
      ? { mode: 'chapter_range', fromChapterId: String(row.valid_from_chapter_id),
        toChapterIdExclusive: row.valid_to_chapter_id_exclusive === null ? null : String(row.valid_to_chapter_id_exclusive) }
      : { mode: row.validity_mode as 'unknown' | 'timeless' }
  }
  function getKnowledgeSource(ref: VersionRef): KnowledgeCatalogEntry | null {
    check(); read(ref)
    const row = db.prepare('SELECT * FROM knowledge_source_catalog WHERE project_id=? AND source_version_id=?').get(project, ref.versionId)
    return row ? { sourceRef: { ...ref }, namespace: row.namespace as KnowledgeCatalogEntry['namespace'],
      factStatus: row.fact_status as KnowledgeCatalogEntry['factStatus'], sourceOwner: row.source_owner as Owner,
      validity: validity(row), sourceEventSequence: Number(row.source_event_sequence) } : null
  }
  function span(row: Row, ref: VersionRef): KnowledgeSpan {
    return { id: String(row.id), sourceRef: { ...ref }, parserVersion: String(row.parser_version), ordinal: Number(row.ordinal),
      locator: { format: 'utf8-byte-span-v1', start: Number(row.start_byte), endExclusive: Number(row.end_byte_exclusive), spanHash: String(row.span_hash) } }
  }
  function getKnowledgeSpans(ref: VersionRef, parserVersion: string): KnowledgeSpan[] {
    check(); const source = read(ref); nonempty(parserVersion, 'parserVersion')
    return db.prepare('SELECT * FROM knowledge_spans WHERE project_id=? AND source_version_id=? AND parser_version=? ORDER BY ordinal')
      .all(project, ref.versionId, parserVersion).map(row => {
        const value = span(row, ref)
        validateLocator(source, value.locator)
        return value
      })
  }
  function validateLocator(source: StoredArtifact, loc: Utf8SpanLocator) {
    requireValue(source.ref.kind === 'source_text' && source.owner === 'knowledge' && source.payload.format === 'text', 'INVALID_INPUT', 'Spans require a complete parsed source_text version')
    requireValue(loc && loc.format === 'utf8-byte-span-v1' && Number.isSafeInteger(loc.start) && Number.isSafeInteger(loc.endExclusive)
      && loc.start >= 0 && loc.endExclusive > loc.start, 'INVALID_INPUT', 'Invalid UTF-8 byte span')
    const bytes = Buffer.from(source.payload.text, 'utf8')
    requireValue(loc.endExclusive <= bytes.length, 'INVALID_INPUT', 'Span extends past source text')
    const content = bytes.subarray(loc.start, loc.endExclusive)
    try { new TextDecoder('utf-8', { fatal: true }).decode(content) }
    catch { requireValue(false, 'INVALID_INPUT', 'Span must align to UTF-8 character boundaries') }
    requireValue(sha256(content) === loc.spanHash, 'CONTENT_CORRUPT', 'Span checksum does not match exact source bytes')
  }
  function chapter(id: string): Row {
    nonempty(id, 'chapterId')
    const row = db.prepare("SELECT * FROM story_nodes WHERE project_id=? AND id=? AND kind='chapter'").get(project, id)
    requireValue(row, 'CROSS_PROJECT_REFERENCE', 'Chapter is absent or belongs to another project')
    return row
  }
  return {
    getKnowledgeImport, getKnowledgeSource, getKnowledgeSpans,
    recordKnowledgeImport(input) {
      write(); requireValue(input && typeof input === 'object', 'INVALID_INPUT', 'Import mapping is required'); origin(input.origin)
      const target = read(input.targetRef), manifest = read(input.importManifestRef)
      requireValue(target.owner === 'knowledge' && target.ref.kind === 'knowledge_source', 'OWNER_MISMATCH', 'Import target must be a knowledge_source')
      requireValue(manifest.owner === 'knowledge' && manifest.ref.kind === 'knowledge_import_manifest' && manifest.payload.format === 'json',
        'OWNER_MISMATCH', 'A complete JSON import manifest is required')
      requireValue(input.origin.sourceContentHash === target.ref.contentHash, 'CONTENT_CORRUPT', 'Source bytes must match the complete stored payload')
      const payload = manifest.payload.value as { origin?: unknown; targetRef?: unknown } | null
      requireValue(payload && canonicalJson(payload.origin) === canonicalJson(input.origin)
        && canonicalJson(payload.targetRef) === canonicalJson(input.targetRef), 'VERSION_MISMATCH', 'Manifest must bind this exact source origin and target reference')
      requireValue(db.prepare('SELECT 1 FROM artifact_dependencies WHERE project_id=? AND version_id=? AND source_version_id=?')
        .get(project, manifest.ref.versionId, target.ref.versionId), 'VERSION_MISMATCH', 'Manifest must depend on the exact imported version')
      const prior = getKnowledgeImport(input.origin)
      if (prior) {
        requireValue(canonicalJson(prior) === canonicalJson(input), 'IDEMPOTENCY_CONFLICT', 'Source identity already maps to different versions')
        return
      }
      db.prepare(`INSERT INTO knowledge_import_map(project_id,origin_system,source_instance_id,source_table,source_row_id,source_hash,target_version_id,manifest_version_id)
        VALUES (?,?,?,?,?,?,?,?)`).run(...origin(input.origin), target.ref.versionId, manifest.ref.versionId)
    },
    catalogKnowledgeSource(input) {
      write()
      requireValue(input && typeof input === 'object', 'INVALID_INPUT', 'Catalog entry is required')
      const source = read(input.sourceRef)
      requireValue(OWNERS.includes(input.sourceOwner) && source.owner === input.sourceOwner, 'OWNER_MISMATCH', 'Catalog source owner must match the authority')
      requireValue(KNOWLEDGE_NAMESPACES.includes(input.namespace) && FACT_STATUSES.includes(input.factStatus), 'INVALID_INPUT', 'Invalid namespace or fact status')
      requireValue(input.namespace !== 'canon' || ['story', 'writer', 'publication'].includes(input.sourceOwner), 'OWNER_MISMATCH', 'Reference imports cannot become canon')
      requireValue(input.namespace !== 'planning' || ['planning', 'story'].includes(input.sourceOwner), 'OWNER_MISMATCH', 'Reference imports cannot become planning facts')
      requireValue(Number.isSafeInteger(input.sourceEventSequence) && input.sourceEventSequence >= 0, 'INVALID_INPUT', 'Invalid source event cursor')
      if (input.sourceEventSequence > 0) requireValue(db.prepare('SELECT 1 FROM outbox_events WHERE project_id=? AND owner=? AND sequence=?')
        .get(project, input.sourceOwner, input.sourceEventSequence), 'VERSION_MISMATCH', 'Cursor must identify a committed source-domain event')
      const prior = getKnowledgeSource(input.sourceRef)
      if (prior) {
        requireValue(input.sourceEventSequence >= prior.sourceEventSequence, 'STATE_CONFLICT', 'Catalog cursor must not move backwards')
        if (input.sourceEventSequence === prior.sourceEventSequence) {
          requireValue(canonicalJson(prior) === canonicalJson(input), 'STATE_CONFLICT', 'A changed projection requires a newer source event')
          return
        }
      }
      const range = input.validity
      requireValue(range && ['unknown', 'timeless', 'chapter_range'].includes(range.mode), 'INVALID_INPUT', 'Explicit validity mode required')
      if (range.mode === 'chapter_range') {
        const from = chapter(range.fromChapterId)
        if (range.toChapterIdExclusive !== null) {
          const to = chapter(range.toChapterIdExclusive)
          // Cross-volume order is not defined by local chapter positions yet: fail closed.
          requireValue(from.parent_id === to.parent_id && Number(to.position) > Number(from.position), 'INVALID_INPUT', 'Range needs increasing sibling chapter order; cross-volume ordering is not implemented')
        }
      } else requireValue(!('fromChapterId' in range) && !('toChapterIdExclusive' in range), 'INVALID_INPUT', 'Non-range validity must not contain chapter bounds')
      db.prepare(`INSERT INTO knowledge_source_catalog(project_id,source_version_id,namespace,source_owner,fact_status,validity_mode,
        valid_from_chapter_id,valid_to_chapter_id_exclusive,source_event_sequence) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,source_version_id) DO UPDATE SET namespace=excluded.namespace,source_owner=excluded.source_owner,
        fact_status=excluded.fact_status,validity_mode=excluded.validity_mode,valid_from_chapter_id=excluded.valid_from_chapter_id,
        valid_to_chapter_id_exclusive=excluded.valid_to_chapter_id_exclusive,source_event_sequence=excluded.source_event_sequence,
        recorded_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
        .run(project, input.sourceRef.versionId, input.namespace, input.sourceOwner, input.factStatus, range.mode,
          range.mode === 'chapter_range' ? range.fromChapterId : null, range.mode === 'chapter_range' ? range.toChapterIdExclusive : null, input.sourceEventSequence)
    },
    putKnowledgeSpan(input) {
      write(); requireValue(input && typeof input === 'object', 'INVALID_INPUT', 'Span is required'); nonempty(input.parserVersion, 'parserVersion')
      requireValue(Number.isSafeInteger(input.ordinal) && input.ordinal >= 0, 'INVALID_INPUT', 'Invalid span ordinal')
      const source = read(input.sourceRef), loc = input.locator
      validateLocator(source, loc)
      const old = db.prepare('SELECT * FROM knowledge_spans WHERE project_id=? AND source_version_id=? AND parser_version=? AND ordinal=?')
        .get(project, input.sourceRef.versionId, input.parserVersion, input.ordinal)
      if (old) {
        requireValue(canonicalJson(span(old, input.sourceRef).locator) === canonicalJson(loc), 'IDEMPOTENCY_CONFLICT', 'Span ordinal already maps to different content')
        return span(old, input.sourceRef)
      }
      const id = randomUUID()
      db.prepare('INSERT INTO knowledge_spans(id,project_id,source_version_id,parser_version,ordinal,start_byte,end_byte_exclusive,span_hash) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, project, input.sourceRef.versionId, input.parserVersion, input.ordinal, loc.start, loc.endExclusive, loc.spanHash)
      return { ...input, sourceRef: { ...input.sourceRef }, locator: { ...loc }, id }
    },
  }
}
