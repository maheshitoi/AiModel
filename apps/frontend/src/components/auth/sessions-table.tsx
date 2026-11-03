"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { queryKeys, useSessions } from "@/hooks/queries";
import { formatDateTime, formatRelative } from "@/lib/format";
import { api } from "@/services/api";
import type { SessionInfo } from "@/types/api";

function sessionState(s: SessionInfo): { label: string; variant: "default" | "secondary" | "outline" } {
  if (s.current) return { label: "This device", variant: "default" };
  if (s.revokedAt) return { label: "Signed out", variant: "outline" };
  if (new Date(s.expiresAt) <= new Date()) return { label: "Expired", variant: "outline" };
  return { label: "Active", variant: "secondary" };
}

export function SessionsTable() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useSessions();
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => {
      toast.success("Session signed out");
      return queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isPending) return <Skeleton className="h-40 w-full" />;
  if (isError) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Device</TableHead>
            <TableHead>IP address</TableHead>
            <TableHead>Signed in</TableHead>
            <TableHead>Last active</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="sr-only">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((s) => {
            const state = sessionState(s);
            const canRevoke = state.label === "Active";
            return (
              <TableRow key={s.id}>
                <TableCell className="max-w-64 truncate" title={s.userAgent ?? undefined}>
                  {s.userAgent ?? "Unknown"}
                </TableCell>
                <TableCell>{s.ipAddress ?? "—"}</TableCell>
                <TableCell>{formatDateTime(s.createdAt)}</TableCell>
                <TableCell>{formatRelative(s.lastUsedAt)}</TableCell>
                <TableCell>
                  <Badge variant={state.variant}>{state.label}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {canRevoke && (
                    <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}>
                      Sign out
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
