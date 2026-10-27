-- Only the explicit initializer applies this migration. Existing payloads remain untouched.
CREATE TABLE execution_run_budgets (
  run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
  max_attempts INTEGER NOT NULL CHECK(max_attempts > 0),
  max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens > 0),
  FOREIGN KEY(run_id, project_id) REFERENCES workflow_runs(id, project_id)
) STRICT;
CREATE TABLE execution_requests (
  task_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, request_version_id TEXT NOT NULL,
  FOREIGN KEY(task_id, project_id) REFERENCES workflow_tasks(id, project_id),
  FOREIGN KEY(request_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;
CREATE TABLE execution_controls (
  attempt_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
  worker TEXT NOT NULL, fence INTEGER NOT NULL CHECK(fence > 0),
  dispatch_fence INTEGER, lease_until INTEGER NOT NULL,
  reserved_output_tokens INTEGER NOT NULL CHECK(reserved_output_tokens > 0),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  retryable INTEGER NOT NULL DEFAULT 0 CHECK(retryable IN (0,1)),
  failure_code TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(attempt_id, project_id) REFERENCES task_attempts(id, project_id)
) STRICT;
CREATE TABLE execution_evidence (
  sequence INTEGER PRIMARY KEY, attempt_id TEXT NOT NULL, project_id TEXT NOT NULL,
  fence INTEGER NOT NULL, evidence_key TEXT NOT NULL, evidence_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  quarantined INTEGER NOT NULL CHECK(quarantined IN (0,1)), observed_at INTEGER NOT NULL,
  UNIQUE(attempt_id, evidence_key),
  FOREIGN KEY(attempt_id, project_id) REFERENCES task_attempts(id, project_id)
) STRICT;
CREATE INDEX idx_execution_recovery ON execution_controls(project_id, lease_until);
CREATE TRIGGER execution_request_no_update BEFORE UPDATE ON execution_requests
BEGIN SELECT RAISE(ABORT, 'execution request is frozen'); END;
CREATE TRIGGER execution_request_no_delete BEFORE DELETE ON execution_requests
BEGIN SELECT RAISE(ABORT, 'execution request is frozen'); END;
CREATE TRIGGER execution_budget_no_update BEFORE UPDATE ON execution_run_budgets
BEGIN SELECT RAISE(ABORT, 'run budget is frozen'); END;
CREATE TRIGGER execution_budget_no_delete BEFORE DELETE ON execution_run_budgets
BEGIN SELECT RAISE(ABORT, 'run budget is frozen'); END;
CREATE TRIGGER execution_evidence_no_update BEFORE UPDATE ON execution_evidence
BEGIN SELECT RAISE(ABORT, 'execution evidence is immutable'); END;
CREATE TRIGGER execution_evidence_no_delete BEFORE DELETE ON execution_evidence
BEGIN SELECT RAISE(ABORT, 'execution evidence is immutable'); END;
