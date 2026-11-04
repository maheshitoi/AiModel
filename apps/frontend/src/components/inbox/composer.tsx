"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/hooks/queries";
import { api } from "@/services/api";

/** Why a free-form reply can't be sent right now, or null if it can. */
export function replyBlocker(replyWindowEndsAt: string | null, accountDisabled: boolean, now = Date.now()): string | null {
  if (accountDisabled) return "This WhatsApp number is disabled.";
  if (!replyWindowEndsAt || new Date(replyWindowEndsAt).getTime() <= now) {
    return "The customer's last message was over 24 hours ago. WhatsApp only allows template messages now (not supported yet).";
  }
  return null;
}

export function Composer({ conversationId, blocker }: { conversationId: string; blocker: string | null }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: (body: string) => api.post(`/conversations/${conversationId}/messages`, { text: body }),
    onSuccess: () => {
      setText("");
      return queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
    },
    onError: (e) => toast.error(e.message),
  });
  const submit = () => {
    if (text.trim() && !send.isPending) send.mutate(text.trim());
  };

  if (blocker) return <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">{blocker}</p>;

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={2}
        maxLength={4096}
        placeholder="Write a reply… (Enter to send, Shift+Enter for a new line)"
        aria-label="Reply"
        className="min-h-10 resize-none"
      />
      <Button type="submit" size="icon" disabled={!text.trim() || send.isPending} aria-label="Send reply">
        {send.isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Send aria-hidden />}
      </Button>
    </form>
  );
}
