import { createHash } from 'node:crypto'

export const SCHEMA = 'backtest-dataset-v1'
export const representations = ['literal', 'lexical', 'enriched']
export const formats = ['json', 'markdown']
export const canonical = value => JSON.stringify(value, function (key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item
})
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex')
export function check(condition, message) { if (!condition) throw new Error(message) }
export function object(value, required, optional = []) {
  check(value && typeof value === 'object' && !Array.isArray(value), '需要对象')
  check(required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => [...required, ...optional].includes(k)), '字段缺失或存在未知字段')
}
const text = (v, max = 1000) => check(typeof v === 'string' && v.trim() && v.length <= max && !v.includes('\0'), '文本无效')
const id = v => check(typeof v === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(v), '标识无效')
const array = (v, max) => check(Array.isArray(v) && v.length <= max, '列表无效或过长')
const unique = values => check(new Set(values).size === values.length, '存在重复标识或标注')
export function validateDataset(raw) {
  const dataset = structuredClone(raw)
  object(dataset, ['schemaVersion','id','version','title','kind','provenance','cases'], ['documents','config','evidence','world'])
  check(dataset.schemaVersion === SCHEMA, '测试集版本不支持'); id(dataset.id); text(dataset.version, 80); text(dataset.title, 200)
  check(['retrieval','answer-contract','query-boundary','data-contract','model','world-query'].includes(dataset.kind), '测试集类型不支持')
  object(dataset.provenance, ['type','reviewed','note'])
  check(['synthetic','exported'].includes(dataset.provenance.type) && typeof dataset.provenance.reviewed === 'boolean', '测试集来源无效')
  text(dataset.provenance.note, 2000)
  array(dataset.cases, 200); check(dataset.cases.length, '测试集不能为空'); unique(dataset.cases.map(c => c.id))
  if (['retrieval','model'].includes(dataset.kind)) {
    object(dataset.config, ['topK','maxCharacters','representations'], dataset.kind === 'model' ? ['formats','repeats'] : [])
    check(Number.isInteger(dataset.config.topK) && dataset.config.topK >= 1 && dataset.config.topK <= 20, 'topK 无效')
    check(Number.isInteger(dataset.config.maxCharacters) && dataset.config.maxCharacters >= 1000 && dataset.config.maxCharacters <= 40000, '字符预算无效')
    array(dataset.config.representations, 3); check(dataset.config.representations.length && dataset.config.representations.every(v => representations.includes(v)), '检索方案无效'); unique(dataset.config.representations)
    if (dataset.kind === 'model') {
      array(dataset.config.formats, 2); unique(dataset.config.formats)
      check(dataset.config.formats.length && dataset.config.formats.every(v => formats.includes(v)), '格式无效')
      check(Number.isInteger(dataset.config.repeats) && dataset.config.repeats >= 1 && dataset.config.repeats <= 5 && dataset.cases.length <= 20, '模型样本预算超限')
      check(dataset.config.representations.length === 1, '模型格式对照须固定一个检索方案')
    }
    array(dataset.documents, 100); check(dataset.documents.length, '资料不能为空'); unique(dataset.documents.map(d => d.id))
    for (const d of dataset.documents) {
      object(d, ['id','title','text','keywords'], ['annotations']); id(d.id); text(d.title, 200); text(d.text, 60000)
      array(d.keywords, 12); d.keywords.forEach(k => text(k, 80))
      if (d.annotations !== undefined) {
        array(d.annotations, 100)
        for (const a of d.annotations) { object(a, ['title','summary','keywords']); text(a.title,100); text(a.summary,400); array(a.keywords,12); a.keywords.forEach(k=>text(k,80)) }
      }
    }
  }
  if (dataset.kind === 'answer-contract') {
    array(dataset.evidence, 20); unique(dataset.evidence.map(e => e.id))
    for (const e of dataset.evidence) { object(e,['id','text']); text(e.id,160); text(e.text,6000) }
  }
  for (const c of dataset.cases) {
    id(c.id); check(['dev','test'].includes(c.split), '分组无效')
    if (['retrieval','model'].includes(dataset.kind)) {
      object(c,['id','split','question','expected','answerable'], ['expectedStatus','attack','reviewNotes'])
      text(c.question,600); array(c.expected,20); check(typeof c.answerable === 'boolean', 'answerable 无效')
      check(c.answerable ? c.expected.length > 0 : c.expected.length === 0, '标准证据与可回答标签不一致')
      unique(c.expected.map(canonical))
      for (const e of c.expected) { object(e,['documentId','quote']); id(e.documentId); text(e.quote,1000); check(dataset.documents.some(d=>d.id===e.documentId && d.text.includes(e.quote)), '预期证据不属于语料') }
      if (c.expectedStatus !== undefined) check(['answered','conflict','insufficient'].includes(c.expectedStatus), '预期状态无效')
      if (dataset.kind === 'model') check(c.expectedStatus && (c.answerable ? c.expectedStatus !== 'insufficient' : c.expectedStatus === 'insufficient'), '模型用例需要一致的预期状态')
      if (c.attack !== undefined) { object(c.attack,['goal','marker']); text(c.attack.goal); text(c.attack.marker,100) }
      if (c.reviewNotes !== undefined) text(c.reviewNotes,2000)
    } else if (dataset.kind === 'world-query') {
      object(c,['id','split','question','expectedIds','recordIds','answerable']); text(c.question,600)
      array(c.expectedIds,100); array(c.recordIds,100); c.expectedIds.forEach(id); c.recordIds.forEach(id); unique(c.expectedIds); unique(c.recordIds)
      check(typeof c.answerable === 'boolean' && (c.answerable ? c.expectedIds.length > 0 : !c.expectedIds.length), '世界观标注无效')
    } else {
      const field = dataset.kind === 'answer-contract' ? 'output' : dataset.kind === 'query-boundary' ? 'request' : 'input'
      object(c,['id','split',field,'accept']); check(typeof c.accept === 'boolean','预期行为无效')
      if (field === 'output') text(c.output,160000)
      if (field === 'input') check(c.input?.kind === 'retrieval','数据契约样本仅允许检索测试集，避免递归')
    }
  }
  if (['retrieval','model','world-query'].includes(dataset.kind)) {
    check(dataset.cases.some(c=>c.split==='dev') && dataset.cases.some(c=>c.split==='test'), '需要 dev 与 test 两组用例')
    check(!dataset.provenance.reviewed || new Set(dataset.cases.map(c=>c.question.trim())).size === dataset.cases.length, '已审阅测试集不得重复相同问题')
  }
  if (dataset.kind === 'world-query') {
    object(dataset.config,['maxRecords','maxCharacters'])
    check(Number.isInteger(dataset.config.maxRecords) && dataset.config.maxRecords>=1 && dataset.config.maxRecords<=100,'世界观条数无效')
    check(Number.isInteger(dataset.config.maxCharacters) && dataset.config.maxCharacters>=200 && dataset.config.maxCharacters<=100000,'世界观字符预算无效')
    check(dataset.world && Array.isArray(dataset.world.records),'世界观快照缺失')
    for(const c of dataset.cases)check([...c.expectedIds,...c.recordIds].every(id=>dataset.world.records.some(r=>r.id===id)),'世界观标注指向未知条目')
  }
  return dataset
}
