"""
ForensicLens case database initialization and migration module.

Provides functionality to create, open, migrate, and verify per-case
SQLite databases according to the schema specified in docs/DATABASE.md.

Each forensic case uses an isolated database at:
    data/cases/<case_id>/case.db

Production builds require SQLCipher + FTS5. The current P0 development
implementation uses the standard library sqlite3 module (plaintext SQLite)
with FTS5 support validated at initialization time.

SQLCipher integration is a production requirement and will be validated
separately. This module clearly distinguishes between:
    - SQLite development validation (current)
    - SQLCipher production requirement (future)
"""

from __future__ import annotations

import hashlib
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# Schema version corresponding to latest migration
SCHEMA_VERSION = 4

# Migration directory relative to this file
_MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "migrations"

# Default busy timeout in milliseconds (from .env.example DATABASE_TIMEOUT)
DEFAULT_BUSY_TIMEOUT_MS = 5000


class DatabaseError(Exception):
    """Raised when a database operation fails."""


class MigrationError(DatabaseError):
    """Raised when a migration fails to apply."""


class SchemaValidationError(DatabaseError):
    """Raised when schema verification fails."""


class FTS5NotAvailableError(DatabaseError):
    """Raised when FTS5 is not available in the SQLite build."""


def _check_fts5_available(conn: sqlite3.Connection) -> bool:
    """Check whether the SQLite build supports FTS5."""
    try:
        conn.execute("CREATE VIRTUAL TABLE _fts5_test USING fts5(test_col)")
        conn.execute("DROP TABLE _fts5_test")
        return True
    except sqlite3.OperationalError:
        return False


def _compute_migration_checksum(sql_text: str) -> str:
    """Compute SHA-256 checksum of a migration file's content."""
    return hashlib.sha256(sql_text.encode("utf-8")).hexdigest()


def _get_migration_files() -> list[tuple[int, Path]]:
    """
    Discover migration files in numeric order.

    Returns a sorted list of (version_number, file_path) tuples.
    Migration files must be named NNN_<description>.sql.
    """
    if not _MIGRATIONS_DIR.is_dir():
        raise MigrationError(
            f"Migration directory not found: {_MIGRATIONS_DIR}"
        )

    migrations: list[tuple[int, Path]] = []
    for path in sorted(_MIGRATIONS_DIR.glob("*.sql")):
        name = path.stem
        parts = name.split("_", 1)
        try:
            version = int(parts[0])
        except (ValueError, IndexError):
            continue  # skip non-migration files
        migrations.append((version, path))

    return sorted(migrations, key=lambda m: m[0])


def _configure_connection(conn: sqlite3.Connection) -> None:
    """
    Apply required SQLite pragmas for a case database connection.

    Per docs/ARCHITECTURE.md:
    - Enable foreign key enforcement
    - Enable WAL journal mode
    - Set busy timeout
    """
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(f"PRAGMA busy_timeout = {DEFAULT_BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode = WAL")


def _get_applied_migrations(conn: sqlite3.Connection) -> dict[int, str]:
    """
    Return a mapping of version -> checksum for all applied migrations.

    Returns an empty dict if the schema_migrations table does not exist.
    """
    try:
        rows = conn.execute(
            "SELECT version, checksum FROM schema_migrations ORDER BY version"
        ).fetchall()
        return {row[0]: row[1] for row in rows}
    except sqlite3.OperationalError:
        return {}


