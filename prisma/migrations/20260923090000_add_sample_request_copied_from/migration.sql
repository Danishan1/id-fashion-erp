-- AlterTable
ALTER TABLE "sample_requests" ADD COLUMN "copied_from_request_id" UUID;

-- AddForeignKey
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_copied_from_request_id_fkey" FOREIGN KEY ("copied_from_request_id") REFERENCES "sample_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
