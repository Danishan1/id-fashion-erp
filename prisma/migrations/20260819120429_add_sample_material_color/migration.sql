-- AlterTable
ALTER TABLE "sample_materials" ADD COLUMN     "color_id" UUID;

-- AddForeignKey
ALTER TABLE "sample_materials" ADD CONSTRAINT "sample_materials_color_id_fkey" FOREIGN KEY ("color_id") REFERENCES "colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
