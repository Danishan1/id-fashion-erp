-- AlterTable
ALTER TABLE "sample_materials" ADD COLUMN     "dye_id" UUID;

-- AddForeignKey
ALTER TABLE "sample_materials" ADD CONSTRAINT "sample_materials_dye_id_fkey" FOREIGN KEY ("dye_id") REFERENCES "fabric_dyes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
