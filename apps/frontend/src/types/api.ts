// Shapes returned by the NestJS API (see apps/backend). Keep in sync with the backend DTOs.

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  current: boolean;
}

export type ConversationStatus = "OPEN" | "HUMAN" | "CLOSED";

export interface DashboardOverview {
  totals: {
    incoming: number;
    outgoing: number;
    conversations: number;
    activeConversations: number;
    aiReplies: number;
    failedMessages: number;
    aiSuccessRate: number | null;
    avgResponseTimeMs: number | null;
  };
  recentConversations: {
    id: string;
    customerWaId: string;
    customerName: string | null;
    lastMessagePreview: string | null;
    lastMessageAt: string | null;
    status: ConversationStatus;
    aiEnabled: boolean;
    unreadCount: number;
  }[];
  recentErrors: { id: string; category: string; event: string; message: string; createdAt: string }[];
  activeModel: {
    name: string;
    version: number;
    status: string;
    parameterCount: number;
    contextLength: number;
    activatedAt: string | null;
  } | null;
}

export type ChartRange = "daily" | "weekly" | "monthly";

export interface MessageChartPoint {
  bucket: string;
  inbound: number;
  outbound: number;
  ai: number;
}
