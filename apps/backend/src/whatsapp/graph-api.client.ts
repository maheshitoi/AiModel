import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TIMEOUT_MS = 15_000;

// Graph API error codes worth retrying: throttling and temporary platform problems.
// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const RETRYABLE_CODES = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131056, 133004]);
const AUTH_CODES = new Set([190, 10, 200]);

/** Messages are Graph's own error text: it never contains the access token or the message body. */
export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly code: string, // Graph error code, or "network" / "timeout" / "http_<status>"
    readonly retryable: boolean,
    readonly authFailed = false,
  ) {
    super(message);
    this.name = 'GraphApiError';
  }
}

export interface PhoneNumberInfo {
  display_phone_number: string;
  verified_name: string;
  quality_rating?: string;
}

/** Thin client for the official WhatsApp Business Cloud API (Meta Graph API). */
@Injectable()
export class GraphApiClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    const url = config.getOrThrow<string>('WHATSAPP_GRAPH_URL').replace(/\/+$/, '');
    this.baseUrl = `${url}/${config.getOrThrow<string>('WHATSAPP_GRAPH_VERSION')}`;
  }

  async sendText(phoneNumberId: string, accessToken: string, to: string, body: string): Promise<string> {
    const res = await this.call<{ messages?: { id: string }[] }>('POST', `/${encodeURIComponent(phoneNumberId)}/messages`, accessToken, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    });
    const id = res.messages?.[0]?.id;
    if (!id) throw new GraphApiError('Graph API returned no message id', 'bad_response', false);
    return id;
  }

  /** Checks that the token can read the phone number: used to verify an account's credentials. */
  phoneNumber(phoneNumberId: string, accessToken: string): Promise<PhoneNumberInfo> {
    return this.call('GET', `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`, accessToken);
  }

  private async call<T>(method: 'GET' | 'POST', path: string, accessToken: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const timeout = (error as Error).name === 'TimeoutError';
      throw new GraphApiError(timeout ? 'Graph API timed out' : 'Graph API is unreachable', timeout ? 'timeout' : 'network', true);
    }
    const json = (await res.json().catch(() => null)) as { error?: { message?: string; code?: number; error_subcode?: number } } | null;
    if (res.ok && json && !json.error) return json as T;

    const err = json?.error;
    if (!err?.code) throw new GraphApiError(`Graph API answered HTTP ${res.status}`, `http_${res.status}`, res.status >= 500 || res.status === 429);
    throw new GraphApiError(
      (err.message ?? 'Graph API error').slice(0, 500),
      String(err.code),
      RETRYABLE_CODES.has(err.code) || res.status >= 500,
      AUTH_CODES.has(err.code) || res.status === 401,
    );
  }
}
