-- CRM Phase 11 — Unified Conversations.
-- One provider-neutral model for every channel: channels → conversations →
-- messages, participants and message attachments. Internal notes reuse
-- crm_notes (entity CONVERSATION); tasks reuse crm_activities; events reuse
-- crm_events; files reuse the shared attachments table.

ALTER TYPE "CrmEntityType" ADD VALUE IF NOT EXISTS 'CONVERSATION';
ALTER TYPE "RelatedModule" ADD VALUE IF NOT EXISTS 'CRM_CONVERSATION';

-- Channels ------------------------------------------------------------------
CREATE TABLE "crm_channels" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'generic',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "address" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_encrypted" TEXT NOT NULL,
    "default_assignee_user_id" UUID,
    "last_inbound_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_channels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_channels_type_check" CHECK ("channel_type" IN ('EMAIL', 'SMS', 'WHATSAPP', 'FACEBOOK_MESSENGER', 'INSTAGRAM', 'WEB_CHAT', 'OTHER')),
    CONSTRAINT "crm_channels_status_check" CHECK ("status" IN ('ACTIVE', 'PAUSED'))
);

CREATE UNIQUE INDEX "crm_channels_company_id_name_key" ON "crm_channels"("company_id", "name");
CREATE INDEX "crm_channels_company_id_status_idx" ON "crm_channels"("company_id", "status");
ALTER TABLE "crm_channels" ADD CONSTRAINT "crm_channels_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_channels" ADD CONSTRAINT "crm_channels_default_assignee_user_id_fkey" FOREIGN KEY ("default_assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_channels" ADD CONSTRAINT "crm_channels_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Conversations ---------------------------------------------------------------
CREATE TABLE "crm_conversations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "channel_type" TEXT NOT NULL,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "match_status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "match_candidate_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "contact_id" UUID,
    "crm_company_id" UUID,
    "opportunity_id" UUID,
    "assigned_to_user_id" UUID,
    "external_thread_ref" TEXT,
    "display_name" TEXT,
    "display_identifier" TEXT,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "last_read_at" TIMESTAMP(3),
    "last_read_by_user_id" UUID,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "last_message_preview" TEXT,
    "last_message_direction" TEXT,
    "last_inbound_at" TIMESTAMP(3),
    "last_outbound_at" TIMESTAMP(3),
    "search_text" TEXT NOT NULL DEFAULT '',
    "closed_at" TIMESTAMP(3),
    "closed_by_user_id" UUID,
    "archived_at" TIMESTAMP(3),
    "created_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_conversations_status_check" CHECK ("status" IN ('OPEN', 'PENDING', 'CLOSED', 'ARCHIVED')),
    CONSTRAINT "crm_conversations_match_status_check" CHECK ("match_status" IN ('MATCHED', 'UNMATCHED', 'MULTIPLE')),
    CONSTRAINT "crm_conversations_unread_check" CHECK ("unread_count" >= 0 AND "message_count" >= 0)
);

CREATE INDEX "crm_conversations_recent_idx" ON "crm_conversations"("company_id", "last_message_at");
CREATE INDEX "crm_conversations_status_idx" ON "crm_conversations"("company_id", "status", "last_message_at");
CREATE INDEX "crm_conversations_assignee_idx" ON "crm_conversations"("company_id", "assigned_to_user_id", "last_message_at");
CREATE INDEX "crm_conversations_channel_idx" ON "crm_conversations"("company_id", "channel_id", "last_message_at");
CREATE INDEX "crm_conversations_contact_idx" ON "crm_conversations"("company_id", "contact_id");
CREATE INDEX "crm_conversations_company_idx" ON "crm_conversations"("company_id", "crm_company_id");
CREATE INDEX "crm_conversations_opportunity_idx" ON "crm_conversations"("company_id", "opportunity_id");
-- SQL-only (partial) indexes: the unmatched queue, unread filter and provider thread lookup.
CREATE INDEX "crm_conversations_unmatched_idx" ON "crm_conversations"("company_id", "last_message_at") WHERE "match_status" <> 'MATCHED' AND "status" <> 'ARCHIVED';
CREATE INDEX "crm_conversations_unread_idx" ON "crm_conversations"("company_id", "last_message_at") WHERE "unread_count" > 0;
CREATE INDEX "crm_conversations_thread_ref_idx" ON "crm_conversations"("channel_id", "external_thread_ref") WHERE "external_thread_ref" IS NOT NULL;

ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "crm_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_crm_company_id_fkey" FOREIGN KEY ("crm_company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Participants ----------------------------------------------------------------
CREATE TABLE "crm_conversation_participants" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "participant_type" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "identifier_kind" TEXT,
    "external_identifier" TEXT,
    "identifier_key" TEXT,
    "display_name" TEXT,
    "contact_id" UUID,
    "user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_conversation_participants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_conversation_participants_type_check" CHECK ("participant_type" IN ('CONTACT', 'EXTERNAL', 'ANONYMOUS', 'USER')),
    CONSTRAINT "crm_conversation_participants_role_check" CHECK ("role" IN ('CUSTOMER', 'AGENT', 'CC')),
    CONSTRAINT "crm_conversation_participants_kind_check" CHECK ("identifier_kind" IS NULL OR "identifier_kind" IN ('EMAIL', 'PHONE', 'PROVIDER_ID', 'SESSION'))
);

