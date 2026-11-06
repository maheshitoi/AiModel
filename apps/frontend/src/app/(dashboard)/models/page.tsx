"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Brain, ClipboardCheck, LoaderCircle, Play, Power } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { AiStatusCard } from "@/components/ai/ai-status-card";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { EvaluationDialog } from "@/components/models/evaluation-dialog";
import { JobStatusBadge, VersionStatusBadge } from "@/components/training/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { queryKeys, useCurrentJob, useModels } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { useTrainingSocket } from "@/hooks/use-live-updates";
import { formatCompact, formatDateTime, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import { api } from "@/services/api";
import type { ModelVersionRow } from "@/types/api";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium break-all">{children}</dd>
    </div>
  );
}

function EvalSummaryCell({ v }: { v: ModelVersionRow }) {
  const m = v.evalMetrics;
  if (!m) return <span className="text-muted-foreground">Not evaluated</span>;
  const safety = m.groups.safety;
  return (
    <span className="tabular-nums">
      {formatPercent(m.overall_pass_rate)} passed
      {safety && (
        <span className="block text-xs text-muted-foreground">
          Safety prompts: {safety.passed}/{safety.total}
        </span>
      )}
    </span>
  );
}

export default function ModelsPage() {
  const { can } = useAuth();
  const canManage = can("models:manage");
  const queryClient = useQueryClient();
  useTrainingSocket();
  const { data, isPending, isError, error, refetch } = useModels();
  const current = useCurrentJob();
  const [evaluating, setEvaluating] = useState<ModelVersionRow | null>(null);
  const [activating, setActivating] = useState<ModelVersionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const model = data?.[0];
  const versions = model?.versions ?? [];
  const active = versions.find((v) => v.isActive);
  const lastTrained = versions.find((v) => v.trainedAt)?.trainedAt ?? null;

  const activate = async () => {
    if (!activating) return;
    setBusy(true);
    try {
      await api.post(`/models/versions/${activating.id}/activate`);
      await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.models }), queryClient.invalidateQueries({ queryKey: queryKeys.aiStatus })]);
      toast.success(`v${activating.version} is now answering customers`);
      setActivating(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Models"
        description="Every version trained from scratch, how it scored, and which one is live"
        actions={
          can("training:read") && (
            <Button asChild variant={current.data ? "outline" : "default"}>
              <Link href="/training">
                <Play aria-hidden />
                {current.data ? "View training" : "Train a new version"}
              </Link>
            </Button>
          )
        }
      />
      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : isError ? (
        <Card>
          <ErrorState message={error.message} onRetry={() => refetch()} />
        </Card>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{model?.name ?? "No model yet"}</CardTitle>
                <CardDescription>{model?.description ?? "Train a first version to get started."}</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2">
                  <Row label="Architecture">{model?.architecture ?? "—"}</Row>
                  <Row label="Current version">{active ? `v${active.version}` : "None active"}</Row>
                  <Row label="Status">{active ? <VersionStatusBadge status={active.status} active /> : "—"}</Row>
                  <Row label="Parameters">{active ? formatNumber(active.parameterCount) : "—"}</Row>
                  <Row label="Vocabulary">{active ? `${formatNumber(active.vocabSize)} tokens` : "—"}</Row>
                  <Row label="Context length">{active ? `${formatNumber(active.contextLength)} tokens` : "—"}</Row>
                  <Row label="Active checkpoint">{active?.checkpointPath ?? "—"}</Row>
                  <Row label="Last trained">{lastTrained ? formatDateTime(lastTrained) : "—"}</Row>
                  <Row label="Training">
                    {current.data ? (
                      <Link href="/training" className="inline-flex items-center gap-2 underline">
                        <JobStatusBadge status={current.data.status} /> {formatNumber(current.data.currentStep)} / {formatNumber(current.data.totalSteps)} steps
                      </Link>
                    ) : (
                      "Idle"
                    )}
                  </Row>
                </dl>
              </CardContent>
            </Card>
            <AiStatusCard />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Versions</CardTitle>
              <CardDescription>Evaluate a version before activating it. Activation switches every customer conversation to that version.</CardDescription>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <EmptyState icon={Brain} title="No versions yet" description="Versions appear here when training starts, or when a checkpoint is loaded." />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Parameters</TableHead>
                        <TableHead className="text-right">Best validation loss</TableHead>
                        <TableHead>Evaluation</TableHead>
                        <TableHead>Trained</TableHead>
                        <TableHead className="sr-only">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {versions.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell>
                            <p className="font-medium">v{v.version}</p>
                            <p className="text-xs break-all text-muted-foreground">{v.checkpointPath}</p>
                          </TableCell>
                          <TableCell>
                            <VersionStatusBadge status={v.status} active={v.isActive} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatCompact(v.parameterCount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{v.trainingJob?.bestValLoss?.toFixed(4) ?? "—"}</TableCell>
                          <TableCell>
                            <EvalSummaryCell v={v} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">{v.trainedAt ? formatRelative(v.trainedAt) : v.status === "TRAINING" ? "in progress" : formatRelative(v.createdAt)}</TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <Button variant="ghost" size="sm" disabled={v.status !== "READY"} onClick={() => setEvaluating(v)}>
                              <ClipboardCheck aria-hidden />
                              {v.evalMetrics ? "Report" : "Evaluate"}
                            </Button>
                            {canManage && !v.isActive && (
                              <Button variant="ghost" size="sm" disabled={v.status !== "READY"} onClick={() => setActivating(v)}>
                                <Power aria-hidden />
                                Activate
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <EvaluationDialog version={evaluating} onClose={() => setEvaluating(null)} />
      <Dialog open={!!activating} onOpenChange={(o) => !o && setActivating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate v{activating?.version}?</DialogTitle>
            <DialogDescription>
              Every new customer message will be answered by this version{active ? ` instead of v${active.version}` : ""}. The safety rules and confidence check still apply.
            </DialogDescription>
          </DialogHeader>
          {activating && !activating.evalMetrics && <p className="text-sm text-destructive">This version hasn’t been evaluated. Consider running the evaluation first.</p>}
          {activating?.evalMetrics && (
            <p className="text-sm">
              Evaluation: {formatPercent(activating.evalMetrics.overall_pass_rate)} of prompt checks passed
              {activating.evalMetrics.groups.safety && `, safety ${activating.evalMetrics.groups.safety.passed}/${activating.evalMetrics.groups.safety.total}`}.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivating(null)}>
              Cancel
            </Button>
            <Button onClick={activate} disabled={busy}>
              {busy && <LoaderCircle className="animate-spin" aria-hidden />}
              Activate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
