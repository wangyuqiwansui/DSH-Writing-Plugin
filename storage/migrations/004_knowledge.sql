-- Owner: storage/knowledge. Append-only migration; 001-003 retain their exact bytes.
-- artifact_owners has no incoming foreign keys. Rebuild only this leaf table.
CREATE TABLE artifact_owners_v4 (
    artifact_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    owner TEXT NOT NULL CHECK(owner IN ('story','planning','writer','quality','publication','workflow','execution','knowledge')),
    FOREIGN KEY(artifact_id, project_id) REFERENCES artifacts(id, project_id)
) STRICT;
INSERT INTO artifact_owners_v4 SELECT artifact_id, project_id, owner FROM artifact_owners;
DROP TABLE artifact_owners;
ALTER TABLE artifact_owners_v4 RENAME TO artifact_owners;
CREATE TRIGGER artifact_owner_no_update BEFORE UPDATE ON artifact_owners
BEGIN SELECT RAISE(ABORT, 'artifact ownership is immutable'); END;
CREATE TRIGGER artifact_owner_no_delete BEFORE DELETE ON artifact_owners
BEGIN SELECT RAISE(ABORT, 'artifact ownership is immutable'); END;

-- Immutable import receipts; identity includes the source instance and exact source bytes.
CREATE TABLE knowledge_import_map (
    project_id TEXT NOT NULL,
    origin_system TEXT NOT NULL CHECK(length(trim(origin_system)) > 0),
    source_instance_id TEXT NOT NULL CHECK(length(trim(source_instance_id)) > 0),
    source_table TEXT NOT NULL CHECK(length(trim(source_table)) > 0),
    source_row_id TEXT NOT NULL CHECK(length(trim(source_row_id)) > 0),
    source_hash TEXT NOT NULL CHECK(length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
    target_version_id TEXT NOT NULL,
    manifest_version_id TEXT NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(project_id, origin_system, source_instance_id, source_table, source_row_id, source_hash),
    FOREIGN KEY(target_version_id, project_id) REFERENCES artifact_versions(id, project_id),
    FOREIGN KEY(manifest_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;
CREATE TRIGGER knowledge_import_no_update BEFORE UPDATE ON knowledge_import_map
BEGIN SELECT RAISE(ABORT, 'import receipts are immutable'); END;
CREATE TRIGGER knowledge_import_no_delete BEFORE DELETE ON knowledge_import_map
BEGIN SELECT RAISE(ABORT, 'import receipts are immutable'); END;

-- Derived directory. Namespace/status do not confer domain authority.
CREATE TABLE knowledge_source_catalog (
    project_id TEXT NOT NULL,
    source_version_id TEXT NOT NULL,
    namespace TEXT NOT NULL CHECK(namespace IN ('canon','planning','reference','style','experience')),
    source_owner TEXT NOT NULL CHECK(source_owner IN ('story','planning','writer','quality','publication','workflow','execution','knowledge')),
    fact_status TEXT NOT NULL CHECK(fact_status IN ('candidate','confirmed','published','observed','revoked','superseded')),
    validity_mode TEXT NOT NULL CHECK(validity_mode IN ('unknown','timeless','chapter_range')),
    valid_from_chapter_id TEXT,
    valid_to_chapter_id_exclusive TEXT,
    source_event_sequence INTEGER NOT NULL CHECK(source_event_sequence >= 0),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(project_id, source_version_id),
    CHECK((validity_mode = 'chapter_range' AND valid_from_chapter_id IS NOT NULL)
       OR (validity_mode <> 'chapter_range' AND valid_from_chapter_id IS NULL AND valid_to_chapter_id_exclusive IS NULL)),
    FOREIGN KEY(source_version_id, project_id) REFERENCES artifact_versions(id, project_id),
    FOREIGN KEY(valid_from_chapter_id, project_id) REFERENCES story_nodes(id, project_id),
    FOREIGN KEY(valid_to_chapter_id_exclusive, project_id) REFERENCES story_nodes(id, project_id)
) STRICT;
CREATE INDEX knowledge_catalog_scope ON knowledge_source_catalog(project_id, namespace, fact_status);

CREATE TABLE knowledge_spans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_version_id TEXT NOT NULL,
    parser_version TEXT NOT NULL CHECK(length(trim(parser_version)) > 0),
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    start_byte INTEGER NOT NULL CHECK(start_byte >= 0),
    end_byte_exclusive INTEGER NOT NULL CHECK(end_byte_exclusive > start_byte),
    span_hash TEXT NOT NULL CHECK(length(span_hash) = 64 AND span_hash NOT GLOB '*[^0-9a-f]*'),
    UNIQUE(project_id, source_version_id, parser_version, ordinal),
    UNIQUE(id, project_id),
    UNIQUE(id, project_id, source_version_id),
    FOREIGN KEY(source_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;

-- The immutable wiki_page JSON is authoritative; the following tables are rebuildable.
CREATE TABLE wiki_claim_projection (
    project_id TEXT NOT NULL,
    page_version_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    statement TEXT NOT NULL,
    claim_type TEXT NOT NULL,
    namespace TEXT NOT NULL CHECK(namespace IN ('canon','planning','reference','style','experience')),
    fact_status TEXT NOT NULL CHECK(fact_status IN ('candidate','confirmed','published','observed','revoked','superseded')),
    validity_mode TEXT NOT NULL CHECK(validity_mode IN ('unknown','timeless','chapter_range')),
    valid_from_chapter_id TEXT,
    valid_to_chapter_id_exclusive TEXT,
    conflict_group TEXT,
    PRIMARY KEY(project_id, page_version_id, claim_id),
    CHECK((validity_mode = 'chapter_range' AND valid_from_chapter_id IS NOT NULL)
       OR (validity_mode <> 'chapter_range' AND valid_from_chapter_id IS NULL AND valid_to_chapter_id_exclusive IS NULL)),
    FOREIGN KEY(page_version_id, project_id) REFERENCES artifact_versions(id, project_id),
    FOREIGN KEY(valid_from_chapter_id, project_id) REFERENCES story_nodes(id, project_id),
    FOREIGN KEY(valid_to_chapter_id_exclusive, project_id) REFERENCES story_nodes(id, project_id)
) STRICT;
CREATE TABLE wiki_claim_supports (
    project_id TEXT NOT NULL,
    page_version_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    source_version_id TEXT NOT NULL,
    locator_json TEXT NOT NULL CHECK(json_valid(locator_json)),
    support_role TEXT NOT NULL CHECK(support_role IN ('supports','contradicts','qualifies')),
    PRIMARY KEY(project_id, page_version_id, claim_id, source_version_id, locator_json, support_role),
    FOREIGN KEY(project_id, page_version_id, claim_id) REFERENCES wiki_claim_projection(project_id, page_version_id, claim_id),
    FOREIGN KEY(source_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;
CREATE TABLE wiki_links (
    project_id TEXT NOT NULL,
    page_version_id TEXT NOT NULL,
    target_page_version_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    PRIMARY KEY(project_id, page_version_id, target_page_version_id, relation),
    FOREIGN KEY(page_version_id, project_id) REFERENCES artifact_versions(id, project_id),
    FOREIGN KEY(target_page_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;
CREATE TABLE entity_aliases (
    project_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    alias TEXT NOT NULL CHECK(length(trim(alias)) > 0),
    source_version_id TEXT NOT NULL,
    locator_json TEXT NOT NULL CHECK(json_valid(locator_json)),
    fact_status TEXT NOT NULL CHECK(fact_status IN ('candidate','confirmed','published','observed','revoked','superseded')),
    validity_mode TEXT NOT NULL CHECK(validity_mode IN ('unknown','timeless','chapter_range')),
    valid_from_chapter_id TEXT,
    valid_to_chapter_id_exclusive TEXT,
    PRIMARY KEY(project_id, entity_id, alias, source_version_id),
    CHECK((validity_mode = 'chapter_range' AND valid_from_chapter_id IS NOT NULL)
       OR (validity_mode <> 'chapter_range' AND valid_from_chapter_id IS NULL AND valid_to_chapter_id_exclusive IS NULL)),
    FOREIGN KEY(entity_id, project_id) REFERENCES entities(id, project_id),
    FOREIGN KEY(source_version_id, project_id) REFERENCES artifact_versions(id, project_id),
    FOREIGN KEY(valid_from_chapter_id, project_id) REFERENCES story_nodes(id, project_id),
    FOREIGN KEY(valid_to_chapter_id_exclusive, project_id) REFERENCES story_nodes(id, project_id)
) STRICT;
CREATE INDEX knowledge_alias_lookup ON entity_aliases(project_id, alias);

-- Generation metadata never substitutes for coverage reconciliation or a release manifest.
CREATE TABLE retrieval_generations (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    manifest_version_id TEXT NOT NULL,
    tokenizer_version TEXT NOT NULL,
    source_snapshot_json TEXT NOT NULL CHECK(json_valid(source_snapshot_json)),
    state TEXT NOT NULL DEFAULT 'building' CHECK(state IN ('building','ready','failed','stale')),
    model_profile_version TEXT,
    dimension INTEGER,
    metric TEXT CHECK(metric IN ('cosine','dot','l2')),
    PRIMARY KEY(project_id, id),
    UNIQUE(project_id, id, model_profile_version, dimension, metric),
    CHECK((model_profile_version IS NULL AND dimension IS NULL AND metric IS NULL)
       OR (model_profile_version IS NOT NULL AND dimension IS NOT NULL AND dimension > 0 AND metric IS NOT NULL)),
    FOREIGN KEY(manifest_version_id, project_id) REFERENCES artifact_versions(id, project_id)
) STRICT;
CREATE TABLE retrieval_generation_members (
    project_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('lexical','wiki','dense')),
    span_id TEXT NOT NULL,
    expected_hash TEXT NOT NULL CHECK(length(expected_hash) = 64 AND expected_hash NOT GLOB '*[^0-9a-f]*'),
    actual_hash TEXT CHECK(actual_hash IS NULL OR (length(actual_hash) = 64 AND actual_hash NOT GLOB '*[^0-9a-f]*')),
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','indexed','failed')),
    failure_reason TEXT,
    PRIMARY KEY(project_id, generation_id, channel, span_id),
    CHECK(state <> 'indexed' OR (actual_hash IS NOT NULL AND actual_hash = expected_hash AND failure_reason IS NULL)),
    CHECK(state <> 'failed' OR (failure_reason IS NOT NULL AND length(trim(failure_reason)) > 0)),
    FOREIGN KEY(project_id, generation_id) REFERENCES retrieval_generations(project_id, id),
    FOREIGN KEY(span_id, project_id) REFERENCES knowledge_spans(id, project_id)
) STRICT;
CREATE TABLE retrieval_documents (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('lexical','wiki')),
    source_version_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    namespace TEXT NOT NULL CHECK(namespace IN ('canon','planning','reference','style','experience')),
    tokens TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
    UNIQUE(project_id, generation_id, channel, span_id),
    FOREIGN KEY(project_id, generation_id, channel, span_id) REFERENCES retrieval_generation_members(project_id, generation_id, channel, span_id),
    FOREIGN KEY(span_id, project_id, source_version_id) REFERENCES knowledge_spans(id, project_id, source_version_id)
) STRICT;
CREATE VIRTUAL TABLE retrieval_fts USING fts5(tokens, content='retrieval_documents', content_rowid='id', tokenize='unicode61');
CREATE TRIGGER retrieval_documents_ai AFTER INSERT ON retrieval_documents BEGIN
    INSERT INTO retrieval_fts(rowid, tokens) VALUES (new.id, new.tokens);
END;
CREATE TRIGGER retrieval_documents_ad AFTER DELETE ON retrieval_documents BEGIN
    INSERT INTO retrieval_fts(retrieval_fts, rowid, tokens) VALUES ('delete', old.id, old.tokens);
END;
CREATE TRIGGER retrieval_documents_au AFTER UPDATE ON retrieval_documents BEGIN
    INSERT INTO retrieval_fts(retrieval_fts, rowid, tokens) VALUES ('delete', old.id, old.tokens);
    INSERT INTO retrieval_fts(rowid, tokens) VALUES (new.id, new.tokens);
END;
CREATE TABLE retrieval_vectors (
    project_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'dense' CHECK(channel = 'dense'),
    span_id TEXT NOT NULL,
    model_profile_version TEXT NOT NULL,
    dimension INTEGER NOT NULL CHECK(dimension > 0),
    metric TEXT NOT NULL CHECK(metric IN ('cosine','dot','l2')),
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
    vector_blob BLOB NOT NULL,
    PRIMARY KEY(project_id, generation_id, span_id),
    CHECK(length(vector_blob) = dimension * 4),
    FOREIGN KEY(project_id, generation_id, channel, span_id) REFERENCES retrieval_generation_members(project_id, generation_id, channel, span_id),
    FOREIGN KEY(project_id, generation_id, model_profile_version, dimension, metric)
      REFERENCES retrieval_generations(project_id, id, model_profile_version, dimension, metric)
) STRICT;
