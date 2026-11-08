"""
Append-Only Verification Persistence Module for ForensicLens.

Guarantees:
1. Append-only immutability of verification audit records:
   - Separate, tightly scoped writable connection.
   - Database triggers enforce that rows in claim_verifications cannot be updated or deleted.
2. Single-transaction consistency:
   - claim_verifications insertion and claims.status denormalized cache update execute
     in the exact same database transaction.
3. Complete provenance preservation:
   - Full rule metadata, parameter resolution, supporting records, contradicting records,
     and failure reasons are preserved.
4. Read-only verification history inspection:
   - Historical queries use read-only database connections (PRAGMA query_only = ON)
     and enforce claim ownership within the requested case.
5. Controlled extraction persistence:
   - Extracted claims are persisted with status = UNVERIFIED without executing verification.
   - Cross-case claims are rejected.
   - No unsafe INSERT OR IGNORE: claim ID collisions abort and roll back the entire batch.
   - Citations are never attached to existing claims on collision.
   - Exact extractor confidence is persisted and retrieved (never substituting 1.0).
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from app.cases.database import (
    close_case_db,
    get_case_db_path,
    open_case_db,
    open_case_db_readonly,
)
from app.config import SAFE_ID_REGEX, get_cases_dir
from app.verification.schemas import (
    Claim,
    ClaimType,
    ClaimVerificationResult,
    EvidenceReference,
    VerificationStatus,
)

logger = logging.getLogger(__name__)


def ensure_append_only_triggers(conn: sqlite3.Connection) -> None:
    """
    Idempotently creates database-level triggers preventing mutation or deletion
    of claim_verifications records.
    """
    conn.executescript("""
        CREATE TRIGGER IF NOT EXISTS trg_prevent_verification_update
        BEFORE UPDATE ON claim_verifications
        BEGIN
            SELECT RAISE(FAIL, 'claim_verifications records are immutable and cannot be updated');
        END;

        CREATE TRIGGER IF NOT EXISTS trg_prevent_verification_delete
        BEFORE DELETE ON claim_verifications
        BEGIN
            SELECT RAISE(FAIL, 'claim_verifications table is append-only: records are immutable and cannot be deleted');
        END;
    """)


def save_claim_verification(
    case_id: str,
    result: ClaimVerificationResult,
    claim: Optional[Claim] = None,
    data_dir: Optional[str | Path] = None,
) -> ClaimVerificationResult:
    """
    Persist an immutable verification audit record and atomically update the
    denormalized claim status cache.

    Guarantees:
    - Validates claim.case_id against case_id.
    - Validates result.claim_id against claim.claim_id.
    - Confirms the claim belongs to the requested case before inserting verification history.
    - Ensures the status-cache update targets the verified claim in that case.
    - Preserves transaction atomicity.

    Args:
        case_id: Scoping case identifier.
        result: ClaimVerificationResult to append.
        claim: Optional Claim model. If not yet in database, it will be inserted.
        data_dir: Optional base cases directory.

    Raises:
        FileNotFoundError: If the case database does not exist.
        ValueError: On cross-case integrity violations or missing claims.
        sqlite3.Error: If the transaction fails.
    """
    # 1. Pre-validation checks
    if claim is not None:
        if claim.case_id != case_id:
            raise ValueError(
                f"Cross-case integrity violation: Claim '{claim.claim_id}' has case_id '{claim.case_id}', "
                f"not target case '{case_id}'."
            )
        if result.claim_id != claim.claim_id:
            raise ValueError(
                f"Claim ID mismatch: Verification result claim_id '{result.claim_id}' does not match "
                f"claim '{claim.claim_id}'."
            )

    cases_dir = Path(data_dir) if data_dir else get_cases_dir()
    db_path = get_case_db_path(cases_dir, case_id)
    if not db_path.is_file():
        raise FileNotFoundError(f"Case database '{case_id}' not found at {db_path}.")

    conn = open_case_db(db_path, create=False)
    try:
        # Execute all mutations within a single atomic transaction
        with conn:
            # 2. Confirm claim exists and belongs to this case
            claim_row = conn.execute(
                "SELECT claim_id, case_id FROM claims WHERE claim_id = ?",
                (result.claim_id,),
            ).fetchone()

            if not claim_row:
                raise ValueError(f"Claim '{result.claim_id}' does not exist in case '{case_id}'.")

            if claim_row["case_id"] != case_id:
                raise ValueError(
                    f"Security violation: Claim '{result.claim_id}' belongs to case '{claim_row['case_id']}', "
                    f"cannot be verified in case '{case_id}'."
                )

            # 3. Insert immutable verification audit record
            conn.execute(
                """
                INSERT INTO claim_verifications (
                    verification_id, claim_id, status, rule_id, rule_version,
                    predicate_type, resolved_parameters_json, matched_row_count,
                    evidence_refs_json, supporting_records_json,
                    contradicting_records_json, explanation, failure_reason,
                    verifier_version, verified_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    result.verification_id,
                    result.claim_id,
                    result.status.value,
                    result.rule_id,
                    result.rule_version,
                    result.predicate_type,
                    json.dumps(result.resolved_parameters),
                    result.matched_row_count,
                    json.dumps(result.evidence_refs),
                    json.dumps(result.supporting_records),
                    json.dumps(result.contradicting_records),
                    result.explanation,
                    result.failure_reason,
                    result.verifier_version,
                    result.verified_at,
                ),
            )

            # 4. Atomically update claims.status denormalized cache targeting the verified claim in that case
            cur = conn.execute(
                "UPDATE claims SET status = ? WHERE claim_id = ? AND case_id = ?",
                (result.status.value, result.claim_id, case_id),
            )
            if cur.rowcount == 0:
                raise ValueError(
                    f"Status cache update failed: Claim '{result.claim_id}' not found in case '{case_id}'."
                )

        return result
    finally:
        close_case_db(conn)


