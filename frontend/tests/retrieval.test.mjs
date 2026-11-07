import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Forensic Retrieval Service Tests", () => {
  test("getRetrievalStatus invokes GET /api/cases/{caseId}/retrieval/status with URL encoding", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedMethod = "";

    try {
      globalThis.fetch = async (url, init) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "GET";
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            caseId: "CASE 2026/01",
            totalRecords: 240,
            indexedRecords: 240,
            isIndexed: true,
            indexStatus: "READY",
            embeddingModel: "BAAI/bge-small-en-v1.5",
            rerankerModel: "BAAI/bge-reranker-base",
            embeddingModelReady: true,
            rerankerModelReady: true,
            offlineMode: true,
            lastIndexedAt: "2026-01-15T12:00:00Z",
          }),
        };
      };

      const { getRetrievalStatus } = await import("../src/services/retrieval.ts");
      const res = await getRetrievalStatus("CASE 2026/01");

      assert.equal(requestedMethod, "GET");
      assert.ok(
        requestedUrl.includes("/api/cases/CASE%202026%2F01/retrieval/status"),
        `Expected encoded URL, received: ${requestedUrl}`
      );
      assert.equal(res.caseId, "CASE 2026/01");
      assert.equal(res.totalRecords, 240);
      assert.equal(res.indexedRecords, 240);
      assert.equal(res.isIndexed, true);
      assert.equal(res.indexStatus, "READY");
      assert.equal(res.embeddingModel, "BAAI/bge-small-en-v1.5");
      assert.equal(res.rerankerModel, "BAAI/bge-reranker-base");
      assert.equal(res.embeddingModelReady, true);
      assert.equal(res.rerankerModelReady, true);
      assert.equal(res.offlineMode, true);
      assert.equal(res.lastIndexedAt, "2026-01-15T12:00:00Z");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getRetrievalStatus handles HTTP 404 when case does not exist", async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => ({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ detail: "Forensic case 'CASE-MISSING' does not exist." }),
      });

      const { getRetrievalStatus } = await import("../src/services/retrieval.ts");
      const { ApiError } = await import("../src/services/apiClient.ts");

      await assert.rejects(
        async () => {
          await getRetrievalStatus("CASE-MISSING");
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 404);
          assert.ok(err.message.includes("CASE-MISSING"));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("indexCase invokes POST with default incremental payload", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedMethod = "";
    let sentBody = "";

    try {
      globalThis.fetch = async (url, init) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "POST";
        sentBody = String(init?.body || "");
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            caseId: "CASE-001",
            indexedCount: 35,
            totalIndexed: 240,
            status: "COMPLETED",
            message: "Indexed 35 new source records into ChromaDB.",
          }),
        };
      };

      const { indexCase } = await import("../src/services/retrieval.ts");
      const res = await indexCase("CASE-001");

      assert.equal(requestedMethod, "POST");
      assert.ok(requestedUrl.includes("/api/cases/CASE-001/retrieval/index"));
      const body = JSON.parse(sentBody);
      assert.equal(body.rebuild, false);
      assert.equal(body.batchSize, 32);
      assert.equal(res.indexedCount, 35);
      assert.equal(res.totalIndexed, 240);
      assert.equal(res.status, "COMPLETED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("indexCase invokes POST with custom rebuild and batchSize parameters", async () => {
    const originalFetch = globalThis.fetch;
    let sentBody = "";

    try {
      globalThis.fetch = async (_url, init) => {
        sentBody = String(init?.body || "");
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            caseId: "CASE-001",
            indexedCount: 240,
            totalIndexed: 240,
            status: "COMPLETED",
            message: "Case vector collection rebuilt from scratch.",
          }),
        };
      };

      const { indexCase } = await import("../src/services/retrieval.ts");
      const res = await indexCase("CASE-001", { rebuild: true, batchSize: 64 });

      const body = JSON.parse(sentBody);
      assert.equal(body.rebuild, true);
      assert.equal(body.batchSize, 64);
      assert.equal(res.totalIndexed, 240);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("searchCaseEvidence preserves active filters and serializes complete request body", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedMethod = "";
    let sentBody = "";

    try {
      globalThis.fetch = async (url, init) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "POST";
        sentBody = String(init?.body || "");
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            items: [
              {
                documentId: "DOC_RAW_01",
                rawRecordId: "RAW_01",
                eventId: "EVT_01",
                evidenceId: "EV_01",
                originalFilename: "auth.log",
                recordNo: 5,
                lineNumber: 12,
                byteStart: 320,
                byteEnd: 410,
                text: "Failed password for invalid user admin from 192.168.1.50 port 49152 ssh2",
                timestamp: "2026-01-15T10:20:30Z",
                eventType: "INVALID_USER",
                severity: "WARNING",
                user: "admin",
                srcIp: "192.168.1.50",
                lexicalRank: 1,
                semanticRank: 2,
                rrfScore: 0.0325,
                rerankScore: 0.962,
                finalRank: 1,
              },
            ],
            total: 1,
            retrievalMode: "HYBRID_RERANKED",
            query: "unauthorized admin ssh login attempts",
            caseId: "CASE-001",
          }),
        };
      };

      const { searchCaseEvidence } = await import("../src/services/retrieval.ts");
      const res = await searchCaseEvidence("CASE-001", {
        query: "unauthorized admin ssh login attempts",
        topK: 15,
        mode: "HYBRID_RERANKED",
        lexicalCandidates: 40,
        semanticCandidates: 40,
        rerankCandidates: 25,
        filters: {
          eventType: "INVALID_USER",
          severity: "WARNING",
          user: "admin",
          srcIp: "192.168.1.50",
          fromTime: "2026-01-15T10:00:00Z",
          toTime: "2026-01-15T12:00:00Z",
          evidenceId: "EV_01",
        },
      });

      assert.equal(requestedMethod, "POST");
      assert.ok(requestedUrl.includes("/api/cases/CASE-001/retrieval/search"));

      const body = JSON.parse(sentBody);
      assert.equal(body.query, "unauthorized admin ssh login attempts");
      assert.equal(body.topK, 15);
      assert.equal(body.mode, "HYBRID_RERANKED");
      assert.equal(body.lexicalCandidates, 40);
      assert.equal(body.semanticCandidates, 40);
      assert.equal(body.rerankCandidates, 25);
      assert.deepEqual(body.filters, {
        eventType: "INVALID_USER",
        severity: "WARNING",
        user: "admin",
        srcIp: "192.168.1.50",
        fromTime: "2026-01-15T10:00:00Z",
        toTime: "2026-01-15T12:00:00Z",
        evidenceId: "EV_01",
      });

      assert.equal(res.total, 1);
      assert.equal(res.items.length, 1);
      const item = res.items[0];
      assert.equal(item.documentId, "DOC_RAW_01");
      assert.equal(item.rawRecordId, "RAW_01");
      assert.equal(item.eventId, "EVT_01");
      assert.equal(item.lineNumber, 12);
      assert.equal(item.byteStart, 320);
      assert.equal(item.byteEnd, 410);
      assert.equal(item.finalRank, 1);
      assert.equal(item.rerankScore, 0.962);
      assert.equal(item.rrfScore, 0.0325);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("searchCaseEvidence omits empty and 'ALL' filters from request payload", async () => {
    const originalFetch = globalThis.fetch;
    let sentBody = "";

    try {
      globalThis.fetch = async (_url, init) => {
        sentBody = String(init?.body || "");
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            items: [],
            total: 0,
            retrievalMode: "KEYWORD_ONLY",
            query: "sshd",
            caseId: "CASE-001",
          }),
        };
      };

      const { searchCaseEvidence } = await import("../src/services/retrieval.ts");
      await searchCaseEvidence("CASE-001", {
        query: "sshd",
        mode: "KEYWORD_ONLY",
        filters: {
          eventType: "ALL",
          severity: "ALL",
          user: "   ",
          srcIp: "",
          fromTime: "",
          toTime: "",
          evidenceId: "",
        },
      });

      const body = JSON.parse(sentBody);
      assert.equal(body.query, "sshd");
      assert.equal(body.mode, "KEYWORD_ONLY");
      assert.equal(body.filters, undefined, "Expected filters key to be omitted when all values are empty");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("searchCaseEvidence handles unnormalized records with null eventId", async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          items: [
            {
              documentId: "DOC_RAW_UNPARSED",
              rawRecordId: "RAW_UNPARSED",
              eventId: null,
              evidenceId: "EV_SYS_01",
              originalFilename: "syslog",
              recordNo: 99,
              lineNumber: 99,
              byteStart: 5000,
              byteEnd: 5080,
              text: "kernel: [12345.678] audit: type=1400 apparmor=DENIED",
              timestamp: null,
              eventType: null,
              severity: null,
              user: null,
              srcIp: null,
              lexicalRank: 1,
              semanticRank: null,
              rrfScore: null,
              rerankScore: null,
              finalRank: 1,
            },
          ],
          total: 1,
          retrievalMode: "KEYWORD_ONLY",
          query: "apparmor DENIED",
          caseId: "CASE-001",
        }),
      });

      const { searchCaseEvidence } = await import("../src/services/retrieval.ts");
      const res = await searchCaseEvidence("CASE-001", {
        query: "apparmor DENIED",
        mode: "KEYWORD_ONLY",
      });

      assert.equal(res.total, 1);
      assert.equal(res.items[0].eventId, null);
      assert.equal(res.items[0].documentId, "DOC_RAW_UNPARSED");
      assert.equal(res.items[0].lineNumber, 99);
      assert.ok(res.items[0].text.includes("apparmor=DENIED"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("searchCaseEvidence propagates HTTP 503 Service Unavailable when model is not ready", async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => ({
        ok: false,
        status: 503,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          detail: "Local embedding model 'BAAI/bge-small-en-v1.5' weights are not initialized or ready.",
        }),
      });

      const { searchCaseEvidence } = await import("../src/services/retrieval.ts");
      const { ApiError } = await import("../src/services/apiClient.ts");

      await assert.rejects(
        async () => {
          await searchCaseEvidence("CASE-001", {
            query: "unauthorized root login",
            mode: "SEMANTIC_ONLY",
          });
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 503);
          assert.ok(err.message.includes("weights are not initialized or ready"));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Fixture mode explicitly disables search and indexing without fabricating scores", async () => {
    const { isApiMode, resolveApiMode } = await import("../src/services/apiClient.ts");
    const { getRetrievalStatus, indexCase, searchCaseEvidence } = await import("../src/services/retrieval.ts");

    // Verify production isApiMode is an immutable constant and resolveApiMode defaults to it
    assert.equal(typeof isApiMode, "boolean");
    assert.equal(resolveApiMode(), isApiMode);
    assert.equal(resolveApiMode(undefined), isApiMode);
    assert.equal(resolveApiMode(false), false);
    assert.equal(resolveApiMode(true), true);

    // 1. Status indicates fixture mode without fabricating readiness
    const status = await getRetrievalStatus("CASE-FIXTURE", { apiMode: false });
    assert.equal(status.caseId, "CASE-FIXTURE");
    assert.equal(status.isIndexed, false);
    assert.equal(status.indexedRecords, 0);
    assert.equal(status.indexStatus, "FIXTURE_MODE");
    assert.equal(status.embeddingModelReady, false);
    assert.equal(status.rerankerModelReady, false);
    assert.equal(status.lastIndexedAt, null);

    // 2. Indexing is explicitly rejected
    await assert.rejects(
      async () => {
        await indexCase("CASE-FIXTURE", undefined, { apiMode: false });
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("Vector indexing is unavailable in fixture mode"));
        return true;
      }
    );

    // 3. Retrieval search is explicitly rejected without generating artificial RRF/rerank scores
    await assert.rejects(
      async () => {
        await searchCaseEvidence("CASE-FIXTURE", { query: "root login" }, { apiMode: false });
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("Forensic retrieval search is disabled in fixture mode"));
        return true;
      }
    );

    // Verify calling without override retains live API mode and does not leak
    assert.equal(resolveApiMode(), isApiMode);
  });
});
