-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('STYLE', 'RAW_MATERIAL');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "default_supplier_id" UUID,
ADD COLUMN     "item_type" "ItemType" NOT NULL DEFAULT 'STYLE',
ADD COLUMN     "material_category" "SupplierCategory",
ADD COLUMN     "reorder_level" DECIMAL(18,4),
ADD COLUMN     "unit_cost" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "production_stages" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "parent_stage_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lines" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "department_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity_per_day" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agents" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_person" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "commission_percent" DECIMAL(5,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_stages_company_id_code_key" ON "production_stages"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "production_lines_company_id_code_key" ON "production_lines"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_agents_company_id_code_key" ON "sales_agents"("company_id", "code");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_default_supplier_id_fkey" FOREIGN KEY ("default_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_stages" ADD CONSTRAINT "production_stages_parent_stage_id_fkey" FOREIGN KEY ("parent_stage_id") REFERENCES "production_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_agents" ADD CONSTRAINT "sales_agents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
