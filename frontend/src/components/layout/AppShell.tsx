import { useState } from "react";
import { Outlet } from "react-router-dom";
import { TopNav } from "./TopNav";
import { Sidebar } from "./Sidebar";
import { Toaster } from "sonner";
import { useTheme } from "@/context/ThemeContext";

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-background text-text-primary antialiased font-sans">
      {/* Top Header Navigation */}
      <TopNav onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />

      {/* Main workspace container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Navigation Sidebar */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Scrollable Main Content Area */}
        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 bg-background focus:outline-none"
        >
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Toast notifications */}
      <Toaster
        position="bottom-right"
        theme={theme}
        toastOptions={{
          className: "border border-border bg-surface text-text-primary text-xs",
        }}
      />
    </div>
  );
}

