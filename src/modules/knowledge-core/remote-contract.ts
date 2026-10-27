import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { ManagementRequest, ManagementResult } from './contracts.js'
import { managementInput } from './validation.js'
export const knowledgeRemote:TypertRemoteContribution={package:'dsh-writing-workbench',descriptors:[{id:'dsh-writing-workbench#writingKnowledge/invoke',service:'writingKnowledge',namespace:'writingKnowledge',method:'invoke',invocation:{kind:'direct'},cancellation:{parameter:'signal'},result:{mode:'src-json'},parameters:[{name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'KnowledgeManagementRequest',create:()=>({parse:managementInput})}}]}]}
declare module '@deepseek-ai/dsh-typert-protocol' {interface TypertRemoteNamespaceMap {writingKnowledge:{invoke(request:ManagementRequest,signal?:AbortSignal):Promise<RemoteResult<ManagementResult>>}}}
