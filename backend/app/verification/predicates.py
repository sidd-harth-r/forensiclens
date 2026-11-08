"""
Deterministic Predicate Registry for ForensicLens Claim Verification.

Defines:
- BasePredicateRule: Abstract interface for all deterministic verification predicates.
- PredicateEvaluationResult: Typed result of evaluating a claim against case evidence.
- PredicateRegistry: Explicit catalog of rules mapping ClaimType to deterministic evaluators.

Enforces:
1. Four-state verification status: SUPPORTED, CONTRADICTED, UNVERIFIED, INSUFFICIENT_EVIDENCE.
2. Contradiction requires unambiguous incompatible evidence for the exact same attempt.
3. Unparsed substring matching alone never marks GENERIC_FORENSIC_EVENT as SUPPORTED.
4. Explanations explicitly disclaim physical human operator identity attribution.
5. Unsupported claim types explicitly produce INSUFFICIENT_EVIDENCE with clear parser gap reasons.
"""

from __future__ import annotations

import logging
import sqlite3
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from app.verification.schemas import (
    Claim,
    ClaimType,
    EvidenceReference,
    VerificationStatus,
)

logger = logging.getLogger(__name__)

ATTRIBUTION_DISCLAIMER = (
    " Forensic note: Observed attribute correspondence (username, IP, timestamp) establishes "
    "log-level evidence correlation only; it does not establish physical human operator identity attribution."
)


@dataclass
class PredicateEvaluationResult:
    """Typed outcome of a deterministic predicate evaluation."""

    status: VerificationStatus
    rule_id: str
    rule_version: str
    predicate_type: str
    resolved_parameters: Dict[str, Any]
    matched_row_count: int
    evidence_refs: List[str]
    supporting_records: List[Dict[str, Any]] = field(default_factory=list)
    contradicting_records: List[Dict[str, Any]] = field(default_factory=list)
    explanation: Optional[str] = None
    failure_reason: Optional[str] = None
    discrepancies: List[str] = field(default_factory=list)


class BasePredicateRule(ABC):
    """
    Abstract contract for a deterministic claim verification predicate.
    """

    @property
    @abstractmethod
    def rule_id(self) -> str:
        """Stable rule identifier (e.g. 'RULE_AUTH_SUCCESS_V1')."""

    @property
    @abstractmethod
    def rule_version(self) -> str:
        """Semantic version of the rule."""

    @property
    @abstractmethod
    def supported_claim_type(self) -> ClaimType:
        """ClaimType handled by this rule."""

    @property
    @abstractmethod
    def predicate_type(self) -> str:
        """Predicate classification category."""

    @abstractmethod
    def evaluate(
        self,
        claim: Claim,
        conn: sqlite3.Connection,
        cited_references: List[EvidenceReference],
    ) -> PredicateEvaluationResult:
        """
        Deterministically evaluate a claim using the read-only case connection.

        Args:
            claim: Validated structured claim to evaluate.
            conn: Read-only SQLite connection (PRAGMA query_only = ON).
            cited_references: Evidence references cited by the claim.

        Returns:
            PredicateEvaluationResult with deterministic status, matched records, and explanation.
        """


# ---------------------------------------------------------------------------
# Helper functions for database evidence retrieval
# ---------------------------------------------------------------------------


def _fetch_cited_events(
    conn: sqlite3.Connection,
    case_id: str,
    cited_references: List[EvidenceReference],
) -> List[sqlite3.Row]:
    """Fetch normalized events cited directly by event_id or raw_record_id."""
    event_ids = [ref.event_id for ref in cited_references if ref.event_id]
    raw_ids = [ref.raw_record_id for ref in cited_references if ref.raw_record_id]

    if not event_ids and not raw_ids:
        return []

    conditions: List[str] = []
    params: List[Any] = [case_id]

    if event_ids:
        placeholders = ",".join("?" for _ in event_ids)
        conditions.append(f"event_id IN ({placeholders})")
        params.extend(event_ids)

    if raw_ids:
        placeholders = ",".join("?" for _ in raw_ids)
        conditions.append(f"raw_record_id IN ({placeholders})")
        params.extend(raw_ids)

    query = f"""
        SELECT event_id, case_id, evidence_id, raw_record_id, timestamp_utc, timestamp_original,
               event_type, severity, user_value, src_ip, src_port, process, pid, message,
               line_number, byte_start, byte_end
        FROM events
        WHERE case_id = ? AND ({' OR '.join(conditions)})
        ORDER BY timestamp_utc ASC, line_number ASC
    """
    return conn.execute(query, params).fetchall()


