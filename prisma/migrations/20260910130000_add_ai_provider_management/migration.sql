-- CreateEnum
CREATE TYPE "AIProviderType" AS ENUM ('OPENAI', 'GEMINI', 'CLOUDFLARE', 'QWEN_LOCAL');

-- CreateEnum
CREATE TYPE "AIProviderCapability" AS ENUM ('TEXT_TO_IMAGE', 'IMAGE_EDIT', 'FABRIC_REFERENCE');

-- CreateEnum
CREATE TYPE "AIProviderHealthStatus" AS ENUM ('HEALTHY', 'RATE_LIMITED', 'QUOTA_EXHAUSTED', 'UNAVAILABLE', 'AUTH_ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "AIUsageErrorCategory" AS ENUM ('QUOTA_EXHAUSTED', 'RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'AUTH_ERROR', 'INVALID_REQUEST', 'CONTENT_POLICY', 'INTERNAL_ERROR');

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider_type" "AIProviderType" NOT NULL,
    "api_key_encrypted" TEXT,
    "model" TEXT NOT NULL,
    "base_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "auto_failover_enabled" BOOLEAN NOT NULL DEFAULT true,
    "daily_generation_limit" INTEGER,
    "monthly_generation_limit" INTEGER,
    "request_timeout_ms" INTEGER NOT NULL DEFAULT 120000,
    "max_retry_count" INTEGER NOT NULL DEFAULT 1,
    "capabilities" "AIProviderCapability"[],
    "health_status" "AIProviderHealthStatus" NOT NULL DEFAULT 'HEALTHY',
    "cooldown_until" TIMESTAMP(3),
    "last_health_check_at" TIMESTAMP(3),
    "last_error_message" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_usage" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "provider_id" UUID,
    "user_id" UUID,
    "ai_designer_project_id" UUID,
    "generation_type" "AIProviderCapability" NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER,
    "success" BOOLEAN NOT NULL,
    "error_category" "AIUsageErrorCategory",
    "error_message" TEXT,
    "provider_request_id" TEXT,
    "input_image_present" BOOLEAN NOT NULL DEFAULT false,
    "output_count" INTEGER NOT NULL DEFAULT 0,
    "token_usage" INTEGER,
    "estimated_cost" DECIMAL(10,4),

    CONSTRAINT "ai_provider_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_failover_logs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "requested_provider_id" UUID,
    "fallback_provider_id" UUID,
    "reason" "AIUsageErrorCategory" NOT NULL,
    "generation_context" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_failover_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_company_id_name_key" ON "ai_providers"("company_id", "name");

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_usage" ADD CONSTRAINT "ai_provider_usage_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_usage" ADD CONSTRAINT "ai_provider_usage_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_usage" ADD CONSTRAINT "ai_provider_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_provider_usage" ADD CONSTRAINT "ai_provider_usage_ai_designer_project_id_fkey" FOREIGN KEY ("ai_designer_project_id") REFERENCES "ai_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_failover_logs" ADD CONSTRAINT "ai_failover_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_failover_logs" ADD CONSTRAINT "ai_failover_logs_requested_provider_id_fkey" FOREIGN KEY ("requested_provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_failover_logs" ADD CONSTRAINT "ai_failover_logs_fallback_provider_id_fkey" FOREIGN KEY ("fallback_provider_id") REFERENCES "ai_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
