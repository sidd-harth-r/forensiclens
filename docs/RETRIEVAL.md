# ForensicLens — Hybrid Forensic Retrieval Engine Architecture

## 1. Overview

The **Hybrid Forensic Retrieval Engine** (Step 7) is an offline-first, verifiable search engine designed specifically for digital forensics investigations. It retrieves and ranks relevant evidence records by combining:

1. **Lexical Retrieval** via SQLite FTS5 (`raw_records_fts` and `events_fts`).
2. **Dense Semantic Retrieval** via local BGE sentence embeddings (`BAAI/bge-small-en-v1.5`) and case-isolated ChromaDB collections.
3. **Reciprocal Rank Fusion (RRF)** to combine ranked candidate lists without artificial score normalization artifacts.
4. **Cross-Encoder Reranking** via local cross-attention scoring (`BAAI/bge-reranker-base`) over the top fused candidate pool.

All retrieval processes run locally on-device. No cloud APIs, external inference endpoints, or LLM-based hallucination paths are used.

---

## 2. Retrieval Unit & Provenance Guarantee

In ForensicLens, the primary retrieval unit is an **evidence-backed source record** (`RetrievalDocument`), corresponding directly to an individual line in `raw_records` joined with its normalized event from `events` (if parsed) and file metadata from `evidence_files`.

### Exact Provenance Invariant
```text
Retrieval Result → Raw Record (`raw_record_id`) → Evidence File (`evidence_id`) → Original Source Line (`line_number`, `byte_start`, `byte_end`)
```

### Retrieval Document Schema
Each retrieval candidate contains:
- `document_id`: Deterministic unique identifier: `DOC_{case_id}_{raw_record_id}`
- `raw_record_id`: Primary key in `raw_records` (e.g., `RAW_EV_..._1829`)
- `event_id`: Primary key in `events` (e.g., `EVT_EV_..._1829`), or `None` if unparsed
- `evidence_id`: Associated evidence artifact identifier
- `original_filename`: Original filename (e.g., `auth.log`)
- `record_no`: 1-based sequential line index in the original file
- `line_number`: Physical line number
- `byte_start` & `byte_end`: Exact byte slice in the immutable evidence file
- `text`: Original raw log string (escaped, unmodified)
- `timestamp`: UTC normalized timestamp or original source timestamp
- `event_type`: Normalized event category (e.g., `AUTH_FAILURE`, `AUTH_SUCCESS`, `SESSION_OPENED`)
- `severity`: Severity classification (`INFO`, `WARNING`, `ERROR`, `CRITICAL`)
- `user`: Extracted actor/username
- `src_ip`: Source IP address

### Unparsed Line Retrieval
Because evidence files frequently contain non-standard or corrupt lines that parsers cannot normalize into structured events, the retrieval engine treats raw records as first-class citizens:
- Lines that fail to parse into structured events are retained in `raw_records` with `parse_status='UNPARSED'`.
- Both `raw_records_fts` and the semantic vector store index these lines.
- Unparsed lines are fully discoverable and retain exact byte provenance.

---

## 3. End-to-End Retrieval Data Flow

```text
                                  Investigator Query
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
       Branch A: Lexical Search                       Branch B: Semantic Search
       (SQLite FTS5 parameterized)                     (Local BGE-small-en-v1.5)
                  │                                               │
         `raw_records_fts`                               Precomputed Vector
                 +                                                │
           `events_fts`                                   Case ChromaDB Collection
                  │                                     (`data/cases/<id>/chroma`)
                  │                                               │
        Lexical Candidates (Top 50)                    Semantic Candidates (Top 50)
                  │                                               │
                  └───────────────────────┬───────────────────────┘
                                          ▼
                             Branch C: Fusion Engine
                         (Reciprocal Rank Fusion, k=60)
                                          │
                                 Merged Candidates
                                          │
                                          ▼
                            Branch D: Cross-Encoder Reranker
                               (BAAI/bge-reranker-base)
                                          │
                                          ▼
                           Provenance-Enriched Output (Top K)
```

