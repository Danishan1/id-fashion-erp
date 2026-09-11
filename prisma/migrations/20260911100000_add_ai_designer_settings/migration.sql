-- CreateEnum
CREATE TYPE "AiDesignerAttributeDisplayMode" AS ENUM ('CLIPART', 'TEXT');

-- CreateTable
CREATE TABLE "ai_designer_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_design_display_mode" "AiDesignerAttributeDisplayMode" NOT NULL DEFAULT 'CLIPART',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_designer_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_designer_settings_company_id_key" ON "ai_designer_settings"("company_id");

-- AddForeignKey
ALTER TABLE "ai_designer_settings" ADD CONSTRAINT "ai_designer_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