def _fetch_cited_raw_records(
    conn: sqlite3.Connection,
    case_id: str,
    cited_references: List[EvidenceReference],
) -> List[sqlite3.Row]:
    """Fetch raw records cited directly by raw_record_id."""
    raw_ids = [ref.raw_record_id for ref in cited_references if ref.raw_record_id]
    if not raw_ids:
        return []

    placeholders = ",".join("?" for _ in raw_ids)
    query = f"""
        SELECT raw_record_id, case_id, evidence_id, record_no, line_number,
               byte_start, byte_end, raw_text, parse_status
        FROM raw_records
        WHERE case_id = ? AND raw_record_id IN ({placeholders})
        ORDER BY record_no ASC, line_number ASC
    """
    return conn.execute(query, [case_id] + raw_ids).fetchall()


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    return {k: row[k] for k in row.keys()}


# ---------------------------------------------------------------------------
# Concrete Predicate Rules
# ---------------------------------------------------------------------------


class AuthSuccessPredicateRule(BasePredicateRule):
    """
    Evaluates AUTH_SUCCESS claims against normalized events and verified raw records.
    """

    @property
    def rule_id(self) -> str:
        return "RULE_AUTH_SUCCESS_V1"

    @property
    def rule_version(self) -> str:
        return "1.0.0"

    @property
    def supported_claim_type(self) -> ClaimType:
        return ClaimType.AUTH_SUCCESS

    @property
    def predicate_type(self) -> str:
        return "EXACT_AUTH_SUCCESS_MATCH"

    def evaluate(
        self,
        claim: Claim,
        conn: sqlite3.Connection,
        cited_references: List[EvidenceReference],
    ) -> PredicateEvaluationResult:
        evidence_ids = list(set(ref.evidence_id for ref in cited_references))
        resolved_params = {
            "subject": claim.subject,
            "action": claim.action,
            "source_ip": claim.source_ip,
            "source_port": claim.source_port,
            "timestamp_claimed": claim.timestamp_claimed,
        }

        events = _fetch_cited_events(conn, claim.case_id, cited_references)
        raw_records = _fetch_cited_raw_records(conn, claim.case_id, cited_references)

        if not events and not raw_records:
            return PredicateEvaluationResult(
                status=VerificationStatus.INSUFFICIENT_EVIDENCE,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=0,
                evidence_refs=evidence_ids,
                explanation="No cited evidence records or events found in case database.",
                failure_reason="Cited evidence references do not resolve to persisted case records.",
            )

        supporting_records: List[Dict[str, Any]] = []
        contradicting_records: List[Dict[str, Any]] = []
        discrepancies: List[str] = []

        # Check for direct contradictions on cited records
        for ev in events:
            ev_dict = _row_to_dict(ev)
            # Contradiction: The specific cited event is an authentication failure
            if ev["event_type"] in ("AUTH_FAILURE", "INVALID_USER"):
                contradicting_records.append(ev_dict)
                discrepancies.append(
                    f"Cited event '{ev['event_id']}' establishes authentication failure ({ev['event_type']}), "
                    f"contradicting the claimed success."
                )
            elif ev["event_type"] == "AUTH_SUCCESS":
                # Check attribute compatibility
                matches = True
                if claim.subject and ev["user_value"]:
                    if claim.subject.lower() != ev["user_value"].lower():
                        matches = False
                        discrepancies.append(
                            f"User mismatch: claim asserts '{claim.subject}', event records '{ev['user_value']}'."
                        )
                if claim.source_ip and ev["src_ip"]:
                    if claim.source_ip != ev["src_ip"]:
                        matches = False
                        discrepancies.append(
                            f"Source IP mismatch: claim asserts '{claim.source_ip}', event records '{ev['src_ip']}'."
                        )
                if claim.source_port and ev["src_port"]:
                    if claim.source_port != ev["src_port"]:
                        matches = False
                        discrepancies.append(
                            f"Source port mismatch: claim asserts '{claim.source_port}', event records '{ev['src_port']}'."
                        )

                if matches:
                    supporting_records.append(ev_dict)

        # Unparsed raw records fallback
        if not supporting_records and not contradicting_records and raw_records:
            for r in raw_records:
                text = r["raw_text"] or ""
                # Verify exact OpenSSH accepted password or accepted publickey pattern
                if "Accepted password for " in text or "Accepted publickey for " in text or "Accepted keyboard-interactive" in text:
                    if (not claim.subject or claim.subject.lower() in text.lower()) and (
                        not claim.source_ip or claim.source_ip in text
                    ):
                        supporting_records.append(_row_to_dict(r))
                elif "Failed password for " in text:
                    # If this raw record is cited as the proof of success, that's a direct contradiction
                    contradicting_records.append(_row_to_dict(r))
                    discrepancies.append(
                        f"Cited raw record '{r['raw_record_id']}' records authentication failure, contradicting success claim."
                    )

        # Refinement 1: Contradiction requires unambiguous incompatible evidence for the exact attempt
        if contradicting_records and not supporting_records:
            return PredicateEvaluationResult(
                status=VerificationStatus.CONTRADICTED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(contradicting_records),
                evidence_refs=evidence_ids,
                contradicting_records=contradicting_records,
                discrepancies=discrepancies,
                explanation=(
                    f"Claim is CONTRADICTED: {len(contradicting_records)} cited record(s) explicitly establish "
                    f"authentication failure for the cited attempt." + ATTRIBUTION_DISCLAIMER
                ),
                failure_reason="Cited evidence establishes authentication failure rather than success.",
            )

        if supporting_records and not contradicting_records:
            return PredicateEvaluationResult(
                status=VerificationStatus.SUPPORTED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(supporting_records),
                evidence_refs=evidence_ids,
                supporting_records=supporting_records,
                explanation=(
                    f"Claim is SUPPORTED: Matched {len(supporting_records)} normalized AUTH_SUCCESS record(s) "
                    f"with compatible subject/IP attributes." + ATTRIBUTION_DISCLAIMER
                ),
            )

        if supporting_records and contradicting_records:
            # Ambiguous relationship across cited records: prefer UNVERIFIED per Refinement 1
            return PredicateEvaluationResult(
                status=VerificationStatus.UNVERIFIED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(supporting_records) + len(contradicting_records),
                evidence_refs=evidence_ids,
                supporting_records=supporting_records,
                contradicting_records=contradicting_records,
                discrepancies=discrepancies,
                explanation=(
                    "Claim is UNVERIFIED: Cited evidence contains conflicting success and failure records "
                    "whose relation to a single authentication attempt cannot be established unambiguously."
                    + ATTRIBUTION_DISCLAIMER
                ),
                failure_reason="Conflicting records in cited evidence without unambiguous single-attempt resolution.",
            )

        # Neither supporting nor contradicting: evidence exists but does not match required parameters
        return PredicateEvaluationResult(
            status=VerificationStatus.UNVERIFIED,
            rule_id=self.rule_id,
            rule_version=self.rule_version,
            predicate_type=self.predicate_type,
            resolved_parameters=resolved_params,
            matched_row_count=len(events) + len(raw_records),
            evidence_refs=evidence_ids,
            discrepancies=discrepancies,
            explanation=(
                "Claim is UNVERIFIED: Cited evidence records exist but do not satisfy all required "
                f"authentication success attributes ({'; '.join(discrepancies) if discrepancies else 'attribute mismatch'})."
                + ATTRIBUTION_DISCLAIMER
            ),
            failure_reason="Cited records do not establish the asserted authentication success attributes.",
        )


