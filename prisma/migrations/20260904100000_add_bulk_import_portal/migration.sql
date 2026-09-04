-- Super Admin -> Bulk Master Data Import portal (2026-09-04).

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'IMPORT_BATCH';

-- AlterEnum
ALTER TYPE "ImportBatchType" ADD VALUE 'CUSTOMER';
ALTER TYPE "ImportBatchType" ADD VALUE 'SUPPLIER';
ALTER TYPE "ImportBatchType" ADD VALUE 'PRODUCT';
ALTER TYPE "ImportBatchType" ADD VALUE 'PRODUCT_VARIANT';
ALTER TYPE "ImportBatchType" ADD VALUE 'OPENING_STOCK';
ALTER TYPE "ImportBatchType" ADD VALUE 'CHART_OF_ACCOUNT';

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PENDING', 'VALIDATING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNDONE');

-- AlterTable
ALTER TABLE "import_batches"
  ADD COLUMN "status" "ImportBatchStatus" NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN "original_file_key" TEXT,
  ADD COLUMN "job_id" TEXT;

-- CreateTable
CREATE TABLE "import_batch_records" (
    "id" UUID NOT NULL,
    "import_batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batch_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batch_records_import_batch_id_idx" ON "import_batch_records"("import_batch_id");

-- AddForeignKey
ALTER TABLE "import_batch_records" ADD CONSTRAINT "import_batch_records_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "customers"
  ADD COLUMN "tax_registration_no" TEXT,
  ADD COLUMN "billing_address" TEXT,
  ADD COLUMN "shipping_address" TEXT;
