**PRODUCT REQUIREMENTS DOCUMENT**

**ForensicLens**

Privacy-Preserving, Verifiable Digital Forensics Investigation

Using Hybrid Retrieval, Claim Verification and Indian Legal Provision Mapping

*Version 1.1 | Product & Research Specification | November 2026*

| **Document Field** | **Value** |
| --- | --- |
| Product | ForensicLens |
| Project Title | Privacy-preserving, verifiable digital forensics investigation using hybrid retrieval and Indian legal provision mapping |
| Document Type | Product Requirements Document (PRD) |
| Version | 1.1 (supersedes 1.0) |
| Primary Users | Digital forensic investigators, cybersecurity analysts, legal/compliance analysts, researchers |
| Deployment | Offline-first / local execution |
| Core Research | Claim-level verification of evidence-grounded RAG; privacy-utility trade-off; elements-based Indian legal retrieval; hybrid forensic retrieval; prompt-injection robustness |
| Status | Proposed / MVP specification (revised after review) |


## Revision History

| **Version** | **Date** | **Summary of changes** |
| --- | --- | --- |
| 1.0 | Nov 2026 | Initial specification: hybrid retrieval, local RAG, Indian legal retrieval, injection testing. |
| 1.1 | Nov 2026 | Corrections: timezone-aware timestamps, public-IP example, scope/dataset consistency, status-aware legal records (struck-down and superseded law), closed-set legal ID validation, measurable acceptance targets, hardware-referenced NFRs, API gaps.<br>Additions: claim-level verification, pseudonymization gateway with privacy levels, MITRE ATT&CK behaviour layer, elements-of-offence coverage, sessionization and temporal patterns, integrity/anti-forensic checks, reproducibility controls, BSA s.63 certificate draft, hypothesis engine (stretch), ForensicLens-Bench-lite, statistical evaluation protocol, rebalanced 8-week roadmap. |


# Contents

1. Executive Summary
2. Vision, Objectives and Research Questions
3. Problem Definition
4. Users and Personas
5. Scope and Priority Tiers
6. Product Principles
7. End-to-End User Journey
8. Functional Requirements
9. System Architecture
10. Data and Evidence Model
11. Retrieval and Investigation Engine
12. Local AI, RAG and Claim Verification
13. Indian Legal Provision Mapping
14. Security, Privacy and Integrity
15. User Interface Requirements
16. API Requirements
17. Non-Functional Requirements
18. Research and Evaluation
19. MVP Acceptance Criteria
20. Development Roadmap
21. Risks and Limitations
22. Future Scope
23. Final Product Definition
24. Appendix A: Recommended Technology Stack
25. Appendix B: Evaluation Datasets
26. Appendix C: Baselines and Related-Work Checklist
# 1. Executive Summary

ForensicLens is an offline-first, verifiable digital forensic investigation platform for searching, correlating and interpreting heterogeneous digital evidence without sending sensitive evidence to external AI services. It combines structured search, keyword retrieval, semantic vector retrieval and reranking into a hybrid retrieval pipeline. Retrieved evidence is correlated into sessions, timelines and entity relationships, pseudonymized, and supplied to a local LLM through controlled retrieval-augmented generation (RAG).

Version 1.1 moves the project beyond a retrieval-plus-LLM pipeline. Generated findings are not trusted on citations alone: each finding is decomposed into atomic claims that are compiled into structured predicates and re-executed against the evidence store, so unsupported claims are detected mechanically. Sensitive identifiers are pseudonymized before they reach the model, and the privacy-utility trade-off is measured. A separate legal subsystem maps observed behaviour, through an ATT&CK-style behaviour representation, to the elements of potentially relevant Indian statutory provisions and shows which elements the evidence supports and which it cannot establish (such as intent).

The product assists investigators; it does not determine guilt, liability or court admissibility. Material generated findings must be traceable to evidence IDs and, where possible, the original file and source location.

# 2. Vision, Objectives and Research Questions

## 2.1 Vision

Create a privacy-preserving forensic investigation assistant that converts heterogeneous digital evidence into searchable, explainable, provenance-preserving, machine-verifiable and legally contextualized investigative intelligence.

## 2.2 Objectives

- Enable natural-language investigation over heterogeneous forensic logs.
- Combine exact, metadata, keyword and semantic retrieval.
- Preserve provenance from generated finding to normalized event and original evidence.
- Reconstruct cross-source timelines, sessions and entity relationships.
- Provide evidence-grounded reasoning using a local LLM.
- **Verify every material generated claim against the structured evidence store before presenting it as verified.**
- **Pseudonymize sensitive identifiers before model inference and quantify the privacy-utility trade-off.**
- **Retrieve potentially relevant Indian legal provisions from a status-aware knowledge base and report which statutory elements the evidence supports.**
- **Detect integrity and anti-forensic indicators such as log gaps, timestamp reversals and clock skew.**
- Keep sensitive evidence and AI inference local during normal operation, and verify this empirically.
- Quantitatively evaluate retrieval, grounding, legal retrieval, privacy, latency and prompt-injection robustness using a reproducible benchmark (ForensicLens-Bench-lite).
## 2.3 Research Questions

| **ID** | **Research Question** | **Primary Evidence** |
| --- | --- | --- |
| RQ1 | Does claim-level verification against the structured store reduce the unsupported-claim rate compared with citation-only grounded RAG? | Unsupported-claim rate, verified-claim recall, citation accuracy |
| RQ2 | How much retrieval and grounding quality is lost as pseudonymization becomes stricter (levels L0 to L3), and how much PII reaches the model? | Privacy-utility curve, PII leakage rate |
| RQ3 | Does mapping behaviour to statutory elements (via an ATT&CK-style behaviour representation) improve legal retrieval over direct semantic legal search? | Recall@K, MRR, nDCG, element-level accuracy |
| RQ4 (supporting) | Does hybrid retrieval with reranking outperform keyword-only, vector-only and hybrid-without-reranking on forensic queries with exact and temporal constraints? | Precision@K, Recall@K, MRR, nDCG, latency |


## 2.4 Contribution Statement

The individual techniques used here (hybrid retrieval, RAG, GraphRAG-style reasoning, pseudonymization, hypothesis testing) exist in the literature. The contribution is their integration into one provenance-preserving, measurable pipeline for Indian digital forensics, with three evaluated additions: claim-level verification, a measured privacy-utility curve, and elements-based legal mapping. A related-work check (Appendix C) must be completed before any novelty claim is published.

# 3. Problem Definition

Digital investigations involve large volumes of logs with different formats, field names, timestamps and vocabularies. Keyword search is precise for known indicators but can miss semantic equivalents. Vector search captures semantic similarity but can be weak for exact constraints such as IP addresses, usernames and time windows. Top-K retrieval is point-wise and cannot by itself express sequences such as "failure followed by success". Investigators therefore need an approach that combines these capabilities while preserving forensic provenance and keeping unsupported AI statements out of findings.

