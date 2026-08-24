-- CreateTable
CREATE TABLE "crm_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "hot_threshold" DECIMAL(5,2) NOT NULL DEFAULT 80,
    "warm_threshold" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_settings_company_id_key" ON "crm_settings"("company_id");

-- AddForeignKey
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_settings" ADD CONSTRAINT "crm_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
