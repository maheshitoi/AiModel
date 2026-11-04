"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { queryKeys } from "@/hooks/queries";
import { API_URL, refreshAccessToken, session } from "@/services/api";

export type LiveState = "connecting" | "live" | "offline";

interface InboxEvent {
  type: "conversation.changed" | "message.changed" | "decision.changed";
  conversationId: string;
}

/**
 * Keeps the inbox queries fresh. The server sends ids only, so this just invalidates the matching
 * queries and lets TanStack Query refetch through the authorised REST API.
 * The server closes the socket when the access token expires; reconnecting fetches a fresh one.
 */
export function useInboxSocket(): LiveState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>("connecting");

  useEffect(() => {
    const socket = io(new URL(API_URL).origin, {
      transports: ["websocket"],
      // Called before every (re)connection attempt, so an expired token is refreshed first.
      auth: (cb) => {
        void refreshIfNeeded().then((token) => cb({ token }));
      },
      reconnectionDelayMax: 10_000,
    });

    socket.on("connect", () => setState("live"));
    socket.on("disconnect", (reason) => {
      setState("offline");
      // "io server disconnect" = the server closed it (token expired): reconnect explicitly.
      if (reason === "io server disconnect") socket.connect();
    });
    socket.on("connect_error", () => setState("offline"));
    socket.on("inbox", (event: InboxEvent) => {
      void queryClient.invalidateQueries({ queryKey: ["inbox", "conversations"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversation(event.conversationId) });
      if (event.type !== "conversation.changed") void queryClient.invalidateQueries({ queryKey: queryKeys.messages(event.conversationId) });
    });
    // Anything missed while offline is picked up on reconnect.
    socket.io.on("reconnect", () => void queryClient.invalidateQueries({ queryKey: queryKeys.inbox }));

    return () => {
      socket.close();
    };
  }, [queryClient]);

  return state;
}

async function refreshIfNeeded(): Promise<string | null> {
  const token = session.getAccessToken();
  if (token && !isExpired(token)) return token;
  return refreshAccessToken();
}

function isExpired(jwt: string): boolean {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return !payload.exp || payload.exp * 1000 < Date.now() + 5_000;
  } catch {
    return true;
  }
}
