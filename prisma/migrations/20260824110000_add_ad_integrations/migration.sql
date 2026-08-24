-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('META', 'GOOGLE');

-- CreateEnum
CREATE TYPE "AdConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "ad_account_connections" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "status" "AdConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "last_synced_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "connected_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_account_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_campaign_links" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "external_campaign_id" TEXT NOT NULL,
    "external_campaign_name" TEXT NOT NULL,
    "local_campaign_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ad_campaign_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_account_connections_company_id_platform_idx" ON "ad_account_connections"("company_id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "ad_account_connections_company_id_platform_external_account_key" ON "ad_account_connections"("company_id", "platform", "external_account_id");

-- CreateIndex
CREATE INDEX "ad_campaign_links_local_campaign_id_idx" ON "ad_campaign_links"("local_campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "ad_campaign_links_connection_id_external_campaign_id_key" ON "ad_campaign_links"("connection_id", "external_campaign_id");

-- AddForeignKey
ALTER TABLE "ad_account_connections" ADD CONSTRAINT "ad_account_connections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_account_connections" ADD CONSTRAINT "ad_account_connections_connected_by_user_id_fkey" FOREIGN KEY ("connected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign_links" ADD CONSTRAINT "ad_campaign_links_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "ad_account_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_campaign_links" ADD CONSTRAINT "ad_campaign_links_local_campaign_id_fkey" FOREIGN KEY ("local_campaign_id") REFERENCES "mkt_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
