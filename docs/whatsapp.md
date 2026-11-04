# WhatsApp Cloud API (Phase 11)

The platform connects to an existing WhatsApp Business number through Meta's **official Cloud API**:
webhooks in, Graph API out. It uses no unofficial libraries and no WhatsApp Web automation. Code is
in `apps/backend/src/whatsapp/`, and the dashboard page is **Settings → WhatsApp**.

## Connecting a number

1. **Meta setup:** in [Meta for Developers](https://developers.facebook.com/), create or open a
   Business app with the **WhatsApp** product. Add your number under WhatsApp → API setup.
2. **Access token:** create a **permanent system-user access token** in Business settings → System
   users. It needs the `whatsapp_business_messaging` and `whatsapp_business_management`
   permissions. The temporary 24-hour token works only for a quick test.
3. **Add the number in the dashboard:** go to Settings → WhatsApp → **Connect number** and enter:
   - the display name and the number in E.164 format
   - the **Phone number ID** and **WhatsApp Business Account ID** (both on the API setup page)
   - the access token
   - the **app secret** (App settings → Basic)
   - a **verify token**: any random string of at least 16 characters
4. **Verify:** click **Verify credentials**. The backend reads the number from the Graph API, and the
   status becomes **Connected**.
5. **Webhook:** in the Meta app, go to WhatsApp → Configuration → Webhook and enter:
   - **Callback URL:** `https://<your-public-backend>/api/v1/webhooks/whatsapp` (shown on the page)
   - **Verify token:** the same string as in step 3

   Then **subscribe to `messages`**.
6. **Local development:** Meta only calls public HTTPS URLs, so expose port 4000 with a tunnel (for
   example `cloudflared tunnel --url http://localhost:4000`). Set `NEXT_PUBLIC_API_URL` to the
   tunnel URL so the page shows the right callback.

Auto-reply is **off** when a number is connected. AI replies wait as suggestions for staff to
approve (inbox, Phase 12); emergency and self-harm replies are the exception
([ai-integration.md](ai-integration.md)). Turning auto-reply on asks for confirmation.

## Security

- **Encrypted credentials:**
  - **At rest:** the access token, app secret and verify token are stored with **AES-256-GCM**
    (`CREDENTIALS_ENCRYPTION_KEY`, 32 random bytes), and a tampered value fails to decrypt.
  - **Through the API:** the API never returns them; only the token's last 4 characters are shown.
    Audit entries record which credentials changed, never their values.
- **Back up `CREDENTIALS_ENCRYPTION_KEY`.** Losing or changing it makes stored credentials
  unreadable, so they would have to be entered again. One unreadable account doesn't break the
  others.
- **Webhook POST:**
  - **Signature:** every request must carry a valid `X-Hub-Signature-256` (HMAC-SHA256 of the
    **raw** body with the app secret, compared in constant time). Failures get 401 and a
    `webhook.signature_invalid` security log.
  - **Throttling:** the POST isn't rate-limited, because Meta delivers in bursts.
- **Webhook GET:** the verification echoes the challenge only for a matching verify token, and it is
  rate-limited.
- **Logs:** they never contain tokens or message text. Delivery errors log WhatsApp's error code.

## Receiving (webhook POST)

| Step | Behaviour |
|---|---|
| Redelivery | Ignored. `waMessageId` is unique, and concurrent duplicates are caught too |
| Conversation | Created per (number, customer) and stores the profile name. A message to a closed conversation reopens it |
| Message types | Text, image, document, audio, video, sticker (media ID, type and caption are kept), location, contacts, button and list replies, reactions. Anything else is stored as `UNSUPPORTED` |
| AI | Only **text** messages go to the AI, after Meta has received its 200 ([ai-integration.md](ai-integration.md)) |
| Statuses | `sent → delivered → read` are recorded in `MessageStatusHistory` (duplicates are ignored). An out-of-order "delivered" never overwrites "read". `failed` stores WhatsApp's error and flags the conversation |
| Unknown number | Acknowledged (so Meta stops retrying) and logged |

## Sending (outbound queue)

Queued messages (from AI auto-replies, emergency replies and approved suggestions) are sent every
`WHATSAPP_SENDER_INTERVAL_MS` (default 2 s) and right after an AI decision.

| Rule | Behaviour |
|---|---|
| No double sends | A message is claimed by a conditional update (QUEUED → SENDING) before it is sent. Concurrent runs skip it. A message still SENDING after 5 minutes (the process died mid-send) becomes FAILED `send_interrupted` instead of being re-sent, because it may already have been delivered |
| 24-hour window | Free-form text is only allowed within 24 h of the customer's last message. Outside it, the message fails with `outside_24h_window` and WhatsApp is not called. Template messages are not implemented yet |
| Temporary errors | Rate limits (130429, 131056, 80007…), 5xx and network errors are retried after 30 s, 1, 2 and 4 min (5 attempts in total) |
| Permanent errors | The message is FAILED with WhatsApp's code and message, the conversation is flagged, and a log entry is written |
| Rejected token (190) | The account becomes `ERROR`, so re-enter the token and verify again |
| Disabled account | Nothing is sent |

## Configuration

| Variable | Default | |
|---|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | (required) | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `WHATSAPP_GRAPH_URL` | `https://graph.facebook.com` | Changed only by the tests, which point it at a fake |
| `WHATSAPP_GRAPH_VERSION` | `v23.0` | Meta retires versions after about two years. Check the current one in the Meta changelog |
| `WHATSAPP_SENDER_INTERVAL_MS` | `2000` | `0` disables sending |

## Limits

- **Not yet tested against Meta:** the code follows Meta's documented payloads, and it is tested end
  to end against a fake Graph API. It has **not** been run against Meta's servers yet, because no
  real credentials were available.
- **No templates or outbound media:** template messages (needed outside the 24-hour window) and
  sending media aren't implemented. Inbound media is recorded but not downloaded.
- **Single-instance sender:** if the backend runs as several instances, the claim step still
  prevents double sends. Each instance just polls.
