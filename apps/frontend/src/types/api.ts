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

// ── AI (apps/backend/src/ai) ────────────────────────────────────────────────
export interface AiModelInfo {
  name: string;
  checkpoint: string;
  parameters: number;
  context_length: number;
  vocab_size: number;
  step: number | null;
  best_val_loss: number | null;
  facts_source: "run" | "default";
  business_name: string;
  loaded_at: string;
}

export interface AiStatus {
  reachable: boolean;
  error?: string;
  loaded: boolean;
  model: AiModelInfo | null;
  lastLoadError: string | null;
  activeVersion: { id: string; version: number; checkpointPath: string | null; activatedAt: string | null } | null;
  inSync: boolean;
}

export interface AiCheckpoint {
  checkpoint: string;
  size_bytes: number;
  modified_at: string;
}

export interface AiDecisionResult {
  action: "reply" | "fallback" | "handoff";
  text: string;
  reason: string;
  detail: string | null;
  handoff_required: boolean;
  confidence: number | null;
  model_text: string | null;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
}

// Mirrors AiGenerationSettingsDto (apps/backend/src/settings/settings.dto.ts).
export interface AiGenerationSettings {
  systemInstructions: string;
  maxNewTokens: number;
  temperature: number;
  topK: number;
  topP: number;
  maxContextTokens: number;
  fallbackReply: string;
  minConfidence: number;
  historyMessages: number;
  sendSafetyRepliesImmediately: boolean;
}

// ── WhatsApp (apps/backend/src/whatsapp) ────────────────────────────────────
export type WhatsAppAccountStatus = "PENDING" | "CONNECTED" | "ERROR" | "DISABLED";

/** Credentials are never sent to the browser; only the token's last 4 characters. */
export interface WhatsAppAccount {
  id: string;
  displayName: string;
  phoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessTokenLast4: string;
  status: WhatsAppAccountStatus;
  autoReplyEnabled: boolean;
  lastVerifiedAt: string | null;
  lastWebhookAt: string | null;
  createdAt: string;
}

// ── Inbox (apps/backend/src/conversations) ──────────────────────────────────
export type InboxFilter = "all" | "attention" | "open" | "human" | "closed";

export interface AiDecision {
  id: string;
  conversationId: string;
  inboundMessageId: string;
  action: "REPLY" | "FALLBACK" | "HANDOFF";
  reason: string;
  detail: string | null;
  text: string;
  modelText: string | null;
  confidence: number | null;
  handoffRequired: boolean;
  status: "SUGGESTED" | "QUEUED" | "DISMISSED";
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  whatsAppAccountId: string;
  customerWaId: string;
  customerName: string | null;
  status: ConversationStatus;
  aiEnabled: boolean;
  unreadCount: number;
  needsAttention: boolean;
  attentionReason: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastInboundAt: string | null;
  replyWindowEndsAt: string | null;
  pendingSuggestions: number;
  assignedTo: { id: string; name: string } | null;
}

export interface ConversationDetail extends ConversationSummary {
  createdAt: string;
  whatsAppAccount: { id: string; displayName: string; phoneNumber: string; autoReplyEnabled: boolean; status: WhatsAppAccountStatus };
  pendingDecision: AiDecision | null;
}

export type MessageStatus = "RECEIVED" | "QUEUED" | "SENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface InboxMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  source: "CUSTOMER" | "AI" | "HUMAN" | "SYSTEM";
  body: string | null;
  mediaCaption: string | null;
  mediaMimeType: string | null;
  status: MessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  occurredAt: string;
  sentBy: { id: string; name: string } | null;
  aiDecision: { id: string; action: AiDecision["action"]; reason: string; status: AiDecision["status"]; confidence: number | null } | null;
}
