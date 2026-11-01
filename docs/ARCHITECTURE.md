# ForensicLens Architecture

**Product:** ForensicLens  
**PRD:** Version 1.1  
**Design system:** `docs/DESIGN_SYSTEM.md`  
**Architecture goal:** Ship the P0/Core investigation workflow with the fewest moving parts while making privacy, verification, evidence isolation, offline operation and reproducibility explicit at the seams.

---

## 1. Architecture Principles

1. **Single application first.** Do not introduce microservices unless a measured bottleneck requires them.
2. **Evidence is the source of truth.** Generated text never replaces original evidence.
3. **Retrieval before generation.** The local LLM only receives controlled, bounded context.
4. **Verify rather than trust.** Material claims become findings only after machine verification.
5. **Local-first and offline by construction.** Evidence, indexes, models, vaults and audit records remain inside the investigation environment.
6. **Typed boundaries.** Natural-language input is converted into validated structures; raw SQL and arbitrary tool calls are prohibited.
7. **Evidence text is untrusted data.** It is never treated as model instructions and is rendered as escaped plain text.
8. **Privacy is end-to-end.** Query text, retrieval context, generated claims and verifier references all use the same typed token/vault model.
9. **Case isolation is physical.** Each case owns its evidence, database, vector collection, vault and reports.
10. **Verification is independently trusted.** The LLM proposes typed slots; deterministic application code compiles predicates and performs read-only checks.
11. **Findings are deterministic.** Finding narratives are composed from VERIFIED claims and evidence, never authored by the LLM.
12. **Defer infrastructure that does not help P0.** No Redis, Celery, PostgreSQL, graph database, cloud AI API or distributed deployment initially.

---

# 2. Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React + TypeScript + Vite | Simple SPA matching the PRD and suitable for the investigation workspace. |
| UI | shadcn/ui | Component foundation already defined by the design system. |
| Styling | Tailwind CSS + CSS design tokens | Direct implementation of the design-system token contract. |
| Backend | Python + FastAPI | Keeps parsing, retrieval, ML and verification in one Python runtime. |
| API schemas | Pydantic | Validates every API request, typed query representation and generated result. |
| API contract types | OpenAPI → generated TypeScript types | Prevents frontend/backend schema drift. |
| Structured DB | SQLite + FTS5 | Local zero-server database with full-text search; sufficient for P0. |
| DB encryption | SQLCipher build, validated with FTS5 at setup/CI | Protects the per-case database without adding a database server. |
| Vector DB | ChromaDB, telemetry disabled, explicit precomputed embeddings | Local semantic retrieval without relying on Chroma's default model download path. |
| Embeddings | Sentence Transformers + bundled BGE-family model | Local semantic retrieval with no external inference API. |
| Reranker | Cross-encoder | Improves candidate ranking after hybrid retrieval. |
| Fusion | Reciprocal Rank Fusion (RRF) | Simple hybrid fusion matching the PRD. |
| Local LLM | llama.cpp + bundled GGUF model | Local inference with grammar-constrained JSON output. |
| LLM execution | Single serialized generation context; supervised loopback subprocess is the preferred robust option | Avoids duplicated model memory and isolates an inference crash from the API process. |
| PII detection | Offline NER/rules | Enables L1-L3 pseudonymization without external services. |
| Evidence storage | Per-case content-addressed local filesystem | Preserves immutable originals and enables clean case deletion/export. |
| Integrity | SHA-256 + hash-chained audit + signed report anchor | Detects tampering and makes the audit head externally bindable. |
| Egress control | Python socket audit hook + blocked non-loopback connections + full egress verification | Makes the local network boundary explicit and observable. |
| Transport | HTTP/JSON over loopback TCP/IP | Simple frontend/backend integration with a narrow local API. |
| Tests | Pytest + Vitest + Playwright + axe | Backend, frontend, end-to-end and accessibility coverage. |
| Packaging | Docker Compose or native local run | One-machine deployment without orchestration infrastructure. |
| Dependency supply chain | Pinned versions + hashes + licence manifest | Makes offline/reproducible installation and model licensing auditable. |

### P0 implementation rule

Use **one FastAPI application process** with internal modules. Use **one uvicorn worker**. Long-running work is moved off the event loop to a bounded in-process worker executor. LLM generations are serialized because the selected model context is single-generation at a time.

The application may contain modules named `ingestion`, `retrieval`, `correlation`, `legal`, `privacy`, `llm`, and `verification`, but these communicate through typed Python interfaces/functions rather than network calls.

### Llama.cpp process decision

The preferred P0 implementation runs llama.cpp as a **supervised loopback subprocess** rather than loading the inference engine directly into FastAPI. This gives the model a process boundary so an inference crash does not terminate the API. The exception is explicit: this is a local process boundary, not a networked microservice. The gateway communicates only over a loopback-only IPC/HTTP interface and exposes no external listener.

If packaging constraints make the subprocess impractical for the first implementation, the same gateway interface permits an in-process llama.cpp adapter. The boundary must not change.

---

# 3. System Architecture

