# ForensicLens - Backend

This directory contains the Python / FastAPI application backend for **ForensicLens**, an offline-first, privacy-preserving digital forensics investigation platform.

## Architecture & Structure

The backend core is structured into modular application packages under `app/`:

- `api/`: REST API endpoints and router definitions
- `cases/`: Case lifecycle and metadata management
- `ingestion/`: Forensic artifact ingestion and normalization parsers
- `evidence/`: Structured evidence models and storage
- `retrieval/`: Hybrid retrieval (lexical FTS5 + dense semantic vector search + RRF reranking)
- `correlation/`: Timeline analysis and session correlation
- `behaviour/`: MITRE ATT&CK behavioural mapping
- `legal/`: Indian legal provision mapping (BNS, BSA, IT Act)
- `privacy/`: Pseudonymization gateway and redaction vault
- `llm/`: Local LLM orchestration (`llama.cpp` / GGUF) with grammar constraints
- `verification/`: Deterministic claim-to-evidence verification engine
- `reports/`: Investigation summary and legal certificate generation (BSA s.63)
- `audit/`: Tamper-evident hash-chained audit logging
- `jobs/`: Background asynchronous tasks and workers

## Development Status

The backend is currently in its initial environment foundation phase. Backend modules and dependencies will be implemented incrementally according to the project roadmap.

