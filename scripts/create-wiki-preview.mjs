// Standalone preview data preparation; no local test suite or user database is required.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { LocalStorage } from '../lib/infrastructure/storage/storage.js'
import { CONTRACT_VERSION } from '../lib/shared/contracts/index.js'
import { WikiReader } from '../lib/modules/wiki/host/service.js'
const temporary = mkdtempSync(join(tmpdir(), 'dsh-wiki-preview-'))
let storage
try {
  const path = join(temporary, 'preview.sqlite3')
  const initialized = spawnSync('python', ['-X', 'utf8', fileURLToPath(new URL('./local_db.py', import.meta.url)), 'init', '--db', path], { encoding: 'utf8', windowsHide: true })
  if (initialized.status !== 0) throw new Error(initialized.error?.message || initialized.stderr || 'Wiki preview initialization failed')
  storage = new LocalStorage(path)
  const command = (owner, projectId, operationId, action) => storage.repositoryFor(owner, projectId).command({
    contractVersion: CONTRACT_VERSION, pluginInstanceId: storage.instanceId(), projectId, operationId,
    scope: { targetIds: [], referenceIds: [] }, expectedVersions: [], input: {},
  }, action).result
  for (const [id, title] of [['p', '演示小说'], ['q', '空白项目']]) {
    command('story', id, 'preview-project-' + id, tx => { tx.createProject(title); return null })
  }
  const refs = command('knowledge', 'p', 'preview-knowledge', tx => {
    const append = (key, text, kind, title, sources = []) => tx.appendArtifact({ key, kind, schemaVersion: 'preview-v1',
      payload: { format: 'text', text }, metadata: { title }, sources })
    const original = append('river-study', '江流城的水路与商会。人物的动机需要通过行动呈现。😀', 'knowledge_source', '江流城 · 世界与写作资料')
    const origin = { system: 'synthetic-preview', sourceInstanceId: 'preview-library', table: 'documents', rowId: 'river-city', sourceContentHash: original.contentHash }
    const manifest = tx.appendArtifact({ key: 'import-river-study', kind: 'knowledge_import_manifest', schemaVersion: 'import-v1',
      payload: { format: 'json', value: { origin, targetRef: original } }, sources: [{ ref: original, relation: 'imported_source' }] })
    tx.recordKnowledgeImport({ origin, targetRef: original, importManifestRef: manifest })
    const quote = '江流城依水而建，商会控制渡口。'
    const source = append('river-study-text', quote + '\n人物的动机需要通过行动呈现。😀\n资料仅供参考，尚未采纳为作品事实。',
      'source_text', '江流城研究 · 解析文本', [{ ref: original, relation: 'parsed_from' }])
    const catalog = sourceRef => tx.catalogKnowledgeSource({ sourceRef, sourceOwner: 'knowledge', namespace: 'reference',
      factStatus: 'observed', validity: { mode: 'unknown' }, sourceEventSequence: 0 })
    catalog(original); catalog(source)
    const locator = { format: 'utf8-byte-span-v1', start: 0, endExclusive: Buffer.byteLength(quote), spanHash: createHash('sha256').update(quote).digest('hex') }
    tx.putKnowledgeSpan({ sourceRef: source, parserVersion: 'plain-utf8-v1', ordinal: 0, locator })
    const document = { title: '江流城：水路与商会', summary: '合成演示：城市水路与商会关系，保留资料依据。',
      markdown: '# 城市与水路\n\n' + quote + '\n\n## 写作线索\n\n- 通过渡口活动呈现城市生活。\n- 人物的选择应当与其动机相连。\n\n> 合成演示资料，尚未确认为作品设定。',
      claims: [{ id: 'river-control', statement: quote, namespace: 'reference', factStatus: 'observed', supportBundleIds: ['river-evidence'] }],
      supportBundles: [{ id: 'river-evidence', supports: [{ sourceRef: source, locator, parserVersion: 'plain-utf8-v1', role: 'supports' }] }],
      sourceRefs: [source], links: [], policyVersion: 'preview-v1', compilerProfileVersion: 'manual-preview-v1', coverage: { summary: '城市资料演示' }, conflicts: [] }
    const page = tx.appendArtifact({ key: 'wiki-river-city', kind: 'wiki_page', schemaVersion: 'wiki-page-v1', payload: { format: 'json', value: document }, sources: [{ ref: source, relation: 'evidence' }] })
    const later = append('river-study-text', '江流城的新解析版本；保留旧引用的精确内容。', 'source_text', '江流城研究 · 解析文本', [{ ref: original, relation: 'parsed_from' }])
    catalog(later)
    const revoked = append('withdrawn-study', '已撤回的渡口资料。', 'source_text', '旧渡口记录')
    tx.decide(revoked, 'revoked', 'preview-author', '资料内容有误')
    return [page, source, original, later, manifest, revoked]
  })
  const reader = new WikiReader(storage)
  const scope = { projectId: 'p', pluginInstanceId: storage.instanceId() }
  const pages = reader.browse({ ...scope, kind: 'pages', query: '', offset: 0, includeInactive: true })
  const sources = reader.browse({ ...scope, kind: 'sources', query: '', offset: 0, includeInactive: true })
  const details = {}
  for (const ref of refs) details[ref.versionId] = reader.read({ ...scope, ref, offset: 0 })
  const output = new URL('../.preview/', import.meta.url)
  mkdirSync(output, { recursive: true })
  writeFileSync(new URL('wiki-preview.json', output), JSON.stringify({ overview: reader.overview(), pages, sources, details }, null, 2) + '\n')
  console.log('Wiki preview fixtures generated from an isolated temporary database.')
} finally {
  storage?.dispose()
  if (dirname(resolve(temporary)) !== resolve(tmpdir()) || !temporary.split(/[\\/]/).at(-1).startsWith('dsh-wiki-preview-')) throw new Error('Unexpected preview cleanup path')
  rmSync(temporary, { recursive: true, force: true })
}