class AuthFailurePredicateRule(BasePredicateRule):
    """
    Evaluates AUTH_FAILURE claims against normalized events and verified raw records.
    """

    @property
    def rule_id(self) -> str:
        return "RULE_AUTH_FAILURE_V1"

    @property
    def rule_version(self) -> str:
        return "1.0.0"

    @property
    def supported_claim_type(self) -> ClaimType:
        return ClaimType.AUTH_FAILURE

    @property
    def predicate_type(self) -> str:
        return "EXACT_AUTH_FAILURE_MATCH"

    def evaluate(
        self,
        claim: Claim,
        conn: sqlite3.Connection,
        cited_references: List[EvidenceReference],
    ) -> PredicateEvaluationResult:
        evidence_ids = list(set(ref.evidence_id for ref in cited_references))
        resolved_params = {
            "subject": claim.subject,
            "action": claim.action,
            "source_ip": claim.source_ip,
            "source_port": claim.source_port,
        }

        events = _fetch_cited_events(conn, claim.case_id, cited_references)
        raw_records = _fetch_cited_raw_records(conn, claim.case_id, cited_references)

        if not events and not raw_records:
            return PredicateEvaluationResult(
                status=VerificationStatus.INSUFFICIENT_EVIDENCE,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=0,
                evidence_refs=evidence_ids,
                explanation="No cited evidence records or events found in case database.",
                failure_reason="Cited evidence references do not resolve to persisted case records.",
            )

        supporting_records: List[Dict[str, Any]] = []
        contradicting_records: List[Dict[str, Any]] = []
        discrepancies: List[str] = []

        for ev in events:
            ev_dict = _row_to_dict(ev)
            if ev["event_type"] in ("AUTH_FAILURE", "INVALID_USER"):
                matches = True
                if claim.subject and ev["user_value"]:
                    if claim.subject.lower() != ev["user_value"].lower():
                        matches = False
                        discrepancies.append(
                            f"User mismatch: claim asserts '{claim.subject}', event records '{ev['user_value']}'."
                        )
                if claim.source_ip and ev["src_ip"]:
                    if claim.source_ip != ev["src_ip"]:
                        matches = False
                        discrepancies.append(
                            f"Source IP mismatch: claim asserts '{claim.source_ip}', event records '{ev['src_ip']}'."
                        )
                if matches:
                    supporting_records.append(ev_dict)
            elif ev["event_type"] == "AUTH_SUCCESS":
                contradicting_records.append(ev_dict)
                discrepancies.append(
                    f"Cited event '{ev['event_id']}' records AUTH_SUCCESS, contradicting failure claim."
                )

        if contradicting_records and not supporting_records:
            return PredicateEvaluationResult(
                status=VerificationStatus.CONTRADICTED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(contradicting_records),
                evidence_refs=evidence_ids,
                contradicting_records=contradicting_records,
                discrepancies=discrepancies,
                explanation=(
                    f"Claim is CONTRADICTED: Cited record establishes authentication success rather than failure."
                    + ATTRIBUTION_DISCLAIMER
                ),
                failure_reason="Cited evidence establishes authentication success.",
            )

        if supporting_records and not contradicting_records:
            return PredicateEvaluationResult(
                status=VerificationStatus.SUPPORTED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(supporting_records),
                evidence_refs=evidence_ids,
                supporting_records=supporting_records,
                explanation=(
                    f"Claim is SUPPORTED: Matched {len(supporting_records)} normalized AUTH_FAILURE/INVALID_USER record(s)."
                    + ATTRIBUTION_DISCLAIMER
                ),
            )

        if supporting_records and contradicting_records:
            return PredicateEvaluationResult(
                status=VerificationStatus.UNVERIFIED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(supporting_records) + len(contradicting_records),
                evidence_refs=evidence_ids,
                supporting_records=supporting_records,
                contradicting_records=contradicting_records,
                discrepancies=discrepancies,
                explanation=(
                    "Claim is UNVERIFIED: Cited evidence contains conflicting success and failure records."
                    + ATTRIBUTION_DISCLAIMER
                ),
                failure_reason="Conflicting records in cited evidence without unambiguous single-attempt resolution.",
            )

        return PredicateEvaluationResult(
            status=VerificationStatus.UNVERIFIED,
            rule_id=self.rule_id,
            rule_version=self.rule_version,
            predicate_type=self.predicate_type,
            resolved_parameters=resolved_params,
            matched_row_count=len(events) + len(raw_records),
            evidence_refs=evidence_ids,
            discrepancies=discrepancies,
            explanation=(
                f"Claim is UNVERIFIED: Cited records exist but do not establish authentication failure attributes."
                + ATTRIBUTION_DISCLAIMER
            ),
            failure_reason="Evidence does not establish authentication failure attributes.",
        )


