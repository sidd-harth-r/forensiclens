"""
Test suite for the ForensicLens parser foundation and OpenSSH parser.

Tests cover:
    - OpenSSH parser recognition:
        - Successful password authentication
        - Failed password authentication
        - Invalid user attempts
        - Public-key authentication
        - PAM session open / close lifecycle
        - Disconnect events
    - Provenance preservation:
        - Exact original line text
        - Line numbers (1-based)
        - Exact byte offsets (byte_start, byte_end)
    - Timestamp handling:
        - BSD syslog timestamps without year/timezone
        - ISO-8601 timestamps with explicit UTC timezone
        - ISO-8601 timestamps with non-UTC offset converted to UTC
        - ISO-8601 timestamps without timezone left unnormalized
    - Edge cases & resilience:
        - Malformed/unrecognized lines
        - Partial syslog lines with unrecognized OpenSSH messages
        - Missing optional fields (PID, host, port)
        - Empty lines
    - Parser registry:
        - Lookup by name and by format
        - Case insensitivity
        - Unknown parser error handling
        - Custom parser registration
    - Multi-line evidence batch parsing
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

import pytest

# Ensure imports resolve from backend directory
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.parsers.base import (
    BaseParser,
    ParseResult,
    classify_ip_scope,
    normalize_timestamp,
)
from app.parsers.openssh import OpenSSHParser
from app.parsers.registry import (
    ParserRegistry,
    UnknownParserError,
    get_parser,
    list_formats,
    list_parsers,
    register_parser,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def parser() -> OpenSSHParser:
    return OpenSSHParser()


# ---------------------------------------------------------------------------
# 1. OpenSSH Authentication Parsing Tests
# ---------------------------------------------------------------------------


class TestOpenSSHParserAuth:
    """Tests recognizing standard OpenSSH authentication event types."""

    def test_successful_password_auth(self, parser: OpenSSHParser):
        """Accepted password authentication extracts user, IP, port, and event type."""
        line = "Jan 15 10:20:30 webserver sshd[1234]: Accepted password for analyst from 192.168.1.50 port 45678 ssh2"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        assert res.total_lines == 1
        assert res.parsed_lines == 1
        rec = res.records[0]

        assert rec.raw_record.parse_status == "PARSED"
        assert rec.raw_record.parse_error is None
        assert rec.event is not None
        assert rec.event.event_type == "AUTH_SUCCESS"
        assert rec.event.severity == "INFO"
        assert rec.event.user_value == "analyst"
        assert rec.event.src_ip == "192.168.1.50"
        assert rec.event.src_ip_scope == "PRIVATE"
        assert rec.event.src_port == 45678
        assert rec.event.host == "webserver"
        assert rec.event.process == "sshd"
        assert rec.event.pid == 1234
        assert rec.event.source == "OpenSSH"

    def test_failed_password_auth(self, parser: OpenSSHParser):
        """Failed password authentication extracts user, public IP, and port."""
        line = "Jan 15 10:20:31 webserver sshd[1235]: Failed password for root from 93.184.216.34 port 22 ssh2"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        assert res.parsed_lines == 1
        rec = res.records[0]
        assert rec.event is not None
        assert rec.event.event_type == "AUTH_FAILURE"
        assert rec.event.severity == "WARNING"
        assert rec.event.user_value == "root"
        assert rec.event.src_ip == "93.184.216.34"
        assert rec.event.src_ip_scope == "PUBLIC"
        assert rec.event.src_port == 22

    def test_invalid_user_attempt(self, parser: OpenSSHParser):
        """Invalid user log line is recognized and mapped to INVALID_USER."""
        line = "Jan 15 10:20:32 webserver sshd[1236]: Invalid user guest from 192.168.1.200 port 51234"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        assert res.parsed_lines == 1
        rec = res.records[0]
        assert rec.event is not None
        assert rec.event.event_type == "INVALID_USER"
        assert rec.event.severity == "WARNING"
        assert rec.event.user_value == "guest"
        assert rec.event.src_ip == "192.168.1.200"
        assert rec.event.src_port == 51234

    def test_failed_password_for_invalid_user(self, parser: OpenSSHParser):
        """Failed password for invalid user extracts the target username properly."""
        line = "Jan 15 10:20:33 webserver sshd[1237]: Failed password for invalid user admin from 10.0.0.1 port 43210 ssh2"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        assert res.parsed_lines == 1
        rec = res.records[0]
        assert rec.event is not None
        assert rec.event.event_type == "AUTH_FAILURE"
        assert rec.event.severity == "WARNING"
        assert rec.event.user_value == "admin"
        assert rec.event.src_ip == "10.0.0.1"
        assert rec.event.src_ip_scope == "PRIVATE"

    def test_public_key_auth_success(self, parser: OpenSSHParser):
        """Accepted public key authentication line is parsed with key metadata."""
        line = "Jan 15 10:20:34 webserver sshd[1238]: Accepted publickey for deployer from 10.1.1.1 port 55555 ssh2: RSA SHA256:abcd1234efgh5678"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        assert res.parsed_lines == 1
        rec = res.records[0]
        assert rec.event is not None
        assert rec.event.event_type == "AUTH_SUCCESS"
        assert rec.event.user_value == "deployer"
        assert rec.event.src_ip == "10.1.1.1"
        assert rec.event.src_port == 55555

    def test_pam_session_lifecycle(self, parser: OpenSSHParser):
        """PAM session opened and closed lines are extracted accurately."""
        lines = (
            "Jan 15 10:25:00 host sshd[1240]: pam_unix(sshd:session): session opened for user alice by (uid=0)\n"
            "Jan 15 10:30:00 host sshd[1240]: pam_unix(sshd:session): session closed for user alice\n"
        )
        res = parser.parse(lines, evidence_id="EV_TEST_001")

        assert res.parsed_lines == 2
        assert res.records[0].event.event_type == "SESSION_OPENED"
        assert res.records[0].event.user_value == "alice"
        assert res.records[1].event.event_type == "SESSION_CLOSED"
        assert res.records[1].event.user_value == "alice"

    def test_disconnect_events(self, parser: OpenSSHParser):
        """Disconnect and connection closed lines are extracted."""
        lines = (
            "Jan 15 10:35:00 host sshd[1241]: Received disconnect from 192.168.1.100 port 50000:11: disconnected by user\n"
            "Jan 15 10:36:00 host sshd[1242]: Disconnected from user bob 10.0.0.2 port 50001\n"
            "Jan 15 10:37:00 host sshd[1243]: Connection closed by 172.16.0.5 port 50002\n"
        )
        res = parser.parse(lines, evidence_id="EV_TEST_001")

        assert res.parsed_lines == 3
        for rec in res.records:
            assert rec.event.event_type == "DISCONNECT"


# ---------------------------------------------------------------------------
# 2. Timestamp Handling Tests
# ---------------------------------------------------------------------------


class TestOpenSSHTimestampHandling:
    """Tests ensuring timestamp integrity and zero unsupported assumption invention."""

    def test_bsd_syslog_timestamp_preserves_original_leaves_utc_none(self, parser: OpenSSHParser):
        """BSD syslog timestamp (no year, no timezone) leaves timestamp_utc as None."""
        line = "Jan 15 10:20:30 server sshd[1234]: Accepted password for user1 from 1.1.1.1 port 22"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        rec = res.records[0]
        assert rec.event is not None
        assert rec.event.timestamp_original == "Jan 15 10:20:30"
        # Must NOT invent year or timezone
        assert rec.event.timestamp_utc is None
        assert rec.event.timestamp_confidence is None

    def test_iso8601_with_utc_timezone_normalizes(self, parser: OpenSSHParser):
        """ISO-8601 timestamp with Z or +00:00 normalizes to UTC with EXACT confidence."""
        line = "2026-01-15T10:20:30Z server sshd[1234]: Accepted password for user1 from 1.1.1.1 port 22"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        rec = res.records[0]
        assert rec.event is not None
        assert rec.event.timestamp_original == "2026-01-15T10:20:30Z"
        assert rec.event.timestamp_utc == "2026-01-15T10:20:30Z"
        assert rec.event.timestamp_confidence == "EXACT"

    def test_iso8601_with_timezone_offset_converts_to_utc(self, parser: OpenSSHParser):
        """ISO-8601 timestamp with non-zero offset converts cleanly to UTC."""
        line = "2026-01-15T10:20:30+05:30 server sshd[1234]: Accepted password for user1 from 1.1.1.1 port 22"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        rec = res.records[0]
        assert rec.event is not None
        assert rec.event.timestamp_original == "2026-01-15T10:20:30+05:30"
        assert rec.event.timestamp_utc == "2026-01-15T04:50:30Z"
        assert rec.event.timestamp_confidence == "EXACT"

    def test_iso8601_without_timezone_leaves_utc_none(self, parser: OpenSSHParser):
        """ISO-8601 timestamp without timezone cannot be reliably converted; utc remains None."""
        line = "2026-01-15T10:20:30 server sshd[1234]: Accepted password for user1 from 1.1.1.1 port 22"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        rec = res.records[0]
        assert rec.event is not None
        assert rec.event.timestamp_original == "2026-01-15T10:20:30"
        assert rec.event.timestamp_utc is None


# ---------------------------------------------------------------------------
# 3. Provenance and Byte-Offset Tests
# ---------------------------------------------------------------------------


class TestOpenSSHProvenance:
    """Tests confirming exact preservation of raw bytes, offsets, and line numbers."""

    def test_exact_original_line_preserved(self, parser: OpenSSHParser):
        """Raw line text is preserved exactly without alteration."""
        line = "Jan 15 10:20:30 server sshd[1234]:   Accepted password for analyst from 10.0.0.1 port 22  "
        res = parser.parse(line, evidence_id="EV_TEST_001")

        rec = res.records[0]
        assert rec.raw_record.raw_text == line.rstrip("\r\n")

    def test_line_number_preservation(self, parser: OpenSSHParser):
        """Line numbers are 1-based and match source file order."""
        lines = "line1\nline2\nline3\n"
        res = parser.parse(lines, evidence_id="EV_TEST_001")

        assert len(res.records) == 3
        assert res.records[0].raw_record.line_number == 1
        assert res.records[1].raw_record.line_number == 2
        assert res.records[2].raw_record.line_number == 3

    def test_byte_offset_preservation(self, parser: OpenSSHParser):
        """Byte offsets byte_start and byte_end slice the exact original bytes."""
        raw_bytes = (
            b"Jan 15 10:20:30 server sshd[123]: Accepted password for user1 from 10.0.0.1 port 22\n"
            b"Jan 15 10:20:31 server sshd[124]: Failed password for user2 from 10.0.0.2 port 22\r\n"
            b"Jan 15 10:20:32 server sshd[125]: Invalid user user3 from 10.0.0.3 port 22"
        )
        res = parser.parse(raw_bytes, evidence_id="EV_TEST_001")

        assert len(res.records) == 3
        for rec in res.records:
            b_start = rec.raw_record.byte_start
            b_end = rec.raw_record.byte_end
            slice_bytes = raw_bytes[b_start:b_end]

            # The decoded slice without trailing CR/LF must equal raw_text
            assert slice_bytes.decode("utf-8").rstrip("\r\n") == rec.raw_record.raw_text

        # Offsets are contiguous
        assert res.records[0].raw_record.byte_end == res.records[1].raw_record.byte_start
        assert res.records[1].raw_record.byte_end == res.records[2].raw_record.byte_start
        assert res.records[2].raw_record.byte_end == len(raw_bytes)

    def test_parser_metadata_attached(self, parser: OpenSSHParser):
        """Each record and the parse result carries parser name and version."""
        line = "Jan 15 10:20:30 server sshd[123]: Accepted password for user1 from 10.0.0.1 port 22"
        res = parser.parse(line, evidence_id="EV_META_001")

        assert res.parser_name == "openssh"
        assert res.parser_version == "1.0.0"
        assert res.supported_format == "OPENSSH"
        assert res.evidence_id == "EV_META_001"

        rec = res.records[0]
        assert rec.parser_name == "openssh"
        assert rec.parser_version == "1.0.0"
        assert rec.evidence_id == "EV_META_001"


# ---------------------------------------------------------------------------
# 4. Resilience and Malformed Input Tests
# ---------------------------------------------------------------------------


class TestOpenSSHResilience:
    """Tests confirming invalid/unrecognized lines never crash the parser."""

    def test_malformed_unrecognized_line(self, parser: OpenSSHParser):
        """Non-syslog arbitrary text is marked UNPARSED without crashing."""
        line = "CORRUPTED_BINARY_DATA_OR_RANDOM_TEXT_NOT_A_LOG_LINE"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        assert res.unparsed_lines == 1
        assert res.parsed_lines == 0
        rec = res.records[0]
        assert rec.raw_record.parse_status == "UNPARSED"
        assert rec.raw_record.parse_error is not None
        assert rec.event is None

    def test_partial_syslog_line(self, parser: OpenSSHParser):
        """Syslog header is extracted but unrecognized OpenSSH body is marked PARTIAL."""
        line = "Jan 15 10:20:30 server sshd[1234]: Some obscure internal debug log message from sshd"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        assert res.partial_lines == 1
        assert res.parsed_lines == 0
        rec = res.records[0]
        assert rec.raw_record.parse_status == "PARTIAL"
        assert rec.raw_record.parse_error == "Unrecognized OpenSSH message body"
        assert rec.event is not None
        assert rec.event.event_type == "UNKNOWN"
        assert rec.event.host == "server"
        assert rec.event.process == "sshd"
        assert rec.event.pid == 1234

    def test_missing_optional_pid(self, parser: OpenSSHParser):
        """Line without PID (sshd instead of sshd[pid]) parses successfully."""
        line = "Jan 15 10:20:30 server sshd: Failed password for root from 1.1.1.1 port 22 ssh2"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        rec = res.records[0]
        assert rec.raw_record.parse_status == "PARSED"
        assert rec.event.pid is None
        assert rec.event.host == "server"
        assert rec.event.user_value == "root"

    def test_missing_optional_host(self, parser: OpenSSHParser):
        """Line without hostname parses successfully."""
        line = "Jan 15 10:20:30 sshd[123]: Failed password for root from 1.1.1.1 port 22 ssh2"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        rec = res.records[0]
        assert rec.raw_record.parse_status == "PARSED"
        assert rec.event.host is None
        assert rec.event.pid == 123
        assert rec.event.user_value == "root"

    def test_missing_optional_port(self, parser: OpenSSHParser):
        """Invalid user log without port parses successfully."""
        line = "Jan 15 10:20:30 server sshd[123]: Invalid user nobody from 192.168.1.1"
        res = parser.parse(line, evidence_id="EV_TEST_001")

        rec = res.records[0]
        assert rec.raw_record.parse_status == "PARSED"
        assert rec.event.src_port is None
        assert rec.event.user_value == "nobody"
        assert rec.event.src_ip == "192.168.1.1"

    def test_empty_line_handling(self, parser: OpenSSHParser):
        """Empty lines in log files are safely categorized as UNPARSED."""
        lines = "Jan 15 10:20:30 server sshd[123]: Accepted password for u1 from 1.1.1.1 port 22\n\n\n"
        res = parser.parse(lines, evidence_id="EV_TEST_001")

        assert res.total_lines == 3
        assert res.parsed_lines == 1
        assert res.unparsed_lines == 2


# ---------------------------------------------------------------------------
# 5. Parser Registry Tests
# ---------------------------------------------------------------------------


class TestParserRegistry:
    """Tests for parser registry lookup, case insensitivity, and security."""

    def test_registry_lookup_by_name(self):
        """Registry resolves 'openssh'."""
        p = get_parser("openssh")
        assert isinstance(p, OpenSSHParser)
        assert p.parser_name == "openssh"

    def test_registry_lookup_by_format(self):
        """Registry resolves 'OPENSSH'."""
        p = get_parser("OPENSSH")
        assert isinstance(p, OpenSSHParser)
        assert p.supported_format == "OPENSSH"

    def test_registry_case_insensitivity(self):
        """Registry lookups are case-insensitive."""
        p1 = get_parser("OpenSSH")
        p2 = get_parser("openssh")
        p3 = get_parser("OPENSSH")
        assert p1 is p2 is p3

    def test_unknown_parser_raises_clear_error(self):
        """Requesting an unknown parser raises UnknownParserError."""
        with pytest.raises(UnknownParserError) as exc_info:
            get_parser("windows_evtx")

        assert "Unknown parser or format 'windows_evtx'" in str(exc_info.value)
        assert "OPENSSH" in exc_info.value.available or "openssh" in exc_info.value.available

    def test_list_parsers_and_formats(self):
        """Registry lists registered parser names and formats."""
        names = list_parsers()
        formats = list_formats()

        assert "openssh" in names
        assert "OPENSSH" in formats

    def test_custom_parser_registration(self):
        """A new parser can be registered and retrieved without dynamic module imports."""
        custom_registry = ParserRegistry()

        class DummyApacheParser(BaseParser):
            @property
            def parser_name(self) -> str:
                return "apache_access"

            @property
            def parser_version(self) -> str:
                return "0.1.0"

            @property
            def supported_format(self) -> str:
                return "APACHE"

            def parse(self, source, evidence_id, *, encoding="utf-8"):
                return ParseResult(
                    evidence_id=evidence_id,
                    parser_name=self.parser_name,
                    parser_version=self.parser_version,
                    supported_format=self.supported_format,
                    records=[],
                    total_lines=0,
                    parsed_lines=0,
                    partial_lines=0,
                    unparsed_lines=0,
                )

        custom_registry.register(DummyApacheParser())

        p_by_name = custom_registry.get("apache_access")
        p_by_format = custom_registry.get("APACHE")
        assert isinstance(p_by_name, DummyApacheParser)
        assert isinstance(p_by_format, DummyApacheParser)


# ---------------------------------------------------------------------------
# 6. Multi-Line Batch Evidence Tests
# ---------------------------------------------------------------------------


class TestMultiLineBatch:
    """Tests parsing a realistic multi-line evidence input containing mixed events."""

    def test_mixed_evidence_stream(self, parser: OpenSSHParser):
        """Batch input with successes, failures, invalid users, partials, and junk lines."""
        content = (
            "Jan 15 10:20:30 server sshd[100]: Accepted password for analyst from 10.0.0.1 port 50000 ssh2\n"
            "Jan 15 10:20:31 server sshd[101]: Failed password for root from 198.51.100.1 port 22 ssh2\n"
            "Jan 15 10:20:32 server sshd[102]: Invalid user testuser from 192.168.1.50 port 50001\n"
            "Jan 15 10:20:33 server sshd[103]: Unrecognized sshd internal daemon message\n"
            "UNSTRUCTURED_GARBAGE_LINE_WITHOUT_SYSLOG_HEADER\n"
        )

        res = parser.parse(content, evidence_id="EV_BATCH_001")

        assert res.total_lines == 5
        assert res.parsed_lines == 3
        assert res.partial_lines == 1
        assert res.unparsed_lines == 1

        # Check line 1 (Success)
        assert res.records[0].raw_record.parse_status == "PARSED"
        assert res.records[0].event.event_type == "AUTH_SUCCESS"
        assert res.records[0].raw_record.line_number == 1

        # Check line 2 (Failure)
        assert res.records[1].raw_record.parse_status == "PARSED"
        assert res.records[1].event.event_type == "AUTH_FAILURE"
        assert res.records[1].raw_record.line_number == 2

        # Check line 3 (Invalid User)
        assert res.records[2].raw_record.parse_status == "PARSED"
        assert res.records[2].event.event_type == "INVALID_USER"
        assert res.records[2].raw_record.line_number == 3

        # Check line 4 (Partial)
        assert res.records[3].raw_record.parse_status == "PARTIAL"
        assert res.records[3].event.event_type == "UNKNOWN"
        assert res.records[3].raw_record.line_number == 4

        # Check line 5 (Unparsed)
        assert res.records[4].raw_record.parse_status == "UNPARSED"
        assert res.records[4].event is None
        assert res.records[4].raw_record.line_number == 5

    def test_file_stream_parsing(self, parser: OpenSSHParser, tmp_path: Path):
        """Parser reads directly from a file path."""
        test_file = tmp_path / "test_auth.log"
        test_file.write_text(
            "Jan 15 10:20:30 server sshd[100]: Accepted password for analyst from 10.0.0.1 port 50000 ssh2\n",
            encoding="utf-8",
        )

        res = parser.parse(test_file, evidence_id="EV_FILE_001")
        assert res.total_lines == 1
        assert res.parsed_lines == 1
        assert res.records[0].event.user_value == "analyst"
