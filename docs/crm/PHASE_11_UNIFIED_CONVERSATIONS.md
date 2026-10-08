# CRM Phase 11 — Unified Conversations

Status: implemented, tested and verified (2026-10-08). Phase 12 is not started.

One provider-neutral conversation layer and one inbox for every channel. Adding a channel later means writing a provider adapter, not redesigning the CRM:

```
Provider webhook ─► ChannelProvider (verify + normalise) ─► conversation service ─► CrmConversation ─► CrmMessage
                                                                                   │                 │
User reply ─► conversation service (permission, capabilities, DND) ─► ChannelProvider.sendMessage ◄──┘
                                                                                   ▼
                                     Contact / Company / Opportunity ─► crm_events timeline ─► future automation
```

## 1. Existing systems reused

| Area | What was reused |
|---|---|
| Contacts | Phase 04 contacts. Matching uses each contact's email and phone match keys (`email_keys`, `phone_keys`, GIN-indexed, built from the core fields and extra channels). "Create contact" from a conversation goes through `createContact`, so the Phase 04 duplicate rules apply. Contact merges move conversations to the survivor. |
| Companies | Phase 05 CRM companies. The contact's company is filled in automatically. Company merges move conversations. |
| Opportunities | Phase 06 opportunities. Linked by choice. Linked automatically only when the contact has exactly one open opportunity. |
| Activities / tasks | Phase 09 `createActivity`. A task from a conversation is a normal task linked to the conversation (activity link type `CONVERSATION`). The tasks panel is the existing `ActivityPanel`. |
| Internal notes | The shared CRM notes (`crm_notes`, entity `CONVERSATION`, `CrmNotesPanel` / notes service and routes). No new note table. Notes live in a different table from messages, so a note cannot be sent. |
| Timeline | `crm_events` and `CrmTimeline`. The record timeline route adds the events of conversations linked to the record that the viewer can open. |
| Files | Shared `attachments` table + `FileStorage` (`saveFile`: type allow-list, magic-byte check, 20 MB limit). The new `crm_message_attachments` table only holds the CRM-side record. |
| Users / employees | ERP `users`. The assignee must be an active user with CRM access (Phase 09 `assertAssignable`). There are no CRM teams, queues or users. |
| Notifications | ERP `notifications` (in-app bell): new conversation for the channel's default assignee, assignment, reopen by a new message. |
| Events | `runCrmMutation`: events are written in the same transaction as the change and dispatched after commit. The event row id is the idempotency key for consumers. New `crmSystemActor` for provider webhooks (no user behind the change). |
| Queues | Existing BullMQ CRM worker. One new scheduler job (`conversation.sweep`, every 5 minutes). |
| Webhooks | Phase 03 pattern: per-endpoint URL, HMAC-SHA256 signature with a 5-minute replay window, encrypted secret (`encryptSecret`), rate limit (`assertCaptureRateLimit`), body size cap. |
| Messaging | `src/core/communication/CommunicationProvider.ts`. It held an unused one-method stub; it now holds the full provider contract. The Call / Email / WhatsApp quick links (`src/lib/communication.ts`) are unchanged. |
| Search | PostgreSQL only: lower-cased `search_text` + `contains`, as other CRM lists do, plus full-text search on message bodies (GIN index on `to_tsvector('simple', body)`). No external search engine. |
| Authorization | Existing `crm` permissions (`view`, `create`, `edit`, `view_all`) and `crm_settings` (`view`, `edit`). No new roles or permissions. The ERP has no per-channel permissions, so none were invented. |
| Realtime | None exists in the ERP. The inbox list polls every 15 s and an open thread every 10 s, both only while the page is visible. |

## 2. Files

**New — core provider layer** (`src/core/communication/`)

- `CommunicationProvider.ts` — the `ChannelProvider` contract (rewritten).
  - Defines: `ChannelCapabilities`, the normalised inbound, status, outbound and result shapes, `ProviderPayloadError` and `ProviderConfigError`.
- `providers/generic-webhook.provider.ts` — the reference adapter: signed webhook in, signed HTTP relay out.
- `provider-registry.ts`
- `communication.test.ts`

**New — CRM module** (`src/modules/crm/conversations/`)

