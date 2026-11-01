"""
Parser registry for ForensicLens.

Maintains a secure, static registry of registered log and evidence parsers.
Allows parser selection by format (e.g. 'OPENSSH') or parser name (e.g. 'openssh').

Security:
    - Rejects dynamic imports of arbitrary module paths.
    - Fails with a clear UnknownParserError when an unregistered parser is requested.
"""

from __future__ import annotations

from typing import Optional

from app.parsers.base import BaseParser
from app.parsers.openssh import OpenSSHParser


class UnknownParserError(Exception):
    """Raised when an requested parser or format is not registered."""

    def __init__(self, requested: str, available: list[str]):
        self.requested = requested
        self.available = available
        super().__init__(
            f"Unknown parser or format '{requested}'. "
            f"Available parsers/formats: {', '.join(sorted(available)) if available else 'none'}"
        )


class ParserRegistry:
    """
    Registry mapping parser names and supported formats to BaseParser instances.
    """

    def __init__(self) -> None:
        self._by_name: dict[str, BaseParser] = {}
        self._by_format: dict[str, BaseParser] = {}

    def register(self, parser: BaseParser) -> None:
        """
        Register a parser instance.

        Registers both under its lowercased `parser_name` and uppercased `supported_format`.
        """
        name_key = parser.parser_name.strip().lower()
        format_key = parser.supported_format.strip().upper()

        self._by_name[name_key] = parser
        self._by_format[format_key] = parser

    def get(self, name_or_format: str) -> BaseParser:
        """
        Lookup a parser by name or format.

        Args:
            name_or_format: Parser name (e.g. 'openssh') or format (e.g. 'OPENSSH').

        Returns:
            The matching BaseParser instance.

        Raises:
            UnknownParserError: If no matching parser is found.
        """
        if not name_or_format or not isinstance(name_or_format, str):
            raise UnknownParserError(
                str(name_or_format),
                self.list_available(),
            )

        key_lower = name_or_format.strip().lower()
        key_upper = name_or_format.strip().upper()

        if key_lower in self._by_name:
            return self._by_name[key_lower]
        if key_upper in self._by_format:
            return self._by_format[key_upper]

        raise UnknownParserError(name_or_format, self.list_available())

    def get_parser(self, name_or_format: str) -> BaseParser:
        """Alias for get()."""
        return self.get(name_or_format)

    def list_parsers(self) -> list[str]:
        """Return a sorted list of registered parser names."""
        return sorted(self._by_name.keys())

    def list_formats(self) -> list[str]:
        """Return a sorted list of supported format names."""
        return sorted(self._by_format.keys())

    def list_available(self) -> list[str]:
        """Return combined list of parser names and formats."""
        return sorted(set(list(self._by_name.keys()) + list(self._by_format.keys())))

    def clear(self) -> None:
        """Clear all registered parsers (primarily for testing)."""
        self._by_name.clear()
        self._by_format.clear()


# ---------------------------------------------------------------------------
# Default Global Registry
# ---------------------------------------------------------------------------

default_registry = ParserRegistry()

# Register built-in parsers
default_registry.register(OpenSSHParser())


def get_parser(name_or_format: str) -> BaseParser:
    """Convenience function to get a parser from the default registry."""
    return default_registry.get(name_or_format)


def register_parser(parser: BaseParser) -> None:
    """Convenience function to register a parser in the default registry."""
    default_registry.register(parser)


def list_parsers() -> list[str]:
    """Convenience function to list parser names in the default registry."""
    return default_registry.list_parsers()


def list_formats() -> list[str]:
    """Convenience function to list formats in the default registry."""
    return default_registry.list_formats()

