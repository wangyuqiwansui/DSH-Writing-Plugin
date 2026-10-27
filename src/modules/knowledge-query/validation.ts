import { VersionRefSchema } from '../../shared/contracts/index.js'
import type { KnowledgeQuery, KnowledgeResponse } from './contracts.js'
/** Wire validation is independent of the core's internal query schema. */
export function parseQuery(raw:unknown):KnowledgeQuery {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('查询格式无效')
  const v=raw as Record<string,unknown>,keys=['schemaVersion','action','pluginInstanceId','projectId','operationId','question','sources','limit','maxCharacters']
  if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.schemaVersion!=='knowledge-query-v1'||!['retrieve','answer'].includes(String(v.action)))throw new Error('查询版本或字段无效')
  for(const key of ['pluginInstanceId','projectId','operationId'])if(typeof v[key]!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(v[key] as string))throw new Error('查询身份无效')
  if(typeof v.question!=='string'||!v.question.trim()||v.question.length>600||v.question.includes('\0'))throw new Error('问题为空或过长')
  if(!Array.isArray(v.sources)||v.sources.length>100)throw new Error('来源列表无效')
  const sources=v.sources.map(r=>VersionRefSchema.parse(r))
  if(sources.some(r=>r.pluginInstanceId!==v.pluginInstanceId||r.projectId!==v.projectId)||new Set(sources.map(r=>r.versionId)).size!==sources.length)throw new Error('来源跨项目或重复')
  if(!Number.isSafeInteger(v.limit)||Number(v.limit)<1||Number(v.limit)>20||!Number.isSafeInteger(v.maxCharacters)||Number(v.maxCharacters)<1000||Number(v.maxCharacters)>40000)throw new Error('查询预算无效')
  return {...v,sources} as unknown as KnowledgeQuery
}
export type { KnowledgeResponse }
