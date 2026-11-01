"""
Parser foundation module for ForensicLens.

Provides pluggable log and artifact parsing, provenance extraction,
and parser registry management.
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
from app.parsers.registry import (
    ParserRegistry,
    UnknownParserError,
    default_registry,
    get_parser,
    list_formats,
    list_parsers,
    register_parser,
)

__all__ = [
    "BaseParser",
    "OpenSSHParser",
    "ParseResult",
    "ParsedEvent",
    "ParsedRecord",
    "ParserRegistry",
    "RawRecord",
    "UnknownParserError",
    "classify_ip_scope",
    "default_registry",
    "get_parser",
    "iter_lines_with_offsets",
    "list_formats",
    "list_parsers",
    "normalize_timestamp",
    "register_parser",
]

