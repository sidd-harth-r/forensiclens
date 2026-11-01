"""
Case management module.

Provides database initialization, migration, and schema verification
for per-case isolated SQLite databases.
"""

from app.cases.database import (
    DatabaseError,
    FTS5NotAvailableError,
    MigrationError,
    SchemaValidationError,
    close_case_db,
    get_case_db_path,
    initialize_case_db,
    initialize_legal_kb,
    open_case_db,
    run_migrations,
    verify_schema,
)
from app.cases.service import (
    create_case,
    get_case,
    list_cases,
)

__all__ = [
    "DatabaseError",
    "FTS5NotAvailableError",
    "MigrationError",
    "SchemaValidationError",
    "close_case_db",
    "create_case",
    "get_case",
    "get_case_db_path",
    "initialize_case_db",
    "initialize_legal_kb",
    "list_cases",
    "open_case_db",
    "run_migrations",
    "verify_schema",
]

