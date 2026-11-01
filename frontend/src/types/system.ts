export type ServiceHealth = "healthy" | "degraded" | "offline" | "isolated";

export interface ComponentHealth {
  name: string;
  status: ServiceHealth;
  description: string;
  metric?: string;
  lastChecked: string;
}

export interface SystemStatus {
  backend: ComponentHealth;
  database: ComponentHealth;
  searchIndex: ComponentHealth;
  localLlm: ComponentHealth;
  networkEgress: ComponentHealth;
  isOfflineIsolated: boolean;
}