def _strip_sql_comments(sql_text: str) -> str:
    """
    Strip SQL line comments (-- ...) and block comments (/* ... */) while strictly
    preserving any comment-like characters inside:
    - Single-quoted strings ('...', with '' escaping, following SQLite rules without backslash escapes)
    - Double-quoted identifiers ("...", with "" escaping)
    - Backtick-quoted identifiers (`...`, with `` escaping)
    - Bracket-quoted identifiers ([...], with ]] escaping)
    """
    out: list[str] = []
    i = 0
    n = len(sql_text)

    while i < n:
        ch = sql_text[i]

        # 1. Single-quoted string literal: '...' (SQLite does not treat backslash as escape)
        if ch == "'":
            out.append(ch)
            i += 1
            while i < n:
                c = sql_text[i]
                out.append(c)
                if c == "'":
                    if i + 1 < n and sql_text[i + 1] == "'":
                        i += 1
                        out.append(sql_text[i])
                    else:
                        i += 1
                        break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed single-quoted string literal.")

        # 2. Double-quoted identifier: "..."
        elif ch == '"':
            out.append(ch)
            i += 1
            while i < n:
                c = sql_text[i]
                out.append(c)
                if c == '"':
                    if i + 1 < n and sql_text[i + 1] == '"':
                        i += 1
                        out.append(sql_text[i])
                    else:
                        i += 1
                        break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed double-quoted identifier.")

        # 3. Backtick-quoted identifier: `...`
        elif ch == "`":
            out.append(ch)
            i += 1
            while i < n:
                c = sql_text[i]
                out.append(c)
                if c == "`":
                    if i + 1 < n and sql_text[i + 1] == "`":
                        i += 1
                        out.append(sql_text[i])
                    else:
                        i += 1
                        break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed backtick identifier.")

        # 4. Bracket-quoted identifier: [...]
        elif ch == "[":
            out.append(ch)
            i += 1
            while i < n:
                c = sql_text[i]
                out.append(c)
                if c == "]":
                    if i + 1 < n and sql_text[i + 1] == "]":
                        i += 1
                        out.append(sql_text[i])
                    else:
                        i += 1
                        break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed bracket identifier.")

        # 5. Line comment: -- ...
        elif ch == "-" and i + 1 < n and sql_text[i + 1] == "-":
            i += 2
            while i < n and sql_text[i] != "\n":
                i += 1
            if i < n and sql_text[i] == "\n":
                out.append("\n")
                i += 1

        # 6. Block comment: /* ... */
        elif ch == "/" and i + 1 < n and sql_text[i + 1] == "*":
            i += 2
            while i < n:
                if sql_text[i] == "*" and i + 1 < n and sql_text[i + 1] == "/":
                    i += 2
                    out.append(" ")
                    break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed block comment.")

        else:
            out.append(ch)
            i += 1

    return "".join(out).strip()


def _split_sql_statements(sql_text: str) -> list[str]:
    """
    Split SQL text into complete statements. Correctly handles:
    - Complete CREATE TRIGGER ... BEGIN ... END; statements with multi-statement bodies
    - CASE ... WHEN ... THEN ... ELSE ... END expressions inside trigger bodies
    - Semicolons inside quoted strings or identifiers (ignored)
    - Semicolons inside line and block comments (ignored)
    - Multiple independent statements on the same line
    - Trailing comments without final SQL statements (do not emit empty statements)
    - Rejection of incomplete or malformed SQL rather than returning partial fragments
    - Follows SQLite quoting rules without treating backslash as an escape
    """
    statements: list[str] = []
    i = 0
    n = len(sql_text)
    stmt_start = 0

    while i < n:
        ch = sql_text[i]

        # 1. Single quotes (SQLite rules: escaped ONLY by doubling '', backslash is not an escape)
        if ch == "'":
            i += 1
            while i < n:
                c = sql_text[i]
                if c == "'":
                    if i + 1 < n and sql_text[i + 1] == "'":
                        i += 1
                    else:
                        i += 1
                        break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed single-quoted string literal.")
            continue

        # 2. Double quotes
        elif ch == '"':
            i += 1
            while i < n:
                c = sql_text[i]
                if c == '"':
                    if i + 1 < n and sql_text[i + 1] == '"':
                        i += 1
                    else:
                        i += 1
                        break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed double-quoted identifier.")
            continue

        # 3. Backticks
        elif ch == "`":
            i += 1
            while i < n:
                c = sql_text[i]
                if c == "`":
                    if i + 1 < n and sql_text[i + 1] == "`":
                        i += 1
                    else:
                        i += 1
                        break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed backtick identifier.")
            continue

        # 4. Brackets
        elif ch == "[":
            i += 1
            while i < n:
                c = sql_text[i]
                if c == "]":
                    if i + 1 < n and sql_text[i + 1] == "]":
                        i += 1
                    else:
                        i += 1
                        break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed bracket identifier.")
            continue

        # 5. Line comments
        elif ch == "-" and i + 1 < n and sql_text[i + 1] == "-":
            i += 2
            while i < n and sql_text[i] != "\n":
                i += 1
            if i < n and sql_text[i] == "\n":
                i += 1
            continue

        # 6. Block comments
        elif ch == "/" and i + 1 < n and sql_text[i + 1] == "*":
            i += 2
            while i < n:
                if sql_text[i] == "*" and i + 1 < n and sql_text[i + 1] == "/":
                    i += 2
                    break
                i += 1
            else:
                raise ValueError("Incomplete or malformed SQL: unclosed block comment.")
            continue

        # 7. Semicolon outside quotes, identifiers, and comments
        elif ch == ";":
            candidate = sql_text[stmt_start : i + 1].strip()
            # Verify whether candidate forms a complete SQL statement
            # (sqlite3.complete_statement correctly handles multi-statement triggers,
            # CASE expressions, etc., returning False at internal semicolons)
            if sqlite3.complete_statement(candidate):
                core = _strip_sql_comments(candidate)
                if core:
                    statements.append(candidate)
                    # Advance past trailing whitespace or inline line-comment on the same line
                    j = i + 1
                    while j < n and sql_text[j] in " \t":
                        j += 1
                    if j + 1 < n and sql_text[j] == "-" and sql_text[j + 1] == "-":
                        while j < n and sql_text[j] != "\n":
                            j += 1
                    if j < n and sql_text[j] == "\n":
                        j += 1
                    stmt_start = j
                    i = j
                    continue
                else:
                    stmt_start = i + 1
            # If sqlite3.complete_statement is False, candidate is inside a trigger body
            # or compound statement. Never reset stmt_start!
            i += 1
            continue

        i += 1

    remainder = sql_text[stmt_start:].strip()
    if remainder:
        core = _strip_sql_comments(remainder)
        if core:
            # Trailing non-comment text must be a complete SQL statement;
            # incomplete SQL must be rejected rather than returning broken fragments.
            if not sqlite3.complete_statement(remainder):
                raise ValueError(
                    f"Incomplete or malformed SQL statement: {remainder!r}"
                )
            statements.append(remainder)

    return statements


