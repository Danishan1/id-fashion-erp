-- Payment Request Approval Matrix (2026-10-27). Additive only.
-- The unrelated sample_requests.color drift line from migrate diff is deliberately left out (see CLAUDE.md).

-- CreateEnum
CREATE TYPE "PaymentApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

ALTER TABLE "payment_requests" ADD COLUMN     "approval_plan_json" JSONB,
ADD COLUMN     "approval_rule_id" UUID,
ADD COLUMN     "approver_may_pay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "current_approval_level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "current_approver_role_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "current_approver_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
ADD COLUMN     "current_level_any_approver" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "required_approval_levels" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "payment_approval_rules" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "request_type" "PaymentRequestType" NOT NULL,
    "branch_id" UUID,
    "min_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "max_amount" DECIMAL(18,2),
    "routing" "PaymentRequestRouting" NOT NULL,
    "approval_levels" INTEGER NOT NULL DEFAULT 1,
    "approver_may_pay" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_approval_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_approval_rule_approvers" (
    "id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "role_id" UUID,
    "user_id" UUID,

    CONSTRAINT "payment_approval_rule_approvers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_request_approvals" (
    "id" UUID NOT NULL,
    "payment_request_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "decision" "PaymentApprovalDecision" NOT NULL,
    "user_id" UUID NOT NULL,
    "remark" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_request_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_approval_rules_company_id_request_type_is_active_idx" ON "payment_approval_rules"("company_id", "request_type", "is_active");

-- CreateIndex
CREATE INDEX "payment_approval_rule_approvers_rule_id_idx" ON "payment_approval_rule_approvers"("rule_id");

-- CreateIndex
CREATE INDEX "payment_request_approvals_payment_request_id_idx" ON "payment_request_approvals"("payment_request_id");

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_approval_rule_id_fkey" FOREIGN KEY ("approval_rule_id") REFERENCES "payment_approval_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval_rules" ADD CONSTRAINT "payment_approval_rules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval_rules" ADD CONSTRAINT "payment_approval_rules_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval_rules" ADD CONSTRAINT "payment_approval_rules_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval_rule_approvers" ADD CONSTRAINT "payment_approval_rule_approvers_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "payment_approval_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval_rule_approvers" ADD CONSTRAINT "payment_approval_rule_approvers_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_approval_rule_approvers" ADD CONSTRAINT "payment_approval_rule_approvers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_approvals" ADD CONSTRAINT "payment_request_approvals_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_approvals" ADD CONSTRAINT "payment_request_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-added checks
ALTER TABLE "payment_approval_rule_approvers" ADD CONSTRAINT "payment_approval_rule_approvers_role_xor_user_check" CHECK (("role_id" IS NOT NULL) <> ("user_id" IS NOT NULL));
ALTER TABLE "payment_approval_rule_approvers" ADD CONSTRAINT "payment_approval_rule_approvers_level_check" CHECK ("level" BETWEEN 1 AND 3);
ALTER TABLE "payment_approval_rules" ADD CONSTRAINT "payment_approval_rules_levels_check" CHECK ("approval_levels" BETWEEN 1 AND 3);
ALTER TABLE "payment_approval_rules" ADD CONSTRAINT "payment_approval_rules_amounts_check" CHECK ("min_amount" >= 0 AND ("max_amount" IS NULL OR "max_amount" > "min_amount"));
