-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('META_ADS', 'GOOGLE_ADS', 'LINKEDIN', 'YOUTUBE', 'EMAIL', 'WHATSAPP', 'SEO', 'ORGANIC', 'REFERRAL', 'OFFLINE');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CampaignApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CampaignAlertType" AS ENUM ('BUDGET_OVERSPEND', 'BUDGET_80_PERCENT', 'LOW_ROAS', 'ROAS_WATCH', 'HIGH_CPL', 'LOW_CONVERSION');

-- CreateEnum
CREATE TYPE "CampaignAlertPriority" AS ENUM ('MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "CampaignAlertStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CAMPAIGN';

-- AlterTable
ALTER TABLE "crm_leads" ADD COLUMN     "campaign_id" UUID;

-- CreateTable
CREATE TABLE "mkt_campaigns" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "campaign_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "channel" "CampaignChannel" NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "budget" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "owner_user_id" UUID,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "approval_status" "CampaignApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mkt_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_campaign_daily_metrics" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "metric_date" DATE NOT NULL,
    "spend" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_campaign_daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_campaign_attributions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID,
    "lead_id" UUID,
    "prospect_name" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "content" TEXT,
    "term" TEXT,
    "utm_campaign" TEXT,
    "landing_page" TEXT,
    "is_first_touch" BOOLEAN NOT NULL DEFAULT false,
    "is_last_touch" BOOLEAN NOT NULL DEFAULT false,
    "attributed_revenue" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_campaign_attributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mkt_campaign_alerts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "campaign_id" UUID,
    "alert_type" "CampaignAlertType" NOT NULL,
    "priority" "CampaignAlertPriority" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metric_value" DECIMAL(15,4),
    "threshold_value" DECIMAL(15,4),
    "status" "CampaignAlertStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mkt_campaign_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mkt_campaigns_company_id_status_idx" ON "mkt_campaigns"("company_id", "status");

-- CreateIndex
CREATE INDEX "mkt_campaigns_company_id_channel_idx" ON "mkt_campaigns"("company_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_campaigns_company_id_campaign_number_key" ON "mkt_campaigns"("company_id", "campaign_number");

-- CreateIndex
CREATE UNIQUE INDEX "mkt_campaign_daily_metrics_campaign_id_metric_date_key" ON "mkt_campaign_daily_metrics"("campaign_id", "metric_date");

-- CreateIndex
CREATE INDEX "mkt_campaign_attributions_company_id_campaign_id_idx" ON "mkt_campaign_attributions"("company_id", "campaign_id");

-- CreateIndex
CREATE INDEX "mkt_campaign_attributions_company_id_lead_id_idx" ON "mkt_campaign_attributions"("company_id", "lead_id");

-- CreateIndex
CREATE INDEX "mkt_campaign_alerts_company_id_status_idx" ON "mkt_campaign_alerts"("company_id", "status");

-- CreateIndex
CREATE INDEX "mkt_campaign_alerts_company_id_campaign_id_idx" ON "mkt_campaign_alerts"("company_id", "campaign_id");

-- CreateIndex
CREATE INDEX "crm_leads_company_id_campaign_id_idx" ON "crm_leads"("company_id", "campaign_id");

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "mkt_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaigns" ADD CONSTRAINT "mkt_campaigns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaigns" ADD CONSTRAINT "mkt_campaigns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaigns" ADD CONSTRAINT "mkt_campaigns_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaigns" ADD CONSTRAINT "mkt_campaigns_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaign_daily_metrics" ADD CONSTRAINT "mkt_campaign_daily_metrics_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "mkt_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaign_daily_metrics" ADD CONSTRAINT "mkt_campaign_daily_metrics_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaign_attributions" ADD CONSTRAINT "mkt_campaign_attributions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaign_attributions" ADD CONSTRAINT "mkt_campaign_attributions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "mkt_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaign_attributions" ADD CONSTRAINT "mkt_campaign_attributions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaign_alerts" ADD CONSTRAINT "mkt_campaign_alerts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mkt_campaign_alerts" ADD CONSTRAINT "mkt_campaign_alerts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "mkt_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

