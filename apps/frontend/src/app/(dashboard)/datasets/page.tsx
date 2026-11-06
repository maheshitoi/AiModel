"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Database, Eye, Info, MessagesSquare, MoreHorizontal, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";
import { FilterSelect } from "@/components/common/filter-select";
import { PageHeader } from "@/components/common/page-header";
import { PaginationBar } from "@/components/common/pagination-bar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { DatasetDialog } from "@/components/datasets/dataset-dialog";
import { ExportConversationsDialog } from "@/components/datasets/export-dialog";
import { UploadDatasetDialog } from "@/components/datasets/upload-dialog";
import { DatasetStatusBadge } from "@/components/training/status-badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDatasets } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { formatBytes, formatNumber, formatRelative } from "@/lib/format";
import { api } from "@/services/api";
import type { DatasetRow, DatasetStatus } from "@/types/api";

const STATUS_OPTIONS: { value: DatasetStatus; label: string }[] = [
  { value: "VALID", label: "Needs review" },
  { value: "APPROVED", label: "Approved" },
  { value: "INVALID", label: "Invalid" },
  { value: "ARCHIVED", label: "Archived" },
];

export default function DatasetsPage() {
  const { can } = useAuth();
  const canManage = can("datasets:manage");
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<DatasetStatus | undefined>();
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState<DatasetRow | null>(null);
  const [deleting, setDeleting] = useState<DatasetRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const q = useDeferredValue(search.trim());
  const { data, isPending, isError, error, refetch } = useDatasets({ search: q || undefined, status, page, pageSize: 20 });

  const act = async (d: DatasetRow, run: () => Promise<unknown>, done: string) => {
    setBusyId(d.id);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(done);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const d = deleting;
    setDeleting(null);
    await act(d, () => api.delete(`/datasets/${d.id}`), d._count.trainingJobs > 0 ? `${d.name} v${d.version} archived` : `${d.name} v${d.version} deleted`);
  };

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Training data: uploaded, checked, reviewed and switched on"
        actions={
          canManage && (
            <>
              {can("conversations:read") && (
                <Button variant="outline" onClick={() => setExporting(true)}>
                  <MessagesSquare aria-hidden />
                  <span className="hidden sm:inline">From conversations</span>
                </Button>
              )}
              <Button onClick={() => setUploading(true)}>
                <Upload aria-hidden />
                Upload
              </Button>
            </>
          )
        }
      />
      <Alert>
        <Info aria-hidden />
        <AlertDescription>
          Training uses only datasets that are <strong>approved</strong> and <strong>active</strong>, plus (optionally) the synthetic conversations generated from your business
          facts. Customer conversations are never added automatically.
        </AlertDescription>
      </Alert>
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative sm:w-72">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} placeholder="Search name or file" className="pl-8" aria-label="Search datasets" />
            </div>
            <FilterSelect label="Status" value={status} onChange={(v) => (setStatus(v), setPage(1))} options={STATUS_OPTIONS} allLabel="All statuses" />
          </div>
          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : isError ? (
            <ErrorState message={error.message} onRetry={() => refetch()} />
          ) : data.items.length === 0 ? (
            <EmptyState
              icon={Database}
              title={q || status ? "No datasets match" : "No datasets yet"}
              description={q || status ? undefined : "Upload conversations to train on, or build a dataset from reviewed customer conversations."}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dataset</TableHead>
                      <TableHead className="text-right">Records</TableHead>
                      <TableHead className="text-right">Size</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead className="sr-only">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          <button type="button" className="text-left font-medium hover:underline" onClick={() => setOpen(d)}>
                            {d.name} <span className="text-muted-foreground">v{d.version}</span>
                          </button>
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {d.fileName}
                            {d.containsCustomerData && <Badge variant="outline">Customer data</Badge>}
                          </p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(d.recordCount)}
                          {d.stats && d.stats.unique !== d.recordCount && <p className="text-xs text-muted-foreground">{formatNumber(d.stats.unique)} usable</p>}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap tabular-nums">{formatBytes(d.sizeBytes)}</TableCell>
                        <TableCell>
                          <DatasetStatusBadge status={d.status} />
                        </TableCell>
                        <TableCell>
                          <Switch
                            aria-label={`Use ${d.name} v${d.version} for training`}
                            checked={d.isActive}
                            disabled={!canManage || d.status !== "APPROVED" || busyId === d.id}
                            onCheckedChange={(on) =>
                              act(d, () => api.post(`/datasets/${d.id}/${on ? "activate" : "deactivate"}`), on ? `${d.name} v${d.version} will be used for training` : `${d.name} v${d.version} switched off`)
                            }
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatRelative(d.createdAt)}
                          {d.uploadedBy && <p className="text-xs text-muted-foreground">{d.uploadedBy.name}</p>}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <Button variant="ghost" size="icon-sm" onClick={() => setOpen(d)} aria-label={`Review ${d.name} v${d.version}`}>
                            <Eye />
                          </Button>
                          {canManage && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${d.name} v${d.version}`}>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem disabled={d.status === "ARCHIVED"} onSelect={() => act(d, () => api.post(`/datasets/${d.id}/validate`), "Validation finished")}>
                                  <RefreshCw aria-hidden />
                                  Validate again
                                </DropdownMenuItem>
                                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(d)}>
                                  <Trash2 aria-hidden />
                                  {d._count.trainingJobs > 0 ? "Archive" : "Delete"}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PaginationBar meta={data.meta} onPage={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      <UploadDatasetDialog open={uploading} onOpenChange={setUploading} onUploaded={setOpen} />
      <ExportConversationsDialog open={exporting} onOpenChange={setExporting} onCreated={setOpen} />
      <DatasetDialog dataset={open} onClose={() => setOpen(null)} />
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deleting?._count.trainingJobs ? "Archive" : "Delete"} {deleting?.name} v{deleting?.version}?
            </DialogTitle>
            <DialogDescription>
              {deleting?._count.trainingJobs
                ? `It was used by ${deleting._count.trainingJobs} training job${deleting._count.trainingJobs === 1 ? "" : "s"}, so it is archived instead of deleted: the file is kept so those models stay reproducible, but it can no longer be used.`
                : "The file and its record are deleted permanently."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove}>
              {deleting?._count.trainingJobs ? "Archive" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
