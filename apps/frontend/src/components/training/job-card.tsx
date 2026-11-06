"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isJobActive, JobStatusBadge, ProgressBar } from "@/components/training/status-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { queryKeys } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { formatElapsed, formatNumber } from "@/lib/format";
import { api } from "@/services/api";
import type { TrainingJob, TrainingMetricPoint } from "@/types/api";

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** Seconds since `from` (until `to`, or now), ticking every second while the job runs. */
function useElapsed(from: string | null, to: string | null, live: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  if (!from) return null;
  return ((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 1000;
}

export function JobCard({ job, metrics }: { job: TrainingJob; metrics: TrainingMetricPoint[] }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [stopping, setStopping] = useState(false);
  const active = isJobActive(job.status);
  const elapsed = useElapsed(job.startedAt, job.finishedAt, active);
  const last = metrics[metrics.length - 1];
  const lastVal = [...metrics].reverse().find((m) => m.valLoss !== null);

  const stop = async () => {
    setConfirm(false);
    setStopping(true);
    try {
      await api.post(`/training/jobs/${job.id}/stop`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.training });
      toast.success("Stopping: the model is saved first");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStopping(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2">
            {job.runName ?? "Starting…"} <JobStatusBadge status={job.status} />
          </CardTitle>
          <CardDescription>
            {job.config.preset}
            {job.config.includeSynthetic ? " · synthetic data" : ""}
            {job.datasets.length > 0 && ` · ${job.datasets.map((d) => `${d.name} v${d.version}`).join(", ")}`}
            {job.startedBy && ` · started by ${job.startedBy.name}`}
          </CardDescription>
        </div>
        {active && can("training:manage") && (
          <Button variant="outline" onClick={() => setConfirm(true)} disabled={stopping || job.status === "STOPPING"}>
            {stopping || job.status === "STOPPING" ? <LoaderCircle className="animate-spin" aria-hidden /> : <Square aria-hidden />}
            {job.status === "STOPPING" ? "Stopping…" : "Stop"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm tabular-nums">
            <span>
              Step {formatNumber(job.currentStep)} of {formatNumber(job.totalSteps)}
            </span>
            <span className="text-muted-foreground">{job.status === "QUEUED" ? "Building the dataset and tokenizer…" : `${Math.round((job.currentStep / Math.max(1, job.totalSteps)) * 100)}%`}</span>
          </div>
          <ProgressBar value={job.currentStep} max={job.totalSteps} label="Training progress" />
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Epoch" value={job.currentEpoch.toFixed(2)} hint="passes over the training data" />
          <Stat label="Training loss" value={last ? last.trainLoss.toFixed(4) : "—"} hint="latest" />
          <Stat label="Validation loss" value={lastVal?.valLoss?.toFixed(4) ?? "—"} hint={job.bestValLoss !== null ? `best ${job.bestValLoss.toFixed(4)}` : "measured every few hundred steps"} />
          <Stat label="Learning rate" value={last ? last.learningRate.toExponential(1) : "—"} />
          <Stat label="Duration" value={elapsed === null ? "—" : formatElapsed(elapsed)} hint={last?.tokensPerSec ? `${formatNumber(last.tokensPerSec)} tokens/s` : undefined} />
          <Stat label="CPU" value={last?.cpuPercent != null ? `${Math.round(last.cpuPercent)}%` : "—"} hint="whole machine" />
          <Stat label="Memory" value={last?.memoryMb != null ? `${formatNumber(last.memoryMb)} MB` : "—"} hint="training process" />
          <Stat label="GPU" value={job.device === "cuda" ? "In use" : job.device ? "None" : "—"} hint={job.device === "cpu" ? "no CUDA GPU: training on the CPU" : undefined} />
        </dl>
        {job.status === "FAILED" && job.errorMessage && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle>Training failed</AlertTitle>
            <AlertDescription>{job.errorMessage}</AlertDescription>
          </Alert>
        )}
        {job.modelVersion && !active && (
          <p className="text-sm">
            {job.modelVersion.status === "READY" ? (
              <>
                Produced model <strong>v{job.modelVersion.version}</strong>. <Link className="underline" href="/models">Evaluate and activate it on the Models page</Link>.
              </>
            ) : (
              `Model v${job.modelVersion.version}: no checkpoint was saved.`
            )}
          </p>
        )}
      </CardContent>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop training?</DialogTitle>
            <DialogDescription>
              The job saves its latest checkpoint and stops. The best checkpoint so far becomes a model version you can evaluate and activate.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Keep training
            </Button>
            <Button variant="destructive" onClick={stop}>
              Stop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