def _apply_migration(
    conn: sqlite3.Connection, version: int, sql_path: Path
) -> None:
    """
    Apply a single migration file atomically within an isolated transaction.

    Guarantees:
    - Rejects execution if a transaction is already active on the connection.
    - Determines whether foreign keys must be disabled prior to the migration.
    - Encloses foreign-key state transitions within a structured cleanup block.
    - Safely handles any failure when attempting to disable foreign keys.
    - Executes DDL and DML statements individually using complete_statement parsing.
    - Filters out standalone PRAGMA foreign_keys statements from the inner transaction.
    - Performs PRAGMA foreign_key_check while the transaction is still active.
    - Inserts the migration record into schema_migrations inside the same transaction.
    - Commits only after all statements and foreign-key integrity checks succeed.
    - Automatically rolls back all statements on any error if a transaction is open.
    - Re-enables and verifies foreign-key enforcement in a finally block after success and failure.
    - Preserves the primary migration exception if foreign-key restoration fails.
    """
    if conn.in_transaction:
        raise MigrationError(
            f"Cannot apply migration {version:03d}: connection is already inside an active transaction."
        )

    sql_text = sql_path.read_text(encoding="utf-8")
    checksum = _compute_migration_checksum(sql_text)
    try:
        statements = _split_sql_statements(sql_text)
    except ValueError as e:
        raise MigrationError(
            f"Cannot apply migration {version:03d}: malformed or incomplete SQL: {e}"
        ) from e

    # Determine whether this migration requires disabling foreign keys (e.g. table rebuilds)
    requires_fk_off = any(
        _strip_sql_comments(s).upper().startswith("PRAGMA FOREIGN_KEYS")
        and "OFF" in _strip_sql_comments(s).upper()
        for s in statements
    )

    migration_exc: Optional[BaseException] = None

    try:
        if requires_fk_off:
            try:
                # PRAGMA foreign_keys = OFF MUST execute outside any multi-statement transaction
                conn.execute("PRAGMA foreign_keys = OFF")
            except Exception as e:
                raise MigrationError(
                    f"Failed to disable foreign keys before migration {version:03d}: {e}"
                ) from e

        # Begin an immediate exclusive transaction for atomic DDL + DML execution
        conn.execute("BEGIN IMMEDIATE")

        for stmt in statements:
            core = _strip_sql_comments(stmt)
            if not core:
                continue
            cleaned = core.rstrip(";")
            # Do not execute standalone PRAGMA foreign_keys inside the transaction
            # (PRAGMA foreign_keys is a no-op inside transactions and is managed by the runner)
            if cleaned.upper().startswith("PRAGMA FOREIGN_KEYS"):
                continue
            conn.execute(stmt)

        # Run foreign key integrity check INSIDE the active transaction before commit
        fk_errors = conn.execute("PRAGMA foreign_key_check").fetchall()
        if fk_errors:
            raise MigrationError(
                f"Migration {version:03d} resulted in foreign key constraint violations: {fk_errors}"
            )

        # Insert migration tracking record within the same transaction
        now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute(
            "INSERT OR REPLACE INTO schema_migrations (version, checksum, applied_at) "
            "VALUES (?, ?, ?)",
            (version, checksum, now_utc),
        )

        conn.commit()

    except Exception as e:
        if conn.in_transaction:
            try:
                conn.rollback()
            except Exception:
                pass
        if isinstance(e, MigrationError):
            migration_exc = e
        else:
            migration_exc = MigrationError(f"Migration {version:03d} failed: {e}")
            migration_exc.__cause__ = e
        raise migration_exc

    finally:
        # Always restore and verify foreign-key enforcement after success and failure
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            fk_status = conn.execute("PRAGMA foreign_keys").fetchone()
            if not fk_status or fk_status[0] != 1:
                raise MigrationError(
                    f"Failed to restore foreign key enforcement after migration {version:03d}."
                )
        except Exception as restore_err:
            if migration_exc is not None:
                # Do not silently replace the original migration exception.
                # Preserve migration_exc as primary, attaching restore_err in context / notes.
                if hasattr(migration_exc, "add_note"):
                    migration_exc.add_note(
                        f"Additionally, foreign-key restoration failed: {restore_err}"
                    )
                migration_exc.__context__ = restore_err
                raise migration_exc
            else:
                if isinstance(restore_err, MigrationError):
                    raise
                raise MigrationError(
                    f"Failed to restore foreign key enforcement after migration {version:03d}: {restore_err}"
                ) from restore_err


