-- Sales & Marketing Release 1 / S1 — Sales Enquiries (2026-10-28).
-- Decision D1: the Sales Enquiry is the existing Buyer Enquiry. This adds the
-- sales-side fields to buyer_enquiries and an activity timeline table. All new
-- columns are nullable or defaulted; existing enquiries start at stage NEW,
-- priority NORMAL, no owner. Merchandising's `status` and line workflow are untouched.
-- Rollback: prisma/rollback/20261028260000_sales_enquiries_s1.down.sql

-- CreateEnum
CREATE TYPE "SalesEnquiryStage" AS ENUM ('NEW', 'UNDER_REVIEW', 'QUALIFIED', 'QUOTATION_IN_PROGRESS', 'QUOTED', 'WON', 'LOST', 'NOT_QUALIFIED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "SalesEnquiryPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SalesEnquiryActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'MEETING', 'STAGE_CHANGED', 'OWNER_CHANGED', 'FOLLOW_UP_CHANGED', 'DETAILS_UPDATED', 'OPPORTUNITY_LINKED', 'OPPORTUNITY_UNLINKED');

-- AlterTable
ALTER TABLE "buyer_enquiries"
    ADD COLUMN "subject" TEXT,
    ADD COLUMN "sales_stage" "SalesEnquiryStage" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "stage_before_hold" "SalesEnquiryStage",
    ADD COLUMN "stage_changed_at" TIMESTAMP(3),
    ADD COLUMN "priority" "SalesEnquiryPriority" NOT NULL DEFAULT 'NORMAL',
    ADD COLUMN "owner_user_id" UUID,
    ADD COLUMN "next_follow_up_date" DATE,
    ADD COLUMN "crm_company_id" UUID,
    ADD COLUMN "crm_contact_id" UUID,
    ADD COLUMN "estimated_value" DECIMAL(15,2),
    ADD COLUMN "expected_decision_date" DATE,
    ADD COLUMN "next_action" TEXT,
    ADD COLUMN "qualification_notes" TEXT,
    ADD COLUMN "closure_reason" TEXT,
    ADD COLUMN "closed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "buyer_enquiry_activities" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "buyer_enquiry_id" UUID NOT NULL,
    "type" "SalesEnquiryActivityType" NOT NULL,
    "body" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_enquiry_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buyer_enquiries_company_id_sales_stage_idx" ON "buyer_enquiries"("company_id", "sales_stage");

-- CreateIndex
CREATE INDEX "buyer_enquiries_company_id_owner_user_id_idx" ON "buyer_enquiries"("company_id", "owner_user_id");

-- CreateIndex
CREATE INDEX "buyer_enquiries_company_id_next_follow_up_date_idx" ON "buyer_enquiries"("company_id", "next_follow_up_date");

-- CreateIndex
CREATE INDEX "buyer_enquiry_activities_buyer_enquiry_id_occurred_at_idx" ON "buyer_enquiry_activities"("buyer_enquiry_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_crm_company_id_fkey" FOREIGN KEY ("crm_company_id") REFERENCES "crm_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_crm_contact_id_fkey" FOREIGN KEY ("crm_contact_id") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiry_activities" ADD CONSTRAINT "buyer_enquiry_activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiry_activities" ADD CONSTRAINT "buyer_enquiry_activities_buyer_enquiry_id_fkey" FOREIGN KEY ("buyer_enquiry_id") REFERENCES "buyer_enquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiry_activities" ADD CONSTRAINT "buyer_enquiry_activities_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
