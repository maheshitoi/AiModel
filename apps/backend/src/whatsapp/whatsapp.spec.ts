import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import { CredentialCipher, decodeKey } from '../common/credential-cipher';
import { GraphApiClient } from './graph-api.client';
import { backoffMs } from './message-sender.service';
import { parseInbound, phoneNumberIds, signatureMatches } from './webhook.service';
import type { InboundMessage } from './webhook.types';

const config = (values: Record<string, unknown>) => ({ getOrThrow: (k: string) => values[k], get: (k: string) => values[k] }) as unknown as ConfigService;

describe('CredentialCipher', () => {
  const key = randomBytes(32).toString('base64');
  const cipher = new CredentialCipher(config({ CREDENTIALS_ENCRYPTION_KEY: key }));

  it('round-trips and uses a fresh IV every time', () => {
    const a = cipher.encrypt('EAAG-secret-token');
    const b = cipher.encrypt('EAAG-secret-token');
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret');
    expect(cipher.decrypt(a)).toBe('EAAG-secret-token');
  });

  it('rejects tampered ciphertext and a different key', () => {
    const value = cipher.encrypt('token');
    const parts = value.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => cipher.decrypt(parts.join('.'))).toThrow();
    const other = new CredentialCipher(config({ CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64') }));
    expect(() => other.decrypt(value)).toThrow();
  });

  it('accepts only 32-byte base64 keys', () => {
    expect(decodeKey(key)).not.toBeNull();
    expect(decodeKey(randomBytes(16).toString('base64'))).toBeNull();
    expect(decodeKey('not base64!')).toBeNull();
  });
});

describe('webhook signature', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const sign = (secret: string, raw = body) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  it('accepts the HMAC of the exact raw body', () => {
    expect(signatureMatches(body, sign('app-secret'), 'app-secret')).toBe(true);
  });

  it.each([
    ['wrong secret', sign('other-secret')],
    ['missing header', undefined],
    ['wrong scheme', sign('app-secret').replace('sha256=', 'sha1=')],
    ['truncated', sign('app-secret').slice(0, 20)],
    ['not hex', 'sha256=zzzz'],
  ])('rejects %s', (_, header) => {
    expect(signatureMatches(body, header, 'app-secret')).toBe(false);
  });

  it('rejects a modified body (re-serialised JSON would not match either)', () => {
    expect(signatureMatches(Buffer.from('{"object": "whatsapp_business_account"}'), sign('app-secret'), 'app-secret')).toBe(false);
  });

  it('finds every phone number a payload is for', () => {
    const payload = {
      entry: [
        { changes: [{ value: { metadata: { phone_number_id: '111' } } }, { value: { metadata: { phone_number_id: '222' } } }] },
        { changes: [{ value: { metadata: { phone_number_id: '111' } } }, { value: {} }] },
      ],
    };
    expect(phoneNumberIds(payload)).toEqual(['111', '222']);
  });
});

describe('parseInbound', () => {
  const base = { id: 'wamid.1', from: '15551234567', timestamp: '1762156800' };
  it.each<[Partial<InboundMessage>, object]>([
    [{ type: 'text', text: { body: 'Hi there' } }, { type: 'TEXT', body: 'Hi there', preview: 'Hi there' }],
    [{ type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'my rash' } }, { type: 'IMAGE', body: 'my rash', mediaId: 'm1', mediaMimeType: 'image/jpeg' }],
    [{ type: 'audio', audio: { id: 'a1', mime_type: 'audio/ogg' } }, { type: 'AUDIO', body: null, preview: '[audio]' }],
    [{ type: 'location', location: { latitude: 1.5, longitude: 2.5 } }, { type: 'LOCATION', body: '1.5, 2.5' }],
    [{ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b', title: 'Yes' } } }, { type: 'INTERACTIVE', body: 'Yes' }],
    [{ type: 'reaction', reaction: { message_id: 'x', emoji: '👍' } }, { type: 'REACTION', body: '👍' }],
    [{ type: 'order' }, { type: 'UNSUPPORTED', body: null, preview: '[order]' }],
  ])('maps %j', (m, expected) => {
    expect(parseInbound({ ...base, ...m } as InboundMessage)).toMatchObject(expected);
  });
});

describe('GraphApiClient', () => {
  const graph = new GraphApiClient(config({ WHATSAPP_GRAPH_URL: 'https://graph.example/', WHATSAPP_GRAPH_VERSION: 'v23.0' }));
  let fetchMock: jest.SpyInstance;
  beforeEach(() => (fetchMock = jest.spyOn(global, 'fetch')));
  afterEach(() => jest.restoreAllMocks());

  const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('sends a text message with the bearer token and returns the wamid', async () => {
    fetchMock.mockResolvedValue(res(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.OUT' }] }));
    await expect(graph.sendText('123456', 'TOKEN', '15551234567', 'Hello')).resolves.toBe('wamid.OUT');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.example/v23.0/123456/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN');
    expect(JSON.parse(init.body as string)).toMatchObject({ messaging_product: 'whatsapp', to: '15551234567', type: 'text', text: { body: 'Hello' } });
  });

  it.each([
    [429, { error: { message: 'Rate limit', code: 130429 } }, { code: '130429', retryable: true, authFailed: false }],
    [400, { error: { message: 'Re-engagement message', code: 131047 } }, { code: '131047', retryable: false }],
    [401, { error: { message: 'Error validating access token', code: 190 } }, { code: '190', retryable: false, authFailed: true }],
    [502, 'Bad gateway', { code: 'http_502', retryable: true }],
  ])('classifies HTTP %s errors', async (status, body, expected) => {
    fetchMock.mockResolvedValue(res(status, body));
    await expect(graph.sendText('1', 'T', '2', 'x')).rejects.toMatchObject(expected);
  });

  it('treats network failures as retryable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(graph.sendText('1', 'T', '2', 'x')).rejects.toMatchObject({ code: 'network', retryable: true });
  });

  it('never includes the token in errors', async () => {
    fetchMock.mockResolvedValue(res(401, { error: { message: 'Invalid OAuth access token', code: 190 } }));
    const error = (await graph.sendText('1', 'SECRET-TOKEN', '2', 'x').catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain('SECRET-TOKEN');
  });
});

describe('backoff', () => {
  it('doubles from 30 seconds', () => {
    expect([0, 1, 2, 3].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
  });
});
