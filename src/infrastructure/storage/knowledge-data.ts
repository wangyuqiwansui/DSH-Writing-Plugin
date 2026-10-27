import { CONTRACT_VERSION, requireValue, type WritingStorage, type StorageSnapshot, type StorageTransaction } from '../../shared/contracts/index.js'
import type { KnowledgeDataPort, KnowledgeSnapshot, KnowledgeTransaction } from '../../shared/knowledge-data.js'
const prefix='knowledge.kb.'
function readPort(s:StorageSnapshot):KnowledgeSnapshot {
  return Object.freeze({getVersion:s.getVersion,getHead:(key:string)=>{requireValue(key.startsWith(prefix),'OWNER_MISMATCH','知识库 head 越界');return s.getHead(key)},listHeads:(key:string)=>{requireValue(key.startsWith(prefix),'OWNER_MISMATCH','知识库 head 越界');return s.listHeads(key)},getProject:s.getProject,getCommandReceipt:(owner,op)=>{requireValue(owner==='knowledge'&&op.startsWith('kb.'),'OWNER_MISMATCH','知识库回执越界');return s.getCommandReceipt(owner,op)},describeKnowledge:s.describeKnowledge,getKnowledgeSpans:s.getKnowledgeSpans})
}
function writePort(tx:StorageTransaction):KnowledgeTransaction {
  return Object.freeze({...readPort(tx),appendArtifact:input=>{requireValue(input.key.startsWith('kb-')&&['knowledge_source','source_text','knowledge_import_manifest','wiki_page','retrieval_trace','retrieval_index_manifest'].includes(input.kind),'OWNER_MISMATCH','知识库产物越界');return tx.appendArtifact(input)},setHead:(key,ref,revision)=>{requireValue(key.startsWith(prefix),'OWNER_MISMATCH','知识库 head 越界');return tx.setHead(key,ref,revision)},decide:(ref,decision,actor,reason)=>{requireValue(tx.getVersion(ref).owner==='knowledge','OWNER_MISMATCH','只能决定知识资料');return tx.decide(ref,decision,actor,reason)},putKnowledgeSpan:tx.putKnowledgeSpan,catalogKnowledgeSource:tx.catalogKnowledgeSource,emit:(type,payload)=>{requireValue(type.startsWith(prefix),'OWNER_MISMATCH','知识库事件越界');return tx.emit(type,payload)}})
}
export function knowledgeData(storage:WritingStorage):KnowledgeDataPort {
  return {
    status:signal=>storage.status(signal),instanceId:()=>storage.instanceId(),listProjects:signal=>storage.listProjects(signal),
    createProject(instance,operationId,title,signal){
      const projectId='kb-'+operationId
      return storage.repositoryFor('story',projectId).command({contractVersion:CONTRACT_VERSION,pluginInstanceId:instance,projectId,operationId:'kb.create.'+operationId,scope:{targetIds:[],referenceIds:[]},expectedVersions:[],input:{title}},tx=>{tx.createProject(title);return {projectId}},signal).result
    },
    snapshot:(project,read,signal)=>storage.openSnapshot(project,s=>read(readPort(s)),signal),
    command:(request,work,signal)=>{requireValue(request.operationId.startsWith('kb.'),'OWNER_MISMATCH','知识库命令越界');return storage.repositoryFor('knowledge',request.projectId).command(request,tx=>work(writePort(tx)),signal)},
  }
}
