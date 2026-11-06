"use client";

import { Activity, Play } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { PaginationBar } from "@/components/common/pagination-bar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { JobCard } from "@/components/training/job-card";
import { StartTrainingDialog } from "@/components/training/start-training-dialog";
import { isJobActive, JobStatusBadge } from "@/components/training/status-badges";
import { TrainingCharts } from "@/components/training/training-charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentJob, useJobMetrics, useTrainingJobs } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { useTrainingSocket } from "@/hooks/use-live-updates";
import { formatElapsed, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const LIVE: Record<string, string> = { live: "Live", connecting: "Connecting…", offline: "Offline: refreshing every 15 s" };

export default function TrainingPage() {
  const { can } = useAuth();
  const live = useTrainingSocket();
  const [starting, setStarting] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = useCurrentJob();
  const history = useTrainingJobs({ page, pageSize: 10 });
  // Show the running job, else the one picked from the history, else the latest.
  const job = (selectedId ? history.data?.items.find((j) => j.id === selectedId) : null) ?? current.data ?? history.data?.items[0] ?? null;
  const metrics = useJobMetrics(job?.id ?? null);
  const running = !!current.data;

  return (
    <>
      <PageHeader
        title="Training"
        description={`Train new model versions and watch them learn · ${LIVE[live]}`}
        actions={
          can("training:manage") && (
            <Button onClick={() => setStarting(true)} disabled={running}>
              <Play aria-hidden />
              Start training
            </Button>
          )
        }
      />
      {current.isPending || history.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : current.isError ? (
        <Card>
          <ErrorState message={current.error.message} onRetry={() => current.refetch()} />
        </Card>
      ) : !job ? (
        <Card>
          <EmptyState
            icon={Activity}
            title="No training jobs yet"
            description="Start a job to train a model from scratch on the synthetic conversations and your approved datasets."
            action={
              can("training:manage") && (
                <Button size="sm" onClick={() => setStarting(true)}>
                  Start training
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <JobCard job={job} metrics={metrics.data ?? []} />
          {metrics.isPending ? <Skeleton className="h-80 w-full" /> : <TrainingCharts metrics={metrics.data ?? []} />}
        </>
      )}
      {history.data && history.data.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Select a job to see its metrics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Steps</TableHead>
                    <TableHead className="text-right">Best validation loss</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.data.items.map((j) => (
                    <TableRow key={j.id} className={cn(j.id === job?.id && "bg-muted/50")} aria-selected={j.id === job?.id}>
                      <TableCell>
                        <button type="button" className="text-left font-medium hover:underline" onClick={() => setSelectedId(j.id)}>
                          {j.runName ?? "—"}
                        </button>
                        <p className="text-xs text-muted-foreground">{j.config.preset}</p>
                      </TableCell>
                      <TableCell>
                        <JobStatusBadge status={j.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(j.currentStep)} / {formatNumber(j.totalSteps)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{j.bestValLoss?.toFixed(4) ?? "—"}</TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {j.startedAt && j.finishedAt ? formatElapsed((new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime()) / 1000) : isJobActive(j.status) ? "running" : "—"}
                      </TableCell>
                      <TableCell>{j.modelVersion ? `v${j.modelVersion.version}` : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatRelative(j.createdAt)}
                        {j.startedBy && <p className="text-xs text-muted-foreground">{j.startedBy.name}</p>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PaginationBar meta={history.data.meta} onPage={setPage} />
          </CardContent>
        </Card>
      )}
      <StartTrainingDialog open={starting} onOpenChange={setStarting} />
    </>
  );
}
