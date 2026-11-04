"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CircleAlert, CircleCheck, EllipsisVertical, UserRound } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/common/states";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys, useConversation, useMessages } from "@/hooks/queries";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/services/api";
import type { ConversationDetail, ConversationStatus } from "@/types/api";
import { Composer, replyBlocker } from "./composer";
import { customerLabel, isUrgent, reasonLabel } from "./labels";
import { MessageBubble } from "./message-bubble";
import { SuggestionPanel } from "./suggestion-panel";

const STATUS_BADGE: Record<ConversationStatus, { label: string; icon: typeof Bot }> = {
  OPEN: { label: "AI answering", icon: Bot },
  HUMAN: { label: "Staff handling", icon: UserRound },
  CLOSED: { label: "Closed", icon: CircleCheck },
};

export function ConversationThread({ id, onBack }: { id: string; onBack: () => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const conversation = useConversation(id);
  const messages = useMessages(id);
  const scroller = useRef<HTMLDivElement>(null);
  const c = conversation.data;

  const update = useMutation({
    mutationFn: (patch: Partial<{ status: ConversationStatus; needsAttention: false }>) => api.patch<ConversationDetail>(`/conversations/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.inbox }),
    onError: (e) => toast.error(e.message),
  });
  const retry = useMutation({
    mutationFn: (messageId: string) => api.post(`/conversations/${id}/messages/${messageId}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.messages(id) }),
    onError: (e) => toast.error(e.message),
  });
  const markRead = useMutation({
    mutationFn: () => api.post(`/conversations/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["inbox", "conversations"] }),
  });

  const unread = c?.unreadCount ?? 0;
  const { mutate: markAsRead } = markRead;
  useEffect(() => {
    if (unread > 0) markAsRead();
  }, [unread, markAsRead]);

  // Oldest first for display; pages arrive newest first.
  const ordered = useMemo(() => (messages.data?.pages ?? []).flatMap((p) => p.items).reverse(), [messages.data]);
  const newestId = ordered.at(-1)?.id;
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [newestId]);

  if (conversation.isPending) return <ThreadSkeleton />;
  if (conversation.isError || !c) return <ErrorState message={conversation.error?.message ?? "Not found"} onRetry={() => conversation.refetch()} />;

  const canManage = can("conversations:manage");
  const canReply = can("conversations:reply");
  const badge = STATUS_BADGE[c.status];
  const blocker = replyBlocker(c.replyWindowEndsAt, c.whatsAppAccount.status === "DISABLED");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b p-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{customerLabel(c)}</h2>
          <p className="truncate text-xs text-muted-foreground">
            +{c.customerWaId} · {c.whatsAppAccount.displayName}
          </p>
        </div>
        <Badge variant="outline" className="hidden sm:inline-flex">
          <badge.icon aria-hidden />
          {badge.label}
        </Badge>
        {canManage && (
          <>
            {c.status === "OPEN" && (
              <Button size="sm" variant="outline" onClick={() => update.mutate({ status: "HUMAN" })} disabled={update.isPending}>
                Take over
              </Button>
            )}
            {c.status === "HUMAN" && (
              <Button size="sm" variant="outline" onClick={() => update.mutate({ status: "OPEN" })} disabled={update.isPending}>
                Hand back to AI
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <EllipsisVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {c.status === "CLOSED" ? (
                  <DropdownMenuItem onSelect={() => update.mutate({ status: "OPEN" })}>Reopen</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => update.mutate({ status: "CLOSED" })}>Close conversation</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </header>

      {c.needsAttention && (
        <div className="border-b p-3">
          <Alert variant={isUrgent(c.attentionReason) ? "destructive" : "default"}>
            <CircleAlert aria-hidden />
            <AlertTitle>{reasonLabel(c.attentionReason)}</AlertTitle>
            <AlertDescription>
              {isUrgent(c.attentionReason)
                ? "The customer got the fixed safety reply. Contact them as soon as possible."
                : "The AI could not handle this on its own. Check the conversation."}
            </AlertDescription>
            {canManage && (
              <AlertAction>
                <Button size="sm" variant="outline" onClick={() => update.mutate({ needsAttention: false })} disabled={update.isPending}>
                  Mark handled
                </Button>
              </AlertAction>
            )}
          </Alert>
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-label="Messages">
        {messages.hasNextPage && (
          <div className="text-center">
            <Button variant="ghost" size="sm" onClick={() => messages.fetchNextPage()} disabled={messages.isFetchingNextPage}>
              Load earlier messages
            </Button>
          </div>
        )}
        {messages.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : messages.isError ? (
          <ErrorState message={messages.error.message} onRetry={() => messages.refetch()} />
        ) : (
          ordered.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onRetry={canReply && m.direction === "OUTBOUND" ? () => retry.mutate(m.id) : undefined}
              retrying={retry.isPending && retry.variables === m.id}
            />
          ))
        )}
      </div>

      <footer className="space-y-3 border-t p-3">
        {c.pendingDecision && <SuggestionPanel key={c.pendingDecision.id} decision={c.pendingDecision} canReply={canReply && c.status !== "CLOSED"} />}
        {canReply ? <Composer conversationId={id} blocker={blocker} /> : <p className="text-sm text-muted-foreground">You can read this conversation but not reply.</p>}
      </footer>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-busy="true">
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="ml-auto h-12 w-2/3" />
      <Skeleton className="h-12 w-1/2" />
    </div>
  );
}