```text
                           ┌──────────────────────┐
                           │      React SPA       │
                           │ Investigation UI     │
                           └──────────┬───────────┘
                                      │ loopback HTTP/JSON
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FastAPI Application                                  │
│                                                                             │
│  ┌───────────┐  ┌────────────┐  ┌───────────────────────────────────────┐ │
│  │ Cases/Auth│  │ Ingestion  │  │ Investigation Orchestrator             │ │
│  └───────────┘  └────────────┘  │ query parse → intent route → retrieval │ │
│                                 │ → correlation → legal → privacy → LLM  │ │
│                                 └──────────────────┬────────────────────┘ │
│                                                    │                       │
│             ┌──────────────────────────────────────┼───────────────────┐   │
│             │                                      │                   │   │
│             ▼                                      ▼                   ▼   │
│      ┌──────────────┐                      ┌──────────────┐    ┌──────────┐│
│      │ Retrieval    │                      │ Correlation  │    │  Legal   ││
│      │ SQL/FTS      │                      │ sessions /   │    │ behaviour││
│      │ vector/RRF   │                      │ patterns     │    │ elements ││
│      └──────┬───────┘                      └──────────────┘    └────┬─────┘│
│             │                                                       │      │
│             └───────────────────────┬───────────────────────────────┘      │
│                                     ▼                                      │
│                           ┌────────────────────┐                           │
│                           │ Privacy Gateway    │                           │
│                           │ L0-L3 + query      │                           │
│                           │ + context tokens   │                           │
│                           └─────────┬──────────┘                           │
│                                     │ tokenized prompt                     │
│                                     ▼                                      │
│                           ┌────────────────────┐                           │
│                           │ LLM Gateway        │                           │
│                           │ llama.cpp / GGUF   │                           │
│                           └─────────┬──────────┘                           │
│                                     │ typed claims                         │
│                                     ▼                                      │
│                           ┌────────────────────┐                           │
│                           │ Claim Resolver     │                           │
│                           │ typed slots →      │                           │
│                           │ vault references   │                           │
│                           └─────────┬──────────┘                           │
│                                     │ resolved IDs/values                  │
│                                     ▼                                      │
│                           ┌────────────────────┐                           │
│                           │ Claim Verifier     │                           │
│                           │ compiler-owned     │                           │
│                           │ predicates         │                           │
│                           └─────────┬──────────┘                           │
│                                     │ read-only, case-scoped               │
│                                     ▼                                      │
│                           ┌────────────────────┐                           │
│                           │ Finding Compiler   │                           │
│                           │ VERIFIED claims    │                           │
│                           │ only               │                           │
│                           └────────────────────┘                           │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────────┐
          ▼                     ▼                         ▼
 ┌──────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
 │ Per-case         │  │ Per-case Chroma     │  │ Global legal corpus │
 │ SQLCipher/FTS5   │  │ collection/index    │  │ versioned source     │
 │ events/provenance│  │ evidence embeddings │  │ files + imported DB  │
 │ claims/audit/jobs│  │                     │  │ read-only             │
 └──────────────────┘  └─────────────────────┘  └─────────────────────┘
          │
          ▼
 ┌──────────────────┐
 │ Per-case files   │
 │ raw evidence     │
 │ vault / reports  │
 │ content-addressed│
 └──────────────────┘
```

---

# 4. Case Isolation and Data Layout

Each case is a self-contained directory. There is no global production evidence directory and no global production case database.

```text
<data_root>/cases/<case_id>/
├── case.db                 # SQLCipher + FTS5; case-scoped only
├── evidence/
│   ├── objects/            # content-addressed immutable originals
│   └── manifests/          # upload/hash/parser/provenance metadata
├── chroma/                 # case-local vector collection/index
├── vault/                  # encrypted token ↔ original-value mappings
├── reports/                # generated reports and signed audit anchors
├── exports/                # explicit case exports
└── jobs/                   # optional local job artifacts/checkpoints
```

The global legal corpus is separate:

```text
<data_root>/legal-kb/<version>/
├── source/                 # curated, versioned source files
├── manifests/              # checksums, source metadata, review status
└── imported/               # read-only SQLite/vector indexes derived from source
```

### Case isolation rules

- Every database query includes a case identity established by the connection/session, not by an LLM-generated filter.
- A case service opens only the selected case directory.
- Chroma collection names include the immutable case ID and are never shared between cases.
- Vault keys are case-specific.
- Reports, audit chains and integrity manifests are case-specific.
- Secure deletion removes the complete case directory, its derived indexes and its vault according to the documented deletion procedure.
- Case export is a portable directory/archive containing the evidence manifest, database, vector index, vault package and reports required by the export policy.
- The global legal KB is read-only from the investigation path and is never copied into case evidence storage.

---

# 5. Backend Module Boundaries

```text
app/
├── api/                 # HTTP boundary, auth, CORS, Host validation, rate/size limits
├── cases/               # case lifecycle, case tokens, isolation and key bootstrap
├── ingestion/           # file detection, parser interface, parsing and normalization
├── evidence/            # immutable content-addressed evidence, provenance, hash reverify
├── retrieval/           # SQL, FTS, vector, RRF, reranking, retrieval-unit policy
├── correlation/         # sessions, temporal patterns, timeline, entities
├── behaviour/           # ATT&CK-style behaviour representation
├── legal/               # curated KB import, status, elements and legal retrieval
├── privacy/             # query/context pseudonymization and vault access
├── llm/                 # prompt construction, JSON grammar and llama.cpp gateway
├── verification/        # typed claims, vault resolution, predicate compilation, checks
├── reports/             # deterministic findings/report generation and signed anchor
├── audit/               # canonical hash-chain append and external anchor handling
├── egress/              # socket audit/blocking and full egress verification
├── jobs/                # durable job lifecycle and orphan recovery
└── security/            # upload limits, archive-bomb checks, parser safety helpers
```

The orchestrator coordinates modules but does not contain parser logic, SQL strings, prompt templates, legal rules or predicate definitions.

---

# 6. Frontend Structure

