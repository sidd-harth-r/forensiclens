"""
Deterministic Claim Verification Engine for ForensicLens.

Evaluates structured forensic claims independently against actual case evidence
using read-only parameterized database queries and deterministic predicate rules.

Guarantees:
1. Four-state outcome: SUPPORTED, CONTRADICTED, UNVERIFIED, INSUFFICIENT_EVIDENCE.
2. Read-only SQLite URI mode (file:...?mode=ro) + PRAGMA query_only = ON.
3. Parameterized SQL with zero LLM dynamic SQL generation.
4. Absolute immutability of evidence and normalized events.
5. Strict case isolation and cross-case validation.
6. Explicit disclaimer of physical human identity attribution.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from app.cases.database import (
    close_case_db,
    get_case_db_path,
    open_case_db_readonly,
)
from app.config import SAFE_ID_REGEX, get_cases_dir
from app.verification.predicates import (
    PredicateRegistry,
    default_predicate_registry,
)
from app.verification.schemas import (
    Claim,
    ClaimVerificationResult,
    VerificationStatus,
)

logger = logging.getLogger(__name__)


class VerificationEngineError(Exception):
    """Base exception for claim verification engine failures."""


class CaseDatabaseNotFoundError(VerificationEngineError):
    """Raised when the case database file does not exist."""


class CrossCaseViolationError(VerificationEngineError):
    """Raised when cross-case evidence or claim evaluation is detected."""


class DeterministicVerificationEngine:
    """
    Coordinates deterministic evaluation of atomic claims against case evidence.
    """

    def __init__(
        self,
        registry: Optional[PredicateRegistry] = None,
        data_dir: Optional[str | Path] = None,
    ):
        self.registry = registry or default_predicate_registry
        self.data_dir = Path(data_dir) if data_dir else get_cases_dir()

    def _validate_case_identifier(self, case_id: str) -> None:
        """Enforce strict safe identifier rules against directory traversal."""
        if not case_id or not SAFE_ID_REGEX.match(case_id) or ".." in case_id:
            raise ValueError(f"Invalid case_id format: '{case_id}'. Must be alphanumeric with hyphens/underscores.")

    def verify_claim(self, case_id: str, claim: Claim) -> ClaimVerificationResult:
        """
        Verify a single atomic claim against the specified case database.

        Args:
            case_id: Target case identifier.
            claim: Validated Claim model.

        Returns:
            ClaimVerificationResult with deterministic evaluation outcome.

        Raises:
            ValueError: If case_id is malformed.
            CrossCaseViolationError: If claim does not belong to case_id.
            CaseDatabaseNotFoundError: If case.db does not exist.
        """
        self._validate_case_identifier(case_id)

        # Enforce case isolation: claim must belong to this case
        if claim.case_id != case_id:
            raise CrossCaseViolationError(
                f"Security violation: Claim '{claim.claim_id}' belongs to case '{claim.case_id}', "
                f"cannot be verified in case '{case_id}'."
            )

        db_path = get_case_db_path(self.data_dir, case_id)
        if not db_path.is_file():
            raise CaseDatabaseNotFoundError(f"Case database for '{case_id}' not found at {db_path}.")

        # Retrieve rule for claim_type
        rule = self.registry.get_rule(claim.claim_type)

        # Open strictly read-only connection
        conn = open_case_db_readonly(db_path)
        try:
            # Deterministic evaluation under the rule
            eval_result = rule.evaluate(
                claim=claim,
                conn=conn,
                cited_references=claim.evidence_references,
            )

            now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            verification_id = f"VRF_{uuid.uuid4().hex[:12].upper()}"

            return ClaimVerificationResult(
                verificationId=verification_id,
                claimId=claim.claim_id,
                status=eval_result.status,
                ruleId=eval_result.rule_id,
                ruleVersion=eval_result.rule_version,
                predicateType=eval_result.predicate_type,
                resolvedParameters=eval_result.resolved_parameters,
                matchedRowCount=eval_result.matched_row_count,
                evidenceRefs=eval_result.evidence_refs,
                supportingRecords=eval_result.supporting_records,
                contradictingRecords=eval_result.contradicting_records,
                explanation=eval_result.explanation,
                failureReason=eval_result.failure_reason,
                discrepancies=eval_result.discrepancies,
                verifierVersion="1.0.0",
                verifiedAt=now_utc,
            )
        finally:
            close_case_db(conn)

    def verify_claims(self, case_id: str, claims: List[Claim]) -> List[ClaimVerificationResult]:
        """
        Batch verify multiple claims for a case.
        """
        results: List[ClaimVerificationResult] = []
        for claim in claims:
            results.append(self.verify_claim(case_id, claim))
        return results
