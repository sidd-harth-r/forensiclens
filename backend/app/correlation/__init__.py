"""
ForensicLens Correlation Subsystem.

Provides timeline analysis, deterministic session reconstruction, and forensic correlation.
"""

from app.correlation.sessions import (
    DEFAULT_SESSION_GAP_SECONDS,
    CorrelationSignal,
    ForensicSession,
    ForensicSessionEvent,
    reconstruct_sessions,
)

__all__ = [
    "DEFAULT_SESSION_GAP_SECONDS",
    "CorrelationSignal",
    "ForensicSession",
    "ForensicSessionEvent",
    "reconstruct_sessions",
]

