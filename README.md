# ForensicLens

> **Privacy-Preserving Digital Forensics Investigation Using Hybrid Retrieval and Indian Legal Provision Mapping**

---

## 1. Project Overview

**ForensicLens** is an offline-first, privacy-preserving digital forensics investigation platform designed for investigators, cybersecurity analysts, and legal teams. It addresses the critical challenges in modern digital forensics: handling massive, unstructured forensic artifacts, preventing sensitive data leakage during AI-assisted analysis, grounding analytical claims deterministically in tamper-evident evidence, and bridging forensic findings to relevant statutory provisions of Indian law (such as the Bharatiya Nyaya Sanhita, Bharatiya Sakshya Adhiniyam, and Information Technology Act).

---

## 2. Project Objective

The primary objective of ForensicLens is to enable verifiable, privacy-safe digital forensic analysis on commodity local hardware without requiring cloud connectivity. The system aims to:

1. **Ingest and normalize diverse forensic artifacts** (system logs, auth logs, command histories, network captures) into structured evidence records.
2. **Execute hybrid retrieval** combining lexical keyword search (SQLite FTS5) and dense semantic vector retrieval (ChromaDB) fused via Reciprocal Rank Fusion (RRF) and reranked using a Cross-Encoder.
3. **Preserve investigation privacy** using a reversible pseudonymization vault with configurable redacting levels (L1 Clean, L2 Masked, L3 Pseudo/Tokenized).
4. **Generate structured, verifiable claims** using local quantized LLMs (llama.cpp / GGUF) enforced with deterministic evidence citation and verification.
5. **Map findings to Indian legal frameworks** through an elements-of-offence statutory retrieval corpus.
6. **Ensure evidentiary integrity** via SHA-256 evidence hashing, timeline/session correlation, anti-forensics detection, and hash-chained audit trails.

---

## 3. Core Principles

- **Offline-First & Air-Gapped by Design**: Zero network egress. No cloud APIs, no external telemetry, and no runtime external model downloads.
- **Evidence Immutability**: All ingested artifacts are cryptographically hashed (SHA-256) upon arrival and stored in per-case encrypted databases (SQLCipher).
- **Claim-Level Verifiability**: Every AI-generated assertion must be grounded in raw evidence spans and verified by deterministic verification routines. Unverified or fabricated assertions are flagged.
- **Strict Privacy Preservation**: Evidence containing PII (Personally Identifiable Information) can be pseudonymized or masked before retrieval or LLM inference.
- **Explainability & Chain of Custody**: Cryptographic hash chaining on audit logs provides verifiable proof of who accessed or modified case state.
- **Statutory Grounding**: Correlation of behavioural indicators (MITRE ATT&CK) with statutory provisions of Indian cyber and criminal law.

---

