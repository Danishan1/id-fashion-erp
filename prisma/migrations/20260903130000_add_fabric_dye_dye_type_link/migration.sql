-- AlterTable
ALTER TABLE "fabric_dyes" ADD COLUMN     "dye_type_id" UUID;

-- AddForeignKey
ALTER TABLE "fabric_dyes" ADD CONSTRAINT "fabric_dyes_dye_type_id_fkey" FOREIGN KEY ("dye_type_id") REFERENCES "fabric_dye_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
