# ForensicLens Parser Foundation

**Document:** Parser Subsystem Architecture and OpenSSH Parser Specification  
**Status:** Implemented (P0 Milestone)  
**Parent Architecture:** `docs/ARCHITECTURE.md`  
**Database Design:** `docs/DATABASE.md`  
**Implementation:** `backend/app/parsers/`  
**Test Suite:** `backend/tests/test_parsers.py`

---

## 1. Parser Architecture

### 1.1 Purpose of the Parser Subsystem

The ForensicLens parser subsystem transforms raw, semi-structured, or unstructured forensic evidence artifacts into structured, typed data while preserving immutable provenance back to the original source bytes.

In a digital forensic investigation, evidence ingestion occurs in strict stages:
1. **Acquisition & Storage**: The evidence file is verified with SHA-256 and stored as an immutable object in `data/cases/<case_id>/evidence/objects/<evidence_id>`.
2. **Parsing & Normalization**: The parser reads the immutable object, extracts line-by-line raw records with exact byte offsets, and maps recognized patterns to canonical forensic events.
3. **Correlation & Timeline**: Downstream correlation engines assemble events into sessions, detect temporal patterns, and identify behavioural MITRE ATT&CK techniques.
4. **Retrieval**: Lexical FTS5 and dense vector indexes query the structured events.

### 1.2 Why ForensicLens Uses a Pluggable Parser Architecture

Digital forensic investigations encounter diverse log formats:
- Linux OpenSSH authentication logs (`auth.log`, `secure`)
- Web server access and error logs (Apache, Nginx)
- Linux kernel and system logs (`syslog`, `dmesg`, `journald`)
- Windows Event Logs (`.evtx`)
- Android logs (`logcat`, dumpsys)
- Distributed application logs (Hadoop HDFS, Spark)

Each format has distinct syntax rules, timestamp encodings, header envelopes, and message bodies. ForensicLens addresses this through a **pluggable architecture**:
- **Decoupled Evolution**: New parsers can be developed and tested independently without modifying storage, database schema, or retrieval pipelines.
- **Contract Enforcement**: Every parser must implement a common interface (`BaseParser`) ensuring consistent provenance tracking and security constraints.
- **Fail-Safe Processing**: An unrecognized or malformed line in one format cannot crash the ingestion pipeline or compromise neighboring records.

```text
Evidence File (Immutable Artifact)
                │
                ▼
      ┌───────────────────┐
      │  ParserRegistry   │ ── Selects parser by format ('OPENSSH') or name
      └─────────┬─────────┘
                │
                ▼
      ┌───────────────────┐
      │   OpenSSHParser   │ ── Implements BaseParser interface
      └─────────┬─────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
┌──────────────┐ ┌──────────────┐
│  RawRecord   │ │ ParsedEvent  │
│ (Provenance) │ │ (Canonical)  │
└───────┬──────┘ └──────┬───────┘
        │               │
        ▼               ▼
  `raw_records`     `events`
   (Case DB)       (Case DB)
```

### 1.3 `BaseParser` Interface

