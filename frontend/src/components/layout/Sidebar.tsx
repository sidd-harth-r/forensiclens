import React from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FolderKanban,
  HardDrive,
  ListOrdered,
  Clock,
  Layers,
  Search,
  CheckCircle2,
  Scale,
  History,
  Settings,
  X,
} from "lucide-react";
import { useCase } from "@/context/CaseContext";
import { Button } from "@/components/ui/Button";

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCount?: (c: ReturnType<typeof useCase>["currentCase"]) => number | undefined;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: LayoutDashboard },
  { label: "Cases", to: "/cases", icon: FolderKanban, badgeCount: () => undefined },
  {
    label: "Evidence",
    to: "/evidence",
    icon: HardDrive,
    badgeCount: (c) => c?.evidenceCount,
  },
  {
    label: "Events",
    to: "/events",
    icon: ListOrdered,
    badgeCount: (c) => c?.eventsCount,
  },
  { label: "Timeline", to: "/timeline", icon: Clock },
  { label: "Sessions", to: "/sessions", icon: Layers },
  {
    label: "Investigation",
    to: "/investigation",
    icon: Search,
    badgeCount: (c) => c?.investigationsCount,
  },
  {
    label: "Findings",
    to: "/findings",
    icon: CheckCircle2,
    badgeCount: (c) => c?.findingsCount,
  },
  { label: "Legal", to: "/legal", icon: Scale },
  { label: "Audit", to: "/audit", icon: History },
  { label: "Settings", to: "/settings", icon: Settings },
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { currentCase } = useCase();

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden backdrop-blur-xs"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "w-56 border-r border-border bg-surface flex flex-col justify-between shrink-0 transition-transform duration-200 ease-in-out z-40 select-none",
          "fixed md:static inset-y-0 left-0",
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
        aria-label="Main Navigation"
      >
        <div className="flex flex-col flex-1 min-h-0">
          {/* Mobile close bar */}
          <div className="h-12 border-b border-border flex items-center justify-between px-3 md:hidden">
            <span className="font-semibold text-xs tracking-tight text-text-primary">
              Navigation Menu
            </span>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close menu">
              <X className="w-4 h-4 text-text-muted" />
            </Button>
          </div>

          {/* Active Case Context banner */}
          <div className="px-3 pt-3 pb-2 border-b border-border-subtle">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1 flex items-center justify-between">
              <span>Active Scope</span>
              <span className="w-1.5 h-1.5 rounded-full bg-status-success inline-block" />
            </div>
            <div className="bg-surface-subtle border border-border rounded p-2">
              <div className="font-mono font-bold text-xs text-text-primary truncate">
                {currentCase?.caseId || "NO CASE"}
              </div>
              <div className="text-[11px] text-text-muted truncate mt-0.5">
                {currentCase?.name || "Select case"}
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-2 py-2.5 space-y-0.5 overflow-y-auto">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const count = item.badgeCount?.(currentCase);

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-medium transition-colors group",
                      isActive
                        ? "bg-accent text-white font-semibold shadow-xs"
                        : "text-text-secondary hover:text-text-primary hover:bg-surface-subtle"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon
                          className={cn(
                            "w-4 h-4 shrink-0 transition-colors",
                            isActive ? "text-white" : "text-text-muted group-hover:text-text-primary"
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {typeof count === "number" && (
                        <span
                          className={cn(
                            "text-[10px] font-mono px-1.5 py-0.2 rounded-full text-right",
                            isActive
                              ? "bg-white/20 text-white"
                              : "bg-surface-muted text-text-muted group-hover:text-text-secondary"
                          )}
                        >
                          {count > 999 ? `${(count / 1000).toFixed(1)}k` : count}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Footer info: Local-first guarantee */}
        <div className="p-3 border-t border-border-subtle bg-surface-subtle/50 text-[11px] text-text-muted">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span>ENGINE: AIR-GAPPED</span>
            <span className="text-status-success font-semibold">ONLINE</span>
          </div>
          <div className="text-[10px] text-text-disabled mt-1">
            Section 63 BSA Ready
          </div>
        </div>
      </aside>
    </>
  );
}
