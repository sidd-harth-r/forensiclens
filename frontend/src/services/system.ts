import { FIXTURE_SYSTEM_STATUS } from "@/fixtures/system";
import { SystemStatus } from "@/types/system";

export async function getSystemStatus(): Promise<SystemStatus> {
  return Promise.resolve({ ...FIXTURE_SYSTEM_STATUS });
}

