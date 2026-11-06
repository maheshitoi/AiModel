"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LoaderCircle, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/states";
import { DatasetStatusBadge } from "@/components/training/status-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useDatasetPreview } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { formatNumber } from "@/lib/format";
import { api } from "@/services/api";
import type { DatasetRow } from "@/types/api";

const PAGE = 10;

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** Review a dataset: its validation report, the problems found, the cleaned conversations, and approval. */
export function DatasetDialog({ dataset, onClose }: { dataset: DatasetRow | null; onClose: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const usable = dataset && dataset.status !== "INVALID" && (dataset.stats?.valid_records ?? 0) > 0;
  const preview = useDatasetPreview(usable ? dataset.id : null, offset, PAGE);
  const stats = dataset?.stats;
  const issues = dataset?.validationErrors;

  const close = () => {
    setOffset(0);
    setReviewed(false);
    onClose();
  };

  const approve = async () => {
    if (!dataset) return;
    setBusy(true);
    try {
      await api.post(`/datasets/${dataset.id}/approve`, dataset.containsCustomerData ? { reviewedCustomerData: reviewed } : {});
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`${dataset.name} v${dataset.version} approved. Activate it to train on it.`);
      close();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!dataset} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {dataset && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {dataset.name} v{dataset.version}
                <DatasetStatusBadge status={dataset.status} />
                {dataset.containsCustomerData && <Badge variant="outline">Customer data</Badge>}
              </DialogTitle>
              <DialogDescription>
                {dataset.fileName}
                {dataset.description ? ` · ${dataset.description}` : ""}
              </DialogDescription>
            </DialogHeader>

            {stats && (
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Fact label="Records" value={formatNumber(stats.records)} hint={`${formatNumber(stats.valid_records)} valid`} />
                <Fact label="Duplicates removed" value={formatNumber(stats.duplicates)} hint="same text, ignoring case and spacing" />
                <Fact label="Unique conversations" value={formatNumber(stats.unique)} hint={`${formatNumber(stats.turns)} turns`} />
                <Fact label="Train / validation" value={`${formatNumber(stats.train)} / ${formatNumber(stats.validation)}`} hint="split by content, stable across versions" />
              </dl>
            )}

            {issues && issues.issueCount > 0 && (
              <Alert variant="destructive">
                <AlertTitle>
                  {formatNumber(issues.issueCount)} problem{issues.issueCount === 1 ? "" : "s"} found
                </AlertTitle>
                <AlertDescription>
                  <ul className="mt-1 max-h-40 list-inside list-disc overflow-y-auto">
                    {issues.issues.map((i, n) => (
                      <li key={n}>
                        Record {i.record}: {i.message}
                      </li>
                    ))}
                  </ul>
                  {issues.issueCount > issues.issues.length && <p className="mt-1">…and {formatNumber(issues.issueCount - issues.issues.length)} more. Fix the file and upload it again.</p>}
                </AlertDescription>
              </Alert>
            )}
            {issues?.empty && issues.issueCount === 0 && <p className="text-sm text-destructive">Nothing in this file can be used for training.</p>}

            {usable && (
              <section aria-labelledby="preview-title" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="preview-title" className="text-sm font-medium">
                    Preview <span className="font-normal text-muted-foreground">(after cleaning; phone numbers and emails masked)</span>
                  </h3>
                  {preview.data && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                      {offset + 1}–{Math.min(offset + PAGE, preview.data.total)} of {formatNumber(preview.data.total)}
                      <Button variant="ghost" size="icon-sm" aria-label="Previous conversations" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                        <ChevronLeft />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Next conversations" disabled={offset + PAGE >= preview.data.total} onClick={() => setOffset(offset + PAGE)}>
                        <ChevronRight />
                      </Button>
                    </div>
                  )}
                </div>
                {preview.isPending ? (
                  <Skeleton className="h-48 w-full" />
                ) : preview.isError ? (
                  <ErrorState message={preview.error.message} onRetry={() => preview.refetch()} />
                ) : (
                  <ol className="space-y-3">
                    {preview.data.items.map((c, i) => (
                      <li key={offset + i} className="space-y-1.5 rounded-md border p-3 text-sm">
                        {c.intent && <p className="text-xs text-muted-foreground">Intent: {c.intent}</p>}
                        {c.messages.map((m, j) => (
                          <p key={j} className={m.role === "assistant" ? "pl-4" : undefined}>
                            <span className="font-medium">{m.role === "customer" ? "Customer" : "Assistant"}:</span> <span className="whitespace-pre-wrap">{m.text}</span>
                          </p>
                        ))}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {can("datasets:manage") && dataset.status === "VALID" && (
              <section className="space-y-3 border-t pt-4">
                {dataset.containsCustomerData && (
                  <Alert>
                    <ShieldAlert aria-hidden />
                    <AlertTitle>Customer conversations</AlertTitle>
                    <AlertDescription>
                      <div className="mt-2 flex items-start gap-3">
                        <Switch id="reviewed" checked={reviewed} onCheckedChange={setReviewed} />
                        <Label htmlFor="reviewed" className="leading-snug font-normal">
                          I have read these conversations. They contain nothing that shouldn’t be learned or repeated, and the replies are ones we’d want the model to give.
                        </Label>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex justify-end">
                  <Button onClick={approve} disabled={busy || (dataset.containsCustomerData && !reviewed)}>
                    {busy && <LoaderCircle className="animate-spin" aria-hidden />}
                    Approve for training
                  </Button>
                </div>
              </section>
            )}
            {dataset.approvedBy && (
              <p className="text-xs text-muted-foreground">
                Approved by {dataset.approvedBy.name}
                {dataset.approvedAt ? ` on ${new Date(dataset.approvedAt).toLocaleDateString()}` : ""}.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
