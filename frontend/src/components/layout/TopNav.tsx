import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useCase } from "@/context/CaseContext";
import { useTheme } from "@/context/ThemeContext";
import { OfflineIndicator } from "@/components/common/OfflineIndicator";
import {
  FolderKanban,
  ChevronDown,
  Sun,
  Moon,
  Check,
  Menu,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface TopNavProps {
  onToggleSidebar?: () => void;
}

export function TopNav({ onToggleSidebar }: TopNavProps) {
  const { currentCase, cases, selectedCaseId, setSelectedCaseId } = useCase();
  const { theme, toggleTheme } = useTheme();
  const [caseMenuOpen, setCaseMenuOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setCaseMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="h-12 border-b border-border bg-surface px-4 flex items-center justify-between select-none z-20 shrink-0">
      {/* Left: Hamburger (mobile), Logo, Branding */}
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="md:hidden h-8 w-8 text-text-muted hover:text-text-primary"
            aria-label="Toggle navigation menu"
          >
            <Menu className="w-4 h-4" />
          </Button>
        )}

        <Link
          to="/dashboard"
          className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1"
        >
          <div className="w-6 h-6 rounded bg-accent flex items-center justify-center text-white font-bold text-xs shadow-sm">
            FL
          </div>
          <span className="font-semibold text-sm tracking-tight text-text-primary flex items-center gap-1.5">
            ForensicLens
            <span className="text-[10px] font-mono px-1 py-0.2 bg-surface-subtle border border-border text-text-muted rounded">
              v1.0
            </span>
          </span>
        </Link>

        <span className="text-border-strong hidden sm:inline">/</span>

        {/* Case Selector Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setCaseMenuOpen((prev) => !prev)}
            className="flex items-center gap-2 h-7 px-2.5 rounded border border-border bg-surface-subtle hover:bg-surface-muted text-xs font-medium text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            aria-expanded={caseMenuOpen}
            aria-haspopup="listbox"
            aria-label="Select active forensic case"
          >
            <FolderKanban className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
            <span className="font-mono font-semibold">{currentCase?.caseId || selectedCaseId}</span>
            <span className="hidden lg:inline text-text-muted text-[11px] truncate max-w-[160px]">
              — {currentCase?.name || "Select Case"}
            </span>
            <ChevronDown className="w-3 h-3 text-text-muted ml-0.5" aria-hidden="true" />
          </button>

          {caseMenuOpen && (
            <div
              className="absolute left-0 mt-1 w-72 rounded-md border border-border bg-surface shadow-lg py-1 z-50 text-xs focus:outline-none"
              role="listbox"
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider border-b border-border-subtle">
                Active Cases
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {cases.map((c) => {
                  const isSelected = c.caseId === selectedCaseId;
                  return (
                    <button
                      key={c.caseId}
                      type="button"
                      onClick={() => {
                        setSelectedCaseId(c.caseId);
                        setCaseMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 flex items-start justify-between hover:bg-surface-subtle transition-colors"
                      role="option"
                      aria-selected={isSelected}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-mono font-medium text-text-primary flex items-center gap-1.5">
                          {c.caseId}
                          <span className="text-[10px] font-sans px-1 rounded bg-surface-muted text-text-secondary border border-border-subtle">
                            {c.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-text-muted truncate mt-0.5">
                          {c.name}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="border-t border-border-subtle px-2 py-1.5">
                <Link
                  to="/cases"
                  onClick={() => setCaseMenuOpen(false)}
                  className="block text-center text-[11px] text-accent hover:underline py-1"
                >
                  Manage All Cases →
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Offline status, Theme toggle, Lead analyst */}
      <div className="flex items-center gap-3">
        <OfflineIndicator />

        <div className="h-4 w-[1px] bg-border hidden sm:block" />

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="h-8 w-8 text-text-secondary hover:text-text-primary"
          title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          {theme === "light" ? (
            <Moon className="w-4 h-4 text-text-muted hover:text-text-primary" />
          ) : (
            <Sun className="w-4 h-4 text-amber-400" />
          )}
        </Button>

        {/* Lead analyst profile pill */}
        <div className="hidden md:flex items-center gap-2 pl-1 text-xs">
          <div className="w-6 h-6 rounded-full bg-surface-muted border border-border flex items-center justify-center font-medium text-[11px] text-text-secondary">
            SR
          </div>
          <div className="hidden lg:block text-left">
            <div className="font-medium text-[11px] leading-tight text-text-primary">S. Rao</div>
            <div className="text-[10px] text-text-muted leading-tight">Lead Analyst</div>
          </div>
        </div>
      </div>
    </header>
  );
}
