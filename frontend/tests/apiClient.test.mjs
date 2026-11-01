import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("API Client & Services Tests", () => {
  test("ApiError class sets status, message, and details correctly", async () => {
    const { ApiError } = await import("../src/services/apiClient.ts");
    const error = new ApiError(404, "Case not found", { caseId: "CASE-999" });
    assert.equal(error.status, 404);
    assert.equal(error.message, "Case not found");
    assert.deepEqual(error.details, { caseId: "CASE-999" });
    assert.equal(error.name, "ApiError");
  });

  test("apiClient.get parses successful JSON responses", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url) => {
        assert.ok(String(url).includes("/api/cases"));
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => [{ caseId: "CASE-MOCK", name: "Mock Test Case" }],
        };
      };

      const { apiClient } = await import("../src/services/apiClient.ts");
      const res = await apiClient.get("/api/cases");
      assert.equal(Array.isArray(res), true);
      assert.equal(res[0].caseId, "CASE-MOCK");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("apiClient.get handles 404 with structured ApiError detail", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 404,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ detail: "Forensic case not found in repository." }),
        };
      };

      const { apiClient, ApiError } = await import("../src/services/apiClient.ts");
      await assert.rejects(
        async () => {
          await apiClient.get("/api/cases/CASE-MISSING");
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 404);
          assert.equal(err.message, "Forensic case not found in repository.");
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("apiClient.get handles query parameter serialization", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    try {
      globalThis.fetch = async (url) => {
        requestedUrl = String(url);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ items: [], total: 0 }),
        };
      };

      const { apiClient } = await import("../src/services/apiClient.ts");
      await apiClient.get("/api/cases/CASE-1/events", {
        page: 2,
        page_size: 25,
        search: "root",
        empty_val: undefined,
      });

      assert.ok(requestedUrl.includes("page=2"));
      assert.ok(requestedUrl.includes("page_size=25"));
      assert.ok(requestedUrl.includes("search=root"));
      assert.ok(!requestedUrl.includes("empty_val"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("apiClient.post sends JSON payload and parses response", async () => {
    const originalFetch = globalThis.fetch;
    let sentMethod = "";
    let sentBody = "";
    try {
      globalThis.fetch = async (_url, options) => {
        sentMethod = options?.method;
        sentBody = options?.body;
        return {
          ok: true,
          status: 201,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ caseId: "CASE-NEW", name: "Created Case" }),
        };
      };

      const { apiClient } = await import("../src/services/apiClient.ts");
      const res = await apiClient.post("/api/cases", { name: "Created Case" });
      assert.equal(sentMethod, "POST");
      assert.ok(sentBody.includes("Created Case"));
      assert.equal(res.caseId, "CASE-NEW");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("apiClient.postFormData sends FormData payload", async () => {
    const originalFetch = globalThis.fetch;
    let sentMethod = "";
    let sentBody = null;
    try {
      globalThis.fetch = async (_url, options) => {
        sentMethod = options?.method;
        sentBody = options?.body;
        return {
          ok: true,
          status: 201,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ evidenceId: "EV_NEW", originalName: "test.log" }),
        };
      };

      const { apiClient } = await import("../src/services/apiClient.ts");
      const fd = new FormData();
      fd.append("filename", "test.log");
      const res = await apiClient.postFormData("/api/cases/CASE-1/evidence", fd);
      assert.equal(sentMethod, "POST");
      assert.ok(sentBody instanceof FormData);
      assert.equal(res.evidenceId, "EV_NEW");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("apiClient.post handles evidence process endpoint correctly", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedMethod = "";
    let requestedBody = null;
    try {
      globalThis.fetch = async (url, options) => {
        requestedUrl = String(url);
        requestedMethod = options?.method;
        requestedBody = options?.body ? JSON.parse(options.body) : null;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            caseId: "CASE-2026-001",
            evidenceId: "EV_TEST_01",
            parserName: "openssh",
            parserVersion: "1.0.0",
            rawRecordsCount: 42,
            eventsCount: 38,
            unparsedRecordsCount: 4,
            status: "PARSED",
            errorSummary: null,
          }),
        };
      };

      const { apiClient } = await import("../src/services/apiClient.ts");
      const res = await apiClient.post(
        "/api/cases/CASE-2026-001/evidence/EV_TEST_01/process",
        { parserName: "OPENSSH" }
      );

      assert.ok(requestedUrl.includes("/api/cases/CASE-2026-001/evidence/EV_TEST_01/process"));
      assert.equal(requestedMethod, "POST");
      assert.deepEqual(requestedBody, { parserName: "OPENSSH" });
      assert.equal(res.status, "PARSED");
      assert.equal(res.eventsCount, 38);
      assert.equal(res.rawRecordsCount, 42);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("apiClient.post handles 409 conflict when evidence is already processed", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 409,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            detail: "Evidence EV_ALREADY_PROCESSED has already been parsed and persisted into case CASE-1.",
          }),
        };
      };

      const { apiClient, ApiError } = await import("../src/services/apiClient.ts");

      await assert.rejects(
        async () => {
          await apiClient.post("/api/cases/CASE-1/evidence/EV_ALREADY_PROCESSED/process");
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 409);
          assert.ok(err.message.includes("already been parsed and persisted"));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("apiClient.get queries events with comprehensive filters and search", async () => {
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
            items: [
              {
                eventId: "EVT-001",
                eventType: "AUTH_FAILURE",
                severity: "WARNING",
                userValue: "root",
                srcIp: "192.168.1.100",
                message: "Failed password for root",
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          }),
        };
      };

      const { apiClient } = await import("../src/services/apiClient.ts");
      const res = await apiClient.get("/api/cases/CASE-ALPHA/events", {
        page: 1,
        page_size: 20,
        search: "root",
        event_type: "AUTH_FAILURE",
        severity: "WARNING",
        user: "root",
        src_ip: "192.168.1.100",
        from: "2026-01-15T10:00:00",
        to: "2026-01-15T11:00:00",
      });

      assert.ok(requestedUrl.includes("/api/cases/CASE-ALPHA/events"));
      assert.ok(requestedUrl.includes("search=root"));
      assert.ok(requestedUrl.includes("event_type=AUTH_FAILURE"));
      assert.ok(requestedUrl.includes("severity=WARNING"));
      assert.ok(requestedUrl.includes("user=root"));
      assert.ok(requestedUrl.includes("src_ip=192.168.1.100"));
      assert.ok(requestedUrl.includes("from=2026-01-15T10%3A00%3A00"));
      assert.ok(requestedUrl.includes("to=2026-01-15T11%3A00%3A00"));
      assert.equal(res.total, 1);
      assert.equal(res.items[0].eventId, "EVT-001");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("apiClient.get retrieves single event detail with raw evidence text and provenance", async () => {
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
            eventId: "EVT-001",
            caseId: "CASE-ALPHA",
            evidenceId: "EV_ALPHA_1",
            rawRecordId: "RAW_ALPHA_1",
            eventType: "AUTH_FAILURE",
            severity: "WARNING",
            userValue: "root",
            srcIp: "192.168.1.100",
            message: "Failed password for root",
            lineNumber: 42,
            byteStart: 1024,
            byteEnd: 1100,
            eventHash: "a1b2c3d4e5f6...",
            rawText: "Jan 15 10:20:30 server sshd[1234]: Failed password for root",
            evidenceOriginalName: "auth.log",
            evidenceFormat: "OPENSSH",
            recordNo: 42,
          }),
        };
      };

      const { apiClient } = await import("../src/services/apiClient.ts");
      const res = await apiClient.get("/api/cases/CASE-ALPHA/events/EVT-001");

      assert.ok(requestedUrl.includes("/api/cases/CASE-ALPHA/events/EVT-001"));
      assert.equal(res.eventId, "EVT-001");
      assert.equal(res.rawText, "Jan 15 10:20:30 server sshd[1234]: Failed password for root");
      assert.equal(res.evidenceOriginalName, "auth.log");
      assert.equal(res.evidenceFormat, "OPENSSH");
      assert.equal(res.lineNumber, 42);
      assert.equal(res.byteStart, 1024);
      assert.equal(res.byteEnd, 1100);
      assert.ok(res.eventHash);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("apiClient.get handles 404 for nonexistent event ID", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        return {
          ok: false,
          status: 404,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            detail: "Forensic event 'EVT_MISSING' not found in case 'CASE-ALPHA'.",
          }),
        };
      };

      const { apiClient, ApiError } = await import("../src/services/apiClient.ts");

      await assert.rejects(
        async () => {
          await apiClient.get("/api/cases/CASE-ALPHA/events/EVT_MISSING");
        },
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 404);
          assert.ok(err.message.includes("not found in case 'CASE-ALPHA'"));
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
