"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/lib/format";
import { api } from "@/services/api";
import type { DatasetRow } from "@/types/api";

// Mirrors the backend limits (datasets.controller.ts, training.dto.ts).
const MAX_BYTES = 20 * 1024 * 1024;
const NAME = /^[\w .-]{1,80}$/;
const nameFromFile = (file: string) => file.replace(/\.[^.]+$/, "").replace(/[^\w .-]/g, "-").slice(0, 80);

export function UploadDatasetDialog({ open, onOpenChange, onUploaded }: { open: boolean; onOpenChange: (o: boolean) => void; onUploaded: (d: DatasetRow) => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [customerData, setCustomerData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setName("");
    setDescription("");
    setCustomerData(false);
    setError(null);
  };

  const pick = (f: File | null) => {
    setError(null);
    setFile(f);
    if (f && !name) setName(nameFromFile(f.name));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError("Choose a file");
    if (!/\.(json|jsonl|txt)$/i.test(file.name)) return setError("Use a .json, .jsonl or .txt file");
    if (file.size > MAX_BYTES) return setError(`The file is ${formatBytes(file.size)}; the limit is 20 MB`);
    if (!NAME.test(name)) return setError("Name: letters, digits, spaces, dots, dashes and underscores (max 80)");
    const form = new FormData();
    form.set("file", file);
    form.set("name", name);
    if (description) form.set("description", description);
    form.set("containsCustomerData", String(customerData));
    setBusy(true);
    try {
      const dataset = await api.upload<DatasetRow>("/datasets", form);
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(dataset.status === "INVALID" ? `${dataset.name} v${dataset.version} uploaded with problems` : `${dataset.name} v${dataset.version} uploaded`);
      reset();
      onOpenChange(false);
      onUploaded(dataset);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o || reset(), onOpenChange(o))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload dataset</DialogTitle>
          <DialogDescription>
            Conversations in JSON, JSONL or text format. The file is checked straight away; nothing is used for training until you approve and activate it.
          </DialogDescription>
        </DialogHeader>
        <form id="upload-dataset" onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ds-file">File</Label>
            <Input id="ds-file" type="file" accept=".json,.jsonl,.txt" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
            <p className="text-xs text-muted-foreground">
              JSONL: one <code>{`{"messages": [{"role": "customer", "text": "…"}, {"role": "assistant", "text": "…"}]}`}</code> per line. Text: “Customer:” and
              “Assistant:” lines, a blank line between conversations. Max 20 MB.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ds-name">Name</Label>
            <Input id="ds-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="clinic-faq" />
            <p className="text-xs text-muted-foreground">Uploading again under the same name creates the next version.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ds-description">Description (optional)</Label>
            <Textarea id="ds-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="ds-customer">Contains real customer conversations</Label>
              <p className="text-xs text-muted-foreground">Approving it will require confirming that you reviewed it. Phone numbers and emails in customer turns are masked.</p>
            </div>
            <Switch id="ds-customer" checked={customerData} onCheckedChange={setCustomerData} />
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
          <Button type="submit" form="upload-dataset" disabled={busy}>
            {busy && <LoaderCircle className="animate-spin" aria-hidden />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
