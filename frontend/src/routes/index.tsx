import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { CasesPage } from "@/pages/CasesPage";
import { CaseDetailPage } from "@/pages/CaseDetailPage";
import { EvidencePage } from "@/pages/EvidencePage";
import { EventsPage } from "@/pages/EventsPage";
import { TimelinePage } from "@/pages/TimelinePage";
import { SessionsPage } from "@/pages/SessionsPage";
import { RetrievalPage } from "@/pages/RetrievalPage";
import { ClaimVerificationPage } from "@/pages/ClaimVerificationPage";
import { InvestigationPage } from "@/pages/InvestigationPage";
import { FindingsPage } from "@/pages/FindingsPage";
import { LegalPage } from "@/pages/LegalPage";
import { AuditPage } from "@/pages/AuditPage";
import { SettingsPage } from "@/pages/SettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: "dashboard",
        element: <DashboardPage />,
      },
      {
        path: "cases",
        element: <CasesPage />,
      },
      {
        path: "cases/:caseId",
        element: <CaseDetailPage />,
      },
      {
        path: "evidence",
        element: <EvidencePage />,
      },
      {
        path: "events",
        element: <EventsPage />,
      },
      {
        path: "timeline",
        element: <TimelinePage />,
      },
      {
        path: "sessions",
        element: <SessionsPage />,
      },
      {
        path: "retrieval",
        element: <RetrievalPage />,
      },
      {
        path: "claims",
        element: <ClaimVerificationPage />,
      },
      {
        path: "investigation",
        element: <InvestigationPage />,
      },
      {
        path: "findings",
        element: <FindingsPage />,
      },
      {
        path: "legal",
        element: <LegalPage />,
      },
      {
        path: "audit",
        element: <AuditPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
      {
        path: "*",
        element: <Navigate to="/dashboard" replace />,
      },
    ],
  },
]);
