-- ForensicLens Migration 003: claim_verification
-- Migration: 003_claim_verification.sql
-- Database target: SQLite 3.35+
-- Specification: Step 9 — Evidence-Grounded Claim Extraction & Deterministic Claim Verification
--
-- Safely rebuilds claims, claim_evidence, and claim_verifications to support:
-- 1. Rich typed claim attributes (statement, subject, action, object, source_ip, destination_ip, ports, timestamps)
-- 2. Optional investigation_id allowing both direct investigative claims and query-linked claims
-- 3. Exact provenance references in claim_evidence for both normalized events (event_id) AND unparsed raw records (raw_record_id, evidence_id)
-- 4. Four-state deterministic verification statuses (SUPPORTED, CONTRADICTED, UNVERIFIED, INSUFFICIENT_EVIDENCE)
-- 5. Complete immutable verification audit records (rule_id, rule_version, verifier_version, explanation, supporting_records_json, contradicting_records_json)

PRAGMA foreign_keys = OFF;

----------------------------------------------------------------------
-- 1. Rebuild claims table
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims_new (
    claim_id            TEXT    NOT NULL PRIMARY KEY,
    case_id             TEXT    NOT NULL REFERENCES cases (case_id),
    investigation_id    TEXT             REFERENCES investigations (investigation_id),
    claim_type          TEXT    NOT NULL,
    statement           TEXT    NOT NULL DEFAULT '',
    subject             TEXT,
    action              TEXT    NOT NULL DEFAULT '',
    object              TEXT,
    source_ip           TEXT,
    destination_ip      TEXT,
    source_port         INTEGER,
    timestamp_claimed   TEXT,
    time_range_start    TEXT,
    time_range_end      TEXT,
    attributes_json     TEXT    NOT NULL DEFAULT '{}',
    model_output_json   TEXT,
    status              TEXT    NOT NULL DEFAULT 'UNVERIFIED' CHECK (status IN (
                            'SUPPORTED', 'CONTRADICTED', 'UNVERIFIED', 'INSUFFICIENT_EVIDENCE',
                            'PROPOSED', 'VERIFIED', 'REJECTED')),
    extraction_method   TEXT    NOT NULL DEFAULT 'DETERMINISTIC_FAKE',
    compiler_version    TEXT,
    created_at          TEXT    NOT NULL
);

INSERT INTO claims_new (
    claim_id, case_id, investigation_id, claim_type, statement,
    action, model_output_json, status, extraction_method, compiler_version, created_at
)
SELECT
    claim_id, case_id, investigation_id, claim_type,
    COALESCE(model_output_json, claim_type),
    claim_type,
    model_output_json,
    CASE status
        WHEN 'VERIFIED' THEN 'SUPPORTED'
        ELSE COALESCE(status, 'UNVERIFIED')
    END,
    'LEGACY',
    compiler_version,
    created_at
FROM claims;

DROP TABLE claims;

ALTER TABLE claims_new RENAME TO claims;

CREATE INDEX IF NOT EXISTS idx_claims_case_audit
    ON claims (case_id, created_at);

CREATE INDEX IF NOT EXISTS idx_claims_investigation
    ON claims (investigation_id, status);

CREATE INDEX IF NOT EXISTS idx_claims_type
    ON claims (case_id, claim_type);

----------------------------------------------------------------------
-- 2. Validate legacy citations and rebuild claim_evidence table
--
-- Mandatory Pre-Rebuild Validations:
-- 1. Validate that every legacy citation references an existing event.
-- 2. Validate that every referenced event has a valid, non-null evidence ID.
-- 3. Validate that the referenced evidence file exists in evidence_files.
-- 4. Validate that the evidence file and event belong to the same case as the citation's claim.
-- 5. Collision-safe citation primary keys ('CE_' || hex(claim_id) || '_' || hex(event_id) || '_' || role).
-- If any validation fails, execution aborts immediately, rolling back the transaction.
----------------------------------------------------------------------

-- Validation 1: Every legacy citation must reference an existing event
CREATE TEMP TABLE _val_orphaned_events (id INTEGER PRIMARY KEY);
CREATE TEMP TRIGGER _trg_val_orphaned_events BEFORE INSERT ON _val_orphaned_events
BEGIN
    SELECT RAISE(FAIL, 'Migration 003 validation failed: legacy claim_evidence references non-existent event');