```text
frontend/
├── src/
│   ├── app/             # routing and application shell
│   ├── components/      # shared shadcn/ui-based components
│   ├── features/
│   │   ├── cases/
│   │   ├── investigation/
│   │   ├── evidence/
│   │   ├── verification/
│   │   ├── timeline/
│   │   ├── graph/
│   │   ├── legal/
│   │   ├── integrity/
│   │   ├── audit/
│   │   └── reports/
│   ├── lib/             # API client, formatting, utilities
│   ├── hooks/           # reusable React hooks
│   ├── styles/          # design tokens and global styles
│   └── types/           # generated OpenAPI/domain types
└── public/              # static UI assets only; no models
```

The frontend never accesses SQLite, ChromaDB, raw evidence files, the vault or the LLM directly. It receives escaped display text and structured provenance from the API.

---

# 7. Repository Structure

```text
forensiclens/
├── docs/
│   ├── PRD.md
│   ├── DESIGN_SYSTEM.md
│   └── ARCHITECTURE.md
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── cases/
│   │   ├── ingestion/
│   │   ├── evidence/
│   │   ├── retrieval/
│   │   ├── correlation/
│   │   ├── behaviour/
│   │   ├── legal/
│   │   ├── privacy/
│   │   ├── llm/
│   │   ├── verification/
│   │   ├── reports/
│   │   ├── audit/
│   │   ├── egress/
│   │   ├── jobs/
│   │   └── security/
│   ├── migrations/
│   ├── tests/
│   ├── requirements.txt
│   └── main.py
│
├── frontend/
│   ├── src/
│   ├── tests/
│   ├── package.json
│   └── vite.config.ts
│
├── data/
│   ├── cases/            # isolated case directories
│   ├── legal-kb/         # curated global legal corpus
│   ├── models/           # hash-verified bundled model files
│   └── reports/          # optional non-case export staging
│
├── benchmark/
│   ├── cases/
│   ├── queries/
│   ├── legal/
│   ├── injections/
│   └── scripts/
│
├── scripts/
│   ├── setup/
│   ├── verify_models/
│   ├── egress_test/
│   ├── legal_import/
│   └── benchmark/
│
├── .env.example
├── docker-compose.yml
├── requirements.lock / wheelhouse/
└── README.md
```

`backend/main.py` is the actual entrypoint. The canonical command is:

```text
uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --workers 1
```

No frontend model directory exists.

---

# 8. Most Important Request Flow

The primary user action is:

> Investigator enters a natural-language investigation question and runs an investigation.

Example:

> "Did a successful SSH login occur before a privileged command from the same session?"

## 8.1 Request flow

```text
1. React
   │ POST /api/cases/{case_id}/investigate
   │ { query, privacy_level }
   ▼
2. FastAPI API boundary
   │
   ├── authenticate local token
   ├── validate case ownership
   ├── validate request with Pydantic
   └── create durable job
   ▼
3. Query safety + privacy gateway
   │
   ├── deterministic query parser where possible
   ├── otherwise local LLM query parser behind the same gateway
   ├── tokenize raw identifiers before any generative parsing
   └── produce TypedQueryIR
   ▼
4. Intent router
   │
   ├── SEQUENCE_DETECTION → direct SQLite pattern engine
   │                            └── semantic retrieval only for ranking/context
   └── other intents → structured + FTS + vector retrieval
   ▼
5. Retrieval
   │
   ├── exact/structured constraints → case SQLite
   ├── lexical search → FTS5
   ├── semantic search → case Chroma
   ├── RRF
   └── cross-encoder reranking
   ▼
6. Correlation
   │
   ├── sessions
   ├── timeline reconstruction
   ├── entity relationships
   └── temporal/pattern matching where applicable
   ▼
7. Optional behaviour + legal path
   │
   ├── behaviour representation
   ├── legal retrieval from global curated KB
   ├── legal status validation
   └── element coverage
   ▼
8. Privacy gateway
   │
   ├── tokenize retrieved context
   ├── tokenize command arguments at L3
   └── tokenize the original question used for generation
   ▼
9. Local LLM gateway
   │
   └── grammar-constrained JSON → TypedClaim[]
   ▼
10. Claim slot resolver
    │
    ├── resolve every entity reference through case vault
    ├── validate token exists and type matches slot
    ├── resolve L3 command/path/argument references identically
    └── unknown token → UNVERIFIED (invented-token defense)
    ▼
11. Claim verifier
    │
    ├── compiler-owned predicate for each claim type
    ├── reject incomplete/unchecked slots
    ├── execute through separate read-only DB connection
    ├── enforce case scope + row limit + time limit
    └── VERIFIED / UNVERIFIED / CONTRADICTED
    ▼
12. Finding compiler
    │
    └── deterministic narrative from VERIFIED claims + evidence references
    ▼
13. React
    │
    ├── verified findings
    ├── unverified/rejected claims separately
    ├── claim → predicate trace
    ├── matched evidence IDs
    ├── timeline/provenance
    └── legal context
```

### Query privacy rule

A user query can itself contain PII. Therefore the system must not assume that "the query is just a query". At L1-L3, the raw query is passed through deterministic identifier detection/tokenization before any local generative parsing. A deterministic parser is preferred for common structures. If an LLM is required to interpret ambiguous natural language, it receives the tokenized query through the same narrow LLM gateway.

### Sequence query rule

`SEQUENCE_DETECTION` is a first-class query intent. The pattern engine runs directly over the case's SQLite event/session tables rather than over a top-K retrieval result. Semantic retrieval may rank the resulting matched sequences or provide explanatory context, but it cannot decide which events are eligible for pattern detection.