def save_extracted_claims(
    case_id: str,
    claims: List[Claim],
    data_dir: Optional[str | Path] = None,
) -> List[Claim]:
    """
    Persist newly extracted atomic claims and their evidence references.

    Guarantees:
    - Rejects any claim whose case_id does not equal the supplied case_id.
    - Eliminates unsafe INSERT OR IGNORE: claim collisions raise IntegrityError.
    - Never attaches citations to existing claims on collision.
    - Entire batch rolls back atomically if any claim or citation fails.
    - Returns only claims confirmed to have been persisted.
    - Persists actual extractor confidence without substitution.

    Args:
        case_id: Scoping case identifier.
        claims: List of extracted Claim objects.
        data_dir: Optional base cases directory.

    Returns:
        List of persisted Claim objects.

    Raises:
        ValueError: If any claim.case_id != case_id.
        FileNotFoundError: If the case database does not exist.
        sqlite3.IntegrityError: On duplicate claim IDs or FK failures (batch is rolled back).
    """
    if not claims:
        return []

    # 1. Pre-validation: reject any claim whose case_id does not match the target case
    for claim in claims:
        if claim.case_id != case_id:
            raise ValueError(
                f"Cross-case integrity violation: Claim '{claim.claim_id}' has case_id '{claim.case_id}', "
                f"which does not match target case '{case_id}'."
            )

    cases_dir = Path(data_dir) if data_dir else get_cases_dir()
    db_path = get_case_db_path(cases_dir, case_id)
    if not db_path.is_file():
        raise FileNotFoundError(f"Case database '{case_id}' not found at {db_path}.")

    conn = open_case_db(db_path, create=False)
    persisted_claims: List[Claim] = []
    try:
        now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with conn:
            for claim in claims:
                # Security invariant: newly extracted claims MUST start as UNVERIFIED
                claim.current_status = VerificationStatus.UNVERIFIED

                # Eliminate unsafe INSERT OR IGNORE: use standard INSERT
                # If a claim_id already exists, UNIQUE constraint triggers and aborts batch
                conn.execute(
                    """
                    INSERT INTO claims (
                        claim_id, case_id, investigation_id, claim_type,
                        statement, subject, action, object, source_ip,
                        destination_ip, source_port, timestamp_claimed,
                        time_range_start, time_range_end, attributes_json,
                        model_output_json, status, extraction_method,
                        compiler_version, confidence, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        claim.claim_id,
                        case_id,
                        claim.investigation_id,
                        claim.claim_type.value,
                        claim.statement,
                        claim.subject,
                        claim.action,
                        claim.object,
                        claim.source_ip,
                        claim.destination_ip,
                        claim.source_port,
                        claim.timestamp_claimed,
                        claim.time_range_start,
                        claim.time_range_end,
                        json.dumps(claim.attributes),
                        claim.model_output_json,
                        VerificationStatus.UNVERIFIED.value,
                        claim.extraction_method.value,
                        claim.compiler_version,
                        claim.confidence,
                        claim.created_at or now_utc,
                    ),
                )

                for ref in claim.evidence_references:
                    ref_id = ref.claim_evidence_id or f"CE_{uuid.uuid4().hex[:12].upper()}"
                    conn.execute(
                        """
                        INSERT INTO claim_evidence (
                            claim_evidence_id, claim_id, evidence_id, raw_record_id,
                            event_id, role, record_no, line_number, byte_start,
                            byte_end, snippet, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            ref_id,
                            claim.claim_id,
                            ref.evidence_id,
                            ref.raw_record_id,
                            ref.event_id,
                            ref.role.value,
                            ref.record_no,
                            ref.line_number,
                            ref.byte_start,
                            ref.byte_end,
                            ref.snippet,
                            ref.created_at or now_utc,
                        ),
                    )
                persisted_claims.append(claim)

        return persisted_claims
    finally:
        close_case_db(conn)


