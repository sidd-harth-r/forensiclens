import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronsUpDown, FolderKanban, Loader2 } from "lucide-react";
import { useCase } from "@/context/CaseContext";
import { CaseStatusBadge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

/**
 * Active-case selector. Every case-scoped page reads from this context,
 * so the active case is always visible in the top bar.
 */
export function CaseSwitcher() {
  const { cases, currentCase, selectedCaseId, setSelectedCaseId, isLoading, error } = useCase();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    const idx = Math.max(0, cases.findIndex((c) => c.caseId === selectedCaseId));
    setActiveIndex(idx);
    window.setTimeout(() => listRef.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, cases, selectedCaseId]);

  const choose = (caseId: string) => {
    setSelectedCaseId(caseId);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(cases.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(cases.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const c = cases[activeIndex];
      if (c) choose(c.caseId);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const label = currentCase?.caseId ?? (isLoading ? "Loading cases" : "No case");

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Active case: ${currentCase ? `${currentCase.caseId}, ${currentCase.name}` : label}. Change case`}
        className={cn(
          "flex h-8 max-w-[280px] items-center gap-2 rounded border border-border bg-surface-subtle px-2.5 text-left transition-colors",
          "hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          error && "border-status-danger/50"
        )}
      >
        {isLoading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-text-muted" aria-hidden="true" />
        ) : (
          <FolderKanban className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
        )}
        <span className="min-w-0 leading-tight">
          <span className="block truncate font-mono text-xs font-semibold text-text-primary">{label}</span>
          {currentCase && (
            <span className="hidden truncate text-2xs text-text-muted lg:block">{currentCase.name}</span>
          )}
        </span>
        <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-overlay mt-1 w-[min(340px,calc(100vw-2rem))] animate-fade-in rounded-md border border-border bg-surface-raised shadow-overlay">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="label-caps">Switch case</span>
            <span className="font-mono text-2xs text-text-muted">{cases.length}</span>
          </div>
          {error ? (
            <p className="px-3 py-3 text-xs text-status-danger">{error}</p>
          ) : cases.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-muted">No cases exist yet.</p>
          ) : (
            <ul
              id={listId}
              ref={listRef}
              role="listbox"
              aria-label="Cases"
              aria-activedescendant={cases[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              tabIndex={-1}
              onKeyDown={onListKeyDown}
              className="max-h-72 overflow-y-auto py-1 focus:outline-none"
            >
              {cases.map((c, i) => {
                const selected = c.caseId === selectedCaseId;
                return (
                  <li
                    key={c.caseId}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => choose(c.caseId)}
                    className={cn(
                      "mx-1 flex cursor-pointer items-start justify-between gap-2 rounded px-2 py-1.5",
                      i === activeIndex && "bg-surface-muted"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-text-primary">{c.caseId}</span>
                        <CaseStatusBadge status={c.status} />
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-text-muted">{c.name}</span>
                    </span>
                    {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-border-subtle p-1">
            <Link
              to="/cases"
              onClick={() => setOpen(false)}
              className="block rounded px-2 py-1.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Manage cases
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
