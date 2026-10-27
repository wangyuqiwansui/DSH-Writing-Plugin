-- Storage infrastructure only. Domain admission belongs to the owning service.
CREATE TABLE plugin_instances (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    id TEXT NOT NULL UNIQUE,
    plugin_key TEXT NOT NULL CHECK(plugin_key = 'dsh-writing-plugin'),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE initialization_runs (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES plugin_instances(id),
    database_path TEXT NOT NULL,
    from_version INTEGER NOT NULL,
    to_version INTEGER NOT NULL,
    backup_path TEXT,
    report_json TEXT NOT NULL CHECK(json_valid(report_json)),
    completed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE artifact_owners (
    artifact_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    owner TEXT NOT NULL CHECK(owner IN ('story','planning','writer','quality','publication','workflow','execution')),
    FOREIGN KEY(artifact_id, project_id) REFERENCES artifacts(id, project_id)
) STRICT;

CREATE TABLE artifact_payload_metadata (
    version_id TEXT PRIMARY KEY REFERENCES artifact_versions(id),
    encoding TEXT NOT NULL,
    semantic_sha256 TEXT NOT NULL CHECK(length(semantic_sha256) = 64)
) STRICT;

CREATE TABLE artifact_heads (
    project_id TEXT NOT NULL REFERENCES projects(id),
    head_key TEXT NOT NULL,
    owner TEXT NOT NULL,
    version_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision > 0),
    PRIMARY KEY(project_id, head_key),
    FOREIGN KEY(version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

CREATE TABLE storage_commands (
    project_id TEXT NOT NULL REFERENCES projects(id),
    owner TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64),
    request_json TEXT NOT NULL CHECK(json_valid(request_json)),
    result_json TEXT NOT NULL CHECK(json_valid(result_json)),
    committed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY(project_id, owner, operation_id)
) STRICT;

CREATE TABLE outbox_events (
    sequence INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(id),
    owner TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(id, project_id)
) STRICT;

CREATE TABLE event_consumptions (
    event_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    consumer_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    result_json TEXT NOT NULL CHECK(json_valid(result_json)),
    consumed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY(event_id, consumer_id),
    FOREIGN KEY(event_id, project_id) REFERENCES outbox_events(id, project_id),
    FOREIGN KEY(project_id, consumer_id, operation_id) REFERENCES storage_commands(project_id, owner, operation_id)
) STRICT;

CREATE INDEX idx_outbox_project_sequence ON outbox_events(project_id, sequence);
CREATE TRIGGER artifact_owner_no_update BEFORE UPDATE ON artifact_owners
BEGIN SELECT RAISE(ABORT, 'artifact ownership is immutable'); END;
CREATE TRIGGER artifact_owner_no_delete BEFORE DELETE ON artifact_owners
BEGIN SELECT RAISE(ABORT, 'artifact ownership is immutable'); END;
CREATE TRIGGER payload_metadata_no_update BEFORE UPDATE ON artifact_payload_metadata
BEGIN SELECT RAISE(ABORT, 'payload metadata is immutable'); END;
CREATE TRIGGER payload_metadata_no_delete BEFORE DELETE ON artifact_payload_metadata
BEGIN SELECT RAISE(ABORT, 'payload metadata is immutable'); END;
CREATE TRIGGER command_no_update BEFORE UPDATE ON storage_commands
BEGIN SELECT RAISE(ABORT, 'commands are immutable'); END;
CREATE TRIGGER command_no_delete BEFORE DELETE ON storage_commands
BEGIN SELECT RAISE(ABORT, 'commands are immutable'); END;
CREATE TRIGGER outbox_no_update BEFORE UPDATE ON outbox_events
BEGIN SELECT RAISE(ABORT, 'outbox events are immutable'); END;
CREATE TRIGGER outbox_no_delete BEFORE DELETE ON outbox_events
BEGIN SELECT RAISE(ABORT, 'outbox events are immutable'); END;
CREATE TRIGGER consumption_no_update BEFORE UPDATE ON event_consumptions
BEGIN SELECT RAISE(ABORT, 'event consumption is immutable'); END;
CREATE TRIGGER consumption_no_delete BEFORE DELETE ON event_consumptions
BEGIN SELECT RAISE(ABORT, 'event consumption is immutable'); END;
CREATE TRIGGER instance_no_update BEFORE UPDATE ON plugin_instances
BEGIN SELECT RAISE(ABORT, 'instance identity is immutable'); END;
CREATE TRIGGER instance_no_delete BEFORE DELETE ON plugin_instances
BEGIN SELECT RAISE(ABORT, 'instance identity is immutable'); END;
CREATE TRIGGER initialization_no_update BEFORE UPDATE ON initialization_runs
BEGIN SELECT RAISE(ABORT, 'initialization records are immutable'); END;
CREATE TRIGGER initialization_no_delete BEFORE DELETE ON initialization_runs
BEGIN SELECT RAISE(ABORT, 'initialization records are immutable'); END;
