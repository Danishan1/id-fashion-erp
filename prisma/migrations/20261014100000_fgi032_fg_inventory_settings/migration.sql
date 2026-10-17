-- CreateTable
CREATE TABLE "fg_inventory_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "adjustment_approval_required" BOOLEAN NOT NULL DEFAULT false,
    "adjustment_approval_threshold_qty" INTEGER,
    "adjustment_approval_threshold_percent" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fg_inventory_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fg_inventory_settings_company_id_key" ON "fg_inventory_settings"("company_id");

-- AddForeignKey
ALTER TABLE "fg_inventory_settings" ADD CONSTRAINT "fg_inventory_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

