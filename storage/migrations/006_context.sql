-- Progressive discovery storage. No runtime initialization and no business data seeding.
CREATE TABLE artifact_owners_v6 (
 artifact_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
 owner TEXT NOT NULL CHECK(owner IN ('story','planning','writer','quality','publication','workflow','execution','knowledge','context')),
 FOREIGN KEY(artifact_id,project_id) REFERENCES artifacts(id,project_id)
) STRICT;
INSERT INTO artifact_owners_v6 SELECT artifact_id,project_id,owner FROM artifact_owners;
DROP TABLE artifact_owners;
ALTER TABLE artifact_owners_v6 RENAME TO artifact_owners;
CREATE TRIGGER artifact_owner_no_update BEFORE UPDATE ON artifact_owners BEGIN SELECT RAISE(ABORT,'artifact ownership is immutable'); END;
CREATE TRIGGER artifact_owner_no_delete BEFORE DELETE ON artifact_owners BEGIN SELECT RAISE(ABORT,'artifact ownership is immutable'); END;

CREATE TABLE context_runs (
 project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('preparing','deciding','reading','checking','ready','blocked','unknown','cancelling','cancelled','stale')),
 revision INTEGER NOT NULL CHECK(revision>0), worker TEXT, fence INTEGER NOT NULL CHECK(fence>=0), lease_until INTEGER NOT NULL CHECK(lease_until>=0),
 snapshot_version_id TEXT NOT NULL, scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
 prefixes_json TEXT NOT NULL CHECK(json_valid(prefixes_json)), budget_json TEXT NOT NULL CHECK(json_valid(budget_json)),
 checkpoint_version_id TEXT, stop_reason TEXT,
 PRIMARY KEY(project_id,id),
 FOREIGN KEY(snapshot_version_id,project_id) REFERENCES artifact_versions(id,project_id),
 FOREIGN KEY(checkpoint_version_id,project_id) REFERENCES artifact_versions(id,project_id)
) STRICT;
CREATE TABLE context_snapshot_members (
 project_id TEXT NOT NULL, run_id TEXT NOT NULL, head_key TEXT NOT NULL, source_version_id TEXT NOT NULL,
 head_json TEXT NOT NULL CHECK(json_valid(head_json)), decision_id TEXT, decision TEXT,
 PRIMARY KEY(project_id,run_id,head_key),
 FOREIGN KEY(project_id,run_id) REFERENCES context_runs(project_id,id),
 FOREIGN KEY(source_version_id,project_id) REFERENCES artifact_versions(id,project_id),
 FOREIGN KEY(decision_id) REFERENCES artifact_decisions(id)
) STRICT;
CREATE TABLE context_rounds (
 project_id TEXT NOT NULL,run_id TEXT NOT NULL,round_no INTEGER NOT NULL CHECK(round_no>0),packet_version_id TEXT NOT NULL,
 sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
 PRIMARY KEY(project_id,run_id,round_no),UNIQUE(project_id,run_id,packet_version_id),
 FOREIGN KEY(project_id,run_id) REFERENCES context_runs(project_id,id),
 FOREIGN KEY(packet_version_id,project_id) REFERENCES artifact_versions(id,project_id)
) STRICT;
CREATE TABLE context_calls (
 project_id TEXT NOT NULL,run_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('model','tool')),
 params_json TEXT NOT NULL CHECK(json_valid(params_json)),
 status TEXT NOT NULL CHECK(status IN ('reserved','dispatched','unknown','succeeded','failed','cancelled')),
 receipt_version_id TEXT,
 PRIMARY KEY(project_id,run_id,id), FOREIGN KEY(project_id,run_id) REFERENCES context_runs(project_id,id),
 FOREIGN KEY(receipt_version_id,project_id) REFERENCES artifact_versions(id,project_id)
) STRICT;
CREATE TABLE context_budget_reservations (
 project_id TEXT NOT NULL,run_id TEXT NOT NULL,call_id TEXT NOT NULL,
 reserved_input INTEGER NOT NULL CHECK(reserved_input>=0),reserved_output INTEGER NOT NULL CHECK(reserved_output>=0),
 used_input INTEGER CHECK(used_input>=0),used_output INTEGER CHECK(used_output>=0),
 CHECK((used_input IS NULL)=(used_output IS NULL)),
 PRIMARY KEY(project_id,run_id,call_id), FOREIGN KEY(project_id,run_id,call_id) REFERENCES context_calls(project_id,run_id,id)
) STRICT;
CREATE TABLE context_evidence (
 project_id TEXT NOT NULL,run_id TEXT NOT NULL,source_version_id TEXT NOT NULL,locator_json TEXT NOT NULL CHECK(json_valid(locator_json)),evidence_version_id TEXT NOT NULL,
 PRIMARY KEY(project_id,run_id,source_version_id,locator_json),
 FOREIGN KEY(project_id,run_id) REFERENCES context_runs(project_id,id),
 FOREIGN KEY(source_version_id,project_id) REFERENCES artifact_versions(id,project_id),
 FOREIGN KEY(evidence_version_id,project_id) REFERENCES artifact_versions(id,project_id)
) STRICT;
CREATE TABLE context_events (
 project_id TEXT NOT NULL,run_id TEXT NOT NULL,sequence INTEGER NOT NULL CHECK(sequence>0),type TEXT NOT NULL,data_json TEXT NOT NULL CHECK(json_valid(data_json)),
 PRIMARY KEY(project_id,run_id,sequence), FOREIGN KEY(project_id,run_id) REFERENCES context_runs(project_id,id)
) STRICT;
CREATE TRIGGER context_run_identity BEFORE UPDATE ON context_runs
WHEN NEW.project_id<>OLD.project_id OR NEW.id<>OLD.id OR NEW.snapshot_version_id<>OLD.snapshot_version_id OR NEW.scope_json<>OLD.scope_json OR NEW.prefixes_json<>OLD.prefixes_json OR NEW.budget_json<>OLD.budget_json
BEGIN SELECT RAISE(ABORT,'context identity and scope are immutable'); END;
CREATE TRIGGER context_run_revision BEFORE UPDATE ON context_runs WHEN NEW.revision<>OLD.revision+1
BEGIN SELECT RAISE(ABORT,'context revision must advance once'); END;
CREATE TRIGGER context_run_no_delete BEFORE DELETE ON context_runs BEGIN SELECT RAISE(ABORT,'context history is retained'); END;
CREATE TRIGGER context_snapshot_members_no_update BEFORE UPDATE ON context_snapshot_members BEGIN SELECT RAISE(ABORT,'context evidence is immutable'); END;
CREATE TRIGGER context_snapshot_members_no_delete BEFORE DELETE ON context_snapshot_members BEGIN SELECT RAISE(ABORT,'context evidence is immutable'); END;
CREATE TRIGGER context_rounds_no_update BEFORE UPDATE ON context_rounds BEGIN SELECT RAISE(ABORT,'context evidence is immutable'); END;
CREATE TRIGGER context_rounds_no_delete BEFORE DELETE ON context_rounds BEGIN SELECT RAISE(ABORT,'context evidence is immutable'); END;
CREATE TRIGGER context_evidence_no_update BEFORE UPDATE ON context_evidence BEGIN SELECT RAISE(ABORT,'context evidence is immutable'); END;
CREATE TRIGGER context_evidence_no_delete BEFORE DELETE ON context_evidence BEGIN SELECT RAISE(ABORT,'context evidence is immutable'); END;
CREATE TRIGGER context_events_no_update BEFORE UPDATE ON context_events BEGIN SELECT RAISE(ABORT,'context evidence is immutable'); END;
CREATE TRIGGER context_events_no_delete BEFORE DELETE ON context_events BEGIN SELECT RAISE(ABORT,'context evidence is immutable'); END;

