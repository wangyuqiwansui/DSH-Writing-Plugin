-- Quality owns only these tables. Existing artifacts and historical migrations stay unchanged.
CREATE TABLE quality_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  level TEXT NOT NULL CHECK(level IN ('L0','L1')),
  scope_key TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  status TEXT NOT NULL CHECK(status IN ('draft','active','retired')),
  current_version_id TEXT NOT NULL,
  active_version_id TEXT,
  CHECK((level='L0' AND project_id IS NULL AND scope_key='L0') OR
        (level='L1' AND project_id IS NOT NULL AND scope_key='L1:' || project_id))
);
CREATE TABLE quality_rule_versions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES quality_rules(id),
  version INTEGER NOT NULL CHECK(version > 0),
  content_sha256 TEXT NOT NULL CHECK(length(content_sha256)=64),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL,
  UNIQUE(rule_id, version)
);
CREATE INDEX quality_rules_scope ON quality_rules(scope_key, status, id);
CREATE TRIGGER quality_version_no_update BEFORE UPDATE ON quality_rule_versions BEGIN SELECT RAISE(ABORT,'quality rule versions are immutable'); END;
CREATE TRIGGER quality_version_no_delete BEFORE DELETE ON quality_rule_versions BEGIN SELECT RAISE(ABORT,'quality rule history is retained'); END;
CREATE TABLE quality_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  target_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
  operation_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  execution TEXT NOT NULL CHECK(execution IN ('running','succeeded','failed','unknown','cancelled')),
  verdict TEXT NOT NULL CHECK(verdict IN ('not_evaluated','passed','issues_found','needs_review')),
  dimension TEXT NOT NULL CHECK(dimension IN ('body','outline')),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  UNIQUE(project_id,operation_id)
);
CREATE INDEX quality_reports_project ON quality_reports(project_id,created_at DESC,id);
CREATE TRIGGER quality_report_terminal BEFORE UPDATE ON quality_reports WHEN OLD.execution != 'running'
  BEGIN SELECT RAISE(ABORT,'completed quality reports are immutable'); END;
CREATE TRIGGER quality_report_no_delete BEFORE DELETE ON quality_reports BEGIN SELECT RAISE(ABORT,'quality reports are retained'); END;
CREATE TABLE quality_commands (
  scope_key TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json)),
  PRIMARY KEY(scope_key,operation_id)
);
