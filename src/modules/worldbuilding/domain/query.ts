import { recordPath } from './tree.js'
import type { VersionRef } from '../../../shared/contracts/index.js'
import type { WorldDocument, WorldQuery, WorldQueryResult, WorldRecord } from '../contracts/index.js'
import { ensure, exact, identity, integer, text, worldSummary } from './world.js'

const normal = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-CN').trim()
const count = (value: string) => Array.from(value).length

export function parseWorldQuery(raw: unknown): WorldQuery {
  const q = exact(raw, ['text', 'recordIds', 'maxCharacters', 'maxRecords'])
  text(q.text, 600); integer(q.maxCharacters); integer(q.maxRecords)
  ensure(Number(q.maxCharacters) >= 200 && Number(q.maxCharacters) <= 100_000, '材料长度须在 200 至 100000 字符之间')
  ensure(Number(q.maxRecords) >= 1 && Number(q.maxRecords) <= 100, '材料条目上限须在 1 至 100 之间')
  ensure(Array.isArray(q.recordIds) && q.recordIds.length <= 100, '指定条目过多')
  const recordIds = q.recordIds.map(identity)
  ensure(new Set(recordIds).size === recordIds.length, '指定条目重复')
  return { text: String(q.text).trim(), recordIds, maxCharacters: Number(q.maxCharacters), maxRecords: Number(q.maxRecords) }
}

