import { useEffect, useState } from "react";
import { Moon, Sun, Server, Shield, SlidersHorizontal, Palette, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Panel } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/Tabs";
import { KeyValueList } from "@/components/ui/DataDisplay";
import { Notice } from "@/components/common/Notice";
import { DataModeBadge } from "@/components/common/DataModeBadge";
import { useTheme } from "@/context/ThemeContext";
import { API_BASE_URL, DATA_MODE } from "@/services/apiClient";
import { getBackendHealth, type BackendHealth } from "@/services/system";
import { formatDateTime } from "@/lib/formatters";

const PRIVACY_LEVELS = [
  {
    id: "L0",
    name: "Raw (unredacted)",
    detail: "No token replacement. Raw evidence strings, IPs and usernames are passed to the local model.",
  },
  {
    id: "L1",
    name: "Basic redaction",
    detail: "Masks passwords, tokens and card/PAN patterns. Usernames and hostnames remain visible.",
  },
  {
    id: "L2",
    name: "Deterministic pseudonymization",
    detail: "Reversible entity tokens (USER_01, PRIV_IP_01). Public IPs stay intact for threat context.",
  },
  {
    id: "L3",
    name: "Strict",
    detail: "All IPs, usernames, paths and command arguments are tokenized into opaque identifiers.",
  },
];

function PlannedBadge() {
  return <Badge variant="outline">Planned</Badge>;
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setHealth(await getBackendHealth());
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void check();
  }, []);

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" description="Workspace preferences and the current connection to the ForensicLens backend." />

      <div className="space-y-5">
        <Panel title="Appearance" icon={<Palette />}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-text-primary">Theme</p>
              <p className="text-xs text-text-muted">Dark graphite is the default investigation workspace. Stored in this browser only.</p>
            </div>
            <SegmentedControl<"dark" | "light">
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "dark", label: "Dark", icon: <Moon /> },
                { value: "light", label: "Light", icon: <Sun /> },
              ]}
            />
          </div>
        </Panel>

        <Panel
          title="Backend connection"
          icon={<Server />}
          actions={
            <Button variant="ghost" size="sm" onClick={check} loading={checking}>
              {!checking && <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
              Re-check
            </Button>
          }
        >
          <KeyValueList
            items={[
              { label: "Data mode", value: <span className="inline-flex items-center gap-2"><DataModeBadge /><span className="font-mono text-text-muted">VITE_DATA_MODE={DATA_MODE}</span></span> },
              { label: "API base URL", value: API_BASE_URL || "Same origin (dev proxy → 127.0.0.1:8000)", mono: true },
              {
                label: "Backend health",
                value: !health ? (
                  "Checking…"
                ) : health.state === "online" ? (
                  <span className="text-status-success">Online{health.service ? ` · ${health.service}` : ""}</span>
                ) : health.state === "fixture" ? (
                  <span className="text-status-warning">Not used — fixture data mode</span>
                ) : (
                  <span className="text-status-danger">Unreachable{health.error ? ` · ${health.error}` : ""}</span>
                ),
              },
              { label: "Last checked (UTC)", value: health ? formatDateTime(health.checkedAt) : null, mono: true },
            ]}
          />
          <p className="mt-3 text-2xs text-text-muted">
            Data mode and API URL are build-time settings. Change them in the frontend <code className="font-mono">.env</code> and restart the dev server.
          </p>
        </Panel>

        <Panel title="Privacy & pseudonymization" icon={<Shield />} actions={<PlannedBadge />}>
          <Notice tone="info" className="mb-3">
            Privacy levels are part of the platform design but are not yet configurable from the UI. They are listed here for
            reference only; nothing on this page changes how evidence is processed.
          </Notice>
          <ol className="divide-y divide-border-subtle rounded border border-border">
            {PRIVACY_LEVELS.map((l) => (
              <li key={l.id} className="grid grid-cols-[44px_1fr] gap-3 px-3 py-2.5">
                <span className="font-mono text-sm font-semibold text-text-secondary">{l.id}</span>
                <span>
                  <span className="block text-sm text-text-primary">{l.name}</span>
                  <span className="block text-xs text-text-muted">{l.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Retrieval & verification parameters" icon={<SlidersHorizontal />} actions={<PlannedBadge />}>
          <p className="text-xs leading-relaxed text-text-muted">
            Global defaults such as the RRF k-constant and the verification execution timeout are defined by the backend and
            cannot be edited here yet. Per-search candidate depths (lexical, semantic and rerank pools) and Top-K can be set
            directly in the Retrieval Explorer.
          </p>
        </Panel>
      </div>
    </div>
  );
}