### Retrieval unit

The canonical indexed unit is the **event** because ingestion produces embeddings at event granularity. Sessions are derived relational views/materialized session records used by correlation. If a session-level semantic index is added later, it is a second index with explicit provenance back to event IDs; it does not replace event-level evidence indexing.

---

# 9. Typed Claims and Verification

The LLM does **not** emit executable predicates. It emits only a constrained typed claim representation.

Example shape:

```json
{
  "claim_id": "C1",
  "claim_type": "AUTH_THEN_COMMAND",
  "slots": {
    "user": {"entity_type": "USER", "token": "USER_001"},
    "src_ip": {"entity_type": "IP", "token": "IP_002"},
    "auth_event": {"event_id": "EV-00129"},
    "command_event": {"event_id": "EV-00131"}
  },
  "temporal_relation": "BEFORE",
  "evidence_refs": ["EV-00129", "EV-00131"]
}
```

The verifier owns the meaning of `AUTH_THEN_COMMAND`. For example, it may compile that claim type into a parameterized query requiring:

- the referenced authentication event exists in this case;
- it is a successful authentication event;
- the referenced command event exists in this case;
- the resolved user/IP/session slots match the events;
- the authentication timestamp precedes the command timestamp;
- all mandatory slots are present and checked.

A weak LLM predicate such as `"any success exists"` is impossible because predicates are not model-authored.

### Vault resolution

```text
LLM token USER_001
        ↓
Claim slot resolver
        ↓
Case vault lookup
        ├── found + type matches → canonical value/reference
        └── missing/mismatched → UNVERIFIED
```

This applies equally to:

- usernames
- email addresses
- IP addresses
- hostnames
- paths
- command arguments
- other L3-sensitive values

An unknown or invented token can never be silently treated as a real entity.

### Verification invariants

1. Every claim type has a compiler-owned verifier.
2. Every mandatory slot must be resolved and checked.
3. Every event reference must belong to the current case.
4. Every predicate uses parameterized SQL generated by trusted code.
5. Verification uses a separate read-only database connection.
6. Queries have a mandatory case scope, row limit and execution timeout.
7. No finding is generated from UNVERIFIED or CONTRADICTED claims.
8. Verification output includes the exact evidence IDs and predicate definition/version used.

### Finding narrative

The LLM never writes the final finding narrative. The finding compiler uses templates and verified fields, for example:

```text
Verified finding:
A successful SSH authentication for USER_001 from IP_002 occurred at
2026-09-27T10:01:22Z, followed by the referenced privileged command event
at 2026-09-27T10:03:10Z in the same verified session.
```

The UI may separately show the model's proposed claim and its verification status, but only deterministic verified output enters the Findings section.

---

# 10. Investigation Job Lifecycle and Concurrency

```text
POST /api/cases/{case_id}/investigate
        │
        ▼
     JOB-123
        │
        ├── queued
        ├── parsing_query
        ├── retrieving
        ├── correlating
        ├── mapping_legal
        ├── pseudonymizing
        ├── generating
        ├── verifying
        └── completed / failed / orphan_recovered
```

### Runtime rules

- Run **one uvicorn worker**. Multiple workers would duplicate model memory and split the in-process job queue.
- Use SQLite WAL mode and a configured busy timeout.
- CPU-bound parsing, embedding, reranking and other heavy work must run outside the async event loop using a bounded executor/process pool as appropriate.
- Serialize LLM generation through a single model-generation lock/queue.
- Persist job state transitions in SQLite so a process restart can identify orphaned `running` jobs.
- On startup, mark stale running jobs as `orphan_recovered` and either safely retry idempotent stages or fail them with a recovery reason.
- Job ownership is checked on every `GET /api/cases/{case_id}/jobs/{job_id}` request.

### Progress order

1. Query parsed
2. Structured + semantic retrieval, or direct pattern execution for sequence intent
3. Fusion/reranking where applicable
4. Session/timeline correlation
5. Behaviour mapping
6. Legal mapping
7. Pseudonymization
8. Local generation
9. Claim slot resolution
10. Claim verification
11. Finding compilation

Do not display fake percentage progress when exact progress cannot be measured.

---

# 11. Core API Boundary

All case-bound endpoints require:

- `case_id` in the path
- local authentication token
- validated JSON request
- case ownership check

Canonical P0 routes:

```text
POST   /api/cases
GET    /api/cases/{case_id}

POST   /api/cases/{case_id}/evidence
GET    /api/cases/{case_id}/evidence
POST   /api/cases/{case_id}/evidence/{evidence_id}/verify-hash

POST   /api/cases/{case_id}/investigate
GET    /api/cases/{case_id}/jobs/{job_id}

GET    /api/cases/{case_id}/events/{event_id}
GET    /api/cases/{case_id}/timeline

GET    /api/cases/{case_id}/claims
GET    /api/cases/{case_id}/claims/{claim_id}/verification

POST   /api/cases/{case_id}/legal/search
GET    /api/cases/{case_id}/legal/{legal_id}
POST   /api/cases/{case_id}/legal/map

GET    /api/cases/{case_id}/integrity
GET    /api/cases/{case_id}/audit
GET    /api/cases/{case_id}/health
GET    /api/cases/{case_id}/privacy
PUT    /api/cases/{case_id}/privacy
GET    /api/cases/{case_id}/egress

POST   /api/cases/{case_id}/index/rebuild
POST   /api/cases/{case_id}/reports
```

