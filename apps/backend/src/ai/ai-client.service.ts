import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Wire types of the FastAPI service (apps/ai-service/app/schemas.py), kept in its snake_case.
export interface AiModelInfo {
  name: string;
  checkpoint: string;
  parameters: number;
  context_length: number;
  vocab_size: number;
  step: number | null;
  best_val_loss: number | null;
  facts_source: 'run' | 'default';
  business_name: string;
  loaded_at: string;
}

export interface AiChatMessage {
  role: 'customer' | 'assistant';
  text: string;
}

export interface AiGenerateRequest {
  request_id?: string;
  messages: AiChatMessage[];
  options?: {
    max_new_tokens?: number;
    temperature?: number;
    top_k?: number;
    top_p?: number;
    min_confidence?: number;
    fallback_reply?: string;
  };
}

export type AiAction = 'reply' | 'fallback' | 'handoff';

export interface AiGenerateResponse {
  request_id: string | null;
  action: AiAction;
  text: string;
  reason: string;
  detail: string | null;
  handoff_required: boolean;
  confidence: number | null;
  model_text: string | null;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  model: AiModelInfo | null;
}

export interface AiCurrentModel {
  loaded: boolean;
  model: AiModelInfo | null;
  last_load_error: string | null;
}

export interface AiCheckpointFile {
  checkpoint: string;
  size_bytes: number;
  modified_at: string;
}

export interface AiDatasetReport {
  records: number;
  valid_records: number;
  issue_count: number;
  issues: { record: number; message: string }[];
  dropped_after_cleaning: number;
  duplicates: number;
  unique: number;
  train: number;
  validation: number;
  turns: number;
  intents: Record<string, number>;
  size_bytes: number;
  sha256: string;
}

export interface AiDatasetPreview {
  total: number;
  items: { messages: AiChatMessage[]; intent?: string; source: string }[];
}

export interface AiTrainingPreset {
  name: string;
  description: string | null;
  model: Record<string, number | boolean>;
  training: Record<string, number | string> & { max_steps: number; device: string };
  dataset: Record<string, number | string | boolean> & { synthetic_conversations: number };
  tokenizer: { vocab_size: number };
}

/** One line of the run's metrics.jsonl: a training log line or a validation run. */
export interface AiTrainingEvent {
  type: 'train' | 'eval';
  time: string;
  step: number;
  epoch?: number;
  train_loss: number;
  val_loss?: number;
  lr?: number;
  tokens_per_sec?: number;
  cpu_percent?: number;
  rss_mb?: number;
  gpu_memory_mb?: number;
}

export type AiJobState = 'starting' | 'preparing' | 'running' | 'stopping' | 'completed' | 'early_stopped' | 'stopped' | 'interrupted' | 'failed';

export interface AiTrainingJob {
  job_id: string;
  run_name: string;
  state: AiJobState;
  step: number;
  max_steps: number | null;
  best_val_loss: number | null;
  best_step: number | null;
  error: string | null;
  parameters: number | null;
  vocab_size: number | null;
  context_length: number | null;
  device: string | null;
  dataset: { train: number; validation: number; unique: number; duplicates_removed: number } | null;
  started_at: string | null;
  updated_at: string | null;
  duration_s: number | null;
  best_checkpoint: string | null;
  events: AiTrainingEvent[];
}

export interface AiEvaluationReport {
  step: number | null;
  parameters: number;
  validation: { loss: number; perplexity: number; assistant_tokens: number; uniform_baseline_loss: number };
  groups: Record<string, { passed: number; total: number; rate: number }>;
  overall_pass_rate: number;
  well_formed_rate: number;
  verbatim_rate: number;
  cases: { group: string; prompt: AiChatMessage[]; reply: string; expected_any: string[]; passed: boolean; verbatim_from_training: boolean; notes: string[] }[];
}

export interface AiEvaluation {
  checkpoint: string;
  state: 'none' | 'running' | 'completed' | 'failed';
  report: AiEvaluationReport | null;
  error: string | null;
}

export type AiErrorKind = 'unreachable' | 'timeout' | 'no_model' | 'busy' | 'misconfigured' | 'rejected' | 'not_found' | 'conflict' | 'bad_response';

/** Messages are fixed strings: never the request body, which may contain customer text. */
export class AiServiceError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiServiceError';
  }
}

/** A request body sent as raw bytes instead of JSON. */
class RawBody {
  constructor(readonly content: Buffer) {}
}

const LOAD_TIMEOUT_MS = 120_000;
// Dataset uploads and validation read the whole file; give them longer than a reply.
const DATASET_TIMEOUT_MS = 60_000;
const MAX_RETRY_AFTER_S = 5;

