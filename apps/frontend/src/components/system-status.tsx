"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";
import type { HealthReport } from "@/types/health";

const POLL_MS = 5000;

type State =
  | { kind: "loading" }
  | { kind: "ok"; report: HealthReport }
  | { kind: "error"; message: string };

export function SystemStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .health()
        .then((report) => active && setState({ kind: "ok", report }))
        .catch((e: Error) => active && setState({ kind: "error", message: e.message }));
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const backend =
    state.kind === "ok"
      ? { status: "up" as const }
      : state.kind === "error"
        ? { status: "down" as const, error: state.message }
        : undefined;

  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      <StatusRow name="Backend API (NestJS)" dep={backend} />
      <StatusRow name="PostgreSQL" dep={state.kind === "ok" ? state.report.dependencies.database : undefined} />
      <StatusRow name="AI service (FastAPI)" dep={state.kind === "ok" ? state.report.dependencies.aiService : undefined} />
    </ul>
  );
}

function StatusRow({
  name,
  dep,
}: {
  name: string;
  dep?: { status: "up" | "down"; latencyMs?: number; error?: string };
}) {
  const color = !dep ? "bg-zinc-400" : dep.status === "up" ? "bg-emerald-500" : "bg-red-500";
  const label = !dep ? "unknown" : dep.status === "up" ? "up" : "down";
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div>
        <p className="font-medium">{name}</p>
        {dep?.error && <p className="mt-1 text-sm text-red-600 dark:text-red-400">{dep.error}</p>}
      </div>
      <span className="flex shrink-0 items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />
        {label}
        {dep?.latencyMs !== undefined && ` · ${dep.latencyMs} ms`}
      </span>
    </li>
  );
}