| **Problem** | **Impact** | **Product Response** |
| --- | --- | --- |
| Heterogeneous formats | Manual interpretation | Parsing + canonical normalization |
| Keyword-only search | Missed semantic matches | Semantic retrieval |
| Vector-only search | Weak exact constraints | Structured/metadata retrieval |
| Point-wise top-K retrieval | Sequence ("followed by") queries missed | Sessionization + temporal pattern execution |
| Large evidence volume | High investigation time | Top-K retrieval + reranking |
| Disconnected sources | Difficult incident reconstruction | Timeline + entity correlation |
| Cloud LLM privacy risk | Sensitive data exposure | Local LLM + egress verification |
| PII in model prompts | Exposure, weak data minimization | Pseudonymization gateway with privacy levels |
| LLM hallucination | Unsupported conclusions | Evidence-grounded RAG |
| Real citations, wrong statements | Plausible but incorrect findings | Claim decomposition + predicate verification |
| Untrusted logs | Prompt-injection risk | Evidence isolation + testing + verifier backstop |
| Log tampering and gaps | Silent evidence loss | Integrity and anti-forensic checks |
| Law separated from evidence | Manual legal research | Indian legal RAG with elements coverage |
| Stale, repealed or struck-down law | Citing law not in force | Status-aware legal KB with effective dates |


# 4. Users and Personas

| **Persona** | **Need** | **Key Tasks** |
| --- | --- | --- |
| Digital Forensic Investigator | Rapid, traceable, verifiable investigation | Ingest, search, correlate, inspect, verify, report |
| Cybersecurity Analyst | Incident understanding | Threat hunting, correlation, reconstruction |
| Legal/Compliance Analyst | Technical-to-legal context | Review evidence, statutory elements and reporting obligations |
| Researcher | Experimental evaluation | Compare retrieval, grounding, privacy and robustness |


# 5. Scope and Priority Tiers

To keep the 8-week plan achievable, every requirement carries a tier. Stretch items are cut first, in the order listed, before any Core item is reduced.

| **Tier** | **Meaning** | **Items** |
| --- | --- | --- |
| Base | Original MVP baseline | Hashing, parsing, normalization, structured/keyword/semantic/hybrid retrieval, reranking, timeline, local RAG, basic legal retrieval, injection tests, reporting. |
| Core | New in v1.1; must build | Timezone-aware normalization, sessionization and temporal patterns, claim verification, pseudonymization gateway, ATT&CK behaviour layer, status-aware legal KB with elements coverage, integrity/anti-forensic checks, hash-chained audit and reproducibility, BSA s.63 certificate draft, ForensicLens-Bench-lite. |
| Stretch | Build only if Core is complete (cut in this order, last first) | 1) Hypothesis engine with counter-evidence; 2) graph-augmented multi-hop retrieval; 3) Hindi/Hinglish queries. |
| Deferred | Documented, not built | Full dual-LLM quarantine architecture, EVTX/PCAP, distributed investigation, SIEM/SOAR integration. |


## 5.1 MVP In Scope

- CSV, JSON, TXT and common Linux/SSH/Apache-style logs.
- SHA-256 hashing and evidence preservation with a hash-chained audit log.
- Source-specific parsing, retention of unparsed lines, and canonical normalization with timezone-aware timestamps.
- SQLite/PostgreSQL structured storage with full-text search (FTS5 or equivalent).
- ChromaDB or equivalent local vector index (telemetry disabled).
- Exact/metadata, keyword, semantic and hybrid retrieval with reranking.
- Natural-language investigation queries decomposed into a constrained, validated query representation.
- Cross-source correlation, sessionization, timeline reconstruction and entity extraction (users, IPs, hosts, processes, files, commands).
- Local LLM inference using llama.cpp/GGUF or equivalent with constrained JSON output.
- Evidence-grounded RAG with claim decomposition and verification.
- Pseudonymization gateway with configurable privacy levels.
- Status-aware Indian legal knowledge base, ATT&CK-style behaviour mapping, and elements-of-offence coverage.
- Prompt-injection robustness controls and testing.
- Investigation report generation including limitations and model/prompt versions.
## 5.2 Out of Scope

- Autonomous evidence acquisition from seized devices.
- Automatic suspect identification, guilt or legal verdicts.
- Malware execution/sandboxing.
- Real-time surveillance.
- Automatic court-admissibility determination or legal certification of any document.
- Mandatory cloud processing.
- EVTX and PCAP ingestion (Windows datasets may be used only where converted to supported formats; see Appendix B).
# 6. Product Principles

| **Principle** | **Requirement** |
| --- | --- |
| Evidence is the source of truth | AI output must not replace original evidence. |
| Local-first privacy | Sensitive evidence should remain inside the investigation environment, and this must be verified, not assumed. |
| Minimal exposure | The model receives only necessary, pseudonymized context. |
| Provenance by design | Material findings must be traceable to evidence. |
| Verify, do not trust | A generated claim is presented as verified only if it passes a machine check against the evidence store. |
| Retrieval before generation | LLM reasons over retrieved evidence. |
| Legal mapping is contextual | Retrieve potentially relevant provisions; do not determine liability. Elements that logs cannot establish (such as intent) are flagged for human judgment. |
| Evidence is untrusted input | Log text must never be treated as instructions. |
| Reproducibility | AI-assisted findings must be repeatable and their model, prompt and parameters recorded. |
| Human remains in control | The product assists rather than autonomously decides. |


# 7. End-to-End User Journey

1. Create/open a case.
2. Upload evidence.
3. Hash evidence before processing; record the hash in the hash-chained audit log.
4. Detect format and select parser.
5. Parse and normalize events; retain unparsed lines as raw records; convert timestamps to UTC while preserving originals.
6. Store structured events and provenance; enrich entities (for example IP scope).
7. Generate embeddings and build lexical and vector indexes.
8. Run integrity and anti-forensic checks (log gaps, timestamp reversals, clock skew).
9. Submit a natural-language question.
10. Decompose the question into a constrained query representation (semantic intent, entities, metadata, temporal pattern).
11. Run structured/keyword and semantic retrieval over events and sessions.
12. Fuse (reciprocal rank fusion) and rerank candidates.
13. Correlate evidence into sessions, timeline and entities.
14. Optionally derive behaviours (ATT&CK-style) and retrieve potentially relevant Indian provisions with elements coverage.
15. Pseudonymize evidence and legal context at the selected privacy level and send to the local LLM.
16. Generate a structured result containing atomic claims.
17. Verify each claim against the evidence store; label VERIFIED, UNVERIFIED or CONTRADICTED.
18. (Stretch) Generate and rank competing hypotheses with supporting and contradicting evidence.
19. Re-identify tokens for display; inspect supporting evidence and the claim-to-predicate trace.
20. Export the investigation report with limitations and reproducibility metadata.
# 8. Functional Requirements