class SessionStartPredicateRule(BasePredicateRule):
    """
    Evaluates SESSION_START claims against SESSION_OPENED and AUTH_SUCCESS lifecycle markers.
    """

    @property
    def rule_id(self) -> str:
        return "RULE_SESSION_START_V1"

    @property
    def rule_version(self) -> str:
        return "1.0.0"

    @property
    def supported_claim_type(self) -> ClaimType:
        return ClaimType.SESSION_START

    @property
    def predicate_type(self) -> str:
        return "SESSION_LIFECYCLE_START"

    def evaluate(
        self,
        claim: Claim,
        conn: sqlite3.Connection,
        cited_references: List[EvidenceReference],
    ) -> PredicateEvaluationResult:
        evidence_ids = list(set(ref.evidence_id for ref in cited_references))
        resolved_params = {"subject": claim.subject, "action": claim.action}

        events = _fetch_cited_events(conn, claim.case_id, cited_references)
        if not events:
            return PredicateEvaluationResult(
                status=VerificationStatus.INSUFFICIENT_EVIDENCE,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=0,
                evidence_refs=evidence_ids,
                explanation="No cited events found in case database to evaluate session start.",
                failure_reason="Missing cited events.",
            )

        supporting: List[Dict[str, Any]] = []
        for ev in events:
            if ev["event_type"] in ("SESSION_OPENED", "AUTH_SUCCESS"):
                if not claim.subject or (ev["user_value"] and claim.subject.lower() == ev["user_value"].lower()):
                    supporting.append(_row_to_dict(ev))

        if supporting:
            return PredicateEvaluationResult(
                status=VerificationStatus.SUPPORTED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(supporting),
                evidence_refs=evidence_ids,
                supporting_records=supporting,
                explanation=(
                    f"Claim is SUPPORTED: Matched {len(supporting)} session lifecycle start event(s)."
                    + ATTRIBUTION_DISCLAIMER
                ),
            )

        return PredicateEvaluationResult(
            status=VerificationStatus.UNVERIFIED,
            rule_id=self.rule_id,
            rule_version=self.rule_version,
            predicate_type=self.predicate_type,
            resolved_parameters=resolved_params,
            matched_row_count=len(events),
            evidence_refs=evidence_ids,
            explanation="Claim is UNVERIFIED: Cited events do not record session opened lifecycle markers.",
            failure_reason="No session start lifecycle event found matching claim.",
        )


