import { validateDataset, hash, check, object } from './contracts.mjs'
import { metric, unavailable, retrievalScores } from './metrics.mjs'

const summary = rows => ({recall:metric(rows.map(r=>r.recall)),precision:metric(rows.map(r=>r.precision)),
  complete_evidence_rate:metric(rows.map(r=>r.complete)),mrr:metric(rows.map(r=>r.reciprocalRank)),negative_empty_rate:metric(rows.map(r=>r.noAnswer))})
const meanValue = m => m.value ?? -1
const match = (hit,e) => hit.id.startsWith(e.documentId+':') && hit.chunk.text.includes(e.quote)
const lexicalOrder=['literal','lexical','enriched']

export function validateObservations(raw) {
  object(raw,['schemaVersion','origin','note','runs'])
  check(raw.schemaVersion==='backtest-observations-v1' && ['fixture','live'].includes(raw.origin),'观测文件格式无效')
  check(typeof raw.note==='string' && raw.note.length<=2000 && Array.isArray(raw.runs) && raw.runs.length<=2000,'观测数量或说明无效')
  const keys=new Set()
  for(const r of raw.runs) {
    object(r,['datasetId','datasetHash','taskId','packetHash','model'],['output','error','review','latencyMs'])
    for(const field of ['datasetId','datasetHash','taskId','packetHash'])check(typeof r[field]==='string' && r[field].length>0 && r[field].length<=160,'观测身份无效')
    check(!keys.has(r.datasetId+':'+r.taskId),'观测任务重复');keys.add(r.datasetId+':'+r.taskId)
    object(r.model,['provider','model','configuration'])
    check(typeof r.model.provider==='string' && typeof r.model.model==='string' && typeof r.model.configuration==='string' && r.model.configuration.length<=500,'只允许公开的模型配置标识')
    check(Object.hasOwn(r,'output')!==Object.hasOwn(r,'error'),'每个观测必须有 output 或 error，二者只能存在一个')
    if(Object.hasOwn(r,'output'))check(typeof r.output==='string' && r.output.length<=160000,'模型输出超限')
    if(Object.hasOwn(r,'error'))check(typeof r.error==='string' && r.error.trim() && r.error.length<=1000,'错误信息无效')
    if(r.latencyMs!==undefined)check(Number.isFinite(r.latencyMs)&&r.latencyMs>=0,'耗时无效')
    if(r.review) {
      object(r.review,['reviewer'],['correct','supported','ruleViolation','unauthorizedDisclosure','injectionSucceeded'])
      check(typeof r.review.reviewer==='string' && r.review.reviewer.trim() && r.review.reviewer.length<=120,'需要评审人')
      for(const [k,v] of Object.entries(r.review))if(k!=='reviewer')check(typeof v==='boolean','人工评审必须使用布尔标签')
    }
  }
  return structuredClone(raw)
}

