"""
LLM Provider Abstraction for ForensicLens Evidence-Grounded Claim Extraction.

Defines:
- BaseLLMProvider: Abstract interface for LLM extraction providers.
- FakeLLMProvider: Deterministic fake provider for offline testing with zero network/model dependencies.
- LlamaCppProvider: Explicitly unavailable provider stub reserved for Step 10 local GGUF integration.
- ExtractionConfig: Configuration for extraction limits, bounded context, and model parameters.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class LLMProviderError(Exception):
    """Base exception for all LLM provider operations."""


class LLMProviderUnavailableError(LLMProviderError):
    """Raised when an LLM provider is unconfigured, offline, or unavailable."""


class LLMOutputFormatError(LLMProviderError):
    """Raised when model output violates format expectations or is malformed JSON."""


class ExtractionConfig(BaseModel):
    """
    Configuration parameters governing claim extraction and context bounding.
    """
    max_claims: int = Field(20, ge=1, le=100, description="Maximum number of atomic claims to extract")
    max_context_chars: int = Field(16000, ge=100, le=128000, description="Max evidence context window in characters")
    max_records: int = Field(50, ge=1, le=500, description="Max individual evidence records to present in context")
    max_record_chars: int = Field(2000, ge=50, le=10000, description="Max characters per single evidence record snippet")
    temperature: float = Field(0.0, ge=0.0, le=1.0, description="Sampling temperature (deterministic 0.0)")
    model_identifier: str = Field("deterministic-fake", description="Model identifier string")
    timeout_seconds: float = Field(30.0, ge=1.0, le=300.0, description="Maximum execution timeout in seconds")


class BaseLLMProvider(ABC):
    """
    Provider-independent interface for structured claim extraction.
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Name of the provider implementation (e.g. 'fake', 'llama_cpp')."""

    @property
    @abstractmethod
    def model_identifier(self) -> str:
        """Model identifier string reported in extraction responses."""

    @property
    @abstractmethod
    def is_available(self) -> bool:
        """Whether the provider is currently initialized and ready for inference."""

    @abstractmethod
    def generate(
        self,
        system_instruction: str,
        user_prompt: str,
        config: Optional[ExtractionConfig] = None,
    ) -> str:
        """
        Execute inference with system instructions, user prompt, and configuration.

        Args:
            system_instruction: Bounded extraction guidelines & passive evidence rules.
            user_prompt: Investigator query and bounded XML-delimited evidence.
            config: Optional extraction configuration parameters.

        Returns:
            Raw response text from the model (expected to contain JSON).

        Raises:
            LLMProviderUnavailableError: If the provider is not operational.
            LLMProviderError: If inference fails.
        """


class FakeLLMProvider(BaseLLMProvider):
    """
    Deterministic fake provider for automated unit and integration tests.

    Features:
    - Zero external network access and zero external model dependencies.
    - Deterministic extraction for fixed inputs.
    - Configurable responses queue and failure simulation modes:
      'malformed_json', 'fabricated_citations', 'unsupported_type', 'unavailable', 'empty', 'oversized'.
    """

    def __init__(
        self,
        responses: Optional[List[str | Dict[str, Any]]] = None,
        failure_mode: Optional[str] = None,
        model_identifier: str = "deterministic-fake-v1",
        is_available: bool = True,
    ):
        self._responses: List[str] = []
        if responses:
            for r in responses:
                if isinstance(r, dict):
                    self._responses.append(json.dumps(r))
                else:
                    self._responses.append(str(r))
        self._failure_mode = failure_mode
        self._model_identifier = model_identifier
        self._is_available = is_available
        self.call_history: List[Dict[str, Any]] = []

    @property
    def provider_name(self) -> str:
        return "fake"

    @property
    def model_identifier(self) -> str:
        return self._model_identifier

    @property
    def is_available(self) -> bool:
        return self._is_available

    def set_responses(self, responses: List[str | Dict[str, Any]]) -> None:
        """Set or reset queued canned responses."""
        self._responses = [
            json.dumps(r) if isinstance(r, dict) else str(r) for r in responses
        ]

    def set_failure_mode(self, failure_mode: Optional[str]) -> None:
        """Set failure simulation mode."""
        self._failure_mode = failure_mode

    def generate(
        self,
        system_instruction: str,
        user_prompt: str,
        config: Optional[ExtractionConfig] = None,
    ) -> str:
        self.call_history.append(
            {
                "system_instruction": system_instruction,
                "user_prompt": user_prompt,
                "config": config,
            }
        )

        if not self._is_available or self._failure_mode == "unavailable":
            raise LLMProviderUnavailableError(
                "FakeLLMProvider simulated unavailability."
            )

        if self._failure_mode == "malformed_json":
            return '{"claims": [ {"statement": "incomplete json", '

        if self._failure_mode == "empty":
            return '{"claims": []}'

        if self._failure_mode == "oversized":
            return '{"claims": [' + ",".join(
                [f'{{"statement": "Claim {i}", "claim_type": "GENERIC_FORENSIC_EVENT", "action": "EVENT"}}' for i in range(500)]
            ) + "]}"

        if self._failure_mode == "fabricated_citations":
            return json.dumps(
                {
                    "claims": [
                        {
                            "claim_type": "AUTH_SUCCESS",
                            "statement": "Admin logged in successfully",
                            "subject": "admin",
                            "action": "LOGIN_SUCCESS",
                            "citations": [
                                {
                                    "evidence_id": "EV_FABRICATED_999",
                                    "raw_record_id": "REC_FABRICATED_999",
                                    "role": "PRIMARY_CITING",
                                }
                            ],
                        }
                    ]
                }
            )

        if self._failure_mode == "unsupported_type":
            return json.dumps(
                {
                    "claims": [
                        {
                            "claim_type": "NONEXISTENT_MAGIC_CLAIM_TYPE",
                            "statement": "Something impossible happened",
                            "action": "MAGIC",
                            "citations": [],
                        }
                    ]
                }
            )

        # Check queued responses
        if self._responses:
            return self._responses.pop(0)

        # Default: Deterministically parse evidence records from user prompt
        return self._generate_deterministic_claims(user_prompt)

    def _generate_deterministic_claims(self, user_prompt: str) -> str:
        """
        Scan user_prompt for delimited evidence records and deterministically
        synthesize atomic claims grounded in those records.
        """
        # Find all <evidence_record id="..." evidence_id="..." event_id="..."> ... </evidence_record>
        record_pattern = re.compile(
            r'<evidence_record\s+id="([^"]+)"\s+evidence_id="([^"]+)"(?:\s+event_id="([^"]*)")?[^>]*>(.*?)</evidence_record>',
            re.DOTALL,
        )

        matches = record_pattern.findall(user_prompt)
        claims: List[Dict[str, Any]] = []

        for raw_record_id, evidence_id, event_id, body in matches:
            text = body.replace("<![CDATA[", "").replace("]]>", "").strip()
            event_id_val = event_id if event_id and event_id != "None" else None

            # Pattern 1: Accepted password / login success
            m_accepted = re.search(
                r"Accepted\s+(\S+)\s+for\s+(\S+)\s+from\s+([0-9a-fA-F\.:]+)(?:\s+port\s+(\d+))?",
                text,
                re.IGNORECASE,
            )
            if m_accepted:
                auth_method, user, src_ip, port = m_accepted.groups()
                claims.append(
                    {
                        "claim_type": "AUTH_SUCCESS",
                        "statement": f"User {user} authenticated successfully via {auth_method} from {src_ip}",
                        "subject": user,
                        "action": "LOGIN_SUCCESS",
                        "object": auth_method,
                        "source_ip": src_ip,
                        "source_port": int(port) if port else None,
                        "confidence": 1.0,
                        "citations": [
                            {
                                "evidence_id": evidence_id,
                                "raw_record_id": raw_record_id,
                                "event_id": event_id_val,
                                "role": "PRIMARY_CITING",
                            }
                        ],
                    }
                )
                continue

            # Pattern 2: Failed password / authentication failure
            m_failed = re.search(
                r"Failed\s+(\S+)\s+for\s+(?:invalid\s+user\s+)?(\S+)\s+from\s+([0-9a-fA-F\.:]+)(?:\s+port\s+(\d+))?",
                text,
                re.IGNORECASE,
            )
            if m_failed:
                auth_method, user, src_ip, port = m_failed.groups()
                claims.append(
                    {
                        "claim_type": "AUTH_FAILURE",
                        "statement": f"Authentication failed for user {user} via {auth_method} from {src_ip}",
                        "subject": user,
                        "action": "AUTH_FAILURE",
                        "object": auth_method,
                        "source_ip": src_ip,
                        "source_port": int(port) if port else None,
                        "confidence": 1.0,
                        "citations": [
                            {
                                "evidence_id": evidence_id,
                                "raw_record_id": raw_record_id,
                                "event_id": event_id_val,
                                "role": "PRIMARY_CITING",
                            }
                        ],
                    }
                )
                continue

            # Pattern 3: Session opened
            m_session_opened = re.search(
                r"session\s+opened\s+for\s+user\s+(\S+)", text, re.IGNORECASE
            )
            if m_session_opened:
                user = m_session_opened.group(1)
                claims.append(
                    {
                        "claim_type": "SESSION_START",
                        "statement": f"User session opened for user {user}",
                        "subject": user,
                        "action": "SESSION_OPEN",
                        "confidence": 1.0,
                        "citations": [
                            {
                                "evidence_id": evidence_id,
                                "raw_record_id": raw_record_id,
                                "event_id": event_id_val,
                                "role": "PRIMARY_CITING",
                            }
                        ],
                    }
                )
                continue

            # Pattern 4: Session closed
            m_session_closed = re.search(
                r"session\s+closed\s+for\s+user\s+(\S+)", text, re.IGNORECASE
            )
            if m_session_closed:
                user = m_session_closed.group(1)
                claims.append(
                    {
                        "claim_type": "SESSION_END",
                        "statement": f"User session closed for user {user}",
                        "subject": user,
                        "action": "SESSION_CLOSE",
                        "confidence": 1.0,
                        "citations": [
                            {
                                "evidence_id": evidence_id,
                                "raw_record_id": raw_record_id,
                                "event_id": event_id_val,
                                "role": "PRIMARY_CITING",
                            }
                        ],
                    }
                )
                continue

            # Fallback for arbitrary raw forensic record: GENERIC_FORENSIC_EVENT
            claims.append(
                {
                    "claim_type": "GENERIC_FORENSIC_EVENT",
                    "statement": f"Forensic log record observed: {text[:100]}",
                    "action": "LOG_RECORD",
                    "confidence": 0.8,
                    "citations": [
                        {
                            "evidence_id": evidence_id,
                            "raw_record_id": raw_record_id,
                            "event_id": event_id_val,
                            "role": "PRIMARY_CITING",
                        }
                    ],
                }
            )

        return json.dumps({"claims": claims}, indent=2)


class LlamaCppProvider(BaseLLMProvider):
    """
    Llama.cpp local GGUF provider placeholder.

    Explicitly non-operational in Step 9. Raises LLMProviderUnavailableError
    until Step 10 local offline GGUF inference implementation.
    """

    def __init__(self, model_path: Optional[str] = None):
        self._model_path = model_path

    @property
    def provider_name(self) -> str:
        return "llama_cpp"

    @property
    def model_identifier(self) -> str:
        return "local-gguf-offline-step10"

    @property
    def is_available(self) -> bool:
        return False

    def generate(
        self,
        system_instruction: str,
        user_prompt: str,
        config: Optional[ExtractionConfig] = None,
    ) -> str:
        raise LLMProviderUnavailableError(
            "LlamaCppProvider is not operational in Step 9. "
            "Local offline GGUF inference integration is scheduled for Step 10."
        )
