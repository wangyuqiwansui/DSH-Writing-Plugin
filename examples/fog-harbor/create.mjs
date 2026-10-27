// Explicit demo-data composition. Business writes always use middleware tasks and scoped module services.
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import { LocalStorage } from '../../lib/infrastructure/storage/storage.js'
import { WritingMiddleware } from '../../lib/infrastructure/middleware/service.js'
import { PersonaService } from '../../lib/modules/author-persona/application/service.js'
import { WorldService } from '../../lib/modules/worldbuilding/application/service.js'
import { parsePersona, validatePersona } from '../../lib/modules/author-persona/domain/persona.js'
import { parseWorld, validateWorld, worldSummary } from '../../lib/modules/worldbuilding/domain/world.js'
import { NovelController } from '../../lib/modules/novel/client/controller.js'
import { NovelService } from '../../lib/modules/novel/application/service.js'
import { latest } from '../../lib/modules/novel/contracts/index.js'
import { blankFields, validateFields } from '../../lib/modules/novel/domain/fields.js'
import { datasetId, title, persona, world, characters, settings, outline, states, chapters, units, volumes } from './data.mjs'

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..')
const outputRoot = resolve(root, 'local-output/examples/fog-harbor')
await mkdir(outputRoot, { recursive: true })
const output = await mkdtemp(resolve(outputRoot, 'run-'))
const evidence = output
const args = process.argv.slice(2), installing = args.includes('--install')
const personaId = 'demo-fog-harbor-persona-v1', worldId = 'demo-fog-harbor-world-v1'
const json = value => JSON.stringify(value, null, 2) + '\n'
const sha = value => createHash('sha256').update(value).digest('hex')
const count = text => Array.from(text.replace(/\s/g, '')).length
const expectedBodyBoundary = (kind, issue) => kind === 'body' && issue.code === 'MISSING_SOURCE'
  && issue.message === '前序正式事实尚不可用：当前版本未接入正文入库与写后维护，仍可编辑草稿'
const rules = 'r-reality：无超自然；r-record：保全原记录；r-tide：实测及双签放行；r-clock：双钟仅验证测量环节；r-archive：双人开封；r-public：事实与指控分栏。'
const p = parsePersona(persona), w = parseWorld(world)
assert.deepEqual(validatePersona(p), [], 'Persona validation')
assert.deepEqual(validateWorld(w), [], 'World validation')
assert.equal(Object.hasOwn(w, 'categories'), false); assert.equal(w.records.length, 20)
assert.equal(characters.length, 6); assert.equal(chapters.length, 8)
assert.equal(Number(settings.expectedChapters), chapters.length)
const bodyCounts = chapters.map(c => ({ title: c.title, nonWhitespaceCharacters: count(c.text) }))
for (const item of bodyCounts) assert.ok(item.nonWhitespaceCharacters >= Number(settings.minWords) && item.nonWhitespaceCharacters <= Number(settings.maxWords), JSON.stringify(item))

