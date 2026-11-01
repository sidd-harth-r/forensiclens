import { SystemStatus } from "@/types/system";

export const FIXTURE_SYSTEM_STATUS: SystemStatus = {
  backend: {
    name: "FastAPI Engine",
    status: "healthy",
    description: "ASGI service operational on 127.0.0.1:8000 (v0.162.0)",
    metric: "Uptime 100%",
    lastChecked: "Just now",
  },
  database: {
    name: "SQLite + FTS5",
    status: "healthy",
    description: "Case-isolated databases with WAL mode and foreign key enforcement",
    metric: "20 tables / 0 deadlocks",
    lastChecked: "Just now",
  },
  searchIndex: {
    name: "FTS5 Lexical Index",
    status: "healthy",
    description: "External content table synced with events",
    metric: "1,420 events indexed",
    lastChecked: "Just now",
  },
  localLlm: {
    name: "Local llama.cpp (Offline)",
    status: "healthy",
    description: "GBNF grammar-constrained JSON inference (air-gapped)",
    metric: "GGUF Q4_K_M ready",
    lastChecked: "Just now",
  },
  networkEgress: {
    name: "Air-gap Isolation",
    status: "isolated",
    description: "Zero external network traffic. Telemetry disabled, cloud egress blocked.",
    metric: "0 bytes transmitted externally",
    lastChecked: "Strict loopback active",
  },
  isOfflineIsolated: true,
};