| **ID** | **Feature** | **Requirement** | **Tier** |
| --- | --- | --- | --- |
| FR-01 | Case Management | Create, open and identify investigation cases. All data is scoped to a case. | Base |
| FR-02 | Evidence Upload | Upload and preserve supported evidence files unmodified. | Base |
| FR-03 | Integrity | Calculate SHA-256 for each evidence file before processing; expose verification status; allow on-demand re-verification. | Base |
| FR-04 | Format Detection | Route files to appropriate parsers; mark unsupported formats explicitly. | Base |
| FR-05 | Parsing | Extract source-specific forensic fields. Lines that fail parsing are retained as raw records with parse_status and counted in a parser-coverage metric. | Base |
| FR-06 | Normalization | Map records to the canonical schema, storing UTC time, original timestamp, assumed timezone and timestamp confidence (including inferred year for syslog-style lines). | Base |
| FR-07 | Provenance | Store evidence ID, source file and source location for every event. | Base |
| FR-08 | Structured Search | Filter by time, IP (including IP scope), user, host, source and event type. | Base |
| FR-09 | Keyword Search | Lexical (BM25/FTS) retrieval over messages and fields. | Base |
| FR-10 | Semantic Search | Embedding-based retrieval from a locally bundled model. | Base |
| FR-11 | Hybrid Retrieval | Fuse structured/keyword and semantic candidates using reciprocal rank fusion as the default, with weighted fusion as a configurable alternative. | Base |
| FR-12 | Reranking | Rerank candidates using a cross-encoder/equivalent. | Base |
| FR-13 | Natural-Language Investigation | Accept investigation questions in natural language. | Base |
| FR-14 | Correlation | Link events across sources and entities; alias resolution carries a confidence score. | Base |
| FR-15 | Timeline | Construct chronological incident timelines with clickable evidence. | Base |
| FR-16 | Entity View | Display relationships between forensic entities. | Base |
| FR-17 | Local LLM | Run reasoning locally with constrained JSON output. | Base |
| FR-18 | Grounded RAG | Generate answers as atomic claims, each with evidence references. | Base |
| FR-19 | Legal Retrieval | Retrieve potentially relevant Indian provisions from the legal KB. | Base |
| FR-20 | Legal Mapping | Explain potential relevance without legal judgment. | Base |
| FR-21 | Injection Protection | Treat evidence content as untrusted data; validate outputs against schema. | Base |
| FR-22 | Reporting | Generate investigation reports with findings, evidence, timeline, legal context, limitations and reproducibility metadata. | Base |
| FR-23 | Auditability | Record investigation actions and findings in a hash-chained, tamper-evident audit log. | Base |
| FR-24 | Sessionization | Group events into sessions and time windows (for example per user, source IP and host) so sequence queries can be evaluated. | Core |
| FR-25 | Temporal Patterns | Evaluate patterns of the form "A followed by B within T" over events with equality constraints on chosen fields. | Core |
| FR-26 | IP Enrichment | Classify IP scope (public, private, loopback, link-local); optionally add offline ASN/geo data. | Core |
| FR-27 | Constrained Query Decomposition | Convert questions into a schema-validated JSON query. Natural language is never translated into raw SQL; execution uses parameterized queries only. | Core |
| FR-28 | Claim Decomposition | Split generated findings into atomic, individually checkable claims. | Core |
| FR-29 | Claim Verification | Compile each claim into a typed predicate (EXISTS, COUNT, ATTRIBUTE_EQ, TIME_ORDER, SEQUENCE), execute it read-only against the store, and label it VERIFIED, UNVERIFIED or CONTRADICTED. Unverified claims are never shown as findings. | Core |
| FR-30 | Pseudonymization Gateway | Replace sensitive values with reversible, case-consistent tokens before model inference at a configurable privacy level (L0 to L3); keep the mapping in a local protected vault. | Core |
| FR-31 | Behaviour Mapping | Map event patterns to ATT&CK-style technique identifiers with supporting evidence IDs. | Core |
| FR-32 | Legal KB Status | Each provision stores status (in force, repealed, struck down, superseded), effective dates, version and source; non-operative provisions are flagged and never presented as current law. | Core |
| FR-33 | Elements Coverage | Decompose each retrieved provision into elements and show a coverage matrix (SUPPORTED, PARTIAL, NOT SUPPORTED, REQUIRES HUMAN JUDGMENT). | Core |
| FR-34 | Legal ID Validation | Every legal identifier in model output must exist in the KB; others are removed and logged. | Core |
| FR-35 | Integrity Checks | Detect log gaps, timestamp reversals, inter-source clock skew and truncated files, and surface them in the case view and report. | Core |
| FR-36 | Reproducibility | Record model name and file hash, quantization, prompt-template version and parameters; provide a deterministic mode (temperature 0, fixed seed). | Core |
| FR-37 | Certificate Draft | Generate a draft electronic-record certificate summary (hash values, tool, process) aligned with Bharatiya Sakshya Adhiniyam s.63 for expert and legal review; it is a draft, not a legal certificate. | Core |
| FR-38 | Benchmark Harness | Run the ForensicLens-Bench-lite evaluation suite reproducibly from the command line. | Core |
| FR-39 | Hypothesis Engine | Propose competing hypotheses, retrieve supporting and contradicting evidence for each, and rank them with stated uncertainty. | Stretch |
| FR-40 | Graph-Augmented Retrieval | Traverse an entity-event graph for multi-hop questions and combine results with hybrid retrieval. | Stretch |
| FR-41 | Multilingual Queries | Accept Hindi/Hinglish questions using a multilingual embedding model. | Stretch |


# 9. System Architecture

React UI → FastAPI → Ingestion / Query / Investigation / Verification / Legal services → SQLite/PostgreSQL (+ FTS) + ChromaDB + protected vault → Pseudonymization Gateway → Local LLM → Claim Verifier → UI.

**Design rule:** the LLM never has database access. Only the Claim Verifier and the retrieval services execute queries, and they do so through parameterized, read-only statements built from validated structures.

| **Layer** | **Components** | **Responsibility** |
| --- | --- | --- |
| Presentation | React | Dashboard, investigation, evidence, timeline, legal, claim verification and reports |
| API | FastAPI | HTTP/JSON endpoints, validation, case scoping, local authentication |
| Ingestion | Python parsers + normalizer | Detection, parsing, normalization, hashing, integrity checks |
| Structured Store | SQLite/PostgreSQL + FTS | Events, cases, provenance, findings, audit chain |
| Vector Store | ChromaDB | Evidence and legal embeddings |
| Retrieval | SQL + lexical + vector + reranker | Candidate generation, fusion and ranking |
| Investigation | Correlation, sessionization, timeline, behaviour mapper | Incident reconstruction and ATT&CK-style behaviours |
| Privacy | Pseudonymization gateway + vault | Tokenize before inference; re-identify for display |
| AI | Sentence Transformers + local LLM | Embeddings, reranking, constrained grounded generation |
| Verification | Claim decomposer + predicate compiler/executor | Machine-check generated claims against the store |
| Legal | Legal RAG + elements engine | Provision retrieval, status handling, elements coverage |
| Evaluation | Benchmark harness | Reproducible experiments and metrics |


