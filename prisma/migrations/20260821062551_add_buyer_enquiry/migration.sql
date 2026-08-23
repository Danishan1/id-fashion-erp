-- CreateEnum
CREATE TYPE "EnquirySource" AS ENUM ('EMAIL', 'PHONE', 'TRADE_SHOW', 'REFERRAL', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "BuyerEnquiryStatus" AS ENUM ('OPEN', 'PARTIALLY_CONVERTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BuyerEnquiryLineStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED_FOR_SAMPLING', 'ON_HOLD', 'REJECTED', 'CONVERTED');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'BUYER_ENQUIRY';

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'BUYER_ENQUIRY';

-- CreateTable
CREATE TABLE "buyer_enquiries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "branch_id" UUID,
    "enquiry_number" TEXT NOT NULL,
    "customer_id" UUID,
    "buyer_id" UUID,
    "prospect_name" TEXT,
    "prospect_contact_person" TEXT,
    "prospect_email" TEXT,
    "prospect_phone" TEXT,
    "prospect_country" TEXT,
    "enquiry_date" DATE NOT NULL,
    "source" "EnquirySource" NOT NULL DEFAULT 'OTHER',
    "status" "BuyerEnquiryStatus" NOT NULL DEFAULT 'OPEN',
    "remarks" TEXT,
    "requested_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_enquiry_lines" (
    "id" UUID NOT NULL,
    "buyer_enquiry_id" UUID NOT NULL,
    "product_id" UUID,
    "style_name_free_text" TEXT,
    "description" TEXT,
    "color_remarks" TEXT,
    "target_quantity" DECIMAL(18,2),
    "target_unit_price" DECIMAL(18,2),
    "target_delivery_date" DATE,
    "remarks" TEXT,
    "line_status" "BuyerEnquiryLineStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "rejection_reason" TEXT,
    "sample_request_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_enquiry_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyer_enquiries_company_id_enquiry_number_key" ON "buyer_enquiries"("company_id", "enquiry_number");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_enquiry_lines_sample_request_id_key" ON "buyer_enquiry_lines"("sample_request_id");

-- AddForeignKey
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiries" ADD CONSTRAINT "buyer_enquiries_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiry_lines" ADD CONSTRAINT "buyer_enquiry_lines_buyer_enquiry_id_fkey" FOREIGN KEY ("buyer_enquiry_id") REFERENCES "buyer_enquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiry_lines" ADD CONSTRAINT "buyer_enquiry_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_enquiry_lines" ADD CONSTRAINT "buyer_enquiry_lines_sample_request_id_fkey" FOREIGN KEY ("sample_request_id") REFERENCES "sample_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
