import { isApiMode, API_BASE_URL } from "@/services/apiClient";
import { Database, Server } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

/**
 * Shows which data source the UI is bound to. Fixture mode is always
 * flagged in amber so sample data can never be mistaken for case evidence.
 */
export function DataModeBadge() {
  if (isApiMode) {
    return (
      <Badge
        variant="outline"
        icon={<Server className="h-3 w-3" aria-hidden="true" />}
        title={`Bound to backend API ${API_BASE_URL || "(same origin)"}`}
      >
        Live API
      </Badge>
    );
  }

  return (
    <Badge
      variant="warning"
      icon={<Database className="h-3 w-3" aria-hidden="true" />}
      title="VITE_DATA_MODE=fixtures — sample data, not case evidence"
    >
      Fixture data
    </Badge>
  );
}