def get_claim_by_id(
    case_id: str,
    claim_id: str,
    data_dir: Optional[str | Path] = None,
) -> Optional[Claim]:
    """
    Retrieve a single claim and its evidence references by claim_id, scoped to case_id.

    Returns None if the claim does not exist or does not belong to case_id.
    Uses a strictly read-only connection.
    """
    cases_dir = Path(data_dir) if data_dir else get_cases_dir()
    db_path = get_case_db_path(cases_dir, case_id)
    if not db_path.is_file():
        return None

    conn = open_case_db_readonly(db_path)
    try:
        row = conn.execute(
            "SELECT * FROM claims WHERE case_id = ? AND claim_id = ?",
            (case_id, claim_id),
        ).fetchone()

        if not row:
            return None

        # Fetch evidence references
        evidence_rows = conn.execute(
            """
            SELECT * FROM claim_evidence
            WHERE claim_id = ?
            ORDER BY record_no ASC, line_number ASC
            """,
            (claim_id,),
        ).fetchall()

        refs: List[EvidenceReference] = []
        for er in evidence_rows:
            refs.append(
                EvidenceReference(
                    claimEvidenceId=er["claim_evidence_id"],
                    claimId=er["claim_id"],
                    evidenceId=er["evidence_id"],
                    rawRecordId=er["raw_record_id"],
                    eventId=er["event_id"],
                    role=er["role"],
                    recordNo=er["record_no"],
                    lineNumber=er["line_number"],
                    byteStart=er["byte_start"],
                    byteEnd=er["byte_end"],
                    snippet=er["snippet"],
                    createdAt=er["created_at"],
                )
            )

        try:
            attrs = json.loads(row["attributes_json"] or "{}")
        except (json.JSONDecodeError, TypeError):
            attrs = {}

        confidence_val: Optional[float] = None
        if "confidence" in row.keys() and row["confidence"] is not None:
            confidence_val = float(row["confidence"])

        return Claim(
            claimId=row["claim_id"],
            caseId=row["case_id"],
            investigationId=row["investigation_id"],
            claimType=row["claim_type"],
            statement=row["statement"],
            subject=row["subject"],
            action=row["action"],
            object=row["object"],
            sourceIp=row["source_ip"],
            destinationIp=row["destination_ip"],
            sourcePort=row["source_port"],
            timestampClaimed=row["timestamp_claimed"],
            timeRangeStart=row["time_range_start"],
            timeRangeEnd=row["time_range_end"],
            attributes=attrs,
            modelOutputJson=row["model_output_json"],
            extractionMethod=row["extraction_method"],
            compilerVersion=row["compiler_version"],
            confidence=confidence_val,
            evidenceReferences=refs,
            currentStatus=row["status"],
            createdAt=row["created_at"],
        )
    finally:
        close_case_db(conn)


