# Live inbox (Phase 12)

**Inbox** in the dashboard is where staff follow customer conversations as they happen, approve or
edit AI suggestions, and reply themselves.

- **Backend:** `apps/backend/src/conversations/` (REST) and `apps/backend/src/realtime/`
  (Socket.IO).
- **Frontend:** `apps/frontend/src/app/(dashboard)/inbox/` and `components/inbox/`.

## What staff see

| Area | Shows |
|---|---|
| List | Every conversation, newest first. Tabs: **All** (not closed), **Attention**, **Staff**, **Closed**. Search by name or number. Each row shows unread count, attention reason (emergencies in red), "Suggestion ready", and "Staff handling" |
| Thread | Messages oldest to newest, with "Load earlier messages". Outbound messages show who sent them (AI or the staff member), a delivery tick (waiting, sent, delivered, read), or WhatsApp's error with **Retry** |
| Attention banner | Why the conversation was flagged, for example "Emergency: the customer got the fixed safety reply. Contact them as soon as possible." **Mark handled** clears it |
| AI suggestion | The pending decision: **Send**, **Edit** (sent as a staff-written reply), or **Dismiss**. For fallbacks it also shows the model's rejected text |
| Composer | Enter sends, Shift+Enter adds a new line. Outside the 24-hour window it explains why free-form replies aren't allowed |
| Header | **Take over** (status HUMAN: the AI stops answering), **Hand back to AI** (OPEN), **Close** or **Reopen** |

Opening a conversation marks it read. The selected conversation is in the URL (`/inbox?c=<id>`).
On a phone the list and thread are separate screens.

## Live updates

The browser connects to Socket.IO at the backend's origin and sends its access token in the
handshake.

- **Who can connect:** only users with `conversations:read` join the inbox room. Others are
  disconnected.
- **Token expiry:** the server closes the socket when the token expires. The client refreshes the
  token and reconnects, so a revoked session can't keep listening.
- **What events contain:** only ids, never message text:
  - `conversation.changed`
  - `message.changed`
  - `decision.changed`

  The browser refetches through the REST API, where permissions apply. Integration tests check that
  no message text appears in events.
- **What sends them:** new or redelivered webhook messages, delivery statuses, sender results, AI
  decisions, approvals, dismissals, staff replies, and conversation changes.
- **After a reconnect:** the whole inbox is refetched, so nothing missed while offline is lost.
- **Live indicator:** the header shows **Live** or **Reconnecting…**.

## API (`/api/v1/conversations`)

| Route | Permission | Notes |
|---|---|---|
| `GET /conversations?filter=&search=&accountId=&page=` | `conversations:read` | `filter`: `all` (default, leaves out closed), `attention`, `open`, `human`, `closed` |
| `GET /conversations/:id` | `conversations:read` | Includes `pendingDecision`, `replyWindowEndsAt` and the WhatsApp account |
| `GET /conversations/:id/messages?before=&limit=` | `conversations:read` | Newest first, plus `hasMore`. `before` = the oldest loaded `occurredAt` |
| `POST /conversations/:id/read` | `conversations:read` | Resets the unread count |
| `PATCH /conversations/:id` | `conversations:manage` | `status`, `aiEnabled`, `assignedToId`, `needsAttention: false`. Audited |
| `POST /conversations/:id/messages` | `conversations:reply` | `{ text }`: queued as a staff reply and sent within seconds. Dismisses pending suggestions. **409** outside the 24-hour window or for a disabled number. The audit records that a reply was sent, not its text |
| `POST /conversations/:id/messages/:messageId/retry` | `conversations:reply` | Only for FAILED outbound messages, and only once per failure (a second call gets 409) |

Suggestions are approved or dismissed with `POST /ai/decisions/:id/approve|dismiss`
([ai-integration.md](ai-integration.md)).

## Limits

- **No assignee picker:** conversations can be assigned through the API (`assignedToId`), but the
  UI has no picker yet.
- **Media:** images and other media show as `[image] caption`. Downloading them is not implemented.
- **List size:** the list loads the first 100 matching conversations. Search to find older ones.