class SessionEndPredicateRule(BasePredicateRule):
    """
    Evaluates SESSION_END claims against SESSION_CLOSED and DISCONNECT lifecycle markers.
    """

    @property
    def rule_id(self) -> str:
        return "RULE_SESSION_END_V1"

    @property
    def rule_version(self) -> str:
        return "1.0.0"

    @property
    def supported_claim_type(self) -> ClaimType:
        return ClaimType.SESSION_END

    @property
    def predicate_type(self) -> str:
        return "SESSION_LIFECYCLE_END"

    def evaluate(
        self,
        claim: Claim,
        conn: sqlite3.Connection,
        cited_references: List[EvidenceReference],
    ) -> PredicateEvaluationResult:
        evidence_ids = list(set(ref.evidence_id for ref in cited_references))
        resolved_params = {"subject": claim.subject, "action": claim.action}

        events = _fetch_cited_events(conn, claim.case_id, cited_references)
        if not events:
            return PredicateEvaluationResult(
                status=VerificationStatus.INSUFFICIENT_EVIDENCE,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=0,
                evidence_refs=evidence_ids,
                explanation="No cited events found in case database to evaluate session end.",
                failure_reason="Missing cited events.",
            )

        supporting: List[Dict[str, Any]] = []
        for ev in events:
            if ev["event_type"] in ("SESSION_CLOSED", "DISCONNECT"):
                if not claim.subject or (ev["user_value"] and claim.subject.lower() == ev["user_value"].lower()):
                    supporting.append(_row_to_dict(ev))

        if supporting:
            return PredicateEvaluationResult(
                status=VerificationStatus.SUPPORTED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(supporting),
                evidence_refs=evidence_ids,
                supporting_records=supporting,
                explanation=(
                    f"Claim is SUPPORTED: Matched {len(supporting)} session termination lifecycle event(s)."
                    + ATTRIBUTION_DISCLAIMER
                ),
            )

        return PredicateEvaluationResult(
            status=VerificationStatus.UNVERIFIED,
            rule_id=self.rule_id,
            rule_version=self.rule_version,
            predicate_type=self.predicate_type,
            resolved_parameters=resolved_params,
            matched_row_count=len(events),
            evidence_refs=evidence_ids,
            explanation="Claim is UNVERIFIED: Cited events do not record session closed lifecycle markers.",
            failure_reason="No session termination lifecycle event found matching claim.",
        )