`/api/investigate` is intentionally removed. The canonical investigation route is `/api/cases/{case_id}/investigate`.

The job route is case-scoped so authorization is part of routing and the handler can verify that the job belongs to the requested case.

The dashboard uses `/health`, `/privacy`, `/integrity`, parser-coverage data and `/egress` to show operational status.

---

# 12. Environments

## Development

Purpose: active implementation.

```text
Browser → Vite → FastAPI (127.0.0.1)
                    ├── case-local SQLCipher
                    ├── case-local Chroma
                    ├── local evidence
                    └── local GGUF
```

Characteristics:

- hot reload enabled
- synthetic/test datasets allowed
- logs are structured but never contain raw evidence, prompts or vault values
- deterministic model mode available
- external AI APIs forbidden

## Evaluation

Purpose: reproducible experiments.

```text
Fixed benchmark data
        ↓
Pinned source/dependencies/models
        ↓
Deterministic configuration
        ↓
Metrics + CIs + artifacts
```

Characteristics:

- fixed seeds
- fixed model hashes
- fixed prompt versions
- recorded hardware, thread count and backend build
- controlled datasets
- outbound network blocked
- exact retrieval mode where required for repeatability

## Demo / production-like local deployment

Purpose: final project demonstration.

- single machine
- loopback-only API
- strict Host/CORS validation
- local authentication token
- case-isolated data
- no cloud dependency
- prebuilt image or offline wheelhouse

---

# 13. Deployment and Local Attack Surface

## Preferred deployment

Use a single-machine Docker Compose deployment or native run.

### Native

```text
uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --workers 1
npm run dev -- --host 127.0.0.1
```

### Docker Compose

Only the application container is required initially. Persistent data is mounted under the application data root. The Docker network is marked `internal`; published ports bind to `127.0.0.1` only.

No separate containers are created for SQLite, ChromaDB or llama.cpp.

### Local API security

A localhost API is still an attack surface because arbitrary websites can attempt requests to loopback services. Therefore:

- bind the API to `127.0.0.1`, never `0.0.0.0` by default;
- require an unpredictable local API token on every mutating and case-sensitive request;
- validate the HTTP `Host` header against the local allowlist;
- use strict CORS with the exact development/prod frontend origins;
- do not enable wildcard CORS or credentialed wildcard origins;
- limit upload sizes and request bodies;
- reject unexpected content types;
- expose no debug endpoints in demo builds.

### Upload security

Before parsing an upload:

1. enforce a maximum byte size;
2. stream to a temporary file rather than trusting the client filename;
3. hash before parsing;
4. detect archives by content, not extension;
5. enforce maximum archive depth, entry count and expanded size;
6. reject path traversal and symlink entries;
7. keep extracted content inside a case-local temporary directory;
8. use regex-safe parser patterns and parser timeouts/budgets;
9. retain unparsed lines rather than executing unknown content.

### Evidence rendering

Evidence is plain text only. HTML, scripts, terminal escape sequences and markup-like content are escaped/sanitized before UI display and report generation. Report generators must never concatenate raw evidence into HTML without escaping.

### Logging policy

Never log:

- raw evidence text;
- raw prompts or generated private context;
- vault values;
- unredacted command arguments at L3;
- authentication tokens;
- full PII values.

Logs may contain event IDs, case IDs, hashes, status codes, durations and redacted error metadata.

---

# 14. Offline and Egress Controls

Offline mode is enforced at multiple layers rather than by a single environment flag.

Required environment configuration:

```text
HF_HUB_OFFLINE=1
TRANSFORMERS_OFFLINE=1
ANONYMIZED_TELEMETRY=False
FORENSICLENS_TELEMETRY=false
```

Chroma must receive **explicit precomputed embeddings**. Do not rely on its default embedding function because it may attempt to download a model on first use.

### Network policy

- Docker network: `internal: true`.
- Published ports: loopback only.
- No runtime package/model downloads.
- Models are preloaded and hash-verified.
- Legal KB is imported from curated local files.

### Python egress hook

Install an application-level audit hook around `socket.connect` that:

- allows loopback connections required by the application;
- blocks non-loopback connections;
- records a redacted event containing timestamp, destination class and caller component;
- never records secrets or raw evidence.

This hook covers the Python process only. It is not presented as proof that the entire host is offline.

The UI therefore distinguishes:

- **Egress blocked** — application-level policy currently blocking non-loopback connects.
- **Last full egress verification:** timestamp of the most recent end-to-end test that confirmed the expected deployment has no outbound network path.

The previous ambiguous `NETWORK DETECTED` state is not used.

---

# 15. Encryption and Key Management

### Case database

Use a SQLCipher-compatible SQLite build and **test FTS5 functionality in CI and setup verification** before treating SQLCipher as supported. If the selected SQLCipher build cannot provide reliable FTS5 support, the implementation must fail setup rather than silently downgrade to plaintext SQLite.

### Vault

The vault is encrypted with a case-specific key derived from an investigator-provided passphrase using **Argon2id** with parameters recorded in the case metadata. The application never stores the passphrase.

At startup/open-case:

```text
passphrase
   ↓
Argon2id KDF
   ↓
case encryption key
   ├── SQLCipher database key
   └── vault encryption key derivation
```

Use domain separation when deriving multiple keys from the passphrase-derived root.

### Chroma

Chroma does not provide the same native encryption boundary as SQLCipher. Chroma state therefore relies on **OS/filesystem or encrypted-volume protection** and strict case-directory permissions. The case-local Chroma directory is never exposed directly to the frontend.

### Model files