All parsers inherit from `BaseParser` in [`backend/app/parsers/base.py`](file:///d:/5th%20sem/forensiclens/backend/app/parsers/base.py):

```python
class BaseParser(ABC):
    @property
    @abstractmethod
    def parser_name(self) -> str:
        """Unique identifier for this parser (e.g. 'openssh')."""
        ...

    @property
    @abstractmethod
    def parser_version(self) -> str:
        """SemVer version string for this parser implementation (e.g. '1.0.0')."""
        ...

    @property
    @abstractmethod
    def supported_format(self) -> str:
        """Canonical format family handled by this parser (e.g. 'OPENSSH')."""
        ...

    @abstractmethod
    def parse(
        self,
        source: str | bytes | Path | BinaryIO,
        evidence_id: str,
        *,
        encoding: str = "utf-8",
    ) -> ParseResult:
        """Parse raw evidence into structured RawRecords and ParsedEvents."""
        ...
```

#### Core Data Structures

- **`RawRecord`**: Stores the unnormalized line with forensic provenance:
  - `record_no` (int): 1-based sequential index within the artifact.
  - `line_number` (int): 1-based line number in the source file.
  - `byte_start` (int): 0-based byte offset where this line starts.
  - `byte_end` (int): 0-based exclusive byte offset where this line ends (including `\n` or `\r\n`).
  - `raw_text` (str): Exact raw line text without trailing line terminators.
  - `parse_status` (str): `'PARSED'`, `'PARTIAL'`, or `'UNPARSED'`.
  - `parse_error` (Optional[str]): Sanitized error description if unparsed or partial.
- **`ParsedEvent`**: Canonical normalized forensic event extracted from the line:
  - `timestamp_original`, `timestamp_utc`, `tz_assumed`, `timestamp_confidence`
  - `source`, `host`, `process`, `pid`
  - `event_type`, `severity`
  - `user_value`, `src_ip`, `src_ip_scope`, `src_port`
  - `command_value`, `resource`, `message`
  - `line_number`, `byte_start`, `byte_end`
- **`ParsedRecord`**: Combines a `RawRecord` with its optional `ParsedEvent`, parser metadata, and `evidence_id`.
- **`ParseResult`**: The aggregate output containing all records, `total_lines`, `parsed_lines`, `partial_lines`, and `unparsed_lines`.

### 1.4 Parser Lifecycle

1. **Stream Ingestion**: The parser accepts a file path, raw bytes, string, or open `BinaryIO` stream.
2. **Chunked Line Reading**: `iter_lines_with_offsets()` streams line-by-line using binary reads (`.readline()`), computing exact byte offsets (`byte_start` and `byte_end`). Lines are decoded safely with `errors='replace'` so encoding corruptions never abort execution.
3. **Header Parsing**: The line is matched against syslog prefix patterns (BSD syslog or ISO-8601).
4. **Message Pattern Matching**: The message body is matched against specific event patterns.
5. **Event Construction**: If matched, a canonical `ParsedEvent` is created and paired with a `RawRecord`.
6. **Summary Statistics**: Line counts (`total`, `parsed`, `partial`, `unparsed`) are compiled and returned in a `ParseResult`.

### 1.5 Parser Registry

The `ParserRegistry` in [`backend/app/parsers/registry.py`](file:///d:/5th%20sem/forensiclens/backend/app/parsers/registry.py) maintains a centralized, static mapping:

- **Case-Insensitive Resolution**: Resolves by parser name (e.g., `'openssh'`, `'OpenSSH'`) or format name (e.g., `'OPENSSH'`).
- **Fail-Fast Error Handling**: Requesting an unregistered parser raises `UnknownParserError` detailing the requested name and all currently available parsers.
- **Security Boundary**: The registry uses explicit in-memory registration. Dynamic module loading (`importlib.import_module` on user-supplied strings) is prohibited to prevent remote code execution.

### 1.6 Adding Future Parsers Safely

To add a new parser (e.g. Apache access log):
1. Create `backend/app/parsers/apache.py` inheriting from `BaseParser`.
2. Define static linear regular expressions (avoiding nested quantifiers).
3. Use `iter_lines_with_offsets()` to guarantee byte offset and line number preservation.
4. Normalize timestamps according to the timestamp policy (never invent year or timezone).
5. Register the parser instance in `backend/app/parsers/registry.py` via `default_registry.register(ApacheParser())`.
6. Add comprehensive unit tests in `backend/tests/test_parsers.py`.

---

## 2. OpenSSH Parser (`OpenSSHParser`)

### 2.1 Supported Log Formats

The `OpenSSHParser` parses authentication logs generated by the OpenSSH daemon (`sshd`) and PAM subsystems, typically found in:
- Debian/Ubuntu: `/var/log/auth.log`
- RHEL/CentOS/Rocky: `/var/log/secure`
- Systemd Journal: Syslog-forwarded units

It supports both traditional BSD syslog headers and modern ISO-8601 syslog headers:
```text
# BSD syslog style
Jan 15 10:20:30 server sshd[1234]: Failed password for root from 192.168.1.100 port 22 ssh2

# ISO-8601 syslog style
2026-01-15T10:20:30.123456+00:00 server sshd[1234]: Accepted password for analyst from 10.0.0.5 port 54321 ssh2
```

### 2.2 Recognized Authentication Patterns and Event Types

| Pattern Name | Canonical Event Type | Severity | Example Log Message |
|---|---|---|---|
| `FAILED_INVALID_USER` | `AUTH_FAILURE` | `WARNING` | `Failed password for invalid user admin from 10.0.0.1 port 43210 ssh2` |
| `FAILED_PASSWORD` | `AUTH_FAILURE` | `WARNING` | `Failed password for root from 192.168.1.100 port 22 ssh2` |
| `FAILED_PUBLICKEY` | `AUTH_FAILURE` | `WARNING` | `Failed publickey for user1 from 10.0.0.2 port 22 ssh2` |
| `ACCEPTED_PASSWORD` | `AUTH_SUCCESS` | `INFO` | `Accepted password for analyst from 192.168.1.50 port 45678 ssh2` |
| `ACCEPTED_PUBLICKEY` | `AUTH_SUCCESS` | `INFO` | `Accepted publickey for deployer from 10.1.1.1 port 55555 ssh2: RSA SHA256:abcd...` |
| `ACCEPTED_KBD` | `AUTH_SUCCESS` | `INFO` | `Accepted keyboard-interactive/pam for user1 from 10.0.0.3 port 22 ssh2` |
| `INVALID_USER` | `INVALID_USER` | `WARNING` | `Invalid user guest from 192.168.1.200 port 51234` |
| `DISCONNECT_RECEIVED` | `DISCONNECT` | `INFO` | `Received disconnect from 192.168.1.100 port 50000:11: disconnected by user` |
| `DISCONNECTED_FROM` | `DISCONNECT` | `INFO` | `Disconnected from user analyst 10.0.0.5 port 50001` |
| `CONNECTION_CLOSED` | `DISCONNECT` | `INFO` | `Connection closed by authenticating user root 10.0.0.2 port 50002` |
| `PAM_SESSION_OPENED` | `SESSION_OPENED` | `INFO` | `pam_unix(sshd:session): session opened for user alice by (uid=0)` |
| `PAM_SESSION_CLOSED` | `SESSION_CLOSED` | `INFO` | `pam_unix(sshd:session): session closed for user alice` |
| `PAM_AUTH_FAILURE` | `AUTH_FAILURE` | `WARNING` | `pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost=192.168.1.100` |

> [!NOTE]
> Pattern evaluation order is strictly enforced: `FAILED_INVALID_USER` is evaluated before `FAILED_PASSWORD` so that the literal token `"invalid"` is not erroneously captured as the username.

### 2.3 Fields Extracted

- `timestamp_original`: Raw timestamp substring.
- `timestamp_utc`: Normalized UTC ISO string (or `None`).
- `host`: Hostname reporting the event (e.g. `"webserver"`).
- `process`: Process name (`"sshd"`).
- `pid`: Process identifier integer (`1234`).
- `user_value`: Targeted username (`"root"`, `"analyst"`).
- `src_ip`: Remote IPv4 or IPv6 address.
- `src_ip_scope`: Automatic classification via `ipaddress`:
  - `PUBLIC`: Globally routable addresses.
  - `PRIVATE`: RFC 1918 addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
  - `LOOPBACK`: `127.0.0.1`, `::1`.
  - `LINK_LOCAL`: `169.254.0.0/16`, `fe80::/10`.
  - `UNKNOWN`: Unparseable or unresolvable address strings.
- `src_port`: Remote client port integer (`45678`).
- `message`: Full message body.

### 2.4 Handling Missing and Optional Fields

- **Missing PID**: OpenSSH lines like `Jan 15 10:20:30 server sshd: ...` parse correctly with `pid = None`.
- **Missing Host**: Log lines omitting the hostname (e.g. container logs `Jan 15 10:20:30 sshd[123]: ...`) parse correctly with `host = None`.
- **Missing Port**: Connections omitting port information parse with `src_port = None`.
- **Missing Key Metadata**: Public key lines omitting fingerprint or key type parse cleanly with `key_info = None`.

### 2.5 Parse Status Semantics

- **`PARSED`**: The line matched the syslog envelope and an explicit OpenSSH authentication or session pattern. A full `ParsedEvent` is produced.
- **`PARTIAL`**: The line matched the syslog envelope, but the message body is an unmodeled daemon message (e.g., debug output, configuration warnings). A `ParsedEvent` with `event_type='UNKNOWN'` is generated to preserve timeline continuity.
- **`UNPARSED`**: The line could not be parsed as syslog (corrupted line, binary data, empty line). `event = None` is set, and `parse_error` records the diagnostic cause.

---

## 3. Provenance Model

ForensicLens requires exact provenance from every extracted claim back to the physical evidence bytes.

### 3.1 Provenance Fields

Every parsed record maintains:
- `evidence_id`: Primary key of the source evidence artifact in `evidence_files`.
- `record_no`: 1-based sequential record counter within the file.
- `line_number`: 1-based line index in the source file.
- `byte_start`: Exact 0-based byte offset where the line begins in the immutable original object.
- `byte_end`: Exact 0-based exclusive byte offset where the line ends (including line terminators).
- `raw_text`: The exact, unnormalized display line.
- `parser_name` & `parser_version`: Specific parser attribution (`"openssh"`, `"1.0.0"`).
- `parse_status`: Parse outcome (`PARSED`, `PARTIAL`, `UNPARSED`).
- `parse_error`: Specific reason if the line could not be fully parsed.

### 3.2 Forensic Traceability Rationale

- **Court Admissibility**: Under statutory evidence rules (e.g. Section 63 of Bharatiya Sakshya Adhiniyam, 2023), electronic evidence must demonstrate unbroken chain of custody. Proving that an event record corresponds to exact byte offsets in an immutable SHA-256 hashed file provides mathematically verifiable provenance.
- **Immunity to Platform Quirks**: Different operating systems and text editors handle line endings differently (`\r\n` vs. `\n`) or alter character encodings. Slicing the file by exact byte offsets (`raw_bytes[byte_start:byte_end]`) guarantees retrieval of the exact original bytes regardless of environment.
- **Auditable Claim Verification**: When the LLM generates an analytical claim, the claim verification engine traces the assertion directly to `byte_start` and `byte_end` in the evidence file, enabling deterministic verification.

---

## 4. Timestamp Policy

### 4.1 Timestamp Fields

- `timestamp_original`: Preserves the exact character sequence from the log line (e.g. `"Jan 15 10:20:30"` or `"2026-01-15T10:20:30+05:30"`).
- `timestamp_utc`: Normalized UTC RFC3339 string (`YYYY-MM-DDTHH:MM:SSZ`), or `None`.
- `timestamp_confidence`: `'EXACT'`, or `None`.

### 4.2 Why the Parser Never Invents Year or Timezone

Traditional BSD syslog lines (RFC 3164) omit the year and timezone:
```text
Jan 15 10:20:30 server sshd[1234]: ...
```

A common anti-pattern in naive parsers is to assume the current calendar year or local server timezone. In digital forensics, this is **strictly forbidden**:
- **Cross-Year Incidents**: An incident occurring on December 30 analyzed on January 2 would have its events pushed an entire year into the future.
- **Timezone Skew**: Assuming UTC for a host operating in Indian Standard Time (`UTC+05:30`) introduces a 5.5-hour temporal error, misaligning authentication logs with network packet captures.

Therefore:
- When a log format provides explicit year and timezone (ISO-8601), `timestamp_utc` is computed with `confidence='EXACT'`.
- When a log format lacks year or timezone (BSD syslog), `timestamp_utc` is set to `None`.
- **Resolution Strategy**: Resolving the anchor year and timezone is deferred to the **correlation engine**, where file modification timestamps (`mtime`), rotated log directory conventions (`auth.log.1`), and acquisition manifests provide authoritative context.

---

## 5. Security Model

Forensic log parsers operate on **untrusted input**. Attackers frequently inject malicious payloads into SSH usernames or client banners to exploit log parsers or log viewers.

### 5.1 Security Safeguards

1. **Zero Code Execution**: Log content is parsed strictly as passive textual data. No component of a log line is ever passed to `eval()`, shell processes, or dynamic template evaluators.
2. **Path Traversal Isolation**: Usernames, hosts, and file paths extracted from logs are never used to construct filesystem paths. File storage paths are derived exclusively from system-generated UUIDs.
3. **ReDoS Defense**: All regular expressions are linear and bounded:
   - Quantifiers use non-overlapping character classes (`\S+`, `\d+`).
   - Nested repetition (e.g., `(a+)+`) is strictly prohibited.
   - Header tokens have length limits (`\d{1,10}`).
4. **Encoding Defense**: Stream iteration decodes with `errors='replace'` (`\ufffd`), preventing unhandled `UnicodeDecodeError` crashes on binary-corrupted log inputs.
5. **Static Registry Security**: Parser registration is explicit and compile-time bound. Dynamic module loading based on user input strings is disallowed.

---

## 6. Database Compatibility

The parser subsystem output maps directly to the existing database schema defined in `backend/migrations/001_initial.sql`:

```text
ParseResult
  │
  ├──> evidence_files (Table)
  │     ├── format = supported_format ("OPENSSH")
  │     ├── parser_version = parser_version ("1.0.0")
  │     ├── total_lines = total_lines
  │     └── parsed_lines = parsed_lines
  │
  ├──> raw_records (Table)
  │     ├── record_no, line_number, byte_start, byte_end
  │     ├── raw_text
  │     ├── parse_status ('PARSED', 'PARTIAL', 'UNPARSED')
  │     └── parse_error
  │
  └──> events (Table)
        ├── event_type, severity, source ("OpenSSH")
        ├── host, process, pid
        ├── user_value, src_ip, src_ip_scope, src_port
        ├── message, line_number, byte_start, byte_end
        ├── timestamp_original, timestamp_utc
        └── event_hash
```

> [!IMPORTANT]
> **Zero Schema Changes Required**: Step 8 required **no database schema migration**. The existing P0 database foundation created in Step 4 anticipated all required raw-record provenance fields, status check constraints, and event attributes.

---

## 8. Parser Persistence Subsystem (Step 9)

### 8.1 Architecture and Responsibility

The parser persistence subsystem ([`backend/app/parsers/persistence.py`](file:///d:/5th%20sem/forensiclens/backend/app/parsers/persistence.py)) bridges the gap between memory-resident parser output (`ParseResult`) and the case database (`raw_records`, `events`, `events_fts`, and `evidence_files`).

```text
Immutable Evidence (objects/<evidence_id>)
        ↓
   BaseParser (OpenSSHParser)
        ↓
    ParseResult
       /          /      RawRecord   ParsedEvent
   ↓             ↓
raw_records    events
                 ↓
             events_fts (FTS5 lexical index)
```

Core responsibilities:
1. **Case-Scoped Operation**: Operates strictly within the boundary of the requested `case_id`. All foreign keys, indexes, and tables are case-isolated in `data/cases/<case_id>/case.db`.
2. **Provenance & Unmodified Raw Text**: Persists exact source lines into `raw_records` with 1-based `line_number`, 0-based `byte_start`, and exclusive `byte_end`. Never trims, normalizes, or re-encodes `raw_text`.
3. **Structured Event Mapping**: Maps `ParsedEvent` fields into `events` columns, computing a deterministic SHA-256 `event_hash` over the canonical JSON serialization of event attributes.
4. **FTS5 Synchronization**: Synchronizes searchable text (`message`, `command_value`, `resource`, `process`, `event_type`, `source`, `host`) to the `events_fts` FTS5 virtual table.
5. **Evidence Lifecycle Tracking**: Updates `evidence_files` metadata (`parser_version`, `parser_status`, `total_lines`, `parsed_lines`).
6. **Transactionality & Rollback**: Uses transactional savepoints (`SAVEPOINT sp_persist_<uuid>`) to guarantee all-or-nothing atomicity. If any record fails (e.g. check constraint, disk error, foreign key violation), complete rollback to the savepoint occurs.
7. **Idempotency & Duplicate Defensibility**: By default (`if_exists='reject'`), prevents duplicate persistence runs for the same evidence file by raising `AlreadyPersistedError`. Optionally supports `if_exists='ignore'` to safely return original counts without mutating records.

### 8.2 Database Schema Mapping

#### Raw Records (`raw_records`)
| Parser Field (`RawRecord`) | Database Column (`raw_records`) | Description |
|---|---|---|
| `f"RAW_{evidence_id}_{record_no}"` | `raw_record_id` | Deterministic primary key |
| `case_id` | `case_id` | Foreign key referencing `cases` |
| `evidence_id` | `evidence_id` | Foreign key referencing `evidence_files` |
| `record.record_no` | `record_no` | Stable 1-based record ordinal |
| `record.line_number` | `line_number` | 1-based source line number |
| `record.byte_start` | `byte_start` | 0-based byte start offset |
| `record.byte_end` | `byte_end` | Exclusive byte end offset |
| `record.raw_text` | `raw_text` | Untrusted, unmodified raw text |
| `record.parse_status` | `parse_status` | Status CHECK (`PARSED`, `PARTIAL`, `UNPARSED`) |
| `record.parse_error` | `parse_error` | Parser diagnostic message or None |
| `now_utc` | `created_at` | ISO-8601 UTC insert timestamp |

#### Normalized Events (`events`)
| Parser Field (`ParsedEvent`) | Database Column (`events`) | Description |
|---|---|---|
| `f"EVT_{evidence_id}_{record_no}"` | `event_id` | Deterministic primary key |
| `case_id` | `case_id` | Foreign key referencing `cases` |
| `evidence_id` | `evidence_id` | Foreign key referencing `evidence_files` |
| `raw_record_id` | `raw_record_id` | Foreign key referencing `raw_records` |
| `event.timestamp_utc` | `timestamp_utc` | RFC3339 UTC timestamp or NULL |
| `event.timestamp_original`| `timestamp_original` | Original raw timestamp string |
| `event.tz_assumed` | `tz_assumed` | Timezone assumed or NULL |
| `event.timestamp_confidence` | `timestamp_confidence` | `EXACT` or NULL |
| `event.source` / parser_name | `source` | "OpenSSH" |
| `event.host` | `host` | Hostname from syslog header or NULL |
| `event.event_type` | `event_type` | Canonical event type (e.g. `AUTH_FAILURE`) |
| `event.severity` | `severity` | Normalized severity (`INFO`, `WARNING`, etc.) |
| `event.user_value` | `user_value` | Extracted username |
| `event.src_ip` | `src_ip` | Extracted source IP |
| `event.src_ip_scope` | `src_ip_scope` | Scope CHECK (`PUBLIC`, `PRIVATE`, etc.) |
| `event.src_port` | `src_port` | Source port integer |
| `event.process` | `process` | Process name (e.g. `sshd`) |
| `event.pid` | `pid` | Process PID integer |
| `event.command_value` | `command_value` | Command or NULL |
| `event.resource` | `resource` | Target resource or NULL |
| `event.message` | `message` | Normalized message text |
| `event.parse_status` | `parse_status` | Status CHECK (`PARSED`, `PARTIAL`, `UNPARSED`) |
| `evidence.original_name` | `source_file_name` | Original filename for display |
| `event.line_number` | `line_number` | 1-based source line number |
| `event.byte_start` | `byte_start` | Exact byte start offset |
| `event.byte_end` | `byte_end` | Exclusive byte end offset |
| `compute_event_hash(...)` | `event_hash` | SHA-256 over canonical JSON event dictionary |
| `now_utc` | `created_at` | ISO-8601 UTC insert timestamp |

### 8.3 FTS5 Lexical Search Integration

The SQLite FTS5 virtual table `events_fts` uses external content referencing the `events` table:
```sql
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
```

During persistence, for every inserted event, its SQLite `rowid` is retrieved and synchronized to `events_fts`:
```sql
INSERT INTO events_fts (rowid, message, command_value, resource, process, event_type, source, host)
VALUES (?, ?, ?, ?, ?, ?, ?, ?);
```
This enables sub-millisecond lexical queries across all parsed forensic events using `MATCH 'term'` or field-scoped syntax like `MATCH 'process:sshd'`.

### 8.4 Transaction Boundary and Rollback Behavior

Persistence operations are atomic. A dedicated savepoint is established:
```sql
SAVEPOINT sp_persist_<uuid>;
```
If an integrity failure, malformed record, or connection error occurs mid-stream:
1. `ROLLBACK TO SAVEPOINT sp_persist_<uuid>` is executed.
2. `RELEASE SAVEPOINT sp_persist_<uuid>` clears the savepoint.
3. The database state reverts to exactly where it was prior to the call: zero partial `raw_records`, zero partial `events`, and zero partial `events_fts` entries.
4. `evidence_files.parser_status` remains `PENDING`.

### 8.5 Duplicate and Idempotency Policy

In forensic environments, re-running evidence processing must not silently mutate or duplicate official case records:
- **`if_exists='reject'` (Default)**: Checks if `raw_records` already exist for the `(case_id, evidence_id)` tuple. If present, raises `AlreadyPersistedError`.
- **`if_exists='ignore'`**: If records already exist, returns a `PersistenceResult` with `persisted=False` and existing record counts without mutating the database.
- Primary key constraints (`raw_record_id` = `RAW_<evidence_id>_<record_no>`, `event_id` = `EVT_<evidence_id>_<record_no>`) provide a secondary hard constraint preventing duplicate record injection.

### 8.6 Security Controls

1. **Strict SQL Parameterization**: All values (including untrusted raw log strings and error details) are passed via parameterized `?` placeholders. No string formatting or concatenation into SQL is permitted.
2. **Untrusted Content Sanitization**: Raw log text is treated as passive evidentiary byte sequences. It is never executed, evaluated as shell commands, or used in filesystem path construction.
3. **Audit and Redaction**: Log text is never logged to application logs or console streams; only metadata (counts, IDs, status) is exposed.

---

## 9. Testing and Verification

### 9.1 Test Suite Structure

Tests are implemented across two suites:
- [`backend/tests/test_parsers.py`](file:///d:/5th%20sem/forensiclens/backend/tests/test_parsers.py) (29 tests):
  - **`TestOpenSSHParserAuth`** (7 tests): Validates authentication success, failure, invalid user, publickey with key info, PAM session opened/closed, and disconnects.
  - **`TestOpenSSHTimestampHandling`** (4 tests): Validates BSD timestamp preservation (null UTC), ISO-8601 UTC normalization, timezone offset conversion, and timezone-less handling.
  - **`TestOpenSSHProvenance`** (4 tests): Validates exact raw line preservation, 1-based line numbering, contiguous byte-offset slicing, and metadata attachment.
  - **`TestOpenSSHResilience`** (6 tests): Validates malformed line recovery, partial syslog parsing, missing optional fields (PID, host, port), and empty line handling.
  - **`TestParserRegistry`** (6 tests): Validates lookup by name and format, case-insensitivity, `UnknownParserError` with available list, and custom parser registration.
  - **`TestMultiLineBatch`** (2 tests): Validates multi-line mixed evidence streams and file stream reading.
- [`backend/tests/test_parser_persistence.py`](file:///d:/5th%20sem/forensiclens/backend/tests/test_parser_persistence.py) (17 tests):
  - **`TestBasicPersistence`** (4 tests): Single raw record + event, multi-line batch, unparsed record without event, and empty parse result.
  - **`TestProvenancePreservation`** (2 tests): Exact raw text preservation (including quotes/tabs) and byte-slice reconstruction from source.
  - **`TestEventMapping`** (3 tests): Normalized event fields, SHA-256 event hash, ISO UTC conversion, and BSD syslog unresolved timestamp.
  - **`TestReferentialIntegrity`** (3 tests): Nonexistent case ID rejection, unknown evidence ID rejection, and cross-case evidence isolation.
  - **`TestTransactionality`** (1 test): Constraint failure mid-batch causing 100% rollback of raw records, events, and FTS entries.
  - **`TestIdempotency`** (2 tests): Rejection of duplicate persistence by default, and safe ignore policy.
  - **`TestFTS5Synchronization`** (1 test): Lexical discovery through FTS5 MATCH on message and process fields.
  - **`TestEndToEndPipeline`** (1 test): Complete integration from EvidenceService ingestion -> OpenSSHParser -> ParserPersistenceService.

### 9.2 Full Verification Results

Running `pytest -v` across the entire project test suite:
```text
====================== 105 passed, 1 skipped in 13.72s =======================
```
- **`test_database.py`**: 39 passed (schema, migrations, foreign keys, FTS5, isolation).
- **`test_evidence.py`**: 20 passed, 1 skipped (streaming SHA-256, storage, immutability, duplicates, security).
- **`test_parsers.py`**: 29 passed (parser foundation and OpenSSH parsing).
- **`test_parser_persistence.py`**: 17 passed (persistence layer, transactions, idempotency, FTS5).

#### Explanation of the Skipped Test
`test_evidence.py::TestSecurity::test_symlink_input_rejected` is skipped on Windows environments when running without Developer Mode / administrative privileges. On Windows, creating a symbolic link requires `SeCreateSymbolicLinkPrivilege`. The test gracefully detects this limitation via `pytest.skip()` while the symlink security check remains active in production code.

---

## 11. Evidence Processing Service & API Integration

### 11.1 Evidence Processing Workflow

ForensicLens implements an end-to-end evidence processing pipeline that bridges immutable storage, parser detection, parsing, and atomic SQLite persistence:

```text
Evidence Ingestion (Upload)
             │
             ▼
   Stored as Immutable Object
  (`evidence_files.parser_status = 'PENDING'`)
             │
             ▼
   POST /api/cases/{case_id}/evidence/{evidence_id}/process
             │
             ├── 1. Check idempotency (reject if raw_records exist -> 409 Conflict)
             ├── 2. Resolve parser from format/registry or heuristic detection
             │      (marks 'UNSUPPORTED' if unrecognized)
             ├── 3. Read raw bytes directly from immutable artifact storage
             ├── 4. Execute parser (e.g. OpenSSHParser)
             ├── 5. Atomic persistence via ParserPersistenceService (SAVEPOINT)
             └── 6. Update `evidence_files.parser_status` ('PARSED' / 'PARTIAL' / 'FAILED')
```

### 11.2 API Endpoint: Process Evidence

**Route:** `POST /api/cases/{case_id}/evidence/{evidence_id}/process`  
**Tags:** `Evidence`

#### Request
Optional JSON payload or query parameter `parserName` / `parser_name`:
```json
{
  "parserName": "OPENSSH"
}
```

#### Response (200 OK)
```json
{
  "caseId": "CASE-2026-001",
  "evidenceId": "EV_4A2B9F3E1C78495A",
  "parserName": "openssh",
  "parserVersion": "1.0.0",
  "rawRecordsCount": 1240,
  "eventsCount": 1198,
  "unparsedRecordsCount": 42,
  "status": "PARSED",
  "errorSummary": null
}
```

#### HTTP Status Codes
- `200 OK`: Evidence successfully parsed and persisted.
- `400 Bad Request`: Invalid evidence state or malformed request.
- `404 Not Found`: Case or evidence artifact does not exist.
- `409 Conflict`: Evidence has already been parsed and persisted into this case.
- `422 Unprocessable Entity`: No compatible parser registered for the given format or filename.

### 11.3 Idempotency and Anti-Tampering Guarantee

In strict forensic workflows, evidence processing must be idempotent and verifiable:
- **Duplicate Prevention**: Before parsing begins, the service queries `raw_records` for the `(case_id, evidence_id)` tuple. If records already exist, an `AlreadyPersistedError` is raised, mapping cleanly to `409 Conflict`.
- **Atomic Rollback**: Processing operates inside a dedicated SQL `SAVEPOINT`. If any record fails schema validation or integrity constraints, the entire batch of raw records, events, and FTS5 entries rolls back cleanly with zero partial state.
- **Audit Tracking**: The `evidence_files` record is updated with exact timestamps, line counts, and final parser status (`PARSED`, `PARTIAL`, `FAILED`, or `UNSUPPORTED`).

### 11.4 User Interface Integration

The ForensicLens Evidence Page (`frontend/src/pages/EvidencePage.tsx`):
- Lists all ingested evidence artifacts with SHA-256 digests and integrity verification.
- Displays parser status badges (`PENDING`, `PROCESSING`, `PARSED`, `PARTIAL`, `UNSUPPORTED`, `FAILED`).
- Provides a dedicated **Process Evidence** action button with interactive spinning loader during execution.
- Displays parsed event counts directly in the table row upon completion.
- Provides a direct **View Events →** navigation link routing the investigator to the case's normalized timeline in `/events`.


1. **Year and Timezone Resolution Deferred**: OpenSSH logs with BSD syslog timestamps do not contain year or timezone information. Normalization to UTC is intentionally deferred to Phase 2 (Timeline and Correlation Engine).
2. **Initial Parser Scope**: OpenSSH is the initial reference parser. Parsers for Apache, Nginx, Linux auditd, Windows EVTX, and network flow records will be implemented in subsequent milestones using the same `BaseParser` foundation.
3. **Batch Pipeline Orchestration**: Step 9 provides atomic persistence of parsed results into `raw_records` and `events`. Orchestrating batch jobs across multiple files in a case will be addressed in future job queue enhancements.