def get_case_db_path(data_dir: str | Path, case_id: str) -> Path:
    """
    Return the path to a case database file.

    Structure: <data_dir>/cases/<case_id>/case.db
    Also supports data_dir directly pointing to the cases folder.
    """
    p = Path(data_dir)
    direct = p / case_id / "case.db"
    if direct.is_file():
        return direct
    nested = p / "cases" / case_id / "case.db"
    if nested.is_file():
        return nested
    if p.name == "cases":
        return direct
    return nested


def open_case_db(
    db_path: str | Path,
    *,
    create: bool = False,
    read_only: bool = False,
) -> sqlite3.Connection:
    """
    Open a case database connection with required pragmas.

    Args:
        db_path: Path to the case.db file.
        create: If True, create the database file and parent directories
                if they do not exist. If False, raise DatabaseError when
                the file is missing.
        read_only: If True, enforce read-only execution (PRAGMA query_only = ON)
                   to guarantee evidence immutability during retrieval and verification.

    Returns:
        A configured sqlite3.Connection with foreign keys, WAL, and
        busy timeout enabled.

    Raises:
        DatabaseError: If the database file does not exist and create=False.
        FTS5NotAvailableError: If the SQLite build lacks FTS5 support.
    """
    db_path = Path(db_path)

    if not create and not db_path.exists():
        raise DatabaseError(f"Case database not found: {db_path}")

    if create:
        db_path.parent.mkdir(parents=True, exist_ok=True)

    if read_only:
        # Enforce OS-level and SQLite-level read-only mode (URI mode=ro + PRAGMA query_only = ON)
        uri = db_path.resolve().as_uri() + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True)
    else:
        conn = sqlite3.connect(str(db_path))

    conn.row_factory = sqlite3.Row

    _configure_connection(conn)

    if read_only:
        conn.execute("PRAGMA query_only = ON")

    if create and not _check_fts5_available(conn):
        conn.close()
        raise FTS5NotAvailableError(
            "The current SQLite build does not support FTS5. "
            "FTS5 is required for ForensicLens evidence retrieval. "
            "Please install a Python build with FTS5-enabled SQLite."
        )

    return conn


def open_case_db_readonly(db_path: str | Path) -> sqlite3.Connection:
    """
    Open a case database connection in strictly read-only mode (PRAGMA query_only = ON).

    Used during claim verification and evidence retrieval to ensure absolute immutability.
    """
    return open_case_db(db_path, create=False, read_only=True)