# 10. Data and Evidence Model

## 10.1 Canonical Event Schema

{

"event_id": "EV-00123",

"timestamp_utc": "2026-09-27T02:31:42Z",

"timestamp_original": "Sep 27 02:31:42",

"tz_assumed": "UTC",

"timestamp_confidence": "INFERRED_YEAR",

"source": "OpenSSH",

"host": "server01",

"event_type": "AUTH_FAILURE",

"severity": "WARNING",

"user": "root",

"src_ip": "203.0.113.45",

"src_ip_scope": "PUBLIC",

"src_port": 52341,

"process": "sshd",

"pid": 1234,

"command": null,

"resource": null,

"message": "Failed password for root...",

"parse_status": "PARSED",

"source_file": "auth.log",

"line_number": 1829,

"evidence_hash": "...",

"event_hash": "..."

}

## 10.2 Timestamp Rules

| **Situation** | **Rule** |
| --- | --- |
| No timezone in source | Record tz_assumed (configurable per source), convert to UTC, keep timestamp_original. |
| No year (syslog style) | Infer from file metadata and month rollover; set timestamp_confidence to INFERRED_YEAR. |
| Multiple sources, different clocks | Estimate inter-source skew where anchor events exist; flag, never silently shift. |
| Unparseable timestamp | Retain event with parse_status set and timestamp_confidence UNKNOWN; exclude from temporal patterns. |


## 10.3 Storage Model

| **Store** | **Purpose** | **Key Data** |
| --- | --- | --- |
| Raw evidence | Preserve originals | Original file, hash, metadata (read-only) |
| Structured DB | Exact investigation | Events, cases, provenance, findings, claims, verification results |
| Audit chain | Tamper-evident history | Hash-chained records of actions, model versions, prompts, outputs |
| Vector DB | Semantic retrieval | Embeddings, event text, metadata (encrypted at rest where supported) |
| Pseudonymization vault | Reversible token mapping | Token-to-value map, per case, access-controlled and encrypted |
| Legal KB | Legal retrieval | Act, section, elements, status, effective dates, version, source, metadata |


## 10.4 Retrieval Units

Events are the atomic unit, but embeddings of single log lines represent IPs and numbers poorly and cannot express sequences. The system therefore also indexes sessions and fixed time windows as retrieval units, and optionally mines log templates so that constant text and variable fields are handled separately. The choice of unit is an evaluated design variable (Section 18).

# 11. Retrieval and Investigation Engine

## 11.1 Constrained Query Decomposition

A natural-language question is transformed into a schema-validated JSON representation of semantic intent, entities, metadata constraints and temporal pattern. The representation is validated before execution; free-form SQL generated from language is not permitted.

Example: "Show failed SSH logins from an external IP followed by successful authentication."

{

"intent": "SEQUENCE_DETECTION",

"sources": ["OpenSSH"],

"pattern": [

{"step": 1, "event_type": "AUTH_FAILURE"},

{"step": 2, "event_type": "AUTH_SUCCESS",

"same": ["user", "src_ip"], "within_seconds": 3600}

],

"filters": {"src_ip_scope": "PUBLIC"},

"time_range": null

}

## 11.2 Hybrid Retrieval

Structured/keyword and semantic retrieval run in parallel over the chosen retrieval units. Candidates are fused, deduplicated and reranked before correlation and RAG. The default fusion is reciprocal rank fusion, score(d) = sum over rankers of 1 / (k + rank_i(d)) with k = 60; weighted and learned fusion are evaluated as ablations.

Pipeline: Query → Constrained decomposition → Structured/Keyword Retrieval + Vector Retrieval → Candidate Fusion → Reranking → Sessionization/Temporal patterns → Correlation → RAG.

## 11.3 Temporal Patterns and Sessions

Sequence questions are answered by executing the validated pattern against sessionized events, not by relying on the top-K list. Retrieval proposes candidate sessions and the pattern engine confirms the ordering and constraints deterministically.

## 11.4 Entity Resolution

Users, IPs, hosts, processes and resources are extracted and linked across sources. Alias links (for example hostname to IP) carry confidence scores. Known limitations such as NAT, DHCP reassignment and shared accounts are surfaced in limitations rather than hidden.

## 11.5 Integrity and Anti-Forensic Checks

- Log gaps: unexpected silent periods relative to a source’s typical event rate.
- Timestamp reversals and non-monotonic sequences within a file.
- Inter-source clock skew where anchor events exist.
- Truncated files or abrupt endings, and rotated-log discontinuities.
- Indicators of log clearing or tampering where the source records them.
## 11.6 Hypothesis Engine (Stretch)

For an incident question the engine proposes competing hypotheses (for example brute force, credential reuse, legitimate administrator activity), retrieves supporting and contradicting evidence for each using the same verified pipeline, and ranks them with explicit uncertainty. Counter-evidence is mandatory output, not optional.

## 11.7 Graph-Augmented Retrieval (Stretch)

Events and entities form a temporal graph with typed edges (same-session, follows, authenticated-as, connects-to). Multi-hop questions combine traversal with hybrid retrieval and are compared with flat RAG on multi-hop queries.

# 12. Local AI, RAG and Claim Verification

The local AI subsystem uses retrieval as a control boundary. The LLM receives the question, selected pseudonymized evidence, timeline representation and, when requested, retrieved legal sources. It has no tool or database access.

## 12.1 Grounding Rules

- Do not invent events, timestamps, users, IPs or legal provisions.
- Every factual forensic claim should reference evidence IDs.
- If evidence is insufficient, state that explicitly.
- Separate observed evidence from inference.
- Separate potential legal relevance from legal judgment.
- Treat retrieved log text as untrusted content.
- **Present a claim as a finding only if it is VERIFIED.**
## 12.2 Claim Verification Pipeline

