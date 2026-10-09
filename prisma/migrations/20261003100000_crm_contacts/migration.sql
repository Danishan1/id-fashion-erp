-- CRM Phase 04 — Contacts. Additive only; existing Phase 02 contacts are
-- back-filled (name key, search text, source lead, last activity).

-- AlterEnum (the new value is not used inside this migration)
ALTER TYPE "RelatedModule" ADD VALUE 'CRM_CONTACT';

-- CreateEnum
CREATE TYPE "CrmAddressType" AS ENUM ('BILLING', 'SHIPPING', 'OFFICE', 'HOME', 'FACTORY', 'OTHER');
CREATE TYPE "CrmContactabilityStatus" AS ENUM ('ALLOWED', 'DO_NOT_CONTACT', 'UNSUBSCRIBED', 'BOUNCED');

-- AlterTable
ALTER TABLE "crm_contacts" ADD COLUMN "middle_name" TEXT,
ADD COLUMN "name_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN "department" TEXT,
ADD COLUMN "relationship_role" TEXT,
ADD COLUMN "alternate_email" TEXT,
ADD COLUMN "search_text" TEXT NOT NULL DEFAULT '',
ADD COLUMN "source_id" UUID,
ADD COLUMN "source_lead_id" UUID,
ADD COLUMN "last_activity_at" TIMESTAMP(3),
ADD COLUMN "duplicate_flagged_at" TIMESTAMP(3),
ADD COLUMN "flagged_duplicate_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN "merged_into_id" UUID,
ADD COLUMN "merged_at" TIMESTAMP(3),
ADD COLUMN "merged_by_user_id" UUID,
ADD COLUMN "archived_by_user_id" UUID,
ADD COLUMN "updated_by_user_id" UUID,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "crm_settings" ADD COLUMN "contact_duplicate_rules" JSONB;

-- CreateTable
CREATE TABLE "crm_addresses" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contact_id" UUID,
    "crm_company_id" UUID,
    "address_type" "CrmAddressType" NOT NULL DEFAULT 'OFFICE',
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_addresses_pkey" PRIMARY KEY ("id"),
    -- An address belongs to exactly one CRM record.
    CONSTRAINT "crm_addresses_single_owner_check" CHECK (num_nonnulls("contact_id", "crm_company_id") = 1)
);

CREATE TABLE "crm_contact_channels" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "channel_type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "value_key" TEXT NOT NULL,
    "label" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contact_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_contact_consents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "CrmContactabilityStatus" NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_user_id" UUID,

    CONSTRAINT "crm_contact_consents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_contact_merges" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "survivor_id" UUID NOT NULL,
    "merged_id" UUID NOT NULL,
    "field_choices" JSONB NOT NULL DEFAULT '{}',
    "merged_snapshot" JSONB NOT NULL,
    "moved" JSONB NOT NULL DEFAULT '{}',
    "merged_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_contact_merges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_option_values" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "list_key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "value_key" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_option_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_contacts_company_id_archived_at_created_at_idx" ON "crm_contacts"("company_id", "archived_at", "created_at");
CREATE INDEX "crm_contacts_company_id_owner_user_id_idx" ON "crm_contacts"("company_id", "owner_user_id");
CREATE INDEX "crm_contacts_company_id_name_key_idx" ON "crm_contacts"("company_id", "name_key");
CREATE INDEX "crm_contacts_company_id_last_activity_at_idx" ON "crm_contacts"("company_id", "last_activity_at");
CREATE INDEX "crm_contacts_merged_into_id_idx" ON "crm_contacts"("merged_into_id");
CREATE INDEX "crm_addresses_contact_id_idx" ON "crm_addresses"("contact_id");
CREATE INDEX "crm_addresses_crm_company_id_idx" ON "crm_addresses"("crm_company_id");
CREATE UNIQUE INDEX "crm_contact_channels_contact_id_channel_type_value_key_key" ON "crm_contact_channels"("contact_id", "channel_type", "value_key");
CREATE UNIQUE INDEX "crm_contact_consents_contact_id_channel_key" ON "crm_contact_consents"("contact_id", "channel");
CREATE INDEX "crm_contact_consents_company_id_channel_status_idx" ON "crm_contact_consents"("company_id", "channel", "status");
CREATE UNIQUE INDEX "crm_contact_merges_merged_id_key" ON "crm_contact_merges"("merged_id");
CREATE INDEX "crm_contact_merges_company_id_survivor_id_idx" ON "crm_contact_merges"("company_id", "survivor_id");
CREATE UNIQUE INDEX "crm_option_values_company_id_list_key_value_key_key" ON "crm_option_values"("company_id", "list_key", "value_key");
CREATE INDEX "crm_option_values_company_id_list_key_sort_order_idx" ON "crm_option_values"("company_id", "list_key", "sort_order");

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "crm_lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_source_lead_id_fkey" FOREIGN KEY ("source_lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_addresses" ADD CONSTRAINT "crm_addresses_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_addresses" ADD CONSTRAINT "crm_addresses_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_addresses" ADD CONSTRAINT "crm_addresses_crm_company_id_fkey" FOREIGN KEY ("crm_company_id") REFERENCES "crm_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contact_channels" ADD CONSTRAINT "crm_contact_channels_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_contact_channels" ADD CONSTRAINT "crm_contact_channels_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contact_consents" ADD CONSTRAINT "crm_contact_consents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_contact_consents" ADD CONSTRAINT "crm_contact_consents_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_contact_merges" ADD CONSTRAINT "crm_contact_merges_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_contact_merges" ADD CONSTRAINT "crm_contact_merges_survivor_id_fkey" FOREIGN KEY ("survivor_id") REFERENCES "crm_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_contact_merges" ADD CONSTRAINT "crm_contact_merges_merged_id_fkey" FOREIGN KEY ("merged_id") REFERENCES "crm_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_option_values" ADD CONSTRAINT "crm_option_values_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Back-fill Phase 02 contacts.
UPDATE "crm_contacts" c SET
  "name_key" = lower(regexp_replace(btrim(c."full_name"), '\s+', ' ', 'g')),
  "search_text" = lower(concat_ws(' ', c."full_name", c."designation", c."email", c."phone", c."mobile", c."whatsapp",
                                  (SELECT co."name" FROM "crm_companies" co WHERE co."id" = c."crm_company_id"))),
  "last_activity_at" = COALESCE((SELECT max(e."occurred_at") FROM "crm_events" e WHERE e."entity_type" = 'CONTACT' AND e."entity_id" = c."id"), c."updated_at");

-- The lead each existing contact was converted from (earliest), and its source.
UPDATE "crm_contacts" c SET "source_lead_id" = l."id", "source_id" = l."source_id"
FROM (
  SELECT DISTINCT ON ("crm_contact_id") "crm_contact_id", "id", "source_id"
  FROM "crm_leads"
  WHERE "crm_contact_id" IS NOT NULL AND "converted_at" IS NOT NULL
  ORDER BY "crm_contact_id", "converted_at" ASC
) l
WHERE l."crm_contact_id" = c."id";
