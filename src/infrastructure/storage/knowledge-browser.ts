import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { canonicalJson, requireValue, type KnowledgeBrowse, type KnowledgeDescription, type KnowledgeSnapshot,
  type KnowledgeSummary, type StoredArtifact, type VersionRef } from '../../shared/contracts/index.js'

type Row = Record<string, SQLOutputValue>
const inactive = ['revoked', 'superseded', 'rejected']
/** Fixed read queries only. SQL, connections and mutable projections do not cross the storage port. */
export function knowledgeBrowser(db: DatabaseSync, project: string, instance: string, check: () => void,
  version: (id: string) => VersionRef, read: (ref: VersionRef) => StoredArtifact,
  catalog: KnowledgeSnapshot['getKnowledgeSource'], imported: KnowledgeSnapshot['getKnowledgeImport']) {
  function summary(ref: VersionRef): KnowledgeSummary {
    check()
    const content = read(ref)
    const row = db.prepare(`SELECT a.artifact_key,v.created_at,
      NOT EXISTS(SELECT 1 FROM artifact_versions newer WHERE newer.artifact_id=v.artifact_id AND newer.revision>v.revision) AS latest
      FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id WHERE v.project_id=? AND v.id=?`).get(project, ref.versionId)!
    const entry = catalog(ref)
    const decision = db.prepare('SELECT decision,reason FROM artifact_decisions WHERE project_id=? AND version_id=? ORDER BY rowid DESC LIMIT 1').get(project, ref.versionId)
    const event = entry && db.prepare('SELECT max(sequence) AS sequence FROM outbox_events WHERE project_id=? AND owner=?').get(project, entry.sourceOwner)
    const metadata = content.metadata as { title?: unknown } | null
    const page = ref.kind === 'wiki_page' && content.payload.format === 'json' ? content.payload.value as { title?: unknown } | null : null
    const title = page?.title ?? metadata?.title
    return { ref, key: String(row.artifact_key), title: typeof title === 'string' && title.trim() ? title.slice(0, 300) : String(row.artifact_key),
      createdAt: String(row.created_at), byteLength: content.byteLength, latest: Boolean(row.latest), catalog: entry,
      catalogCurrent: !!entry && entry.sourceEventSequence > 0 && entry.sourceEventSequence === Number(event?.sequence),
      decision: decision ? { decision: decision.decision as NonNullable<KnowledgeSummary['decision']>['decision'], reason: String(decision.reason) } : null,
      inactive: inactive.includes(String(decision?.decision)) || inactive.includes(entry?.factStatus ?? '') }
  }
  function describeKnowledge(ref: VersionRef): KnowledgeDescription {
    const value = summary(ref)
    const dependencies = db.prepare('SELECT source_version_id,relation FROM artifact_dependencies WHERE project_id=? AND version_id=? ORDER BY source_version_id,relation')
      .all(project, ref.versionId).map(row => ({ ref: version(String(row.source_version_id)), relation: String(row.relation) }))
    const imports = db.prepare('SELECT * FROM knowledge_import_map WHERE project_id=? AND target_version_id=? ORDER BY origin_system,source_row_id')
      .all(project, ref.versionId).map((row: Row) => imported({ system: String(row.origin_system), sourceInstanceId: String(row.source_instance_id),
        table: String(row.source_table), rowId: String(row.source_row_id), sourceContentHash: String(row.source_hash) })!)
    // Recheck the immutable manifest, rather than presenting a mapping row as proof by itself.
    for (const mapping of imports) {
      const manifest = read(mapping.importManifestRef)
      const payload = manifest.payload.format === 'json' ? manifest.payload.value as { origin?: unknown; targetRef?: unknown } | null : null
      requireValue(mapping.origin.sourceContentHash === ref.contentHash && payload
        && canonicalJson(payload.origin) === canonicalJson(mapping.origin) && canonicalJson(payload.targetRef) === canonicalJson(ref),
      'CONTENT_CORRUPT', 'Import receipt does not match its immutable manifest')
    }
    return { ...value, dependencies, imports }
  }
  function browseKnowledge(input: KnowledgeBrowse) {
    check()
    requireValue(input.pluginInstanceId === instance, 'CROSS_PROJECT_REFERENCE', 'Database changed; refresh the project list')
    requireValue(db.prepare('SELECT 1 FROM projects WHERE id=?').get(project), 'NOT_FOUND', 'Project no longer exists')
    requireValue(['sources', 'pages'].includes(input.kind) && typeof input.query === 'string' && input.query.length <= 200
      && !input.query.includes('\0') && typeof input.includeInactive === 'boolean'
      && Number.isSafeInteger(input.offset) && input.offset >= 0 && input.offset <= 1_000_000
      && Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 50, 'INVALID_INPUT', 'Invalid browsing request')
    const scope = input.kind === 'pages' ? "a.kind='wiki_page'" : `(a.kind IN ('knowledge_source','source_text') OR
      (c.source_version_id IS NOT NULL AND a.kind NOT IN ('wiki_page','knowledge_import_manifest','wiki_release_manifest','retrieval_index_manifest','retrieval_trace')))`
    // Literal substring matching supports Chinese without trusting an incomplete FTS generation.
    // '%' and '_' are ordinary characters; no user-provided SQL or FTS expressions.
    const text = input.kind === 'pages'
      ? "coalesce(json_extract(v.content_json,'$.title'),'') || char(10) || coalesce(json_extract(v.content_json,'$.summary'),'') || char(10) || coalesce(json_extract(v.content_json,'$.markdown'),'') || char(10) || coalesce(json_extract(v.content_json,'$.claims'),'')"
      : "coalesce(v.content_text,v.content_json,'')"
    const from = `FROM artifacts a JOIN artifact_versions v ON v.artifact_id=a.id AND v.project_id=a.project_id
      LEFT JOIN knowledge_source_catalog c ON c.project_id=v.project_id AND c.source_version_id=v.id
      WHERE a.project_id=? AND ${scope}
      AND NOT EXISTS(SELECT 1 FROM artifact_versions newer WHERE newer.artifact_id=a.id AND newer.revision>v.revision)
      AND (?=1 OR (coalesce(c.fact_status,'') NOT IN ('revoked','superseded') AND coalesce(
        (SELECT decision FROM artifact_decisions d WHERE d.project_id=v.project_id AND d.version_id=v.id ORDER BY rowid DESC LIMIT 1),'') NOT IN ('revoked','superseded','rejected')))
      AND (?='' OR instr(lower(a.artifact_key || char(10) || coalesce(json_extract(v.metadata_json,'$.title'),'') || char(10) || ${text}),lower(?))>0)`
    const query = input.query.trim()
    const args = [project, Number(input.includeInactive), query, query]
    const total = Number(db.prepare(`SELECT count(*) AS n ${from}`).get(...args)!.n)
    const items = db.prepare(`SELECT v.id ${from} ORDER BY v.created_at DESC,v.id DESC LIMIT ? OFFSET ?`)
      .all(...args, input.limit, input.offset).map(row => summary(version(String(row.id))))
    return { items, total }
  }
  return { browseKnowledge, describeKnowledge }
}