Models are integrity-checked with SHA-256 and protected by filesystem permissions. Their licence and provenance are recorded in the dependency/model manifest.

---

# 16. Retrieval and Sequence Architecture

## Normal investigation retrieval

```text
TypedQueryIR
 ├── structured constraints → SQLite
 ├── lexical terms          → FTS5
 └── semantic query         → Chroma
             ↓
            RRF
             ↓
      Cross-encoder reranker
             ↓
       ranked event IDs
```

The retrieval result always resolves back to canonical event IDs and provenance records.

## Sequence investigation retrieval

```text
TypedQueryIR(intent=SEQUENCE_DETECTION)
                 ↓
       deterministic pattern engine
                 ↓
       SQLite case-wide scan
                 ↓
        matched event sequences
                 ↓
   optional semantic ranking/context
```

This prevents top-K retrieval from dropping a necessary earlier event before the sequence matcher sees it.

### Retrieval unit

- **Evidence index:** event-level embeddings.
- **Relational correlation:** session-level derived records.
- **Pattern engine:** event/session tables over the full case.
- **Optional future session index:** separate index with event-level provenance.

### Determinism

For small corpora and benchmark runs where exact repeatability matters, support an exact vector-search mode. HNSW approximate search remains the normal scalable mode, but its parameters and search configuration are recorded because approximate nearest-neighbour ordering can vary.

---

# 17. Evidence Integrity and Anti-Forensic Checks

Integrity is a P0/Core capability, not a later enhancement.

At ingestion and investigation time the evidence subsystem checks, where applicable:

- SHA-256 content hash;
- immutable content-addressed object identity;
- log gaps;
- timestamp reversals;
- clock skew indicators;
- truncated files;
- rotated-log discontinuities;
- provenance continuity;
- byte offsets and line numbers;
- parser coverage and unparsed-line counts.

### Exact provenance

Each canonical event stores:

```text
source_file_id
byte_offset_start
byte_offset_end
line_number_start
line_number_end
original_encoding
original_timestamp
normalized_timestamp_utc
timestamp_confidence
evidence_hash
```

Byte offsets are required so the viewer can return the exact raw record despite CRLF differences or encoding transformations.

### Parser and Event Processing Pipeline

The ingestion and normalization flow guarantees bit-level traceability from raw evidence through retrieval:

```text
Evidence Ingestion (objects/<evidence_id>)
        ↓
Parser Selection (ParserRegistry)
        ↓
Raw Records (raw_records with byte_start / byte_end)
        ↓
Normalized Events (events with forensic attributes)
        ↓
Timeline / Session Correlation
        ↓
Retrieval (SQL, FTS5, Vector)
```

See [`docs/PARSERS.md`](PARSERS.md) for the complete parser subsystem architecture, interface definitions, and OpenSSH normalization rules.

### Immutability

Original evidence objects are content-addressed by hash, stored read-only after ingestion, and never edited in place. Normalized events are derived data and contain a pointer to the immutable evidence object/provenance range.

### Hash re-verification

The API exposes an explicit evidence hash re-verification action. It recomputes the content hash from the immutable object and compares it with the recorded hash, writing the result to the audit chain.

---

# 18. Legal Corpus Source of Truth

The legal corpus is not an informal metadata cache.

```text
Curated legal source files
        ↓
review/diff/version
        ↓
checksums + manifest
        ↓
importer
        ↓
read-only SQLite corpus + Chroma index
```

The source of truth is the **curated, versioned legal corpus files and manifest**. SQLite and Chroma are derived stores.

Each legal corpus version records:

- source document;
- Act/provision identity;
- effective/status metadata;
- source checksum;
- corpus version;
- reviewer/status metadata;
- import timestamp;
- importer version.

A legal reviewer can diff corpus versions before import. Chroma is only an index and can be rebuilt from the curated files.

---

# 19. Audit and Reproducibility

Every material investigation run records:

- case ID;
- investigation ID;
- query and privacy level, stored according to privacy policy;
- model name and model file hash;
- embedding model hash;
- reranker model hash;
- llama.cpp build/version and build hash where available;
- backend/app commit;
- Python/runtime version;
- parser versions;
- NER/rules versions;
- legal KB version and source manifest hash;
- prompt-template version;
- generation parameters;
- deterministic-mode state;
- backend thread count;
- top-K values;
- RRF `k`;
- Chroma/HNSW parameters;
- retrieval mode (approximate/exact);
- verification rule/predicate versions;
- hardware/VRAM/RAM information where relevant.

### Canonical audit serialization

Audit records use canonical serialization with stable field ordering and normalized encoding. Appends are serialized with a single writer/lock.

### Anchoring

The audit chain head is not trusted merely because it sits beside the case data. Every generated report records the audit-chain head hash and includes a signature using a locally protected signing key where configured.

This creates a verifiable report-level anchor outside the chain records themselves.

The audit chain is an integrity mechanism, not a claim of court admissibility.

---

# 20. Boundaries: What May Call What

| Caller | May call | Must not call |
|---|---|---|
| React | FastAPI API | DB, filesystem, vault, model |
| API | auth, case, job, investigation services | arbitrary module internals from request data |
| Ingestion | filesystem, parser interface, case DB | LLM, external network |
| Retrieval | case DB/FTS, case Chroma, reranker | vault values unless resolving through privacy service |
| Correlation | case DB, retrieval results | LLM |
| Legal | curated legal corpus, derived legal DB/index | case evidence mutation |
| Privacy | case vault, offline NER/rules | external identity/PII service |
| LLM Gateway | local llama.cpp subprocess | DB, filesystem outside model IPC, shell, network |
| Claim Resolver | typed claims, case vault | arbitrary vault access from model text |
| Verifier | verifier-owned predicates, separate read-only DB connection | write connections, model calls, arbitrary SQL |
| Finding Compiler | VERIFIED claims + evidence references | raw model narrative |
| Reports | verified application state, escaped evidence text, audit anchor | raw unescaped evidence HTML |
| Audit | canonical audit records, signing key | raw evidence/prompt logging |
| Egress monitor | socket policy/audit | external destinations |

