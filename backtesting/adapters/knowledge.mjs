// The adapter uses pure production functions only. No service, database or model port.
import { chunkText, retrieve, evidence, digest, answerPacket, parseAnswer } from '../../lib/modules/knowledge-core/read-only.js'
import { validateKnowledgeQuery } from '../../lib/modules/knowledge-query/read-only.js'
import { queryWorldSnapshot } from '../../lib/modules/worldbuilding/read-only.js'
import { hash, check } from '../contracts.mjs'

const ref=(id,text,kind='source_text')=>({pluginInstanceId:'backtest',projectId:'fixture',artifactId:id,versionId:id+'-v1',revision:1,kind,schemaVersion:'fixture-v1',contentHash:hash(text)})
export function prepare(documents) {
  const corpus={scope:{pluginInstanceId:'backtest',projectId:'fixture'},digest:hash(documents),documents:documents.map(d=>{
    const chunks=chunkText(d.text)
    if(d.annotations)check(d.annotations.length===chunks.length,'导出片段与当前分片器不一致，不能静默重用标注')
    return {ref:ref(d.id,d.text,'knowledge_import_manifest'),document:{documentId:d.id,title:d.title,sourceRef:ref(d.id+'-text',d.text),chunks:chunks.map((c,i)=>({...c,...(d.annotations?.[i]??{title:d.title.slice(0,100),summary:c.text.slice(0,400),keywords:d.keywords})}))}}
  })}
  const roundtrips=corpus.documents.flatMap((d,i)=>d.document.chunks.map(c=>Buffer.from(documents[i].text,'utf8').subarray(c.startByte,c.endByte).toString('utf8')===c.text && digest(c.text)===c.hash))
  return {corpus,roundtrips}
}
export const search=(corpus,question,config,representation)=>retrieve(corpus,{question,...config,representation}).hits
export const packet=(question,hits,format)=>answerPacket(question,hits.map(evidence),format)
export const parse=(output,hits)=>parseAnswer(output,hits.map(evidence))
export const parseContract=(output,items)=>parseAnswer(output,items)
export const validateQuery=validateKnowledgeQuery
export const worldSearch=(world,question,recordIds,config)=>queryWorldSnapshot(world,ref('world',JSON.stringify(world),'world_snapshot'),{text:question,recordIds,...config})