END;

INSERT INTO _val_orphaned_events (id)
SELECT 1
FROM claim_evidence ce
LEFT JOIN events e ON e.event_id = ce.event_id
WHERE e.event_id IS NULL
LIMIT 1;

DROP TRIGGER IF EXISTS _trg_val_orphaned_events;
DROP TABLE IF EXISTS _val_orphaned_events;

-- Validation 2: Every referenced event must have a valid non-null evidence_id
CREATE TEMP TABLE _val_null_evidence (id INTEGER PRIMARY KEY);
CREATE TEMP TRIGGER _trg_val_null_evidence BEFORE INSERT ON _val_null_evidence
BEGIN
    SELECT RAISE(FAIL, 'Migration 003 validation failed: referenced event has null or empty evidence_id');
END;

INSERT INTO _val_null_evidence (id)
SELECT 1
FROM claim_evidence ce
JOIN events e ON e.event_id = ce.event_id
WHERE e.evidence_id IS NULL OR TRIM(e.evidence_id) = ''
LIMIT 1;

DROP TRIGGER IF EXISTS _trg_val_null_evidence;
DROP TABLE IF EXISTS _val_null_evidence;

-- Validation 3: Every referenced evidence file must exist in evidence_files
CREATE TEMP TABLE _val_missing_evidence_files (id INTEGER PRIMARY KEY);
CREATE TEMP TRIGGER _trg_val_missing_evidence_files BEFORE INSERT ON _val_missing_evidence_files
BEGIN
    SELECT RAISE(FAIL, 'Migration 003 validation failed: referenced evidence file does not exist in evidence_files');
END;

INSERT INTO _val_missing_evidence_files (id)
SELECT 1
FROM claim_evidence ce
JOIN events e ON e.event_id = ce.event_id
LEFT JOIN evidence_files ef ON ef.evidence_id = e.evidence_id
WHERE ef.evidence_id IS NULL
LIMIT 1;

DROP TRIGGER IF EXISTS _trg_val_missing_evidence_files;
DROP TABLE IF EXISTS _val_missing_evidence_files;

-- Validation 4: Evidence file and event must belong to the same case as the citation's claim
CREATE TEMP TABLE _val_cross_case_evidence (id INTEGER PRIMARY KEY);
CREATE TEMP TRIGGER _trg_val_cross_case_evidence BEFORE INSERT ON _val_cross_case_evidence
BEGIN
    SELECT RAISE(FAIL, 'Migration 003 validation failed: evidence file or event does not belong to the same case as the claim');
END;

INSERT INTO _val_cross_case_evidence (id)
SELECT 1
FROM claim_evidence ce
JOIN claims c ON c.claim_id = ce.claim_id
JOIN events e ON e.event_id = ce.event_id
JOIN evidence_files ef ON ef.evidence_id = e.evidence_id
WHERE c.case_id != ef.case_id OR e.case_id != c.case_id
LIMIT 1;

DROP TRIGGER IF EXISTS _trg_val_cross_case_evidence;
DROP TABLE IF EXISTS _val_cross_case_evidence;

-- Validation 5: Verify collision safety of deterministic citation ID generator
CREATE TEMP TABLE _val_citation_collision (id INTEGER PRIMARY KEY);
CREATE TEMP TRIGGER _trg_val_citation_collision BEFORE INSERT ON _val_citation_collision
BEGIN
    SELECT RAISE(FAIL, 'Migration 003 validation failed: collision detected in generated claim_evidence_id');
END;

INSERT INTO _val_citation_collision (id)
SELECT 1
FROM (
    SELECT 'CE_' || hex(ce.claim_id) || '_' || hex(ce.event_id) || '_' || ce.role AS gen_id
    FROM claim_evidence ce
    GROUP BY gen_id
    HAVING COUNT(*) > 1
)
LIMIT 1;

DROP TRIGGER IF EXISTS _trg_val_citation_collision;
DROP TABLE IF EXISTS _val_citation_collision;

