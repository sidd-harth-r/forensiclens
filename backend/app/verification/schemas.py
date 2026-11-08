"""
Pydantic schemas for ForensicLens Claim Extraction and Deterministic Claim Verification.

Defines schemas for:
- Typed atomic claims extracted from natural-language queries & retrieved evidence
- Exact provenance citations for normalized events AND unparsed raw records
- Immutable verification results with deterministic justification and discrepancy tracking
- API request and response models
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator


class VerificationStatus(str, Enum):
    """
    Four-state verification status for digital forensic claims.
    """
    SUPPORTED = "SUPPORTED"
    CONTRADICTED = "CONTRADICTED"
    UNVERIFIED = "UNVERIFIED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"


class ClaimType(str, Enum):
    """
    Forensic semantic category for an extracted atomic claim.
    """
    AUTH_SUCCESS = "AUTH_SUCCESS"
    AUTH_FAILURE = "AUTH_FAILURE"
    SESSION_START = "SESSION_START"
    SESSION_END = "SESSION_END"
    SESSION_ACTIVITY = "SESSION_ACTIVITY"
    NETWORK_CONNECTION = "NETWORK_CONNECTION"
    FILE_ACCESS = "FILE_ACCESS"
    ACCOUNT_MODIFICATION = "ACCOUNT_MODIFICATION"
    PROCESS_EXECUTION = "PROCESS_EXECUTION"
    GENERIC_FORENSIC_EVENT = "GENERIC_FORENSIC_EVENT"


class EvidenceRole(str, Enum):
    """
    Role of an evidence reference relative to a claim.
    """
    PRIMARY_CITING = "PRIMARY_CITING"
    SUPPORTING = "SUPPORTING"
    CONTRADICTING = "CONTRADICTING"
    CORRELATED = "CORRELATED"
    CONTEXT = "CONTEXT"


class ExtractionMethod(str, Enum):
    """
    Provenance method used to extract the claim.
    """
    DETERMINISTIC_FAKE = "DETERMINISTIC_FAKE"
    RULE_BASED = "RULE_BASED"
    LLM_ASSISTED = "LLM_ASSISTED"
    SYNTHETIC_TEST = "SYNTHETIC_TEST"
    LEGACY = "LEGACY"


class EvidenceReference(BaseModel):
    """
    Exact evidence citation grounding a claim to original raw records or events.
    """
    model_config = ConfigDict(populate_by_name=True)

    claim_evidence_id: Optional[str] = Field(None, alias="claimEvidenceId", description="Unique citation identifier")
    claim_id: Optional[str] = Field(None, alias="claimId", description="Associated claim ID")
    evidence_id: str = Field(..., alias="evidenceId", min_length=1, description="Source evidence artifact identifier")
    raw_record_id: Optional[str] = Field(None, alias="rawRecordId", description="Cited raw record identifier")
    event_id: Optional[str] = Field(None, alias="eventId", description="Cited normalized event identifier if parsed")
    role: EvidenceRole = Field(EvidenceRole.PRIMARY_CITING, description="Evidence role relative to the claim")
    record_no: Optional[int] = Field(None, alias="recordNo", description="1-based record number in evidence file")
    line_number: Optional[int] = Field(None, alias="lineNumber", description="1-based source line number")
    byte_start: Optional[int] = Field(None, alias="byteStart", description="Starting byte offset in source evidence")
    byte_end: Optional[int] = Field(None, alias="byteEnd", description="Ending byte offset in source evidence")
    snippet: Optional[str] = Field(None, description="Exact verbatim text snippet cited from evidence")
    relevance_score: Optional[float] = Field(None, alias="relevanceScore", description="Hybrid retrieval relevance score")
    created_at: Optional[str] = Field(None, alias="createdAt", description="Timestamp of citation creation")

    @model_validator(mode="after")
    def validate_reference_target(self) -> EvidenceReference:
        if not self.raw_record_id and not self.event_id and not self.snippet:
            raise ValueError(
                "An EvidenceReference must specify at least one of 'raw_record_id', 'event_id', or 'snippet'."
            )
        return self


class Claim(BaseModel):
    """
    Structured atomic claim asserted in the course of an investigation.
    """
    model_config = ConfigDict(populate_by_name=True)

    claim_id: str = Field(..., alias="claimId", description="Unique claim identifier")
    case_id: str = Field(..., alias="caseId", description="Case identifier isolating this claim")
    investigation_id: Optional[str] = Field(None, alias="investigationId", description="Parent investigation identifier")
    claim_type: ClaimType = Field(..., alias="claimType", description="Categorical forensic claim type")
    statement: str = Field(..., min_length=1, description="Human-readable natural language assertion")
    subject: Optional[str] = Field(None, description="Actor or subject (e.g. username, service, account)")
    action: str = Field(..., description="Action asserted (e.g. LOGIN_SUCCESS, ACCEPTED_PASSWORD, DISCONNECT)")
    object: Optional[str] = Field(None, description="Target object (e.g. protocol, path, port, service)")
    source_ip: Optional[str] = Field(None, alias="sourceIp", description="Asserted source IP address")
    destination_ip: Optional[str] = Field(None, alias="destinationIp", description="Asserted destination IP address")
    source_port: Optional[int] = Field(None, alias="sourcePort", description="Asserted source port number")
    timestamp_claimed: Optional[str] = Field(None, alias="timestampClaimed", description="Exact claimed UTC timestamp")
    time_range_start: Optional[str] = Field(None, alias="timeRangeStart", description="Claimed time window start (UTC)")
    time_range_end: Optional[str] = Field(None, alias="timeRangeEnd", description="Claimed time window end (UTC)")
    attributes: Dict[str, Any] = Field(default_factory=dict, description="Arbitrary typed metadata attributes")
    model_output_json: Optional[str] = Field(None, alias="modelOutputJson", description="Raw compiler / model output JSON")
    extraction_method: ExtractionMethod = Field(
        ExtractionMethod.DETERMINISTIC_FAKE, alias="extractionMethod", description="Extraction mechanism used"
    )
    compiler_version: Optional[str] = Field("1.0.0", alias="compilerVersion", description="Extractor / compiler version")
    confidence: Optional[float] = Field(None, ge=0.0, le=1.0, description="Extractor extraction confidence score")
    evidence_references: List[EvidenceReference] = Field(
        default_factory=list, alias="evidenceReferences", description="Grounding evidence citations"
    )
    current_status: VerificationStatus = Field(
        VerificationStatus.UNVERIFIED, alias="currentStatus", description="Derived current verification status"
    )
    created_at: str = Field(..., alias="createdAt", description="UTC creation timestamp")


class ClaimVerificationResult(BaseModel):
    """
    Immutable audit record for a single deterministic verification execution.
    """
    model_config = ConfigDict(populate_by_name=True)

    verification_id: str = Field(..., alias="verificationId", description="Unique verification record identifier")
    claim_id: str = Field(..., alias="claimId", description="Verified claim identifier")
    status: VerificationStatus = Field(..., description="Deterministic verification outcome")
    rule_id: str = Field(..., alias="ruleId", description="Identifier of the deterministic verification rule executed")
    rule_version: str = Field("1.0.0", alias="ruleVersion", description="Version of the verification rule")
    predicate_type: str = Field(..., alias="predicateType", description="Deterministic predicate category applied")
    resolved_parameters: Dict[str, Any] = Field(
        default_factory=dict, alias="resolvedParameters", description="Concrete query parameters evaluated"
    )
    matched_row_count: int = Field(0, alias="matchedRowCount", description="Number of underlying evidence records matching")
    evidence_refs: List[str] = Field(
        default_factory=list, alias="evidenceRefs", description="Evidence file IDs referenced in verification"
    )
    supporting_records: List[Dict[str, Any]] = Field(
        default_factory=list, alias="supportingRecords", description="Records supporting the claim"
    )
    contradicting_records: List[Dict[str, Any]] = Field(
        default_factory=list, alias="contradictingRecords", description="Records contradicting the claim"
    )
    explanation: Optional[str] = Field(None, description="Deterministic forensic rationale for the outcome")
    failure_reason: Optional[str] = Field(None, alias="failureReason", description="Reason if status is not SUPPORTED")
    discrepancies: List[str] = Field(
        default_factory=list, description="Specific identified discrepancies (e.g. timestamp mismatch, IP discrepancy)"
    )
    verifier_version: str = Field("1.0.0", alias="verifierVersion", description="Deterministic verification engine version")
    verified_at: str = Field(..., alias="verifiedAt", description="UTC timestamp when verification occurred")


# ---------------------------------------------------------------------------
# API Request / Response Schemas
# ---------------------------------------------------------------------------


class ClaimExtractionRequest(BaseModel):
    """
    Request payload to extract claims from an investigative query and retrieved evidence.
    """
    model_config = ConfigDict(populate_by_name=True)

    query: str = Field(..., min_length=1, max_length=1000, description="Investigator query or question")
    retrieval_mode: Optional[str] = Field("HYBRID", alias="retrievalMode", description="Retrieval mode (HYBRID, KEYWORD_ONLY, etc.)")
    retrieval_limit: int = Field(20, alias="retrievalLimit", ge=1, le=100, description="Max evidence documents to retrieve")
    investigation_id: Optional[str] = Field(None, alias="investigationId", description="Optional parent investigation ID")


class ClaimExtractionResponse(BaseModel):
    """
    Response payload returning extracted structured atomic claims.
    """
    model_config = ConfigDict(populate_by_name=True)

    case_id: str = Field(..., alias="caseId")
    query: str
    extracted_claims: List[Claim] = Field(..., alias="extractedClaims")
    evidence_retrieved_count: int = Field(..., alias="evidenceRetrievedCount")
    extraction_method: ExtractionMethod = Field(..., alias="extractionMethod")
    model_identifier: Optional[str] = Field(None, alias="modelIdentifier")
    warnings: List[str] = Field(default_factory=list, description="Validation warnings or citation rejections")
    omitted_evidence_count: int = Field(0, alias="omittedEvidenceCount", description="Evidence records omitted due to limits")
    truncated_evidence_count: int = Field(0, alias="truncatedEvidenceCount", description="Evidence records truncated due to limits")


class ClaimVerificationRequest(BaseModel):
    """
    Request payload to verify claims deterministically against underlying case evidence.
    """
    model_config = ConfigDict(populate_by_name=True)

    claim_ids: Optional[List[str]] = Field(
        None, alias="claimIds", description="List of claim IDs to verify. If omitted, verifies all unverified claims."
    )
    force_reverify: bool = Field(
        False, alias="forceReverify", description="If True, re-verifies claims even if previously verified."
    )


class ClaimVerificationResponse(BaseModel):
    """
    Response payload detailing deterministic verification results.
    """
    model_config = ConfigDict(populate_by_name=True)

    case_id: str = Field(..., alias="caseId")
    verified_count: int = Field(..., alias="verifiedCount")
    summary: Dict[str, int] = Field(
        ..., description="Counts per verification status (e.g. {'SUPPORTED': 2, 'CONTRADICTED': 1})"
    )
    results: List[ClaimVerificationResult]


class ClaimListResponse(BaseModel):
    """
    Paginated/filtered list of claims for a case.
    """
    model_config = ConfigDict(populate_by_name=True)

    case_id: str = Field(..., alias="caseId")
    total: int
    claims: List[Claim]
    summary: Dict[str, int] = Field(
        default_factory=dict, description="Counts per status across all claims in case"
    )
    page: int = Field(1, description="1-based page number")
    page_size: int = Field(50, alias="pageSize", description="Page size limit")
    total_pages: int = Field(1, alias="totalPages", description="Total number of pages")
