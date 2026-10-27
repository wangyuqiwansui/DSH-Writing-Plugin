-- Local novel workflow storage. Workflow admission remains a service responsibility.
CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(trim(title)) > 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE story_nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    parent_id TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('volume', 'plot_unit', 'chapter')),
    node_key TEXT NOT NULL,
    title TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id),
    UNIQUE(project_id, node_key),
    CHECK(parent_id IS NULL OR parent_id <> id),
    FOREIGN KEY(parent_id, project_id) REFERENCES story_nodes(id, project_id)
) STRICT;

CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    kind TEXT NOT NULL CHECK(kind IN ('character', 'asset', 'location', 'faction', 'relationship')),
    entity_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id),
    UNIQUE(project_id, entity_key)
) STRICT;

-- Logical identities. Every content change produces a new artifact_versions row.
CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    artifact_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    scope_node_id TEXT,
    entity_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id),
    UNIQUE(project_id, artifact_key),
    FOREIGN KEY(scope_node_id, project_id) REFERENCES story_nodes(id, project_id),
    FOREIGN KEY(entity_id, project_id) REFERENCES entities(id, project_id)
) STRICT;

CREATE TABLE artifact_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0),
    schema_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    storage_kind TEXT NOT NULL CHECK(storage_kind IN ('text', 'json', 'blob')),
    content_text TEXT,
    content_json TEXT CHECK(content_json IS NULL OR json_valid(content_json)),
    content_blob BLOB,
    content_sha256 TEXT NOT NULL CHECK(length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
    byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id),
    UNIQUE(artifact_id, revision),
    CHECK(
        (storage_kind = 'text' AND content_text IS NOT NULL AND content_json IS NULL AND content_blob IS NULL) OR
        (storage_kind = 'json' AND content_text IS NULL AND content_json IS NOT NULL AND content_blob IS NULL) OR
        (storage_kind = 'blob' AND content_text IS NULL AND content_json IS NULL AND content_blob IS NOT NULL)
    ),
    FOREIGN KEY(artifact_id, project_id) REFERENCES artifacts(id, project_id)
) STRICT;

