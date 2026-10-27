import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { canonicalJson, nonempty, requireValue, parseExecutionRequest,
  type VersionRef, type StoredArtifact, type Owner, type ExecutionRecord, type ExecutionAttempt,
  type ExecutionSnapshot, type ExecutionTransaction, type AttemptUpdate, type JsonValue } from '../../shared/contracts/index.js'

type Row = Record<string, SQLOutputValue>
const terminal = (status: string) => ['succeeded', 'failed', 'cancelled'].includes(status)
/** Physical execution records only. The execution provider owns dispatch and interpretation. */
export function executionStore(db: DatabaseSync, project: string, owner: Owner | null,
  check: () => void, ref: (id: string) => VersionRef, read: (ref: VersionRef) => StoredArtifact): ExecutionTransaction {
  const write = (required: Owner = 'execution') => { check(); requireValue(owner === required, 'OWNER_MISMATCH', 'Execution write belongs to ' + required) }
  const time = (now: number) => requireValue(Number.isSafeInteger(now) && now >= 0, 'INVALID_INPUT', 'Invalid execution clock')
  const attemptRow = (id: string) => {
    check(); nonempty(id, 'attemptId')
    const row = db.prepare(`SELECT a.*,c.* FROM task_attempts a JOIN execution_controls c ON c.attempt_id=a.id
      WHERE a.id=? AND a.project_id=?`).get(id, project)
    requireValue(row, 'NOT_FOUND', 'Execution attempt is not in this project'); return row
  }
  const attempt = (row: Row): ExecutionAttempt => ({ id: String(row.id), taskId: String(row.task_id), number: Number(row.attempt_no),
    status: row.status as ExecutionAttempt['status'], worker: String(row.worker), fence: Number(row.fence),
    dispatchFence: row.dispatch_fence === null ? null : Number(row.dispatch_fence), leaseUntil: Number(row.lease_until),
    cancelRequested: Boolean(row.cancel_requested), retryable: Boolean(row.retryable), failureCode: row.failure_code as string | null,
    retryAt: Number(row.retry_at), output: row.output_version_id ? ref(String(row.output_version_id)) : null,
    receipt: row.receipt_version_id ? ref(String(row.receipt_version_id)) : null })
  const getExecution = (taskId: string): ExecutionRecord | null => {
    check(); nonempty(taskId, 'taskId')
    const row = db.prepare(`SELECT r.*,t.run_id,t.attempt_budget FROM execution_requests r JOIN workflow_tasks t ON t.id=r.task_id
      WHERE r.task_id=? AND r.project_id=?`).get(taskId, project)
    if (!row) return null
    const budget = db.prepare('SELECT * FROM execution_run_budgets WHERE run_id=? AND project_id=?').get(row.run_id!, project)
    const used = db.prepare(`SELECT COUNT(*) AS attempts,COALESCE(SUM(c.reserved_output_tokens),0) AS tokens FROM task_attempts a
      JOIN workflow_tasks t ON t.id=a.task_id LEFT JOIN execution_controls c ON c.attempt_id=a.id WHERE t.run_id=? AND t.project_id=?`).get(row.run_id!, project)!
    return { taskId, runId: String(row.run_id), request: ref(String(row.request_version_id)),
      budget: { maxAttempts: Number(budget?.max_attempts ?? 0), maxOutputTokens: Number(budget?.max_output_tokens ?? 0),
        usedAttempts: Number(used.attempts), reservedOutputTokens: Number(used.tokens), taskMaxAttempts: Number(row.attempt_budget) },
      attempts: db.prepare(`SELECT a.*,c.* FROM task_attempts a JOIN execution_controls c ON c.attempt_id=a.id
        WHERE a.task_id=? AND a.project_id=? ORDER BY a.attempt_no`).all(taskId, project).map(attempt) }
  }
  const request = (taskId: string) => {
    const record = getExecution(taskId); requireValue(record, 'NOT_FOUND', 'No frozen execution request')
    const data = read(record.request).payload
    requireValue(data.format === 'json', 'CONTENT_CORRUPT', 'Execution request must be JSON')
    return parseExecutionRequest(data.value)
  }
  const snapshot: ExecutionSnapshot = {
    getExecution,
    executionTasks: () => { check(); return db.prepare('SELECT task_id FROM execution_requests WHERE project_id=? ORDER BY task_id').all(project).map(row => String(row.task_id)) },
    executionEvidence: (id: string) => {
      attemptRow(id)
      return db.prepare('SELECT * FROM execution_evidence WHERE attempt_id=? AND project_id=? ORDER BY sequence').all(id, project).map(row => ({
        sequence: Number(row.sequence), attemptId: id, fence: Number(row.fence), key: String(row.evidence_key), type: String(row.evidence_type),
        payload: JSON.parse(String(row.payload_json)), quarantined: Boolean(row.quarantined), time: Number(row.observed_at),
      }))
    },
  }
  return {
    ...snapshot,
    configureExecutionBudget: (runId, budget) => {
      write('workflow'); nonempty(runId, 'runId')
      for (const n of [budget.maxAttempts, budget.maxOutputTokens]) requireValue(Number.isSafeInteger(n) && n > 0, 'INVALID_INPUT', 'Explicit positive run budget required')
      db.prepare('INSERT INTO execution_run_budgets(run_id,project_id,max_attempts,max_output_tokens) VALUES (?,?,?,?)')
        .run(runId, project, budget.maxAttempts, budget.maxOutputTokens)
    },
    registerExecution: (taskId, input) => {
      write(); const data = read(input)
      requireValue(data.owner === 'execution' && input.kind === 'execution_request' && data.payload.format === 'json', 'OWNER_MISMATCH', 'Expected owned execution request')
      parseExecutionRequest(data.payload.value)
      requireValue(!db.prepare('SELECT 1 FROM task_attempts WHERE task_id=?').get(taskId), 'STATE_CONFLICT', 'Existing attempts require explicit legacy reconciliation')
      db.prepare('INSERT INTO execution_requests(task_id,project_id,request_version_id) VALUES (?,?,?)').run(taskId, project, input.versionId)
    },
    reserveAttempt: (taskId, worker, now) => {
      write(); time(now); nonempty(worker, 'worker'); const spec = request(taskId)
      const job = getExecution(taskId)!
      const task = db.prepare(`SELECT t.*,r.status AS run_status FROM workflow_tasks t JOIN workflow_runs r ON r.id=t.run_id
        WHERE t.id=? AND t.project_id=?`).get(taskId, project)!
      requireValue(task.admission_status === 'ready' && !['completed','failed','cancelled'].includes(String(task.run_status)), 'STATE_CONFLICT', 'Workflow has not admitted this task')
      const last = job.attempts.at(-1)
      requireValue(!last || (last.status === 'failed' && last.retryable && !last.cancelRequested && last.retryAt <= now), 'STATE_CONFLICT', 'Prior attempt is unresolved, terminal, or not retryable yet')
      requireValue(job.attempts.length < Math.min(spec.policy.maxAttempts, Number(task.attempt_budget)), 'STATE_CONFLICT', 'Task attempt budget exhausted')
      const budget = db.prepare('SELECT * FROM execution_run_budgets WHERE run_id=? AND project_id=?').get(job.runId, project)
      requireValue(budget, 'STATE_CONFLICT', 'Workflow must freeze a run execution budget before dispatch')
      const used = db.prepare(`SELECT COUNT(*) AS attempts,COUNT(c.attempt_id) AS managed,COALESCE(SUM(c.reserved_output_tokens),0) AS tokens
        FROM task_attempts a JOIN workflow_tasks t ON t.id=a.task_id LEFT JOIN execution_controls c ON c.attempt_id=a.id
        WHERE t.run_id=? AND t.project_id=?`).get(job.runId, project)!
      requireValue(used.attempts === used.managed, 'STATE_CONFLICT', 'Run contains legacy attempts without accountable reservations')
      requireValue(Number(used.attempts) < Number(budget.max_attempts) && Number(used.tokens) + spec.maxTokens <= Number(budget.max_output_tokens), 'STATE_CONFLICT', 'Run budget exhausted (unknown attempts remain reserved)')
      const id = randomUUID()
      db.prepare(`INSERT INTO task_attempts(id,project_id,task_id,attempt_no,input_version_id,provider,model) VALUES (?,?,?,?,?,?,?)`)
        .run(id, project, taskId, job.attempts.length + 1, job.request.versionId, spec.provider, spec.model)
      db.prepare(`INSERT INTO execution_controls(attempt_id,project_id,worker,fence,lease_until,reserved_output_tokens) VALUES (?,?,?,1,?,?)`)
        .run(id, project, worker, now + spec.policy.leaseMs, spec.maxTokens)
      return attempt(attemptRow(id))
    },
    claimAttempt: (id, worker, now) => {
      write(); time(now); nonempty(worker, 'worker'); const row = attemptRow(id)
      requireValue(!terminal(String(row.status)), 'STATE_CONFLICT', 'Terminal attempt cannot be claimed')
      requireValue(row.worker === worker || Number(row.lease_until) <= now, 'STATE_CONFLICT', 'Execution lease is held by another worker')
      const expired = Number(row.lease_until) <= now
      db.prepare('UPDATE execution_controls SET worker=?,fence=fence+?,lease_until=? WHERE attempt_id=?')
        .run(worker, expired ? 1 : 0, now + request(String(row.task_id)).policy.leaseMs, id)
      if (expired && row.status === 'running') db.prepare("UPDATE task_attempts SET status='unknown' WHERE id=?").run(id)
      return attempt(attemptRow(id))
    },
    requestAttemptCancel: id => {
      write(); const row = attemptRow(id)
      requireValue(!terminal(String(row.status)), 'STATE_CONFLICT', 'Execution is already terminal')
      db.prepare('UPDATE execution_controls SET cancel_requested=1 WHERE attempt_id=?').run(id)
    },
    updateAttempt: (id, worker, fence, now, update: AttemptUpdate) => {
      write(); time(now); const row = attemptRow(id)
      requireValue(row.worker === worker && row.fence === fence && Number(row.lease_until) > now, 'STATE_CONFLICT', 'Execution fence or lease is stale')
      requireValue(!terminal(String(row.status)), 'STATE_CONFLICT', 'Terminal attempt is immutable')
      const status = update.status ?? String(row.status)
      const allowed: Record<string, string[]> = { prepared: ['prepared','running','failed','cancelled'], running: ['running','succeeded','failed','unknown','cancelled'], unknown: ['unknown','succeeded','failed','cancelled'] }
      requireValue(allowed[String(row.status)]?.includes(status), 'STATE_CONFLICT', 'Invalid attempt transition')
      if (update.dispatch) requireValue(row.status === 'prepared' && row.dispatch_fence === null && !row.cancel_requested && status === 'running', 'STATE_CONFLICT', 'Attempt cannot dispatch twice or after cancellation')
      if (update.dispatch) {
        const state = db.prepare('SELECT t.admission_status,r.status FROM workflow_tasks t JOIN workflow_runs r ON r.id=t.run_id WHERE t.id=?').get(row.task_id!)!
        requireValue(state.admission_status === 'ready' && !['cancelled','failed','completed'].includes(String(state.status)), 'STATE_CONFLICT', 'Workflow admission was withdrawn')
      }
      if (update.output) requireValue(read(update.output).owner === 'execution' && update.output.kind === 'execution_output', 'OWNER_MISMATCH', 'Invalid execution output')
      if (update.receipt) requireValue(read(update.receipt).owner === 'execution' && update.receipt.kind === 'execution_receipt', 'OWNER_MISMATCH', 'Invalid execution receipt')
      requireValue(!terminal(status) || update.receipt, 'INVALID_INPUT', 'Terminal execution requires an immutable receipt')
      requireValue(status !== 'succeeded' || (update.output && !row.cancel_requested), 'STATE_CONFLICT', 'Cancelled or empty execution cannot succeed')
      db.prepare(`UPDATE task_attempts SET status=?,output_version_id=COALESCE(?,output_version_id),receipt_version_id=COALESCE(?,receipt_version_id),
        started_at=CASE WHEN ? THEN COALESCE(started_at,?) ELSE started_at END,finished_at=CASE WHEN ? THEN ? ELSE finished_at END WHERE id=?`)
        .run(status, update.output?.versionId ?? null, update.receipt?.versionId ?? null, update.dispatch ? 1 : 0, new Date(now).toISOString(), terminal(status) ? 1 : 0, new Date(now).toISOString(), id)
      db.prepare(`UPDATE execution_controls SET dispatch_fence=CASE WHEN ? THEN ? ELSE dispatch_fence END,
        lease_until=?,cancel_requested=?,retryable=?,failure_code=?,retry_at=? WHERE attempt_id=?`)
        .run(update.dispatch ? 1 : 0, fence, now + request(String(row.task_id)).policy.leaseMs,
          row.cancel_requested || update.cancelRequested ? 1 : 0, update.retryable ?? Boolean(row.retryable) ? 1 : 0,
          update.failureCode === undefined ? row.failure_code! : update.failureCode, update.retryAt ?? row.retry_at!, id)
      return attempt(attemptRow(id))
    },
    recordExecutionEvidence: (id, fence, key, type, payload, now) => {
      write(); time(now); nonempty(key, 'evidence key'); nonempty(type, 'evidence type'); const row = attemptRow(id)
      requireValue(Number.isSafeInteger(fence) && fence > 0 && fence <= Number(row.fence), 'INVALID_INPUT', 'Invalid evidence fence')
      const encoded = canonicalJson(payload)
      const prior = db.prepare('SELECT * FROM execution_evidence WHERE attempt_id=? AND evidence_key=?').get(id, key)
      if (prior) {
        requireValue(prior.fence === fence && prior.evidence_type === type && prior.payload_json === encoded, 'IDEMPOTENCY_CONFLICT', 'Evidence key was reused'); return
      }
      db.prepare('INSERT INTO execution_evidence(attempt_id,project_id,fence,evidence_key,evidence_type,payload_json,quarantined,observed_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, project, fence, key, type, encoded, row.fence !== fence || terminal(String(row.status)) || Number(row.lease_until) <= now ? 1 : 0, now)
    },
  }
}
