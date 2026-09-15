-- CreateTable
CREATE TABLE "ai_product_design_attributes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "category_name" TEXT NOT NULL,
    "attribute_key" TEXT NOT NULL,
    "attribute_label" TEXT NOT NULL,
    "options" TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_product_design_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_product_design_attributes_company_id_category_name_attri_key" ON "ai_product_design_attributes"("company_id", "category_name", "attribute_key");

-- AddForeignKey
ALTER TABLE "ai_product_design_attributes" ADD CONSTRAINT "ai_product_design_attributes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_product_design_attributes" ADD CONSTRAINT "ai_product_design_attributes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