- `conversation-registry.ts` — client-safe. Contains:
  - channel types, statuses and transitions;
  - match and message statuses, and the forward-only delivery rule;
  - identity keys and the contactability mapping;
  - inbox folders, event names and the event payload type.
- `conversation.schema.ts`
- `conversation-access.ts` — the visibility rule (shared by the services and the timeline).
- `conversation-matching.ts` — central contact matching.
- `crm-conversation.repository.ts`
- `crm-channels.service.ts` — channel settings, capabilities, provider binding.
- `crm-conversations.service.ts` — inbox, thread, read state, assign, status, links, create contact, task, attachment download.
- `conversation-messaging.service.ts` — inbound ingest, delivery receipts, webhook entry point, send, retry, stale-send sweep.
- Tests: `conversations.unit.test.ts`, `conversations.integration.test.ts`.

**New — API**

- `src/app/api/v1/crm/conversations/**` — 14 route files plus `route.test.ts`.
- `src/app/api/v1/crm/settings/channels/**`
- `src/app/api/v1/crm/webhooks/conversations/[provider]/[channelId]/route.ts`

**New — UI**

- `src/components/crm/conversations/`:
  - `ConversationView.tsx`
  - `ConversationThread.tsx` (thread, message bubbles, notes, composer)
  - `ConversationDialogs.tsx`
  - `ConversationsPanel.tsx`
  - `conversation-types.ts`
  - tests
- `src/app/(dashboard)/crm/inbox/` — `page.tsx`, `[id]/page.tsx`, `_components/InboxClient.tsx` and its tests.
- `src/app/(dashboard)/crm/settings/_components/ChannelsTab.tsx`

**Modified**

- `prisma/schema.prisma` and the migration `20261010100000_crm_conversations`.
- `BusinessRuleError.ts` — `CRM_CONTACT_NOT_CONTACTABLE`, `CRM_CHANNEL_UNAVAILABLE` (422).
- CRM core:
  - `crm-entity-types.ts` (`CONVERSATION` → `/crm/inbox/<id>`)
  - `crm-event-types.ts`
  - `crm-events.service.ts` (`excludeEventTypes` on related scopes)
  - `crm-mutation.ts` (system actor)
  - `crm-entity-access.ts` (conversation access; the unknown-type fallthrough removed)
- Activities:
  - `activity-registry.ts` (`CONVERSATION` parent type)
  - `crm-activity.repository.ts` and `crm-activities.service.ts` (conversation labels and links)
  - `ActivityPanel.tsx` (no appointment booking on a conversation)
  - `activity-types.ts`
- `crm-appointments.service.ts` — refuses a conversation as the appointment record.
- `contact-merge.service.ts`, `company-merge.service.ts` — conversations follow the survivor.
- `crm-import.worker.ts` — sweep job.
- Events route — conversation scope.
- Contact / company / opportunity detail pages — Conversations section.
- CRM settings — Channels tab.
- `navigation.ts` — Inbox.
- `crm-timeline-types.ts` — message tone.
- Tests: `crm-registries.test.ts`, `events/route.test.ts`.

## 3. Database changes

Migration `20261010100000_crm_conversations`.

**Enums:**

- `CrmEntityType` + `CONVERSATION`
- `RelatedModule` + `CRM_CONVERSATION`

**New tables:**

| Table | Purpose |
|---|---|
| `crm_channels` | Configured channel: type, name, provider key, status (ACTIVE / PAUSED), business address, non-secret `config`, `secret_encrypted`, default assignee, `last_inbound_at`, `version`. |
| `crm_conversations` | Thread on one channel. Status, `match_status` + `match_candidate_ids`, contact / CRM company / opportunity, assignee, provider thread ref, display name and identifier, `unread_count`, `last_read_at` / by, message count, last message (time, preview, direction), last inbound / outbound, `search_text`, closed / archived stamps, `version`. |
| `crm_conversation_participants` | Customer identities (EMAIL / PHONE / PROVIDER_ID / SESSION, raw + normalised key, contact once known) and ERP users who replied. |
| `crm_messages` | Inbound and outbound customer messages only. Direction, type, subject, body, sender / recipient, sending user, status, `provider_message_id`, `occurred_at`, sent / delivered / read / failed / seen stamps, safe error code and message, attempts, provider-neutral `metadata`. |
| `crm_message_attachments` | Kind, file name, MIME type, size, `attachment_id` → shared `attachments`, or `provider_media_ref` for media not stored. |

