-- AlterTable
ALTER TABLE "fabric_widths" DROP COLUMN "unit",
ADD COLUMN     "unit_id" UUID;

-- AddForeignKey
ALTER TABLE "fabric_widths" ADD CONSTRAINT "fabric_widths_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;