---

## 4. Subsystems

### 4.1 Lexical Retrieval (SQLite FTS5)
- **Tables**: `raw_records_fts` (Migration 002) and `events_fts` (Migration 001).
- **Triggers**: Migration 002 creates `raw_records_ai`, `raw_records_ad`, and `raw_records_au` to ensure zero drift between `raw_records` and the FTS index.
- **Sanitization**: `sanitize_fts5_query()` parses user queries, preserves quoted phrases, extracts IP addresses as quoted tokens (preventing syntax errors on dots), and escapes FTS5 operators (`:`, `*`, `^`, `NOT`, `OR`, `AND`).
- **Structured Filtering**: Supports parameterized filtering on `event_type`, `severity`, `user`, `src_ip`, `evidence_id`, and ISO 8601 time windows.

### 4.2 Dense Semantic Retrieval & Local Embeddings
- **Default Model**: `BAAI/bge-small-en-v1.5` (384-dimensional dense vectors, normalized for cosine similarity).
- **Offline Enforcement**: `local_files_only=True` prevents network egress. If weights are missing, raises `ModelNotReadyError` with clear provisioning guidance.
- **Test Doubles**: `FakeEmbeddingModel` generates deterministic 384-dimensional vectors via rolling cryptographic hashes, enabling fast unit tests with zero network or GPU dependencies.
- **ChromaDB Storage**: Persisted under `data/cases/<case_id>/chroma/`.
- **Precomputed Embeddings**: Embeddings are calculated explicitly by `BaseEmbeddingModel`; Chroma's default automatic download path is disabled.
- **Telemetry**: Chroma telemetry is explicitly disabled (`anonymized_telemetry=False`).
- **Incremental Indexing**: Uses `get_indexed_document_ids()` to avoid re-embedding existing records. Supports complete collection rebuilds via `rebuild=True`.

### 4.3 Reciprocal Rank Fusion (RRF)
Fuses distinct ranking signals without arbitrary score normalization:

$$RRF(d) = \sum_{m \in \{\text{lexical}, \text{semantic}\}} \frac{1}{k + \text{rank}_m(d)}$$

- Default smoothing constant: $k = 60$.
- Preserves `lexical_rank` and `semantic_rank` alongside `rrf_score`.
- Deterministic tie-breaking:
  1. Descending RRF score
  2. Ascending lexical rank
  3. Ascending semantic rank
  4. Ascending `document_id`

### 4.4 Cross-Encoder Reranking
- **Default Model**: `BAAI/bge-reranker-base`.
- Operates on a bounded candidate set (default: 30 candidates) from RRF.
- Scores `(query, document_representation)` pairs using full transformer cross-attention.
- Reranked candidates are sorted descending by score; candidates beyond the cutoff retain relative RRF order.

---

## 5. Retrieval Modes (For Ablation Studies)

The engine supports 4 independently selectable modes:

| Mode | Lexical | Semantic | Fusion (RRF) | Reranker | Purpose |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `KEYWORD_ONLY` | Yes | No | No | No | Exact token and keyword lookup; baseline comparison |
| `SEMANTIC_ONLY` | No | Yes | No | No | Pure conceptual/semantic vector search |
| `HYBRID` | Yes | Yes | Yes | No | Fused lexical and semantic search without reranking overhead |
| `HYBRID_RERANKED` | Yes | Yes | Yes | Yes | Full pipeline with cross-encoder precision |

---

## 6. API Reference

### 6.1 Check Retrieval & Model Status
`GET /api/cases/{case_id}/retrieval/status`

