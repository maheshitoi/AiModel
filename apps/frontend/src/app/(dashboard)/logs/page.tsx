"use client";

import { ChevronRight, ScrollText, Search } from "lucide-react";
import { Fragment, useDeferredValue, useState } from "react";
import { FilterSelect } from "@/components/common/filter-select";
import { PageHeader } from "@/components/common/page-header";
import { PaginationBar } from "@/components/common/pagination-bar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuditLogs, useSystemLogs } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LogCategory, LogLevel } from "@/types/api";

const LEVELS: LogLevel[] = ["ERROR", "WARN", "INFO", "DEBUG"];
const CATEGORIES: LogCategory[] = ["AI", "WHATSAPP", "WEBHOOK", "SECURITY", "BACKEND", "DATABASE", "TRAINING"];
const levelVariant = (l: LogLevel) => (l === "ERROR" ? "destructive" : l === "WARN" ? "outline" : "secondary");
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function Details({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>;
}

function ExpandButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-xs" onClick={onClick} aria-expanded={open} aria-label={open ? "Hide details" : "Show details"}>
      <ChevronRight className={cn("transition-transform", open && "rotate-90")} />
    </Button>
  );
}

function SystemLogs() {
  const [level, setLevel] = useState<LogLevel>();
  const [category, setCategory] = useState<LogCategory>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useDeferredValue(search.trim());
  const { data, isPending, isError, error, refetch } = useSystemLogs({ level, category, search: q, page, pageSize: 50 });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <div className="relative sm:w-72">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} placeholder="Search event or message" className="pl-8" aria-label="Search logs" />
        </div>
        <FilterSelect label="Level" value={level} onChange={(v) => (setLevel(v), setPage(1))} allLabel="All levels" options={LEVELS.map((l) => ({ value: l, label: title(l) }))} />
        <FilterSelect label="Category" value={category} onChange={(v) => (setCategory(v), setPage(1))} allLabel="All categories" options={CATEGORIES.map((c) => ({ value: c, label: c === "AI" ? "AI" : title(c) }))} />
      </div>
      {isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ScrollText} title="No log entries" description="Nothing matches these filters." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Time</TableHead>
                  <TableHead>Level</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((l) => (
                  <Fragment key={l.id}>
                    <TableRow>
                      <TableCell>{(l.context || l.conversationId) && <ExpandButton open={open === l.id} onClick={() => setOpen(open === l.id ? null : l.id)} />}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateTime(l.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant={levelVariant(l.level)}>{title(l.level)}</Badge>
                      </TableCell>
                      <TableCell>{l.category}</TableCell>
                      <TableCell className="font-mono text-xs">{l.event}</TableCell>
                      <TableCell className="max-w-md truncate" title={l.message}>
                        {l.message}
                      </TableCell>
                    </TableRow>
                    {open === l.id && (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={5}>
                          <Details value={{ ...(l.context ?? {}), ...(l.conversationId && { conversationId: l.conversationId }), ...(l.messageId && { messageId: l.messageId }) }} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar meta={data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}

function AuditLogs() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useDeferredValue(action.trim());
  const { data, isPending, isError, error, refetch } = useAuditLogs({ action: q || undefined, page, pageSize: 50 });

  return (
    <div className="space-y-4">
      <Input value={action} onChange={(e) => (setAction(e.target.value), setPage(1))} placeholder="Exact action, e.g. settings.update" className="sm:w-72" aria-label="Filter by action" />
      {isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" description="Changes made by people appear here." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Time</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>On</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((a) => (
                  <Fragment key={a.id}>
                    <TableRow>
                      <TableCell>{(a.before != null || a.after != null) && <ExpandButton open={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)} />}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateTime(a.createdAt)}</TableCell>
                      <TableCell>{a.actor?.email ?? "System"}</TableCell>
                      <TableCell className="font-mono text-xs">{a.action}</TableCell>
                      <TableCell>{a.entityType}</TableCell>
                      <TableCell>{a.ipAddress ?? "—"}</TableCell>
                    </TableRow>
                    {open === a.id && (
                      <TableRow>
                        <TableCell />
                        <TableCell colSpan={5} className="grid gap-2 md:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs text-muted-foreground">Before</p>
                            <Details value={a.before} />
                          </div>
                          <div>
                            <p className="mb-1 text-xs text-muted-foreground">After</p>
                            <Details value={a.after} />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar meta={data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}

export default function LogsPage() {
  const { can } = useAuth();
  const canAudit = can("audit:read");
  const [tab, setTab] = useState<"system" | "audit">("system");

  return (
    <>
      <PageHeader
        title="System logs"
        description="Errors and events from the backend, AI and WhatsApp. Secrets and message text are never logged."
        actions={
          canAudit && (
            <Tabs value={tab} onValueChange={(v) => setTab(v as "system" | "audit")}>
              <TabsList>
                <TabsTrigger value="system">System</TabsTrigger>
                <TabsTrigger value="audit">Audit trail</TabsTrigger>
              </TabsList>
            </Tabs>
          )
        }
      />
      <Card>
        <CardContent>{tab === "audit" && canAudit ? <AuditLogs /> : <SystemLogs />}</CardContent>
      </Card>
    </>
  );
}
