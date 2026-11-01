-- ForensicLens P0 Initial Migration
-- Migration: 001_initial.sql
-- Database target: SQLite + FTS5 (SQLCipher for production)
-- Specification: docs/DATABASE.md
--
-- This migration creates all P0 case-scoped tables, indexes, constraints,
-- and FTS5 virtual tables as specified in the database design document.
--
-- The legal KB tables (legal_provisions, legal_elements) live in a separate
-- global read-only database and are NOT created by this case migration.
-- benchmark_runs is global metadata and is also NOT created here.

----------------------------------------------------------------------
-- 0. Migration tracking
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER NOT NULL PRIMARY KEY,
    checksum    TEXT    NOT NULL,
    applied_at  TEXT    NOT NULL
);

----------------------------------------------------------------------
-- 1. cases
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cases (
    case_id         TEXT    NOT NULL PRIMARY KEY,
    name            TEXT    NOT NULL,
    description     TEXT,
    status          TEXT    NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'DELETED_PENDING')),
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    created_by      TEXT,
    schema_version  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_status_updated
    ON cases (status, updated_at);

CREATE INDEX IF NOT EXISTS idx_cases_created_by_updated
    ON cases (created_by, updated_at);

----------------------------------------------------------------------
-- 2. evidence_files
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_files (
    evidence_id         TEXT    NOT NULL PRIMARY KEY,
    case_id             TEXT    NOT NULL REFERENCES cases (case_id),
    object_hash         TEXT    NOT NULL,
    object_size_bytes   INTEGER NOT NULL,
    original_name       TEXT    NOT NULL,
    media_type          TEXT,
    format              TEXT    NOT NULL,
    parser_version      TEXT,
    parser_status       TEXT    NOT NULL CHECK (parser_status IN (
                            'PENDING', 'PROCESSING', 'PARSED', 'PARTIAL',
                            'UNSUPPORTED', 'FAILED')),
    total_lines         INTEGER,
    parsed_lines        INTEGER,
    hash_verified_at    TEXT,
    created_at          TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_case_created
    ON evidence_files (case_id, created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_case_hash
    ON evidence_files (case_id, object_hash);

CREATE INDEX IF NOT EXISTS idx_evidence_case_parser_status
    ON evidence_files (case_id, parser_status);

----------------------------------------------------------------------
-- 3. raw_records
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_records (
    raw_record_id   TEXT    NOT NULL PRIMARY KEY,
    case_id         TEXT    NOT NULL REFERENCES cases (case_id),
    evidence_id     TEXT    NOT NULL REFERENCES evidence_files (evidence_id),
    record_no       INTEGER NOT NULL,
    line_number     INTEGER,
    byte_start      INTEGER,
    byte_end        INTEGER,
    raw_text        TEXT    NOT NULL,
    parse_status    TEXT    NOT NULL CHECK (parse_status IN ('PARSED', 'UNPARSED', 'PARTIAL')),
    parse_error     TEXT,
    created_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_records_provenance
    ON raw_records (case_id, evidence_id, record_no);

CREATE INDEX IF NOT EXISTS idx_raw_records_line
    ON raw_records (case_id, evidence_id, line_number);

CREATE INDEX IF NOT EXISTS idx_raw_records_byte
    ON raw_records (case_id, evidence_id, byte_start);

----------------------------------------------------------------------
-- 4. events
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    event_id                TEXT    NOT NULL PRIMARY KEY,
    case_id                 TEXT    NOT NULL REFERENCES cases (case_id),
    evidence_id             TEXT    NOT NULL REFERENCES evidence_files (evidence_id),
    raw_record_id           TEXT             REFERENCES raw_records (raw_record_id),
    timestamp_utc           TEXT,
    timestamp_original      TEXT,
    tz_assumed              TEXT,
    timestamp_confidence    TEXT,
    source                  TEXT,
    host                    TEXT,
    event_type              TEXT,
    severity                TEXT,
    user_value              TEXT,
    src_ip                  TEXT,
    src_ip_scope            TEXT    CHECK (src_ip_scope IS NULL OR src_ip_scope IN (
                                'PUBLIC', 'PRIVATE', 'LOOPBACK', 'LINK_LOCAL', 'UNKNOWN')),
    src_port                INTEGER,
    process                 TEXT,
    pid                     INTEGER,
    command_value           TEXT,
    resource                TEXT,
    message                 TEXT,
    parse_status            TEXT    NOT NULL CHECK (parse_status IN ('PARSED', 'PARTIAL', 'UNPARSED')),
    source_file_name        TEXT,
    line_number             INTEGER,
    byte_start              INTEGER,
    byte_end                INTEGER,
    event_hash              TEXT    NOT NULL,
    created_at              TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_timeline
    ON events (case_id, timestamp_utc, event_id);

CREATE INDEX IF NOT EXISTS idx_events_user_timeline
    ON events (case_id, user_value, timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_events_ip_timeline
    ON events (case_id, src_ip, timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_events_host_timeline
    ON events (case_id, host, timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_events_structured
    ON events (case_id, source, event_type, timestamp_utc);

CREATE INDEX IF NOT EXISTS idx_events_provenance
    ON events (case_id, evidence_id, line_number);

----------------------------------------------------------------------
-- 4a. events_fts (FTS5 virtual table)
----------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5 (
    message,
    command_value,
    resource,
    process,
    event_type,
    source,
    host,
    content = 'events',
    content_rowid = 'rowid'
);

----------------------------------------------------------------------
-- 5. sessions
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    session_id          TEXT    NOT NULL PRIMARY KEY,
    case_id             TEXT    NOT NULL REFERENCES cases (case_id),
    session_type        TEXT    NOT NULL,
    principal_key       TEXT,
    start_time_utc      TEXT,
    end_time_utc        TEXT,
    confidence          REAL,
    algorithm_version   TEXT    NOT NULL,
    created_at          TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_timeline
    ON sessions (case_id, start_time_utc, end_time_utc);

CREATE INDEX IF NOT EXISTS idx_sessions_principal
    ON sessions (case_id, principal_key, start_time_utc);

----------------------------------------------------------------------
-- 6. session_events
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_events (
    session_id      TEXT    NOT NULL REFERENCES sessions (session_id),
    event_id        TEXT    NOT NULL REFERENCES events (event_id),
    ordinal         INTEGER NOT NULL,
    relationship    TEXT,
    PRIMARY KEY (session_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_session_events_reverse
    ON session_events (event_id, session_id);

----------------------------------------------------------------------
-- 7. entities
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entities (
    entity_id       TEXT    NOT NULL PRIMARY KEY,
    case_id         TEXT    NOT NULL REFERENCES cases (case_id),
    entity_type     TEXT    NOT NULL CHECK (entity_type IN (
                        'USER', 'IP', 'HOST', 'PROCESS', 'FILE', 'COMMAND', 'RESOURCE')),
    canonical_value TEXT    NOT NULL,
    confidence      REAL,
    created_at      TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_entities_case_type_value
    ON entities (case_id, entity_type, canonical_value);

----------------------------------------------------------------------
-- 8. event_entities
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_entities (
    event_id    TEXT    NOT NULL REFERENCES events (event_id),
    entity_id   TEXT    NOT NULL REFERENCES entities (entity_id),
    field_name  TEXT    NOT NULL,
    confidence  REAL,
    PRIMARY KEY (event_id, entity_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_event_entities_reverse
    ON event_entities (entity_id, event_id);

----------------------------------------------------------------------
-- 9. investigations
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investigations (
    investigation_id    TEXT    NOT NULL PRIMARY KEY,
    case_id             TEXT    NOT NULL REFERENCES cases (case_id),
    query_text          TEXT    NOT NULL,
    query_ir_json       TEXT,
    intent              TEXT,
    privacy_level       TEXT    NOT NULL CHECK (privacy_level IN ('L0', 'L1', 'L2', 'L3')),
    status              TEXT    NOT NULL,
    created_at          TEXT    NOT NULL,
    completed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_investigations_history
    ON investigations (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_investigations_active
    ON investigations (case_id, status, created_at);

----------------------------------------------------------------------
-- 10. jobs
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    job_id              TEXT    NOT NULL PRIMARY KEY,
    case_id             TEXT    NOT NULL REFERENCES cases (case_id),
    investigation_id    TEXT             REFERENCES investigations (investigation_id),
    job_type            TEXT    NOT NULL CHECK (job_type IN (
                            'INVESTIGATION', 'INGESTION', 'INDEX_REBUILD', 'REPORT', 'BENCHMARK')),
    status              TEXT    NOT NULL CHECK (status IN (
                            'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'ORPHAN_RECOVERED')),
    progress_stage      TEXT,
    attempt             INTEGER NOT NULL,
    started_at          TEXT,
    heartbeat_at        TEXT,
    finished_at         TEXT,
    error_code          TEXT,
    created_at          TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_queue
    ON jobs (case_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_case_poll
    ON jobs (case_id, job_id);

----------------------------------------------------------------------
-- 11. claims
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claims (
    claim_id            TEXT    NOT NULL PRIMARY KEY,
    case_id             TEXT    NOT NULL REFERENCES cases (case_id),
    investigation_id    TEXT    NOT NULL REFERENCES investigations (investigation_id),
    claim_type          TEXT    NOT NULL,
    model_output_json   TEXT    NOT NULL,
    status              TEXT    NOT NULL CHECK (status IN (
                            'PROPOSED', 'VERIFIED', 'UNVERIFIED', 'CONTRADICTED', 'REJECTED')),
    compiler_version    TEXT,
    created_at          TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claims_investigation
    ON claims (investigation_id, status);

CREATE INDEX IF NOT EXISTS idx_claims_case_audit
    ON claims (case_id, created_at);

----------------------------------------------------------------------
-- 12. claim_slots
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_slots (
    claim_slot_id       TEXT    NOT NULL PRIMARY KEY,
    claim_id            TEXT    NOT NULL REFERENCES claims (claim_id),
    slot_name           TEXT    NOT NULL,
    entity_type         TEXT    NOT NULL,
    token               TEXT,
    event_id            TEXT             REFERENCES events (event_id),
    resolved_entity_id  TEXT             REFERENCES entities (entity_id),
    resolution_status   TEXT    NOT NULL CHECK (resolution_status IN (
                            'NOT_REQUIRED', 'RESOLVED', 'UNKNOWN_TOKEN',
                            'TYPE_MISMATCH', 'FAILED')),
    is_checked          INTEGER NOT NULL CHECK (is_checked IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_claim_slots_name
    ON claim_slots (claim_id, slot_name);

----------------------------------------------------------------------
-- 13. claim_evidence
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_evidence (
    claim_id    TEXT    NOT NULL REFERENCES claims (claim_id),
    event_id    TEXT    NOT NULL REFERENCES events (event_id),
    role        TEXT    NOT NULL CHECK (role IN ('SUPPORTING', 'CONTRADICTING', 'CONTEXT')),
    created_at  TEXT    NOT NULL,
    PRIMARY KEY (claim_id, event_id, role)
);

CREATE INDEX IF NOT EXISTS idx_claim_evidence_reverse
    ON claim_evidence (event_id, claim_id);

----------------------------------------------------------------------
-- 14. claim_verifications
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS claim_verifications (
    verification_id             TEXT    NOT NULL PRIMARY KEY,
    claim_id                    TEXT    NOT NULL REFERENCES claims (claim_id),
    status                      TEXT    NOT NULL CHECK (status IN (
                                    'VERIFIED', 'UNVERIFIED', 'CONTRADICTED')),
    predicate_type              TEXT    NOT NULL CHECK (predicate_type IN (
                                    'EXISTS', 'COUNT', 'ATTRIBUTE_EQ', 'TIME_ORDER', 'SEQUENCE')),
    predicate_version           TEXT    NOT NULL,
    resolved_parameters_json    TEXT    NOT NULL,
    matched_row_count           INTEGER NOT NULL,
    evidence_refs_json          TEXT    NOT NULL,
    failure_reason              TEXT,
    verified_at                 TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_verifications_claim
    ON claim_verifications (claim_id, verified_at DESC);

CREATE INDEX IF NOT EXISTS idx_verifications_status
    ON claim_verifications (status, verified_at);

----------------------------------------------------------------------
-- 15. behaviour_mappings
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS behaviour_mappings (
    behaviour_mapping_id    TEXT    NOT NULL PRIMARY KEY,
    case_id                 TEXT    NOT NULL REFERENCES cases (case_id),
    event_id                TEXT             REFERENCES events (event_id),
    session_id              TEXT             REFERENCES sessions (session_id),
    technique_id            TEXT    NOT NULL,
    confidence              REAL,
    reason_json             TEXT,
    created_at              TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_behaviour_case_technique
    ON behaviour_mappings (case_id, technique_id);

CREATE INDEX IF NOT EXISTS idx_behaviour_event_technique
    ON behaviour_mappings (event_id, technique_id);

----------------------------------------------------------------------
-- 16. integrity_findings
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrity_findings (
    integrity_finding_id    TEXT    NOT NULL PRIMARY KEY,
    case_id                 TEXT    NOT NULL REFERENCES cases (case_id),
    evidence_id             TEXT             REFERENCES evidence_files (evidence_id),
    finding_type            TEXT    NOT NULL,
    severity                TEXT    NOT NULL,
    start_event_id          TEXT             REFERENCES events (event_id),
    end_event_id            TEXT             REFERENCES events (event_id),
    details_json            TEXT    NOT NULL,
    detector_version        TEXT    NOT NULL,
    created_at              TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_integrity_case_severity
    ON integrity_findings (case_id, severity, created_at);

CREATE INDEX IF NOT EXISTS idx_integrity_evidence_type
    ON integrity_findings (evidence_id, finding_type);

----------------------------------------------------------------------
-- 17. privacy_configs
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS privacy_configs (
    case_id         TEXT    NOT NULL PRIMARY KEY REFERENCES cases (case_id),
    level           TEXT    NOT NULL CHECK (level IN ('L0', 'L1', 'L2', 'L3')),
    l0_confirmed_at TEXT,
    updated_at      TEXT    NOT NULL
);

----------------------------------------------------------------------
-- 18. audit_records
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_records (
    audit_id        TEXT    NOT NULL PRIMARY KEY,
    case_id         TEXT    NOT NULL REFERENCES cases (case_id),
    sequence_no     INTEGER NOT NULL,
    event_type      TEXT    NOT NULL,
    actor_id        TEXT,
    object_type     TEXT,
    object_id       TEXT,
    metadata_json   TEXT    NOT NULL,
    prev_hash       TEXT,
    record_hash     TEXT    NOT NULL,
    created_at      TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_case_seq
    ON audit_records (case_id, sequence_no);

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_case_hash
    ON audit_records (case_id, record_hash);

CREATE INDEX IF NOT EXISTS idx_audit_chain
    ON audit_records (case_id, sequence_no);

----------------------------------------------------------------------
-- 19. reports
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
    report_id               TEXT    NOT NULL PRIMARY KEY,
    case_id                 TEXT    NOT NULL REFERENCES cases (case_id),
    investigation_id        TEXT             REFERENCES investigations (investigation_id),
    report_path             TEXT    NOT NULL,
    content_hash            TEXT    NOT NULL,
    audit_head_hash         TEXT    NOT NULL,
    signature_key_id        TEXT,
    signed_hash             TEXT,
    reproducibility_json    TEXT    NOT NULL,
    created_at              TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_case_history
    ON reports (case_id, created_at DESC);

