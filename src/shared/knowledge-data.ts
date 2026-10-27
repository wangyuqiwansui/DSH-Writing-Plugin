import type { CommandEnvelope, CommandResult, StorageSnapshot, StorageTransaction, StorageStatus, StoryProject } from './contracts/index.js'
export type KnowledgeSnapshot = Pick<StorageSnapshot,'getVersion'|'getHead'|'listHeads'|'getProject'|'getCommandReceipt'|'describeKnowledge'|'getKnowledgeSpans'>
export type KnowledgeTransaction = KnowledgeSnapshot & Pick<StorageTransaction,'appendArtifact'|'setHead'|'decide'|'putKnowledgeSpan'|'catalogKnowledgeSource'|'emit'>
/** Infrastructure owns connections and owner restrictions. Models never receive this capability. */
export interface KnowledgeDataPort {
  status(signal?:AbortSignal):StorageStatus
  instanceId():string
  listProjects(signal?:AbortSignal):StoryProject[]
  createProject(instance:string,operationId:string,title:string,signal?:AbortSignal):{projectId:string}
  snapshot<T>(project:string,read:(s:KnowledgeSnapshot)=>T,signal?:AbortSignal):T
  command<T>(request:CommandEnvelope,work:(tx:KnowledgeTransaction)=>T,signal?:AbortSignal):CommandResult<T>
}
