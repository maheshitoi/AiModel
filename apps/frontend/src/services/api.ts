import type { PageMeta } from "@/types/api";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

// Mirrors the backend's ResponseInterceptor / AllExceptionsFilter envelope.
type ApiEnvelope<T> =
  | { success: true; data: T; meta?: PageMeta }
  | { success: false; error: { statusCode: number; message: string; details?: unknown } };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// The access token lives only in memory (never localStorage) so injected scripts cannot persist it.
// The refresh token is an HttpOnly cookie the browser sends to /auth/* automatically.
let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export const session = {
  setAccessToken: (token: string | null) => {
    accessToken = token;
  },
  onExpired: (handler: (() => void) | null) => {
    onSessionExpired = handler;
  },
};

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshAccessToken(): Promise<string | null> {
  refreshInFlight ??= fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" })
    .then(async (res) => {
      const body = (await res.json().catch(() => null)) as ApiEnvelope<{ accessToken: string }> | null;
      accessToken = res.ok && body?.success ? body.data.accessToken : null;
      return accessToken;
    })
    .catch(() => (accessToken = null))
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

async function send<T>(path: string, opts: RequestOptions, retried = false): Promise<{ data: T; meta?: PageMeta }> {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    credentials: "include",
    signal: opts.signal,
    headers: {
      ...(opts.body !== undefined && { "content-type": "application/json" }),
      ...(accessToken && { authorization: `Bearer ${accessToken}` }),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  // Expired access token: refresh once and replay. Auth endpoints never retry.
  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    if (await refreshAccessToken()) return send<T>(path, opts, true);
    onSessionExpired?.();
  }

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!body) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  if (!body.success) throw new ApiError(body.error.statusCode, body.error.message, body.error.details);
  return { data: body.data, meta: body.meta };
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) => send<T>(path, opts ?? {}).then((r) => r.data),
  page: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    send<T[]>(path, opts ?? {}).then((r) => ({ items: r.data, meta: r.meta! })),
  post: <T>(path: string, body?: unknown) => send<T>(path, { method: "POST", body }).then((r) => r.data),
  patch: <T>(path: string, body?: unknown) => send<T>(path, { method: "PATCH", body }).then((r) => r.data),
  delete: <T>(path: string) => send<T>(path, { method: "DELETE" }).then((r) => r.data),
};
