import { type DocumentKind, type Fields, type NovelIssue, moduleForKind } from '../contracts/index.js'

export interface FieldDefinition { key: string; label: string; group: string; required?: boolean; type?: 'text' | 'number' | 'select' | 'characters'; options?: string[]; hint?: string }
const f = (key: string, label: string, group: string, required = true, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({ key, label, group, required, ...extra })
const title = f('title', '标题', '基本信息', true, { type: 'text' })
const narrative = f('narrative', '可读剧情', '剧情展开', true, { hint: '写清起因、行动、阻碍、转折、代价和结果。' })
const entry = f('entryState', '入口状态', '状态交接')
const exit = f('exitState', '出口状态', '状态交接')
const characters = f('characterIds', '出场角色', '角色与规则', false, { type: 'characters' })
const analysis = f('analysis', '人工检查记录', '检查与未决项', true, { hint: '记录因果、动机、世界规则与交接检查的依据；这里不会自动进行语义评审。' })
const unresolved = f('unresolved', '未决项', '检查与未决项', false, { hint: '记录问题、影响范围及解决时点；关键问题解决后再确认。' })
const eventList = f('events', '事件清单', '事件追踪', true, { hint: '每行一项：稳定事件 ID | 事件内容。例如 e1 | 主角发现线索。' })
const sourceEvents = f('sourceEventIds', '承接上游事件 ID', '事件追踪', true, { hint: '逗号或换行分隔，必须引用直接上游事件。' })
export const FIELDS: Record<Exclude<DocumentKind, 'assets'>, FieldDefinition[]> = {
  settings: [
    f('title', '书名', '作品定位', true, { type: 'text' }), f('genre', '题材', '作品定位', true, { type: 'text' }), f('audience', '目标读者', '作品定位', true, { type: 'text' }), f('tags', '标签', '作品定位', false, { type: 'text' }),
    f('premise', '一句话前提', '作品定位'), f('sellingPoint', '核心卖点', '作品定位'), f('theme', '主题 / 核心问题', '作品定位'), f('readingReference', '阅读感参考', '作品定位', false),
    f('styleMode', '风格模式', '叙事要求', true, { type: 'text' }), f('tone', '基调', '叙事要求', true, { type: 'text' }), f('pace', '节奏偏好', '叙事要求', true, { type: 'text' }), f('emotion', '情绪强度', '叙事要求', true, { type: 'text' }),
    f('pov', '叙事视角', '叙事要求', true, { type: 'select', options: ['第一人称', '第三人称', '混合视角'] }), f('povRules', '视角切换规则', '叙事要求'),
    f('mode', '篇幅策略', '规模与收束', true, { type: 'select', options: ['完结', '连载'] }), f('minWords', '单章最少字数', '规模与收束', true, { type: 'number' }), f('maxWords', '单章最多字数', '规模与收束', true, { type: 'number' }), f('expectedChapters', '预计总章数', '规模与收束', false, { type: 'number', hint: '连载可留空。' }), f('ending', '结局方向 / 阶段收束', '规模与收束'),
    f('start', '故事起点', '约束与未决项', true, { hint: '时代、地点及主角处境。' }), f('mustKeep', '必须保留', '约束与未决项', true, { hint: '没有额外要求时填写“无额外约束”。' }), f('forbidden', '禁止事项', '约束与未决项'), f('freedom', 'AI 自由度', '约束与未决项'), unresolved,
  ],
  outline: [title, f('synopsis', '故事梗概', '全书方向'), f('theme', '主题', '全书方向'), f('promise', '读者承诺', '全书方向'), f('causality', '主线因果', '全书方向'), f('opposition', '主要对抗', '全书方向'), f('turns', '关键转折', '全书方向'), f('ending', '结局 / 阶段收束', '全书方向'), characters, analysis, unresolved],
  volume: [title, narrative, f('goal', '本卷目标', '剧情展开'), f('reason', '分卷理由', '剧情展开'), entry, exit, f('handoff', '下一卷承接', '状态交接'), eventList, characters, f('rules', '相关世界规则', '角色与规则'), f('payoff', '兑现与遗留', '剧情展开'), analysis, unresolved],
  unit: [title, narrative, f('goal', '单元目标', '剧情展开'), f('conflict', '核心冲突', '剧情展开'), f('purpose', '剧情作用与拆分理由', '剧情展开'), entry, exit, f('handoff', '下一单元承接', '状态交接'), sourceEvents, eventList, characters, f('rules', '相关世界规则', '角色与规则'), f('foreshadowing', '伏笔与信息揭示', '剧情展开', false), analysis, unresolved],
  chapter: [title, f('chapterPlot', '逐章剧情', '逐章剧情', true, { hint: '本章发生什么、人物如何选择、局面如何改变。此处直接交给正文。' }), f('goal', '本章目标', '逐章剧情'), sourceEvents, f('eventRoles', '事件片段职责', '事件追踪', true, { hint: '说明本章承担事件的哪一部分，避免重复兑现。' }), entry, exit, f('handoff', '下一章承接', '状态交接'), { ...characters, required: true }, f('motivation', '行动动机与知情范围', '角色与规则'), f('pov', '本章视角', '场景与表达', true, { type: 'text' }), f('time', '时间锚点', '场景与表达', true, { type: 'text' }), f('location', '地点', '场景与表达', true, { type: 'text' }), f('scenes', '场景顺序', '场景与表达'), f('withheld', '禁止提前揭示', '场景与表达', false), f('minWords', '单章最少字数', '场景与表达', false, { type: 'number' }), f('maxWords', '单章最多字数', '场景与表达', false, { type: 'number' }), analysis, unresolved],
  body: [title, f('text', '正文内容', '正文'), f('notes', '修订备注', '修订', false)],
  character: [f('title', '姓名', '人物身份', true, { type: 'text' }), f('aliases', '别名', '人物身份', false, { type: 'text' }), f('appearance', '外貌', '人物档案', false), f('background', '背景', '人物档案'), f('personality', '性格', '人物档案'), f('goal', '目标', '人物档案'), f('motivation', '动机', '人物档案'), f('abilities', '能力与边界', '人物档案'), f('voice', '语言习惯', '人物档案', false), f('initialState', '初始状态', '初始事实', true, { hint: '创作开始前的位置、持有物、关系与知情范围。剧情计划不会写入这里。' }), f('relationships', '初始关系', '初始事实', false), unresolved],
}
export function blankFields(kind: DocumentKind): Fields {
  return Object.fromEntries(kind === 'assets' ? ['title', 'personaId', 'worldId', 'referenceIds'].map(k => [k, '']) : FIELDS[kind].map(f => [f.key, '']))
}
export function validateFields(kind: DocumentKind, data: Fields, strict: boolean): NovelIssue[] {
  const issues: NovelIssue[] = [], module = moduleForKind[kind]
  const add = (key: string, message: string) => issues.push({ code: 'INVALID_FIELD', field: key, message, module })
  const allowed = Object.keys(blankFields(kind))
  for (const [key, value] of Object.entries(data)) if (!allowed.includes(key) || typeof value !== 'string' || value.length > 500_000) add(key, `字段 ${key} 无效或过长`)
  if (kind === 'assets') return issues
  for (const field of FIELDS[kind]) {
    const value = data[field.key] ?? ''
    if (typeof value !== 'string') continue
    if (strict && field.required && !value.trim()) add(field.key, `请填写${field.label}`)
    if (value && field.type === 'number' && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0)) add(field.key, `${field.label}必须是正整数`)
    if (value && field.options && !field.options.includes(value)) add(field.key, `${field.label}选项无效`)
  }
  if ((data.minWords || data.maxWords) && (!data.minWords || !data.maxWords || Number(data.minWords) > Number(data.maxWords))) add('maxWords', '请填写完整且从小到大的字数区间')
  if (strict && data.unresolved?.trim()) add('unresolved', '请先处理未决项并清空此字段，再确认当前版本')
  return issues
}
