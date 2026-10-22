-- Raw-material Transfer send/receive: Send posts the source side only
-- (IN_TRANSIT); Receive posts the destination side at a chosen location
-- (RECEIVED). Existing movements are already fully posted -> POSTED.

-- CreateEnum
CREATE TYPE "StockMovementStatus" AS ENUM ('POSTED', 'IN_TRANSIT', 'RECEIVED');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "received_at" TIMESTAMP(3),
ADD COLUMN     "received_by_user_id" UUID,
ADD COLUMN     "status" "StockMovementStatus" NOT NULL DEFAULT 'POSTED';

-- CreateIndex
CREATE INDEX "stock_movements_company_id_status_idx" ON "stock_movements"("company_id", "status");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
