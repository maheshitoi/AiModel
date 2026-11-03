import { ConfigService } from '@nestjs/config';
import { AiClientService, AiServiceError } from './ai-client.service';

const TOKEN = 't'.repeat(40);

function client(timeoutMs = 15_000) {
  const values: Record<string, unknown> = { AI_SERVICE_URL: 'http://ai.local:8000/', AI_SERVICE_TOKEN: TOKEN, AI_REQUEST_TIMEOUT_MS: timeoutMs };
  const config = { getOrThrow: (k: string) => values[k], get: (k: string) => values[k] } as unknown as ConfigService;
  return new AiClientService(config);
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('AiClientService', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends the internal token and the JSON body', async () => {
    fetchMock.mockResolvedValue(json(200, { action: 'reply', text: 'Hi' }));
    await client().generate({ messages: [{ role: 'customer', text: 'hello' }] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ai.local:8000/v1/generate');
    expect((init.headers as Record<string, string>)['X-Internal-Token']).toBe(TOKEN);
    expect(JSON.parse(init.body as string)).toEqual({ messages: [{ role: 'customer', text: 'hello' }] });
  });

  it('retries once when the model is busy', async () => {
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as typeof setTimeout);
    fetchMock
      .mockResolvedValueOnce(json(503, { detail: 'The model is busy, try again' }, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json(200, { action: 'reply' }));
    await expect(client().generate({ messages: [] })).resolves.toEqual({ action: 'reply' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [503, { detail: 'No model is loaded' }, 'no_model'],
    [503, { detail: 'AI_SERVICE_TOKEN is not configured' }, 'misconfigured'],
    [401, { detail: 'Invalid or missing X-Internal-Token' }, 'misconfigured'],
    [404, { detail: 'Checkpoint not found' }, 'not_found'],
    [422, { detail: [{ loc: ['body', 'messages'], msg: 'bad', type: 'x' }] }, 'rejected'],
    [500, 'oops', 'bad_response'],
  ])('maps HTTP %s to %s', async (status, body, kind) => {
    fetchMock.mockResolvedValue(json(status, body));
    await expect(client().currentModel()).rejects.toMatchObject({ kind });
  });

  it('turns network failures and timeouts into typed errors', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client().currentModel()).rejects.toMatchObject({ kind: 'unreachable' });

    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    await expect(client(1000).currentModel()).rejects.toMatchObject({ kind: 'timeout', message: expect.stringContaining('1000 ms') });
  });

  it('never puts the request body into error messages', async () => {
    fetchMock.mockResolvedValue(json(422, { detail: [{ loc: ['body', 'messages', 0, 'text'], msg: 'too long', type: 'x' }] }));
    const error = (await client()
      .generate({ messages: [{ role: 'customer', text: 'my card is 4111 1111 1111 1111' }] })
      .catch((e: unknown) => e)) as AiServiceError;
    expect(error.message).toBe('The AI service rejected the request: body.messages.0.text');
  });
});