CREATE INDEX "crm_conversation_participants_conversation_id_idx" ON "crm_conversation_participants"("conversation_id");
CREATE INDEX "crm_conversation_participants_identity_idx" ON "crm_conversation_participants"("company_id", "channel_id", "identifier_kind", "identifier_key");
CREATE INDEX "crm_conversation_participants_key_idx" ON "crm_conversation_participants"("company_id", "identifier_kind", "identifier_key");
-- One row per identity / per user in a conversation.
CREATE UNIQUE INDEX "crm_conversation_participants_identity_key" ON "crm_conversation_participants"("conversation_id", "identifier_kind", "identifier_key") WHERE "identifier_key" IS NOT NULL;
CREATE UNIQUE INDEX "crm_conversation_participants_user_key" ON "crm_conversation_participants"("conversation_id", "user_id") WHERE "user_id" IS NOT NULL;

ALTER TABLE "crm_conversation_participants" ADD CONSTRAINT "crm_conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "crm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_conversation_participants" ADD CONSTRAINT "crm_conversation_participants_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_conversation_participants" ADD CONSTRAINT "crm_conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Messages ------------------------------------------------------------------
CREATE TABLE "crm_messages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "message_type" TEXT NOT NULL DEFAULT 'TEXT',
    "subject" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "sender_identifier" TEXT,
    "sender_name" TEXT,
    "recipient_identifier" TEXT,
    "sender_user_id" UUID,
    "status" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "seen_at" TIMESTAMP(3),
    "seen_by_user_id" UUID,
    "error_code" TEXT,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_messages_type_check" CHECK ("message_type" IN ('TEXT', 'IMAGE', 'FILE', 'AUDIO', 'VIDEO', 'DOCUMENT', 'LOCATION', 'SYSTEM', 'OTHER')),
    -- Inbound messages are RECEIVED; only outbound messages carry a delivery status.
    CONSTRAINT "crm_messages_direction_status_check" CHECK (
        ("direction" = 'INBOUND' AND "status" = 'RECEIVED')
        OR ("direction" = 'OUTBOUND' AND "status" IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'))
    )
);

CREATE INDEX "crm_messages_thread_idx" ON "crm_messages"("conversation_id", "occurred_at", "id");
CREATE INDEX "crm_messages_recent_idx" ON "crm_messages"("company_id", "occurred_at");
-- Webhook idempotency: a provider message is stored once per channel.
CREATE UNIQUE INDEX "crm_messages_provider_message_key" ON "crm_messages"("channel_id", "provider_message_id") WHERE "provider_message_id" IS NOT NULL;
-- Unread inbound messages per conversation (mark-as-read) and stuck sends (sweeper).
CREATE INDEX "crm_messages_unseen_idx" ON "crm_messages"("conversation_id", "occurred_at") WHERE "direction" = 'INBOUND' AND "seen_at" IS NULL;
CREATE INDEX "crm_messages_queued_idx" ON "crm_messages"("last_attempt_at") WHERE "status" = 'QUEUED';
-- Message search (PostgreSQL full text, no external search engine).
CREATE INDEX "crm_messages_body_fts_idx" ON "crm_messages" USING GIN (to_tsvector('simple', "body"));

ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "crm_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "crm_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Message attachments ---------------------------------------------------------------
CREATE TABLE "crm_message_attachments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "attachment_id" UUID,
    "kind" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "provider_media_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_message_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "crm_message_attachments_kind_check" CHECK ("kind" IN ('IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'FILE'))
);

CREATE INDEX "crm_message_attachments_message_id_idx" ON "crm_message_attachments"("message_id");
CREATE INDEX "crm_message_attachments_attachment_id_idx" ON "crm_message_attachments"("attachment_id");
ALTER TABLE "crm_message_attachments" ADD CONSTRAINT "crm_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "crm_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_message_attachments" ADD CONSTRAINT "crm_message_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
