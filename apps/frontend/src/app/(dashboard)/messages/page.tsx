"use client";

import { MessagesSquare, Search } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { FilterSelect } from "@/components/common/filter-select";
import { PageHeader } from "@/components/common/page-header";
import { PaginationBar } from "@/components/common/pagination-bar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { customerLabel } from "@/components/inbox/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMessageSearch } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { formatDateTime } from "@/lib/format";
import type { MessageRow, MessageStatus } from "@/types/api";

type Direction = MessageRow["direction"];
type Source = MessageRow["source"];

const STATUS_OPTIONS: { value: MessageStatus; label: string }[] = [
  { value: "RECEIVED", label: "Received" },
  { value: "QUEUED", label: "Queued" },
  { value: "SENT", label: "Sent" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "READ", label: "Read" },
  { value: "FAILED", label: "Failed" },
];

const statusVariant = (s: MessageStatus) => (s === "FAILED" ? "destructive" : s === "READ" || s === "DELIVERED" ? "secondary" : "outline");
const sender = (m: MessageRow) => (m.direction === "INBOUND" ? "Customer" : m.source === "AI" ? "AI" : (m.sentBy?.name ?? "Staff"));

export default function MessagesPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<Direction>();
  const [source, setSource] = useState<Source>();
  const [status, setStatus] = useState<MessageStatus>();
  const [page, setPage] = useState(1);
  const q = useDeferredValue(search.trim());
  const { data, isPending, isError, error, refetch } = useMessageSearch({ search: q, direction, source, status, page, pageSize: 25 });
  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));

  return (
    <>
      <PageHeader title="Messages" description="Every WhatsApp message, across all conversations" />
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <div className="relative sm:w-72">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => reset(setSearch)(e.target.value)} placeholder="Search message text" className="pl-8" aria-label="Search messages" />
            </div>
            <FilterSelect label="Direction" value={direction} onChange={reset(setDirection)} allLabel="Both directions" options={[{ value: "INBOUND", label: "Incoming" }, { value: "OUTBOUND", label: "Outgoing" }]} />
            <FilterSelect label="Sender" value={source} onChange={reset(setSource)} allLabel="Any sender" options={[{ value: "CUSTOMER", label: "Customer" }, { value: "AI", label: "AI" }, { value: "HUMAN", label: "Staff" }]} />
            <FilterSelect label="Status" value={status} onChange={reset(setStatus)} allLabel="Any status" options={STATUS_OPTIONS} />
          </div>
          {isPending ? (
            <Skeleton className="h-80 w-full" />
          ) : isError ? (
            <ErrorState message={error.message} onRetry={() => refetch()} />
          ) : data.items.length === 0 ? (
            <EmptyState icon={MessagesSquare} title="No messages" description="Nothing matches these filters." />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap">{formatDateTime(m.occurredAt)}</TableCell>
                        <TableCell className="max-w-40 truncate">
                          {can("conversations:read") ? (
                            <Link className="underline-offset-4 hover:underline" href={`/inbox?c=${m.conversation.id}`}>
                              {customerLabel(m.conversation)}
                            </Link>
                          ) : (
                            customerLabel(m.conversation)
                          )}
                        </TableCell>
                        <TableCell>{sender(m)}</TableCell>
                        <TableCell className="max-w-96 truncate" title={m.body ?? undefined}>
                          {m.type !== "TEXT" && <span className="text-muted-foreground">[{m.type.toLowerCase()}] </span>}
                          {m.body}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(m.status)} title={m.errorMessage ?? undefined}>
                            {m.status.toLowerCase()}
                            {m.errorCode && ` · ${m.errorCode}`}
                          </Badge>
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
    </>
  );
}