| **Stage** | **Description** | **Output** |
| --- | --- | --- |
| 1. Constrained generation | The model produces JSON under a grammar-constrained decoder (for example llama.cpp GBNF). | Schema-valid structured result |
| 2. Claim decomposition | Findings are split into atomic claims, for example "203.0.113.45 had 14 failed logins for root". | List of claims with cited evidence IDs |
| 3. Predicate compilation | Each claim becomes a typed predicate: EXISTS, COUNT, ATTRIBUTE_EQ, TIME_ORDER or SEQUENCE. | Predicate JSON |
| 4. Execution | Predicates run read-only and parameterized against the structured store, restricted to the case. | Match set and result |
| 5. Labelling | VERIFIED if the predicate holds on the cited evidence; CONTRADICTED if evidence shows otherwise; UNVERIFIED if neither can be shown. | Claim status |
| 6. Filtering/repair | Unverified and contradicted claims are withheld from findings; one bounded repair attempt may regenerate them. | Verified finding set + rejected-claim log |


Example claim and predicate:

claim: "203.0.113.45 had 14 failed logins for root before success"

{

"type": "SEQUENCE",

"count": {"event_type": "AUTH_FAILURE", "src_ip": "203.0.113.45", "user": "root", "op": ">=", "value": 14},

"then": {"event_type": "AUTH_SUCCESS", "same": ["src_ip", "user"]},

"cited_events": ["EV-00123", "EV-00129"]

}

The verifier checks claims against the structured store. It cannot verify the correctness of the underlying evidence, the parser, or inferences that go beyond what the store records; those remain limitations to state.

## 12.3 Structured AI Output

{

"claims": [

{"claim_id": "C1", "text": "...", "evidence_ids": ["EV-00123"],

"predicate": {}, "status": "VERIFIED"}

],

"finding": "...",

"confidence": "HIGH",

"confidence_basis": {"verified_ratio": 1.0, "independent_events": 14},

"timeline": [],

"behaviours": [],

"potential_legal_provisions": [],

"hypotheses": [],

"limitations": [],

"run_metadata": {"model": "...", "model_sha256": "...", "prompt_version": "...", "seed": 0}

}

## 12.4 Confidence Definition

Confidence is derived from verification results and evidence strength, not self-reported by the model.

| **Level** | **Rule (initial; to be calibrated against the benchmark)** |
| --- | --- |
| HIGH | All material claims VERIFIED, and supported by at least two independent events (or sources) with no integrity flags on those events. |
| MEDIUM | All material claims VERIFIED but supported by a single event or source, or integrity flags apply to cited events. |
| LOW | Some material claims UNVERIFIED or evidence is insufficient; shown with the limitation. |


## 12.5 Reproducibility

Every investigation run records the model identity and file hash, quantization, prompt-template version, retrieval parameters and seed. A deterministic mode (temperature 0, fixed seed) is provided so that results can be regenerated and audited.

# 13. Indian Legal Provision Mapping

The legal subsystem is separate from the forensic evidence store and should use authoritative statutory sources wherever possible. All provision numbers, text and status must be verified against official sources (for example India Code and the Gazette) at ingestion and re-verified periodically.

## 13.1 Corpus Areas

- Information Technology Act, 2000 (as amended), including provisions such as ss. 43, 65, 66, 66B, 66C, 66D, 72 and 79A.
- Bharatiya Nyaya Sanhita, 2023 (in force from 1 July 2024).
- Bharatiya Sakshya Adhiniyam, 2023, including s.63 on electronic records.
- Bharatiya Nagarik Suraksha Sanhita, 2023.
- Digital Personal Data Protection Act, 2023 and the rules made under it (confirm current notification status at ingestion).
- CERT-In directions of 28 April 2022 (incident reporting and log retention) and other relevant rules/notifications.
- A crosswalk from the Indian Penal Code, Code of Criminal Procedure and Indian Evidence Act to their successors, because many papers and datasets still use the older references.
## 13.2 Legal Record Schema

{

"legal_id": "IT_ACT_66C",

"act": "Information Technology Act, 2000",

"section": "66C",

"title": "Punishment for identity theft",

"text": "...",

"elements": [

{"element_id": "E1", "description": "Use of a password, electronic signature or other unique identification feature", "evidence_type": "OBSERVABLE"},

{"element_id": "E2", "description": "The feature belongs to another person", "evidence_type": "PARTIAL"},

{"element_id": "E3", "description": "Fraudulent or dishonest intent", "evidence_type": "HUMAN_JUDGMENT"}

],

"keywords": ["password", "identity"],

"status": "IN_FORCE",

"effective_from": "YYYY-MM-DD",

"effective_to": null,

"superseded_by": null,

"version": "...",

"source": "Official statutory source",

"source_url": "...",

"last_verified": "YYYY-MM-DD",

"jurisdiction": "India"

}

## 13.3 Status Handling

- Status values: IN_FORCE, REPEALED, STRUCK_DOWN, SUPERSEDED. Provisions that are not IN_FORCE are retrievable only as flagged historical records.
- Example: IT Act s.66A was struck down by the Supreme Court in Shreya Singhal v. Union of India (2015) and must never be presented as operative law.
- IPC, CrPC and Indian Evidence Act references are mapped to BNS, BNSS and BSA through the crosswalk, with the transition date recorded.
- The effective date relevant to the incident date is used when selecting the applicable version of a provision.
## 13.4 Behaviour Representation and ATT&CK Layer

Instead of passing free-text evidence summaries to legal retrieval, verified event patterns are first mapped to a structured behaviour representation using ATT&CK-style technique identifiers, then to candidate provisions.

{

"behaviour_id": "B-01",

"technique": "T1110 Brute Force",

"evidence_ids": ["EV-00123", "EV-00129"],

"entities": {"src_ip": "203.0.113.45", "user": "root"},

"verified": true

}

The mapping from behaviour to candidate provisions is maintained as reviewed knowledge (for example brute force and unauthorized access to IT Act ss. 43(a) and 66; credential misuse to s.66C; personation-based deception to s.66D). It generates candidates for review, not conclusions.

## 13.5 Elements-of-Offence Coverage

Each retrieved provision is decomposed into elements, and each element is compared with verified evidence.

| **Element (IT Act s.66C, illustrative)** | **Coverage** | **Reason** |
| --- | --- | --- |
| Use of password or unique identification feature | SUPPORTED / PARTIAL | Authentication events show use of credentials; cited evidence IDs listed. |
| Feature belongs to another person | PARTIAL | Account ownership may be inferred from logs but usually needs external records. |
| Fraudulent or dishonest intent | REQUIRES HUMAN JUDGMENT | Logs cannot establish intent; the system must not infer it. |


## 13.6 Evidence and Reporting Context

- BSA s.63: the report can include a draft certificate summary listing hash values, tools and process for expert and legal review (FR-37).
- IT Act s.79A (Examiner of Electronic Evidence): noted as context for expert examination; the product does not act as a notified examiner.
- CERT-In 2022 directions and DPDP obligations: an informational checklist of potentially relevant reporting and retention obligations, not a compliance determination.
## 13.7 Constraints and Disclaimer

The UI must state that legal retrieval is informational and analytical. It must not state that a person violated a provision merely because matching technical evidence was retrieved. Model output that cites a legal_id absent from the KB is rejected (FR-34).

