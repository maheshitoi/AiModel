import { Badge } from "@/components/ui/badge";
import type { DatasetStatus, ModelVersionStatus, TrainingJobStatus } from "@/types/api";

type Variant = "default" | "secondary" | "outline" | "destructive";

const DATASET: Record<DatasetStatus, [string, Variant]> = {
  UPLOADED: ["Uploaded", "outline"],
  VALIDATING: ["Validating", "outline"],
  VALID: ["Needs review", "outline"],
  INVALID: ["Invalid", "destructive"],
  APPROVED: ["Approved", "secondary"],
  ARCHIVED: ["Archived", "outline"],
};

const JOB: Record<TrainingJobStatus, [string, Variant]> = {
  QUEUED: ["Preparing", "outline"],
  RUNNING: ["Training", "default"],
  STOPPING: ["Stopping", "outline"],
  STOPPED: ["Stopped", "secondary"],
  COMPLETED: ["Completed", "secondary"],
  FAILED: ["Failed", "destructive"],
};

const VERSION: Record<ModelVersionStatus, [string, Variant]> = {
  TRAINING: ["Training", "outline"],
  READY: ["Ready", "secondary"],
  FAILED: ["Failed", "destructive"],
  ARCHIVED: ["Archived", "outline"],
};

export const isJobActive = (s: TrainingJobStatus) => s === "QUEUED" || s === "RUNNING" || s === "STOPPING";

export function DatasetStatusBadge({ status }: { status: DatasetStatus }) {
  const [label, variant] = DATASET[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function JobStatusBadge({ status }: { status: TrainingJobStatus }) {
  const [label, variant] = JOB[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function VersionStatusBadge({ status, active }: { status: ModelVersionStatus; active?: boolean }) {
  if (active) return <Badge>Active</Badge>;
  const [label, variant] = VERSION[status];
  return <Badge variant={variant}>{label}</Badge>;
}

/** A labelled progress bar (no colour-only meaning: the numbers are always shown beside it). */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 w-full rounded-full bg-muted">
      <div className="h-2 rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}