def get_case_claims(
    case_id: str,
    claim_type: Optional[str] = None,
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    data_dir: Optional[str | Path] = None,
) -> Tuple[List[Claim], int, Dict[str, int]]:
    """
    Retrieve paginated claims for a case with optional claim_type and status filters,
    along with global status summary counts.

    Uses a strictly read-only database connection.
    """
    cases_dir = Path(data_dir) if data_dir else get_cases_dir()
    db_path = get_case_db_path(cases_dir, case_id)
    if not db_path.is_file():
        raise FileNotFoundError(f"Case database '{case_id}' not found at {db_path}.")

    conn = open_case_db_readonly(db_path)
    try:
        # 1. Calculate status summary across all claims in the case
        summary: Dict[str, int] = {
            VerificationStatus.SUPPORTED.value: 0,
            VerificationStatus.CONTRADICTED.value: 0,
            VerificationStatus.UNVERIFIED.value: 0,
            VerificationStatus.INSUFFICIENT_EVIDENCE.value: 0,
        }
        sum_rows = conn.execute(
            "SELECT status, COUNT(*) as cnt FROM claims WHERE case_id = ? GROUP BY status",
            (case_id,),
        ).fetchall()
        for sr in sum_rows:
            st = sr["status"]
            if st in summary:
                summary[st] = sr["cnt"]

        # 2. Build filtered query
        where_clauses = ["case_id = ?"]
        params: List[Any] = [case_id]

        if claim_type:
            where_clauses.append("claim_type = ?")
            params.append(claim_type)

        if status:
            where_clauses.append("status = ?")
            params.append(status)

        where_sql = " AND ".join(where_clauses)

        # Count total matching
        total_row = conn.execute(
            f"SELECT COUNT(*) as cnt FROM claims WHERE {where_sql}",
            params,
        ).fetchone()
        total = total_row["cnt"] if total_row else 0

        # Pagination bounds
        safe_page = max(1, page)
        safe_page_size = max(1, min(page_size, 200))
        offset = (safe_page - 1) * safe_page_size

        rows = conn.execute(
            f"""
            SELECT * FROM claims
            WHERE {where_sql}
            ORDER BY created_at ASC, claim_id ASC
            LIMIT ? OFFSET ?
            """,
            params + [safe_page_size, offset],
        ).fetchall()

        if not rows:
            return [], total, summary

        # 3. Fetch evidence references for all returned claims in one query
        claim_ids = [r["claim_id"] for r in rows]
        placeholders = ",".join("?" for _ in claim_ids)
        ev_rows = conn.execute(
            f"""
            SELECT * FROM claim_evidence
            WHERE claim_id IN ({placeholders})
            ORDER BY record_no ASC, line_number ASC
            """,
            claim_ids,
        ).fetchall()

        refs_by_claim: Dict[str, List[EvidenceReference]] = {cid: [] for cid in claim_ids}
        for er in ev_rows:
            refs_by_claim[er["claim_id"]].append(
                EvidenceReference(
                    claimEvidenceId=er["claim_evidence_id"],
                    claimId=er["claim_id"],
                    evidenceId=er["evidence_id"],
                    rawRecordId=er["raw_record_id"],
                    eventId=er["event_id"],
                    role=er["role"],
                    recordNo=er["record_no"],
                    lineNumber=er["line_number"],
                    byteStart=er["byte_start"],
                    byteEnd=er["byte_end"],
                    snippet=er["snippet"],
                    createdAt=er["created_at"],
                )
            )

        claims: List[Claim] = []
        for r in rows:
            cid = r["claim_id"]
            try:
                attrs = json.loads(r["attributes_json"] or "{}")
            except (json.JSONDecodeError, TypeError):
                attrs = {}

            confidence_val: Optional[float] = None
            if "confidence" in r.keys() and r["confidence"] is not None:
                confidence_val = float(r["confidence"])

            claims.append(
                Claim(
                    claimId=cid,
                    caseId=r["case_id"],
                    investigationId=r["investigation_id"],
                    claimType=r["claim_type"],
                    statement=r["statement"],
                    subject=r["subject"],
                    action=r["action"],
                    object=r["object"],
                    sourceIp=r["source_ip"],
                    destinationIp=r["destination_ip"],
                    sourcePort=r["source_port"],
                    timestampClaimed=r["timestamp_claimed"],
                    timeRangeStart=r["time_range_start"],
                    timeRangeEnd=r["time_range_end"],
                    attributes=attrs,
                    modelOutputJson=r["model_output_json"],
                    extractionMethod=r["extraction_method"],
                    compilerVersion=r["compiler_version"],
                    confidence=confidence_val,
                    evidenceReferences=refs_by_claim.get(cid, []),
                    currentStatus=r["status"],
                    createdAt=r["created_at"],
                )
            )

        return claims, total, summary
    finally:
        close_case_db(conn)