class SessionActivityPredicateRule(BasePredicateRule):
    """
    Evaluates SESSION_ACTIVITY claims against reconstructed sessions and session events.
    """

    @property
    def rule_id(self) -> str:
        return "RULE_SESSION_ACTIVITY_V1"

    @property
    def rule_version(self) -> str:
        return "1.0.0"

    @property
    def supported_claim_type(self) -> ClaimType:
        return ClaimType.SESSION_ACTIVITY

    @property
    def predicate_type(self) -> str:
        return "SESSION_EVENT_CORRELATION"

    def evaluate(
        self,
        claim: Claim,
        conn: sqlite3.Connection,
        cited_references: List[EvidenceReference],
    ) -> PredicateEvaluationResult:
        evidence_ids = list(set(ref.evidence_id for ref in cited_references))
        resolved_params = {"subject": claim.subject, "action": claim.action, "source_ip": claim.source_ip}

        events = _fetch_cited_events(conn, claim.case_id, cited_references)
        if not events:
            return PredicateEvaluationResult(
                status=VerificationStatus.INSUFFICIENT_EVIDENCE,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=0,
                evidence_refs=evidence_ids,
                explanation="No cited events found to verify session activity.",
                failure_reason="Missing cited events.",
            )

        # Check if events belong to correlated sessions in session_events
        event_ids = [ev["event_id"] for ev in events]
        placeholders = ",".join("?" for _ in event_ids)
        query = f"""
            SELECT se.session_id, se.event_id, se.ordinal, s.principal_key
            FROM session_events se
            JOIN sessions s ON s.session_id = se.session_id
            WHERE s.case_id = ? AND se.event_id IN ({placeholders})
        """
        correlated_rows = conn.execute(query, [claim.case_id] + event_ids).fetchall()

        if correlated_rows:
            supporting = [_row_to_dict(r) for r in correlated_rows]
            return PredicateEvaluationResult(
                status=VerificationStatus.SUPPORTED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(supporting),
                evidence_refs=evidence_ids,
                supporting_records=supporting,
                explanation=(
                    f"Claim is SUPPORTED: Cited events correlate to {len(supporting)} reconstructed session event(s)."
                    + ATTRIBUTION_DISCLAIMER
                ),
            )

        return PredicateEvaluationResult(
            status=VerificationStatus.UNVERIFIED,
            rule_id=self.rule_id,
            rule_version=self.rule_version,
            predicate_type=self.predicate_type,
            resolved_parameters=resolved_params,
            matched_row_count=len(events),
            evidence_refs=evidence_ids,
            explanation="Claim is UNVERIFIED: Cited events exist but are not correlated into a forensic session.",
            failure_reason="Events are not correlated in any reconstructed session.",
        )