## 4. Planned High-Level Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                         Presentation Layer                             │
│                  React + TypeScript + Vite + Tailwind CSS              │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ HTTP / REST (127.0.0.1 only)
┌───────────────────────────────────▼────────────────────────────────────┐
│                        FastAPI Application Core                        │
│                                                                        │
│   ├── Case & Ingestion Engine (Artifact Parsers & SHA-256 Hasher)      │
│   ├── Privacy Gateway (HMAC Pseudonymization Vault & Redaction)        │
│   ├── Hybrid Retrieval Engine (SQLite FTS5 + ChromaDB + RRF + Rerank)  │
│   ├── Behaviour & Correlation Engine (Timeline, Sessions & ATT&CK)     │
│   ├── Local LLM Engine (llama.cpp + GGUF + Grammar-Constrained JSON)   │
│   ├── Claim Verification Engine (Deterministic Evidence Grounding)     │
│   ├── Indian Legal Provision Mapping Engine (BNS, BSA, IT Act)         │
│   └── Audit & Integrity Engine (Hash-Chained Log & Anti-Forensics)     │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│                         Storage & Model Layer                          │
│                                                                        │
│   ├── Case Databases: SQLCipher (SQLite + FTS5) (data/cases/<id>/)     │
│   ├── Semantic Index: ChromaDB (Local, Telemetry Disabled)             │
│   ├── Local Models: Embedding, Cross-Encoder & Quantized GGUF LLMs     │
│   └── Global Statutory Corpus: Read-Only Indian Legal Index            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React, TypeScript, Vite, Tailwind CSS, shadcn/ui | Fast, responsive desktop-like investigative SPA |
| **Backend API** | Python 3.10+, FastAPI, Pydantic v2 | High-performance asynchronous API, data validation |
| **Structured Storage** | SQLite + FTS5 / SQLCipher | Zero-server, per-case encrypted relational storage & full-text search |
| **Vector Storage** | ChromaDB (Local embedded, telemetry disabled) | Dense semantic retrieval over evidence chunks |
| **Hybrid Retrieval** | Reciprocal Rank Fusion (RRF) | Merges lexical and dense semantic candidate lists |
| **Reranker** | Cross-Encoder (`bge-reranker-base`) | High-precision candidate relevance reranking |
| **Embeddings** | Sentence Transformers (`bge-small-en-v1.5`) | Local dense embeddings calculation |
| **Local LLM** | `llama.cpp` / GGUF | Local quantized inference with strict JSON schema grammar constraints |
| **Containerization** | Docker Compose (internal network, loopback only) | Reproducible local deployment |

---

## 6. Current Development Status

> [!NOTE]
> **Status: Phase 1 Ingestion, Evidence Storage & Parser Foundation Active**
> Key P0 architectural foundations are implemented and verified with automated test suites:
> - **FastAPI Backend Bootstrap**: Working ASGI backend entry point with health checks and OpenAPI docs.
> - **P0 Case Database Foundation**: SQLite + FTS5 schema (20 case tables, 2 legal-KB tables, 1 FTS5 virtual table), strict foreign key cascades, WAL mode, per-case database isolation, and migration checksum verification (`backend/migrations/001_initial.sql`).
> - **P0 Evidence Ingestion Foundation**: Content-addressed immutable artifact storage under `cases/<case_id>/evidence/objects/`, SHA-256 integrity verification, database metadata tracking, and path traversal prevention (`backend/app/evidence/`).
> - **P0 Parser Foundation**: Pluggable forensic log parser architecture (`BaseParser`, `ParserRegistry`) with operational Linux/OpenSSH authentication log parser (`OpenSSHParser`), exact byte-offset tracking, ReDoS-safe patterns, IP scope categorization, and provenance preservation (`backend/app/parsers/`).
> - **Automated Test Suite**: 88 unit and integration tests passing (`pytest`), validating database isolation, ingestion immutability, and parser correctness.

---

## 7. Repository Structure

```text
forensiclens/
│
├── backend/
│   ├── app/
│   │   ├── api/            # REST API endpoints & route handlers
│   │   ├── cases/          # Case management, lifecycle & metadata
│   │   ├── evidence/       # Evidence models, indexing & raw storage
│   │   ├── parsers/        # Pluggable forensic log parsers, registry & persistence
│   │   ├── ingestion/      # Forensic artifact ingestion orchestration
│   │   ├── retrieval/      # FTS5 lexical, Chroma dense, RRF & rerankers
│   │   ├── correlation/    # Timeline reconstruction & session correlation
│   │   ├── behaviour/      # MITRE ATT&CK behavioural mapping
│   │   ├── legal/          # Indian legal statutes & elements mapping
│   │   ├── privacy/        # Pseudonymization vault, masking & redaction
│   │   ├── llm/            # llama.cpp integration & structured prompt runner
│   │   ├── verification/   # Deterministic claim verification engine
│   │   ├── reports/        # Forensic report & BSA s.63 certificate export
│   │   ├── audit/          # Cryptographic hash-chained audit trail
│   │   └── jobs/           # Background asynchronous job workers
│   ├── tests/              # Unit, integration, and security test suites
│   ├── migrations/         # Database migrations (PostgreSQL scale target)
│   └── .gitignore          # Backend-specific ignore rules
│
├── frontend/
│   ├── src/
│   │   ├── components/     # Reusable UI widgets & design system primitives
│   │   ├── pages/          # Application views (Case, Investigation, Legal, Audit)
│   │   ├── api/            # API client bindings
│   │   ├── types/          # TypeScript domain models & contracts
│   │   └── lib/            # Utilities, formatters & state management
│   └── .gitignore          # Frontend-specific ignore rules
│
├── data/
│   ├── cases/              # Local per-case encrypted databases (gitignored)
│   └── models/             # Local GGUF & transformer weights (gitignored)
│
├── benchmark/              # Benchmark evaluation datasets & test suites
├── scripts/                # Development, setup & data seeding scripts
│
├── docs/                   # System design & architecture specifications
│   ├── PRD.md              # Product Requirements Document (v1.1)
│   ├── DESIGN_SYSTEM.md    # UI / UX Design System specifications
│   ├── ARCHITECTURE.md     # System architecture & security documentation
│   └── DATABASE.md         # Database schema & entity design
│
├── .env.example            # Baseline environment configuration template
├── .gitignore              # Repository gitignore (strict forensics exclusions)
├── README.md               # Repository documentation
└── docker-compose.yml      # Local isolated container configuration
```

