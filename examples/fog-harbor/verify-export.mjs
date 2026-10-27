// Read-only business verification; writes only the project-local acceptance receipt.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { NovelService } from '../../lib/modules/novel/application/service.js'
import { latest } from '../../lib/modules/novel/contracts/index.js'
import { validateFields } from '../../lib/modules/novel/domain/fields.js'
import { parsePersona, validatePersona } from '../../lib/modules/author-persona/domain/persona.js'
import { parseWorld, validateWorld } from '../../lib/modules/worldbuilding/domain/world.js'

const inputIndex = process.argv.indexOf('--input')
assert.ok(inputIndex >= 0 && process.argv[inputIndex + 1], 'Use --input <local-output run directory containing the installed sample and current-session.novel.json>')
const input = resolve(process.argv[inputIndex + 1])
const read = name => readFile(resolve(input, name), 'utf8')
const sha = text => createHash('sha256').update(text).digest('hex')
const sourceText = await read('fog-harbor.novel.json'), liveText = await read('current-session.novel.json')
const source = JSON.parse(sourceText), live = JSON.parse(liveText), manifest = JSON.parse(await read('manifest.json'))
const persona = parsePersona(JSON.parse(await read('author-persona.json')))
const world = parseWorld(JSON.parse(await read('world.json')))
assert.deepEqual(validatePersona(persona), [])
assert.deepEqual(validateWorld(world), [])
assert.equal(world.records.length, 20)
assert.equal(sha(sourceText), manifest.sha256, 'Source backup matches installation receipt')
const expected = { assets: 1, settings: 1, outline: 1, character: 6, volume: 2, unit: 4, chapter: 8, body: 8 }
const key = doc => `${doc.kind}:${latest(doc).fields.title}`
const normalize = data => {
  assert.equal(data.format, 'writing-novel-memory-v1')
  assert.equal(data.assets.length, 3)
  assert.equal(data.documents.length, 31)
  assert.equal(new Set(data.documents.map(key)).size, 31)
  const docs = new Map(data.documents.map(d => [d.id, d]))
  const assets = new Map(data.assets.map(a => [a.id, a]))
  const assetName = id => { const a = assets.get(id); assert.ok(a, `Missing asset ${id}`); return `${a.kind}:${a.name}` }
  const docName = id => { const d = docs.get(id); assert.ok(d, `Missing document ${id}`); return key(d) }
  const counts = {}
  for (const d of data.documents) {
    counts[d.kind] = (counts[d.kind] || 0) + 1
    assert.equal(d.projectId, data.project.id)
    assert.deepEqual(validateFields(d.kind, latest(d).fields, true), [], key(d))
  }
  assert.deepEqual(counts, expected)
  return data.documents.map(d => {
    const fields = { ...latest(d).fields }
    for (const f of ['personaId', 'worldId']) if (fields[f]) fields[f] = assetName(fields[f])
    if (fields.referenceIds) fields.referenceIds = fields.referenceIds.split(',').map(assetName).join(',')
    if (fields.characterIds) fields.characterIds = fields.characterIds.split(',').map(docName).join(',')
    return { key: key(d), parent: d.parentId ? docName(d.parentId) : null, order: d.order, fields }
  }).sort((a, b) => a.key.localeCompare(b.key))
}
assert.deepEqual(normalize(live), normalize(source), 'All fields, cast bindings and parent links survive native import/export')
for (const asset of source.assets) {
  const actual = live.assets.find(a => a.kind === asset.kind)
  assert.ok(actual)
  const { id: sourceId, ...expectedAsset } = asset
  const { id: liveId, ...actualAsset } = actual
  assert.deepEqual(actualAsset, expectedAsset, asset.kind)
}
assert.deepEqual(live.assets.find(a => a.kind === 'persona').sourceVersion, manifest.personaVersion)
assert.deepEqual(live.assets.find(a => a.kind === 'world').sourceVersion, manifest.worldVersion)
const binding = live.documents.find(d => d.kind === 'assets'), current = latest(binding)
assert.equal(current.status, 'confirmed')
assert.equal(binding.confirmedRevision, 2)
assert.deepEqual(current.confirmation.sourceRefs, current.sourceRefs)
assert.equal(current.sourceRefs.length, 3)
for (const ref of current.sourceRefs) {
  const asset = live.assets.find(a => a.id === ref.objectId)
  assert.ok(asset)
  assert.equal(ref.revision, asset.revision)
  assert.equal(ref.contentHash, asset.contentHash)
}
for (const d of live.documents.filter(d => d.kind !== 'assets')) {
  assert.equal(latest(d).status, 'candidate')
  assert.equal(d.confirmedRevision, null)
  assert.equal(latest(d).confirmation, undefined)
}
const total = live.documents.filter(d => d.kind === 'body')
  .reduce((sum, d) => sum + Array.from(latest(d).fields.text.replace(/\s/g, '')).length, 0)
assert.equal(total, 4260)
const service = new NovelService()
let recoveryExport
try {
  const restored = await service.importProject(liveText)
  assert.equal(service.documents(restored.id).length, 31)
  assert.ok(service.documents(restored.id).every(d => latest(d).status === 'candidate' && !d.confirmedRevision))
  assert.deepEqual(normalize({ format: live.format, project: restored, assets: service.getSnapshot().assets, documents: service.documents(restored.id) }), normalize(live), 'Backup imports with intact content')
  // Current exporter collects assets through sourceRefs, which import intentionally clears.
  // Record the limitation, then verify the explicit UI-equivalent source refresh workaround.
  const before = JSON.parse(service.exportProject(restored.id)).assets.length
  const assets = service.documents(restored.id, 'assets')[0]
  await service.save({ id: assets.id, projectId: restored.id, kind: 'assets', parentId: null, expectedRevision: 1, fields: latest(assets).fields })
  const rebound = JSON.parse(service.exportProject(restored.id))
  assert.deepEqual(normalize(rebound), normalize(live), 'Explicit asset source refresh preserves full reexport')
  recoveryExport = { assetsBeforeSourceRefresh: before, assetsAfterSourceRefresh: rebound.assets.length, productIssue: before === 0 ? 'DSH-SELFTEST-026' : null }
} finally { service.dispose() }
const report = {
  passed: true, checkedAt: new Date().toISOString(), nativeProjectId: live.project.id, nativeTitle: live.project.title,
  counts: expected, assets: 3, totalBodyCharacters: total, fieldErrors: 0, contentDifferences: 0,
  parentAndCastLinksPreserved: true, exactPublishedVersionsPreserved: true,
  liveStates: { confirmedAssetBindings: 1, candidates: 30 }, reimport: { documents: 31, candidates: 31, contentPreserved: true },
  recoveryExport,
  sourceSha256: sha(sourceText), nativeExportSha256: sha(liveText),
  limits: ['Novel stays in session memory; import restores content as candidates, not prior author confirmations.',
    'After restoring, refresh asset sources before reexporting; the current exporter otherwise omits candidate-only assets.',
    'Formal body publication and post-writing facts are not implemented; this check does not assert literary review.']
}
const outputIndex = process.argv.indexOf('--report')
const output = outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : resolve(input, 'native-export-verification.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