@Injectable()
export class AiClientService {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('AI_SERVICE_URL').replace(/\/+$/, '');
    this.token = config.getOrThrow<string>('AI_SERVICE_TOKEN');
    this.timeoutMs = Number(config.get('AI_REQUEST_TIMEOUT_MS') ?? 15_000);
  }

  /** Retries once if the model is busy (the service runs one generation at a time). */
  generate(body: AiGenerateRequest): Promise<AiGenerateResponse> {
    return this.request('POST', '/v1/generate', body, { retryWhenBusy: true });
  }

  currentModel(): Promise<AiCurrentModel> {
    return this.request('GET', '/v1/models/current');
  }

  checkpoints(): Promise<AiCheckpointFile[]> {
    return this.request('GET', '/v1/models/checkpoints');
  }

  loadModel(checkpoint: string): Promise<AiModelInfo> {
    return this.request('POST', '/v1/models/load', { checkpoint }, { timeoutMs: LOAD_TIMEOUT_MS });
  }

  // ── datasets (files are stored by the AI service, named by our TrainingDataset id) ──
  uploadDataset(id: string, format: 'json' | 'jsonl' | 'txt', content: Buffer): Promise<AiDatasetReport> {
    return this.request('PUT', `/v1/datasets/${id}?format=${format}`, new RawBody(content), { timeoutMs: DATASET_TIMEOUT_MS });
  }

  validateDataset(id: string): Promise<AiDatasetReport> {
    return this.request('POST', `/v1/datasets/${id}/validate`, undefined, { timeoutMs: DATASET_TIMEOUT_MS });
  }

  previewDataset(id: string, offset: number, limit: number): Promise<AiDatasetPreview> {
    return this.request('GET', `/v1/datasets/${id}/preview?offset=${offset}&limit=${limit}`, undefined, { timeoutMs: DATASET_TIMEOUT_MS });
  }

  deleteDataset(id: string): Promise<void> {
    return this.request('DELETE', `/v1/datasets/${id}`);
  }

  // ── training and evaluation (run as separate processes in the AI service) ──
  trainingPresets(): Promise<AiTrainingPreset[]> {
    return this.request('GET', '/v1/training/presets');
  }

  startTraining(body: { job_id: string; preset: string; max_steps?: number; include_synthetic: boolean; dataset_ids: string[] }): Promise<AiTrainingJob> {
    return this.request('POST', '/v1/training/jobs', body);
  }

  trainingJob(jobId: string, sinceStep = 0): Promise<AiTrainingJob> {
    return this.request('GET', `/v1/training/jobs/${jobId}?since_step=${sinceStep}`);
  }

  stopTraining(jobId: string): Promise<AiTrainingJob> {
    return this.request('POST', `/v1/training/jobs/${jobId}/stop`);
  }

  startEvaluation(checkpoint: string): Promise<AiEvaluation> {
    return this.request('POST', '/v1/evaluations', { checkpoint });
  }

  evaluation(checkpoint: string): Promise<AiEvaluation> {
    return this.request('GET', `/v1/evaluations?checkpoint=${encodeURIComponent(checkpoint)}`);
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    opts: { retryWhenBusy?: boolean; timeoutMs?: number } = {},
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            'X-Internal-Token': this.token,
            ...(body === undefined ? {} : { 'Content-Type': body instanceof RawBody ? 'application/octet-stream' : 'application/json' }),
          },
          body: body === undefined ? undefined : body instanceof RawBody ? new Uint8Array(body.content) : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if ((error as Error).name === 'TimeoutError') {
          throw new AiServiceError('timeout', `The AI service did not answer within ${timeoutMs} ms`);
        }
        throw new AiServiceError('unreachable', 'The AI service is unreachable');
      }

      if (res.status === 204) return undefined as T;
      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new AiServiceError('bad_response', 'The AI service returned an invalid response', res.status);
        }
      }
      const error = await this.toError(res);
      if (error.kind === 'busy' && opts.retryWhenBusy && attempt === 0) {
        const retryAfter = Math.min(Number(res.headers.get('retry-after')) || 1, MAX_RETRY_AFTER_S);
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        continue;
      }
      throw error;
    }
  }

  private async toError(res: Response): Promise<AiServiceError> {
    // FastAPI errors are { detail: string } or, for validation, { detail: [{ loc, msg, type }] }.
    const detail = await res
      .json()
      .then((b) => (b as { detail?: unknown }).detail)
      .catch(() => undefined);
    const text = typeof detail === 'string' ? detail : '';
    switch (res.status) {
      case 401:
        return new AiServiceError('misconfigured', 'The AI service rejected AI_SERVICE_TOKEN', 401);
      case 404:
        return new AiServiceError('not_found', text || 'Not found', 404);
      case 409:
        return new AiServiceError('conflict', text || 'The AI service is busy with another job', 409);
      case 413:
        return new AiServiceError('rejected', text || 'The file is too large', 413);
      case 503:
        if (text.startsWith('No model')) return new AiServiceError('no_model', 'No model is loaded in the AI service', 503);
        if (text.includes('busy')) return new AiServiceError('busy', 'The AI service is busy', 503);
        return new AiServiceError('misconfigured', 'AI_SERVICE_TOKEN is not configured in the AI service', 503);
      case 400:
      case 422: {
        // 400s carry the service's own fixed messages; 422 lists only the invalid field names.
        if (res.status === 400 && text) return new AiServiceError('rejected', text, 400);
        const fields = Array.isArray(detail) ? detail.map((d: { loc?: unknown[] }) => (d.loc ?? []).join('.')).join(', ') : text;
        return new AiServiceError('rejected', `The AI service rejected the request${fields ? `: ${fields}` : ''}`, res.status);
      }
      default:
        return new AiServiceError('bad_response', `The AI service answered HTTP ${res.status}`, res.status);
    }
  }
}
