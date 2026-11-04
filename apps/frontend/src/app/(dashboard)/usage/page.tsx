"use client";

import { Activity, CircleCheck, Coins, Gauge, Timer } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/common/stat-card";
import { ErrorState } from "@/components/common/states";
import { reasonLabel } from "@/components/inbox/labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarList, UsageCharts } from "@/components/usage/usage-charts";
import { useUsage } from "@/hooks/queries";
import { formatCompact, formatDuration, formatNumber, formatPercent } from "@/lib/format";

const RANGES = [7, 30, 90] as const;

export default function UsagePage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const { data, isPending, isError, error, refetch } = useUsage(days);

  return (
    <>
      <PageHeader
        title="Usage"
        description={data ? `Last ${days} days, ${data.timezone} time` : "AI requests, decisions and delivery"}
        actions={
          <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v) as (typeof RANGES)[number])}>
            <TabsList>
              {RANGES.map((r) => (
                <TabsTrigger key={r} value={String(r)}>
                  {r} days
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />
      {isError ? (
        <Card>
          <ErrorState message={error.message} onRetry={() => refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="AI requests" icon={Activity} loading={isPending} value={data && formatNumber(data.ai.requests)} hint={data && `${formatNumber(data.ai.failed)} failed`} />
            <StatCard label="Success rate" icon={CircleCheck} loading={isPending} value={data && formatPercent(data.ai.successRate)} hint="AI service answered" />
            <StatCard label="Average reply time" icon={Timer} loading={isPending} value={data && formatDuration(data.ai.avgLatencyMs)} />
            <StatCard label="95th percentile" icon={Gauge} loading={isPending} value={data && formatDuration(data.ai.p95LatencyMs)} hint="95% of replies were faster" />
            <StatCard
              label="Model tokens"
              icon={Coins}
              loading={isPending}
              value={data && formatCompact(data.ai.inputTokens + data.ai.outputTokens)}
              hint={data && `${formatCompact(data.ai.inputTokens)} in · ${formatCompact(data.ai.outputTokens)} out`}
            />
          </div>
          {isPending ? <Skeleton className="h-80 w-full" /> : <UsageCharts series={data.series} />}
          {data && (
            <div className="grid gap-6 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>What happened to AI replies</CardTitle>
                  <CardDescription>Sent automatically, reviewed by staff, or still waiting</CardDescription>
                </CardHeader>
                <CardContent>
                  <BarList
                    empty="No AI decisions in this period."
                    rows={[
                      { label: "Sent automatically", value: data.decisions.outcomes.automatic ?? 0 },
                      { label: "Approved as written", value: data.decisions.outcomes.approved ?? 0 },
                      { label: "Edited by staff", value: data.decisions.outcomes.edited ?? 0 },
                      { label: "Dismissed", value: data.decisions.outcomes.dismissed ?? 0 },
                      { label: "Waiting for review", value: data.decisions.outcomes.pending ?? 0 },
                    ]}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Why</CardTitle>
                  <CardDescription>Model replies, safety rules and rejected replies</CardDescription>
                </CardHeader>
                <CardContent>
                  <BarList empty="No AI decisions in this period." rows={data.decisions.byReason.map((r) => ({ label: reasonLabel(r.reason), value: r.count }))} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Delivery</CardTitle>
                  <CardDescription>
                    {formatNumber(data.messages.inbound)} received · {formatNumber(data.messages.outbound)} sent
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <BarList
                    empty="No outgoing messages in this period."
                    rows={(["READ", "DELIVERED", "SENT", "QUEUED", "FAILED"] as const).map((s) => ({ label: s.charAt(0) + s.slice(1).toLowerCase(), value: data.messages.outboundByStatus[s] ?? 0 }))}
                  />
                  {data.messages.failuresByCode.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Most common failure codes</p>
                      <ul className="text-sm">
                        {data.messages.failuresByCode.map((f) => (
                          <li key={f.code ?? "none"} className="flex justify-between tabular-nums">
                            <span>{f.code ?? "unknown"}</span>
                            <span>{formatNumber(f.count)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
          {data && data.ai.byModel.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>By model version</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Checkpoint</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.ai.byModel.map((m) => (
                      <TableRow key={`${m.version}-${m.checkpoint}`}>
                        <TableCell>{m.version === null ? "Unknown (request failed)" : `v${m.version}`}</TableCell>
                        <TableCell>{m.checkpoint ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(m.requests)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  );
}