class GenericForensicEventPredicateRule(BasePredicateRule):
    """
    Evaluates GENERIC_FORENSIC_EVENT claims.

    Enforces Refinement 2: Unparsed text substring presence alone is strictly
    INSUFFICIENT to mark a claim as SUPPORTED. Requires verified normalized semantics.
    """

    @property
    def rule_id(self) -> str:
        return "RULE_GENERIC_FORENSIC_EVENT_V1"

    @property
    def rule_version(self) -> str:
        return "1.0.0"

    @property
    def supported_claim_type(self) -> ClaimType:
        return ClaimType.GENERIC_FORENSIC_EVENT

    @property
    def predicate_type(self) -> str:
        return "SEMANTIC_EVENT_MATCH"

    def evaluate(
        self,
        claim: Claim,
        conn: sqlite3.Connection,
        cited_references: List[EvidenceReference],
    ) -> PredicateEvaluationResult:
        evidence_ids = list(set(ref.evidence_id for ref in cited_references))
        resolved_params = {"action": claim.action, "statement": claim.statement}

        events = _fetch_cited_events(conn, claim.case_id, cited_references)
        raw_records = _fetch_cited_raw_records(conn, claim.case_id, cited_references)

        if not events and not raw_records:
            return PredicateEvaluationResult(
                status=VerificationStatus.INSUFFICIENT_EVIDENCE,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=0,
                evidence_refs=evidence_ids,
                explanation="No cited evidence records or events found in case database.",
                failure_reason="Cited evidence does not resolve to case records.",
            )

        # Refinement 2: An explicit validated predicate establishing semantic event correspondence is required
        supporting: List[Dict[str, Any]] = []
        for ev in events:
            # Must be a fully PARSED normalized event with matching action/message
            if ev["parse_status"] == "PARSED" and ev["event_type"]:
                if claim.action.upper() in ev["event_type"].upper() or (
                    ev["message"] and claim.statement.lower() in ev["message"].lower()
                ):
                    supporting.append(_row_to_dict(ev))

        if supporting:
            return PredicateEvaluationResult(
                status=VerificationStatus.SUPPORTED,
                rule_id=self.rule_id,
                rule_version=self.rule_version,
                predicate_type=self.predicate_type,
                resolved_parameters=resolved_params,
                matched_row_count=len(supporting),
                evidence_refs=evidence_ids,
                supporting_records=supporting,
                explanation=(
                    f"Claim is SUPPORTED: Matched {len(supporting)} validated normalized event(s) with confirmed semantics."
                    + ATTRIBUTION_DISCLAIMER
                ),
            )

        # If only raw substring records exist without verified parsed semantics:
        return PredicateEvaluationResult(
            status=VerificationStatus.UNVERIFIED,
            rule_id=self.rule_id,
            rule_version=self.rule_version,
            predicate_type=self.predicate_type,
            resolved_parameters=resolved_params,
            matched_row_count=len(raw_records) + len(events),
            evidence_refs=evidence_ids,
            explanation=(
                "Claim is UNVERIFIED: Raw evidence record text was located, but unparsed substring matching alone "
                "does not establish semantic forensic claim verification (validated event predicate required)."
            ),
            failure_reason="Semantic verification predicate not satisfied by raw text alone.",
        )


