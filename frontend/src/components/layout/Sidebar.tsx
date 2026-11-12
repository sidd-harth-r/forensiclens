import { NavLink } from "react-router-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCase } from "@/context/CaseContext";
import { Button } from "@/components/ui/Button";
import { NAV_GROUPS, SETTINGS_NAV, type NavItem } from "./navigation";
import { BrandMark } from "./BrandMark";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

function formatCount(n: number): string {
  return n > 999 ? `${(n / 1000).toFixed(n > 9999 ? 0 : 1)}k` : String(n);
}

function NavEntry({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { currentCase } = useCase();
  const Icon = item.icon;
  const count = item.count?.(currentCase);

  if (item.availability === "planned" || !item.to) {
    return (
      <li>
        <span
          className="flex h-8 cursor-not-allowed items-center justify-between gap-2 rounded px-2.5 text-sm text-text-disabled"
          aria-disabled="true"
          title={item.description}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{item.label}</span>
          </span>
          <span className="rounded-sm border border-border px-1 text-[10px] font-medium uppercase tracking-wide">
            Planned
          </span>
        </span>
      </li>
    );
  }

  return (
    <li>
      <NavLink
        to={item.to}
        onClick={onNavigate}
        title={item.description}
        className={({ isActive }) =>
          cn(
            "group relative flex h-8 items-center justify-between gap-2 rounded px-2.5 text-sm transition-colors duration-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            isActive
              ? "bg-surface-muted font-medium text-text-primary"
              : "text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && (
              <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent" aria-hidden="true" />
            )}
            <span className="flex min-w-0 items-center gap-2.5">
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isActive ? "text-accent" : "text-text-muted group-hover:text-text-secondary"
                )}
                aria-hidden="true"
              />
              <span className="truncate">{item.label}</span>
            </span>
            {item.availability === "preview" ? (
              <span className="rounded-sm border border-status-warning/30 px-1 text-[10px] font-medium uppercase tracking-wide text-status-warning">
                Preview
              </span>
            ) : typeof count === "number" ? (
              <span className="font-mono text-2xs text-text-muted">{formatCount(count)}</span>
            ) : null}
          </>
        )}
      </NavLink>
    </li>
  );
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 z-[39] bg-black/50 md:hidden" onClick={onClose} aria-hidden="true" />
      )}

      <aside
        id="app-sidebar"
        className={cn(
          "z-sidebar flex w-sidebar shrink-0 select-none flex-col border-r border-border bg-surface",
          "fixed inset-y-0 left-0 transition-transform duration-200 md:static md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Primary"
      >
        {/* Brand */}
        <div className="flex h-topbar shrink-0 items-center justify-between border-b border-border px-3.5">
          <NavLink
            to="/dashboard"
            onClick={onClose}
            className="flex items-center gap-2.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <BrandMark />
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight text-text-primary">ForensicLens</span>
              <span className="block text-[10px] uppercase tracking-[0.08em] text-text-muted">
                Investigation workspace
              </span>
            </span>
          </NavLink>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close navigation" className="md:hidden">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-4 last:mb-0">
              <h2 className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
                {group.label}
              </h2>
              <ul className="space-y-px">
                {group.items.map((item) => (
                  <NavEntry key={item.label} item={item} onNavigate={onClose} />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-2 py-2">
          <ul>
            <NavEntry item={SETTINGS_NAV} onNavigate={onClose} />
          </ul>
        </div>
      </aside>
    </>
  );
}