def initialize_case_db(
    db_path: str | Path,
    case_id: str,
    case_name: str,
    *,
    created_by: Optional[str] = None,
) -> sqlite3.Connection:
    """
    Create and initialize a new case database with the full P0 schema.

    This function:
    1. Creates the database file and parent directories.
    2. Enables foreign keys, WAL mode, and busy timeout.
    3. Validates FTS5 availability.
    4. Applies all pending migrations.
    5. Inserts the initial case record.
    6. Inserts the default privacy configuration (L2).

    Args:
        db_path: Path for the new case.db file.
        case_id: Unique case identifier (UUIDv4/ULID).
        case_name: Human-readable case name.
        created_by: Optional local principal identifier.

    Returns:
        An open, configured sqlite3.Connection.

    Raises:
        MigrationError: If any migration fails.
        FTS5NotAvailableError: If FTS5 is not available.
    """
    conn = open_case_db(db_path, create=True)

    try:
        run_migrations(conn)

        now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        conn.execute(
            "INSERT INTO cases "
            "(case_id, name, description, status, created_at, updated_at, "
            "created_by, schema_version) "
            "VALUES (?, ?, NULL, 'OPEN', ?, ?, ?, ?)",
            (case_id, case_name, now_utc, now_utc, created_by, SCHEMA_VERSION),
        )

        # Seed default privacy config: L2 per DATABASE.md section 10
        conn.execute(
            "INSERT INTO privacy_configs (case_id, level, updated_at) "
            "VALUES (?, 'L2', ?)",
            (case_id, now_utc),
        )

        conn.commit()
        return conn

    except Exception:
        conn.close()
        raise


def run_migrations(conn: sqlite3.Connection) -> list[int]:
    """
    Apply all pending migrations to a case database.

    Migrations are applied in numeric order. Already-applied migrations
    are verified by checksum to detect tampering.

    Args:
        conn: An open, configured database connection.

    Returns:
        A list of migration versions that were applied.

    Raises:
        MigrationError: If a migration fails or a checksum mismatch is detected.
    """
    applied = _get_applied_migrations(conn)
    migrations = _get_migration_files()
    newly_applied: list[int] = []

    for version, path in migrations:
        sql_text = path.read_text(encoding="utf-8")
        checksum = _compute_migration_checksum(sql_text)

        if version in applied:
            if applied[version] != checksum:
                raise MigrationError(
                    f"Migration {version:03d} checksum mismatch. "
                    f"Expected {applied[version]}, got {checksum}. "
                    f"Migration files must not be modified after application."
                )
            continue  # already applied

        _apply_migration(conn, version, path)
        newly_applied.append(version)

    return newly_applied


# ---------------------------------------------------------------
# Schema verification
# ---------------------------------------------------------------

# All P0 case-scoped tables from DATABASE.md section 4
EXPECTED_TABLES: frozenset[str] = frozenset(
    [
        "schema_migrations",
        "cases",
        "evidence_files",
        "raw_records",
        "events",
        "sessions",
        "session_events",
        "entities",
        "event_entities",
        "investigations",
        "jobs",
        "claims",
        "claim_slots",
        "claim_evidence",
        "claim_verifications",
        "behaviour_mappings",
        "integrity_findings",
        "privacy_configs",
        "audit_records",
        "reports",
    ]
)

# FTS5 virtual tables
EXPECTED_FTS_TABLES: frozenset[str] = frozenset(
    [
        "events_fts",
        "raw_records_fts",
    ]
)


