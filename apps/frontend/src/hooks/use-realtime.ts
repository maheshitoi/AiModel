"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { API_URL, refreshAccessToken, session } from "@/services/api";

export type LiveState = "connecting" | "live" | "offline";

/**
 * One Socket.IO connection that listens for `event`. The server sends ids only, so handlers just
 * invalidate queries and let TanStack Query refetch through the authorised REST API. The server
 * closes the socket when the access token expires; reconnecting fetches a fresh one, and
 * `onReconnect` catches up on anything missed while offline.
 */
export function useRealtime<E>(event: string, onEvent: (e: E) => void, onReconnect: () => void): LiveState {
  const [state, setState] = useState<LiveState>("connecting");
  const handlers = useRef({ onEvent, onReconnect });
  useEffect(() => {
    handlers.current = { onEvent, onReconnect };
  });

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
    socket.on(event, (e: E) => handlers.current.onEvent(e));
    socket.io.on("reconnect", () => handlers.current.onReconnect());

    return () => {
      socket.close();
    };
  }, [event]);

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
