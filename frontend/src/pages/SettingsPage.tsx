import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useTheme } from "@/context/ThemeContext";
import {
  Sun,
  Moon,
  WifiOff,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [privacyLevel, setPrivacyLevel] = useState<"L0" | "L1" | "L2" | "L3">("L2");
  const [rrfK, setRrfK] = useState<number>(60);
  const [timeoutSec, setTimeoutSec] = useState<number>(30);

  const handleSavePreferences = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Preferences Saved Locally (UI Foundation Mode)", {
      description: "Settings are held in browser state and will persist via SQLite case settings in Phase 3.",
    });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Settings & Workspace Configuration"
        description="Configure cryptographic pseudonymization levels, offline execution policies, and retrieval parameters. ForensicLens enforces strict air-gapped isolation by default."
      />

      <form onSubmit={handleSavePreferences} className="space-y-6">
        {/* 1. Appearance / Theme */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Appearance & Interface Theme</CardTitle>
            <CardDescription>
              Select light or dark workstation surface. Dark mode uses slate surfaces to maintain forensic clarity without eye fatigue.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={`flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all ${
                  theme === "light"
                    ? "border-accent bg-accent-subtle/50 text-accent font-semibold"
                    : "border-border bg-surface hover:bg-surface-subtle text-text-primary"
                }`}
              >
                <Sun className="w-4 h-4 text-amber-500" />
                <span className="text-xs">Light Workspace</span>
              </button>

              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={`flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all ${
                  theme === "dark"
                    ? "border-accent bg-accent-subtle/50 text-accent font-semibold"
                    : "border-border bg-surface hover:bg-surface-subtle text-text-primary"
                }`}
              >
                <Moon className="w-4 h-4 text-indigo-400" />
                <span className="text-xs">Dark Workspace</span>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* 2. Privacy & Pseudonymization (Established L0-L3 Levels) */}
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Privacy & Pseudonymization Vault</CardTitle>
              <Badge variant="accent">L2 ACTIVE</Badge>
            </div>
            <CardDescription>
              Controls what information is pseudonymized prior to prompting local LLM inference engines. Real identities remain safely inside the case database vault.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="space-y-2.5">
              {/* L0 */}
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  privacyLevel === "L0"
                    ? "border-accent bg-accent-subtle/40"
                    : "border-border hover:bg-surface-subtle"
                }`}
              >
                <input
                  type="radio"
                  name="privacy"
                  value="L0"
                  checked={privacyLevel === "L0"}
                  onChange={() => setPrivacyLevel("L0")}
                  className="mt-0.5 accent-accent"
                />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-text-primary flex items-center gap-1.5">
                    <span>L0 — Raw (Unredacted)</span>
                    <Badge variant="warning" className="text-[10px]">
                      RESTRICTED LABS ONLY
                    </Badge>
                  </div>
                  <div className="text-text-muted">
                    No token replacement. Raw evidence strings, public/private IPs, and usernames are sent directly to the local model.
                  </div>
                </div>
              </label>

              {/* L1 */}
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  privacyLevel === "L1"
                    ? "border-accent bg-accent-subtle/40"
                    : "border-border hover:bg-surface-subtle"
                }`}
              >
                <input
                  type="radio"
                  name="privacy"
                  value="L1"
                  checked={privacyLevel === "L1"}
                  onChange={() => setPrivacyLevel("L1")}
                  className="mt-0.5 accent-accent"
                />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-text-primary">
                    L1 — Basic Redaction
                  </div>
                  <div className="text-text-muted">
                    Masks plain passwords, authentication tokens, and credit card / PAN patterns. Usernames and hostnames remain unmasked.
                  </div>
                </div>
              </label>

              {/* L2 Recommended */}
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  privacyLevel === "L2"
                    ? "border-accent bg-accent-subtle/40"
                    : "border-border hover:bg-surface-subtle"
                }`}
              >
                <input
                  type="radio"
                  name="privacy"
                  value="L2"
                  checked={privacyLevel === "L2"}
                  onChange={() => setPrivacyLevel("L2")}
                  className="mt-0.5 accent-accent"
                />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-text-primary flex items-center gap-1.5">
                    <span>L2 — Recommended (Deterministic Pseudonymization)</span>
                    <Badge variant="verified" className="text-[10px]">
                      DEFAULT & RECOMMENDED
                    </Badge>
                  </div>
                  <div className="text-text-muted">
                    Reversible entity tokens: replaces usernames with <code>USER_01</code>, private IPs with <code>PRIV_IP_01</code>, and internal hostnames. Public IPs remain intact for threat intelligence context.
                  </div>
                </div>
              </label>

              {/* L3 */}
              <label
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  privacyLevel === "L3"
                    ? "border-accent bg-accent-subtle/40"
                    : "border-border hover:bg-surface-subtle"
                }`}
              >
                <input
                  type="radio"
                  name="privacy"
                  value="L3"
                  checked={privacyLevel === "L3"}
                  onChange={() => setPrivacyLevel("L3")}
                  className="mt-0.5 accent-accent"
                />
                <div className="text-xs space-y-0.5">
                  <div className="font-semibold text-text-primary">
                    L3 — Strict (Maximum Obfuscation)
                  </div>
                  <div className="text-text-muted">
                    All IPs (public and private), usernames, file paths, and command arguments are tokenized into opaque identifiers.
                  </div>
                </div>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* 3. Offline Execution & Network Egress Guarantee */}
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Air-Gapped Execution Security</CardTitle>
              <Badge variant="verified" icon={<WifiOff className="w-3 h-3" />}>
                EGRESS BLOCKED
              </Badge>
            </div>
            <CardDescription>
              Hard architectural boundaries guarantee zero cloud data leakage.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded border border-border bg-surface-subtle space-y-1">
                <div className="font-semibold text-text-primary flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
                  Telemetry Disabled
                </div>
                <div className="text-[11px] text-text-muted font-mono">
                  CHROMA_TELEMETRY=false, HF_HUB_OFFLINE=1
                </div>
              </div>

              <div className="p-3 rounded border border-border bg-surface-subtle space-y-1">
                <div className="font-semibold text-text-primary flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-status-success" />
                  Loopback Network Binding
                </div>
                <div className="text-[11px] text-text-muted font-mono">
                  127.0.0.1 exclusive interface binding
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4. Retrieval & Verification Parameters */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Retrieval & Compiler Predicate Parameters</CardTitle>
            <CardDescription>
              Tunable settings for hybrid retrieval fusion and read-only predicate evaluation.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="font-semibold text-text-primary block mb-1">
                  Reciprocal Rank Fusion (RRF) k-constant
                </label>
                <input
                  type="number"
                  min={10}
                  max={100}
                  value={rrfK}
                  onChange={(e) => setRrfK(parseInt(e.target.value) || 60)}
                  className="w-full h-8 px-3 rounded border border-border bg-surface text-xs font-mono"
                />
                <span className="text-[11px] text-text-muted mt-1 block">
                  Default k=60 balances lexical FTS5 matches and dense vector embeddings.
                </span>
              </div>

              <div>
                <label className="font-semibold text-text-primary block mb-1">
                  Verification Execution Timeout (Seconds)
                </label>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={timeoutSec}
                  onChange={(e) => setTimeoutSec(parseInt(e.target.value) || 30)}
                  className="w-full h-8 px-3 rounded border border-border bg-surface text-xs font-mono"
                />
                <span className="text-[11px] text-text-muted mt-1 block">
                  Maximum execution window for compiler-owned SQL predicate evaluation.
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-border-subtle flex justify-end">
              <Button type="submit" variant="default" size="sm">
                Save Workspace Configuration
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