# 14. Security, Privacy and Integrity

| **Area** | **Requirement** |
| --- | --- |
| Privacy | Normal operation must not require sending forensic evidence to external AI services; verified by egress testing (14.3). |
| Pseudonymization | Sensitive identifiers are tokenized before model inference at a configurable level (14.2). |
| Integrity | Hash every source file and expose verification status. |
| Evidence isolation | Keep raw evidence separate from generated text and model instructions. |
| Input security | Validate uploads, paths, API payloads and file types; parameterized queries only. |
| Prompt injection | Treat log content as untrusted data, validate outputs, use the verifier as a backstop and test adversarial evidence (14.4). |
| Access control | Restrict case/evidence access, including local authentication tokens even in single-user mode; role-based access for multi-user deployments. |
| Encryption at rest | Encrypt the structured DB (for example SQLCipher), vault and, where supported, the vector store. |
| Auditability | Hash-chained audit log of actions, model/prompt versions and generated findings. |
| Data minimization | Send only necessary retrieved, pseudonymized context to the local LLM. |
| Model supply chain | Ship embedding, reranker and LLM files with recorded hashes; verify at startup; no runtime downloads. |


## 14.2 Pseudonymization Gateway

Tokens are consistent within a case (the same value always maps to the same token) so correlations and joins remain possible. Public/private IP scope and similar non-identifying attributes are preserved as tags.

| **Level** | **Pseudonymized** | **Intended use** |
| --- | --- | --- |
| L0 | Nothing | Baseline for evaluation only |
| L1 | Usernames, email addresses, hostnames | Default minimum |
| L2 | L1 + IP addresses (scope tags kept) | Recommended working level |
| L3 | L2 + file paths, command arguments and free-text PII (local NER) | Maximum privacy; expected utility cost |


The vault is local, encrypted and access-controlled. Embedding inversion is a recognised leakage risk, so embeddings are stored locally and encrypted; computing embeddings over pseudonymized text is evaluated as a variant.

## 14.3 Egress Verification

- Run end-to-end workflows with outbound network access blocked and capture traffic to confirm zero external transmission.
- Disable vector-store and library telemetry by configuration; document each setting.
- Bundle models offline with hash verification; fail closed if a download would be required.
## 14.4 Prompt-Injection Controls

- Evidence is passed in typed, delimited fields and never concatenated into instructions.
- Model output is schema-validated; legal IDs and evidence IDs are checked against stores.
- The claim verifier acts as a backstop: an injected instruction that produces an unsupported statement is rejected as UNVERIFIED.
- Adversarial testing covers direct, obfuscated, encoded and multi-step injections, with and without the verifier.
- A full dual-LLM quarantine architecture (separate models for untrusted and trusted processing) is deferred (Section 22).
# 15. User Interface Requirements

| **Screen** | **Required Elements** |
| --- | --- |
| Dashboard | Cases, evidence count, event count, integrity status, parser coverage, local-AI status, egress/offline status |
| Case View | Evidence sources, processing status, integrity findings (gaps, skew), investigation history |
| Investigation | Natural-language query, filters, privacy-level selector, results, verified findings and derived confidence |
| Claim Verification | Each claim with its predicate, matched events and status (VERIFIED/UNVERIFIED/CONTRADICTED) |
| Evidence Viewer | Normalized event beside original content, original timestamp, hash status and provenance |
| Timeline | Chronological events and sessions with clickable evidence and integrity markers |
| Entity Graph | Users, IPs, hosts, processes and resources with confidence on links |
| Legal Panel | Potential provisions with status badge, elements coverage matrix, source and disclaimer |
| Hypotheses (Stretch) | Competing hypotheses with supporting and contradicting evidence |
| Report | Findings, evidence, timeline, legal context, limitations, certificate draft and reproducibility metadata |


# 16. API Requirements

All case-bound endpoints require a case identifier and a local authentication token. Long-running calls (for example /api/investigate) return a job identifier and are polled or streamed.

| **Method** | **Endpoint** | **Purpose** |
| --- | --- | --- |
| GET | /api/health | Service, model and offline status |
| POST | /api/cases | Create case |
| GET | /api/cases | List cases |
| GET | /api/cases/{case_id}/evidence | List evidence and processing status |
| POST | /api/ingest | Upload/process evidence |
| POST | /api/evidence/{evidence_id}/verify | Re-verify evidence hash |
| POST | /api/index | Build/rebuild indexes |
| POST | /api/search | Evidence retrieval (case-scoped) |
| POST | /api/investigate | Start end-to-end investigation; returns job_id |
| GET | /api/investigations/{investigation_id}/status | Job status and partial results |
| POST | /api/verify/claims | Verify claims against the evidence store |
| GET | /api/events/{event_id} | Event and provenance |
| GET | /api/timeline/{investigation_id} | Reconstructed timeline |
| POST | /api/privacy/config | Set pseudonymization level for a case |
| POST | /api/legal/search | Legal search |
| POST | /api/legal/map | Verified behaviour to legal retrieval and elements coverage |
| GET | /api/legal/{legal_id} | Provision, status and source |
| GET | /api/audit/{case_id} | Hash-chained audit records and chain verification |
| POST | /api/report | Generate report |
| POST | /api/hypotheses | (Stretch) Generate and rank hypotheses |
| POST | /api/bench/run | Run benchmark harness |


# 17. Non-Functional Requirements

Targets are stated for a reference machine: 8-core CPU, 16 GB RAM, optional GPU with 8 GB VRAM, running a 7B to 8B parameter 4-bit GGUF model. Results on other hardware are reported separately.

| **Category** | **MVP Target / Requirement** | **Measurement** |
| --- | --- | --- |
| Privacy | 0 external evidence transmission during normal offline operation | Egress capture with network blocked |
| PII exposure | PII leakage into model prompts ≤ 1% of tagged PII values at L2 | Tagged benchmark corpus |
| Structured query latency | < 1 second target for indexed queries | p95 on benchmark corpus |
| Hybrid retrieval | < 3 seconds target excluding LLM generation (reranking top-50) | p95 on benchmark corpus |
| Claim verification | < 5 seconds target per investigation | p95 |
| LLM latency | < 30 seconds target for a typical response on reference hardware | Median and p95 |
| Integrity | 100% of uploaded evidence receives stored SHA-256; audit chain verifies | Automated check |
| Parser coverage | Report share of lines parsed per source; target ≥ 95% on primary sources | Per-source metric |
| Reproducibility | Deterministic mode regenerates identical output for identical inputs | Repeat-run comparison |
| Scalability | Architecture supports migration from SQLite to PostgreSQL | Design review |
| Explainability | Material factual findings have evidence references and verification status | Audit of sample outputs |
| Maintainability | Modular parsers, retrieval strategies and model adapters | Code review |