### Forbidden flows

```text
LLM → SQLite
LLM → ChromaDB
LLM → filesystem
LLM → shell
LLM → arbitrary HTTP
LLM → arbitrary Python
LLM → predicate authoring

Natural-language query → raw SQL
Natural-language query → external service
Evidence text → model instruction
Frontend → database directly
Frontend → model directly
Application → external AI API
Verifier → writable DB
Finding compiler → unverified claim
```

---

# 21. Read-Only Verification Enforcement

The verifier uses a distinct read-only connection opened against the selected case database.

Enforcement layers:

1. **Connection-level read-only mode** where supported by the database/runtime.
2. **Dedicated verifier DB user/credential** when the selected SQLCipher/SQLite deployment permits meaningful separation.
3. **Application-level write prohibition**: verifier module receives no write-capable repository object.
4. **Mandatory case scope** injected by the repository layer, not by the claim.
5. **Parameterized SQL only** from compiler-owned templates.
6. **Row limit** on every verification query.
7. **Execution timeout/budget** on every verification query.
8. **No schema mutation** capability in the verifier package.
9. **Audit of predicate version and evidence IDs**, not raw SQL containing PII.

If a claim cannot be compiled into a complete, bounded, compiler-owned predicate, its status is `UNVERIFIED`.

---

# 22. Environments, Dependencies and Supply Chain

Dependencies are pinned with hashes. The project maintains an offline-installable wheelhouse or prebuilt container image.

The build manifest records:

- Python packages and hashes;
- npm packages and lockfile integrity;
- OS/base-image version;
- llama.cpp build;
- embedding/reranker model identifiers and hashes;
- GGUF model identifier/hash;
- model licences and redistribution permissions;
- legal corpus source licences/terms.

The setup process verifies model hashes and dependency integrity before opening a case.

No runtime installation or model download is permitted.

---

# 23. Testing Strategy

The test strategy is part of the architecture because several boundaries are security and correctness boundaries.

### Backend

- unit tests for parser interfaces and canonical normalization;
- labelled claim/verifier tests covering VERIFIED, UNVERIFIED and CONTRADICTED claims;
- invented-token tests proving missing vault references become UNVERIFIED;
- L3 command/path token resolution tests;
- SQL predicate compiler tests proving mandatory slots are checked;
- read-only verifier tests proving writes are impossible;
- case-isolation tests;
- hash re-verification tests;
- anti-forensic/integrity tests;
- audit-chain canonicalization/anchoring tests;
- egress blocking tests;
- upload size/archive-bomb/path-traversal tests;
- parser fuzzing;
- injection corpus regression tests.

### Frontend

- Vitest unit tests;
- Playwright end-to-end tests;
- axe accessibility checks;
- keyboard/screen-reader relationship-table tests;
- generated OpenAPI TypeScript types checked into CI.

### Benchmark

The benchmark harness is P0/Core and runs the PRD evaluation suite:

- retrieval metrics;
- query execution precision/recall/F1;
- timeline/sequence accuracy;
- legal Recall@K/MRR/nDCG and element coverage;
- citation/claim grounding metrics;
- prompt-injection attack success rate;
- latency/resource metrics;
- reproducibility checks;
- bootstrap confidence intervals;
- paired significance tests where applicable;
- inter-annotator agreement for labelled evaluation sets.

---

# 24. Decision Log

## ADR-001 — Single FastAPI application

**Decision:** Use one FastAPI backend with internal modules.

**Reason:** P0/Core is achievable without service decomposition. Separate services would add deployment, networking, authentication and observability complexity.

**Revisit when:** independently scaling components or distributed execution becomes a measured requirement.

---

## ADR-002 — SQLite + FTS5 for P0

**Decision:** Use per-case SQLite with FTS5, encrypted using a validated SQLCipher build.

**Reason:** Local, zero-server, case-isolated storage matches the offline-first PRD.

**Revisit when:** concurrency or dataset scale requires PostgreSQL.

---

## ADR-003 — ChromaDB remains local and case-scoped

**Decision:** Use case-local ChromaDB with telemetry disabled and explicit precomputed embeddings.

**Reason:** Semantic retrieval without another server, while avoiding runtime model downloads.

**Revisit when:** vector scale/concurrency makes another index materially necessary.

---

## ADR-004 — llama.cpp + GGUF behind a gateway

**Decision:** Keep all model access behind a typed LLM gateway and serialize generations.

**Reason:** Constrained JSON, local execution and a hard security boundary.

**Revisit when:** model quality or hardware constraints require another local runtime.

---

## ADR-005 — Supervised loopback llama.cpp subprocess

**Decision:** Prefer a supervised local subprocess for inference, with the gateway communicating only over loopback/IPC.

**Reason:** A model crash should not terminate FastAPI. This is an explicit local-process exception to the single-process application principle, not a networked microservice.

**Revisit when:** process isolation becomes operationally harder than in-process inference or the selected runtime provides a safer embedded boundary.

---

## ADR-006 — No Redis/Celery initially

**Decision:** Use a durable SQLite job record plus an in-process worker/executor.

