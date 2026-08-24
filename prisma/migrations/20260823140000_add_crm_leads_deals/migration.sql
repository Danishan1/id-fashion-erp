-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('NORMAL', 'WARM', 'HOT');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "CrmInteractionType" AS ENUM ('CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'NOTE');

-- CreateEnum
CREATE TYPE "CrmFollowupStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'LEAD';
ALTER TYPE "DocumentType" ADD VALUE 'DEAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RelatedModule" ADD VALUE 'LEAD';
ALTER TYPE "RelatedModule" ADD VALUE 'DEAL';

-- AlterTable
ALTER TABLE "sales_orders" ADD COLUMN     "originating_deal_id" UUID;

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "lead_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company_name" TEXT,
    "source" "EnquirySource" NOT NULL DEFAULT 'OTHER',
    "campaign_text" TEXT,
    "lead_score" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "value" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "expected_close_date" DATE,
    "assigned_to_user_id" UUID,
    "buyer_enquiry_id" UUID,
    "last_activity_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "deal_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lead_id" UUID,
    "customer_id" UUID,
    "stage" "DealStage" NOT NULL DEFAULT 'QUALIFIED',
    "value" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "probability_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "assigned_to_user_id" UUID,
    "sales_agent_id" UUID,
    "expected_close_date" DATE,
    "lost_reason" TEXT,
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "related_module" "RelatedModule" NOT NULL,
    "related_record_id" UUID NOT NULL,
    "activity_type" "CrmInteractionType" NOT NULL,
    "subject" TEXT,
    "body" TEXT,
    "activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performed_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_followups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "related_module" "RelatedModule" NOT NULL,
    "related_record_id" UUID NOT NULL,
    "assigned_to_user_id" UUID,
    "followup_date" TIMESTAMP(3) NOT NULL,
    "type" "CrmInteractionType" NOT NULL DEFAULT 'CALL',
    "status" "CrmFollowupStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_followups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_round_robin_state" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "last_assigned_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_round_robin_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_buyer_enquiry_id_key" ON "crm_leads"("buyer_enquiry_id");

-- CreateIndex
CREATE INDEX "crm_leads_company_id_status_idx" ON "crm_leads"("company_id", "status");

-- CreateIndex
CREATE INDEX "crm_leads_company_id_assigned_to_user_id_idx" ON "crm_leads"("company_id", "assigned_to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_company_id_lead_number_key" ON "crm_leads"("company_id", "lead_number");

-- CreateIndex
CREATE INDEX "crm_deals_company_id_stage_idx" ON "crm_deals"("company_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deals_company_id_deal_number_key" ON "crm_deals"("company_id", "deal_number");

-- CreateIndex
CREATE INDEX "crm_activities_company_id_related_module_related_record_id_idx" ON "crm_activities"("company_id", "related_module", "related_record_id");

-- CreateIndex
CREATE INDEX "crm_followups_company_id_related_module_related_record_id_idx" ON "crm_followups"("company_id", "related_module", "related_record_id");

-- CreateIndex
CREATE INDEX "crm_followups_company_id_status_followup_date_idx" ON "crm_followups"("company_id", "status", "followup_date");

-- CreateIndex
CREATE UNIQUE INDEX "crm_round_robin_state_company_id_key" ON "crm_round_robin_state"("company_id");

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_buyer_enquiry_id_fkey" FOREIGN KEY ("buyer_enquiry_id") REFERENCES "buyer_enquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_sales_agent_id_fkey" FOREIGN KEY ("sales_agent_id") REFERENCES "sales_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_followups" ADD CONSTRAINT "crm_followups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_followups" ADD CONSTRAINT "crm_followups_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_followups" ADD CONSTRAINT "crm_followups_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_round_robin_state" ADD CONSTRAINT "crm_round_robin_state_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_originating_deal_id_fkey" FOREIGN KEY ("originating_deal_id") REFERENCES "crm_deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

