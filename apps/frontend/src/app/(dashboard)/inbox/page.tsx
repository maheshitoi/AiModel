"use client";

import { MessageCircle } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { EmptyState } from "@/components/common/states";
import { ConversationList } from "@/components/inbox/conversation-list";
import { ConversationThread } from "@/components/inbox/conversation-thread";
import { Skeleton } from "@/components/ui/skeleton";
import { useInboxSocket, type LiveState } from "@/hooks/use-inbox-socket";
import { cn } from "@/lib/utils";
import type { InboxFilter } from "@/types/api";

const LIVE_LABEL: Record<LiveState, { text: string; dot: string }> = {
  live: { text: "Live", dot: "bg-emerald-500" },
  connecting: { text: "Connecting…", dot: "bg-amber-500" },
  offline: { text: "Reconnecting…", dot: "bg-amber-500" },
};

export default function InboxPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[calc(100dvh-7.5rem)] w-full" />}>
      <Inbox />
    </Suspense>
  );
}

function Inbox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get("c");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [search, setSearch] = useState("");
  const live = useInboxSocket();

  // The open conversation lives in the URL (?c=) so it survives reloads and can be linked.
  const select = useCallback((id: string | null) => router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false }), [router, pathname]);

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] flex-col sm:-m-6">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-lg font-semibold">Inbox</h1>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <span className={cn("size-2 rounded-full", LIVE_LABEL[live].dot)} aria-hidden />
          {LIVE_LABEL[live].text}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(16rem,22rem)_1fr]">
        <div className={cn("min-h-0 border-r", selected && "hidden md:block")}>
          <ConversationList filter={filter} onFilterChange={setFilter} search={search} onSearchChange={setSearch} selectedId={selected} onSelect={select} />
        </div>
        <div className={cn("min-h-0", !selected && "hidden md:block")}>
          {selected ? (
            <ConversationThread key={selected} id={selected} onBack={() => select(null)} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon={MessageCircle} title="Select a conversation" description="Customer messages and AI suggestions appear here live." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
