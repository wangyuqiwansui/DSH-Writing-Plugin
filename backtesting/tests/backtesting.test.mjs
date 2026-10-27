import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { validateDataset, hash } from '../contracts.mjs'
import { runDataset, validateObservations } from '../runner.mjs'
import { metric, retrievalScores } from '../metrics.mjs'
import { markdown, csv } from '../report.mjs'
import * as adapter from '../adapters/knowledge.mjs'
import { chunkText } from '../../lib/modules/knowledge-core/retrieval.js'
import { knowledgeDataset, knowledgeTemplate, reconstructText, worldDataset, worldTemplate } from '../../lib/modules/test-datasets/index.js'

const fixture=id=>JSON.parse(readFileSync(new URL('../datasets/'+id+'.json',import.meta.url),'utf8'))
const observed=runs=>({schemaVersion:'backtest-observations-v1',origin:'fixture',note:'Scorer verification only; not live model evidence.',runs})
const response=(task,dataset,options={})=>{
 const c=dataset.cases.find(c=>c.id===task.caseId),gold=c.expected[0]
 const output=gold?{status:'answered',claims:[{text:options.text??gold.quote,citations:[{evidenceId:gold.documentId+':c1',quote:options.quote??gold.quote}]}],missing:[]}:{status:'insufficient',claims:[],missing:['缺少资料']}
 return {datasetId:task.datasetId,datasetHash:task.datasetHash,taskId:task.taskId,packetHash:task.packetHash,model:{provider:'fixture',model:'fixed',configuration:'v1'},output:JSON.stringify(output),...options.observation}
}

test('metric denominators separate positive, negative and unmeasured cases',()=>{
 const score=retrievalScores(['a','b'],['noise','a'],(a,b)=>a===b)
 assert.equal(score.recall,.5);assert.equal(score.precision,.5);assert.equal(score.complete,false);assert.equal(score.reciprocalRank,.5)
 assert.equal(retrievalScores([],[],()=>false).noAnswer,true)
 assert.equal(retrievalScores([],[],()=>false).recall,null)
 assert.deepEqual(metric([null,undefined],'not_run'),{value:null,numerator:0,denominator:0,status:'not_run'})
 assert.deepEqual(metric([1,0,null]),{value:.5,numerator:1,denominator:2,status:'measured'})
})

test('all registered datasets validate; results are tied to dataset hashes without mutating inputs',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../datasets/index.json',import.meta.url),'utf8'))
 for(const entry of catalog.datasets){const d=fixture(entry.id),before=JSON.stringify(d),result=runDataset(d,adapter);assert.equal(result.datasetId,entry.id);assert.equal(result.datasetHash,hash(validateDataset(d)));assert.equal(JSON.stringify(d),before);assert.equal(result.cases,entry.cases);assert.notEqual(result.status,'failed')}
})

test('retrieval selection uses dev only; negative-only and unreviewed datasets never recommend a policy',()=>{
 const data=fixture('knowledge-retrieval'),first=runDataset(data,adapter)
 const changed=structuredClone(data);changed.cases=changed.cases.map(c=>c.split==='test'?{...c,question:'不存在的词 '+c.id}:c)
 assert.deepEqual(runDataset(changed,adapter).selection,first.selection)
 assert.equal(first.selection.strategy,'enriched');assert.equal(first.selection.applied,false)
 assert.equal(runDataset(fixture('knowledge-no-answer'),adapter).selection,null)
 data.provenance.reviewed=false;assert.equal(runDataset(data,adapter).selection,null)
})

test('partial model replay keeps unobserved tasks unmeasured and semantic review independent from citation scores',()=>{
 const data=fixture('model-quality'),plan=runDataset(data,adapter),task=plan.requests.find(t=>t.caseId==='g1'&&t.stage==='gold'&&t.format==='json'&&t.repeat===1)
 assert.equal(plan.status,'not_run');assert.equal(plan.groups[0].metrics.output_valid_rate.value,null)
 const record=response(task,data,{text:'留声石可以记录画面。',observation:{review:{reviewer:'test-human',correct:false,supported:false,ruleViolation:true}}})
 const replay=runDataset(data,adapter,observed([record])),row=replay.rows.find(r=>r.taskId===task.taskId),group=replay.groups.find(g=>g.split==='dev'&&g.stage==='gold'&&g.format==='json')
 assert.equal(replay.status,'partial');assert.equal(row.valid,true);assert.equal(row.citationRecall,1)
 assert.equal(group.metrics.answer_correct_rate.value,0);assert.equal(group.metrics.rule_violation_rate.value,1)
 assert.equal(group.metrics.injection_success_rate.value,null)
 assert.ok(group.metrics.completion_rate.value<1)
})

test('citation recall requires the actual quoted gold span, not just a correct chunk ID',()=>{
 const data=fixture('model-quality'),plan=runDataset(data,adapter),task=plan.requests.find(t=>t.caseId==='g1'&&t.stage==='gold')
 const result=runDataset(data,adapter,observed([response(task,data,{quote:'仅能记录声音'})]))
 const row=result.rows.find(r=>r.taskId===task.taskId);assert.equal(row.valid,true);assert.equal(row.citationRecall,0)
})

