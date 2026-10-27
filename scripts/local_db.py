"""Initialize, inspect and back up the local novel database using Python stdlib."""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import uuid


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "storage" / "migrations"
APPLICATION_ID = 0x44535750  # DSWP


def selected_local_path(path: Path) -> Path:
    path = Path(path)
    if not path.is_absolute() or str(path).startswith(('\\\\', '//')):
        raise ValueError('explicit absolute local database file path is required; no default is used')
    path = path.resolve()
    if str(path).startswith(('\\\\', '//')) or path.is_dir():
        raise ValueError('select a local database file, not a directory or network path')
    return path


def open_db(path: Path, *, readonly: bool = False, create: bool = False) -> sqlite3.Connection:
    path = Path(path).resolve()
    mode = "ro" if readonly else ("rwc" if create else "rw")
    connection = sqlite3.connect(
        path.as_uri() + "?mode=" + mode, uri=True, isolation_level=None, timeout=10
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA recursive_triggers = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    if not readonly:
        connection.execute("PRAGMA synchronous = FULL")
    return connection


def migration_files():
    result = []
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
        raw = path.read_bytes()
        result.append((int(path.name.split("_", 1)[0]), path.name,
                       hashlib.sha256(raw).hexdigest(), raw.decode("utf-8")))
    if not result or [item[0] for item in result] != list(range(1, len(result) + 1)):
        raise ValueError("migration versions must be consecutive, starting at 1")
    return result


def execute_migration(connection, sql):
    # executescript() may implicitly commit. Keep every DDL statement in our transaction.
    statement = ""
    for line in sql.splitlines(keepends=True):
        statement += line
        if sqlite3.complete_statement(statement):
            connection.execute(statement)
            statement = ""
    if statement.strip():
        raise ValueError("incomplete migration SQL")


def validate_identity(connection):
    if connection.execute("PRAGMA application_id").fetchone()[0] != APPLICATION_ID:
        raise ValueError("this file is not a DS writing plugin database")


def validate_migrations(connection):
    validate_identity(connection)
    expected = {item[0]: item[1:3] for item in migration_files()}
    applied = connection.execute("SELECT version, name, sha256 FROM schema_migrations ORDER BY version").fetchall()
    for row in applied:
        if row["version"] not in expected or expected[row["version"]] != (row["name"], row["sha256"]):
            raise ValueError(f"unknown or modified migration: {row['version']}")
    versions = [row["version"] for row in applied]
    if versions != list(range(1, len(versions) + 1)):
        raise ValueError("migration history has gaps")
    if connection.execute("PRAGMA user_version").fetchone()[0] != len(versions):
        raise ValueError("schema version disagrees with migration history")
    return set(versions)


def validate_structure(connection, applied):
    """Compare actual DDL with the same immutable migrations in an isolated database."""
    query = "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name"
    with closing(sqlite3.connect(':memory:', isolation_level=None)) as expected:
        for version, _name, _digest, sql in migration_files():
            if version in applied:
                execute_migration(expected, sql)
        wanted = [tuple(row) for row in expected.execute(query)]
    if [tuple(row) for row in connection.execute(query)] != wanted:
        raise ValueError('database schema or constraint drift; refusing to repair migration history')


def content_fingerprint(connection):
    """Migration guard for historical payloads and metadata, independent of stored hashes."""
    digest = hashlib.sha256()
    for row in connection.execute('SELECT * FROM artifact_versions ORDER BY id'):
        digest.update(encode_json({key: {'hex': value.hex()} if isinstance(value, bytes) else value
                                   for key, value in dict(row).items()}).encode('utf-8'))
        digest.update(b'\n')
    return digest.hexdigest()


def initialize(path: Path):
    path = selected_local_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    migrations = migration_files()
    with closing(open_db(path, create=True)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
            if tables:
                applied = validate_migrations(connection)
                # Check prior content before recording a successful rerun or migration.
                inspect_database(path)
            else:
                app_id = connection.execute("PRAGMA application_id").fetchone()[0]
                if app_id not in (0, APPLICATION_ID):
                    raise ValueError("refusing to initialize another application's database")
                applied = set()
            before_version = max(applied, default=0)
            previous_content = content_fingerprint(connection) if applied else None
            backup_path = None
            if applied and len(applied) < len(migrations):
                backup_path = path.parent / 'backups' / ('pre-migration-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex + '.sqlite3')
                backup_database(path, backup_path)
            for version, name, digest, sql in migrations:
                if version in applied:
                    continue
                execute_migration(connection, sql)
                connection.execute("INSERT INTO schema_migrations(version, name, sha256) VALUES (?, ?, ?)",
                                   (version, name, digest))
            connection.execute(f"PRAGMA application_id = {APPLICATION_ID}")
            connection.execute(f"PRAGMA user_version = {len(migrations)}")
            connection.execute("INSERT INTO plugin_instances(singleton, id, plugin_key) VALUES (1, ?, 'dsh-writing-plugin') ON CONFLICT(singleton) DO NOTHING", (str(uuid.uuid4()),))
            instance_id = connection.execute('SELECT id FROM plugin_instances WHERE singleton=1').fetchone()[0]
            connection.execute('INSERT INTO initialization_runs(id, instance_id, database_path, from_version, to_version, backup_path, report_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
                               (str(uuid.uuid4()), instance_id, str(path), before_version, len(migrations), str(backup_path) if backup_path else None,
                                encode_json({'operation': 'initialize', 'schema_version': len(migrations), 'database_path': str(path), 'backup_path': str(backup_path) if backup_path else None})))
            if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise ValueError("migration produced invalid references")
            validate_structure(connection, set(range(1, len(migrations) + 1)))
            if previous_content is not None and content_fingerprint(connection) != previous_content:
                raise ValueError('migration changed historical artifact payloads or metadata')
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        # Conservative single-user baseline; WAL can be enabled in a separately verified change.
        mode = connection.execute("PRAGMA journal_mode = DELETE").fetchone()[0]
        if mode != "delete":
            raise ValueError("could not enable rollback journaling on the local database")
    return inspect_database(path)


def encode_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def save_artifact(connection, *, project_id, artifact_key, kind, content,
                  schema_key="novel-artifact-v1", created_by="local", scope_node_id=None,
                  entity_id=None, metadata=None, content_type=None):
    """Append a complete immutable payload inside the caller's write transaction.

    The caller uses BEGIN IMMEDIATE and commits the payload, its references and task
    state together. No file path is accepted as a substitute for the payload bytes.
    """
    if not connection.in_transaction:
        raise ValueError("save_artifact requires an explicit write transaction")
    values = {"content_text": None, "content_json": None, "content_blob": None}
    if isinstance(content, str):
        storage_kind, default_mime, raw = "text", "text/plain; charset=utf-8", content.encode("utf-8")
        values["content_text"] = content
    elif isinstance(content, bytes):
        storage_kind, default_mime, raw = "blob", "application/octet-stream", content
        values["content_blob"] = content
    else:
        encoded = encode_json(content)
        storage_kind, default_mime, raw = "json", "application/json", encoded.encode("utf-8")
        values["content_json"] = encoded
    connection.execute(
        "INSERT INTO artifacts(id, project_id, artifact_key, kind, scope_node_id, entity_id) "
        "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, artifact_key) DO NOTHING",
        (str(uuid.uuid4()), project_id, artifact_key, kind, scope_node_id, entity_id),
    )
    artifact = connection.execute("SELECT * FROM artifacts WHERE project_id=? AND artifact_key=?",
                                  (project_id, artifact_key)).fetchone()
    if (artifact["kind"], artifact["scope_node_id"], artifact["entity_id"]) != (kind, scope_node_id, entity_id):
        raise ValueError("artifact identity or scope changed")
    revision = connection.execute("SELECT COALESCE(MAX(revision), 0) + 1 FROM artifact_versions WHERE artifact_id=?",
                                   (artifact["id"],)).fetchone()[0]
    version_id = str(uuid.uuid4())
    connection.execute(
        "INSERT INTO artifact_versions(id, project_id, artifact_id, revision, schema_key, content_type, "
        "storage_kind, content_text, content_json, content_blob, content_sha256, byte_length, metadata_json, created_by) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (version_id, project_id, artifact["id"], revision, schema_key, content_type or default_mime,
         storage_kind, values["content_text"], values["content_json"], values["content_blob"],
         hashlib.sha256(raw).hexdigest(), len(raw), encode_json(metadata if metadata is not None else {}), created_by),
    )
    return version_id


def inspect_database(path: Path):
    path = selected_local_path(path)
    with closing(open_db(path, readonly=True)) as connection:
        connection.execute("BEGIN")
        applied = validate_migrations(connection)
        validate_structure(connection, applied)
        integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        references = [tuple(row) for row in connection.execute("PRAGMA foreign_key_check")]
        if integrity != ["ok"] or references:
            raise ValueError(f"database integrity failure: {integrity}; references: {references}")
        count = 0
        for row in connection.execute("SELECT * FROM artifact_versions"):
            raw = row["content_blob"] if row["storage_kind"] == "blob" else row["content_" + row["storage_kind"]].encode("utf-8")
            if len(raw) != row["byte_length"] or hashlib.sha256(raw).hexdigest() != row["content_sha256"]:
                raise ValueError(f"artifact content checksum mismatch: {row['id']}")
            count += 1
        tables = connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
        result = {"path": str(path), "schema_version": max(applied, default=0), "table_count": tables,
                  "artifact_version_count": count, "integrity": "ok", "foreign_keys": "ok",
                  "content_checksums": "ok", "journal_mode": connection.execute("PRAGMA journal_mode").fetchone()[0]}
        if 2 in applied:
            instance = connection.execute("SELECT id,plugin_key FROM plugin_instances WHERE singleton=1").fetchone()
            if instance is None or not instance[0] or instance[1] != 'dsh-writing-plugin':
                raise ValueError('plugin instance initialization is incomplete')
            result['plugin_instance_id'] = instance[0]
            result['initialization_count'] = connection.execute('SELECT COUNT(*) FROM initialization_runs').fetchone()[0]
        connection.commit()
        return result


def backup_database(path: Path, destination: Path):
    path, destination = selected_local_path(path), selected_local_path(destination)
    if path == destination:
        raise ValueError("backup destination must differ from source")
    inspect_database(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Reserve the filename without overwriting an existing backup.
    with destination.open("xb"):
        pass
    try:
        with closing(open_db(path, readonly=True)) as source:
            with closing(sqlite3.connect(destination)) as target:
                source.backup(target)
                # The completed backup is a standalone file, without WAL dependencies.
                target.execute("PRAGMA journal_mode = DELETE")
        return inspect_database(destination)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


def restore_database(backup: Path, destination: Path):
    """Restore to a new path; never overwrite a live database. Preserve instance identity."""
    return backup_database(backup, destination)


def main():
    # Accept --db before or after the action: npm run db:init appends arguments
    # after "init", while existing management commands put --db first.
    options = argparse.ArgumentParser(add_help=False)
    options.add_argument("--db", type=Path, default=argparse.SUPPRESS,
                         help='user-selected absolute local file path; no default')
    parser = argparse.ArgumentParser(description=__doc__, parents=[options])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init", parents=[options], help="initialize or migrate all modules without replacing existing data")
    commands.add_parser("check", parents=[options], help="verify schema, references and content checksums")
    backup = commands.add_parser("backup", parents=[options], help="create a consistent new local backup")
    backup.add_argument("destination", type=Path)
    restore = commands.add_parser("restore", parents=[options], help="restore --db backup to a new destination; never overwrite")
    restore.add_argument("destination", type=Path)
    args = parser.parse_args()
    if not hasattr(args, 'db'):
        parser.error('--db is required: select an explicit absolute local file path; no default is used')
    try:
        if args.command == "init":
            result = initialize(args.db)
        elif args.command == "check":
            result = inspect_database(args.db)
        elif args.command == "backup":
            result = backup_database(args.db, args.destination)
        else:
            result = restore_database(args.db, args.destination)
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
