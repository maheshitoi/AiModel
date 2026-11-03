import type { HealthReport } from "@/types/health";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

// Mirrors the backend's ResponseInterceptor / AllExceptionsFilter envelope.
type ApiEnvelope<T> =
  | { success: true; data: T }
  | { success: false; error: { statusCode: number; message: string; details?: unknown } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { ...init, credentials: "include" });
  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body) throw new Error(`${res.status} ${res.statusText}`);
  if (!body.success) throw new Error(body.error.message);
  return body.data;
}

export const api = {
  health: () => request<HealthReport>("/health", { signal: AbortSignal.timeout(5000) }),
};