**Response (200 OK):**
```json
{
  "caseId": "CASE-2026-001",
  "totalRecords": 1829,
  "indexedRecords": 1829,
  "isIndexed": true,
  "indexStatus": "READY",
  "embeddingModel": "BAAI/bge-small-en-v1.5",
  "rerankerModel": "BAAI/bge-reranker-base",
  "embeddingModelReady": true,
  "rerankerModelReady": true,
  "offlineMode": true,
  "lastIndexedAt": "2026-11-08T01:30:00Z"
}
```

### 6.2 Index or Rebuild Case Collection
`POST /api/cases/{case_id}/retrieval/index`

**Request:**
```json
{
  "rebuild": false,
  "batchSize": 32
}
```

**Response (200 OK):**
```json
{
  "caseId": "CASE-2026-001",
  "indexedCount": 45,
  "totalIndexed": 1829,
  "status": "COMPLETED",
  "message": "Successfully indexed 45 new records. Total indexed: 1829."
}
```

### 6.3 Perform Hybrid Search
`POST /api/cases/{case_id}/retrieval/search`

**Request:**
```json
{
  "query": "failed password for invalid user from public IP",
  "mode": "HYBRID_RERANKED",
  "topK": 10,
  "lexicalCandidates": 50,
  "semanticCandidates": 50,
  "rerankCandidates": 30,
  "filters": {
    "eventType": "AUTH_FAILURE",
    "severity": "WARNING"
  }
}
```

**Response (200 OK):**
```json
{
  "items": [
    {
      "documentId": "DOC_CASE-2026-001_RAW_EV_1_42",
      "rawRecordId": "RAW_EV_1_42",
      "eventId": "EVT_EV_1_42",
      "evidenceId": "EV_1",
      "originalFilename": "auth.log",
      "recordNo": 42,
      "lineNumber": 42,
      "byteStart": 1420,
      "byteEnd": 1528,
      "text": "Jan 15 10:20:30 server sshd[1234]: Failed password for invalid user hacker from 192.168.1.100 port 55432 ssh2",
      "timestamp": "2026-01-15T10:20:30Z",
      "eventType": "AUTH_FAILURE",
      "severity": "WARNING",
      "user": "hacker",
      "srcIp": "192.168.1.100",
      "lexicalRank": 1,
      "semanticRank": 2,
      "rrfScore": 0.0325,
      "rerankScore": 0.9412,
      "finalRank": 1
    }
  ],
  "total": 1,
  "retrievalMode": "HYBRID_RERANKED",
  "query": "failed password for invalid user from public IP",
  "caseId": "CASE-2026-001"
}
```

---

## 7. Model Provisioning & Licensing

| Model | Purpose | Architecture | Parameter Count | License | Provisioning |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `BAAI/bge-small-en-v1.5` | Dense sentence embedding | BERT-based encoder | 33.5M | MIT | Pre-cached in HF cache or `models/bge-small-en-v1.5/` |
| `BAAI/bge-reranker-base` | Cross-encoder reranking | RoBERTa-based cross-encoder | 278M | Apache 2.0 | Pre-cached in HF cache or `models/bge-reranker-base/` |

### Offline Pre-Provisioning Script (Run on Connected Machine)
```python
from sentence_transformers import SentenceTransformer, CrossEncoder

SentenceTransformer("BAAI/bge-small-en-v1.5")
CrossEncoder("BAAI/bge-reranker-base")
```

---

## 8. Security & Known Limitations

1. **ChromaDB Encryption**: ChromaDB does not provide native column-level or at-rest encryption. Protection relies on host filesystem access controls, encrypted volume storage (BitLocker / LUKS), or OS-level file permissions.
2. **Untrusted Evidence Sanitization**: Raw evidence strings are treated as passive data. Content from evidence files is never evaluated as instructions.
3. **Approximate HNSW Determinism**: ChromaDB uses HNSW approximate nearest neighbors. For exact repeatability across benchmarks, results can be pinned or evaluated using exact cosine metrics.
4. **No Path Traversal**: Case IDs are validated against `^[A-Za-z0-9_\-]+$` and path traversal sequences (`..`) are strictly rejected.
