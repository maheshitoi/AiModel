"use client";

import { History, Pencil, Plus, Search, Users } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { PaginationBar } from "@/components/common/pagination-bar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SecuritySettingsForm } from "@/components/users/security-settings-form";
import { UserDialog } from "@/components/users/user-dialog";
import { useUsers, useUserSessions } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { UserRow } from "@/types/api";

function userState(u: UserRow): { label: string; variant: "secondary" | "outline" | "destructive" } {
  if (!u.isActive) return { label: "Deactivated", variant: "outline" };
  if (u.lockedUntil && new Date(u.lockedUntil) > new Date()) return { label: "Locked", variant: "destructive" };
  return { label: "Active", variant: "secondary" };
}

function LoginHistory({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const { data, isPending, isError, error } = useUserSessions(user?.id ?? null);
  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sign-ins: {user?.name}</DialogTitle>
          <DialogDescription>The last 50 sign-ins and whether each session is still active.</DialogDescription>
        </DialogHeader>
        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <ErrorState message={error.message} />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Never signed in.</p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Signed in</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => {
                  const active = !s.revokedAt && new Date(s.expiresAt) > new Date();
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="whitespace-nowrap" title={s.userAgent ?? undefined}>
                        {formatDateTime(s.createdAt)}
                      </TableCell>
                      <TableCell>{formatRelative(s.lastUsedAt)}</TableCell>
                      <TableCell>{s.ipAddress ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={active ? "secondary" : "outline"}>{s.revokedAt ? "Signed out" : active ? "Active" : "Expired"}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const { state } = useAuth();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserRow | undefined>();
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState<UserRow | null>(null);
  const q = useDeferredValue(search.trim());
  const { data, isPending, isError, error, refetch } = useUsers({ search: q || undefined, page, pageSize: 25 });

  return (
    <>
      <PageHeader
        title="Users & security"
        description="Who can sign in, what their role allows, and sign-in policy"
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add user
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardContent className="space-y-4">
            <div className="relative sm:w-72">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} placeholder="Search name or email" className="pl-8" aria-label="Search users" />
            </div>
            {isPending ? (
              <Skeleton className="h-64 w-full" />
            ) : isError ? (
              <ErrorState message={error.message} onRetry={() => refetch()} />
            ) : data.items.length === 0 ? (
              <EmptyState icon={Users} title="No users found" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last sign-in</TableHead>
                        <TableHead className="sr-only">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.items.map((u) => {
                        const s = userState(u);
                        return (
                          <TableRow key={u.id}>
                            <TableCell>
                              <p className="font-medium">{u.name}</p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </TableCell>
                            <TableCell>{u.role.name.charAt(0) + u.role.name.slice(1).toLowerCase()}</TableCell>
                            <TableCell>
                              <Badge variant={s.variant}>{s.label}</Badge>
                            </TableCell>
                            <TableCell>{formatRelative(u.lastLoginAt)}</TableCell>
                            <TableCell className="text-right whitespace-nowrap">
                              <Button variant="ghost" size="icon-sm" onClick={() => setHistory(u)} aria-label={`Sign-in history for ${u.name}`}>
                                <History />
                              </Button>
                              <Button variant="ghost" size="icon-sm" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>
                                <Pencil />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <PaginationBar meta={data.meta} onPage={setPage} />
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sign-in policy</CardTitle>
            <CardDescription>Applies to everyone. Changes are audited.</CardDescription>
          </CardHeader>
          <CardContent>
            <SecuritySettingsForm />
          </CardContent>
        </Card>
      </div>
      <UserDialog open={adding} onOpenChange={setAdding} />
      <UserDialog open={!!editing} onOpenChange={(o) => !o && setEditing(undefined)} user={editing} isSelf={editing?.id === state.user?.id} />
      <LoginHistory user={history} onClose={() => setHistory(null)} />
    </>
  );
}
