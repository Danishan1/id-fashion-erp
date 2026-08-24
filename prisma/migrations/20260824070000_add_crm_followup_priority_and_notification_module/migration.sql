-- CreateEnum
CREATE TYPE "CrmFollowupPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterEnum
ALTER TYPE "RelatedModule" ADD VALUE 'CRM_FOLLOWUP';

-- AlterTable
ALTER TABLE "crm_followups" ADD COLUMN     "priority" "CrmFollowupPriority" NOT NULL DEFAULT 'MEDIUM';
