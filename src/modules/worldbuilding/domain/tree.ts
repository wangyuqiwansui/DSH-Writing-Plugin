import type { WorldDocument, WorldRecord } from '../contracts/index.js'

export function recordPath(doc: WorldDocument, id: string, ids = false): string {
  const parts: string[] = [], seen = new Set<string>()
  const records = new Map(doc.records.map(r => [r.id, r]))
  let current = records.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id); parts.unshift(ids ? current.id : current.name || '未命名设定')
    current = current.parentId ? records.get(current.parentId) : undefined
  }
  return parts.join(ids ? '/' : ' / ')
}
export interface SettingNode { record: WorldRecord; children: SettingNode[] }
export function settingTree(doc: WorldDocument): SettingNode[] {
  const nodes = new Map(doc.records.map(record => [record.id, { record, children: [] } as SettingNode]))
  const roots: SettingNode[] = []
  for (const node of nodes.values()) {
    const parent = node.record.parentId ? nodes.get(node.record.parentId) : undefined
    if (parent) parent.children.push(node); else roots.push(node)
  }
  return roots
}