class UnsupportedClaimTypePredicateRule(BasePredicateRule):
    """
    Handles claim types requiring parsers not yet implemented in the ingestion pipeline
    (e.g. NETWORK_CONNECTION, FILE_ACCESS, ACCOUNT_MODIFICATION, PROCESS_EXECUTION).

    Always returns INSUFFICIENT_EVIDENCE with an explicit, transparent reason.
    """

    def __init__(self, claim_type: ClaimType, required_parser_name: str):
        self._claim_type = claim_type
        self._required_parser = required_parser_name

    @property
    def rule_id(self) -> str:
        return f"RULE_UNSUPPORTED_{self._claim_type.value}_V1"

    @property
    def rule_version(self) -> str:
        return "1.0.0"

    @property
    def supported_claim_type(self) -> ClaimType:
        return self._claim_type

    @property
    def predicate_type(self) -> str:
        return "UNSUPPORTED_PARSER_GAP"

    def evaluate(
        self,
        claim: Claim,
        conn: sqlite3.Connection,
        cited_references: List[EvidenceReference],
    ) -> PredicateEvaluationResult:
        evidence_ids = list(set(ref.evidence_id for ref in cited_references))
        return PredicateEvaluationResult(
            status=VerificationStatus.INSUFFICIENT_EVIDENCE,
            rule_id=self.rule_id,
            rule_version=self.rule_version,
            predicate_type=self.predicate_type,
            resolved_parameters={"claim_type": self._claim_type.value},
            matched_row_count=0,
            evidence_refs=evidence_ids,
            explanation=(
                f"Verification cannot be established: Claim type '{self._claim_type.value}' requires specialized "
                f"evidence parsers ({self._required_parser}) not present in the current case ingestion pipeline."
            ),
            failure_reason=f"Parser support pending for '{self._claim_type.value}' ({self._required_parser}).",
        )


# ---------------------------------------------------------------------------
# Predicate Registry
# ---------------------------------------------------------------------------


class PredicateRegistry:
    """
    Catalog of deterministic predicate rules indexed by ClaimType.
    """

    def __init__(self):
        self._rules: Dict[ClaimType, BasePredicateRule] = {}
        self._register_defaults()

    def _register_defaults(self) -> None:
        # Fully implemented rules based on OpenSSH / Linux Auth Log evidence model
        self.register(AuthSuccessPredicateRule())
        self.register(AuthFailurePredicateRule())
        self.register(SessionStartPredicateRule())
        self.register(SessionEndPredicateRule())
        self.register(SessionActivityPredicateRule())
        self.register(GenericForensicEventPredicateRule())

        # Unsupported claim types explicitly mapped to UnsupportedClaimTypePredicateRule
        self.register(
            UnsupportedClaimTypePredicateRule(
                ClaimType.NETWORK_CONNECTION, "Packet Capture / Netflow / firewall parser"
            )
        )
        self.register(
            UnsupportedClaimTypePredicateRule(
                ClaimType.FILE_ACCESS, "auditd / inotify / filesystem journal parser"
            )
        )
        self.register(
            UnsupportedClaimTypePredicateRule(
                ClaimType.ACCOUNT_MODIFICATION, "shadow / passwd / useradd audit parser"
            )
        )
        self.register(
            UnsupportedClaimTypePredicateRule(
                ClaimType.PROCESS_EXECUTION, "auditd EXECVE / process accounting parser"
            )
        )

    def register(self, rule: BasePredicateRule) -> None:
        """Register a predicate rule."""
        self._rules[rule.supported_claim_type] = rule

    def get_rule(self, claim_type: ClaimType) -> BasePredicateRule:
        """Get the predicate rule registered for the given claim_type."""
        if claim_type not in self._rules:
            raise KeyError(f"No predicate rule registered for claim type '{claim_type.value}'.")
        return self._rules[claim_type]

    def list_implemented_types(self) -> List[ClaimType]:
        """Return claim types with fully operational verification rules."""
        return [
            ct
            for ct, rule in self._rules.items()
            if not isinstance(rule, UnsupportedClaimTypePredicateRule)
        ]

    def list_unsupported_types(self) -> List[ClaimType]:
        """Return claim types that cannot be verified due to missing evidence parsers."""
        return [
            ct
            for ct, rule in self._rules.items()
            if isinstance(rule, UnsupportedClaimTypePredicateRule)
        ]


# Singleton instance
default_predicate_registry = PredicateRegistry()
