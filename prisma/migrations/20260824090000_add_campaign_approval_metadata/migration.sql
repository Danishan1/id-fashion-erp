-- AlterTable
ALTER TABLE "mkt_campaigns" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" UUID,
ADD COLUMN     "rejection_reason" TEXT;

-- AddForeignKey
ALTER TABLE "mkt_campaigns" ADD CONSTRAINT "mkt_campaigns_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
