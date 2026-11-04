"use client";

import { ChartColumn } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMessagesChart } from "@/hooks/queries";
import { formatNumber } from "@/lib/format";
import type { ChartRange, MessageChartPoint } from "@/types/api";

// Series colors are the validated categorical slots 1–2 (--chart-1/--chart-2 in globals.css).
const SERIES = [
  { key: "inbound", label: "Incoming", color: "var(--chart-1)" },
  { key: "outbound", label: "Outgoing", color: "var(--chart-2)" },
] as const;

// Buckets are local calendar dates; format them in UTC so the label never shifts a day.
function bucketLabel(bucket: string, range: ChartRange): string {
  const opts: Intl.DateTimeFormatOptions =
    range === "monthly" ? { month: "short", year: "2-digit", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" };
  return new Date(`${bucket}T00:00:00Z`).toLocaleDateString(undefined, opts);
}

export function MessagesChart() {
  const [range, setRange] = useState<ChartRange>("daily");
  const [showTable, setShowTable] = useState(false);
  const { data, isPending, isError, error, refetch } = useMessagesChart(range);
  const empty = data?.every((p) => p.inbound === 0 && p.outbound === 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp messages</CardTitle>
        <CardDescription>Messages received and sent per {range === "daily" ? "day" : range === "weekly" ? "week" : "month"}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Filters sit in one row above the plot; the legend shares it on wide screens. */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {!showTable && !empty && data ? <Legend /> : <span />}
          <div className="flex items-center gap-2">
            <Tabs value={range} onValueChange={(v) => setRange(v as ChartRange)}>
              <TabsList>
                <TabsTrigger value="daily">Daily</TabsTrigger>
                <TabsTrigger value="weekly">Weekly</TabsTrigger>
                <TabsTrigger value="monthly">Monthly</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="outline" size="sm" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
              {showTable ? "Chart" : "Table"}
            </Button>
          </div>
        </div>
        {isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : isError ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : showTable ? (
          <ChartTable data={data} range={range} />
        ) : empty ? (
          <EmptyState
            icon={ChartColumn}
            title="No messages yet"
            description="Message volume appears here once your WhatsApp Business number is connected (Settings → WhatsApp)."
          />
        ) : (
          <>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} barGap={2} barCategoryGap="20%" margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="bucket"
                    tickFormatter={(b: string) => bucketLabel(b, range)}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                    minTickGap={16}
                  />
                  <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                    content={({ active, payload }) => <ChartTooltip active={active} payload={payload} range={range} />}
                  />
                  {SERIES.map((s) => (
                    // No entry animation: the overview refetches every 30 s and bars should not regrow each time.
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Legend() {
  return (
    <ul className="flex gap-4 text-xs text-muted-foreground" aria-label="Legend">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  range: ChartRange;
}

function ChartTooltip({ active, payload, range }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as MessageChartPoint;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{bucketLabel(point.bucket, range)}</p>
      {SERIES.map((s) => (
        <p key={s.key} className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm" style={{ background: s.color }} aria-hidden />
          {s.label}: <span className="font-medium tabular-nums">{formatNumber(point[s.key])}</span>
        </p>
      ))}
      <p className="mt-1 text-muted-foreground">
        of which AI replies: <span className="tabular-nums">{formatNumber(point.ai)}</span>
      </p>
    </div>
  );
}

function ChartTable({ data, range }: { data: MessageChartPoint[]; range: ChartRange }) {
  return (
    <div className="max-h-72 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Incoming</TableHead>
            <TableHead className="text-right">Outgoing</TableHead>
            <TableHead className="text-right">AI replies</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...data].reverse().map((p) => (
            <TableRow key={p.bucket}>
              <TableCell>{bucketLabel(p.bucket, range)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(p.inbound)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(p.outbound)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(p.ai)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
