-- CreateEnum
CREATE TYPE "SampleType" AS ENUM ('FIT', 'PROTO', 'PP', 'TOP', 'SHIPMENT', 'PHOTOSHOOT', 'SMS', 'OTHER');

-- CreateEnum
CREATE TYPE "SampleOtherChargeCostHead" AS ENUM ('PROCESS', 'FABRICATION', 'OTHER');

-- AlterTable
ALTER TABLE "sample_materials" ADD COLUMN     "gst_percentage" DECIMAL(5,2),
ADD COLUMN     "rate" DECIMAL(18,4);

-- AlterTable
ALTER TABLE "sample_requests" ADD COLUMN     "sampleType" "SampleType";

-- AlterTable
ALTER TABLE "sample_versions" ADD COLUMN     "commission_percent" DECIMAL(5,2),
ADD COLUMN     "cost_subtotal" DECIMAL(18,2),
ADD COLUMN     "costing_locked_at" TIMESTAMP(3),
ADD COLUMN     "costing_locked_by_user_id" UUID,
ADD COLUMN     "final_total" DECIMAL(18,2),
ADD COLUMN     "freight_amount" DECIMAL(18,2),
ADD COLUMN     "is_costing_locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "margin_percent" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "sample_other_charges" (
    "id" UUID NOT NULL,
    "sample_version_id" UUID NOT NULL,
    "cost_head" "SampleOtherChargeCostHead" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sample_other_charges_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "sample_versions" ADD CONSTRAINT "sample_versions_costing_locked_by_user_id_fkey" FOREIGN KEY ("costing_locked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_other_charges" ADD CONSTRAINT "sample_other_charges_sample_version_id_fkey" FOREIGN KEY ("sample_version_id") REFERENCES "sample_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