**Foreign keys:**

- company → `companies`; channel → `crm_channels` (RESTRICT).
- contact / company / opportunity → SET NULL. History is never deleted with a record.
- participants and messages → conversation CASCADE. Conversations are never hard-deleted by the app.
- attachment → `attachments` SET NULL.

**CHECK constraints:**

- channel type and status;
- conversation status, match status, non-negative counts;
- participant type, role and kind;
- message type;
- direction ↔ status: inbound is always RECEIVED; outbound is QUEUED / SENT / DELIVERED / READ / FAILED;
- attachment kind.

**Indexes:**

- Inbox: `(company_id, last_message_at)`, plus status, assignee and channel variants.
- Record panels: contact, company and opportunity.
- Thread: `(conversation_id, occurred_at, id)`.
- Identity lookup: `(company_id, channel_id, identifier_kind, identifier_key)` and `(company_id, identifier_kind, identifier_key)`.

SQL-only (partial or expression) indexes:

- `crm_messages_provider_message_key` — unique `(channel_id, provider_message_id)`; this is the idempotency guarantee.
- Unmatched queue, unread conversations, provider thread ref.
- Participant identity and participant user uniqueness.
- Unseen inbound messages, and queued outbound messages (for the sweep).
- `crm_messages_body_fts_idx` — GIN on `to_tsvector('simple', body)`.

**Upgrade:** applied to a copy of the Phase 10 database with existing data — no data changes needed. **Fresh:** all 163 migrations plus the seed run cleanly, and the Prisma models match the database.

## 4. Core communication architecture

- **Channel** — one configured connection (a WhatsApp number, a mailbox, a page, a website chat).
  - `provider` picks the adapter; capabilities come from the adapter and the channel's settings.
  - PAUSED channels neither send nor accept deliveries (webhook answers 503 + `Retry-After`, so nothing is lost).
- **Conversation** — a thread on one channel.
  - Status lifecycle: OPEN ↔ PENDING, → CLOSED, → ARCHIVED; CLOSED / ARCHIVED → OPEN. Closing never deletes anything.
  - A new inbound message reopens a CLOSED or PENDING conversation.
  - An ARCHIVED conversation stays archived; a new message opens a new conversation.
  - A reply on a CLOSED conversation reopens it.
