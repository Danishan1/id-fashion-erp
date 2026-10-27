-- Payment Request payouts + supplier advance flag (2026-10-27). Additive only.
-- The unrelated sample_requests.color drift line from migrate diff is deliberately left out (see CLAUDE.md).

ALTER TABLE "payments" ADD COLUMN     "is_advance" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "payment_request_payouts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "payment_request_id" UUID NOT NULL,
    "payment_date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "payment_type_id" UUID NOT NULL,
    "bank_account_id" UUID,
    "reference_number" TEXT,
    "notes" TEXT,
    "journal_id" UUID NOT NULL,
    "payment_id" UUID,
    "internal_transfer_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_request_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_request_payouts_journal_id_key" ON "payment_request_payouts"("journal_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_request_payouts_payment_id_key" ON "payment_request_payouts"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_request_payouts_internal_transfer_id_key" ON "payment_request_payouts"("internal_transfer_id");

-- CreateIndex
CREATE INDEX "payment_request_payouts_payment_request_id_idx" ON "payment_request_payouts"("payment_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_request_payouts_company_id_idempotency_key_key" ON "payment_request_payouts"("company_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "payment_request_payouts" ADD CONSTRAINT "payment_request_payouts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_payouts" ADD CONSTRAINT "payment_request_payouts_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_payouts" ADD CONSTRAINT "payment_request_payouts_payment_type_id_fkey" FOREIGN KEY ("payment_type_id") REFERENCES "payment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_payouts" ADD CONSTRAINT "payment_request_payouts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_payouts" ADD CONSTRAINT "payment_request_payouts_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_payouts" ADD CONSTRAINT "payment_request_payouts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_payouts" ADD CONSTRAINT "payment_request_payouts_internal_transfer_id_fkey" FOREIGN KEY ("internal_transfer_id") REFERENCES "internal_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_payouts" ADD CONSTRAINT "payment_request_payouts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-added check
ALTER TABLE "payment_request_payouts" ADD CONSTRAINT "payment_request_payouts_amount_check" CHECK ("amount" > 0);
