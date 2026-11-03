import { SETTING_DEFAULTS } from '../settings/settings.defaults';
import { shouldSendAutomatically, toChatHistory } from './ai-reply.service';

const gen = SETTING_DEFAULTS['ai.generation'].value;

describe('shouldSendAutomatically', () => {
  it('sends everything when auto-reply is on (every decision text is safe to send)', () => {
    for (const action of ['reply', 'fallback', 'handoff'] as const) {
      expect(shouldSendAutomatically({ action, reason: 'x' }, true, gen)).toBe(true);
    }
  });

  it('only suggests while auto-reply is off', () => {
    expect(shouldSendAutomatically({ action: 'reply', reason: 'model_reply' }, false, gen)).toBe(false);
    expect(shouldSendAutomatically({ action: 'fallback', reason: 'low_confidence' }, false, gen)).toBe(false);
    expect(shouldSendAutomatically({ action: 'handoff', reason: 'medical_advice' }, false, gen)).toBe(false);
    expect(shouldSendAutomatically({ action: 'handoff', reason: 'human_request' }, false, gen)).toBe(false);
  });

  it('sends emergency and self-harm replies at once unless switched off', () => {
    expect(shouldSendAutomatically({ action: 'handoff', reason: 'emergency' }, false, gen)).toBe(true);
    expect(shouldSendAutomatically({ action: 'handoff', reason: 'self_harm' }, false, gen)).toBe(true);
    expect(shouldSendAutomatically({ action: 'handoff', reason: 'emergency' }, false, { ...gen, sendSafetyRepliesImmediately: false })).toBe(false);
  });
});

describe('toChatHistory', () => {
  it('maps directions to roles, trims text and drops empty messages', () => {
    expect(
      toChatHistory([
        { direction: 'INBOUND', body: ' hi ' },
        { direction: 'OUTBOUND', body: 'Hello!' },
        { direction: 'INBOUND', body: null },
        { direction: 'INBOUND', body: '   ' },
        { direction: 'INBOUND', body: 'prices?' },
      ]),
    ).toEqual([
      { role: 'customer', text: 'hi' },
      { role: 'assistant', text: 'Hello!' },
      { role: 'customer', text: 'prices?' },
    ]);
  });

  it('always ends with the customer and caps message length', () => {
    const turns = toChatHistory([
      { direction: 'INBOUND', body: 'x'.repeat(5000) },
      { direction: 'OUTBOUND', body: 'queued reply' },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toHaveLength(4096);
  });
});
