# ForensicLens - Backend

This directory contains the Python / FastAPI application backend for **ForensicLens**, an offline-first, privacy-preserving digital forensics investigation platform.

## Architecture & Structure

The backend core is structured into modular application packages under `app/`:

- `api/`: REST API endpoints (Cases, Evidence, Events) and router definitions
- `cases/`: Case lifecycle, per-case database initialization, and repository discovery
- `evidence/`: Structured evidence models, SHA-256 verification, and immutable storage
- `parsers/`: Pluggable log parsers (Linux/OpenSSH) and persistence to `raw_records` and `events`
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

---

## API Endpoints (UI Step 2)

All endpoints follow the `/api/...` convention and enforce strict per-case SQLite database isolation.

### Cases

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/cases` | List all discovered forensic cases with artifact counts |
| `GET` | `/api/cases/{case_id}` | Retrieve case details, isolation path, and summary counts |
| `POST` | `/api/cases` | Initialize a new forensic case and isolated database |

### Evidence

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/cases/{case_id}/evidence` | List all ingested evidence files in the case |
| `GET` | `/api/cases/{case_id}/evidence/{evidence_id}` | Retrieve evidence metadata and SHA-256 hash status |
| `POST` | `/api/cases/{case_id}/evidence` | Ingest and hash evidence artifact (multipart/form-data) |
| `POST` | `/api/cases/{case_id}/evidence/{evidence_id}/process` | Parse evidence artifact and persist normalized events |

### Events

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/cases/{case_id}/events` | Query normalized events (FTS5 search, type, severity, user, IP, time window, pagination) |
| `GET` | `/api/cases/{case_id}/events/{event_id}` | Retrieve event details with provenance trace and exact raw evidence text |

### Timeline

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/cases/{case_id}/timeline` | Retrieve chronological forensic timeline with deterministic ordering, bounded pagination, and filters |

### Sessions

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/cases/{case_id}/sessions` | Reconstruct and list forensic authentication sessions (temporal proximity, lifecycle boundaries, IP/user correlation) |
| `GET` | `/api/cases/{case_id}/sessions/{session_id}` | Retrieve reconstructed session details with ordered event sequence and correlation basis |

---

## Running Backend and Frontend Together

### 1. Start the Backend API

```powershell
cd backend
.venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The backend API will be available at `http://127.0.0.1:8000` (interactive documentation at `http://127.0.0.1:8000/docs`).

### 2. Start the Frontend Application

```powershell
cd frontend
npm run dev
```

The frontend application will run on `http://127.0.0.1:3000`.

### 3. Data Mode Configuration

The frontend supports two operating modes configured in `frontend/.env`:

- **Live API Mode** (`VITE_DATA_MODE=api`): Connects to `http://127.0.0.1:8000`. Cases, evidence, and events are served from the real per-case backend databases.
- **Fixture Mode** (`VITE_DATA_MODE=fixtures`): Operates standalone using in-memory mock datasets for offline presentation or testing.

---

## Example cURL Requests

### List Cases
```bash
curl -X GET http://127.0.0.1:8000/api/cases
```

### Create a Forensic Case
```bash
curl -X POST http://127.0.0.1:8000/api/cases \
  -H "Content-Type: application/json" \
  -d '{
    "caseId": "CASE-2026-001",
    "name": "Unauthorized Access Audit",
    "description": "Suspected lateral movement via SSH",
    "leadInvestigator": "Analyst Rao"
  }'
```

### Ingest Evidence File
```bash
curl -X POST http://127.0.0.1:8000/api/cases/CASE-2026-001/evidence \
  -F "file=@auth.log" \
  -F "format_name=OPENSSH"
```

### Process Evidence with Parser
```bash
curl -X POST http://127.0.0.1:8000/api/cases/CASE-2026-001/evidence/EV_4A2B9F3E1C78495A/process \
  -H "Content-Type: application/json" \
  -d '{"parserName": "OPENSSH"}'
```

### Query Events with FTS5 Lexical Search
```bash
curl -X GET "http://127.0.0.1:8000/api/cases/CASE-2026-001/events?search=hacker&user=root&severity=WARNING&page=1&page_size=20"
```

### Inspect Event Detail & Provenance
```bash
curl -X GET "http://127.0.0.1:8000/api/cases/CASE-2026-001/events/EVT_EV_4A2B9F3E1C78495A_1"
```

### Query Timeline
```bash
curl -X GET "http://127.0.0.1:8000/api/cases/CASE-2026-001/timeline?event_type=AUTH_SUCCESS&user=admin&page=1&page_size=50"
```

### Reconstruct Sessions
```bash
curl -X GET "http://127.0.0.1:8000/api/cases/CASE-2026-001/sessions?status=CLOSED&gap_seconds=300&page=1&page_size=20"
```

### Inspect Reconstructed Session
```bash
curl -X GET "http://127.0.0.1:8000/api/cases/CASE-2026-001/sessions/SES_CASE-2026-001_001"
```
