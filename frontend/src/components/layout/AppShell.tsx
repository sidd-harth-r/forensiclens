import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { useTheme } from "@/context/ThemeContext";
import { TopNav } from "./TopNav";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme } = useTheme();
  const location = useLocation();

  // Close the mobile drawer and reset scroll on navigation
  useEffect(() => {
    setSidebarOpen(false);
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Escape closes the mobile drawer
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  return (
    <div className="flex h-full min-h-0 bg-background font-sans text-text-primary antialiased">
      <a
        href="#main-content"
        className="sr-only z-toast rounded bg-accent-solid px-3 py-2 text-xs font-medium text-accent-on focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav onToggleSidebar={() => setSidebarOpen((p) => !p)} sidebarOpen={sidebarOpen} />
        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto focus:outline-none">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      <Toaster
        position="bottom-right"
        theme={theme}
        toastOptions={{
          className: "!rounded-md !border !border-border !bg-surface-raised !text-text-primary !text-xs !shadow-overlay",
        }}
      />
    </div>
  );
}
