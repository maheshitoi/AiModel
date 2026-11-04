// The parts of the WhatsApp Cloud API webhook payload this app reads.
// https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components

export interface WebhookPayload {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: ChangeValue }[] }[];
}

export interface ChangeValue {
  messaging_product?: string;
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: InboundMessage[];
  statuses?: StatusUpdate[];
}

interface Media {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}

export interface InboundMessage {
  id: string;
  from: string;
  timestamp: string; // unix seconds
  type: string;
  text?: { body?: string };
  image?: Media;
  document?: Media;
  audio?: Media;
  video?: Media;
  sticker?: Media;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: { name?: { formatted_name?: string } }[];
  button?: { text?: string; payload?: string };
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  reaction?: { message_id?: string; emoji?: string };
}

export interface StatusUpdate {
  id: string; // wamid of our outbound message
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp: string;
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}
