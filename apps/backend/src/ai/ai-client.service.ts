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

export type AiErrorKind = 'unreachable' | 'timeout' | 'no_model' | 'busy' | 'misconfigured' | 'rejected' | 'not_found' | 'bad_response';

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

const LOAD_TIMEOUT_MS = 120_000;
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

  private async request<T>(
    method: 'GET' | 'POST',
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
          headers: { 'X-Internal-Token': this.token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if ((error as Error).name === 'TimeoutError') {
          throw new AiServiceError('timeout', `The AI service did not answer within ${timeoutMs} ms`);
        }
        throw new AiServiceError('unreachable', 'The AI service is unreachable');
      }

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
        return new AiServiceError('not_found', 'Checkpoint not found', 404);
      case 503:
        if (text.startsWith('No model')) return new AiServiceError('no_model', 'No model is loaded in the AI service', 503);
        if (text.includes('busy')) return new AiServiceError('busy', 'The AI service is busy', 503);
        return new AiServiceError('misconfigured', 'AI_SERVICE_TOKEN is not configured in the AI service', 503);
      case 400:
      case 422: {
        const fields = Array.isArray(detail) ? detail.map((d: { loc?: unknown[] }) => (d.loc ?? []).join('.')).join(', ') : text;
        return new AiServiceError('rejected', `The AI service rejected the request${fields ? `: ${fields}` : ''}`, res.status);
      }
      default:
        return new AiServiceError('bad_response', `The AI service answered HTTP ${res.status}`, res.status);
    }
  }
}
