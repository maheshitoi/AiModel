"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { ChartRange, DashboardOverview, MessageChartPoint, SessionInfo } from "@/types/api";
import type { HealthReport } from "@/types/health";

export const queryKeys = {
  health: ["health"] as const,
  overview: ["dashboard", "overview"] as const,
  messagesChart: (range: ChartRange) => ["dashboard", "messages-chart", range] as const,
  sessions: ["auth", "sessions"] as const,
};

export const useHealth = () =>
  useQuery({ queryKey: queryKeys.health, queryFn: () => api.get<HealthReport>("/health"), refetchInterval: 15_000 });

export const useDashboardOverview = () =>
  useQuery({
    queryKey: queryKeys.overview,
    queryFn: () => api.get<DashboardOverview>("/dashboard/overview"),
    refetchInterval: 30_000,
  });

export const useMessagesChart = (range: ChartRange) =>
  useQuery({
    queryKey: queryKeys.messagesChart(range),
    queryFn: () => api.get<MessageChartPoint[]>("/dashboard/messages-chart", { query: { range } }),
  });

export const useSessions = () =>
  useQuery({ queryKey: queryKeys.sessions, queryFn: () => api.get<SessionInfo[]>("/auth/sessions") });
