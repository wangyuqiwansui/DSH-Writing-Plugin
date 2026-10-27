export const NOVEL_SCHEMA = 'writing-novel-memory-v1' as const
export const MODULES = [
  { id: 'assets', title: '资产配置', caption: '绑定创作基石', step: '01' },
  { id: 'settings', title: '小说设定', caption: '定义作品方向', step: '02' },
  { id: 'outline', title: '总纲', caption: '主线与分卷剧情', step: '03' },
  { id: 'units', title: '单元规划', caption: '组织完整剧情', step: '04' },
  { id: 'chapters', title: '章节规划', caption: '分配逐章剧情', step: '05' },
  { id: 'body', title: '正文', caption: '专注每一章', step: '06' },
  { id: 'characters', title: '角色库', caption: '独立管理人物', step: null },
] as const
export type NovelModule = typeof MODULES[number]['id']
export type DocumentKind = 'assets' | 'settings' | 'outline' | 'volume' | 'unit' | 'chapter' | 'body' | 'character'
export type AssetKind = 'persona' | 'world' | 'reference'
export type BusinessStatus = 'draft' | 'candidate' | 'confirmed' | 'rejected' | 'revoked'
export type Fields = Record<string, string>
export interface SourceRef {
  type: 'asset' | 'document'; objectId: string; revision: number; contentHash: string
  purpose: 'story_fact' | 'writing_style' | 'reference'
}
export interface Confirmation { revision: number; contentHash: string; sourceRefs: SourceRef[]; confirmedAt: string; actor: 'author' }
export interface NovelRevision {
  schemaVersion: typeof NOVEL_SCHEMA; revision: number; fields: Fields; contentHash: string
  sourceRefs: SourceRef[]; status: BusinessStatus; origin: 'manual' | 'import'; createdAt: string
  confirmation?: Confirmation
}
export interface NovelDocument {
  id: string; projectId: string; kind: DocumentKind; parentId: string | null; order: number
  revisions: NovelRevision[]; confirmedRevision: number | null; createdAt: string; updatedAt: string
}
export interface NovelAsset { id: string; kind: AssetKind; name: string; content: string; revision: number; contentHash: string; available: boolean; sourceVersion?: import('../../../shared/contracts/index.js').VersionRef }
export interface NovelProject { id: string; title: string; createdAt: string }
export interface NovelWorkspace { projects: NovelProject[]; assets: NovelAsset[]; documents: NovelDocument[] }
export interface NovelIssue { code: string; message: string; field?: string; targetId?: string; module: NovelModule }
export interface SaveDocument {
  projectId: string; id?: string; kind: DocumentKind; parentId: string | null
  expectedRevision: number; fields: Fields; origin?: 'manual' | 'import'
}
export interface NovelDraft { kind: DocumentKind; id?: string; parentId: string | null; expectedRevision: number; fields: Fields; dirty: boolean }
export const moduleForKind: Record<DocumentKind, NovelModule> = {
  assets: 'assets', settings: 'settings', outline: 'outline', volume: 'outline', unit: 'units', chapter: 'chapters', body: 'body', character: 'characters',
}
export const kindLabels: Record<DocumentKind, string> = {
  assets: '资产绑定', settings: '小说设定', outline: '全书总纲', volume: '卷剧情', unit: '单元', chapter: '章节剧情', body: '正文', character: '角色档案',
}
export const statusLabels: Record<BusinessStatus, string> = { draft: '草稿', candidate: '候选', confirmed: '已确认', rejected: '已拒绝', revoked: '已撤销' }
export const latest = (doc: NovelDocument): NovelRevision => doc.revisions[doc.revisions.length - 1]!
export const authority = (doc: NovelDocument): NovelRevision | undefined => doc.revisions.find(r => r.revision === doc.confirmedRevision && r.status === 'confirmed')
export const splitIds = (value = ''): string[] => [...new Set(value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean))]
export const events = (value = ''): { id: string; text: string }[] => value.split('\n').filter(s => s.trim()).map(line => {
  const [id, ...text] = line.split('|'); return { id: id!.trim(), text: text.join('|').trim() }
})
