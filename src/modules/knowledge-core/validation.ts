import { canonicalJson, VersionRefSchema, type VersionRef } from '../../shared/contracts/index.js'
import type { ManagementRequest, QueryInput } from './contracts.js'
export class KnowledgeError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'KnowledgeError' } }
export function ensure(ok: unknown, message: string, code = 'INVALID_INPUT'): asserts ok { if (!ok) throw new KnowledgeError(code, message) }
export function obj(raw: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  ensure(raw && typeof raw === 'object' && !Array.isArray(raw), '需要对象')
  const value = raw as Record<string, unknown>
  ensure(required.every(k => Object.hasOwn(value, k)) && Object.keys(value).every(k => [...required, ...optional].includes(k)), '字段缺失或存在未知字段')
  return value
}
export function str(raw: unknown, max = 1000, empty = false): string { ensure(typeof raw === 'string' && raw.length <= max && !raw.includes('\0') && (empty || raw.trim()), '文本为空、过长或格式无效'); return raw }
export function id(raw: unknown): string { const value = str(raw, 120); ensure(/^[a-zA-Z0-9_-]+$/.test(value), '标识格式无效'); return value }
export function num(raw: unknown, min: number, max: number): number { ensure(Number.isSafeInteger(raw) && Number(raw) >= min && Number(raw) <= max, '数值超出范围'); return Number(raw) }
export function list(raw: unknown, max: number): unknown[] { ensure(Array.isArray(raw) && raw.length <= max, '列表超出上限或格式无效'); return raw }
export function refs(raw: unknown): VersionRef[] {
  const values = list(raw, 100).map(r => VersionRefSchema.parse(r))
  ensure(new Set(values.map(r => r.versionId)).size === values.length, '来源重复'); return values
}
export function queryInput(raw: unknown): QueryInput {
  const v = obj(raw, ['pluginInstanceId','projectId','question','documents','topK','maxCharacters','representation'])
  ensure(['literal','lexical','enriched'].includes(String(v.representation)), '检索配置无效')
  return { pluginInstanceId: id(v.pluginInstanceId), projectId: id(v.projectId), question: str(v.question, 600), documents: refs(v.documents), topK: num(v.topK,1,20), maxCharacters: num(v.maxCharacters,1000,40000), representation: v.representation as QueryInput['representation'] }
}
export function managementInput(raw: unknown): ManagementRequest {
  const action = (raw as {action?:string})?.action
  const fields: Record<string,string[]> = {overview:[],create:['pluginInstanceId','operationId','title'],list:['pluginInstanceId','projectId'],ingest:['pluginInstanceId','projectId','operationId','documentId','expectedRevision','title','text'],decide:['pluginInstanceId','projectId','operationId','ref','decision'],receipt:['pluginInstanceId','projectId','operationId']}
  ensure(action && Object.hasOwn(fields,action),'操作不存在'); const v=obj(raw,['action',...fields[action]!])
  for(const key of ['pluginInstanceId','projectId','operationId','documentId']) if(Object.hasOwn(v,key)) id(v[key])
  if(Object.hasOwn(v,'title')) str(v.title,200)
  if(action==='ingest') { str(v.text,60000); num(v.expectedRevision,0,500) }
  if(action==='decide') { VersionRefSchema.parse(v.ref); ensure(['confirmed','revoked'].includes(String(v.decision)),'决定无效') }
  return JSON.parse(canonicalJson(v)) as ManagementRequest
}
