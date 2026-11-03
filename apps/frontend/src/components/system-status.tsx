"use client";

import { CircleCheck, CircleX, LoaderCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHealth } from "@/hooks/queries";
import { cn } from "@/lib/utils";
import type { DependencyStatus } from "@/types/health";

/** Compact indicator for the top bar. Status is never color-only: icon + text label. */
export function HealthIndicator() {
  const { data, isPending, isError } = useHealth();
  const ok = data?.status === "ok";
  const label = isPending ? "Checking…" : isError ? "API unreachable" : ok ? "All systems up" : "Degraded";
  const Icon = isPending ? LoaderCircle : ok ? CircleCheck : CircleX;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground sm:flex" tabIndex={0}>
          <Icon className={cn("size-3.5", isPending && "animate-spin", !isPending && (ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"))} aria-hidden />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {data ? `Database: ${data.dependencies.database.status} · AI service: ${data.dependencies.aiService.status}` : label}
      </TooltipContent>
    </Tooltip>
  );
}

/** Detailed per-dependency list for the overview page. */
export function SystemStatusList() {
  const { data, isError, error } = useHealth();
  const rows: [string, DependencyStatus | undefined][] = [
    ["Backend API (NestJS)", isError ? { status: "down", latencyMs: 0, error: error.message } : data && { status: "up", latencyMs: 0 }],
    ["PostgreSQL", data?.dependencies.database],
    ["AI service (FastAPI)", data?.dependencies.aiService],
  ];

  return (
    <ul className="divide-y">
      {rows.map(([name, dep]) => (
        <li key={name} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="text-sm font-medium">{name}</p>
            {dep?.error && <p className="mt-0.5 truncate text-xs text-muted-foreground">{dep.error}</p>}
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {!dep ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            ) : dep.status === "up" ? (
              <CircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <CircleX className="size-3.5 text-destructive" aria-hidden />
            )}
            {dep ? (dep.status === "up" ? "Up" : "Down") : "Checking"}
            {dep?.status === "up" && dep.latencyMs > 0 && ` · ${dep.latencyMs} ms`}
          </span>
        </li>
      ))}
    </ul>
  );
}