-- Query index for dependencies; the sealed input manifest also stores exact references.
CREATE TABLE artifact_dependencies (
    project_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    source_version_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    PRIMARY KEY(version_id, source_version_id, relation),
    CHECK(version_id <> source_version_id),
    FOREIGN KEY(version_id, project_id) REFERENCES artifact_versions(id, project_id),
    FOREIGN KEY(source_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE artifact_decisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('confirmed', 'rejected', 'revoked', 'superseded')),
    actor TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    workflow_key TEXT NOT NULL,
    contract_version TEXT NOT NULL,
    input_version_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'blocked', 'completed', 'failed', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id),
    FOREIGN KEY(input_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE workflow_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    task_key TEXT NOT NULL,
    stage_key TEXT NOT NULL,
    input_version_id TEXT NOT NULL,
    execution_status TEXT NOT NULL DEFAULT 'pending' CHECK(execution_status IN ('pending', 'running', 'succeeded', 'failed', 'unknown', 'cancelled')),
    content_verdict TEXT NOT NULL DEFAULT 'not_established' CHECK(content_verdict IN ('not_established', 'passed', 'denied', 'not_required')),
    admission_status TEXT NOT NULL DEFAULT 'blocked' CHECK(admission_status IN ('blocked', 'ready', 'completed')),
    attempt_budget INTEGER NOT NULL DEFAULT 2 CHECK(attempt_budget > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id),
    UNIQUE(run_id, task_key),
    FOREIGN KEY(run_id, project_id) REFERENCES workflow_runs(id, project_id),
    FOREIGN KEY(input_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE task_attempts (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    attempt_no INTEGER NOT NULL CHECK(attempt_no > 0),
    status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared', 'running', 'succeeded', 'failed', 'unknown', 'cancelled')),
    input_version_id TEXT NOT NULL,
    output_version_id TEXT,
    receipt_version_id TEXT,
    provider TEXT,
    model TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id),
    UNIQUE(id, task_id, project_id),
    UNIQUE(task_id, attempt_no),
    FOREIGN KEY(task_id, project_id) REFERENCES workflow_tasks(id, project_id),
    FOREIGN KEY(input_version_id, project_id) REFERENCES artifact_versions(id, project_id),
    FOREIGN KEY(output_version_id, project_id) REFERENCES artifact_versions(id, project_id),
    FOREIGN KEY(receipt_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE task_events (
    sequence INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    attempt_id TEXT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    artifact_version_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(task_id, project_id) REFERENCES workflow_tasks(id, project_id),
    FOREIGN KEY(attempt_id, task_id, project_id) REFERENCES task_attempts(id, task_id, project_id),
    FOREIGN KEY(artifact_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    attempt_id TEXT,
    role TEXT NOT NULL,
    verdict TEXT NOT NULL CHECK(verdict IN ('passed', 'denied', 'error', 'not_applicable')),
    report_version_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id),
    FOREIGN KEY(attempt_id, project_id) REFERENCES task_attempts(id, project_id),
    FOREIGN KEY(report_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE review_targets (
    project_id TEXT NOT NULL,
    review_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK(position >= 0),
    PRIMARY KEY(review_id, version_id),
    UNIQUE(review_id, position),
    FOREIGN KEY(review_id, project_id) REFERENCES reviews(id, project_id),
    FOREIGN KEY(version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE publication_batches (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    release_key TEXT NOT NULL,
    manifest_version_id TEXT NOT NULL,
    published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id),
    UNIQUE(project_id, release_key),
    FOREIGN KEY(run_id, project_id) REFERENCES workflow_runs(id, project_id),
    FOREIGN KEY(manifest_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE publication_members (
    project_id TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    chapter_id TEXT NOT NULL,
    body_version_id TEXT NOT NULL,
    PRIMARY KEY(batch_id, chapter_id),
    FOREIGN KEY(batch_id, project_id) REFERENCES publication_batches(id, project_id),
    FOREIGN KEY(chapter_id, project_id) REFERENCES story_nodes(id, project_id),
    FOREIGN KEY(body_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE INDEX idx_nodes_parent ON story_nodes(project_id, parent_id, position);
CREATE INDEX idx_entities_kind ON entities(project_id, kind);
CREATE INDEX idx_artifacts_scope ON artifacts(project_id, kind, scope_node_id, entity_id);
CREATE INDEX idx_dependencies_source ON artifact_dependencies(source_version_id);
CREATE INDEX idx_decisions_version ON artifact_decisions(version_id, created_at);
CREATE INDEX idx_runs_status ON workflow_runs(project_id, status);
CREATE INDEX idx_tasks_status ON workflow_tasks(project_id, execution_status, admission_status);
CREATE INDEX idx_attempts_status ON task_attempts(project_id, status);
CREATE INDEX idx_events_task ON task_events(task_id, sequence);
CREATE INDEX idx_reviews_role ON reviews(project_id, role, verdict);
CREATE INDEX idx_review_targets_version ON review_targets(version_id);
CREATE INDEX idx_publication_chapter ON publication_members(chapter_id);

CREATE TRIGGER publication_chapter_guard BEFORE INSERT ON publication_members
WHEN NOT EXISTS (
    SELECT 1 FROM story_nodes n
    JOIN artifact_versions v ON v.id = NEW.body_version_id AND v.project_id = n.project_id
    JOIN artifacts a ON a.id = v.artifact_id AND a.project_id = v.project_id
    WHERE n.id = NEW.chapter_id AND n.project_id = NEW.project_id
      AND n.kind = 'chapter' AND a.kind = 'chapter_body' AND a.scope_node_id = n.id
)
BEGIN SELECT RAISE(ABORT, 'published body must belong to the target chapter'); END;

CREATE TRIGGER artifact_identity_no_update BEFORE UPDATE ON artifacts
BEGIN SELECT RAISE(ABORT, 'artifact identities are immutable'); END;
CREATE TRIGGER version_no_update BEFORE UPDATE ON artifact_versions
BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
CREATE TRIGGER version_no_delete BEFORE DELETE ON artifact_versions
BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
CREATE TRIGGER decision_no_update BEFORE UPDATE ON artifact_decisions
BEGIN SELECT RAISE(ABORT, 'append a new decision'); END;
CREATE TRIGGER decision_no_delete BEFORE DELETE ON artifact_decisions
BEGIN SELECT RAISE(ABORT, 'decisions are append-only'); END;
CREATE TRIGGER event_no_update BEFORE UPDATE ON task_events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER event_no_delete BEFORE DELETE ON task_events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER review_no_update BEFORE UPDATE ON reviews
BEGIN SELECT RAISE(ABORT, 'append a new review'); END;
CREATE TRIGGER review_no_delete BEFORE DELETE ON reviews
BEGIN SELECT RAISE(ABORT, 'reviews are append-only'); END;
CREATE TRIGGER publication_no_update BEFORE UPDATE ON publication_batches
BEGIN SELECT RAISE(ABORT, 'publication batches are immutable'); END;
CREATE TRIGGER publication_no_delete BEFORE DELETE ON publication_batches
BEGIN SELECT RAISE(ABORT, 'publication batches are immutable'); END;
CREATE TRIGGER publication_member_no_update BEFORE UPDATE ON publication_members
BEGIN SELECT RAISE(ABORT, 'publish a new batch'); END;
CREATE TRIGGER publication_member_no_delete BEFORE DELETE ON publication_members
BEGIN SELECT RAISE(ABORT, 'publication members are immutable'); END;
