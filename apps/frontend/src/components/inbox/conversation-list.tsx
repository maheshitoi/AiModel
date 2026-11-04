"use client";

import { CircleAlert, MessageCircle, Search, Sparkles } from "lucide-react";
import { useDeferredValue } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useConversations } from "@/hooks/queries";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { InboxFilter } from "@/types/api";
import { customerLabel, isUrgent, reasonLabel } from "./labels";

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "attention", label: "Attention" },
  { value: "human", label: "Staff" },
  { value: "closed", label: "Closed" },
];

interface Props {
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  search: string;
  onSearchChange: (s: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationList({ filter, onFilterChange, search, onSearchChange, selectedId, onSelect }: Props) {
  // The input updates immediately; the query follows without blocking typing.
  const query = useDeferredValue(search.trim());
  const { data, isPending, isError, error, refetch } = useConversations(filter, query);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="Search name or number" className="pl-8" aria-label="Search conversations" />
        </div>
        <Tabs value={filter} onValueChange={(v) => onFilterChange(v as InboxFilter)}>
          <TabsList className="w-full">
            {FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value} className="flex-1">
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState message={error.message} onRetry={() => refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState icon={MessageCircle} title="No conversations" description={search ? "Nothing matches your search." : "Customer messages appear here as they arrive."} />
        ) : (
          <ul aria-label="Conversations">
            {data.items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={c.id === selectedId ? "true" : undefined}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
                    c.id === selectedId && "bg-muted",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-sm", c.unreadCount > 0 ? "font-semibold" : "font-medium")}>{customerLabel(c)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(c.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.lastMessagePreview ?? "No messages"}</span>
                    {c.unreadCount > 0 && (
                      <Badge className="h-5 min-w-5 px-1.5" aria-label={`${c.unreadCount} unread`}>
                        {c.unreadCount}
                      </Badge>
                    )}
                  </div>
                  {(c.needsAttention || c.pendingSuggestions > 0 || c.status === "HUMAN") && (
                    <div className="flex flex-wrap gap-1">
                      {c.needsAttention && (
                        <Badge variant={isUrgent(c.attentionReason) ? "destructive" : "outline"}>
                          <CircleAlert aria-hidden />
                          {reasonLabel(c.attentionReason)}
                        </Badge>
                      )}
                      {c.pendingSuggestions > 0 && (
                        <Badge variant="secondary">
                          <Sparkles aria-hidden />
                          Suggestion ready
                        </Badge>
                      )}
                      {c.status === "HUMAN" && <Badge variant="outline">Staff handling</Badge>}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
