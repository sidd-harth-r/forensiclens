import { Fragment } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Menu, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/Button";
import { DataModeBadge } from "@/components/common/DataModeBadge";
import { OfflineIndicator } from "@/components/common/OfflineIndicator";
import { CaseSwitcher } from "./CaseSwitcher";
import { BackendStatus } from "./BackendStatus";
import { getBreadcrumbs } from "./navigation";

interface TopNavProps {
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
}

export function TopNav({ onToggleSidebar, sidebarOpen }: TopNavProps) {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const crumbs = getBreadcrumbs(location.pathname);

  return (
    <header className="sticky top-0 z-sticky flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-3 backdrop-blur-sm sm:px-4">
      {onToggleSidebar && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleSidebar}
          className="md:hidden"
          aria-label="Open navigation"
          aria-expanded={!!sidebarOpen}
          aria-controls="app-sidebar"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}

      <CaseSwitcher />

      <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
        <ol className="flex min-w-0 items-center gap-1 text-xs text-text-muted">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Fragment key={`${c.label}-${i}`}>
                {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-text-disabled" aria-hidden="true" />}
                <li className="min-w-0">
                  {c.to && !last ? (
                    <Link to={c.to} className="truncate rounded hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      {c.label}
                    </Link>
                  ) : (
                    <span
                      className={last ? "truncate font-medium text-text-primary" : "truncate"}
                      aria-current={last ? "page" : undefined}
                    >
                      {c.label}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          onClick={() => navigate("/retrieval")}
          className="hidden h-8 w-56 items-center gap-2 rounded border border-border bg-surface-subtle px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:flex"
          aria-label="Search case evidence in Retrieval Explorer"
        >
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Search evidence…</span>
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate("/retrieval")}
          className="lg:hidden"
          aria-label="Search case evidence"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>

        <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />

        <div className="hidden items-center gap-1.5 sm:flex">
          <DataModeBadge />
          <span className="hidden 2xl:inline-flex">
            <OfflineIndicator />
          </span>
        </div>
        <BackendStatus />

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
    </header>
  );
}
