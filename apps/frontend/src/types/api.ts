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

// ── Analytics & logs (apps/backend/src/analytics, src/logs) ─────────────────
export interface UsageDay {
  day: string;
  requests: number;
  failures: number;
  avgLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageReport {
  days: number;
  since: string;
  timezone: string;
  ai: {
    requests: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    inputTokens: number;
    outputTokens: number;
    avgLatencyMs: number | null;
    p95LatencyMs: number | null;
    byModel: { version: number | null; checkpoint: string | null; requests: number }[];
  };
  decisions: {
    byAction: Partial<Record<"REPLY" | "FALLBACK" | "HANDOFF", number>>;
    byReason: { reason: string; count: number }[];
    outcomes: Partial<Record<"automatic" | "approved" | "edited" | "dismissed" | "pending", number>>;
  };
  messages: {
    inbound: number;
    outbound: number;
    outboundByStatus: Partial<Record<MessageStatus, number>>;
    failuresByCode: { code: string | null; count: number }[];
  };
  series: UsageDay[];
}

export interface MessageRow {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  source: InboxMessage["source"];
  body: string | null;
  status: MessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  occurredAt: string;
  sentBy: { name: string } | null;
  conversation: { id: string; customerName: string | null; customerWaId: string };
}

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type LogCategory = "BACKEND" | "WEBHOOK" | "AI" | "WHATSAPP" | "DATABASE" | "TRAINING" | "SECURITY";

export interface SystemLogEntry {
  id: string;
  level: LogLevel;
  category: LogCategory;
  event: string;
  message: string;
  context: Record<string, unknown> | null;
  conversationId: string | null;
  messageId: string | null;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actor: { email: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

// ── Users (apps/backend/src/users) ──────────────────────────────────────────
export interface Role {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  role: { id: string; name: string };
}

export interface UserSession {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface SecuritySettings {
  accessTokenTtlMinutes: number;
  refreshTokenTtlDays: number;
  maxFailedLogins: number;
}

// ── datasets, training, models (Phase 14) ────────────────────────────────────
export type DatasetStatus = "UPLOADED" | "VALIDATING" | "VALID" | "INVALID" | "APPROVED" | "ARCHIVED";

/** The validation report for one dataset: what training will actually see after cleaning. */
export interface DatasetStats {
  records: number;
  valid_records: number;
  dropped_after_cleaning: number;
  duplicates: number;
  unique: number;
  train: number;
  validation: number;
  turns: number;
  intents: Record<string, number>;
}

export interface DatasetRow {
  id: string;
  name: string;
  version: number;
  description: string | null;
  fileName: string;
  format: "JSON" | "JSONL" | "TXT";
  sizeBytes: number;
  recordCount: number;
  duplicateCount: number;
  validationErrors: { issueCount: number; issues: { record: number; message: string }[]; empty?: boolean } | null;
  stats: DatasetStats | null;
  status: DatasetStatus;
  isActive: boolean;
  containsCustomerData: boolean;
  approvedAt: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
  approvedBy: { id: string; name: string } | null;
  _count: { trainingJobs: number };
}

export interface ChatTurn {
  role: "customer" | "assistant";
  text: string;
}

export interface DatasetPreview {
  total: number;
  items: { messages: ChatTurn[]; intent?: string; source: string }[];
}

export interface TrainingPreset {
  name: string;
  description: string | null;
  model: Record<string, number | boolean>;
  training: { max_steps: number; batch_size: number; learning_rate: number; device: string };
  dataset: { synthetic_conversations: number };
  tokenizer: { vocab_size: number };
}

export type TrainingJobStatus = "QUEUED" | "RUNNING" | "STOPPING" | "STOPPED" | "COMPLETED" | "FAILED";
export type ModelVersionStatus = "TRAINING" | "READY" | "FAILED" | "ARCHIVED";

export interface TrainingJob {
  id: string;
  status: TrainingJobStatus;
  runName: string | null;
  device: string | null;
  config: { preset: string; maxSteps: number | null; includeSynthetic: boolean };
  currentStep: number;
  totalSteps: number;
  currentEpoch: number;
  bestValLoss: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  startedBy: { id: string; name: string } | null;
  modelVersion: { id: string; version: number; status: ModelVersionStatus; checkpointPath: string | null; isActive: boolean; parameterCount: number } | null;
  datasets: { id: string; name: string; version: number }[];
}

export interface TrainingMetricPoint {
  step: number;
  epoch: number;
  trainLoss: number;
  valLoss: number | null;
  learningRate: number;
  tokensPerSec: number | null;
  cpuPercent: number | null;
  memoryMb: number | null;
  createdAt: string;
}

export interface EvalSummary {
  step: number | null;
  parameters: number;
  validation: { loss: number; perplexity: number; assistant_tokens: number; uniform_baseline_loss: number };
  groups: Record<string, { passed: number; total: number; rate: number }>;
  overall_pass_rate: number;
  well_formed_rate: number;
  verbatim_rate: number;
  evaluatedAt?: string;
}

export interface EvalCase {
  group: string;
  prompt: ChatTurn[];
  reply: string;
  expected_any: string[];
  passed: boolean;
  verbatim_from_training: boolean;
  notes: string[];
}

export interface Evaluation {
  checkpoint: string;
  state: "none" | "running" | "completed" | "failed";
  report: (EvalSummary & { cases: EvalCase[] }) | null;
  error: string | null;
}

export interface ModelVersionRow {
  id: string;
  version: number;
  status: ModelVersionStatus;
  isActive: boolean;
  parameterCount: number;
  vocabSize: number;
  contextLength: number;
  checkpointPath: string | null;
  evalMetrics: EvalSummary | null;
  trainedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
  trainingJob: { id: string; status: TrainingJobStatus; runName: string | null; bestValLoss: number | null; currentStep: number; totalSteps: number; finishedAt: string | null } | null;
}

export interface AiModelRow {
  id: string;
  name: string;
  description: string | null;
  architecture: string;
  versions: ModelVersionRow[];
}