- **Message** — customer-visible only; internal notes are never in this table.
  - Ordered by `occurred_at` (the provider's time for inbound) with id as the tie-breaker.
  - Message types: TEXT / IMAGE / FILE / AUDIO / VIDEO / DOCUMENT / LOCATION / SYSTEM / OTHER.
- **Participant** — the customer identity on the channel, and the users who replied.
  - Once a user links the conversation to a contact, the identity carries that contact. A later conversation from the same provider id or session then matches by itself.
- **Assignment** — an ERP user (assign / reassign / unassign).
  - Each change is a `conversation.assigned` event with from / to, plus an AuditLog row, plus a notification.
  - A channel can name a default assignee for new conversations (not a routing engine).
- **Internal note** — a CRM note on the CONVERSATION entity, shown amber in the thread ("never sent to the customer").
  - Allowed under DND (internal action).

**Visibility:**

- `crm.view_all` sees every conversation.
- Others see conversations assigned to them, plus unassigned ones linked to a contact, company or opportunity they own.
- Unassigned unmatched conversations are therefore triaged by managers, or by the channel's default assignee.

## 5. Provider architecture

**`ChannelProvider` contract** (one implementation per provider):

- `validateConfig`
- `capabilities`
- `verifyWebhook`
- `normalizeInbound`
- `validateRecipient`
- `sendMessage` (text and attachments in one call; must not throw — it returns a classified result)
- optional `getDeliveryStatus`

**Inbound flow:**

1. Webhook URL (`/api/v1/crm/webhooks/conversations/<provider>/<channelId>`): public route with a rate limit and a 12 MB body cap.
2. The adapter verifies the signature, then normalises the payload into provider-neutral events (message or status).
3. The conversation service handles each message:
   - idempotency check (inside a per-sender advisory lock, backed by the unique index);
   - find the conversation (provider thread ref, else the latest non-archived conversation for this identity);
   - otherwise match the contact and create the conversation;
   - store the message and its files, increase the unread count, bump the linked records' last activity;
   - write the events in the same transaction.
4. Raw provider payloads are never stored or allowed to touch CRM tables.

**Outbound flow:**

1. Check, in order: permission (`crm.create`) → conversation not archived → channel ACTIVE and `canSend` → text / subject / attachment rules from the capabilities → DND / contactability → recipient (the customer participant) → `validateRecipient`.
2. Save the message as QUEUED, with its attachments in the file store.
3. Call `provider.sendMessage` **outside** the transaction.
4. Save SENT / DELIVERED with the provider id, or FAILED with a safe code and message. The provider's response body is never stored or shown.
5. The message is never lost.

**Retry and idempotency:**

- Retry claims the FAILED message atomically: two clicks lead to one send.
- The same message id is the idempotency key (`X-CRM-Idempotency-Key`) on every attempt.
- `clientMessageId` makes a double submit from the composer harmless.
- The sweep marks a message FAILED (`SEND_INTERRUPTED`, "may or may not have been delivered") when it has been QUEUED for more than 10 minutes. It never resends automatically.

**Delivery status:**

- Forward-only: QUEUED → SENT → DELIVERED → READ.
- FAILED is accepted only from QUEUED or SENT. A later success from the provider wins over an earlier failure.
- Repeats and late receipts are ignored.
- The UI shows only the statuses the channel reports.

**Generic signed-webhook adapter** (the only provider in Phase 11) — for a website chat backend, an n8n / Make / Zapier bridge, or an in-house gateway:

- **Inbound:** signed JSON (`X-CRM-Timestamp`, `X-CRM-Signature: sha256=HMAC(secret, "<ts>.<body>")`), one event or `{events:[…]}` (up to 50).
  - Message: `id`, `from {email|phone|id|sessionId|name}`, `text`, `subject`, `attachments [{fileName, mimeType, contentBase64 | mediaId}]`, `location`, `threadId`, `inReplyTo`, `references`.
  - Status: `{type:"status", messageId, status}`.
- **Outbound:** only when an admin sets an outbound URL. The CRM POSTs a signed JSON request with the idempotency key; a 2xx `{messageId}` reply means accepted.
  - https only in production; no credentials in the URL; no redirects; 15 s timeout.

## 6. Inbox

**Layout:**

- Folders: All / Unread / Assigned to me / Unassigned / Unmatched, with counts.
- Channels: generated from the configured channels, with open counts.
- A status filter (default open + pending).
- Server-side search (debounced): subject, participants, numbers, linked contact / company / opportunity, channel, assignee name via the linked records, and full-text message bodies with prefix match (`quot revis` finds "revised quotation").
- Paged list (30 + "Show more"), sorted by last activity.

**Row:** contact or sender, channel, company or identifier, preview ("You: …" for replies), time, unread count, unmatched badge, status, assignee.

**Thread:**

- The latest 50 items first; "Load older messages" pages with a keyset cursor.
- Messages, internal notes and conversation events are merged by time.
- Bubbles: inbound left, outbound right; failed messages in red with the reason and Retry. Notes are amber; events are centred.
- Opening a conversation marks inbound messages read up to the newest one on screen (`POST …/read`). This is team-level unread state; replying also marks it read.

**Header:**

- Contact, company and opportunity (links to the existing record pages), channel, assignee, status.
- Actions: Assign, Link records, Create task, Close / Mark pending / Reopen / Archive / Restore.
- Unmatched banner: candidates for MULTIPLE, Link existing contact, Create contact.
- DND banner.
- Details panel: tasks (`ActivityPanel`), participants, history (`CrmTimeline`).

**Composer:**

- Reply / Internal note.
- Subject, attachments, limits and accepted file types come from the channel's capabilities.
- When replying is not possible, it says why: not configured, paused, DND, archived, or no permission.

**Attachments:** images preview inline, other files download. Every download goes through `/api/v1/crm/conversations/attachments/<id>/download`, which checks conversation access (`nosniff`). Files that were not stored are listed as "not stored in the CRM".

**Mobile width:** list → conversation → back.

## 7. CRM relationships

A conversation may have a contact, a company and an opportunity — any combination, or none (unmatched).

**Linking:**

- Uses existing records the user can see (never created here). Archived records are refused.
- Linking a contact fills its company when none is set; an opportunity fills its company and contact when empty.
- An opportunity of another company is refused.

**History:** each change is a `conversation.contact_linked` / `company_linked` / `opportunity_linked` event with from / to, plus an AuditLog row. Earlier associations stay in the history.

**Record pages:**

- Contact, company and opportunity pages show a Conversations section (all channels) linking into the inbox.
- Their timelines show the conversation's events (message received / sent / failed, notes, assignment, links, tasks), without delivery or read receipts.

**Tasks:**

- Created on the opportunity, else the contact, else the company (whichever the user can see), and linked to the conversation (and so to the other records).
- On an unmatched conversation, the task is created on the conversation itself.
- When created from a message, the message is quoted.

## 8. Unmatched queue

**Matching** — central, authoritative identifiers only:

- email → contact email keys;
- phone / WhatsApp / SMS → contact phone keys (last 10 digits);
- provider id / chat session → a contact a user already linked to that identity on that channel.

**Order and outcome:**

- The sender's main identity is tried first, then other identities it supplied (a chat visitor's email).
- Exactly one contact → MATCHED, with the contact's company and its sole open opportunity.
- Several → MULTIPLE: the candidates are listed and the user picks. A single non-archived contact among archived ones wins.
- None → UNMATCHED.
- Merged contacts resolve to the survivor. No fuzzy name matching.