async function buildNovel(publications) {
  const controller = new NovelController(), service = controller.service
  try {
    let pa, wa
    if (publications) {
      assert.equal(await controller.addPersonaVersion(publications.projection), true, controller.getSnapshot().error)
      assert.equal(await controller.addWorldVersion(publications.world), true, controller.getSnapshot().error)
      pa = service.getSnapshot().assets.find(a => a.kind === 'persona')
      wa = service.getSnapshot().assets.find(a => a.kind === 'world')
    } else {
      pa = await service.addAsset('persona', p.name, p.prompt)
      wa = await service.addAsset('world', w.name, worldSummary(w))
    }
    const reference = await service.addAsset('reference', '【测试】创作约定与证据索引',
      `原创测试资料；不引用真实案件，不代表模型文学评审。\n全书时间：${w.era}\n证据依次为：绿单和测潮副本→双钟校验及纸带→封存原联和纸张移交表→欠款凭证及自我更正→两地保全回条→双签停航单→回灯记录→独立审查移交表。\n所有已知未决项在本测试数据中完成处理；正文仍是手动测试稿，未正式入库。`)
    const project = await service.createProject({ title, personaId: pa.id, worldId: wa.id, referenceIds: reference.id, idempotencyKey: datasetId })
    const saved = async (kind, fields, parentId = null, confirm = true) => {
      fields = { ...blankFields(kind), ...fields }
      assert.deepEqual(validateFields(kind, fields, true), [], `${kind}: ${fields.title}`)
      const doc = await service.save({ projectId: project.id, kind, fields, parentId, expectedRevision: 0 })
      assert.deepEqual(service.check(doc.id).filter(i=>!expectedBodyBoundary(kind,i)), [], `Handoff: ${fields.title}`)
      return confirm ? service.confirm(doc.id, 1) : doc
    }
    const charMap = new Map()
    for (const { key, ...fields } of characters) charMap.set(key, (await saved('character', fields)).id)
    await saved('settings', settings)
    const idsFor = list => [...new Set(list.flatMap(c => c.cast))].map(key => charMap.get(key)).join(',')
    const plan = await saved('outline', { ...outline, characterIds: idsFor(chapters) })
    const coverage = []
    for (let vi = 0; vi < volumes.length; vi++) {
      const group = chapters.slice(vi * 4, vi * 4 + 4)
      const vf = { ...volumes[vi], narrative: group.map(c => c.plot).join('\n\n'), entryState: states[vi * 4], exitState: states[vi * 4 + 4],
        handoff: vi === 0 ? states[4] : '全书结束；后续审查和赔偿按既定程序执行，不新增未承诺的悬疑线。',
        events: units.slice(vi*2,vi*2+2).map((u,i)=>`v${vi+1}-u${i+1} | ${u.goal}`).join('\n'), characterIds: idsFor(group), rules,
        analysis: `本卷覆盖第${vi*4+1}至${vi*4+4}章；单元事件不重复分配，入口承接前卷，末章出口等于本卷出口。证据、能力和角色知情范围按世界记录逐项核对。`, unresolved:'' }
      const volume = await saved('volume', vf, plan.id)
      for (let uj = 0; uj < 2; uj++) {
        const ui = vi*2+uj, first = ui*2, pair = chapters.slice(first,first+2)
        const unit = await saved('unit', { ...units[ui], narrative:pair.map(c=>c.plot).join('\n\n'),entryState:states[first],exitState:states[first+2],
          handoff:first+2<8 ? states[first+2] : '全部承诺已在本单元收束，停止新增事件。', sourceEventIds:`v${vi+1}-u${uj+1}`,
          events:pair.map((c,i)=>`u${ui+1}-c${i+1} | ${c.goal}`).join('\n'),characterIds:idsFor(pair),rules,
          analysis:'直接承接本卷唯一指定事件，拆为两项递进动作；场景、动机、证据与规则一致，末章出口等于本单元出口。',unresolved:'' }, volume.id)
        for (let cj = 0; cj < 2; cj++) {
          const ci = first+cj, c = chapters[ci]
          const chapter = await saved('chapter', {title:c.title,chapterPlot:c.plot,goal:c.goal,sourceEventIds:`u${ui+1}-c${cj+1}`,
            eventRoles:`本章完整承担“${c.goal}”，下一章从出口状态继续，不重复兑现本事件。`,entryState:states[ci],exitState:states[ci+1],
            handoff:ci<7 ? `${states[ci+1]} 下一章目标：${chapters[ci+1].goal}` : '全书收束，保留依法核查的程序边界，不再追加新悬念。',
            characterIds:idsFor([c]),motivation:`沈砚当前只掌握入口状态中的信息；${c.cast.map(k=>characters.find(x=>x.key===k).title).join('、')}按各自初始目标和本章已展示证据行动。禁止读取其他角色内心。`,
            pov:'沈砚有限第三人称',time:c.time,location:c.location,scenes:c.scenes,withheld:c.withheld,minWords:settings.minWords,maxWords:settings.maxWords,
            analysis:`已核对本章事件${`u${ui+1}-c${cj+1}`}属于直接上游；正文展示了行动、阻碍、选择和结果。入口/出口采用统一精确文本；原文${count(c.text)}个非空白字符，在约定区间内。`,unresolved:'' },unit.id)
          await saved('body', {title:c.title,text:c.text,notes:'原创完整测试稿，覆盖本章计划事件；保存为草稿，不宣称已经执行 AI 四项评审、正式入库或写后事实维护。'},chapter.id,false)
        }
        const result=service.coverage(unit.id);assert.equal(result.complete,true,unit.id);coverage.push({title:units[ui].title,...result})
      }
      const result=service.coverage(volume.id);assert.equal(result.complete,true,volume.id);coverage.push({title:volumes[vi].title,...result})
    }
    const docs=service.documents(project.id)
    assert.equal(docs.length,31)
    const bodyReadinessLimits=[]
    for(const d of docs){
      const issues=service.check(d.id)
      assert.deepEqual(issues.filter(i=>!expectedBodyBoundary(d.kind,i)),[],latest(d).fields.title)
      if(issues.length)bodyReadinessLimits.push({title:latest(d).fields.title,issues})
    }
    assert.equal(bodyReadinessLimits.length,7,'Chapters 2–8 retain the known formal-facts boundary')
    const text=service.exportProject(project.id), exported=JSON.parse(text)
    assert.equal(exported.assets.length,3)
    if(publications) {
      assert.deepEqual(exported.assets.find(a=>a.kind==='persona').sourceVersion,publications.projection.sourceVersion)
      assert.deepEqual(exported.assets.find(a=>a.kind==='world').sourceVersion,publications.world.ref)
    }
    // Exercise the real import contract. Import must retain data/identity links, but not confirmations.
    const importedService=new NovelService()
    try {
      const imported=await importedService.importProject(text), importedDocs=importedService.documents(imported.id)
      assert.equal(importedDocs.length,31)
      assert.ok(importedDocs.every(d=>latest(d).status==='candidate' && !d.confirmedRevision && !latest(d).confirmation))
      for(const d of importedDocs)assert.deepEqual(validateFields(d.kind,latest(d).fields,true),[],latest(d).fields.title)
      for(const d of importedDocs.filter(d=>d.kind==='body'))assert.ok(count(latest(d).fields.text)>=300)
    } finally { importedService.dispose() }
    return {text,report:{datasetId,title,documents:31,assets:3,characters:6,volumes:2,units:4,chapters:8,bodies:8,worldRecords:20,worldSchema:w.schemaVersion,worldHardRules:6,worldRelations:8,worldTerms:6,resolvedWorldQuestions:2,
      bodyCounts,totalBodyCharacters:bodyCounts.reduce((n,c)=>n+c.nonWhitespaceCharacters,0),coverage,fieldErrors:0,planningHandoffErrors:0,bodyReadinessLimits,
      sourceStates:{confirmed:23,bodyDrafts:8},importState:'31 candidates by design; no inherited confirmation',modelCalls:0,sha256:sha(text)}}
  } finally { controller.dispose() }
}

