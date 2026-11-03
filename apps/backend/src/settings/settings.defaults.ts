import type { SettingKey, SettingValue } from './settings.dto';

export const SETTING_DEFAULTS: { [K in SettingKey]: { description: string; value: SettingValue<K> } } = {
  'ai.generation': {
    description: 'Text generation parameters used by the inference service',
    value: {
      systemInstructions: '',
      maxNewTokens: 64,
      temperature: 0.8,
      topK: 40,
      topP: 0.9,
      maxContextTokens: 128,
      fallbackReply: 'Thanks for your message. A team member will get back to you shortly.',
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