**Unmatched state:** `match_status <> MATCHED`. The queue is the "Unmatched" folder, which includes closed conversations but not archived ones (archiving is how the queue is cleared, per policy).

**Manual linking:** search existing contacts (server-side lookup), link, and optionally add a company and opportunity. The conversation moves to the normal inbox, and the identity is remembered.

**Duplicate prevention:**

- Contacts are never created automatically.
- "Create contact" (pre-filled from the sender's identity) calls the Phase 04 contact service. Its duplicate rules return the matches (WARN / BLOCK), and the dialog offers "Link this contact", or "Create anyway" when the rule only warns.
- The same person writing on several channels matches the same contact by email or phone.

## 9. DND / contactability

**Authority:** Phase 04 `crm_contact_consents` and `canContact()` — no second DND system.

**Channel mapping:**

- EMAIL → EMAIL, SMS → SMS, WHATSAPP → WHATSAPP.
- Messenger, Instagram, website chat and other channels have no consent row of their own; they are governed by the contact-wide "All channels" restriction.
- A merged contact's restrictions are read from the survivor.

**Enforcement** is server-side, in `prepareSend`, before anything is stored or any provider is called:

- A blocked send returns `422 CRM_CONTACT_NOT_CONTACTABLE`, with a plain sentence and no internal policy details.
- Retry re-checks DND.

**UI:** the conversation shows the restriction in the header, and Reply is disabled. Notes and tasks stay allowed.

**Not covered:** unmatched conversations have no contact, so no restriction is on record.

## 10. Event hooks

All events are in `crm_events` with entity `CONVERSATION` and the conversation id. They are written in the same transaction as the change and dispatched after commit; the event id is the idempotency key. Inbound and receipt events have no actor (system).

| Event | When |
|---|---|
| `conversation.created` | New conversation (inbound) — payload `matchStatus`, `matchedBy`, `source` |
| `conversation.assigned` | Assign / reassign / unassign (incl. channel default) — `fromUserId`, `toUserId`, `automatic` |
| `conversation.status_changed` | OPEN ↔ PENDING |
| `conversation.closed` / `conversation.reopened` / `conversation.archived` | Lifecycle (reopen also by a new inbound message or a reply) |
| `conversation.contact_linked` / `company_linked` / `opportunity_linked` | Link / relink / unlink — from / to ids, `automatic`, `matchedBy` |
| `conversation.updated` | Subject changed |
| `conversation.note_added` / `note_updated` / `note_deleted` | Internal notes (shared notes service) |
| `message.received` | Inbound message stored |
| `message.sent` | Provider accepted an outbound message (also after a retry) — `attempt` |
| `message.failed` | Provider refused, provider reported failure, or interrupted send — `errorCode`, `retryable` |
| `message.delivered` / `message.read` | Delivery receipts |

`activity.*` events of tasks linked to the conversation also appear on its timeline.

Payload (`ConversationEventPayload`, schemaVersion 1):

```json
{ "schemaVersion": 1, "conversationId": "…", "messageId": "…|null", "channelId": "…", "channelType": "WHATSAPP",
  "contactId": "…|null", "crmCompanyId": "…|null", "opportunityId": "…|null", "assignedUserId": "…|null",
  "direction": "INBOUND|OUTBOUND|null", "status": "…", "occurredAt": "ISO-8601", "...": "event-specific extras" }
```

Message bodies are not copied into event payloads (consumers load the message by `messageId`); the event summary carries a short preview for the timeline.

**Event names:** the spec's `contact.linked` / `opportunity.linked` are named `conversation.contact_linked` / `conversation.opportunity_linked`, because event names follow `<entity>.<verb>` on the entity they are stored on.

## 11. Tests

| Kind | Tests |
|---|---|
| Unit | 9 (`conversations.unit.test.ts`: lifecycle, forward-only delivery, identity keys, matching decisions, contactability mapping, previews, events, schemas) |
| Provider adapter + webhook signing | 10 (`communication.test.ts`: registry, HMAC + replay window + tampering, normalisation (batch, status, attachments, location, timestamps), payload errors, config / capabilities, signed idempotent send, safe failure classification) |
| API | 8 (`conversations/route.test.ts`: filters, every action → existing permission, 403, multipart send, DND / channel errors → 422, download headers, meta; public webhook: no session, 404 / 401 / 503 / 413) + 1 events-route test |
| Integration (real Postgres) | 24 |
| Inbox UI | 4 (`inbox-client.test.tsx`) |
| Thread / composer UI | 10 (`conversation-components.test.tsx`) |
| Full suite | 168 files, 2,595 tests passing. `tsc` clean. ESLint: 0 errors (the 12 existing warnings). |
| Databases | Fresh: 163 migrations + seed, Prisma models match the database. Upgrade: a copy of the Phase 10 database. Constraints refuse bad data. Load: 20,000 conversations / 200,000 messages — the thread, full-text and inbox queries use the new indexes in a few milliseconds. |
| Browser e2e | 24 checks (see below). |

**Integration tests cover:**

- channels and secret handling;
- matched inbound with automatic company + opportunity;
- idempotency, including 5 parallel identical deliveries → 1 message;
- signature / replay / payload rejection;
- unmatched queue, visibility and linking;
- MULTIPLE candidates, and learned provider identity after archiving;
- anonymous web chat and default assignee;
- create contact through the duplicate rules;
- task on an unmatched conversation;
- inline / rejected / provider-hosted files and download access;
- signed send, double submit, failure → retry once with the same key (concurrent retries → one);
- DND (channel and all-channels), with notes and tasks still allowed;
- capability checks and a paused channel;
- outbound attachments;
- forward-only receipts;
- thread paging across messages / notes / events;
- unread up to a message;
- full-text and record search;
- assignment history, notifications, reassign visibility and version conflicts;
- close → reopen by inbound;
- relink / unlink and the other-company opportunity refusal;
- contact / company / opportunity timelines, and timeline visibility;
- contact merge;
- the stale-send sweep;
- no events on a rolled-back change.

**Browser e2e** (seeded database, mock relay verifying the CRM's signature):

- channel created in Settings (one-time secret, never listed);
- signed inbound, duplicate and forged deliveries;
- inbox row and counts;
- header context with the auto-linked opportunity;
- read on open;
- reply relayed signed with the idempotency key, then Sent;
- relay failure → Failed with a safe reason → Retry with the same key;
- delivery receipt → Delivered by polling;
- internal note never relayed;
- task from a message (on the opportunity, quoted, linked);
- unmatched → Create contact (pre-filled) → linked;
- DND banner, Reply disabled and API 422;
- message-text search;
- contact page Conversations → inbox;
- opportunity timeline;
- close → reopened by a new message;
- mobile layout;
- no page errors.

**Regression:** the Phase 02–10 test suites all pass unchanged, except the registry test (it now expects the new entity type and alias) and the events-route test (new mock).

## 12. Known limitations (deliberately deferred)

- **No built-in provider integrations:** no Gmail / Outlook, WhatsApp Business API, Messenger / Instagram (Meta), SMS gateway, live-chat widget, OAuth onboarding or provider credential management. The generic signed-webhook adapter is the only provider. Replies need an admin-configured outbound relay URL; without one a channel is receive-only, and the UI says so. Real providers are connected through small external bridges — see the [channel integration guide](integrations/README.md) (WhatsApp Cloud API, Messenger, Instagram, Twilio SMS, Mailgun email, website chat, Telegram, in-house systems), each with a runnable, verified example.
- **Provider-hosted media** (a `mediaId` instead of inline content) is listed but not downloaded. Inline files outside the ERP file policy (e.g. audio / video) are listed as "not stored".
- **No new conversations from the CRM:** you reply in a conversation the customer started. A new outbound conversation needs provider-specific rules such as WhatsApp templates.
- **Delivery receipts that arrive before the send is saved** are reported as `unknown_message` and are not stored.
- **Email threading** uses the thread id the provider sends (`threadId`). Message-ID / In-Reply-To / References are stored in the message metadata for a future email adapter, but they are not used to match threads yet.
- **Reply recipients:** one customer participant per reply. Group threads (email CC) store every sender, but a reply goes to the first customer.
- **Not included:**
  - per-user unread state (unread is team-level);
  - pinning, conversation merging, and message edit / delete — the original messages are always kept;
  - teams / queues and routing / round-robin (the ERP has no teams; a channel default assignee only);
  - per-channel permissions (the ERP has none);
  - realtime push — polling is used instead.
- **Opportunity auto-link** happens only when the contact has exactly one open opportunity.
- **Contactability:** Messenger, Instagram and website chat have no channel-specific consent row; only "All channels" applies to them.
- **Inbox list** shows at most 100 rows at once ("Refine the search to see more"). Full-text search returns up to 500 matching conversations per query.

## 13. Future extension points

- **Email / SMS / WhatsApp / Messenger / Instagram / website chat:** add a `ChannelProvider` in `src/core/communication/providers/` and one line in `provider-registry.ts`. Its capabilities drive the composer; its `verifyWebhook` / `normalizeInbound` reuse the same webhook route (`/webhooks/conversations/<provider>/<channelId>`). Its credentials go into an encrypted per-channel field, like the signing secret. Email threading uses `threadRef` plus the stored Message-ID / In-Reply-To / References metadata. Web chat can use SESSION identities that become contacts later.
- **Automation (Phase 18):** consume `message.received` / `message.sent` / `message.failed` / `message.delivered` / `message.read` and `conversation.*` from `crm_events`; the event id is the idempotency key. Examples: auto-assign, follow-up tasks, close after a period without a reply.
- **Sequences, campaigns:** send through the same `prepareSend` → provider path, so DND and capabilities are enforced in one place.
- **Routing, round-robin, teams:** replace the channel default assignee with a routing strategy behind `ingestInboundMessage`.
- **AI** (reply suggestions, sentiment, scoring): read normalised messages; never touches provider payloads.
- **Conversation merging, outbound-initiated conversations, provider media download, per-user unread:** each fits the existing tables (participants carry identities; attachments carry `provider_media_ref`).

## Post-delivery fix (integration guide work)

While verifying the integration-guide bridges, one CRM bug was found and fixed in `conversation-messaging.service.ts` (`deliver()`): when a relay answered with a provider message id already used by another message on the same channel, the unique-index violation aborted the transaction and the send returned 500, leaving the message stuck in "Sending…". The provider id is now checked first; on a clash the message is still saved as Sent, without the duplicate provider id. Regression test: "keeps the send when a relay returns a provider id already used on the channel" (integration 23 → 24 tests).

## How to try it

1. Run `npx prisma migrate deploy`. Restart `npm run dev` and `npm run worker` (stale-send sweep).
2. Open CRM Settings → Channels → Add channel. Copy the secret.
3. Send a signed test message with the `curl` example shown on screen.
4. Open CRM → Inbox.
