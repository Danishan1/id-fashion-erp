-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('DRAFT', 'REQUESTED', 'TECH_PACK_READY', 'IN_DEVELOPMENT', 'INTERNAL_QC', 'SUBMITTED_TO_CUSTOMER', 'CUSTOMER_FEEDBACK_RECEIVED', 'REVISION_REQUESTED', 'APPROVED', 'REJECTED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SampleVersionStatus" AS ENUM ('DRAFT', 'IN_DEVELOPMENT', 'INTERNAL_QC', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SampleDecision" AS ENUM ('APPROVED', 'REJECTED', 'REVISION_REQUESTED');

-- CreateTable
CREATE TABLE "sample_requests" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "request_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "buyer_id" UUID,
    "product_id" UUID,
    "requested_by_user_id" UUID NOT NULL,
    "request_date" DATE NOT NULL,
    "target_submission_date" DATE,
    "status" "SampleStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version_number" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sample_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_versions" (
    "id" UUID NOT NULL,
    "sample_request_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "SampleVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "tech_pack_notes" TEXT,
    "estimated_cost_per_unit" DECIMAL(18,2),
    "submitted_to_customer_at" TIMESTAMP(3),
    "customer_decision_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_materials" (
    "id" UUID NOT NULL,
    "sample_version_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "planned_quantity" DECIMAL(18,4) NOT NULL,
    "uom_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_approvals" (
    "id" UUID NOT NULL,
    "sample_version_id" UUID NOT NULL,
    "decision" "SampleDecision" NOT NULL,
    "decided_by_user_id" UUID NOT NULL,
    "customer_contact_name" TEXT,
    "decision_notes" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sample_comments" (
    "id" UUID NOT NULL,
    "sample_request_id" UUID NOT NULL,
    "sample_version_id" UUID,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sample_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sample_requests_company_id_request_number_key" ON "sample_requests"("company_id", "request_number");

-- CreateIndex
CREATE UNIQUE INDEX "sample_versions_sample_request_id_version_number_key" ON "sample_versions"("sample_request_id", "version_number");

-- AddForeignKey
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_requests" ADD CONSTRAINT "sample_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_versions" ADD CONSTRAINT "sample_versions_sample_request_id_fkey" FOREIGN KEY ("sample_request_id") REFERENCES "sample_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_versions" ADD CONSTRAINT "sample_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_materials" ADD CONSTRAINT "sample_materials_sample_version_id_fkey" FOREIGN KEY ("sample_version_id") REFERENCES "sample_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_materials" ADD CONSTRAINT "sample_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_materials" ADD CONSTRAINT "sample_materials_uom_id_fkey" FOREIGN KEY ("uom_id") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_approvals" ADD CONSTRAINT "sample_approvals_sample_version_id_fkey" FOREIGN KEY ("sample_version_id") REFERENCES "sample_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_approvals" ADD CONSTRAINT "sample_approvals_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_comments" ADD CONSTRAINT "sample_comments_sample_request_id_fkey" FOREIGN KEY ("sample_request_id") REFERENCES "sample_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_comments" ADD CONSTRAINT "sample_comments_sample_version_id_fkey" FOREIGN KEY ("sample_version_id") REFERENCES "sample_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sample_comments" ADD CONSTRAINT "sample_comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
