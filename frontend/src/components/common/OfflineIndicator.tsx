import { FlaskConical, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { isApiMode } from "@/services/apiClient";

/**
 * Describes the deployment model (local-first). This is a statement of
 * architecture, not a live network measurement.
 */
export function OfflineIndicator() {
  return (
    <Badge
      variant="outline"
      icon={<WifiOff className="h-3 w-3" aria-hidden="true" />}
      title="Local-first architecture: evidence and models are processed on this machine"
    >
      Local processing
    </Badge>
  );
}

/**
 * Shown only when the UI is running against fixture data.
 */
export function FixtureModeBadge() {
  if (isApiMode) return null;
  return (
    <Badge
      variant="warning"
      icon={<FlaskConical className="h-3 w-3" aria-hidden="true" />}
      title="Sample fixture data — not real case evidence"
    >
      Fixture data
    </Badge>
  );
}
