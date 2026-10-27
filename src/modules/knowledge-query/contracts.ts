import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { VersionRef } from '../../shared/contracts/index.js'
/** Consumer contract: no engine scores, prompts, database details or management methods. */
export interface KnowledgeQuery {
  schemaVersion:'knowledge-query-v1'; action:'retrieve'|'answer'; pluginInstanceId:string; projectId:string
  operationId:string; question:string; sources:VersionRef[]; limit:number; maxCharacters:number
}
export interface KnowledgeEvidence {
  id:string; title:string; text:string; source:VersionRef
  locator:{format:'utf8-byte-span-v1';start:number;endExclusive:number;spanHash:string}
}
export interface KnowledgeResponse {
  schemaVersion:'knowledge-response-v1'; status:'retrieved'|'answered'|'insufficient'|'conflict'
  answer:string|null; statements:{text:string;citations:{evidenceId:string;quote:string}[]}[]
  evidence:KnowledgeEvidence[]; missing:string[]; warnings:string[]
  provenance:{corpusDigest:string;sourceVersions:VersionRef[];trace:VersionRef|null}
}
export interface QueryBackend { invoke(request:KnowledgeQuery,signal:AbortSignal):Promise<KnowledgeResponse> }
const descriptor:InvocationDescriptor={id:'dsh-writing-workbench#writingKnowledgeQuery/invoke',service:'writingKnowledgeQuery',namespace:'writingKnowledgeQuery',method:'invoke',invocation:{kind:'direct'},cancellation:{parameter:'signal'},result:{mode:'src-json'},parameters:[{name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'KnowledgeQuery',create:()=>({parse(value:unknown){return value as KnowledgeQuery}})}}]}
export const knowledgeQueryRemote:TypertRemoteContribution={package:'dsh-writing-workbench',descriptors:[descriptor]}
declare module '@deepseek-ai/dsh-typert-protocol' {interface TypertRemoteNamespaceMap {writingKnowledgeQuery:{invoke(request:KnowledgeQuery,signal?:AbortSignal):Promise<RemoteResult<KnowledgeResponse>>}}}
