import { readFileSync, mkdirSync, writeFileSync, realpathSync, lstatSync, existsSync } from 'node:fs'
import { dirname, resolve, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { check, hash } from './contracts.mjs'
import { runDataset, validateObservations } from './runner.mjs'
import { metricCatalog } from './metrics.mjs'
import { markdown, csv } from './report.mjs'

const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(directory,'..')
const readJson=(path,limit=5_000_000)=>{const bytes=readFileSync(path);check(bytes.length<=limit,'输入文件过大');return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''))}
const catalog=readJson(join(directory,'datasets/index.json'))
const args=process.argv.slice(2),selected=[];let observations=null
for(let i=0;i<args.length;i++) {
  if(args[i]==='--list'){console.log(JSON.stringify(catalog,null,2));process.exit(0)}
  if(args[i]==='--dataset'){check(args[i+1],'--dataset 缺少参数');selected.push(args[++i])}
  else if(args[i]==='--observations'){check(args[i+1]&&!observations,'--observations 缺少参数或重复');observations=validateObservations(readJson(resolve(args[++i]),25_000_000))}
  else throw new Error('未知参数：'+args[i]+'；支持 --list、--dataset ID/JSON路径、--observations JSON路径')
}
const files=(selected.length?selected:catalog.datasets.map(d=>d.id)).map(value=>{
  const entry=catalog.datasets.find(d=>d.id===value)
  return entry?join(directory,'datasets',entry.file):resolve(value)
})
check(files.length<=20,'一次最多 20 个测试集')
const adapter=await import('./adapters/knowledge.mjs')
const datasets=files.map(path=>runDataset(readJson(path),adapter,observations))
check(new Set(datasets.map(d=>d.datasetId)).size===datasets.length,'数据集 ID 重复')
if(observations)check(observations.runs.every(r=>datasets.some(d=>d.datasetId===r.datasetId)),'观测包含本次未选择的数据集')

// The only write destination. No --db or arbitrary output directory is supported.
const reportsRoot=join(root,'backtest-reports')
if(existsSync(reportsRoot))check(!lstatSync(reportsRoot).isSymbolicLink(),'报告目录不能是链接')
mkdirSync(reportsRoot,{recursive:true})
check(realpathSync(reportsRoot).toLowerCase()===resolve(reportsRoot).toLowerCase(),'报告目录必须位于当前工程')
const runId=new Date().toISOString().replaceAll(':','-').replaceAll('.','-')+'-'+randomUUID().slice(0,8),output=join(reportsRoot,runId)
mkdirSync(output)
mkdirSync(join(output,'datasets'))
const fingerprintFiles=['backtesting/contracts.mjs','backtesting/runner.mjs','backtesting/metrics.mjs','backtesting/report.mjs','backtesting/run.mjs','backtesting/adapters/knowledge.mjs','lib/modules/knowledge-core/read-only.js','lib/modules/knowledge-core/retrieval.js','lib/modules/knowledge-core/model-codecs.js','lib/modules/knowledge-core/validation.js','lib/modules/knowledge-query/read-only.js','lib/modules/knowledge-query/validation.js','lib/modules/worldbuilding/read-only.js','lib/modules/worldbuilding/domain/query.js','lib/modules/worldbuilding/domain/world.js','lib/modules/worldbuilding/domain/tree.js','lib/modules/worldbuilding/contracts/index.js','lib/shared/contracts/index.js']
const codeHashes=Object.fromEntries(fingerprintFiles.map(p=>[p,hash(readFileSync(join(root,p),'utf8'))]))
const run={schemaVersion:'backtest-run-v1',runId,engineFingerprint:hash(codeHashes),codeHashes,observationHash:observations?hash(observations):null,
  execution:{database:'not_connected',network:'not_used',configurationApplied:false,observationOrigin:observations?.origin??'none'},metricCatalog,datasets}
const write=(name,value)=>{check(!relative(output,join(output,name)).startsWith('..'),'输出越界');writeFileSync(join(output,name),value,{encoding:'utf8',flag:'wx'})}
write('report.json',JSON.stringify(run,null,2)+'\n');write('report.md',markdown(run));write('metrics.csv','\uFEFF'+csv(datasets))
write('model-requests.json',JSON.stringify({schemaVersion:'backtest-model-tasks-v1',tasks:datasets.flatMap(d=>d.requests)},null,2)+'\n')
for(const d of datasets)write('datasets/'+d.datasetId+'.json',JSON.stringify(d,null,2)+'\n')
console.log(JSON.stringify({output,report:join(output,'report.md'),datasets:datasets.map(d=>({id:d.datasetId,cases:d.cases,status:d.status,selection:d.selection})),database:'not_connected'},null,2))
if(datasets.some(d=>d.status==='failed'))process.exitCode=1
