-- CRM slice 3: additional contacts per lead. (The unrelated, pre-existing
-- `contractors.updated_at DROP DEFAULT` drift from `migrate diff` is excluded.)
CREATE TABLE "crm_lead_contacts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "whatsapp_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_lead_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crm_lead_contacts_company_id_lead_id_idx" ON "crm_lead_contacts"("company_id", "lead_id");

ALTER TABLE "crm_lead_contacts" ADD CONSTRAINT "crm_lead_contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "crm_lead_contacts" ADD CONSTRAINT "crm_lead_contacts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