# 18. Research and Evaluation

## 18.1 Benchmark and Statistical Protocol

| **Component** | **Specification (initial)** |
| --- | --- |
| ForensicLens-Bench-lite incidents | 20 to 30 synthetic multi-source incidents with known ground-truth timelines and causal structure, generated with a controlled script |
| Natural-language queries | At least 100 queries covering exact, temporal, sequence and semantic needs, each with labelled relevant events |
| Legal scenarios | At least 60 scenarios with gold provisions and element labels, reviewed by a legal subject-matter expert |
| Injection set | At least 100 adversarial payloads across direct, obfuscated, encoded and multi-step patterns |
| Annotation | Two annotators on a sample; report inter-annotator agreement (Cohen’s kappa) |
| Statistics | Bootstrap 95% confidence intervals; paired significance tests (for example Wilcoxon) for system comparisons; fixed seeds |


## 18.2 Retrieval Evaluation (RQ4)

| **Experiment** | **Variants** | **Metrics** |
| --- | --- | --- |
| Retrieval strategy | Keyword vs Vector vs Hybrid vs Hybrid + Reranker | Precision@K, Recall@K, MRR, nDCG |
| Fusion method | RRF vs weighted vs learned | Ranking metrics |
| Retrieval unit | Event vs session vs time window; raw lines vs mined templates | Ranking metrics, sequence-query accuracy |
| Embedding model | Multiple embedding variants | Retrieval metrics + latency |
| Reranker | With vs without | Ranking metrics + latency |
| Query constraints | Semantic-only vs semantic + exact + temporal | Execution accuracy, precision, recall, F1 |


## 18.3 Grounding and Verification Evaluation (RQ1)

| **Comparison** | **Metrics** |
| --- | --- |
| LLM only vs RAG vs citation-only grounded RAG vs grounded RAG + claim verifier | Unsupported-claim rate, citation accuracy, verified-claim recall, completeness, relevance |
| Verifier quality | False-accept and false-reject rates of the verifier against labelled claims |
| Local model sizes/quantization | Grounding, latency, RAM/VRAM, throughput |


## 18.4 Privacy-Utility Evaluation (RQ2)

| **Variable** | **Values** | **Metrics** |
| --- | --- | --- |
| Privacy level | L0, L1, L2, L3 | PII leakage rate, retrieval quality, grounding, verified-claim recall, latency |
| Embedding input | Raw text vs pseudonymized text | Retrieval quality, embedding-leakage probe |


The primary output is a privacy-utility curve: utility metrics plotted against measured PII exposure at each level.

## 18.5 Legal Retrieval Evaluation (RQ3)

| **Condition** | **Description** |
| --- | --- |
| A. Direct semantic | Embed the evidence summary or question and retrieve provisions directly |
| B. Behaviour-driven | Retrieve from a structured forensic-behaviour representation |
| C. ATT&CK + elements | Behaviour mapped through ATT&CK-style techniques with elements-based re-ranking and coverage |


Metrics: provision retrieval accuracy, Recall@K, MRR, nDCG, element-level coverage accuracy, and the rate at which non-operative provisions are wrongly returned.

## 18.6 Robustness Evaluation

Inject adversarial instructions into evidence records and measure attack success rate, unsupported-claim rate and grounding degradation across direct, obfuscated, encoded and multi-step injection patterns, each with the claim verifier on and off and at different privacy levels.

## 18.7 Hypothesis Evaluation (Stretch)

Measure whether the correct ground-truth hypothesis is ranked first or in the top-3 on benchmark incidents, and whether counter-evidence is correctly retrieved.

## 18.8 Baselines

| **Baseline** | **Compared on** |
| --- | --- |
| Plaso + Timesketch | Timeline reconstruction and search effort |
| Keyword search (FTS/ELK-style) | Retrieval quality and investigation time |
| Text-to-SQL baseline | Execution accuracy and error modes on constrained queries |
| Plain RAG (no verification, no pseudonymization) | Grounding, privacy and robustness |


# 19. MVP Acceptance Criteria

Functional criteria:

☐  Original evidence is preserved and receives SHA-256; the audit chain verifies.

☐  Supported evidence is parsed into the canonical schema with timezone-aware timestamps; unparsed lines are retained and counted.

☐  Each event is traceable to source evidence and location.

☐  Exact, keyword and semantic retrieval work independently.

☐  Hybrid retrieval is evaluated against single-retrieval baselines.

☐  Natural-language investigation queries produce ranked evidence through a validated query representation.

☐  Related events can be correlated into sessions and a timeline; sequence queries return correct results on benchmark incidents.

☐  Local LLM answers are decomposed into claims and verified against the evidence store.

☐  Investigators can inspect supporting evidence and the claim-to-predicate trace.

☐  Pseudonymization works at L1 to L3 and original values are restorable for display.

☐  Legal retrieval returns potentially relevant Indian provisions with sources, status and elements coverage; non-operative provisions are flagged.

☐  Technical evidence is separated from legal judgment; intent-type elements are marked as requiring human judgment.

☐  Prompt-injection testing is included and reported with the verifier on and off.

☐  A report can be exported with findings, evidence, timeline, limitations, certificate draft and reproducibility metadata.

Quantitative targets (initial; confirm or revise after the week-5 pilot, and report whatever is achieved with confidence intervals):

| **Target** | **Threshold** |
| --- | --- |
| Hybrid + reranker vs best single strategy | Statistically significant nDCG@10 improvement (p < 0.05), at least 5% relative |
| Claim verification | Unsupported-claim rate with verifier ≤ 5% and at least 50% lower (relative) than citation-only grounded RAG |
| Verifier accuracy | False-accept rate ≤ 5% on labelled claims |
| Privacy | PII leakage ≤ 1% at L2; utility drop at L2 within 10% relative of L0 |
| Legal retrieval | Condition C Recall@5 at least equal to condition A, with the improvement reported either way |
| Robustness | Attack success rate reduced by at least 50% relative with verifier and controls versus naive RAG |
| Offline operation | Zero outbound connections in egress test |


# 20. Development Roadmap

| **Week** | **Deliverables** |
| --- | --- |
| 1 | Architecture, canonical schema (timezone-aware), benchmark specification, dataset selection, React/FastAPI skeleton, legal source inventory |
| 2 | Upload, hashing, format detection, parsing and normalization, timestamp handling, unparsed-line retention, hash-chained audit log |
| 3 | Structured evidence store with FTS, provenance, evidence viewer, IP enrichment, integrity checks; begin legal corpus ingestion (parallel track) |
| 4 | Embeddings, ChromaDB, semantic search, hybrid fusion (RRF); legal KB structuring with status and elements |
| 5 | Reranker and retrieval evaluation; local LLM with baseline citation-only RAG and constrained JSON output; pilot to confirm targets |
| 6 | Sessionization, temporal patterns, timeline, entity correlation, ATT&CK behaviour mapping; claim verifier and grounding evaluation; investigation UI |
| 7 | Pseudonymization gateway and privacy-utility evaluation; legal retrieval, elements coverage and legal evaluation; injection controls |
| 8 | Robustness tests, profiling, report with certificate draft, benchmark packaging, final demo; hypothesis engine only if Core is complete |


