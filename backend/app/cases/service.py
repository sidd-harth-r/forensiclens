"""
Case repository service.

Handles discovery, retrieval, creation, and metadata aggregation
across per-case isolated SQLite databases.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from app.cases.database import close_case_db, initialize_case_db, open_case_db

logger = logging.getLogger(__name__)


def get_case(cases_dir: str | Path, case_id: str) -> Optional[dict]:
    """
    Retrieve case metadata and artifact statistics from its isolated database.

    Returns None if the case database does not exist.
    """
    case_path = Path(cases_dir) / case_id / "case.db"
    if not case_path.is_file():
        return None

    conn = None
    try:
        conn = open_case_db(case_path)

        # 1. Base case row
        case_row = conn.execute(
            """
            SELECT case_id, name, description, status, created_at, updated_at, created_by
            FROM cases
            WHERE case_id = ?
            """,
            (case_id,),
        ).fetchone()

        if not case_row:
            return None

        # 2. Evidence count
        evidence_count = conn.execute(
            "SELECT COUNT(*) FROM evidence_files WHERE case_id = ?",
            (case_id,),
        ).fetchone()[0]

        # 3. Events count
        events_count = conn.execute(
            "SELECT COUNT(*) FROM events WHERE case_id = ?",
            (case_id,),
        ).fetchone()[0]

        # 4. Investigations count
        investigations_count = conn.execute(
            "SELECT COUNT(*) FROM investigations WHERE case_id = ?",
            (case_id,),
        ).fetchone()[0]

        # 5. Integrity findings count
        findings_count = conn.execute(
            "SELECT COUNT(*) FROM integrity_findings WHERE case_id = ?",
            (case_id,),
        ).fetchone()[0]

        # 6. Last activity timestamp
        last_activity_row = conn.execute(
            """
            SELECT MAX(ts) FROM (
                SELECT created_at AS ts FROM evidence_files WHERE case_id = ?
                UNION ALL
                SELECT created_at AS ts FROM events WHERE case_id = ?
                UNION ALL
                SELECT updated_at AS ts FROM cases WHERE case_id = ?
            )
            """,
            (case_id, case_id, case_id),
        ).fetchone()

        last_activity = (
            last_activity_row[0]
            if last_activity_row and last_activity_row[0]
            else case_row["updated_at"]
        )

        return {
            "caseId": case_row["case_id"],
            "name": case_row["name"],
            "description": case_row["description"] or "",
            "status": case_row["status"],
            "evidenceCount": evidence_count,
            "eventsCount": events_count,
            "investigationsCount": investigations_count,
            "findingsCount": findings_count,
            "lastActivity": last_activity,
            "createdAt": case_row["created_at"],
            "leadInvestigator": case_row["created_by"] or "Lead Analyst",
        }
    except Exception as e:
        logger.error("Error reading case %s: %s", case_id, e)
        return None
    finally:
        if conn:
            close_case_db(conn)


def list_cases(cases_dir: str | Path) -> list[dict]:
    """
    Discover all initialized forensic cases by inspecting the cases directory.

    Returns cases sorted by lastActivity descending.
    """
    dir_path = Path(cases_dir)
    if not dir_path.is_dir():
        return []

    results: list[dict] = []
    for item in sorted(dir_path.iterdir()):
        if item.is_dir() and (item / "case.db").is_file():
            case_data = get_case(dir_path, item.name)
            if case_data:
                results.append(case_data)

    results.sort(key=lambda c: c.get("lastActivity", ""), reverse=True)
    return results


def create_case(
    cases_dir: str | Path,
    case_id: str,
    name: str,
    *,
    description: Optional[str] = None,
    created_by: Optional[str] = None,
) -> dict:
    """
    Initialize a new forensic case and database.

    Raises FileExistsError if the case already exists.
    """
    dir_path = Path(cases_dir)
    case_dir = dir_path / case_id
    db_path = case_dir / "case.db"

    if db_path.exists():
        raise FileExistsError(f"Case '{case_id}' already exists at {db_path}")

    conn = initialize_case_db(
        db_path=db_path,
        case_id=case_id,
        case_name=name,
        created_by=created_by,
    )

    try:
        if description:
            conn.execute(
                "UPDATE cases SET description = ? WHERE case_id = ?",
                (description, case_id),
            )
            conn.commit()
    finally:
        close_case_db(conn)

    case_data = get_case(cases_dir, case_id)
    if not case_data:
        raise RuntimeError(f"Failed to read initialized case '{case_id}'")
    return case_data

