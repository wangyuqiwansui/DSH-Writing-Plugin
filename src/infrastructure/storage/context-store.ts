import type { DatabaseSync } from 'node:sqlite'
import {
  CONTEXT_PHASES, canonicalJson, nonempty, requireValue,
  type AppendArtifact, type ContextBudget, type ContextCall, type ContextGuard, type ContextMember,
  type ContextPhase, type ContextRun, type ContextStorageTransaction, type Head, type JsonValue,
  type Owner, type StoredArtifact, type VersionRef,
} from '../../shared/contracts/index.js'

type Row = Record<string, unknown>
const json = (v: unknown): JsonValue => JSON.parse(canonicalJson(v)) as JsonValue
function integer(v: number, name: string, minimum = 0) {
  requireValue(Number.isSafeInteger(v) && v >= minimum, 'INVALID_INPUT', name + ' must be a bounded integer')
}
const transitions: Record<ContextPhase, readonly ContextPhase[]> = {
  preparing: ['deciding','blocked','cancelling'], deciding: ['reading','checking','blocked','unknown','cancelling'],
  reading: ['deciding','blocked','unknown','cancelling'], checking: ['deciding','ready','blocked','cancelling'],
  ready: ['stale'], blocked: ['preparing','deciding','cancelling','stale'], unknown: ['deciding','blocked','cancelling'],
  cancelling: ['cancelled','unknown'], cancelled: [], stale: [],
}

