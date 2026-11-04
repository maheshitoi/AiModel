"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys, useAiCheckpoints, useAiStatus } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { formatNumber, formatRelative } from "@/lib/format";
import { api } from "@/services/api";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium break-all">{children}</dd>
    </div>
  );
}

export function AiStatusCard() {
  const { can } = useAuth();
  const canManage = can("models:manage");
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useAiStatus();
  const checkpoints = useAiCheckpoints(canManage && !!data?.reachable);
  const [choice, setChoice] = useState<string>("");

  const activate = useMutation({
    mutationFn: (checkpoint: string) => api.post("/ai/models/activate", { checkpoint }),
    onSuccess: () => {
      toast.success("Model activated");
      setChoice("");
      return queryClient.invalidateQueries({ queryKey: queryKeys.aiStatus });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Model</CardTitle>
        <CardDescription>The model the AI service is using to answer customers</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : isError ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : !data.reachable ? (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle>AI service unavailable</AlertTitle>
            <AlertDescription>{data.error}. Customers get no AI replies until it is back.</AlertDescription>
          </Alert>
        ) : (
          <>
            <dl className="space-y-2">
              <Row label="Loaded">{data.model ? data.model.name : <Badge variant="destructive">No model</Badge>}</Row>
              {data.model && (
                <>
                  <Row label="Checkpoint">{data.model.checkpoint}</Row>
                  <Row label="Parameters">{formatNumber(data.model.parameters)}</Row>
                  <Row label="Context length">{formatNumber(data.model.context_length)} tokens</Row>
                  <Row label="Trained for">{data.model.business_name}</Row>
                </>
              )}
              <Row label="Active version">
                {data.activeVersion ? `v${data.activeVersion.version} · ${formatRelative(data.activeVersion.activatedAt)}` : "None set"}
              </Row>
              <Row label="In sync">{data.inSync ? <Badge variant="secondary">Yes</Badge> : <Badge variant="destructive">No</Badge>}</Row>
            </dl>
            {data.model?.facts_source === "default" && (
              <Alert>
                <CircleAlert aria-hidden />
                <AlertTitle>No business facts saved with this model</AlertTitle>
                <AlertDescription>Replies are checked against ai-model/config/business.json. Retrain to record the facts used.</AlertDescription>
              </Alert>
            )}
            {data.lastLoadError && <p className="text-sm text-destructive">Last load error: {data.lastLoadError}</p>}
            {canManage && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={choice} onValueChange={setChoice}>
                  <SelectTrigger className="w-full sm:w-64" aria-label="Checkpoint to activate">
                    <SelectValue placeholder="Choose a checkpoint" />
                  </SelectTrigger>
                  <SelectContent>
                    {(checkpoints.data ?? []).map((c) => (
                      <SelectItem key={c.checkpoint} value={c.checkpoint}>
                        {c.checkpoint}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" disabled={!choice || activate.isPending} onClick={() => activate.mutate(choice)}>
                  {activate.isPending && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
                  Activate
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
