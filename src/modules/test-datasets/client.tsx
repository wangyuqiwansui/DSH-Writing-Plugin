import { useState } from 'react'
import { knowledgeDataset, knowledgeTemplate, worldDataset, worldTemplate, type ExportDocument, type WorldExport } from './index.js'

function DatasetEditor({template,build,filename}:{template:()=>unknown;build:(cases:unknown,reviewed:boolean)=>unknown;filename:string}) {
  const [text,setText]=useState('[]'),[reviewed,setReviewed]=useState(false),[message,setMessage]=useState('')
  const generate=()=>{setText(JSON.stringify(template(),null,2));setReviewed(false);setMessage('模板已生成，请核对问题、预期证据及 dev/test 分组。')}
  const download=()=>{try{
    const value=build(JSON.parse(text),reviewed),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'})),link=document.createElement('a')
    link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),0);setMessage('已导出测试集。回测在独立命令中执行，报告写入 backtest-reports/。')
  }catch(e){setMessage((e as Error).message)}}
  return <div className="kb-page"><p className="kb-muted">此入口只生成和导出测试集。模板问题用于起步，请补充否定、条件、多资料及无答案问题，并分别标注 dev / test；至少保留两道不同的问题。</p>
    <div className="kb-actions"><button type="button" onClick={generate}>生成测试集模板</button></div>
    <label>测试集用例 JSON<textarea rows={12} value={text} onChange={e=>{setText(e.target.value);setReviewed(false)}}/></label>
    <label className="kb-checkbox"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>我已核对问题、原文证据及独立的 dev/test 分组</label>
    <button type="button" onClick={download}>导出测试集</button>{message&&<p role="status" className="kb-notice">{message}</p>}
  </div>
}
export function KnowledgeDatasetBuilder({documents}:{documents:ExportDocument[]}) {
  return <section className="kb-card"><h2>知识库功能测试集</h2><DatasetEditor template={()=>knowledgeTemplate(documents)} build={(cases,reviewed)=>knowledgeDataset(documents,cases,reviewed)} filename="knowledge-export.dataset.json"/></section>
}
export function WorldDatasetBuilder({document}:{document:WorldExport}) {
  return <details className="wb-retrieval-panel"><summary><span>世界观功能测试集</span><small>生成与导出</small></summary><section className="wb-editor"><DatasetEditor template={()=>worldTemplate(document)} build={(cases,reviewed)=>worldDataset(document,cases,reviewed)} filename="world-export.dataset.json"/></section></details>
}
