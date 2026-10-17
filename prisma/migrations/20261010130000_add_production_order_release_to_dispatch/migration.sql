-- Release to Dispatch gate (Phase D-continuation, Dispatch/Production/
-- Forwarder/Barcode initiative, 2026-10-10).
--
-- Hand-authored from `prisma migrate diff`'s raw output, with the same
-- pre-existing, unrelated drift line deliberately excluded as in the prior
-- migration in this initiative:
--   ALTER TABLE "sample_requests" DROP COLUMN "color";
-- (a column that exists in the live dev DB but was never added to
-- schema.prisma — already documented in CLAUDE.md; unrelated to this change,
-- and dropping it would violate this initiative's own "no dropping existing
-- business columns" rule).

-- AlterTable
ALTER TABLE "production_orders" ADD COLUMN     "released_to_dispatch_at" TIMESTAMP(3),
ADD COLUMN     "released_to_dispatch_by_user_id" UUID;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_released_to_dispatch_by_user_id_fkey" FOREIGN KEY ("released_to_dispatch_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
