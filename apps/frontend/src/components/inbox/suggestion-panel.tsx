"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Pencil, Send, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/hooks/queries";
import { api } from "@/services/api";
import type { AiDecision } from "@/types/api";
import { reasonLabel } from "./labels";

const HEADLINE: Record<AiDecision["action"], string> = {
  REPLY: "AI suggested reply",
  FALLBACK: "AI wasn't sure. Suggested holding reply",
  HANDOFF: "Fixed reply for a message the AI must not answer",
};

/** Staff approve, edit or dismiss what the AI proposed. Nothing reaches the customer until they do. */
export function SuggestionPanel({ decision, canReply }: { decision: AiDecision; canReply: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(decision.text);
  const done = () => queryClient.invalidateQueries({ queryKey: queryKeys.inbox });

  const approve = useMutation({
    mutationFn: (edited?: string) => api.post(`/ai/decisions/${decision.id}/approve`, edited === undefined ? {} : { text: edited }),
    onSuccess: () => {
      toast.success("Reply queued");
      setEditing(false);
      return done();
    },
    onError: (e) => toast.error(e.message),
  });
  const dismiss = useMutation({
    mutationFn: () => api.post(`/ai/decisions/${decision.id}/dismiss`),
    onSuccess: done,
    onError: (e) => toast.error(e.message),
  });
  const busy = approve.isPending || dismiss.isPending;

  return (
    <section aria-label="AI suggestion" className="space-y-2 rounded-lg border border-dashed bg-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="size-3.5" aria-hidden />
        <span className="font-medium text-foreground">{HEADLINE[decision.action]}</span>
        {decision.action !== "REPLY" && <Badge variant="outline">{reasonLabel(decision.reason)}</Badge>}
        {decision.confidence !== null && <span>confidence {decision.confidence.toFixed(2)}</span>}
      </div>
      {editing ? (
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4096} aria-label="Edit suggested reply" autoFocus />
      ) : (
        <p className="text-sm whitespace-pre-wrap">{decision.text}</p>
      )}
      {decision.action === "FALLBACK" && decision.modelText && (
        <p className="text-xs text-muted-foreground">
          The model wrote (rejected): <span className="italic">{decision.modelText}</span>
        </p>
      )}
      {canReply && (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" disabled={busy || !text.trim()} onClick={() => approve.mutate(text)}>
                {approve.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                Send edited reply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setText(decision.text))}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" disabled={busy} onClick={() => approve.mutate(undefined)}>
                {approve.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                Send
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                Edit
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()}>
                <X aria-hidden />
                Dismiss
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