CREATE TRIGGER context_call_identity BEFORE UPDATE ON context_calls
WHEN NEW.project_id<>OLD.project_id OR NEW.run_id<>OLD.run_id OR NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.params_json<>OLD.params_json
BEGIN SELECT RAISE(ABORT,'context call identity is immutable'); END;
CREATE TRIGGER context_call_terminal BEFORE UPDATE ON context_calls WHEN OLD.status IN ('succeeded','failed','cancelled')
BEGIN SELECT RAISE(ABORT,'context call settlement is immutable'); END;
CREATE TRIGGER context_call_no_delete BEFORE DELETE ON context_calls BEGIN SELECT RAISE(ABORT,'context calls are retained'); END;
CREATE TRIGGER context_budget_identity BEFORE UPDATE ON context_budget_reservations
WHEN NEW.project_id<>OLD.project_id OR NEW.run_id<>OLD.run_id OR NEW.call_id<>OLD.call_id OR NEW.reserved_input<>OLD.reserved_input OR NEW.reserved_output<>OLD.reserved_output
BEGIN SELECT RAISE(ABORT,'context reservation is immutable'); END;
CREATE TRIGGER context_budget_settled BEFORE UPDATE ON context_budget_reservations WHEN OLD.used_input IS NOT NULL
BEGIN SELECT RAISE(ABORT,'context usage settlement is immutable'); END;
CREATE TRIGGER context_budget_no_delete BEFORE DELETE ON context_budget_reservations BEGIN SELECT RAISE(ABORT,'context budget history is retained'); END;
