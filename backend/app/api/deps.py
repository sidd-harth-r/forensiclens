"""
FastAPI dependency injection utilities.

Enforces case isolation, identifier validation, and safe resource cleanup.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Generator

from fastapi import HTTPException, status

from app.cases.database import close_case_db, open_case_db, open_case_db_readonly
from app.config import SAFE_ID_REGEX, get_cases_dir


def validate_identifier(ident: str, name: str = "identifier") -> str:
    """Validate identifier contains only safe alphanumeric/hyphen/underscore characters."""
    if not ident or not SAFE_ID_REGEX.match(ident) or ".." in ident:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid {name} format: must be alphanumeric, hyphen, or underscore without path traversal.",
        )
    return ident


def get_verified_case_dir(case_id: str) -> Path:
    """
    Ensure the case ID is valid and the case directory and database exist.

    Raises 400 on malformed ID, 404 if case does not exist.
    """
    validate_identifier(case_id, "case_id")
    cases_dir = get_cases_dir()
    case_dir = cases_dir / case_id
    db_path = case_dir / "case.db"

    if not db_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Forensic case '{case_id}' does not exist.",
        )

    return case_dir


def get_case_connection(case_id: str) -> Generator[sqlite3.Connection, None, None]:
    """
    Open an isolated SQLite connection for the specified case.

    Guarantees the connection is closed when the HTTP request finishes.
    """
    case_dir = get_verified_case_dir(case_id)
    db_path = case_dir / "case.db"

    conn = open_case_db(db_path)
    try:
        yield conn
    finally:
        close_case_db(conn)


def get_readonly_case_connection(case_id: str) -> Generator[sqlite3.Connection, None, None]:
    """
    Open an isolated, read-only SQLite connection (PRAGMA query_only = ON) for the specified case.

    Guarantees evidence immutability during retrieval and verification operations.
    """
    case_dir = get_verified_case_dir(case_id)
    db_path = case_dir / "case.db"

    conn = open_case_db_readonly(db_path)
    try:
        yield conn
    finally:
        close_case_db(conn)
