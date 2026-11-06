"use client";

import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries";
import { useRealtime, type LiveState } from "@/hooks/use-realtime";

export type { LiveState };

interface InboxEvent {
  type: "conversation.changed" | "message.changed" | "decision.changed";
  conversationId: string;
}

/** Keeps the inbox queries fresh. */
export function useInboxSocket(): LiveState {
  const queryClient = useQueryClient();
  return useRealtime<InboxEvent>(
    "inbox",
    (event) => {
      void queryClient.invalidateQueries({ queryKey: ["inbox", "conversations"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(event.conversationId) });
      if (event.type !== "conversation.changed") void queryClient.invalidateQueries({ queryKey: queryKeys.messages(event.conversationId) });
    },
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.inbox }),
  );
}

/** Keeps the training and model pages fresh while a job runs. */
export function useTrainingSocket(): LiveState {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.training });
    void queryClient.invalidateQueries({ queryKey: queryKeys.models });
  };
  return useRealtime<{ type: "job.changed"; jobId: string }>("training", refresh, refresh);
}
