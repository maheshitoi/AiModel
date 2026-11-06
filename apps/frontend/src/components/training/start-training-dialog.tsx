"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { queryKeys, useDatasets, useTrainingPresets } from "@/hooks/queries";
import { formatNumber } from "@/lib/format";
import { api } from "@/services/api";
import type { TrainingJob } from "@/types/api";

export function StartTrainingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const presets = useTrainingPresets(open);
  const approved = useDatasets({ status: "APPROVED", pageSize: 100 });
  const active = (approved.data?.items ?? []).filter((d) => d.isActive);
  const [presetName, setPresetName] = useState<string>("");
  const [steps, setSteps] = useState("");
  const [synthetic, setSynthetic] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preset = presets.data?.find((p) => p.name === (presetName || presets.data[0]?.name));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preset) return;
    const maxSteps = steps ? Number(steps) : undefined;
    if (maxSteps !== undefined && (!Number.isInteger(maxSteps) || maxSteps < 10 || maxSteps > 1_000_000)) return setError("Steps: a whole number from 10 to 1,000,000");
    if (!synthetic && active.length === 0) return setError("Activate a dataset or include the synthetic conversations");
    setBusy(true);
    setError(null);
    try {
      const job = await api.post<TrainingJob>("/training/jobs", { preset: preset.name, maxSteps, includeSynthetic: synthetic });
      await queryClient.invalidateQueries({ queryKey: queryKeys.training });
      toast.success(`Training started (${job.runName})`);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start training</DialogTitle>
          <DialogDescription>Trains a new model version from random initialisation. The current model keeps answering until you activate the new one.</DialogDescription>
        </DialogHeader>
        {presets.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : presets.isError ? (
          <p className="text-sm text-destructive">{presets.error.message}</p>
        ) : (
          <form id="start-training" onSubmit={submit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="preset">Model size</Label>
              <Select value={preset?.name} onValueChange={setPresetName}>
                <SelectTrigger id="preset" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presets.data.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {preset && (
                <p className="text-xs text-muted-foreground">
                  {preset.description} {String(preset.model.n_layer)} layers × {String(preset.model.n_embd)} wide, {String(preset.model.context_length)}-token context, batch{" "}
                  {preset.training.batch_size}.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="steps">Training steps</Label>
              <Input id="steps" inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={preset ? String(preset.training.max_steps) : ""} />
              <p className="text-xs text-muted-foreground">Leave empty for the preset’s {preset ? formatNumber(preset.training.max_steps) : ""}. Training also stops early once validation loss stops improving.</p>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div>
                <Label htmlFor="synthetic">Include synthetic conversations</Label>
                <p className="text-xs text-muted-foreground">
                  {preset ? `${formatNumber(preset.dataset.synthetic_conversations)} conversations` : "Conversations"} generated from your business facts (ai-model/config/business.json).
                </p>
              </div>
              <Switch id="synthetic" checked={synthetic} onCheckedChange={setSynthetic} />
            </div>
            <div className="space-y-1 text-sm">
              <p className="font-medium">Active datasets</p>
              {approved.isPending ? (
                <Skeleton className="h-5 w-40" />
              ) : active.length === 0 ? (
                <p className="text-muted-foreground">
                  None. <Link className="underline" href="/datasets">Approve and activate datasets</Link> to train on your own conversations.
                </p>
              ) : (
                <ul className="list-inside list-disc text-muted-foreground">
                  {active.map((d) => (
                    <li key={d.id}>
                      {d.name} v{d.version} ({formatNumber(d.stats?.unique ?? d.recordCount)} conversations)
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Alert>
              <CircleAlert aria-hidden />
              <AlertDescription>Training shares the computer with the AI service: replies to customers get slower while it runs.</AlertDescription>
            </Alert>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="start-training" disabled={busy || !preset}>
            {busy && <LoaderCircle className="animate-spin" aria-hidden />}
            Start training
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
