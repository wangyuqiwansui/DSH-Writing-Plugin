import { BRIEF_FIELDS, PERSONA_SCHEMA, LEGACY_PERSONA_SCHEMA, PROMPT_TEMPLATE_ID, PROMPT_MAX_CODEPOINTS, codePoints, promptTemplate, validatePromptTemplate, type LegacyPersonaDocument, type StoredPersonaDocument, type PersonaDocument, type PersonaIssue } from '../contracts/index.js'
export { codePoints } from '../contracts/index.js'

export class PersonaError extends Error {
  constructor(readonly code: string, message: string, readonly issues: PersonaIssue[] = []) { super(message) }
}
export function ensure(value: unknown, message: string, code = 'INVALID_INPUT'): asserts value {
  if (!value) throw new PersonaError(code, message)
}
export function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  ensure(value && typeof value === 'object' && !Array.isArray(value), '需要 JSON 对象')
  const result = value as Record<string, unknown>
  ensure(Object.keys(result).length === keys.length && keys.every(key => Object.hasOwn(result, key)), '字段缺失或包含未知字段')
  return result
}
export function identity(value: unknown): asserts value is string { ensure(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value), '标识无效') }
export function integer(value: unknown, min = 0): asserts value is number { ensure(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= 500, '版本号无效') }
function string(value: unknown, max: number, label: string): asserts value is string {
  ensure(typeof value === 'string' && codePoints(value) <= max && !/[\u0000\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value), `${label}内容无效或超过 ${max} 字符`)
}
export const briefLabels = { stance: '叙事立场', voice: '语言风格', rhythm: '叙事节奏', dialogue: '对话习惯', avoid: '表达禁忌' } as const
export function emptyPersona(): PersonaDocument {
  return { schemaVersion: PERSONA_SCHEMA, name: '', description: '', templateId: PROMPT_TEMPLATE_ID, prompt: promptTemplate(), sourceNote: '' }
}
export function parsePersona(raw: unknown): PersonaDocument {
  const v = exact(raw, ['schemaVersion', 'name', 'description', 'templateId', 'prompt', 'sourceNote'])
  ensure(v.schemaVersion === PERSONA_SCHEMA && v.templateId === PROMPT_TEMPLATE_ID, '人格必须使用统一 Prompt 模板；旧版请先转换为新草稿')
  string(v.name, 120, '名称'); string(v.description, 2000, '说明'); string(v.sourceNote, 2000, '来源备注'); string(v.prompt, PROMPT_MAX_CODEPOINTS, 'Prompt')
  return structuredClone(v) as unknown as PersonaDocument
}
export function parseStoredPersona(raw: unknown): StoredPersonaDocument {
  if (raw && typeof raw === 'object' && (raw as { schemaVersion?: unknown }).schemaVersion === PERSONA_SCHEMA) return parsePersona(raw)
  const v = exact(raw, ['schemaVersion', 'name', 'description', 'mode', 'brief', 'fullPrompt', 'sourceNote'])
  ensure(v.schemaVersion === LEGACY_PERSONA_SCHEMA, '人格格式不支持；OpenClaw 原始档案需显式转换，不能直接继承其审核状态')
  ensure(v.mode === 'brief' || v.mode === 'full_prompt', '人格模式无效')
  string(v.name, 120, '名称'); string(v.description, 2000, '说明'); string(v.sourceNote, 2000, '来源备注'); string(v.fullPrompt, 50_000, '完整文本')
  const brief = exact(v.brief, BRIEF_FIELDS)
  for (const field of BRIEF_FIELDS) string(brief[field], 2000, briefLabels[field])
  // Do not trim, normalize newlines, truncate, or execute the imported expression.
  return structuredClone(v) as unknown as LegacyPersonaDocument
}
export function toPromptDocument(document: StoredPersonaDocument): PersonaDocument {
  if (document.schemaVersion === PERSONA_SCHEMA) return parsePersona(document)
  return parsePersona({ schemaVersion: PERSONA_SCHEMA, name: document.name, description: document.description, sourceNote: document.sourceNote,
    templateId: PROMPT_TEMPLATE_ID, prompt: document.mode === 'brief' ? promptTemplate(document.brief) : document.fullPrompt })
}
export function expressionText(document: StoredPersonaDocument): string {
  if (document.schemaVersion === PERSONA_SCHEMA) return document.prompt
  return document.mode === 'full_prompt' ? document.fullPrompt : BRIEF_FIELDS.filter(key => document.brief[key].trim()).map(key => `${briefLabels[key]}：${document.brief[key]}`).join('\n')
}
export function validatePersona(document: PersonaDocument): PersonaIssue[] {
  const issues: PersonaIssue[] = validatePromptTemplate(document.prompt)
  if (!document.name.trim()) issues.push({ code: 'NAME_REQUIRED', path: 'name', message: '请填写人格名称', blocking: true })
  return issues
}
/** Export/import carries only a draft document, never a confirmation, identity or qualification. */
export function importPersona(text: string): PersonaDocument {
  ensure(new TextEncoder().encode(text).length <= 256_000, '导入文件超过 256 KB')
  return toPromptDocument(parseStoredPersona(JSON.parse(text.replace(/^\uFEFF/, ''))))
}
export function importPrompt(text: string, name: string): PersonaDocument {
  return parsePersona({ ...emptyPersona(), name, prompt: text, sourceNote: '从文本导入；未执行来源审核或写作实测' })
}
