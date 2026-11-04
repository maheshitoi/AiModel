"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDuration, formatNumber } from "@/lib/format";
import type { UsageDay } from "@/types/api";

// One measure per chart (no dual axes); the validated categorical slot 1.
const COLOR = "var(--chart-1)";
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const axis = { tick: { fill: "var(--muted-foreground)", fontSize: 12 }, tickLine: false } as const;

function Tip({ active, payload, render }: { active?: boolean; payload?: readonly { payload?: unknown }[]; render: (d: UsageDay) => React.ReactNode }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as UsageDay;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{dayLabel(d.day)}</p>
      {render(d)}
    </div>
  );
}

export function UsageCharts({ series }: { series: UsageDay[] }) {
  const [table, setTable] = useState(false);
  const toggle = (
    <Button variant="outline" size="sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
      {table ? "Charts" : "Table"}
    </Button>
  );

  if (table) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>AI requests per day</CardTitle>
            <CardDescription>Requests, failures, latency and tokens</CardDescription>
          </div>
          {toggle}
        </CardHeader>
        <CardContent className="max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Avg latency</TableHead>
                <TableHead className="text-right">Tokens in / out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...series].reverse().map((d) => (
                <TableRow key={d.day}>
                  <TableCell>{dayLabel(d.day)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(d.requests)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(d.failures)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDuration(d.avgLatencyMs)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(d.inputTokens)} / {formatNumber(d.outputTokens)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle>AI requests per day</CardTitle>
            <CardDescription>Failures are listed in the tooltip</CardDescription>
          </div>
          {toggle}
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" tickFormatter={dayLabel} {...axis} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
              <YAxis allowDecimals={false} {...axis} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload }) => (
                  <Tip active={active} payload={payload} render={(d) => <p>{formatNumber(d.requests)} requests · {formatNumber(d.failures)} failed</p>} />
                )}
              />
              <Bar dataKey="requests" fill={COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Average reply time</CardTitle>
          <CardDescription>Backend → AI service → decision, successful requests</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" tickFormatter={dayLabel} {...axis} axisLine={{ stroke: "var(--border)" }} minTickGap={16} />
              <YAxis tickFormatter={(v: number) => formatDuration(v)} {...axis} axisLine={false} width={72} />
              <Tooltip
                cursor={{ stroke: "var(--border)" }}
                content={({ active, payload }) => <Tip active={active} payload={payload} render={(d) => <p>{formatDuration(d.avgLatencyMs)}</p>} />}
              />
              <Line dataKey="avgLatencyMs" stroke={COLOR} strokeWidth={2} dot={{ r: 3, fill: COLOR }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

/** Horizontal bar list: label, a single-hue bar scaled to the largest value, and the count as text. */
export function BarList({ rows, empty }: { rows: { label: string; value: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.every((r) => r.value === 0)) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-2 rounded-full bg-muted" aria-hidden>
            <span className="block h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: COLOR }} />
          </span>
          <span className="text-right tabular-nums">{formatNumber(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