def get_claim_verification_history(
    case_id: str,
    claim_id: str,
    data_dir: Optional[str | Path] = None,
) -> List[ClaimVerificationResult]:
    """
    Retrieve the immutable verification history for a claim in reverse chronological order.

    Guarantees:
    - Enforces claim ownership within the requested case.
    - Uses a strictly read-only database connection.
    - Deterministic ordering: ORDER BY verified_at DESC, rowid DESC.
    """
    cases_dir = Path(data_dir) if data_dir else get_cases_dir()
    db_path = get_case_db_path(cases_dir, case_id)
    if not db_path.is_file():
        raise FileNotFoundError(f"Case database '{case_id}' not found at {db_path}.")

    conn = open_case_db_readonly(db_path)
    try:
        # Enforce claim ownership within the requested case
        claim_row = conn.execute(
            "SELECT case_id FROM claims WHERE claim_id = ?",
            (claim_id,),
        ).fetchone()
        if not claim_row:
            raise ValueError(f"Claim '{claim_id}' not found in case '{case_id}'.")
        if claim_row["case_id"] != case_id:
            raise ValueError(
                f"Security violation: Claim '{claim_id}' belongs to case '{claim_row['case_id']}', "
                f"not requested case '{case_id}'."
            )

        rows = conn.execute(
            """
            SELECT verification_id, claim_id, status, rule_id, rule_version,
                   predicate_type, resolved_parameters_json, matched_row_count,
                   evidence_refs_json, supporting_records_json,
                   contradicting_records_json, explanation, failure_reason,
                   verifier_version, verified_at
            FROM claim_verifications
            WHERE claim_id = ?
            ORDER BY verified_at DESC, rowid DESC
            """,
            (claim_id,),
        ).fetchall()

        results: List[ClaimVerificationResult] = []
        for r in rows:
            results.append(
                ClaimVerificationResult(
                    verificationId=r["verification_id"],
                    claimId=r["claim_id"],
                    status=VerificationStatus(r["status"]),
                    ruleId=r["rule_id"],
                    ruleVersion=r["rule_version"],
                    predicateType=r["predicate_type"],
                    resolvedParameters=json.loads(r["resolved_parameters_json"] or "{}"),
                    matchedRowCount=r["matched_row_count"],
                    evidenceRefs=json.loads(r["evidence_refs_json"] or "[]"),
                    supportingRecords=json.loads(r["supporting_records_json"] or "[]"),
                    contradictingRecords=json.loads(r["contradicting_records_json"] or "[]"),
                    explanation=r["explanation"],
                    failureReason=r["failure_reason"],
                    verifierVersion=r["verifier_version"],
                    verifiedAt=r["verified_at"],
                )
            )
        return results
    finally:
        close_case_db(conn)


def get_latest_claim_status(
    case_id: str,
    claim_id: str,
    data_dir: Optional[str | Path] = None,
) -> VerificationStatus:
    """
    Resolve the authoritative current verification status of a claim from its verification history.
    Defaults to UNVERIFIED if no verification attempts have been recorded.

    Guarantees:
    - Enforces claim ownership within the requested case.
    - Uses a strictly read-only database connection.
    - Deterministic ordering: ORDER BY verified_at DESC, rowid DESC LIMIT 1.
    """
    cases_dir = Path(data_dir) if data_dir else get_cases_dir()
    db_path = get_case_db_path(cases_dir, case_id)
    if not db_path.is_file():
        raise FileNotFoundError(f"Case database '{case_id}' not found at {db_path}.")

    conn = open_case_db_readonly(db_path)
    try:
        # Enforce claim ownership within the requested case
        claim_row = conn.execute(
            "SELECT case_id FROM claims WHERE claim_id = ?",
            (claim_id,),
        ).fetchone()
        if not claim_row:
            raise ValueError(f"Claim '{claim_id}' not found in case '{case_id}'.")
        if claim_row["case_id"] != case_id:
            raise ValueError(
                f"Security violation: Claim '{claim_id}' belongs to case '{claim_row['case_id']}', "
                f"not requested case '{case_id}'."
            )

        row = conn.execute(
            "SELECT status FROM claim_verifications WHERE claim_id = ? ORDER BY verified_at DESC, rowid DESC LIMIT 1",
            (claim_id,),
        ).fetchone()
        if row:
            return VerificationStatus(row["status"])
        return VerificationStatus.UNVERIFIED
    finally:
        close_case_db(conn)