/** Trusted domain port; no SQL connection or model-visible authorization token escapes. */
export function contextStore(db: DatabaseSync, project: string, owner: Owner | null, check: () => void,
  refOf: (id: string) => VersionRef, read: (ref: VersionRef) => StoredArtifact,
  append: (input: AppendArtifact) => VersionRef): ContextStorageTransaction {
  const write = () => { check(); requireValue(owner === 'context','OWNER_MISMATCH','Context owns discovery storage') }
  function row(id: string): Row {
    check(); nonempty(id,'runId')
    const r = db.prepare('SELECT * FROM context_runs WHERE project_id=? AND id=?').get(project,id)
    requireValue(r,'NOT_FOUND','Context run not found in project'); return r
  }
  function view(r: Row): ContextRun {
    return { id: String(r.id), phase: r.phase as ContextPhase, revision: Number(r.revision), worker: r.worker as string | null,
      fence: Number(r.fence), leaseUntil: Number(r.lease_until), snapshotRef: refOf(String(r.snapshot_version_id)),
      scope: JSON.parse(String(r.scope_json)), budget: JSON.parse(String(r.budget_json)),
      checkpoint: r.checkpoint_version_id ? refOf(String(r.checkpoint_version_id)) : null, stopReason: r.stop_reason as string | null }
  }
  function guard(g: ContextGuard, allowExpiredBudget = false): Row {
    write(); integer(g.expectedRevision,'expectedRevision',1); integer(g.fence,'fence',1); integer(g.now,'now'); nonempty(g.worker,'worker')
    const r=row(g.runId)
    requireValue(r.revision===g.expectedRevision,'HEAD_CONFLICT','Context revision changed')
    requireValue(r.worker===g.worker && r.fence===g.fence && Number(r.lease_until)>g.now,'STATE_CONFLICT','Context lease expired or superseded')
    const budget=JSON.parse(String(r.budget_json)) as ContextBudget
    requireValue(allowExpiredBudget || g.now<budget.deadline,'STATE_CONFLICT','Context deadline exceeded')
    return r
  }
  function event(id: string,type: string,data: unknown) {
    const sequence=Number(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS n FROM context_events WHERE project_id=? AND run_id=?').get(project,id)!.n)
    db.prepare('INSERT INTO context_events VALUES (?,?,?,?,?)').run(project,id,sequence,type,canonicalJson(data))
  }
  function bump(id: string,type: string,data: unknown): ContextRun {
    db.prepare('UPDATE context_runs SET revision=revision+1 WHERE project_id=? AND id=?').run(project,id)
    event(id,type,data); return view(row(id))
  }
  function contextArtifact(ref: VersionRef,kind: string) {
    const a=read(ref)
    requireValue(a.owner==='context' && a.ref.kind===kind,'OWNER_MISMATCH','Wrong context artifact kind')
    requireValue(a.payload.format==='json','INVALID_INPUT','Context artifact requires structured JSON'); return a
  }
  function boundArtifact(runId: string, ref: VersionRef, kind: string) {
    const a=contextArtifact(ref,kind)
    const value=a.payload.format==='json' ? a.payload.value : null
    requireValue(value!==null && typeof value==='object' && !Array.isArray(value),'INVALID_INPUT','Context payload must be an object')
    requireValue(value.runId===runId && canonicalJson(value.snapshotRef)===canonicalJson(view(row(runId)).snapshotRef),'VERSION_MISMATCH','Context payload belongs to another run or snapshot')
    return value
  }
  function heads(prefixes: string[]): Head[] {
    const rows=db.prepare('SELECT * FROM artifact_heads WHERE project_id=? ORDER BY head_key').all(project)
    return rows.filter(r=>prefixes.some(p=>String(r.head_key).startsWith(p))).map(r=>({ key:String(r.head_key),owner:r.owner as Owner,
      revision:Number(r.revision),versionId:String(r.version_id),ref:refOf(String(r.version_id)) }))
  }
  function decision(ref: VersionRef) {
    // rowid provides append order even for decisions recorded within the same millisecond.
    const d=db.prepare('SELECT id,decision FROM artifact_decisions WHERE project_id=? AND version_id=? ORDER BY rowid DESC LIMIT 1').get(project,ref.versionId)
    return {decisionId:d ? String(d.id):null,decision:d ? String(d.decision):null}
  }
  function members(id: string): ContextMember[] {
    row(id)
    return db.prepare('SELECT * FROM context_snapshot_members WHERE project_id=? AND run_id=? ORDER BY head_key').all(project,id)
      .map(r=>({head:JSON.parse(String(r.head_json)),decisionId:r.decision_id as string|null,decision:r.decision as string|null}))
  }
  function source(id: string,ref: VersionRef): StoredArtifact {
    row(id); const value=read(ref)
    requireValue(members(id).some(m=>canonicalJson(m.head.ref)===canonicalJson(ref)),'VERSION_MISMATCH','Source is not a frozen context member')
    requireValue(!['revoked','rejected'].includes(decision(ref).decision ?? ''),'STATE_CONFLICT','Frozen source was revoked or rejected')
    return value
  }
  function calls(id: string): ContextCall[] {
    row(id)
    return db.prepare(`SELECT c.*,b.reserved_input,b.reserved_output,b.used_input,b.used_output FROM context_calls c
      JOIN context_budget_reservations b ON b.project_id=c.project_id AND b.run_id=c.run_id AND b.call_id=c.id
      WHERE c.project_id=? AND c.run_id=? ORDER BY c.rowid`).all(project,id).map(r=>({id:String(r.id),kind:r.kind as ContextCall['kind'],
      parameters:JSON.parse(String(r.params_json)),status:r.status as ContextCall['status'],reservedInput:Number(r.reserved_input),reservedOutput:Number(r.reserved_output),
      usedInput:r.used_input as number|null,usedOutput:r.used_output as number|null,receipt:r.receipt_version_id ? refOf(String(r.receipt_version_id)):null}))
  }
  function call(id: string,callId: string) {
    nonempty(callId,'callId');const c=calls(id).find(c=>c.id===callId);requireValue(c,'NOT_FOUND','Context call not found');return c
  }
  function freshness(id: string) {
    const r=row(id), frozen=members(id), current=heads(JSON.parse(String(r.prefixes_json))),changed=new Set<string>()
    for(const m of frozen) {
      const h=current.find(h=>h.key===m.head.key)
      if(!h || canonicalJson(h)!==canonicalJson(m.head) || decision(m.head.ref).decisionId!==m.decisionId) changed.add(m.head.key)
    }
    for(const h of current) if(!frozen.some(m=>m.head.key===h.key)) changed.add(h.key)
    return {current:changed.size===0,changedKeys:[...changed].sort()}
  }
  return {
    getContextRun(id) { check();nonempty(id,'runId');const r=db.prepare('SELECT * FROM context_runs WHERE project_id=? AND id=?').get(project,id);return r ? view(r):null },
    contextMembers: members,readContextSource:source,contextCalls:calls,
    contextRounds(id) { row(id);return db.prepare('SELECT * FROM context_rounds WHERE project_id=? AND run_id=? ORDER BY round_no').all(project,id)
      .map(r=>({number:Number(r.round_no),packetRef:refOf(String(r.packet_version_id)),sourceRefs:JSON.parse(String(r.sources_json))})) },
    contextEvents(id) { row(id);return db.prepare('SELECT * FROM context_events WHERE project_id=? AND run_id=? ORDER BY sequence').all(project,id)
      .map(r=>({sequence:Number(r.sequence),type:String(r.type),data:JSON.parse(String(r.data_json))})) },
    contextFreshness:freshness,
    createContextRun(input) {
      write();nonempty(input.id,'id');integer(input.maxMembers,'maxMembers',1);requireValue(input.maxMembers<=10000,'INVALID_INPUT','Snapshot member limit too large')
      const b=input.budget;requireValue(b && typeof b==='object','INVALID_INPUT','Budget required')
      for(const k of ['maxModelCalls','maxToolCalls','maxInputTokens','maxOutputTokens','deadline'] as const) integer(b[k],k,1)
      requireValue(Object.keys(b).length===5,'INVALID_INPUT','Unknown budget fields')
      requireValue(Array.isArray(input.sourceHeadPrefixes) && input.sourceHeadPrefixes.length>0,'INVALID_INPUT','Explicit head prefixes required')
      const prefixes=[...new Set(input.sourceHeadPrefixes)].sort()
      for(const p of prefixes) { nonempty(p,'prefix');requireValue(/^(story|planning|writer|publication|knowledge)\./.test(p),'INVALID_INPUT','Only explicit source namespaces may be frozen') }
      const existing=db.prepare('SELECT id FROM context_runs WHERE project_id=? AND id=?').get(project,input.id)
      requireValue(!existing,'IDEMPOTENCY_CONFLICT','Context run already exists; replay original command')
      const selected=heads(prefixes);requireValue(selected.length<=input.maxMembers,'INVALID_INPUT','Snapshot too large')
      const frozen=selected.map(head=>{ read(head.ref);return {head,...decision(head.ref)} })
      requireValue(frozen.every(m=>!['revoked','rejected'].includes(m.decision ?? '')),'STATE_CONFLICT','Snapshot contains rejected sources')
      const manifest=append({key:'context.snapshot.'+input.id,kind:'context_snapshot',schemaVersion:'writing-context-snapshot-v1',
        payload:{format:'json',value:json({runId:input.id,scope:input.scope,prefixes,members:frozen})},sources:selected.map(h=>({ref:h.ref,relation:'snapshot_member'}))})
      db.prepare(`INSERT INTO context_runs(project_id,id,phase,revision,worker,fence,lease_until,snapshot_version_id,scope_json,prefixes_json,budget_json)
        VALUES (?,?,'preparing',1,NULL,0,0,?,?,?,?)`).run(project,input.id,manifest.versionId,canonicalJson(input.scope),canonicalJson(prefixes),canonicalJson(b))
      for(const m of frozen) db.prepare('INSERT INTO context_snapshot_members VALUES (?,?,?,?,?,?,?)')
        .run(project,input.id,m.head.key,m.head.ref.versionId,canonicalJson(m.head),m.decisionId,m.decision)
      event(input.id,'context.created',{snapshotRef:manifest,members:frozen.length});return view(row(input.id))
    },
    claimContextRun(id,expectedRevision,worker,now,leaseMs) {
      write();nonempty(worker,'worker');integer(now,'now');integer(leaseMs,'leaseMs',1);requireValue(leaseMs<=86400000,'INVALID_INPUT','Lease exceeds one day');integer(now+leaseMs,'leaseUntil');integer(expectedRevision,'revision',1)
      const r=row(id);requireValue(r.revision===expectedRevision,'HEAD_CONFLICT','Context revision changed')
      requireValue(!['cancelled','stale'].includes(String(r.phase)),'STATE_CONFLICT','Terminal run cannot be claimed')
      requireValue(r.worker===null || Number(r.lease_until)<=now || r.worker===worker,'STATE_CONFLICT','Another worker holds the lease')
      db.prepare('UPDATE context_runs SET worker=?,fence=fence+1,lease_until=?,revision=revision+1 WHERE project_id=? AND id=?').run(worker,now+leaseMs,project,id)
      event(id,'context.claimed',{worker,fence:Number(r.fence)+1});return view(row(id))
    },
    transitionContextRun(g,phase,reason,checkpoint) {
      const r=guard(g,true);nonempty(reason,'reason');requireValue(CONTEXT_PHASES.includes(phase),'INVALID_INPUT','Unknown context phase')
      requireValue(transitions[r.phase as ContextPhase].includes(phase),'STATE_CONFLICT','Illegal context transition')
      const pending=calls(g.runId).some(c=>['reserved','dispatched','unknown'].includes(c.status))
      if(['ready','cancelled','deciding'].includes(phase)) requireValue(!pending,'STATE_CONFLICT','Unsettled calls must be reconciled first')
      if(phase==='ready') {
        requireValue(freshness(g.runId).current,'VERSION_MISMATCH','Context source directory changed')
        requireValue(checkpoint,'INVALID_INPUT','Ready requires a discovery result')
        boundArtifact(g.runId,checkpoint,'discovery_result')
      }
      if(checkpoint) {const a=read(checkpoint);requireValue(a.owner==='context','OWNER_MISMATCH','Checkpoint owner mismatch')}
      db.prepare('UPDATE context_runs SET phase=?,stop_reason=?,checkpoint_version_id=?,revision=revision+1 WHERE project_id=? AND id=?')
        .run(phase,reason,checkpoint?.versionId ?? r.checkpoint_version_id as string|null,project,g.runId)
      event(g.runId,'context.transition',{from:r.phase,to:phase,reason});return view(row(g.runId))
    },
    recordContextRound(g,packet,sources) {
      const r=guard(g);requireValue(['preparing','deciding','reading','checking'].includes(String(r.phase)),'STATE_CONFLICT','Cannot append round in this phase')
      const packetData=boundArtifact(g.runId,packet,'context_packet');requireValue(Array.isArray(sources),'INVALID_INPUT','Source refs required')
      requireValue(canonicalJson(packetData.sourceRefs)===canonicalJson(sources),'VERSION_MISMATCH','Packet sources do not match recorded sources')
      requireValue(new Set(sources.map(s=>s.versionId)).size===sources.length,'INVALID_INPUT','Duplicate packet source')
      for(const ref of sources) {
        source(g.runId,ref)
        requireValue(db.prepare('SELECT 1 FROM artifact_dependencies WHERE project_id=? AND version_id=? AND source_version_id=?').get(project,packet.versionId,ref.versionId),'VERSION_MISMATCH','Packet lacks source dependency')
      }
      const n=Number(db.prepare('SELECT COALESCE(MAX(round_no),0)+1 AS n FROM context_rounds WHERE project_id=? AND run_id=?').get(project,g.runId)!.n)
      db.prepare('INSERT INTO context_rounds VALUES (?,?,?,?,?)').run(project,g.runId,n,packet.versionId,canonicalJson(sources))
      return bump(g.runId,'context.round_recorded',{round:n,packetRef:packet})
    },
    reserveContextCall(g,input) {
      const r=guard(g);requireValue(['deciding','reading','checking'].includes(String(r.phase)),'STATE_CONFLICT','Cannot reserve in this phase')
      nonempty(input.id,'callId');requireValue(input.kind==='model'||input.kind==='tool','INVALID_INPUT','Unknown call kind')
      integer(input.inputTokens,'inputTokens',input.kind==='model'?1:0);integer(input.outputTokens,'outputTokens',input.kind==='model'?1:0);const params=canonicalJson(input.parameters),all=calls(g.runId)
      const old=all.find(c=>c.id===input.id)
      if(old) {
        requireValue(old.kind===input.kind && canonicalJson(old.parameters)===params && old.reservedInput===input.inputTokens && old.reservedOutput===input.outputTokens,'IDEMPOTENCY_CONFLICT','Call identity reused with different request')
        return view(r)
      }
      requireValue(!all.some(c=>['reserved','dispatched','unknown'].includes(c.status)),'STATE_CONFLICT','Reconcile pending call before dispatching another')
      const b=JSON.parse(String(r.budget_json)) as ContextBudget
      requireValue(all.filter(c=>c.kind===input.kind).length<(input.kind==='model'?b.maxModelCalls:b.maxToolCalls),'STATE_CONFLICT','Call budget exhausted')
      const usedIn=all.reduce((n,c)=>n+(c.usedInput ?? c.reservedInput),0),usedOut=all.reduce((n,c)=>n+(c.usedOutput ?? c.reservedOutput),0)
      requireValue(usedIn+input.inputTokens<=b.maxInputTokens && usedOut+input.outputTokens<=b.maxOutputTokens,'STATE_CONFLICT','Token budget exhausted')
      db.prepare("INSERT INTO context_calls VALUES (?,?,?,?,?,'reserved',NULL)").run(project,g.runId,input.id,input.kind,params)
      db.prepare('INSERT INTO context_budget_reservations VALUES (?,?,?,?,?,NULL,NULL)').run(project,g.runId,input.id,input.inputTokens,input.outputTokens)
      return bump(g.runId,'context.call_reserved',{callId:input.id,kind:input.kind})
    },
    dispatchContextCall(g,id) {
      const r=guard(g);requireValue(['deciding','reading','checking'].includes(String(r.phase)),'STATE_CONFLICT','Dispatch forbidden in stopped run')
      const c=call(g.runId,id);requireValue(c.status==='reserved','STATE_CONFLICT','Call already dispatched')
      db.prepare("UPDATE context_calls SET status='dispatched' WHERE project_id=? AND run_id=? AND id=?").run(project,g.runId,id)
      return bump(g.runId,'context.call_dispatched',{callId:id})
    },
    markContextCallUnknown(g,id) {
      guard(g,true);requireValue(call(g.runId,id).status==='dispatched','STATE_CONFLICT','Only dispatched calls can become unknown')
      db.prepare("UPDATE context_calls SET status='unknown' WHERE project_id=? AND run_id=? AND id=?").run(project,g.runId,id)
      return bump(g.runId,'context.call_unknown',{callId:id})
    },
    settleContextCall(g,input) {
      guard(g,true);const c=call(g.runId,input.id)
      requireValue(['succeeded','failed','cancelled'].includes(input.status),'INVALID_INPUT','Invalid settlement status')
      integer(input.usedInput,'usedInput');integer(input.usedOutput,'usedOutput')
      const receipt=read(input.receipt)
      const metadata=receipt.metadata as Record<string,JsonValue> | null
      requireValue(metadata && metadata.contextRunId===g.runId && metadata.contextCallId===input.id,'VERSION_MISMATCH','Receipt is not bound to this logical call')
      requireValue(receipt.ref.kind===(c.kind==='model'?'execution_receipt':'context_read_receipt'),'OWNER_MISMATCH','Wrong receipt kind')
      if(['succeeded','failed','cancelled'].includes(c.status)) {
        requireValue(c.status===input.status && c.usedInput===input.usedInput && c.usedOutput===input.usedOutput && canonicalJson(c.receipt)===canonicalJson(input.receipt),'IDEMPOTENCY_CONFLICT','Settlement differs from recorded result')
        return view(row(g.runId))
      }
      requireValue(c.status!=='reserved' || (input.status==='cancelled' && input.usedInput===0 && input.usedOutput===0),'STATE_CONFLICT','Undispatched call may only be cancelled without consumption')
      // Actual usage is never discarded, even if it exceeds the estimate. Later reservations enforce the remaining budget.
      db.prepare('UPDATE context_calls SET status=?,receipt_version_id=? WHERE project_id=? AND run_id=? AND id=?').run(input.status,input.receipt.versionId,project,g.runId,input.id)
      db.prepare('UPDATE context_budget_reservations SET used_input=?,used_output=? WHERE project_id=? AND run_id=? AND call_id=?')
        .run(input.usedInput,input.usedOutput,project,g.runId,input.id)
      return bump(g.runId,'context.call_settled',json(input))
    },
    recordContextEvidence(g,ref,locator,evidence) {
      const r=guard(g);requireValue(['preparing','deciding','reading','checking'].includes(String(r.phase)),'STATE_CONFLICT','Evidence cannot change a stopped run')
      source(g.runId,ref);boundArtifact(g.runId,evidence,'context_read_receipt');const loc=canonicalJson(locator)
      requireValue(db.prepare('SELECT 1 FROM artifact_dependencies WHERE project_id=? AND version_id=? AND source_version_id=?').get(project,evidence.versionId,ref.versionId),'VERSION_MISMATCH','Evidence lacks source dependency')
      const old=db.prepare('SELECT evidence_version_id FROM context_evidence WHERE project_id=? AND run_id=? AND source_version_id=? AND locator_json=?').get(project,g.runId,ref.versionId,loc)
      if(old) {requireValue(old.evidence_version_id===evidence.versionId,'IDEMPOTENCY_CONFLICT','Evidence location already recorded');return view(row(g.runId))}
      db.prepare('INSERT INTO context_evidence VALUES (?,?,?,?,?)').run(project,g.runId,ref.versionId,loc,evidence.versionId)
      return bump(g.runId,'context.evidence_recorded',{sourceRef:ref,locator,evidenceRef:evidence})
    },
  }
}
