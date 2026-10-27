import { metricCatalog } from './metrics.mjs'
const label=new Map(metricCatalog.map(m=>[m.id,m.name]))
const safe=value=>String(value??'').replaceAll('|','\\|').replaceAll('\n',' ')
export function metricRows(reports) {
  return reports.flatMap(r=>[{group:'dataset',metrics:r.metrics},...r.groups.map(g=>({group:[g.split,g.strategy,g.stage,g.format].filter(Boolean).join('/'),metrics:g.metrics}))].flatMap(g=>Object.entries(g.metrics).map(([id,m])=>({dataset:r.datasetId,version:r.datasetVersion,group:g.group,metric:id,name:label.get(id)??id,...m}))))
}
export function markdown(run) {
  const lines=['# 功能回测报告','',`运行：${run.runId}；执行器指纹：${run.engineFingerprint}`,'',
    '输入为文件快照；未连接数据库、未调用线上模型、未应用运行配置。模型指标来自观测文件回放，缺失结果保留为未测试。','',
    '| 数据集 | 版本 | 用例 | 状态 | 数据摘要 |','| --- | --- | ---: | --- | --- |',
    ...run.datasets.map(d=>`| ${safe(d.datasetId)} | ${safe(d.datasetVersion)} | ${d.cases} | ${d.status} | ${d.datasetHash.slice(0,16)} |`),'']
  for(const d of run.datasets) {
    lines.push(`## ${safe(d.title)}（${d.datasetId}）`,'',`来源：${d.provenance.type}；人工审阅：${d.provenance.reviewed?'已标记':'未标记'}。`,'')
    if(d.selection)lines.push(`开发集建议：${d.selection.strategy}；未应用到系统。`,'')
    lines.push('| 分组 | 指标 | 数值 | 分子 / 分母 | 状态 |','| --- | --- | ---: | ---: | --- |')
    for(const r of metricRows([d]))lines.push(`| ${safe(r.group)} | ${safe(r.name)} | ${r.value===null?'—':(r.value*100).toFixed(2)+'%'} | ${Number(r.numerator.toFixed(4))} / ${r.denominator} | ${r.status} |`)
    lines.push('',...d.warnings.map(w=>'- '+w),'')
  }
  lines.push('指标定义见 `backtesting/docs/metrics.md`。宏平均的分子是逐题比率之和；逐题原始计数见 JSON。未测试不表示通过。','')
  return lines.join('\n')
}
export function csv(reports) {
  const keys=['dataset','version','group','metric','name','value','numerator','denominator','status']
  const cell=v=>{const s=String(v??'');return '"'+(/^[=+@-]/.test(s)?"'":'')+s.replaceAll('"','""')+'"'}
  return [keys,...metricRows(reports).map(row=>keys.map(k=>row[k]))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n'
}
