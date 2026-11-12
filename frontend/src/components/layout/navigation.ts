import type { ComponentType } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  HardDrive,
  ListTree,
  GanttChart,
  Layers,
  ScanSearch,
  ShieldCheck,
  Search,
  ClipboardCheck,
  Scale,
  History,
  FileText,
  Settings,
} from "lucide-react";
import type { Case } from "@/types/case";

export type NavAvailability = "live" | "preview" | "planned";

export interface NavItem {
  label: string;
  /** Route path. Planned items have no route and render disabled. */
  to?: string;
  icon: ComponentType<{ className?: string }>;
  availability: NavAvailability;
  /** Optional count sourced from the active case (real API data only) */
  count?: (c: Case | null) => number | undefined;
  description?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { label: "Overview", to: "/dashboard", icon: LayoutDashboard, availability: "live" },
      { label: "Cases", to: "/cases", icon: FolderKanban, availability: "live" },
      {
        label: "Evidence",
        to: "/evidence",
        icon: HardDrive,
        availability: "live",
        count: (c) => c?.evidenceCount,
      },
    ],
  },
  {
    id: "analysis",
    label: "Analysis",
    items: [
      {
        label: "Event Explorer",
        to: "/events",
        icon: ListTree,
        availability: "live",
        count: (c) => c?.eventsCount,
      },
      { label: "Timeline", to: "/timeline", icon: GanttChart, availability: "live" },
      { label: "Sessions", to: "/sessions", icon: Layers, availability: "live" },
      { label: "Retrieval Explorer", to: "/retrieval", icon: ScanSearch, availability: "live" },
      { label: "Claim Verification", to: "/claims", icon: ShieldCheck, availability: "live" },
    ],
  },
  {
    id: "preview",
    label: "Preview modules",
    items: [
      {
        label: "Investigation",
        to: "/investigation",
        icon: Search,
        availability: "preview",
        description: "UI preview — no backend endpoint yet",
      },
      {
        label: "Findings",
        to: "/findings",
        icon: ClipboardCheck,
        availability: "preview",
        description: "UI preview — no backend endpoint yet",
      },
      {
        label: "Legal Mapping",
        to: "/legal",
        icon: Scale,
        availability: "preview",
        description: "UI preview — no backend endpoint yet",
      },
      {
        label: "Audit Ledger",
        to: "/audit",
        icon: History,
        availability: "preview",
        description: "UI preview — no backend endpoint yet",
      },
      {
        label: "Reports",
        icon: FileText,
        availability: "planned",
        description: "Planned — not implemented",
      },
    ],
  },
];

export const SETTINGS_NAV: NavItem = {
  label: "Settings",
  to: "/settings",
  icon: Settings,
  availability: "live",
};

const ALL_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_NAV];

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Derives breadcrumbs from the current pathname using the nav config,
 * so labels always match the sidebar.
 */
export function getBreadcrumbs(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return [{ label: "Overview" }];

  const root = `/${segments[0]}`;
  const item = ALL_ITEMS.find((i) => i.to === root);
  const group = NAV_GROUPS.find((g) => g.items.some((i) => i.to === root));

  const crumbs: Crumb[] = [];
  if (group) crumbs.push({ label: group.label });
  crumbs.push({ label: item?.label ?? segments[0], to: segments.length > 1 ? root : undefined });

  if (segments.length > 1) {
    crumbs.push({ label: decodeURIComponent(segments[1]) });
  }
  return crumbs;
}
