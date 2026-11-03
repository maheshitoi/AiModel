"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, refreshAccessToken, session } from "@/services/api";
import type { AuthUser, LoginResponse } from "@/types/api";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated"; user: null };

interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  const signedOut = useCallback(() => {
    session.setAccessToken(null);
    queryClient.clear();
    setState({ status: "unauthenticated", user: null });
  }, [queryClient]);

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    refreshAccessToken()
      .then((token) => (token ? api.get<AuthUser>("/auth/me") : null))
      .then((user) => {
        if (cancelled) return;
        setState(user ? { status: "authenticated", user } : { status: "unauthenticated", user: null });
      })
      .catch(() => !cancelled && setState({ status: "unauthenticated", user: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  // A failed refresh in the middle of using the app ends the session.
  useEffect(() => {
    session.onExpired(() => {
      signedOut();
      toast.error("Your session has expired. Please sign in again.");
    });
    return () => session.onExpired(null);
  }, [signedOut]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<LoginResponse>("/auth/login", { email, password });
    session.setAccessToken(result.accessToken);
    setState({ status: "authenticated", user: result.user });
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    signedOut();
  }, [signedOut]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      login,
      logout,
      can: (permission) => !!state.user && (state.user.permissions.includes("*") || state.user.permissions.includes(permission)),
    }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