/** Deterministic, bounded author-planning projection. No I/O, model calls or world mutations. */
export function queryWorld(doc: WorldDocument, sourceVersion: VersionRef, raw: WorldQuery, signal?: AbortSignal): WorldQueryResult {
  const q = parseWorldQuery(raw), needle = normal(q.text)
  const records = new Map(doc.records.map(r => [r.id, r]))
  const result: WorldQueryResult = {
    schemaVersion: 'writing-world-context-v1', purpose: 'author_planning', sourceVersion,
    complete: true, scopeReviewRequired: true, text: '', characters: 0, entries: [], ambiguities: [], issues: [], omittedCount: 0,
  }
  const issue = (code: string, message: string, incomplete = true) => {
    if (!result.issues.some(i => i.code === code && i.message === message)) result.issues.push({ code, message })
    if (incomplete) result.complete = false
  }
  const reasons = new Map<string, Set<string>>()
  const reason = (id: string, value: string) => { const values = reasons.get(id) ?? new Set<string>(); values.add(value); reasons.set(id, values) }
  const names = new Map<string, Set<string>>()
  const addName = (name: string, id: string) => {
    const n = normal(name); if (!n || records.get(id)?.confirmation !== 'confirmed') return
    const values = names.get(n) ?? new Set<string>(); values.add(id); names.set(n, values)
  }
  for (const r of doc.records) addName(r.name, r.id)
  for (const t of doc.terms) addName(t.name, t.targetId)
  const ambiguousIds = new Set<string>()
  for (const [name, ids] of names) {
    if (ids.size < 2 || !needle || !(name === needle || (name.length >= 2 && needle.includes(name)))) continue
    const chosen = q.recordIds.filter(id => ids.has(id))
    if (!chosen.length) chosen.push(...[...ids].filter(id => normal(recordPath(doc, id)) === needle))
    if (chosen.length === 1) { for (const id of ids) if (id !== chosen[0]) ambiguousIds.add(id); continue }
    result.ambiguities.push({ term: name, candidates: [...ids].map(id => ({
      id, name: records.get(id)!.name,
      context: doc.terms.filter(t => t.targetId === id && normal(t.name) === name).map(t => [t.context, t.period].filter(Boolean).join('；')).join(' / ') || records.get(id)!.scope.place,
    })) })
    for (const id of ids) ambiguousIds.add(id)
    issue('AMBIGUOUS_NAME', '同名条目需要明确选择：' + name)
  }
  const closure = (roots: string[]): Set<string> | null => {
    const selected = new Set<string>(), visiting = new Set<string>()
    const visit = (id: string, dependency = false): boolean => {
      signal?.throwIfAborted()
      if (visiting.has(id)) { issue('RULE_CYCLE', '必要规则存在循环引用'); return false }
      if (selected.has(id)) return true
      const r = records.get(id)
      if (!r) { issue('MISSING_RECORD', '所需条目不存在：' + id); return false }
      if (r.confirmation !== 'confirmed' || (dependency && (r.truth !== 'fact' || r.kind !== 'rule'))) {
        issue('UNCONFIRMED_RECORD', '所需条目尚未确认为可用设定：' + r.name); return false
      }
      visiting.add(id)
      for (const next of r.ruleRefs) { reason(next, '必要规则'); if (!visit(next, true)) return false }
      const hard = doc.hardRules.find(h => h.ruleId === id)
      if (hard) for (const next of hard.priorityOver) { reason(next, '规则优先关系'); if (!visit(next, true)) return false }
      visiting.delete(id); selected.add(id); return true
    }
    return roots.every(id => visit(id, doc.hardRules.some(h => h.ruleId === id))) ? selected : null
  }
  const render = (ids: Set<string>) => {
    const subset: WorldDocument = { ...doc,
      records: doc.records.filter(r => ids.has(r.id)),
      hardRules: doc.hardRules.filter(h => ids.has(h.ruleId)),
      relations: doc.relations.filter(r => ids.has(r.from) && ids.has(r.to)),
      terms: doc.terms.filter(t => ids.has(t.targetId)),
      questions: [], extensions: {},
    }
    const sourceLines = subset.records.map(r => r.id + '：' + recordPath(doc, r.id)).join('\n')
    return worldSummary(subset) + (sourceLines ? '\n\n## 来源条目\n' + sourceLines : '')
  }
  const fits = (ids: Set<string>) => ids.size <= q.maxRecords && count(render(ids)) <= q.maxCharacters
  const required = [...doc.hardRules.map(h => { reason(h.ruleId, '世界硬规则'); return h.ruleId }), ...q.recordIds.map(id => { reason(id, '明确指定'); return id })]
  const initial = closure(required)
  if (!initial) return result
  let selected: Set<string> = initial
  if (!fits(selected)) {
    issue('REQUIRED_BUDGET', '核心设定和必要规则超过材料预算，请增加预算或缩小任务；未截断规则。')
    return result
  }
  const terms = needle.split(/[\s，,。；;、！？!?]+/u).filter(Boolean).slice(0, 24)
  const score = (r: WorldRecord) => {
    if (!needle || r.confirmation !== 'confirmed' || ambiguousIds.has(r.id)) return 0
    if (normal(recordPath(doc, r.id)) === needle) return 110
    const aliases = [r.name, ...doc.terms.filter(t => t.targetId === r.id).map(t => t.name)].map(normal)
    if (aliases.some(a => a === needle)) return 100
    if (aliases.some(a => a.length >= 2 && needle.includes(a))) return 80
    if (aliases.some(a => a.includes(needle))) return 60
    const body = normal([recordPath(doc, r.id), r.name, r.description, r.rule, r.conditions, r.cost, ...Object.values(r.scope)].join(' '))
    return terms.filter(t => body.includes(t)).length * 10
  }
  const hits = doc.records.map(r => ({ r, score: score(r) })).filter(v => v.score > 0).sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id))
  if (needle && !hits.length && !q.recordIds.length && !result.ambiguities.length) issue('NO_MATCH', '未找到匹配的已确认设定；仅提供核心与硬规则。')
  for (const { r } of hits) {
    signal?.throwIfAborted(); reason(r.id, '名称、别名或正文匹配')
    if (selected.has(r.id)) continue
    const needed = closure([r.id])
    if (!needed) { result.omittedCount++; continue }
    const combined: Set<string> = new Set([...selected, ...needed])
    if (!fits(combined)) { result.omittedCount++; continue }
    selected = combined
  }
  // One-hop background expansion; its own rule closure is still indivisible.
  const direct = new Set([...q.recordIds, ...hits.map(h => h.r.id)].filter(id => selected!.has(id)))
  for (const relation of doc.relations) {
    signal?.throwIfAborted()
    const target = direct.has(relation.from) ? relation.to : direct.has(relation.to) ? relation.from : null
    if (!target || selected.has(target) || ambiguousIds.has(target) || records.get(target)?.confirmation !== 'confirmed') continue
    const needed = closure([target]); if (!needed) { result.omittedCount++; continue }
    const combined = new Set([...selected, ...needed])
    if (!fits(combined)) { result.omittedCount++; continue }
    reason(target, '直接关联'); selected = combined
  }
  if (result.omittedCount) issue('OPTIONAL_BUDGET', '部分匹配或关联条目未能完整加入，请细化查询或增加预算。')
  result.text = render(selected); result.characters = count(result.text)
  result.entries = doc.records.filter(r => selected!.has(r.id)).map(r => ({ id: r.id, name: r.name, ...(r.entryType ? { entryType: r.entryType } : {}), reasons: [...(reasons.get(r.id) ?? ['必要关联'])] }))
  issue('AUTHOR_REVIEW', '这是作者规划材料；时期、局部范围及人物知情尚需审阅，不能直接视为角色已知事实。', false)
  if (doc.records.some(r => selected!.has(r.id) && r.validity === 'expired')) issue('HISTORICAL_SCOPE', '包含已失效设定，请核对场景是否处于其原适用时期。', false)
  signal?.throwIfAborted()
  return result
}
