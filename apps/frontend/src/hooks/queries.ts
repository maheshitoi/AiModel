"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  AiCheckpoint,
  AiGenerationSettings,
  AiStatus,
  ChartRange,
  ConversationDetail,
  ConversationSummary,
  InboxFilter,
  InboxMessage,
  DashboardOverview,
  MessageChartPoint,
  SessionInfo,
  WhatsAppAccount,
} from "@/types/api";
import type { HealthReport } from "@/types/health";

export const queryKeys = {
  health: ["health"] as const,
  overview: ["dashboard", "overview"] as const,
  messagesChart: (range: ChartRange) => ["dashboard", "messages-chart", range] as const,
  sessions: ["auth", "sessions"] as const,
  aiStatus: ["ai", "status"] as const,
  aiCheckpoints: ["ai", "checkpoints"] as const,
  aiSettings: ["settings", "ai.generation"] as const,
  whatsappAccounts: ["whatsapp", "accounts"] as const,
  // Everything under "inbox" is refetched when the live socket reports a change.
  inbox: ["inbox"] as const,
  conversations: (filter: InboxFilter, search: string) => ["inbox", "conversations", filter, search] as const,
  conversation: (id: string) => ["inbox", "conversation", id] as const,
  messages: (id: string) => ["inbox", "messages", id] as const,
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

export const useAiStatus = () =>
  useQuery({ queryKey: queryKeys.aiStatus, queryFn: () => api.get<AiStatus>("/ai/status"), refetchInterval: 30_000 });

export const useAiCheckpoints = (enabled: boolean) =>
  useQuery({ queryKey: queryKeys.aiCheckpoints, queryFn: () => api.get<AiCheckpoint[]>("/ai/checkpoints"), enabled });

export const useAiSettings = () =>
  useQuery({ queryKey: queryKeys.aiSettings, queryFn: () => api.get<AiGenerationSettings>("/settings/ai.generation") });

export const useWhatsAppAccounts = () =>
  useQuery({ queryKey: queryKeys.whatsappAccounts, queryFn: () => api.get<WhatsAppAccount[]>("/whatsapp/accounts") });

export const useConversations = (filter: InboxFilter, search: string) =>
  useQuery({
    queryKey: queryKeys.conversations(filter, search),
    queryFn: () => api.page<ConversationSummary>("/conversations", { query: { filter, search, pageSize: 100 } }),
    placeholderData: keepPreviousData,
  });

export const useConversation = (id: string | null) =>
  useQuery({ queryKey: queryKeys.conversation(id ?? ""), queryFn: () => api.get<ConversationDetail>(`/conversations/${id}`), enabled: !!id });

/** Newest page first; each further page is older. */
export const useMessages = (id: string | null) =>
  useInfiniteQuery({
    queryKey: queryKeys.messages(id ?? ""),
    queryFn: ({ pageParam }) =>
      api.get<{ items: InboxMessage[]; hasMore: boolean }>(`/conversations/${id}/messages`, { query: { limit: 50, before: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.items.at(-1)?.occurredAt : undefined),
    enabled: !!id,
  });
