-- CreateEnum
CREATE TYPE "ImportBatchType" AS ENUM ('LEAD', 'DEAL', 'CAMPAIGN_DAILY_METRIC');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "import_type" "ImportBatchType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "skipped_count" INTEGER NOT NULL,
    "failed_rows_json" JSONB,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_company_id_import_type_idx" ON "import_batches"("company_id", "import_type");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
