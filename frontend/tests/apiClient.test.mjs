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
});
