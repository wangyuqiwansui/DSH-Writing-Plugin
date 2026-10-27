import { createHash } from 'node:crypto'
import { canonicalJson } from '../../shared/contracts/index.js'
import { ensure } from './validation.js'
import type { Chunk, Corpus, Evidence, Hit, QueryInput, Retrieval } from './contracts.js'
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export function chunkText(text: string): Chunk[] {
  const chars = Array.from(text), chunks: Chunk[]=[]
  let start=0, byteStart=0
  while(start<chars.length) {
    const end=Math.min(start+600,chars.length), body=chars.slice(start,end).join(''), endByte=byteStart+Buffer.byteLength(body)
    chunks.push({id:`c${chunks.length+1}`,ordinal:chunks.length,text:body,startByte:byteStart,endByte,hash:digest(body),title:'',summary:'',keywords:[]})
    if(end===chars.length) break
    const next=end-80;byteStart+=Buffer.byteLength(chars.slice(start,next).join(''));start=next
  }
  ensure(chunks.length<=100,'资料过长，请拆分后导入');return chunks
}
const normalize=(s:string)=>s.normalize('NFKC').toLowerCase()
export function tokens(text:string):string[] {
  const output:string[]=[]
  for(const part of normalize(text).match(/[\p{Script=Han}]+|[\p{L}\p{N}_]+/gu)??[]) {
    if(/\p{Script=Han}/u.test(part)) { const c=Array.from(part); if(c.length===1) output.push(part); for(let i=0;i<c.length-1;i++) output.push(c[i]!+c[i+1]!) }
    else output.push(part)
  }
  return output
}
export function evidence(hit:Hit):Evidence { return {id:hit.id,sourceRef:hit.sourceRef,documentRef:hit.documentRef,title:hit.title,text:hit.chunk.text,locator:{format:'utf8-byte-span-v1',start:hit.chunk.startByte,endExclusive:hit.chunk.endByte,spanHash:hit.chunk.hash},parserVersion:'kb-codepoint-600-overlap-80-v1'} }
/** Pure retrieval: one ranked list, original evidence only, deterministic tie breaks. */
export function retrieve(corpus:Corpus,input:Pick<QueryInput,'question'|'topK'|'maxCharacters'|'representation'>):Retrieval {
  const query=[...new Set(tokens(input.question))], needle=normalize(input.question.trim())
  const rows=corpus.documents.flatMap(d=>d.document.chunks.map(chunk=>({d,chunk,text:input.representation==='enriched'?[d.document.title,chunk.title,chunk.summary,chunk.keywords.join(' '),chunk.text].join('\n'):chunk.text})))
  const bags=rows.map(r=>{const bag=new Map<string,number>();for(const token of tokens(r.text))bag.set(token,(bag.get(token)??0)+1);return bag})
  const lengths=bags.map(b=>[...b.values()].reduce((a,n)=>a+n,0)),avg=lengths.reduce((a,n)=>a+n,0)/Math.max(rows.length,1)||1
  const df=new Map(query.map(t=>[t,bags.filter(b=>b.has(t)).length]))
  const hits:Hit[]=rows.map((r,i)=>{
    let score=0
    if(input.representation==='literal') score=normalize(r.chunk.text).includes(needle)?1:0
    else for(const term of query) {const tf=bags[i]!.get(term)??0;const inverse=Math.log(1+(rows.length-(df.get(term)??0)+.5)/((df.get(term)??0)+.5));score+=inverse*tf*2.2/(tf+1.2*(.25+.75*lengths[i]!/avg))}
    return {id:`${r.d.document.documentId}:${r.chunk.id}`,documentRef:r.d.ref,sourceRef:r.d.document.sourceRef,title:r.d.document.title,chunk:r.chunk,score,rank:0}
  }).filter(h=>h.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))
  const selected:Hit[]=[];let size=0
  for(const hit of hits) {
    if(selected.length>=input.topK) break
    // Count the evidence representation including provenance, not only its text.
    const cost=Array.from(canonicalJson(evidence(hit))).length
    if(size+cost>input.maxCharacters) continue
    size+=cost;selected.push({...hit,rank:selected.length+1})
  }
  return {corpus,question:input.question,representation:input.representation,hits:selected,omitted:hits.length-selected.length,maxCharacters:input.maxCharacters}
}
