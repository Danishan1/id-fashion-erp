-- Platform SaaS Phase 3 (PLAT-016, PLAT-018): company suspension details and
-- per-company module entitlements. Purely additive.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "suspended_at" TIMESTAMP(3),
ADD COLUMN     "suspended_by_platform_user_id" UUID,
ADD COLUMN     "suspension_reason" TEXT;

-- CreateTable
CREATE TABLE "company_module_entitlements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "package_key" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "changed_by_platform_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_module_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_module_entitlements_company_id_package_key_key" ON "company_module_entitlements"("company_id", "package_key");

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_suspended_by_platform_user_id_fkey" FOREIGN KEY ("suspended_by_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_module_entitlements" ADD CONSTRAINT "company_module_entitlements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_module_entitlements" ADD CONSTRAINT "company_module_entitlements_changed_by_platform_user_id_fkey" FOREIGN KEY ("changed_by_platform_user_id") REFERENCES "platform_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

