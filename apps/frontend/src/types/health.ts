// Mirrors HealthReport in apps/backend/src/health/health.service.ts
export type DependencyStatus = { status: "up" | "down"; latencyMs: number; error?: string };

export interface HealthReport {
  status: "ok" | "degraded";
  timestamp: string;
  uptimeSeconds: number;
  dependencies: { database: DependencyStatus; aiService: DependencyStatus };
}
