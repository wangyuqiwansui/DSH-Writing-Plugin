import type { EntryType } from '../contracts/index.js'

/** Writing guidance only: never copied into saved content or mandatory fields. */
export const entryTemplates: Record<EntryType, { use: string; prompt: string; optional: string; boundary: string }> = {
  power: { use: '能力、武学或特殊技术影响行动时使用；现实题材可留空。',
    prompt: '它能做什么、不能做什么？涉及门槛、代价或例外时一起写清。',
    optional: '按需补充：获取条件、当前剧情涉及的层次、代价、克制、环境限制。',
    boundary: '这里只定义力量规则；角色当前境界、体力与已掌握能力放在小说中。' },
  faction: { use: '组织、公司、宗门、家族等影响人物选择时使用。',
    prompt: '这是怎样的组织？它维护什么利益，凭什么影响故事？',
    optional: '按需补充：关键资源、行为边界、加入条件、对外关系、内部矛盾。',
    boundary: '稳定制度写在这里；临时计划、人物职位变化和当章交易结果放在小说中。' },
  place: { use: '地点反复出现，或空间与通行条件影响情节时使用。',
    prompt: '这是什么地方？人物能在这里做什么，有什么关键特征？',
    optional: '按需补充：相对位置、入口、通行条件、距离、危险、实际使用的子地点。',
    boundary: '保留稳定布局；角色当前位置、临时天气和本章现场变化放在小说中。' },
  item: { use: '独特、稀缺或反复使用的物品，以及重要线索。',
    prompt: '它有什么用途或剧情价值？使用时有哪些重要限制？',
    optional: '按需补充：使用方式、次数规则、副作用、取得条件、识别特征。',
    boundary: '这里保存物品定义；当前持有人、剩余次数、损坏与藏匿位置放在小说中。' },
  history: { use: '过去事件解释当前冲突、制度、身份或谜团时使用。',
    prompt: '过去发生了什么？它给当前故事留下什么影响？',
    optional: '按需补充：相对时间、参与对象、遗留线索、流传说法和相关旧规则。',
    boundary: '历史事件与数据历史版本不同；未来计划、角色何时得知和揭密安排放在小说中。' },
}
