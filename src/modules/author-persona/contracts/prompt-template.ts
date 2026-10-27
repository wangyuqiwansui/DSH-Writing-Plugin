/** One shared template contract for editing, importing, publication and consumers. */
export const PROMPT_TEMPLATE_ID = 'author-persona-prompt-v1' as const
export const PROMPT_MAX_CODEPOINTS = 50_000
export const PROMPT_SECTIONS = [
  { id: 'stance', title: '叙事立场' }, { id: 'voice', title: '语言风格' }, { id: 'rhythm', title: '叙事节奏' },
  { id: 'dialogue', title: '对话习惯' }, { id: 'avoid', title: '表达边界' },
] as const
export interface PromptIssue { code: string; path: string; message: string; blocking: boolean }
export const codePoints = (value: string) => Array.from(value).length
export function promptTemplate(values: Partial<Record<typeof PROMPT_SECTIONS[number]['id'], string>> = {}): string {
  return PROMPT_SECTIONS.map(s => `## ${s.title}\n${values[s.id]?.trim() ? values[s.id] : `{{${s.title}}}`}`).join('\n\n') + '\n'
}
export function validatePromptTemplate(prompt: string): PromptIssue[] {
  const issues: PromptIssue[] = []
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message, blocking: true })
  if (codePoints(prompt) > PROMPT_MAX_CODEPOINTS) add('PROMPT_TOO_LARGE', 'prompt', `Prompt 超过 ${PROMPT_MAX_CODEPOINTS.toLocaleString('en-US')} 字符的输入安全上限；系统不会截断`)
  // A heading quoted inside a fenced example is content, not a template section.
  const sections: { title: string; text: string[] }[] = []
  let fence: { marker: string; length: number } | null = null
  const visible = prompt.replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\r\n]/g, ''))
  for (const line of visible.split(/\r?\n/)) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (delimiter) {
      const marker = delimiter[1]![0]!, length = delimiter[1]!.length
      if (!fence) fence = { marker, length }
      else if (marker === fence.marker && length >= fence.length && !delimiter[2]!.trim()) fence = null
      sections.at(-1)?.text.push(line); continue
    }
    const heading = !fence && line.match(/^ {0,3}##[ \t]+(.+?)[ \t]*#*[ \t]*$/)
    if (heading) sections.push({ title: heading[1]!.trim(), text: [] })
    else sections.at(-1)?.text.push(line)
  }
  let previous = -1
  for (const section of PROMPT_SECTIONS) {
    const matches = sections.map((s, i) => ({ ...s, index: i })).filter(s => s.title === section.title)
    const path = `prompt.${section.id}`
    if (!matches.length) { add('PROMPT_SECTION_REQUIRED', path, `缺少“## ${section.title}”段落`); continue }
    if (matches.length > 1) add('PROMPT_SECTION_DUPLICATE', path, `“${section.title}”段落重复，请合并`)
    const current = matches[0]!, body = current.text.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim()
    if (!body) add('PROMPT_SECTION_EMPTY', path, `请填写“${section.title}”的具体要求`)
    else if (/\{\{[^}]*\}\}|^(?:TODO|待填写|待补充)[。.!！]?$/i.test(body)) add('PROMPT_PLACEHOLDER', path, `请替换“${section.title}”中的模板占位内容`)
    if (current.index < previous) add('PROMPT_SECTION_ORDER', path, '模板段落顺序应为：叙事立场、语言风格、叙事节奏、对话习惯、表达边界')
    previous = current.index
  }
  if (fence) add('PROMPT_UNCLOSED_FENCE', 'prompt', 'Prompt 中存在未闭合的代码块')
  return issues
}