CREATE TABLE IF NOT EXISTS claim_evidence_new (
    claim_evidence_id   TEXT    NOT NULL PRIMARY KEY,
    claim_id            TEXT    NOT NULL REFERENCES claims (claim_id),
    evidence_id         TEXT    NOT NULL REFERENCES evidence_files (evidence_id),
    raw_record_id       TEXT             REFERENCES raw_records (raw_record_id),
    event_id            TEXT             REFERENCES events (event_id),
    role                TEXT    NOT NULL CHECK (role IN (
                            'PRIMARY_CITING', 'SUPPORTING', 'CONTRADICTING', 'CORRELATED', 'CONTEXT')),
    record_no           INTEGER,
    line_number         INTEGER,
    byte_start          INTEGER,
    byte_end            INTEGER,
    snippet             TEXT,
    created_at          TEXT    NOT NULL
);

INSERT INTO claim_evidence_new (
    claim_evidence_id, claim_id, evidence_id, event_id, role, created_at
)
SELECT
    'CE_' || hex(ce.claim_id) || '_' || hex(ce.event_id) || '_' || ce.role,
    ce.claim_id,
    e.evidence_id,
    ce.event_id,
    ce.role,
    ce.created_at
FROM claim_evidence ce
JOIN events e ON e.event_id = ce.event_id;

DROP TABLE claim_evidence;

ALTER TABLE claim_evidence_new RENAME TO claim_evidence;

CREATE INDEX IF NOT EXISTS idx_claim_evidence_claim
    ON claim_evidence (claim_id, role);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_reverse
    ON claim_evidence (event_id, claim_id);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_raw
    ON claim_evidence (raw_record_id, claim_id);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_file
    ON claim_evidence (evidence_id, claim_id);

----------------------------------------------------------------------
-- 3. Rebuild claim_verifications table
--
-- Compatibility Mapping Documentation:
-- - status: Legacy 'VERIFIED' is mapped to 'SUPPORTED' (per Step 9 four-state model); all other statuses retained.
-- - rule_id: Mapped from legacy 'predicate_type'.
-- - rule_version: Mapped from legacy 'predicate_version'.
-- - predicate_type: Retained from legacy 'predicate_type'.
-- - verifier_version: Initialized with default '1.0.0'.
-- - supporting_records_json: Initialized with default '[]'.
-- - contradicting_records_json: Initialized with default '[]'.
-- - explanation: NULL.
-- - Preserved unchanged: verification_id, claim_id, resolved_parameters_json,
--   matched_row_count, evidence_refs_json, failure_reason, verified_at.
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_verifications_new (
    verification_id             TEXT    NOT NULL PRIMARY KEY,
    claim_id                    TEXT    NOT NULL REFERENCES claims (claim_id),
    status                      TEXT    NOT NULL CHECK (status IN (
                                    'SUPPORTED', 'CONTRADICTED', 'UNVERIFIED', 'INSUFFICIENT_EVIDENCE', 'VERIFIED')),
    rule_id                     TEXT    NOT NULL,
    rule_version                TEXT    NOT NULL,
    predicate_type              TEXT    NOT NULL,
    resolved_parameters_json    TEXT    NOT NULL DEFAULT '{}',
    matched_row_count           INTEGER NOT NULL DEFAULT 0,
    evidence_refs_json          TEXT    NOT NULL DEFAULT '[]',
    supporting_records_json     TEXT    NOT NULL DEFAULT '[]',
    contradicting_records_json  TEXT    NOT NULL DEFAULT '[]',
    explanation                 TEXT,
    failure_reason              TEXT,
    verifier_version            TEXT    NOT NULL DEFAULT '1.0.0',
    verified_at                 TEXT    NOT NULL
);

INSERT INTO claim_verifications_new (
    verification_id, claim_id, status, rule_id, rule_version, predicate_type,
    resolved_parameters_json, matched_row_count, evidence_refs_json,
    failure_reason, verified_at
)
SELECT
    verification_id, claim_id,
    CASE status WHEN 'VERIFIED' THEN 'SUPPORTED' ELSE status END,
    predicate_type, predicate_version, predicate_type,
    resolved_parameters_json, matched_row_count, evidence_refs_json,
    failure_reason, verified_at
FROM claim_verifications;

DROP TABLE claim_verifications;

ALTER TABLE claim_verifications_new RENAME TO claim_verifications;

CREATE INDEX IF NOT EXISTS idx_verifications_claim
    ON claim_verifications (claim_id, verified_at DESC);

CREATE INDEX IF NOT EXISTS idx_verifications_status
    ON claim_verifications (status, verified_at);

----------------------------------------------------------------------
-- 4. Append-only immutability triggers on claim_verifications
----------------------------------------------------------------------
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

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