def verify_schema(conn: sqlite3.Connection) -> dict:
    """
    Verify that the database schema matches the expected P0 specification.

    Returns a dict with:
        - tables_present: set of regular tables found
        - tables_missing: set of expected tables not found
        - fts_tables_present: set of FTS5 tables found
        - fts_tables_missing: set of expected FTS5 tables not found
        - foreign_keys_enabled: whether PRAGMA foreign_keys is ON
        - journal_mode: current journal mode
        - schema_version: latest applied migration version
        - valid: True if all checks pass

    Raises:
        SchemaValidationError: If critical schema elements are missing.
    """
    # Get all tables
    rows = conn.execute(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') "
        "ORDER BY name"
    ).fetchall()
    all_tables = {row[0] for row in rows}

    # FTS5 shadow tables are named <table>_* ; check the base virtual table
    fts_rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' "
        "AND sql LIKE '%fts5%'"
    ).fetchall()
    fts_tables_found = {row[0] for row in fts_rows}

    # Also check for virtual table entries directly
    vtable_rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE sql LIKE '%USING fts5%'"
    ).fetchall()
    fts_tables_found.update(row[0] for row in vtable_rows)

    # Foreign keys
    fk_status = conn.execute("PRAGMA foreign_keys").fetchone()
    fk_enabled = bool(fk_status[0]) if fk_status else False

    # Journal mode
    journal = conn.execute("PRAGMA journal_mode").fetchone()
    journal_mode = journal[0] if journal else "unknown"

    # Schema version
    try:
        ver_row = conn.execute(
            "SELECT MAX(version) FROM schema_migrations"
        ).fetchone()
        schema_version = ver_row[0] if ver_row and ver_row[0] is not None else 0
    except sqlite3.OperationalError:
        schema_version = 0

    tables_present = EXPECTED_TABLES & all_tables
    tables_missing = EXPECTED_TABLES - all_tables
    fts_present = EXPECTED_FTS_TABLES & fts_tables_found
    fts_missing = EXPECTED_FTS_TABLES - fts_tables_found

    valid = (
        len(tables_missing) == 0
        and len(fts_missing) == 0
        and fk_enabled
        and journal_mode == "wal"
        and schema_version >= SCHEMA_VERSION
    )

    result = {
        "tables_present": tables_present,
        "tables_missing": tables_missing,
        "fts_tables_present": fts_present,
        "fts_tables_missing": fts_missing,
        "foreign_keys_enabled": fk_enabled,
        "journal_mode": journal_mode,
        "schema_version": schema_version,
        "valid": valid,
    }

    if not valid:
        issues = []
        if tables_missing:
            issues.append(f"Missing tables: {tables_missing}")
        if fts_missing:
            issues.append(f"Missing FTS5 tables: {fts_missing}")
        if not fk_enabled:
            issues.append("Foreign keys not enabled")
        if journal_mode != "wal":
            issues.append(f"Journal mode is '{journal_mode}', expected 'wal'")
        if schema_version < SCHEMA_VERSION:
            issues.append(
                f"Schema version {schema_version} < required {SCHEMA_VERSION}"
            )
        raise SchemaValidationError(
            "Schema validation failed: " + "; ".join(issues)
        )

    return result


def close_case_db(conn: sqlite3.Connection) -> None:
    """Safely close a case database connection."""
    if conn:
        try:
            conn.close()
        except sqlite3.Error:
            pass


# ---------------------------------------------------------------
# Global legal KB initialization (separate database)
# ---------------------------------------------------------------

def initialize_legal_kb(db_path: str | Path) -> sqlite3.Connection:
    """
    Create and initialize the global legal knowledge base.

    The legal KB is a separate read-only database that is NOT part of
    any case. It stores curated Indian legal provisions and their
    elements as defined in DATABASE.md section 5.

    Args:
        db_path: Path for the legal KB database file.

    Returns:
        An open sqlite3.Connection.
    """
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(f"PRAGMA busy_timeout = {DEFAULT_BUSY_TIMEOUT_MS}")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS legal_provisions (
            legal_id        TEXT NOT NULL PRIMARY KEY,
            act             TEXT NOT NULL,
            section         TEXT NOT NULL,
            title           TEXT,
            text            TEXT NOT NULL,
            status          TEXT NOT NULL CHECK (status IN (
                                'IN_FORCE', 'REPEALED', 'STRUCK_DOWN', 'SUPERSEDED')),
            effective_from  TEXT,
            effective_to    TEXT,
            version         TEXT NOT NULL,
            source_uri      TEXT NOT NULL,
            source_hash     TEXT NOT NULL,
            created_at      TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_legal_act_section
            ON legal_provisions (act, section);

        CREATE INDEX IF NOT EXISTS idx_legal_status_dates
            ON legal_provisions (status, effective_from, effective_to);

        CREATE TABLE IF NOT EXISTS legal_elements (
            legal_element_id        TEXT    NOT NULL PRIMARY KEY,
            legal_id                TEXT    NOT NULL REFERENCES legal_provisions (legal_id),
            element_key             TEXT    NOT NULL,
            description             TEXT    NOT NULL,
            requires_human_judgment INTEGER NOT NULL CHECK (requires_human_judgment IN (0, 1)),
            ordinal                 INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_elements_key
            ON legal_elements (legal_id, element_key);
    """)

    conn.commit()
    return conn
