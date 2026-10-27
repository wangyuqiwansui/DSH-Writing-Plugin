import { requireValue } from '../../shared/contracts/index.js'
import { choice, integer, record, text, type Check, type Mode, type RuleVersion, type Span, type TargetContent } from './contracts.js'

export function spanAt(source: string, start: number, length: number): Span {
  return { unit: 'unicode_code_point', start: [...source.slice(0, start)].length, endExclusive: [...source.slice(0, start + length)].length, quote: source.slice(start, start + length) }
}
export function validateSpan(value: unknown, source: string): Span {
  const v = record(value, ['unit', 'start', 'endExclusive', 'quote']), points = [...source]
  requireValue(v.unit === 'unicode_code_point', 'INVALID_INPUT', '证据坐标须为 Unicode 码点')
  integer(v.start, 0, points.length); integer(v.endExclusive, Number(v.start) + 1, points.length)
  text(v.quote, '证据原文', 4000)
  requireValue(points.slice(Number(v.start), Number(v.endExclusive)).join('') === v.quote, 'VERSION_MISMATCH', '证据原文与目标版本不匹配')
  return v as unknown as Span
}
export function deterministicChecks(target: TargetContent, rules: RuleVersion[], mode: Mode): Check[] {
  const source = target.text, checks: Check[] = []
  const basic = (id: string, title: string, message: string, evidence: Span[], status: Check['status'], pollution = false) => checks.push({ id: `builtin:${id}`, title, message, evidence, status: mode === 'semantic' ? 'needs_review' : status, type: 'deterministic', rule: null, pollution })
  basic('nonempty', '内容完整性', source.trim() ? '原始版本非空。' : '原始版本为空，无法完成内容检测。', [], source.trim() ? 'clear' : 'issue')
  const invalid = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/gu
  const invalidSpans = [...source.matchAll(invalid)].slice(0, 30).map(match => spanAt(source, match.index!, match[0].length))
  basic('unicode', '异常字符', invalidSpans.length ? '发现控制字符或替换字符，请核对原文。' : '未发现异常控制字符或替换字符。', invalidSpans, invalidSpans.length ? 'issue' : 'clear')
  const wrapper = /(^\s*```[^\r\n]*|```\s*$)/gu
  const wrappers = target.dimension === 'body' ? [...source.matchAll(wrapper)].slice(0, 10).map(match => spanAt(source, match.index!, match[0].length)) : []
  basic('format', '输出格式', target.dimension === 'body' && target.format === 'json' ? '正文以 JSON 保存，需核对正文提取约定；此处检查保留原始 JSON。' : wrappers.length ? '正文包含外围代码围栏。' : '未发现外围格式包装。', wrappers,
    target.dimension === 'body' && target.format === 'json' ? 'needs_review' : wrappers.length ? 'issue' : 'clear')
  const residue = /<\/?(?:think|analysis)>/giu
  const residues = [...source.matchAll(residue)].slice(0, 20).map(match => spanAt(source, match.index!, match[0].length))
  basic('process', '过程文本残留', residues.length ? '原始输出包含显式推理标签，请核对是否混入过程文本。' : '未发现显式推理标签。', residues, residues.length ? 'issue' : 'clear', true)
  if (target.dimension === 'outline') {
    let structured = source.split(/\r?\n/).filter(line => line.trim()).length >= 2
    if (target.format === 'json') { const value = JSON.parse(source); structured = value !== null && typeof value === 'object' && Object.keys(value).length > 0 }
    basic('outline_structure', '大纲结构', structured ? '存在可读取的结构内容；叙事完整性须由语义规则判断。' : '未发现明确分段或结构，请人工核对大纲组织。', [], structured ? 'clear' : 'needs_review')
  }
  for (const rule of rules) {
    const base = { id: rule.versionId, title: rule.title, rule, type: rule.checkType, pollution: rule.checkType === 'observation' }
    if (rule.checkType === 'semantic') {
      checks.push({ ...base, status: 'needs_review', message: mode === 'deterministic' ? '本次仅执行机器检测，语义规则尚未检查。' : '等待语义检查。', evidence: [] }); continue
    }
    if (mode === 'semantic') { checks.push({ ...base, status: 'needs_review', message: '本次未选择机器检测。', evidence: [] }); continue }
    const index = source.indexOf(rule.literal), present = index >= 0
    const violated = rule.detector === 'forbidden_literal' ? present : !present
    const evidence = present ? [spanAt(source, index, rule.literal.length)] : []
    checks.push({ ...base, status: violated ? rule.checkType === 'observation' ? 'needs_review' : 'issue' : 'clear',
      message: violated ? rule.detector === 'required_literal' ? `未找到要求的精确文本：${rule.literal}` : '命中指定的精确文本；不推断作者意图或 AI 概率。' : '精确文本检查通过。', evidence })
  }
  return checks
}
/** Every selected semantic rule needs exactly one result; invalid evidence fails the response. */
export function parseSemanticResponse(raw: string, checks: Check[], source: string): Check[] {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('模型返回不是有效 JSON，原始返回已保留；未自动重试。') }
  const parsed = record(value, ['checks'])
  requireValue(Array.isArray(parsed.checks), 'INVALID_INPUT', '语义返回缺少检查数组')
  const selected = checks.filter(check => check.type === 'semantic')
  requireValue(parsed.checks.length === selected.length, 'INVALID_INPUT', '语义返回未覆盖全部规则')
  const found = new Map<string, Check>()
  for (const item of parsed.checks) {
    const v = record(item, ['id', 'status', 'message', 'evidence'])
    text(v.id, '检查标识'); choice(v.status, ['clear', 'issue', 'needs_review', 'not_applicable']); text(v.message, '检查说明', 2000)
    const base = selected.find(check => check.id === v.id)
    requireValue(base && !found.has(v.id), 'INVALID_INPUT', '返回未知或重复的规则')
    requireValue(Array.isArray(v.evidence) && v.evidence.length <= 20, 'INVALID_INPUT', '证据数量无效')
    const evidence = v.evidence.map(value => validateSpan(value, source))
    requireValue(v.status !== 'issue' || evidence.length > 0, 'INVALID_INPUT', '语义问题须提供可核对的原文证据')
    found.set(v.id, { ...base, status: v.status, message: v.message, evidence })
  }
  return checks.map(check => found.get(check.id) ?? check)
}
export function verdict(checks: Check[]): 'passed' | 'issues_found' | 'needs_review' {
  if (checks.some(check => check.status === 'issue')) return 'issues_found'
  if (checks.some(check => check.status !== 'clear')) return 'needs_review'
  return 'passed'
}
