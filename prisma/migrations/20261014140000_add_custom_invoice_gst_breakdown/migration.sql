-- Additive GST breakdown fields for Custom Invoice (Phase 1, GST Correctness, 2026-10-14).
-- STRICTLY UNAPPLIED -- Pending explicit user review and approval before execution.
--
-- Adds 5 additive columns to "custom_invoices":
--   1. place_of_supply_state_code (VARCHAR(2)): 2-digit Indian GST State Code (e.g. '07' for Delhi, '27' for Maharashtra).
--   2. is_inter_state (BOOLEAN): Intra-state vs Inter-state GST classification (NULL for legacy records).
--   3. cgst_amount (DECIMAL(18,2) DEFAULT 0): Central GST amount, deterministic 50% split with odd-paisa reconciliation.
--   4. sgst_amount (DECIMAL(18,2) DEFAULT 0): State GST amount, deterministic 50% split with odd-paisa reconciliation.
--   5. igst_amount (DECIMAL(18,2) DEFAULT 0): Integrated GST amount for inter-state transactions.

-- AlterTable
ALTER TABLE "custom_invoices" ADD COLUMN     "place_of_supply_state_code" VARCHAR(2),
ADD COLUMN     "is_inter_state" BOOLEAN,
ADD COLUMN     "cgst_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "sgst_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "igst_amount" DECIMAL(18,2) NOT NULL DEFAULT 0;