test('replay rejects mismatched snapshots, packets, duplicate tasks and mixed model configurations',()=>{
 const data=fixture('model-quality'),plan=runDataset(data,adapter),r=response(plan.requests[0],data)
 assert.throws(()=>runDataset(data,adapter,observed([{...r,datasetHash:'wrong'}])),/不同测试集/)
 assert.throws(()=>runDataset(data,adapter,observed([{...r,packetHash:'wrong'}])),/不同测试集/)
 assert.throws(()=>validateObservations(observed([r,r])),/重复/)
 const other=response(plan.requests[1],data);other.model.model='other'
 assert.throws(()=>runDataset(data,adapter,observed([r,other])),/混用/)
 assert.throws(()=>runDataset(data,adapter,observed([{...r,taskId:'unknown'}])),/未知任务/)
})

test('attack-marker checks and reviewed attack success are separate and never inferred from missing model runs',()=>{
 const data=fixture('prompt-injection'),plan=runDataset(data,adapter),task=plan.requests[0],marker=data.cases[0].attack.marker
 assert.equal(plan.status,'not_run')
 const result=runDataset(data,adapter,observed([response(task,data,{text:marker})]))
 const group=result.groups.find(g=>g.split==='dev'&&g.stage==='gold'&&g.format==='json')
 assert.equal(group.metrics.raw_marker_rate.value,1);assert.equal(group.metrics.accepted_marker_rate.value,1)
 assert.equal(group.metrics.injection_success_rate.value,null)
})

test('call errors and malformed outputs have explicit denominators',()=>{
 const data=fixture('model-quality'),plan=runDataset(data,adapter),bad=response(plan.requests[0],data);bad.output='{broken'
 const error=response(plan.requests[1],data);delete error.output;error.error='timeout'
 const result=runDataset(data,adapter,observed([bad,error])),group=result.groups.find(g=>g.split==='dev'&&g.stage==='gold'&&g.format==='json')
 assert.equal(group.metrics.request_error_rate.value,.5)
 assert.equal(group.metrics.invalid_output_rate.value,1)
 assert.equal(group.metrics.invalid_output_rate.denominator,1)
})

test('dataset exports reconstruct Unicode overlap and conform to the runner contract without remote services',()=>{
 const text='𠮷😀港口规则。'.repeat(180),docs=['one','two'].map(id=>({id,title:id,chunks:chunkText(text).map(c=>({...c,title:id,summary:'规则摘要',keywords:['港口']}))}))
 assert.equal(reconstructText(docs[0].chunks),text)
 const snapshot=JSON.stringify(docs),exported=knowledgeDataset(docs,knowledgeTemplate(docs),true)
 assert.equal(validateDataset(exported).kind,'retrieval');assert.equal(runDataset(exported,adapter).status,'completed');assert.equal(JSON.stringify(docs),snapshot)
 const broken=structuredClone(docs[0].chunks);broken[1].text='x'+broken[1].text.slice(1);assert.throws(()=>reconstructText(broken),/定位|不一致/)
 const world=fixture('world-tree').world,worldExport=worldDataset(world,worldTemplate(world),false)
 assert.equal(validateDataset(worldExport).kind,'world-query');assert.equal(runDataset(worldExport,adapter).status,'completed')
})

test('reports preserve dataset identities, null metrics and formula-safe CSV',()=>{
 const report=runDataset(fixture('prompt-injection'),adapter),run={runId:'test',engineFingerprint:'test',datasets:[report]}
 assert.match(markdown(run),/not_run/);assert.match(markdown(run),/prompt-injection/)
 assert.match(csv([report]),/"injection_success_rate"/)
})

test('execution dependency graph contains no database, network or production mutation services',()=>{
 const visited=new Set()
 function visit(path){path=resolve(path);if(visited.has(path))return;visited.add(path);const source=readFileSync(path,'utf8')
   assert.doesNotMatch(source,/node:(?:sqlite|fs|http|https|net)|\bfetch\s*\(|KnowledgeKernel|WritingMiddleware|\.command\s*\(/,path)
   const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
   for(const node of ast.statements)if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){const spec=node.moduleSpecifier.text;if(spec.startsWith('.'))visit(resolve(dirname(path),spec));else assert.equal(spec,'node:crypto',path)}
 }
 visit('backtesting/runner.mjs');visit('backtesting/adapters/knowledge.mjs')
 for(const name of ['index.ts','client.tsx'])assert.doesNotMatch(readFileSync('src/modules/test-datasets/'+name,'utf8'),/\.invoke\s*\(|fetch\s*\(|localStorage|writingStorage|backtesting\/runner/)
 const knowledge=readFileSync('src/modules/knowledge-core/service.ts','utf8');assert.doesNotMatch(knowledge,/backtesting|EvalReport|action==='evaluate'|action==='profile'/)
 assert.match(readFileSync('.gitignore','utf8'),/^\/backtest-reports\/$/m)
})

test('CLI rejects database arguments and cannot create the requested database',()=>{
 const path=resolve('backtest-reports/forbidden-test.sqlite3');assert.equal(existsSync(path),false)
 const run=spawnSync(process.execPath,['backtesting/run.mjs','--db',path],{encoding:'utf8',windowsHide:true})
 assert.notEqual(run.status,0);assert.match(run.stderr,/未知参数/);assert.equal(existsSync(path),false)
})
