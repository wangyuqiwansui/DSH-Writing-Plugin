import { recordPath, settingTree, type SettingNode } from './tree.js'
import { canonicalJson } from '../../../shared/contracts/index.js'
import { ENTRY_TYPES, LEGACY_WORLD_SCHEMA, WORLD_SCHEMA, WORLD_SCHEMAS, type EntryType, type WorldDocument, type WorldIssue, type WorldQuestion, type WorldRecord } from '../contracts/index.js'

export class WorldError extends Error {
  constructor(readonly code: string, message: string, readonly issues: WorldIssue[] = []) { super(message) }
}
export function ensure(ok: unknown, message: string, code = 'INVALID_INPUT'): asserts ok { if (!ok) throw new WorldError(code, message) }
export function text(value: unknown, max = 20_000): string {
  ensure(typeof value === 'string' && value.length <= max && !value.includes('\0'), '文本格式无效或超过长度限制')
  return value
}
export function identity(value: unknown): string {
  const id = text(value, 120); ensure(/^[a-zA-Z0-9_-]+$/.test(id), '身份标识无效'); return id
}
export function integer(value: unknown): number { ensure(Number.isSafeInteger(value) && Number(value) >= 0, '版本号无效'); return Number(value) }
function object(value: unknown): Record<string, unknown> { ensure(value && typeof value === 'object' && !Array.isArray(value), '对象格式无效'); return value as Record<string, unknown> }
export function exact(value: unknown, keys: string[]): Record<string, unknown> {
  const obj = object(value); ensure(Object.keys(obj).length === keys.length && Object.keys(obj).every(k => keys.includes(k)), '存在未知或缺少的字段；扩展内容请放入 extensions'); return obj
}
function list(value: unknown, max = 500): unknown[] { ensure(Array.isArray(value) && value.length <= max, '列表格式无效或超过上限'); return value }
function choice<T extends string>(value: unknown, choices: readonly T[]): T { ensure(typeof value === 'string' && choices.includes(value as T), '枚举值无效'); return value as T }
function strings(obj: Record<string, unknown>, keys: string[]) { for (const k of keys) text(obj[k]) }
function ids(value: unknown): string[] { const values = list(value).map(identity); ensure(new Set(values).size === values.length, '引用 ID 重复'); return values }
function unique(items: { id: string }[]) { ensure(new Set(items.map(i => i.id)).size === items.length, '稳定 ID 重复') }
export const newId = () => crypto.randomUUID()
export function emptyWorld(): WorldDocument {
  return { schemaVersion: WORLD_SCHEMA, name: '', description: '', era: '', space: '', reality: 'fictional', records: [], relations: [], terms: [], hardRules: [], questions: [], extensions: {} }
}
export function newRecord(): WorldRecord {
  return { id: newId(), kind: 'setting', name: '', description: '', importance: 'background', rule: '', conditions: '', cost: '',
    scope: { mode: 'undetermined', time: '', place: '', subjects: '', conditions: '' }, confirmation: 'confirmed', truth: 'fact', validity: 'valid', expiryReason: '',
    rumor: { spreaders: '', range: '', period: '', veracity: 'unknown' }, origin: 'author', source: { citation: '', locator: '', period: '' }, ruleRefs: [] }
}
/** Structural validation accepts incomplete drafts; publication uses validateWorld below. */
export function parseWorld(value: unknown): WorldDocument {
  ensure(canonicalJson(value).length <= 2_000_000, '世界观内容超过 200 万字符')
  const input = object(value), legacy = input.schemaVersion !== WORLD_SCHEMA
  const d = exact(input, ['schemaVersion','name','description','era','space','reality','records','relations','terms','hardRules','questions','extensions', ...(legacy ? ['categories'] : [])])
  ensure(WORLD_SCHEMAS.includes(d.schemaVersion as typeof WORLD_SCHEMAS[number]), '不支持此世界观格式；旧格式需要先完成映射，原数据应保留')
  strings(d, ['name','description','era','space']); text(d.name, 200); choice(d.reality, ['real','fictional','mixed'])
  if (legacy) ids(d.categories)
  const records = list(d.records).map(raw => {
    const hasType = Object.hasOwn(object(raw), 'entryType')
    ensure(!hasType || d.schemaVersion !== LEGACY_WORLD_SCHEMA, 'v1 记录不能添加可选模板字段')
    const r = exact(raw, ['id','kind','name','description','importance','rule','conditions','cost','scope','confirmation','truth','validity','expiryReason','rumor','origin','source','ruleRefs', ...(legacy ? ['category'] : []), ...(hasType ? ['entryType'] : []), ...(Object.hasOwn(object(raw), 'parentId') ? ['parentId'] : [])])
    if (r.parentId !== undefined) identity(r.parentId)
    if (hasType) choice(r.entryType, ENTRY_TYPES.map(t => t.id))
    identity(r.id); text(r.name, 200); strings(r, ['description','rule','conditions','cost','expiryReason'])
    if (legacy) identity(r.category)
    choice(r.kind, ['setting','rule']); choice(r.importance, ['background','key'])
    choice(r.confirmation, ['candidate','confirmed']); choice(r.truth, ['fact','rumor']); choice(r.validity, ['valid','expired']); choice(r.origin, ['author','reference','model'])
    const scope = exact(r.scope, ['mode','time','place','subjects','conditions']); choice(scope.mode, ['global','local','undetermined']); strings(scope, ['time','place','subjects','conditions'])
    const rumor = exact(r.rumor, ['spreaders','range','period','veracity']); strings(rumor, ['spreaders','range','period']); choice(rumor.veracity, ['unknown','true','false'])
    strings(exact(r.source, ['citation','locator','period']), ['citation','locator','period']); ids(r.ruleRefs)
    const { category: _removed, ...record } = r
    return record as unknown as WorldRecord
  }); unique(records)
  const byId = new Map(records.map(r => [r.id, r]))
  for (const record of records) {
    const seen = new Set([record.id]); let parent = record.parentId
    while (parent) {
      ensure(byId.has(parent), '父设定不存在')
      ensure(!seen.has(parent), '设定目录不能循环引用')
      seen.add(parent); parent = byId.get(parent)!.parentId
    }
  }
  const relations = list(d.relations).map(raw => { const r = exact(raw, ['id','from','to','type','period','condition','source']); identity(r.id); identity(r.from); identity(r.to); strings(r, ['type','period','condition','source']); return r as unknown as WorldDocument['relations'][number] }); unique(relations)
  const terms = list(d.terms).map(raw => { const t = exact(raw, ['id','name','targetId','context','period']); identity(t.id); identity(t.targetId); strings(t, ['name','context','period']); return t as unknown as WorldDocument['terms'][number] }); unique(terms)
  const hardRules = list(d.hardRules).map(raw => { const h = exact(raw, ['ruleId','exceptions','priorityOver']); identity(h.ruleId); text(h.exceptions); ids(h.priorityOver); return h as unknown as WorldDocument['hardRules'][number] })
  ensure(new Set(hardRules.map(h => h.ruleId)).size === hardRules.length, '硬规则不可重复引用')
  const questions = list(d.questions).map(raw => {
    const q = exact(raw, ['id','question','recordIds','blocking','owner','status','resolution','basis']); identity(q.id); strings(q, ['question','owner','resolution']); ids(q.recordIds)
    ensure(typeof q.blocking === 'boolean', '阻断标记无效'); choice(q.status, ['open','resolved']); const basis = object(q.basis)
    Object.entries(basis).forEach(([k, v]) => { identity(k); text(v, 2_000_000) }); return q as unknown as WorldQuestion
  }); unique(questions); object(d.extensions)
  const { categories: _removed, ...fields } = d
  // Archived question bases can contain serialized records/documents with old directory fields.
  const cleanedQuestions = questions.map(q => ({ ...q, basis: Object.fromEntries(Object.entries(q.basis).map(([key, value]) => {
    try {
      const saved = JSON.parse(value)
      if (saved && !Array.isArray(saved) && typeof saved === 'object') {
        if (WORLD_SCHEMAS.includes(saved.schemaVersion)) return [key, canonicalJson(parseWorld(saved))]
        if (key !== 'world' && saved.id === key && ['setting', 'rule'].includes(saved.kind)) {
          const { category: _old, ...record } = saved; return [key, canonicalJson(record)]
        }
      }
    } catch { /* Non-JSON archival notes are unrelated to directory metadata. */ }
    return [key, value]
  })) }))
  return JSON.parse(canonicalJson({ ...fields, schemaVersion: WORLD_SCHEMA, records, relations, terms, hardRules, questions: cleanedQuestions })) as WorldDocument
}
/** Classification edits only the current optional template. Old directory fields never reappear. */
export function classifyRecord(doc: WorldDocument, recordId: string, entryType?: EntryType): WorldDocument {
  ensure(doc.records.some(r => r.id === recordId), '设定不存在', 'NOT_FOUND')
  if (entryType !== undefined) choice(entryType, ENTRY_TYPES.map(t => t.id))
  return parseWorld({ ...doc, schemaVersion: WORLD_SCHEMA, records: doc.records.map(r => {
    if (r.id !== recordId) return r
    const { entryType: _old, ...rest } = r
    return entryType === undefined ? rest : { ...rest, entryType }
  }) })
}
/** Legacy question metadata helper; questions no longer participate in publication checks. */
export function questionBasis(doc: WorldDocument, q: WorldQuestion): Record<string, string> {
  // A world-level question covers the whole content, excluding the questions themselves.
  return q.recordIds.length ? Object.fromEntries(q.recordIds.map(id => [id, canonicalJson(doc.records.find(r => r.id === id) ?? null)]))
    : { world: canonicalJson({ ...doc, questions: [] }) }
}
export function questionCurrent(doc: WorldDocument, q: WorldQuestion): boolean { return q.status === 'resolved' && canonicalJson(q.basis) === canonicalJson(questionBasis(doc, q)) }
export function referencesTo(doc: WorldDocument, id: string): string[] {
  return [...doc.records.filter(r => r.parentId === id).map(r => `子设定：${r.name}`), ...doc.records.filter(r => r.ruleRefs.includes(id)).map(r => `设定：${r.name}`), ...doc.hardRules.filter(r => r.ruleId === id || r.priorityOver.includes(id)).map(() => '世界硬规则'),
    ...doc.relations.filter(r => r.from === id || r.to === id).map(r => `关系：${r.type}`), ...doc.terms.filter(t => t.targetId === id).map(t => `术语：${t.name}`)]
}
export function validateWorld(doc: WorldDocument): WorldIssue[] {
  const issues: WorldIssue[] = [], records = new Map(doc.records.map(r => [r.id, r])), hard = new Set(doc.hardRules.map(h => h.ruleId))
  const criticalIds = new Set([...hard, ...doc.records.filter(r => r.importance === 'key').map(r => r.id)])
  for (const id of criticalIds) for (const ref of records.get(id)?.ruleRefs ?? []) criticalIds.add(ref)
  const add = (code: string, path: string, message: string, blocking = true, recordId?: string) => issues.push({ code, path, message, blocking, ...(recordId ? { recordId } : {}) })
  if (!doc.name.trim()) add('REQUIRED', 'name', '请填写世界名称')
  if (!doc.description.trim()) add('REQUIRED', 'description', '请填写世界简介')
  for (const r of doc.records) {
    const path = `records.${r.id}`, critical = criticalIds.has(r.id)
    if (!r.name.trim() || !r.description.trim()) add('REQUIRED', path, '设定需要名称和基本描述', true, r.id)
    if (critical) {
      if (!r.rule.trim() && !r.ruleRefs.length) add('RULE_REQUIRED', path, `${r.name}：关键设定需要运行规则或规则引用`, true, r.id)
      if (!r.conditions.trim() || !r.cost.trim()) add('BOUNDARY_REQUIRED', path, `${r.name}：请说明条件与代价；没有时可填写“无”`, true, r.id)
      if (r.scope.mode === 'undetermined' || !r.scope.time.trim() || (r.scope.mode === 'local' && !r.scope.place.trim() && !r.scope.subjects.trim())) add('SCOPE_REQUIRED', path, `${r.name}：请明确适用时期及全局或局部边界`, true, r.id)
      if (r.confirmation !== 'confirmed') add('UNCONFIRMED', path, `${r.name}：关键设定仍待作者确认`, true, r.id)
    }
    if (r.kind === 'rule' && !r.rule.trim()) add('RULE_REQUIRED', path, `${r.name}：规则记录需要规则内容`, true, r.id)
    if (r.truth === 'rumor' && (!r.rumor.spreaders.trim() || !r.rumor.range.trim() || !r.rumor.period.trim())) add('RUMOR_CONTEXT', path, `${r.name}：传闻需要传播者、范围和时期`, true, r.id)
    if (r.validity === 'expired' && (!r.expiryReason.trim() || !r.scope.time.trim())) add('EXPIRY_CONTEXT', path, `${r.name}：失效设定需要原适用时期和失效原因`, true, r.id)
    if (r.origin === 'reference' && (!r.source.citation.trim() || !r.source.locator.trim() || !r.source.period.trim())) add('SOURCE_REQUIRED', path, `${r.name}：现实参考需要出处、定位和适用时期`, true, r.id)
    if (r.confirmation === 'candidate') add('CANDIDATE', path, `${r.name}：待定内容不会作为已确认事实`, false, r.id)
    for (const id of r.ruleRefs) if (records.get(id)?.kind !== 'rule' || id === r.id) add('INVALID_RULE_REF', path, `${r.name}：规则引用失效或引用自身`, true, r.id)
    for (const id of r.ruleRefs) if (critical && (records.get(id)?.confirmation !== 'confirmed' || records.get(id)?.truth !== 'fact')) add('UNCONFIRMED_RULE', path, `${r.name}：关键设定依赖的规则未确认为事实`, true, r.id)
  }
  for (const rel of doc.relations) if (!records.has(rel.from) || !records.has(rel.to) || !rel.type.trim()) add('INVALID_RELATION', `relations.${rel.id}`, '关系需要有效的两端及关系名称')
  for (const term of doc.terms) {
    if (!records.has(term.targetId) || !term.name.trim()) add('INVALID_TERM', `terms.${term.id}`, '术语需要名称及有效的设定引用')
    const ambiguous = doc.terms.some(t => t.id !== term.id && t.name.trim() === term.name.trim() && t.targetId !== term.targetId && (!t.context.trim() || !term.context.trim() || (t.context.trim() === term.context.trim() && t.period.trim() === term.period.trim())))
    if (ambiguous) add('AMBIGUOUS_TERM', `terms.${term.id}`, `“${term.name}”指向多个对象，请用使用语境或有效时期消歧`)
  }
  for (const rule of doc.hardRules) {
    const r = records.get(rule.ruleId)
    if (!r || r.kind !== 'rule' || r.truth !== 'fact' || r.confirmation !== 'confirmed') add('INVALID_HARD_RULE', 'hardRules', '硬规则必须引用已确认的客观规则记录')
    if (!rule.exceptions.trim() || /^(特殊情况除外|视情况而定)[。！]?$/.test(rule.exceptions.trim())) add('EXCEPTION_REQUIRED', 'hardRules', '硬规则需要明确例外条件；无例外请填写“无例外”')
    if (rule.priorityOver.some(id => id === rule.ruleId || !hard.has(id))) add('INVALID_PRIORITY', 'hardRules', '优先关系需要指向另一条硬规则')
    if (r && doc.hardRules.some(h => h.ruleId !== r.id && records.get(h.ruleId)?.rule.trim() === r.rule.trim() && canonicalJson(records.get(h.ruleId)?.scope ?? null) === canonicalJson(r.scope))) add('DUPLICATE_RULE', 'hardRules', '相同内容及适用范围的硬规则重复，请统一引用同一条规则')
  }
  const cycles = (edges: Map<string, string[]>) => {
    const done = new Set<string>(), active = new Set<string>()
    const visit = (id: string): boolean => { if (active.has(id)) return true; if (done.has(id)) return false; active.add(id); for (const next of edges.get(id) ?? []) if (visit(next)) return true; active.delete(id); done.add(id); return false }
    return [...edges.keys()].some(visit)
  }
  if (cycles(new Map(doc.hardRules.map(r => [r.ruleId, r.priorityOver])))) add('PRIORITY_CYCLE', 'hardRules', '硬规则优先关系形成循环，请记录并解决冲突')
  if (cycles(new Map(doc.records.map(r => [r.id, r.ruleRefs])))) add('RULE_CYCLE', 'records', '规则引用形成循环')
  // Retain legacy question metadata for roundtrips; it has no active validation or reference role.
  if (Object.keys(doc.extensions).length) add('EXTENSIONS', 'extensions', '保留了扩展数据；发布前请核对其语义与归属', false)
  return issues
}
/** Every projection retains epistemic and historical labels; it never promotes rumors. */
export function worldSummary(doc: WorldDocument): string {
  const name = (id: string) => doc.records.find(r => r.id === id)?.name || '引用已失效'
  const scope = (r: WorldRecord) => `${r.scope.mode === 'global' ? '全局默认' : r.scope.mode === 'local' ? '局部适用' : '尚未确定'}；时期：${r.scope.time || '待定'}；地点：${r.scope.place || '未限定'}；对象：${r.scope.subjects || '未限定'}；附加条件：${r.scope.conditions || '未填写'}`
  const lines = [`# ${doc.name}`, doc.description, `时代：${doc.era || '待定'}；空间：${doc.space || '待定'}`]
  const ordered = (nodes: SettingNode[]): WorldRecord[] => nodes.flatMap(node => [node.record, ...ordered(node.children)])
  lines.push('\n## 设定目录')
  {
    const records = ordered(settingTree(doc))
    for (const r of records) lines.push(`### ${recordPath(doc, r.id)} [${r.confirmation === 'confirmed' ? '已确认' : '待定'} · ${r.truth === 'rumor' ? r.confirmation === 'confirmed' ? '传闻（仅确认说法存在）' : '传闻（说法存在仍待确认）' : '客观设定'} · ${r.validity === 'expired' ? '已失效' : '有效'}]`, r.description,
      `规则：${r.rule || '未填写'}；引用规则：${r.ruleRefs.map(name).join('、') || '无'}`,
      `条件：${r.conditions || '未填写'}；代价：${r.cost || '未填写'}；适用范围：${scope(r)}`,
      ...(r.truth === 'rumor' ? [`传闻背景：${r.rumor.spreaders}在${r.rumor.period}于${r.rumor.range}传播；真实性：${r.rumor.veracity === 'unknown' ? '未知' : r.rumor.veracity === 'true' ? '作者注明为真' : '作者注明为假'}`] : []),
      ...(r.validity === 'expired' ? [`失效原因：${r.expiryReason}`] : []), `来源：${r.origin === 'author' ? '作者原创' : r.origin === 'reference' ? '现实参考' : '模型候选'} ${[r.source.citation,r.source.locator,r.source.period].filter(Boolean).join(' · ')}`)
  }
  if (doc.hardRules.length) lines.push('\n## 世界硬规则', ...doc.hardRules.map(h => `${name(h.ruleId)}；例外：${h.exceptions}；优先于：${h.priorityOver.map(name).join('、') || '无'}`))
  if (doc.relations.length) lines.push('\n## 关联关系', ...doc.relations.map(r => `${name(r.from)} — ${r.type} → ${name(r.to)}；时期：${r.period || '未填写'}；条件：${r.condition || '未填写'}；来源：${r.source || '未填写'}`))
  if (doc.terms.length) lines.push('\n## 术语与别名', ...doc.terms.map(t => `${t.name} → ${name(t.targetId)}；语境：${t.context || '未限定'}；时期：${t.period || '未填写'}`))
  lines.push('\n## 未决限制', ...validateWorld(doc).map(i => `- ${i.message}`))
  return lines.join('\n\n')
}
