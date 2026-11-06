"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Play, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/states";
import { BarList } from "@/components/usage/usage-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys, useEvaluation } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { formatNumber, formatPercent } from "@/lib/format";
import { api } from "@/services/api";
import type { ModelVersionRow } from "@/types/api";

export const GROUP_LABELS: Record<string, string> = {
  in_distribution: "Questions like the training data",
  paraphrased: "Same questions, new wording",
  safety: "Emergencies and medical advice",
  out_of_scope: "Requests to decline",
};

/** Evaluation report for one version: validation loss, prompt checks by group, and every reply. */
export function EvaluationDialog({ version, onClose }: { version: ModelVersionRow | null; onClose: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useEvaluation(version?.id ?? null);
  const [starting, setStarting] = useState(false);
  const report = data?.report;

  const start = async () => {
    if (!version) return;
    setStarting(true);
    try {
      await api.post(`/models/versions/${version.id}/evaluate`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.evaluation(version.id) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={!!version} onOpenChange={(o) => !o && (onClose(), void queryClient.invalidateQueries({ queryKey: queryKeys.models }))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Evaluation: v{version?.version}</DialogTitle>
          <DialogDescription>{version?.checkpointPath}. Replies are generated greedily, without the inference guardrails, to show what the model itself does.</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : isError ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : data.state === "running" ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Evaluating: measuring validation loss and generating replies to the test prompts. This takes about a minute on a CPU.
          </p>
        ) : !report ? (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">{data.state === "failed" ? data.error : "This version hasn’t been evaluated yet."}</p>
            {can("models:manage") && (
              <Button onClick={start} disabled={starting}>
                {starting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}
                Run evaluation
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">Prompt checks passed</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatPercent(report.overall_pass_rate)}</dd>
              </div>
              <div className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">Validation loss</dt>
                <dd className="text-lg font-semibold tabular-nums">{report.validation.loss.toFixed(4)}</dd>
                <dd className="text-xs text-muted-foreground">untrained ≈ {report.validation.uniform_baseline_loss.toFixed(2)}</dd>
              </div>
              <div className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">Perplexity</dt>
                <dd className="text-lg font-semibold tabular-nums">{report.validation.perplexity.toFixed(2)}</dd>
                <dd className="text-xs text-muted-foreground">{formatNumber(report.validation.assistant_tokens)} reply tokens</dd>
              </div>
              <div className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">Copied from training</dt>
                <dd className="text-lg font-semibold tabular-nums">{formatPercent(report.verbatim_rate)}</dd>
                <dd className="text-xs text-muted-foreground">replies word for word</dd>
              </div>
            </dl>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Passed, by kind of prompt</h3>
              <BarList empty="No prompt checks." rows={Object.entries(report.groups).map(([g, r]) => ({ label: `${GROUP_LABELS[g] ?? g} (${r.passed}/${r.total})`, value: Math.round(r.rate * 100) }))} />
              <p className="text-xs text-muted-foreground">Bars show the percentage passed. A pass means the reply contains an expected fact; read the replies below before trusting it.</p>
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Replies</h3>
              <ol className="space-y-2">
                {report.cases.map((c, i) => (
                  <li key={i} className="rounded-md border p-3 text-sm">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {c.passed ? <Check className="size-4 text-muted-foreground" aria-label="Passed" /> : <X className="size-4 text-destructive" aria-label="Failed" />}
                      <span className="text-xs text-muted-foreground">{GROUP_LABELS[c.group] ?? c.group}</span>
                      {c.verbatim_from_training && <Badge variant="outline">copied from training</Badge>}
                    </div>
                    <p>
                      <span className="font-medium">Customer:</span> {c.prompt.map((t) => t.text).join(" / ")}
                    </p>
                    <p className="pl-4">
                      <span className="font-medium">Model:</span> {c.reply || <em className="text-muted-foreground">(empty)</em>}
                    </p>
                    {!c.passed && <p className="mt-1 text-xs text-muted-foreground">Expected one of: {c.expected_any.join(", ")}</p>}
                  </li>
                ))}
              </ol>
            </section>
            {can("models:manage") && (
              <Button variant="outline" onClick={start} disabled={starting}>
                {starting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Play aria-hidden />}
                Evaluate again
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
