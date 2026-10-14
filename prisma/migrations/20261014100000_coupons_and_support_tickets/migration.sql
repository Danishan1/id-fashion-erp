-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENT', 'FIXED_AMOUNT', 'FREE_MONTHS', 'TRIAL_EXTENSION');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('GENERAL', 'BUG', 'BILLING', 'ACCOUNT', 'DATA', 'FEATURE_REQUEST');

-- CreateEnum
CREATE TYPE "SupportTicketAuthorType" AS ENUM ('CUSTOMER', 'PLATFORM');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'SUPPORT_TICKET';

-- AlterTable
ALTER TABLE "subscription_payments" ADD COLUMN     "coupon_id" UUID,
ADD COLUMN     "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "free_months" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "list_amount" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" "CouponDiscountType" NOT NULL,
    "discount_value" DECIMAL(18,2) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "max_redemptions" INTEGER,
    "max_redemptions_per_company" INTEGER NOT NULL DEFAULT 1,
    "billing_cycles" "SubscriptionBillingCycle"[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_platform_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_plans" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,

    CONSTRAINT "coupon_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_id" UUID,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "free_months" INTEGER NOT NULL DEFAULT 0,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "redeemed_by_platform_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "SupportTicketCategory" NOT NULL DEFAULT 'GENERAL',
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_user_id" UUID NOT NULL,
    "assigned_to_platform_user_id" UUID,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_by" "SupportTicketAuthorType" NOT NULL DEFAULT 'CUSTOMER',
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_type" "SupportTicketAuthorType" NOT NULL,
    "author_user_id" UUID,
    "author_platform_user_id" UUID,
    "body" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_attachments" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_plans_coupon_id_plan_id_key" ON "coupon_plans"("coupon_id", "plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_payment_id_key" ON "coupon_redemptions"("payment_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_company_id_idx" ON "coupon_redemptions"("coupon_id", "company_id");

-- CreateIndex
CREATE INDEX "support_tickets_status_last_message_at_idx" ON "support_tickets"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "support_tickets_company_id_created_by_user_id_idx" ON "support_tickets"("company_id", "created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_company_id_ticket_number_key" ON "support_tickets"("company_id", "ticket_number");

-- CreateIndex
CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx" ON "support_ticket_messages"("ticket_id", "created_at");

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_platform_user_id_fkey" FOREIGN KEY ("created_by_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_plans" ADD CONSTRAINT "coupon_plans_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_plans" ADD CONSTRAINT "coupon_plans_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "subscription_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_redeemed_by_platform_user_id_fkey" FOREIGN KEY ("redeemed_by_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_platform_user_id_fkey" FOREIGN KEY ("assigned_to_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_author_platform_user_id_fkey" FOREIGN KEY ("author_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Guards (hand-added)
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_discount_value_check" CHECK (
  "discount_value" > 0 AND ("discount_type" <> 'PERCENT' OR "discount_value" <= 100)
);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_limits_check" CHECK (
  ("max_redemptions" IS NULL OR "max_redemptions" >= 1) AND "max_redemptions_per_company" >= 1
);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_validity_check" CHECK (
  "valid_from" IS NULL OR "valid_until" IS NULL OR "valid_until" > "valid_from"
);
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_discount_check" CHECK (
  "discount_amount" >= 0 AND "free_months" >= 0
);
