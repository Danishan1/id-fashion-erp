-- CreateEnum
CREATE TYPE "SubscriptionBillingCycle" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('BANK_TRANSFER', 'CHEQUE', 'UPI', 'CASH', 'CARD', 'OTHER');

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthly_price" DECIMAL(18,2),
    "annual_price" DECIMAL(18,2),
    "currency_code" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "trial_days" INTEGER NOT NULL DEFAULT 14,
    "max_users" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default_trial_plan" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan_modules" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "package_key" TEXT NOT NULL,

    CONSTRAINT "subscription_plan_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_subscriptions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "billing_cycle" "SubscriptionBillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_ends_at" TIMESTAMP(3),
    "last_notified_key" TEXT,
    "updated_by_platform_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "billing_cycle" "SubscriptionBillingCycle" NOT NULL,
    "periods" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" VARCHAR(3) NOT NULL,
    "paid_at" DATE NOT NULL,
    "method" "SubscriptionPaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "recorded_by_platform_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_code_key" ON "subscription_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_modules_plan_id_package_key_key" ON "subscription_plan_modules"("plan_id", "package_key");

-- CreateIndex
CREATE UNIQUE INDEX "company_subscriptions_company_id_key" ON "company_subscriptions"("company_id");

-- CreateIndex
CREATE INDEX "subscription_payments_company_id_paid_at_idx" ON "subscription_payments"("company_id", "paid_at");

-- AddForeignKey
ALTER TABLE "subscription_plan_modules" ADD CONSTRAINT "subscription_plan_modules_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_subscriptions" ADD CONSTRAINT "company_subscriptions_updated_by_platform_user_id_fkey" FOREIGN KEY ("updated_by_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "company_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_recorded_by_platform_user_id_fkey" FOREIGN KEY ("recorded_by_platform_user_id") REFERENCES "platform_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Guards (hand-added)
CREATE UNIQUE INDEX "subscription_plans_one_default_trial" ON "subscription_plans" ("is_default_trial_plan") WHERE "is_default_trial_plan";
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_trial_days_check" CHECK ("trial_days" >= 0);
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_max_users_check" CHECK ("max_users" IS NULL OR "max_users" >= 1);
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_prices_check" CHECK (("monthly_price" IS NULL OR "monthly_price" >= 0) AND ("annual_price" IS NULL OR "annual_price" >= 0));
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_periods_check" CHECK ("periods" >= 1);
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_period_check" CHECK ("period_end" > "period_start");

-- Backfill: a default "Standard" plan with every module package, used as the
-- trial plan for new companies. Every company that already exists gets an
-- active, non-trial subscription on it with NO expiry, so nothing changes for
-- current customers until a platform admin sets a renewal date.
INSERT INTO "subscription_plans" ("id", "code", "name", "description", "trial_days", "is_default_trial_plan", "updated_at")
VALUES (gen_random_uuid(), 'STANDARD', 'Standard', 'All modules. Created automatically by the Phase 4 migration.', 14, true, CURRENT_TIMESTAMP);

INSERT INTO "subscription_plan_modules" ("id", "plan_id", "package_key")
SELECT gen_random_uuid(), p."id", k.key
FROM "subscription_plans" p
CROSS JOIN (VALUES ('SAMPLING'), ('PRODUCTION'), ('PURCHASING'), ('INVENTORY'), ('DISPATCH'), ('ACCOUNTS'), ('CRM'), ('MARKETING'), ('HRMS'), ('BARCODES'), ('AI_GARMENT_FLOW'), ('AI_DESIGNER'), ('REPORTS')) AS k(key)
WHERE p."code" = 'STANDARD';

INSERT INTO "company_subscriptions" ("id", "company_id", "plan_id", "billing_cycle", "is_trial", "started_at", "current_period_ends_at", "updated_at")
SELECT gen_random_uuid(), c."id", p."id", 'MONTHLY', false, CURRENT_TIMESTAMP, NULL, CURRENT_TIMESTAMP
FROM "companies" c
CROSS JOIN "subscription_plans" p
WHERE p."code" = 'STANDARD';
