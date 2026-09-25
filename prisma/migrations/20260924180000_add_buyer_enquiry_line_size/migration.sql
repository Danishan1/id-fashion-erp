-- AlterTable
ALTER TABLE "buyer_enquiry_lines" ADD COLUMN     "size_id" UUID;

-- AddForeignKey
ALTER TABLE "buyer_enquiry_lines" ADD CONSTRAINT "buyer_enquiry_lines_size_id_fkey" FOREIGN KEY ("size_id") REFERENCES "sizes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

