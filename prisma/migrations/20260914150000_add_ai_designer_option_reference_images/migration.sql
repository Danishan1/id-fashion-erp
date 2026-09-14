-- CreateTable
CREATE TABLE "ai_designer_option_reference_images" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "option_value" TEXT NOT NULL,
    "attachment_id" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_designer_option_reference_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_designer_option_reference_images_company_id_option_value_key" ON "ai_designer_option_reference_images"("company_id", "option_value");

-- AddForeignKey
ALTER TABLE "ai_designer_option_reference_images" ADD CONSTRAINT "ai_designer_option_reference_images_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_designer_option_reference_images" ADD CONSTRAINT "ai_designer_option_reference_images_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