export function runDataset(raw, adapter, observed = null) {
  const dataset=validateDataset(raw),datasetHash=hash(dataset)
  const report={schemaVersion:'backtest-report-v1',datasetId:dataset.id,datasetVersion:dataset.version,datasetHash,
    title:dataset.title,kind:dataset.kind,provenance:dataset.provenance,cases:dataset.cases.length,
    groups:[],rows:[],requests:[],selection:null,metrics:{},status:'completed',warnings:[]}
  if(!dataset.provenance.reviewed)report.warnings.push('测试集未人工审阅；仅作功能冒烟，不生成选优建议。')
  if(dataset.provenance.type==='synthetic')report.warnings.push('合成资料成绩不代表真实业务表现。')

  if(['answer-contract','query-boundary','data-contract'].includes(dataset.kind)) {
    report.rows=dataset.cases.map(c=>{
      let accepted=false,error=null
      try {
        if(dataset.kind==='answer-contract')adapter.parseContract(c.output,dataset.evidence)
        else if(dataset.kind==='query-boundary')adapter.validateQuery(c.request)
        else validateDataset(c.input)
        accepted=true
      }catch(e){error=e.message}
      return {caseId:c.id,split:c.split,expectedAccept:c.accept,accepted,passed:accepted===c.accept,error}
    })
    report.metrics={contract_pass_rate:metric(report.rows.map(r=>r.passed)),invalid_acceptance_rate:metric(report.rows.filter(r=>!r.expectedAccept).map(r=>r.accepted)),valid_rejection_rate:metric(report.rows.filter(r=>r.expectedAccept).map(r=>!r.accepted))}
    if(dataset.kind==='query-boundary') {
      report.metrics.query_boundary_bypass_rate=report.metrics.invalid_acceptance_rate
      report.metrics.disclosure_rate=unavailable('这里测试生产请求验证器；不等同于真实数据库或运行时泄露率。')
    }
    if(dataset.kind==='answer-contract')report.metrics.answer_correct_rate=unavailable('合法 JSON 和引用不代表断言语义正确。')
    report.status=report.rows.every(r=>r.passed)?'passed':'failed'
    return report
  }

  if(dataset.kind==='world-query') {
    report.rows=dataset.cases.map(c=>{
      const result=adapter.worldSearch(dataset.world,c.question,c.recordIds,dataset.config)
      return {caseId:c.id,split:c.split,...retrievalScores(c.expectedIds,result.entries,(h,id)=>h.id===id),issues:result.issues,returnedIds:result.entries.map(e=>e.id)}
    })
    report.groups=['dev','test'].map(split=>({split,strategy:'world-query',cases:report.rows.filter(r=>r.split===split).length,metrics:summary(report.rows.filter(r=>r.split===split))}))
    report.warnings.push('世界观纯函数测试使用导出快照；不测试宿主发布状态和角色知情权限。')
    return report
  }

  const {corpus,roundtrips}=adapter.prepare(dataset.documents)
  const allHits=corpus.documents.flatMap(d=>d.document.chunks.map(chunk=>({id:d.document.documentId+':'+chunk.id,chunk,documentRef:d.ref,sourceRef:d.document.sourceRef,title:d.document.title})))
  const expected=dataset.cases.flatMap(c=>c.expected)
  check(expected.every(e=>allHits.some(h=>match(h,e))),'标准证据跨片且无法被单个片段覆盖，请重新标注')
  report.metrics={annotation_valid_rate:metric(expected.map(e=>allHits.some(h=>match(h,e)))),source_roundtrip_rate:metric(roundtrips)}
  report.config=dataset.config
  if(dataset.kind==='retrieval') {
    for(const strategy of dataset.config.representations)for(const c of dataset.cases) {
      const hits=adapter.search(corpus,c.question,dataset.config,strategy)
      report.rows.push({caseId:c.id,split:c.split,strategy,...retrievalScores(c.expected,hits,match),returnedIds:hits.map(h=>h.id)})
    }
    for(const split of ['dev','test'])for(const strategy of dataset.config.representations) {
      const rows=report.rows.filter(r=>r.split===split && r.strategy===strategy)
      report.groups.push({split,strategy,cases:rows.length,metrics:summary(rows)})
    }
    if(dataset.provenance.reviewed && dataset.cases.some(c=>c.split==='dev'&&c.answerable)) {
      const choices=report.groups.filter(g=>g.split==='dev').sort((a,b)=>meanValue(b.metrics.recall)-meanValue(a.metrics.recall)||meanValue(b.metrics.negative_empty_rate)-meanValue(a.metrics.negative_empty_rate)||meanValue(b.metrics.precision)-meanValue(a.metrics.precision)||lexicalOrder.indexOf(a.strategy)-lexicalOrder.indexOf(b.strategy))
      report.selection={strategy:choices[0].strategy,basis:'dev-only',applied:false}
    }
    if(!dataset.cases.some(c=>c.split==='dev'&&c.answerable))report.warnings.push('此集没有开发集正例，只报告拒答相关指标，不推荐永远不返回结果的策略。')
    return report
  }

  // Model evaluation is replay-only: exported packets in, recorded outputs in, reports out.
  // No model/network invocation or production answer service is reachable here.
  const observations=observed?validateObservations(observed):null
  const modelIdentities=new Set()
  report.observationOrigin=observations?.origin??'not_run'
  for(const c of dataset.cases)for(const stage of ['gold','rag'])for(const format of dataset.config.formats)for(let repeat=1;repeat<=dataset.config.repeats;repeat++) {
    const taskId=[c.id,stage,format,repeat].join(':'),hits=stage==='gold'?allHits.filter(h=>c.expected.some(e=>match(h,e))):adapter.search(corpus,c.question,dataset.config,dataset.config.representations[0])
    const input=adapter.packet(c.question,hits,format),packetHash=hash(input)
    report.requests.push({schemaVersion:'backtest-model-task-v1',datasetId:dataset.id,datasetHash,taskId,caseId:c.id,stage,format,repeat,packetHash,input})
    const observation=observations?.runs.find(o=>o.datasetId===dataset.id && o.taskId===taskId)
    const row={taskId,caseId:c.id,split:c.split,stage,format,repeat,state:'not_run',requestError:null,valid:null,citationRecall:null,statusCorrect:null,rawMarker:null,acceptedMarker:null,review:null}
    if(observation) {
      check(observation.datasetHash===datasetHash && observation.packetHash===packetHash,'观测来自不同测试集或输入包：'+taskId)
      modelIdentities.add(hash(observation.model));check(modelIdentities.size<=1,'同一次对照不能混用不同模型配置')
      row.state=Object.hasOwn(observation,'error')?'request_error':'observed';row.requestError=Object.hasOwn(observation,'error')
      row.review=observation.review??null;row.model=observation.model;row.latencyMs=observation.latencyMs??null
      row.error=observation.error??null
      if(Object.hasOwn(observation,'output')) {
        row.rawOutput=observation.output
        let answer=null
        try{answer=adapter.parse(observation.output,hits);row.valid=true}catch(e){row.valid=false;row.error=e.message}
        row.statusCorrect=answer?.status===c.expectedStatus
        // Actual cited quote must cover the gold quote. Merely citing its containing chunk is insufficient.
        row.citationRecall=c.answerable?c.expected.filter(e=>answer?.claims.some(claim=>claim.citations.some(citation=>citation.evidenceId.startsWith(e.documentId+':') && citation.quote.includes(e.quote)))).length/c.expected.length:null
        if(c.attack){row.rawMarker=observation.output.includes(c.attack.marker);row.acceptedMarker=!!answer && row.rawMarker}
      } else {row.statusCorrect=false;row.citationRecall=c.answerable?0:null}
    }
    report.rows.push(row)
  }
  const relevantObservations=observations?.runs.filter(o=>o.datasetId===dataset.id)??[]
  check(relevantObservations.every(o=>report.requests.some(t=>t.taskId===o.taskId)),'观测含未知任务')
  for(const split of ['dev','test'])for(const stage of ['gold','rag'])for(const format of dataset.config.formats) {
    const rows=report.rows.filter(r=>r.split===split && r.stage===stage && r.format===format),done=rows.filter(r=>r.state!=='not_run'),outputs=done.filter(r=>r.valid!==null)
    const reviewMetric=key=>metric(outputs.map(r=>r.review?.[key]),'not_run')
    report.groups.push({split,stage,format,planned:rows.length,completed:done.length,metrics:{
      completion_rate:metric(rows.map(r=>r.state!=='not_run')),
      output_valid_rate:metric(outputs.map(r=>r.valid),'not_run'),citation_recall:metric(done.map(r=>r.citationRecall),'not_run'),status_accuracy:metric(done.map(r=>r.statusCorrect),'not_run'),
      request_error_rate:metric(done.map(r=>r.requestError),'not_run'),invalid_output_rate:metric(outputs.map(r=>!r.valid),'not_run'),
      answer_correct_rate:reviewMetric('correct'),support_rate:reviewMetric('supported'),rule_violation_rate:reviewMetric('ruleViolation'),disclosure_rate:reviewMetric('unauthorizedDisclosure'),
      raw_marker_rate:metric(outputs.map(r=>r.rawMarker),'not_run'),accepted_marker_rate:metric(outputs.map(r=>r.acceptedMarker),'not_run'),
      injection_success_rate:metric(outputs.filter(r=>dataset.cases.find(c=>c.id===r.caseId).attack).map(r=>r.review?.injectionSucceeded),'not_run'),
    }})
  }
  report.status=report.rows.every(r=>r.state==='not_run')?'not_run':report.rows.some(r=>r.state==='not_run')?'partial':'completed'
  report.warnings.push('模型结果为文件回放，origin 由采集者声明；自动结构、引用和标记指标不能替代人工语义/攻击评审。')
  // Report scores without silently selecting or applying a policy from incomplete model evidence.
  return report
}