await mkdir(evidence,{recursive:true})
const preflight=await buildNovel()
await writeFile(resolve(evidence,'preflight.json'),json(preflight.report))
async function writeOutputs(result, publications) {
  await writeFile(resolve(output,'author-persona.json'),json(p))
  await writeFile(resolve(output,'world.json'),json(w))
  await writeFile(resolve(output,'fog-harbor.novel.json'),result.text)
  await writeFile(resolve(output,'manuscript.md'),`# ${title}\n\n原创合成测试稿；非正式入库正文。\n\n${chapters.map(c=>`## ${c.title}\n\n${c.text}`).join('\n\n')}\n`)
  await writeFile(resolve(output,'manifest.json'),json({...result.report,createdAt:new Date().toISOString(),
    personaVersion:publications?.persona.ref ?? null,worldVersion:publications?.world.ref ?? null}))
}
if(!installing){
  await writeOutputs(preflight)
  console.log(json({mode:'file-only',output,...preflight.report}))
  process.exit(0)
}
const profileIndex=args.indexOf('--profile')
assert.ok(profileIndex>=0 && args[profileIndex+1], '--install requires an explicit --profile directory')
const profilePath=resolve(args[profileIndex+1])
const config=yaml.load(await readFile(resolve(profilePath,'cordis.patch.yml'),'utf8'))
const row=config.find(e=>e.id==='writing-workbench'&&e.name==='dsh-writing-workbench')
assert.ok(row && typeof row.config?.databasePath==='string' && row.config.databasePath, 'Existing workbench database path required')
assert.notEqual(row.config.authorPersona,false, 'Persona disabled in target profile')
const storage=new LocalStorage(row.config.databasePath), middleware=new WritingMiddleware(storage)
try {
  const personaService=new PersonaService(middleware.data('author-persona')),worldService=new WorldService(middleware.data('worldbuilding'))
  const invoke=async(module,service,request)=>{
    const result=await middleware.task(module,`demo.${request.action}`,signal=>service.invoke(request,signal))
    assert.equal(result.ok,true,result.message);return result.data
  }
  const po=await invoke('author-persona',personaService,{action:'overview'}),wo=await invoke('worldbuilding',worldService,{action:'overview'})
  assert.ok(po.ready && wo.ready,'Target shared database must already be initialized and ready')
  assert.equal(po.pluginInstanceId,wo.pluginInstanceId)
  const targets=[{module:'author-persona',service:personaService,overview:po,idKey:'personaId',id:personaId,doc:p,rows:po.personas,status:'published'},
    {module:'worldbuilding',service:worldService,overview:wo,idKey:'worldId',id:worldId,doc:w,rows:wo.worlds,status:'active'}]
  // Precheck both targets before writing either one. Existing unrelated data is never changed.
  for(const t of targets)if(t.rows.some(x=>x[t.idKey]===t.id)){
    t.detail=await invoke(t.module,t.service,{action:'read',pluginInstanceId:po.pluginInstanceId,[t.idKey]:t.id,revision:null})
    assert.ok(isDeepStrictEqual(t.detail.version.document,t.doc),`Existing demo ${t.id} was edited; refusing to overwrite it`)
  }
  for(const t of targets){
    const command={pluginInstanceId:po.pluginInstanceId,[t.idKey]:t.id,document:t.doc}
    if(!t.detail)t.detail=(await invoke(t.module,t.service,{action:'command',command:{...command,operationId:`${t.id}-save`,expectedRevision:0,action:'save',authorConfirmed:false}})).detail
    if(t.detail.version.status!==t.status)t.detail=(await invoke(t.module,t.service,{action:'command',command:{...command,operationId:`${t.id}-publish`,expectedRevision:t.detail.version.revision,action:'publish',authorConfirmed:true}})).detail
    assert.equal(t.detail.version.status,t.status)
  }
  const projection=await invoke('author-persona',personaService,{action:'projection',pluginInstanceId:po.pluginInstanceId,personaId,revision:targets[0].detail.version.revision})
  const publications={persona:targets[0].detail,projection,world:targets[1].detail}
  const complete=await buildNovel(publications)
  await writeOutputs(complete,publications)
  await writeFile(resolve(evidence,'installation.json'),json({passed:true,profile:profilePath,personaVersion:publications.persona.ref,worldVersion:publications.world.ref,
    previousCounts:{personas:po.personas.length,worlds:wo.worlds.length},currentCounts:{personas:(await invoke('author-persona',personaService,{action:'overview'})).personas.length,worlds:(await invoke('worldbuilding',worldService,{action:'overview'})).worlds.length},
    databaseMigration:false,existingDataOverwritten:false,diagnostics:middleware.diagnostics(),report:complete.report}))
  console.log(json({installed:true,output,...complete.report,novelFile:resolve(output,'fog-harbor.novel.json')}))
} finally {middleware.dispose();storage.dispose()}
