"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/services/api";
import type { DatasetRow } from "@/types/api";

const NAME = /^[\w .-]{1,80}$/;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** Builds a dataset from stored conversations. It is created like an upload: it must still be reviewed and approved. */
export function ExportConversationsDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (d: DatasetRow) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("reviewed-conversations");
  const [since, setSince] = useState(daysAgo(30));
  const [until, setUntil] = useState("");
  const [closedOnly, setClosedOnly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!NAME.test(name)) return setError("Name: letters, digits, spaces, dots, dashes and underscores (max 80)");
    if (!since) return setError("Choose a start date");
    if (until && until < since) return setError("The end date is before the start date");
    setBusy(true);
    setError(null);
    try {
      const dataset = await api.post<DatasetRow>("/datasets/from-conversations", {
        name,
        since: new Date(`${since}T00:00:00`).toISOString(),
        ...(until ? { until: new Date(`${until}T23:59:59`).toISOString() } : {}),
        closedOnly,
      });
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`${dataset.name} v${dataset.version} created from ${dataset.recordCount} conversations`);
      onOpenChange(false);
      onCreated(dataset);
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
          <DialogTitle>Dataset from conversations</DialogTitle>
          <DialogDescription>Turns customer messages and the replies that were actually delivered into training conversations.</DialogDescription>
        </DialogHeader>
        <form id="export-conversations" onSubmit={submit} noValidate className="space-y-4">
          <Alert>
            <ShieldAlert aria-hidden />
            <AlertDescription>
              These are real customer messages. The dataset is marked as customer data and won’t be used until someone reads the preview and approves it.
            </AlertDescription>
          </Alert>
          <div className="space-y-1.5">
            <Label htmlFor="ex-name">Name</Label>
            <Input id="ex-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ex-since">From</Label>
              <Input id="ex-since" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ex-until">To (optional)</Label>
              <Input id="ex-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </div>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="ex-closed">Closed conversations only</Label>
              <p className="text-xs text-muted-foreground">Finished conversations are the most complete examples. Up to 500 are exported.</p>
            </div>
            <Switch id="ex-closed" checked={closedOnly} onCheckedChange={setClosedOnly} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="export-conversations" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" aria-hidden />}
            Create dataset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