**Cut rule:** if any week slips, drop Stretch items in the order given in Section 5 before reducing any Core item. The legal corpus is the largest hidden effort and therefore starts in week 3 as a parallel track.

# 21. Risks and Limitations

| **Risk / Limitation** | **Impact** | **Mitigation** |
| --- | --- | --- |
| Incomplete parser coverage | Evidence may be missed | Modular parsers + unsupported-format status + coverage metric |
| Dataset bias | Limited generalization | Multiple public datasets + controlled synthetic incidents |
| Synthetic benchmark bias | Results may not transfer | Document generation method; include public datasets; state limits |
| Local LLM quality | Incorrect explanations | Grounding, verification, model comparison and limitations |
| Verifier errors (false accept/reject) | Wrong claims pass, or valid claims dropped | Measure error rates; keep UNVERIFIED visible to investigator |
| Predicate compiler gaps | Some claim types cannot be checked | Limit to defined predicate types; label others UNVERIFIED |
| Stale or non-operative legal corpus | Outdated or invalid legal context | Status fields, effective dates, periodic re-verification, source versioning |
| Legal gold-set availability | Weak legal evaluation | Secure expert reviewer early; smaller reviewed set preferred over larger unreviewed |
| Pseudonymization hurts utility | Lower retrieval/grounding quality | Measure per level; recommend L2 default |
| Embedding leakage | Residual exposure of text | Local encrypted storage; evaluate pseudonymized embeddings |
| Entity false positives | Incorrect links | Confidence scores + investigator verification |
| Timestamp inconsistencies | Incorrect timeline | Normalize time zones, preserve originals, flag skew |
| Prompt injection | Manipulated output | Evidence isolation + verifier + adversarial testing |
| Hash overclaim | Misleading forensic interpretation | Present hashing as integrity support, not admissibility proof |
| Over-scoping | Unfinished Core features | Tiers, cut rule and weekly exit checks |
| Hardware variance | Latency targets not met | State reference hardware; report other hardware separately |


# 22. Future Scope

- EVTX and PCAP ingestion.
- Full dual-LLM quarantine architecture for untrusted evidence processing.
- Graph-based attack-path reconstruction at scale.
- Distributed multi-node investigation.
- Case collaboration and full role-based access control.
- Federated/private retrieval across evidence repositories.
- Model-assisted parser generation with human verification.
- Advanced temporal and causal reasoning.
- Enterprise SIEM/SOAR integration and Sigma rule integration.
- Regional-language legal and query support beyond Hindi/Hinglish.
- A public benchmark for privacy-preserving, verifiable forensic natural-language queries (extending ForensicLens-Bench-lite).
# 23. Final Product Definition

ForensicLens is an offline-first, AI-assisted digital forensic investigation platform that converts heterogeneous logs into normalized, cryptographically verifiable evidence; combines structured and semantic retrieval to answer natural-language investigation questions; reconstructs cross-source sessions, timelines and entity relationships; uses a local LLM, fed pseudonymized minimal context, for evidence-grounded reasoning whose claims are machine-verified against the evidence store; and retrieves potentially relevant Indian legal provisions, with status and elements-of-offence coverage, without requiring forensic evidence to be sent to external AI services.

The product’s principal differentiator is not the isolated use of AI, RAG, semantic search or legal retrieval. Its research and product contribution is the integrated, measurable workflow connecting hybrid forensic retrieval, provenance, cross-source correlation, claim-level verification, a measured privacy-utility trade-off, elements-based Indian legal mapping and prompt-injection robustness.

# Appendix A: Recommended Technology Stack

| **Layer** | **Technology** |
| --- | --- |
| Frontend | React + JavaScript/TypeScript |
| Backend | Python + FastAPI |
| Structured DB | SQLite (FTS5) for MVP; PostgreSQL for scale; SQLCipher or equivalent for encryption at rest |
| Vector DB | ChromaDB (telemetry disabled) |
| Embeddings | Sentence Transformers / BGE-family model; BGE-M3 or similar for multilingual (Stretch) |
| Reranker | Cross-encoder reranker |
| Fusion | Reciprocal rank fusion (default); weighted/learned as ablations |
| Log templates | Drain3-style template mining (ablation) |
| Local LLM | llama.cpp + GGUF model with grammar-constrained (GBNF) JSON output |
| PII detection | Offline NER (for example Presidio or spaCy) plus rule-based patterns |
| Integrity | SHA-256; hash-chained audit log |
| Visualization | React timeline/graph components |
| Transport | HTTP/JSON over local TCP/IP with local authentication token |


# Appendix B: Evaluation Datasets

- **Primary (parser scope):** LogHub Linux, OpenSSH and Apache logs. Note that many LogHub files lack year and timezone, which exercises the timestamp rules in Section 10.2.
- **Investigation Q&A ground truth:** Splunk Boss of the SOC (BOTS) datasets provide investigation questions with answers; check licensing and convert to supported formats.
- **Attack-behaviour data:** OTRF Security Datasets (Mordor) and EVTX-ATTACK-SAMPLES, usable only after conversion to supported formats while EVTX ingestion is out of scope.
- **Forensic images and scenarios:** NIST CFReDS and Digital Corpora scenarios for realistic multi-source cases.
- **Supplementary network data:** CIC-IDS2017, CSE-CIC-IDS2018 and UNSW-NB15 (flow records rather than logs; use for supplementary event analysis only).
- **Enterprise authentication:** LANL cyber dataset for authentication and enterprise activity research.
- **Optional parser stress tests:** HDFS and BGL system logs; these are not forensic datasets and should not support forensic claims.
- **Synthetic:** ForensicLens-Bench-lite controlled multi-source incidents with known temporal and causal ground truth, and a legal gold set reviewed by an expert.
# Appendix C: Baselines and Related-Work Checklist

Complete before claiming novelty. Record, for each item, what it does and how ForensicLens differs.

- Plaso/log2timeline and Timesketch (timeline construction and analysis).
- ELK/Splunk-style keyword and query workflows.
- Velociraptor and Sigma rules (collection and detection).
- Text-to-SQL and natural-language log query research.
- GraphRAG and temporal knowledge-graph RAG approaches.
- Citation/attribution verification and claim-level fact-checking for RAG.
- Privacy-preserving LLM inference and PII anonymization for logs.
- Prompt-injection benchmarks and dual-LLM/quarantine patterns.
- Legal information retrieval, including Indian legal NLP datasets.