"use client";

import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type {
  AiCheckpoint,
  AiModelRow,
  DatasetPreview,
  DatasetRow,
  Evaluation,
  TrainingJob,
  TrainingMetricPoint,
  TrainingPreset,
  AiGenerationSettings,
  AiStatus,
  ChartRange,
  AuditLogEntry,
  ConversationDetail,
  ConversationSummary,
  InboxFilter,
  InboxMessage,
  DashboardOverview,
  MessageChartPoint,
  MessageRow,
  Role,
  SecuritySettings,
  SessionInfo,
  SystemLogEntry,
  UsageReport,
  UserRow,
  UserSession,
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
  usage: (days: number) => ["usage", days] as const,
  messageSearch: (q: object) => ["messages", q] as const,
  systemLogs: (q: object) => ["logs", "system", q] as const,
  auditLogs: (q: object) => ["logs", "audit", q] as const,
  users: (q: object) => ["users", q] as const,
  roles: ["roles"] as const,
  userSessions: (id: string) => ["users", id, "sessions"] as const,
  securitySettings: ["settings", "security"] as const,
  // Everything under "training" and "models" is refetched when the training socket reports a change.
  datasets: (q: object) => ["datasets", q] as const,
  datasetPreview: (id: string, offset: number) => ["datasets", id, "preview", offset] as const,
  training: ["training"] as const,
  trainingPresets: ["training", "presets"] as const,
  trainingJobs: (q: object) => ["training", "jobs", q] as const,
  currentJob: ["training", "current"] as const,
  jobMetrics: (id: string) => ["training", "metrics", id] as const,
  models: ["models"] as const,
  evaluation: (versionId: string) => ["models", "evaluation", versionId] as const,
};

type Query = Record<string, string | number | boolean | undefined>;

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

export const useUsage = (days: number) =>
  useQuery({ queryKey: queryKeys.usage(days), queryFn: () => api.get<UsageReport>("/usage", { query: { days } }), placeholderData: keepPreviousData });

export const useMessageSearch = (q: Query) =>
  useQuery({ queryKey: queryKeys.messageSearch(q), queryFn: () => api.page<MessageRow>("/messages", { query: q }), placeholderData: keepPreviousData });

export const useSystemLogs = (q: Query, enabled = true) =>
  useQuery({ queryKey: queryKeys.systemLogs(q), queryFn: () => api.page<SystemLogEntry>("/logs", { query: q }), placeholderData: keepPreviousData, enabled });

export const useAuditLogs = (q: Query, enabled = true) =>
  useQuery({ queryKey: queryKeys.auditLogs(q), queryFn: () => api.page<AuditLogEntry>("/logs/audit", { query: q }), placeholderData: keepPreviousData, enabled });

export const useUsers = (q: Query) =>
  useQuery({ queryKey: queryKeys.users(q), queryFn: () => api.page<UserRow>("/users", { query: q }), placeholderData: keepPreviousData });

export const useRoles = () => useQuery({ queryKey: queryKeys.roles, queryFn: () => api.get<Role[]>("/roles") });

export const useUserSessions = (id: string | null) =>
  useQuery({ queryKey: queryKeys.userSessions(id ?? ""), queryFn: () => api.get<UserSession[]>(`/users/${id}/sessions`), enabled: !!id });

export const useSecuritySettings = () =>
  useQuery({ queryKey: queryKeys.securitySettings, queryFn: () => api.get<SecuritySettings>("/settings/security") });

export const useDatasets = (q: Query) =>
  useQuery({ queryKey: queryKeys.datasets(q), queryFn: () => api.page<DatasetRow>("/datasets", { query: q }), placeholderData: keepPreviousData });

export const useDatasetPreview = (id: string | null, offset: number, limit = 10) =>
  useQuery({
    queryKey: queryKeys.datasetPreview(id ?? "", offset),
    queryFn: () => api.get<DatasetPreview>(`/datasets/${id}/preview`, { query: { offset, limit } }),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });

export const useTrainingPresets = (enabled = true) =>
  useQuery({ queryKey: queryKeys.trainingPresets, queryFn: () => api.get<TrainingPreset[]>("/training/presets"), enabled, staleTime: 60_000 });

export const useTrainingJobs = (q: Query) =>
  useQuery({ queryKey: queryKeys.trainingJobs(q), queryFn: () => api.page<TrainingJob>("/training/jobs", { query: q }), placeholderData: keepPreviousData });

// Polling is a fallback: the training socket invalidates these as soon as anything changes.
export const useCurrentJob = () =>
  useQuery({ queryKey: queryKeys.currentJob, queryFn: () => api.get<TrainingJob | null>("/training/jobs/current"), refetchInterval: 15_000 });

export const useJobMetrics = (id: string | null) =>
  useQuery({ queryKey: queryKeys.jobMetrics(id ?? ""), queryFn: () => api.get<TrainingMetricPoint[]>(`/training/jobs/${id}/metrics`), enabled: !!id });

export const useModels = () => useQuery({ queryKey: queryKeys.models, queryFn: () => api.get<AiModelRow[]>("/models") });

export const useEvaluation = (versionId: string | null) =>
  useQuery({
    queryKey: queryKeys.evaluation(versionId ?? ""),
    queryFn: () => api.get<Evaluation>(`/models/versions/${versionId}/evaluation`),
    enabled: !!versionId,
    refetchInterval: (q) => (q.state.data?.state === "running" ? 3000 : false),
  });