---

## 8. Security and Privacy Note

ForensicLens is designed specifically for handling sensitive forensic data and evidentiary material:

- **Local Data Isolation**: Real case databases (`data/cases/*`) and local model weights (`data/models/*`) are strictly excluded from version control via `.gitignore`.
- **Zero Cloud Leakage**: The runtime configuration disables cloud telemetry (`CHROMA_TELEMETRY=false`, `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1`).
- **Loopback Enforcement**: Local development servers and Docker network configurations bind exclusively to `127.0.0.1`.
- **Integrity by Design**: Evidence files must never be modified in-place; all evidence parsing maintains cryptographic hash chains for legal defensibility.

---

## 9. Development Roadmap

- [x] **Phase 0: Project Inception & Foundation**
  - Specification & requirements definition (PRD, Architecture, Database, Design System).
  - Repository scaffold, security policies, and environment setup.
  - Minimal FastAPI backend service with health probes.
- [/] **Phase 1: Ingestion, Evidence Storage & Audit Logging**
  - [x] SQLite + FTS5 per-case database foundation & migration integrity.
  - [x] Content-addressed immutable evidence ingestion & SHA-256 validation.
  - [x] Pluggable parser foundation & OpenSSH authentication log parser.
  - [x] Raw record & normalized event database persistence (ackend/app/parsers/persistence.py).
  - [ ] Additional forensic parsers (syslog, Apache, Windows Event Logs, bash history).
  - [ ] Tamper-evident hash-chained audit logging.
- [ ] **Phase 2: Hybrid Retrieval & Timeline Correlation**
  - SQLite FTS5 lexical indexing.
  - Sentence-transformers embedding generation & ChromaDB vector indexing.
  - RRF fusion and Cross-Encoder reranking pipeline.
  - Sessionization and temporal timeline correlation.
- [ ] **Phase 3: Privacy Gateway & Local LLM Integration**
  - Reversible pseudonymization vault (L1, L2, L3 redaction levels).
  - Local `llama.cpp` integration with GBNF grammar constraints for JSON outputs.
- [ ] **Phase 4: Claim Verification & Indian Legal Mapping**
  - Deterministic claim-to-evidence grounding verification.
  - Indian legal provision ingestion (BNS, BSA s.63, IT Act) and elements-of-offence matching.
  - Anti-forensic indicator detection.
- [ ] **Phase 5: Investigation Workspace & Report Generation**
  - Full React + Vite + Tailwind investigation UI.
  - Automated report builder and Section 63 BSA electronic evidence certificate generation.
- [ ] **Phase 6: Benchmarking & Defense Readiness**
  - ForensicLens-Bench evaluation (retrieval metrics, verification accuracy, injection resistance).
