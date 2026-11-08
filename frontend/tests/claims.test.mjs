import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("Forensic Claim Verification Service Tests", () => {
  // -------------------------------------------------------------------------
  // 1. extractClaims
  // -------------------------------------------------------------------------
  test("extractClaims invokes POST /api/cases/{caseId}/claims/extract with URL encoding and payload", async () => {
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
            caseId: "CASE 2026/01",
            query: "Did user admin log in from 192.168.1.50?",
            extractedClaims: [
              {
                claimId: "CLM-001",
                caseId: "CASE 2026/01",
                investigationId: "INV-1",
                claimType: "AUTH_SUCCESS",
                statement: "User admin logged in from 192.168.1.50",
                subject: "admin",
                action: "AUTH_SUCCESS",
                object: null,
                sourceIp: "192.168.1.50",
                destinationIp: null,
                sourcePort: null,
                timestampClaimed: "2026-01-15T10:00:00Z",
                timeRangeStart: null,
                timeRangeEnd: null,
                attributes: {},
                modelOutputJson: null,
                extractionMethod: "DETERMINISTIC_FAKE",
                compilerVersion: "1.0.0",
                confidence: 0.95,
                evidenceReferences: [
                  {
                    claimEvidenceId: "CEV-001",
                    claimId: "CLM-001",
                    evidenceId: "EV-001",
                    rawRecordId: "RAW-1",
                    eventId: "EVT-1",
                    role: "PRIMARY_CITING",
                    recordNo: 1,
                    lineNumber: 10,
                    byteStart: 100,
                    byteEnd: 200,
                    snippet: "Accepted password for admin from 192.168.1.50 port 22",
                    relevanceScore: 0.88,
                    createdAt: "2026-01-15T10:05:00Z",
                  },
                ],
                currentStatus: "UNVERIFIED",
                createdAt: "2026-01-15T10:05:00Z",
              },
            ],
            evidenceRetrievedCount: 5,
            extractionMethod: "DETERMINISTIC_FAKE",
            modelIdentifier: "fake-deterministic-extractor",
            warnings: [],
            omittedEvidenceCount: 0,
            truncatedEvidenceCount: 0,
          }),
        };
      };

      const { extractClaims } = await import("../src/services/claims.ts");
      const res = await extractClaims(
        "CASE 2026/01",
        {
          query: "Did user admin log in from 192.168.1.50?",
          retrievalMode: "HYBRID",
          retrievalLimit: 20,
          investigationId: "INV-1",
        },
        { apiMode: true }
      );

      assert.equal(requestedMethod, "POST");
      assert.ok(
        requestedUrl.includes("/api/cases/CASE%202026%2F01/claims/extract"),
        `Expected encoded URL, received: ${requestedUrl}`
      );

      const parsedBody = JSON.parse(sentBody);
      assert.equal(parsedBody.query, "Did user admin log in from 192.168.1.50?");
      assert.equal(parsedBody.retrievalMode, "HYBRID");
      assert.equal(parsedBody.retrievalLimit, 20);
      assert.equal(parsedBody.investigationId, "INV-1");

      assert.equal(res.caseId, "CASE 2026/01");
      assert.equal(res.extractedClaims.length, 1);
      assert.equal(res.extractedClaims[0].claimId, "CLM-001");
      assert.equal(res.extractedClaims[0].currentStatus, "UNVERIFIED");
      assert.equal(res.extractedClaims[0].confidence, 0.95);
      assert.equal(res.evidenceRetrievedCount, 5);
      assert.equal(res.extractedClaims[0].evidenceReferences.length, 1);
      assert.equal(res.extractedClaims[0].evidenceReferences[0].evidenceId, "EV-001");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("extractClaims handles HTTP 503 when LLM or retrieval model is not ready", async () => {
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => ({
        ok: false,
        status: 503,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ detail: "Local LLM provider unavailable for Step 10." }),
      });

      const { extractClaims } = await import("../src/services/claims.ts");
      const { ApiError } = await import("../src/services/apiClient.ts");

      await assert.rejects(
        async () => {
          await extractClaims(
            "CASE-01",
            { query: "Check root login" },
            { apiMode: true }
          );
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 503);
          assert.ok(err.message.includes("Local LLM provider unavailable"));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("extractClaims throws descriptive error in fixture mode without fabricating claims", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;

    try {
      globalThis.fetch = async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const { extractClaims } = await import("../src/services/claims.ts");

      await assert.rejects(
        async () => {
          await extractClaims(
            "CASE-01",
            { query: "Did admin login?" },
            { apiMode: false }
          );
        },
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("fixture mode"));
          assert.ok(err.message.includes("VITE_DATA_MODE=api"));
          return true;
        }
      );

      assert.equal(fetchCalled, false, "fetch should not be called in fixture mode");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 2. getCaseClaims
  // -------------------------------------------------------------------------
  test("getCaseClaims serializes filters and pagination parameters correctly", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    try {
      globalThis.fetch = async (url) => {
        requestedUrl = String(url);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            caseId: "CASE 2026/01",
            total: 1,
            claims: [
              {
                claimId: "CLM-002",
                caseId: "CASE 2026/01",
                claimType: "AUTH_FAILURE",
                statement: "Failed password for invalid user guest",
                action: "AUTH_FAILURE",
                confidence: null,
                evidenceReferences: [],
                currentStatus: "CONTRADICTED",
                createdAt: "2026-01-15T11:00:00Z",
                attributes: {},
                extractionMethod: "DETERMINISTIC_FAKE",
              },
            ],
            summary: {
              SUPPORTED: 3,
              CONTRADICTED: 1,
              UNVERIFIED: 2,
              INSUFFICIENT_EVIDENCE: 0,
            },
            page: 2,
            pageSize: 10,
            totalPages: 3,
          }),
        };
      };

      const { getCaseClaims } = await import("../src/services/claims.ts");
      const res = await getCaseClaims(
        "CASE 2026/01",
        {
          claimType: "AUTH_FAILURE",
          status: "CONTRADICTED",
          page: 2,
          pageSize: 10,
        },
        { apiMode: true }
      );

      assert.ok(requestedUrl.includes("/api/cases/CASE%202026%2F01/claims?"));
      assert.ok(requestedUrl.includes("claimType=AUTH_FAILURE"));
      assert.ok(requestedUrl.includes("status=CONTRADICTED"));
      assert.ok(requestedUrl.includes("page=2"));
      assert.ok(requestedUrl.includes("pageSize=10"));

      assert.equal(res.total, 1);
      assert.equal(res.summary.SUPPORTED, 3);
      assert.equal(res.summary.CONTRADICTED, 1);
      assert.equal(res.summary.UNVERIFIED, 2);
      assert.equal(res.summary.INSUFFICIENT_EVIDENCE, 0);
      assert.equal(res.claims[0].confidence, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getCaseClaims omits 'ALL' filters from query parameters", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    try {
      globalThis.fetch = async (url) => {
        requestedUrl = String(url);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            caseId: "CASE-01",
            total: 0,
            claims: [],
            summary: {},
            page: 1,
            pageSize: 50,
            totalPages: 1,
          }),
        };
      };

      const { getCaseClaims } = await import("../src/services/claims.ts");
      await getCaseClaims(
        "CASE-01",
        {
          claimType: "ALL",
          status: "ALL",
          page: 1,
          pageSize: 50,
        },
        { apiMode: true }
      );

      assert.ok(!requestedUrl.includes("claimType="));
      assert.ok(!requestedUrl.includes("status="));
      assert.ok(requestedUrl.includes("page=1"));
      assert.ok(requestedUrl.includes("pageSize=50"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getCaseClaims returns empty zero-summary state in fixture mode without network calls", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;

    try {
      globalThis.fetch = async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const { getCaseClaims } = await import("../src/services/claims.ts");
      const res = await getCaseClaims("CASE-01", undefined, { apiMode: false });

      assert.equal(fetchCalled, false, "fetch should not be called in fixture mode");
      assert.equal(res.total, 0);
      assert.equal(res.claims.length, 0);
      assert.equal(res.summary.SUPPORTED, 0);
      assert.equal(res.summary.CONTRADICTED, 0);
      assert.equal(res.summary.UNVERIFIED, 0);
      assert.equal(res.summary.INSUFFICIENT_EVIDENCE, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 3. verifyClaim
  // -------------------------------------------------------------------------
  test("verifyClaim invokes POST /api/cases/{caseId}/claims/{claimId}/verify with URL encoding", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedMethod = "";

    try {
      globalThis.fetch = async (url, init) => {
        requestedUrl = String(url);
        requestedMethod = init?.method || "POST";
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            verificationId: "VRF-001",
            claimId: "CLM 2026/01",
            status: "SUPPORTED",
            ruleId: "RULE_AUTH_SUCCESS_V1",
            ruleVersion: "1.0.0",
            predicateType: "EXACT_AUTH_MATCH",
            resolvedParameters: { subject: "admin", sourceIp: "192.168.1.50" },
            matchedRowCount: 1,
            evidenceRefs: ["EV-001"],
            supportingRecords: [{ event_id: "EVT-1", username: "admin" }],
            contradictingRecords: [],
            explanation: "Deterministic verification confirmed matching authentication success event.",
            failureReason: null,
            discrepancies: [],
            verifierVersion: "1.0.0",
            verifiedAt: "2026-01-15T10:10:00Z",
          }),
        };
      };

      const { verifyClaim } = await import("../src/services/claims.ts");
      const res = await verifyClaim("CASE 2026/01", "CLM 2026/01", { apiMode: true });

      assert.equal(requestedMethod, "POST");
      assert.ok(
        requestedUrl.includes("/api/cases/CASE%202026%2F01/claims/CLM%202026%2F01/verify"),
        `Expected encoded URL, received: ${requestedUrl}`
      );
      assert.equal(res.verificationId, "VRF-001");
      assert.equal(res.status, "SUPPORTED");
      assert.equal(res.ruleId, "RULE_AUTH_SUCCESS_V1");
      assert.equal(res.matchedRowCount, 1);
      assert.equal(res.supportingRecords.length, 1);
      assert.equal(res.discrepancies.length, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("verifyClaim throws descriptive error in fixture mode without fabricating results", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;

    try {
      globalThis.fetch = async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const { verifyClaim } = await import("../src/services/claims.ts");

      await assert.rejects(
        async () => {
          await verifyClaim("CASE-01", "CLM-001", { apiMode: false });
        },
        (err) => {
          assert.ok(err instanceof Error);
          assert.ok(err.message.includes("fixture mode"));
          assert.ok(err.message.includes("read-only SQLite"));
          return true;
        }
      );

      assert.equal(fetchCalled, false, "fetch should not be called in fixture mode");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // -------------------------------------------------------------------------
  // 4. getClaimHistory
  // -------------------------------------------------------------------------
  test("getClaimHistory retrieves append-only history with URL encoding", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    try {
      globalThis.fetch = async (url) => {
        requestedUrl = String(url);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => [
            {
              verificationId: "VRF-002",
              claimId: "CLM-001",
              status: "SUPPORTED",
              ruleId: "RULE_AUTH_SUCCESS_V1",
              ruleVersion: "1.0.0",
              predicateType: "EXACT_AUTH_MATCH",
              resolvedParameters: {},
              matchedRowCount: 1,
              evidenceRefs: ["EV-001"],
              supportingRecords: [],
              contradictingRecords: [],
              explanation: "Re-verified and confirmed supported.",
              failureReason: null,
              discrepancies: [],
              verifierVersion: "1.0.0",
              verifiedAt: "2026-01-15T12:00:00Z",
            },
            {
              verificationId: "VRF-001",
              claimId: "CLM-001",
              status: "INSUFFICIENT_EVIDENCE",
              ruleId: "RULE_AUTH_SUCCESS_V1",
              ruleVersion: "1.0.0",
              predicateType: "EXACT_AUTH_MATCH",
              resolvedParameters: {},
              matchedRowCount: 0,
              evidenceRefs: [],
              supportingRecords: [],
              contradictingRecords: [],
              explanation: "No evidence found prior to ingestion.",
              failureReason: "No matching authentication records found",
              discrepancies: [],
              verifierVersion: "1.0.0",
              verifiedAt: "2026-01-15T10:00:00Z",
            },
          ],
        };
      };

      const { getClaimHistory } = await import("../src/services/claims.ts");
      const history = await getClaimHistory("CASE 2026/01", "CLM-001", { apiMode: true });

      assert.ok(
        requestedUrl.includes("/api/cases/CASE%202026%2F01/claims/CLM-001/history"),
        `Expected encoded URL, received: ${requestedUrl}`
      );
      assert.equal(history.length, 2);
      assert.equal(history[0].status, "SUPPORTED");
      assert.equal(history[1].status, "INSUFFICIENT_EVIDENCE");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getClaimHistory returns empty array in fixture mode without network calls", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;

    try {
      globalThis.fetch = async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => [] };
      };

      const { getClaimHistory } = await import("../src/services/claims.ts");
      const history = await getClaimHistory("CASE-01", "CLM-001", { apiMode: false });

      assert.equal(fetchCalled, false, "fetch should not be called in fixture mode");
      assert.deepEqual(history, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
