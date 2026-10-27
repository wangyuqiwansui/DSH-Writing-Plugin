/** File-only dataset production. This module has no host, query, model or persistence ports. */
export interface ExportChunk { text:string; startByte:number; endByte:number; title:string; summary:string; keywords:string[] }
export interface ExportDocument { id:string; title:string; chunks:ExportChunk[] }
interface Example {id:string;split:'dev'|'test';question:string;expected:{documentId:string;quote:string}[];answerable:boolean}
export function reconstructText(chunks:ExportChunk[]):string {
  if(!chunks.length)throw new Error('资料没有原文片段')
  const size=Math.max(...chunks.map(c=>c.endByte))
  if(!Number.isInteger(size)||size<1||size>240000)throw new Error('原文长度无效')
  const bytes=new Uint8Array(size),seen=new Uint8Array(size),encoder=new TextEncoder()
  for(const c of chunks){
    const part=encoder.encode(c.text)
    if(!Number.isInteger(c.startByte)||c.startByte<0||c.endByte-c.startByte!==part.length||c.endByte>size)throw new Error('片段定位无效')
    for(let i=0;i<part.length;i++){const at=c.startByte+i;if(seen[at]&&bytes[at]!==part[i])throw new Error('重叠片段不一致');bytes[at]=part[i]!;seen[at]=1}
  }
  if(seen.some(n=>!n))throw new Error('原文片段存在缺口')
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes)
}
const provenance=(reviewed:boolean)=>({type:'exported',reviewed,note:'由功能测试入口导出的文件快照；生成模板不代表标准答案已独立审核。'})
function checkCases(cases:unknown):asserts cases is Record<string,unknown>[] {
  if(!Array.isArray(cases)||!cases.length||cases.length>200)throw new Error('测试集需要 1 至 200 道题')
  for(const c of cases)if(!c||typeof c!=='object'||typeof c.id!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(c.id)||typeof c.question!=='string'||!c.question.trim()||c.question.length>600||!['dev','test'].includes(c.split))throw new Error('用例 ID、问题或分组无效')
  if(new Set(cases.map(c=>c.id)).size!==cases.length)throw new Error('用例 ID 不能重复')
  if(!cases.some(c=>c.split==='dev')||!cases.some(c=>c.split==='test'))throw new Error('请至少分别提供一道 dev 和 test 用例')
}
export function knowledgeTemplate(documents:ExportDocument[]):Example[] {
  return documents.map((d,i)=>({id:'case-'+(i+1),split:i<Math.max(1,Math.floor(documents.length/2))?'dev':'test',question:d.title+'有哪些已记录的设定？',expected:[{documentId:d.id,quote:d.chunks[0]?.text.slice(0,100)??''}],answerable:true}))
}
export function knowledgeDataset(documents:ExportDocument[],cases:unknown,reviewed:boolean) {
  if(!documents.length)throw new Error('需要已确认的资料')
  checkCases(cases)
  const exported=documents.map(d=>({id:d.id,title:d.title,text:reconstructText(d.chunks),keywords:[],annotations:d.chunks.map(c=>({title:c.title,summary:c.summary,keywords:[...c.keywords]}))}))
  for(const c of cases){if(!Array.isArray(c.expected)||typeof c.answerable!=='boolean'||(c.answerable?!c.expected.length:!!c.expected.length))throw new Error('问题或证据标注无效');for(const e of c.expected)if(!e.quote||!exported.some(d=>d.id===e.documentId&&d.text.includes(e.quote)))throw new Error('标准证据必须来自导出的资料')}
  return {schemaVersion:'backtest-dataset-v1',id:'knowledge-export',version:'1.0.0',title:'知识库功能测试集',kind:'retrieval',provenance:provenance(reviewed),config:{topK:3,maxCharacters:12000,representations:['literal','lexical','enriched']},documents:exported,cases:structuredClone(cases)}
}
export interface WorldExport { name:string; records:{id:string;name:string;confirmation:string}[] }
export function worldTemplate(document:WorldExport) {
  const records=document.records.filter(r=>r.confirmation==='confirmed'&&r.name.trim())
  return records.map((r,i)=>({id:'world-'+(i+1),split:i<Math.max(1,Math.floor(records.length/2))?'dev':'test',question:r.name,expectedIds:[r.id],recordIds:[],answerable:true}))
}
export function worldDataset(document:WorldExport,cases:unknown,reviewed:boolean) {
  checkCases(cases)
  for(const c of cases)if(!Array.isArray(c.expectedIds)||!Array.isArray(c.recordIds)||![...c.expectedIds,...c.recordIds].every(id=>document.records.some(r=>r.id===id)))throw new Error('预期条目必须属于导出的世界观')
  return {schemaVersion:'backtest-dataset-v1',id:'world-export',version:'1.0.0',title:document.name+'功能测试集',kind:'world-query',provenance:provenance(reviewed),config:{maxRecords:20,maxCharacters:20000},world:structuredClone(document),cases:structuredClone(cases)}
}