**Reason:** The product is single-node and local. A broker adds infrastructure without helping P0.

**Revisit when:** jobs must run concurrently across workers/machines or require durable distributed execution.

---

## ADR-007 — No graph database

**Decision:** Store entities/relationships in SQLite.

**Reason:** The P0 graph is for correlation and visualization; graph-augmented retrieval is stretch scope.

**Revisit when:** graph-native multi-hop retrieval becomes a required feature.

---

## ADR-008 — LLM has no tool/database access

**Decision:** LLM receives bounded context and returns typed claims only.

**Reason:** Prevents arbitrary SQL, filesystem, shell and network access and makes prompt injection less powerful.

**Revisit when:** a separately isolated tool-execution architecture is proven necessary and independently sandboxed.

---

## ADR-009 — Compiler-owned predicates

**Decision:** The LLM cannot author executable predicates. Claim types are mapped to verifier-owned predicate compilers.

**Reason:** A weak predicate must not be able to make a claim pass verification.

**Revisit when:** a formal policy language is introduced and can be independently validated.

---

## ADR-010 — L2 is the default privacy level

**Decision:** Default investigation inference to L2; L0 requires explicit confirmation.

**Reason:** Practical privacy/utility balance.

**Revisit when:** evaluation demonstrates another level is safer without unacceptable investigation loss.

---

## ADR-011 — Case-local storage

**Decision:** Every case has its own DB, Chroma collection, evidence objects, vault and reports.

**Reason:** Strong isolation, portable exports and clean secure deletion.

**Revisit when:** multi-user shared-case operation becomes a required product capability.

---

## ADR-012 — Versioned legal corpus is the source of truth

**Decision:** Curated versioned legal files/manifests are authoritative; SQLite/Chroma are derived indexes.

**Reason:** Legal reviewers need diffable source material and reproducible imports.

**Revisit when:** an external authoritative legal-data integration is formally approved and can preserve versioning/provenance.

---

## ADR-013 — No runtime downloads

**Decision:** Bundle and hash-verify models and dependencies; use an offline wheelhouse/prebuilt image.

**Reason:** Prevents accidental egress and makes evaluation reproducible.

**Revisit when:** a controlled enterprise update mechanism is introduced with explicit network policy.

---

## ADR-014 — Exact vector mode for reproducibility

**Decision:** Support exact vector search for small benchmark corpora; use HNSW for normal scale.

**Reason:** HNSW is approximate and can affect ordering; benchmark repeatability needs a deterministic option.

**Revisit when:** corpus size makes exact mode impractical for the evaluation workload.

---

# 25. P0/Core Boundary

### Must ship

```text
Case creation/isolation
    ↓
Secure evidence upload + size/archive checks
    ↓
SHA-256 + immutable content-addressed storage
    ↓
Parsing + canonical normalization + byte-offset provenance
    ↓
Integrity / anti-forensic checks
    ↓
Per-case SQLCipher/FTS5
    +
Per-case Chroma index
    ↓
Query privacy/tokenization
    ↓
Intent routing
    ├── sequence → case-wide pattern engine
    └── normal → hybrid retrieval + RRF + reranking
    ↓
Session/timeline correlation
    ↓
Legal retrieval + status/element coverage
    ↓
L2 pseudonymization
    ↓
Local LLM typed claims
    ↓
Vault slot resolution
    ↓
Compiler-owned predicates
    ↓
Read-only, case-scoped verification
    ↓
Deterministic verified findings
    ↓
Evidence/provenance UI
    ↓
Hash-chain audit + report anchor
    ↓
Hash re-verification action
    ↓
Benchmark harness + security regression tests
    ↓
Reproducible report
```

### Core security/operational requirements

- loopback-only API;
- strict CORS and Host checks;
- local authentication token;
- offline environment flags;
- application egress blocking and last-full-egress-verification timestamp;
- case isolation;
- encrypted DB/vault with explicit key derivation;
- one uvicorn worker;
- serialized LLM generation;
- orphan-job recovery;
- no raw evidence/prompt/vault logging;
- dependency/model licence and hash verification.

### Do not build before the above works

- full EVTX ingestion;
- PCAP ingestion;
- distributed deployment;
- enterprise SIEM/SOAR integration;
- full dual-LLM quarantine;
- graph-augmented retrieval;
- advanced causal reasoning;
- hypothesis engine;
- Hindi/Hinglish query support;
- multi-user RBAC.

---

# 26. Architecture Success Criterion

A clean local installation must execute this complete path without external AI services:

```text
Create/open isolated case
      ↓
Upload evidence safely
      ↓
Preserve + hash + provenance
      ↓
Integrity/anti-forensic checks
      ↓
Parse + normalize
      ↓
Index case-local stores
      ↓
Tokenize query / parse safely
      ↓
Intent route
      ├── sequence → deterministic full-case pattern scan
      └── normal → hybrid retrieval
      ↓
Correlation
      ↓
Legal context where applicable
      ↓
Pseudonymize query + evidence context
      ↓
Local LLM
      ↓
Typed atomic claims
      ↓
Vault token resolution
      ↓
Compiler-owned predicates
      ↓
Read-only case-scoped verification
      ↓
Verified / Unverified / Contradicted
      ↓
Deterministic findings
      ↓
Evidence provenance
      ↓
Audit-chain anchor
      ↓
Hash re-verification
      ↓
Benchmark/reproducibility artifacts
      ↓
Report
```

The core architectural principle remains:

> **The system may assist with reasoning, but evidence remains the source of truth.**
