-- AlterEnum
ALTER TYPE "MaterialRequestType" ADD VALUE 'SAMPLING_REQUIREMENT';

-- AlterTable
ALTER TABLE "material_requests" ADD COLUMN     "sample_version_id" UUID;

-- CreateIndex
CREATE INDEX "material_requests_sample_version_id_idx" ON "material_requests"("sample_version_id");

-- AddForeignKey
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_sample_version_id_fkey" FOREIGN KEY ("sample_version_id") REFERENCES "sample_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
