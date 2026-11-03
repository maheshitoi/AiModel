import type { SettingKey, SettingValue } from './settings.dto';

/**
 * Earlier default values. The seed upgrades a stored setting that still equals one of these
 * exactly, which means nobody has changed it.
 */
export const LEGACY_DEFAULTS: { [K in SettingKey]?: Record<string, unknown>[] } = {
  'ai.generation': [
    {
      systemInstructions: '',
      maxNewTokens: 64,
      temperature: 0.8,
      topK: 40,
      topP: 0.9,
      maxContextTokens: 128,
      fallbackReply: 'Thanks for your message. A team member will get back to you shortly.',
    },
  ],
};

export const SETTING_DEFAULTS: { [K in SettingKey]: { description: string; value: SettingValue<K> } } = {
  'ai.generation': {
    description: 'Text generation parameters used by the inference service',
    value: {
      // Not used yet: the current model was not trained with system turns (docs/inference.md).
      systemInstructions: '',
      maxNewTokens: 64,
      // Greedy decoding is what was evaluated. Sampling makes the small model less reliable.
      temperature: 0,
      topK: 0,
      topP: 1,
      maxContextTokens: 128,
      fallbackReply: 'Thanks for your message. A team member will get back to you shortly.',
      minConfidence: 0.5,
      historyMessages: 20,
      sendSafetyRepliesImmediately: true,
    },
  },
  notifications: {
    description: 'Which events create dashboard notifications',
    value: { trainingFinished: true, deliveryFailures: true, aiErrors: true, webhookErrors: true },
  },
  system: {
    description: 'General system preferences',
    value: { timezone: 'UTC', logRetentionDays: 90 },
  },
  security: {
    description: 'Authentication and session policy',
    value: { accessTokenTtlMinutes: 15, refreshTokenTtlDays: 7, maxFailedLogins: 5 },
  },
};
