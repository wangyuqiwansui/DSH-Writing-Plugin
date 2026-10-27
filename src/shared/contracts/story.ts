import { canonicalJson, nonempty, requireValue, type CommandEnvelope, type ExpectedHead, type JsonValue, type TaskResult, type VersionRef } from './index.js'

export const STORY_CONTRACT = 'writing-story-v1' as const
export const ENTITY_KINDS = ['character', 'asset', 'location', 'faction', 'relationship'] as const
export type EntityKind = typeof ENTITY_KINDS[number]
export interface StoryEntity { id: string; key: string; kind: EntityKind; displayName: string }
export interface StoryProject { id: string; title: string; status: 'active' | 'archived' }
export interface ProjectSetup { title: string; genre: string; audience: string; premise: string; worldRules: string; constraints: string }
export interface StoryResource { title: string; category: 'world' | 'author_style' | 'reference'; content: string; provenance: string }
export interface EntityProfile {
  displayName: string; aliases: string[]; description: string; attributes: { [key: string]: JsonValue }
  relationships: { entityId: string; relation: string; details: string }[]
}
export interface EntityState {
  basis: 'initial'; fromChapter: number; throughChapter: number | null
  summary: string; facts: { [key: string]: JsonValue }
}
export interface StoryDocument {
  contractVersion: typeof STORY_CONTRACT; subject: string
  data: JsonValue; dependencies: ExpectedHead[]; origin: 'manual' | 'execution'
}
export interface StoryView {
  ref: VersionRef; data: JsonValue; status: 'candidate' | 'confirmed' | 'rejected' | 'revoked' | 'stale'
  dependencies: ExpectedHead[]
}
export interface StorySnapshot {
  contractVersion: typeof STORY_CONTRACT; projectId: string; chapter: number
  project: StoryView | null
  resourceLibrary: { key: string; resource: StoryView }[]
  resources: { key: string; binding: VersionRef; purpose: 'story_fact' | 'writing_style' | 'reference'; resource: StoryView }[]
  entities: { identity: StoryEntity; profile: StoryView | null; state: StoryView | null }[]
  heads: ExpectedHead[]; ready: boolean; blockers: TaskResult['blockers']
}
export interface StoryResult extends TaskResult {
  status: 'candidate' | 'confirmed' | 'saved' | 'blocked' | 'cancelled'
  entityId: string | null; taskId: string | null
}
export interface StoryStorageSnapshot {
  getProject(): StoryProject | null
  listHeads(prefix: string): import('./index.js').Head[]
  getEntity(id: string): StoryEntity
  listEntities(): StoryEntity[]
}
export interface StoryStorageTransaction {
  createEntity(key: string, kind: EntityKind, displayName: string): StoryEntity
  setProjectTitle(title: string): void
}
export interface WritingStory {
  listProjects(signal?: AbortSignal): StoryProject[]
  listGenerations(projectId: string, signal?: AbortSignal): { taskId: string; entityId: string; snapshot: VersionRef; result: StoryResult }[]
  createProject(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  reviseProject(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  reviseResource(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  bindResource(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  unbindResource(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  createEntity(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  reviseEntity(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  reviseState(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  confirm(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  reject(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  revoke(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  snapshot(projectId: string, chapter: number, signal?: AbortSignal): StorySnapshot
  prepareSnapshot(command: CommandEnvelope, signal?: AbortSignal): StoryResult
  generateEntity(command: CommandEnvelope, signal?: AbortSignal): Promise<StoryResult>
  resumeGeneration(projectId: string, taskId: string, signal?: AbortSignal): Promise<StoryResult>
  inspectGeneration(projectId: string, taskId: string): StoryResult
  retryGeneration(command: CommandEnvelope, signal?: AbortSignal): Promise<StoryResult>
  cancelGeneration(command: CommandEnvelope): Promise<StoryResult>
}
export function storyObject(value: unknown): Record<string, unknown> {
  const data = JSON.parse(canonicalJson(value)) as unknown
  requireValue(data !== null && typeof data === 'object' && !Array.isArray(data), 'INVALID_INPUT', 'Expected a story object')
  return data as Record<string, unknown>
}
export function storyKey(value: unknown): string {
  nonempty(value, 'key'); requireValue(value.length <= 120 && /^[\p{L}\p{N}_-]+$/u.test(value), 'INVALID_INPUT', 'Key must use letters, numbers, underscore or hyphen')
  return value
}
export function chapterRange(from: unknown, through: unknown) {
  requireValue(Number.isSafeInteger(from) && Number(from) > 0, 'INVALID_INPUT', 'Chapter starts at 1')
  requireValue(through === null || (Number.isSafeInteger(through) && Number(through) >= Number(from)), 'INVALID_INPUT', 'Invalid chapter range')
}
function strings(data: Record<string, unknown>, fields: string[], nonEmpty: string[]) {
  for (const field of fields) requireValue(typeof data[field] === 'string', 'INVALID_INPUT', field + ' must be text')
  for (const field of nonEmpty) nonempty(data[field], field)
}
function exact(data: Record<string, unknown>, fields: string[]) {
  requireValue(Object.keys(data).every(key => fields.includes(key)), 'INVALID_INPUT', 'Unknown story fields; do not hide content in unvalidated fields')
}
export function parseProjectSetup(value: unknown): ProjectSetup {
  const d = storyObject(value), fields = ['title','genre','audience','premise','worldRules','constraints']
  exact(d, fields); strings(d, fields, fields.filter(k => k !== 'constraints'))
  return d as unknown as ProjectSetup
}
export function parseStoryResource(value: unknown): StoryResource {
  const d = storyObject(value)
  exact(d, ['title','category','content','provenance']); strings(d, ['title','content','provenance'], ['title','content','provenance'])
  requireValue(['world','author_style','reference'].includes(String(d.category)), 'INVALID_INPUT', 'Unknown resource category')
  return d as unknown as StoryResource
}
export function parseEntityProfile(value: unknown): EntityProfile {
  const d = storyObject(value)
  exact(d, ['displayName','aliases','description','attributes','relationships']); strings(d, ['displayName','description'], ['displayName','description'])
  requireValue(Array.isArray(d.aliases) && Array.isArray(d.relationships), 'INVALID_INPUT', 'aliases and relationships must be arrays')
  d.aliases.forEach(a => nonempty(a, 'alias')); storyObject(d.attributes)
  requireValue(new Set(d.aliases).size === d.aliases.length, 'INVALID_INPUT', 'Duplicate alias')
  const seen = new Set<string>()
  for (const raw of d.relationships) {
    const r = storyObject(raw); exact(r, ['entityId','relation','details']); strings(r, ['entityId','relation','details'], ['entityId','relation'])
    const key = canonicalJson([r.entityId, r.relation]); requireValue(!seen.has(key), 'INVALID_INPUT', 'Duplicate relationship'); seen.add(key)
  }
  return d as unknown as EntityProfile
}
export function parseEntityState(value: unknown): EntityState {
  const d = storyObject(value)
  exact(d, ['basis','fromChapter','throughChapter','summary','facts'])
  requireValue(d.basis === 'initial' && d.fromChapter === 1, 'INVALID_INPUT', 'This stage only accepts initial facts effective from chapter 1; plans and post-publication facts need their own workflow')
  chapterRange(d.fromChapter, d.throughChapter); nonempty(d.summary, 'summary'); storyObject(d.facts)
  return d as unknown as EntityState
}
function schema<T>(parse: (value: unknown) => T) {
  return { parse, '~standard': { version: 1 as const, vendor: 'ds-writing', validate(value: unknown) {
    try { return { value: parse(value) } } catch (error) { return { issues: [{ message: (error as Error).message }] } }
  } } }
}
export const ProjectSetupSchema = schema(parseProjectSetup)
export const StoryResourceSchema = schema(parseStoryResource)
export const EntityProfileSchema = schema(parseEntityProfile)
export const EntityStateSchema = schema(parseEntityState)
