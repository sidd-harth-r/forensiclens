"""
Parser foundation module for ForensicLens.

Provides pluggable log and artifact parsing, provenance extraction,
parser registry management, and database persistence.
"""

from app.parsers.base import (
    BaseParser,
    ParsedEvent,
    ParsedRecord,
    ParseResult,
    RawRecord,
    classify_ip_scope,
    iter_lines_with_offsets,
    normalize_timestamp,
)
from app.parsers.openssh import OpenSSHParser
from app.parsers.persistence import (
    AlreadyPersistedError,
    CaseNotFoundError,
    EvidenceNotFoundError,
    ParserPersistenceService,
    PersistenceError,
    PersistenceResult,
    ReferentialIntegrityError,
    compute_event_hash,
    persist_parse_result,
)
from app.parsers.registry import (
    ParserRegistry,
    UnknownParserError,
    default_registry,
    get_parser,
    list_formats,
    list_parsers,
    register_parser,
)
from app.parsers.service import (
    EvidenceArtifactNotFoundError,
    EvidenceProcessingError,
    ProcessResult,
    UnsupportedParserError,
    process_evidence,
)

__all__ = [
    "AlreadyPersistedError",
    "BaseParser",
    "CaseNotFoundError",
    "EvidenceArtifactNotFoundError",
    "EvidenceNotFoundError",
    "EvidenceProcessingError",
    "OpenSSHParser",
    "ParseResult",
    "ParsedEvent",
    "ParsedRecord",
    "ParserPersistenceService",
    "ParserRegistry",
    "PersistenceError",
    "PersistenceResult",
    "ProcessResult",
    "RawRecord",
    "ReferentialIntegrityError",
    "UnknownParserError",
    "UnsupportedParserError",
    "classify_ip_scope",
    "compute_event_hash",
    "default_registry",
    "get_parser",
    "iter_lines_with_offsets",
    "list_formats",
    "list_parsers",
    "normalize_timestamp",
    "persist_parse_result",
    "process_evidence",
    "register_parser",
]
