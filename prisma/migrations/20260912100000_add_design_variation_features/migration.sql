-- AlterEnum
-- IF NOT EXISTS: this dev database already carries these 6 values from an
-- earlier, since-abandoned experiment (a "guided design wizard" branch that
-- was never merged) — plain ADD VALUE would fail here with "already exists"
-- while a fresh/CI database genuinely needs them added. IF NOT EXISTS makes
-- this migration correct on both.
ALTER TYPE "AiGarmentDesignFeature" ADD VALUE IF NOT EXISTS 'COLOR';
ALTER TYPE "AiGarmentDesignFeature" ADD VALUE IF NOT EXISTS 'BUTTONS';
ALTER TYPE "AiGarmentDesignFeature" ADD VALUE IF NOT EXISTS 'BACKGROUND_ENVIRONMENT';
ALTER TYPE "AiGarmentDesignFeature" ADD VALUE IF NOT EXISTS 'MODEL';
ALTER TYPE "AiGarmentDesignFeature" ADD VALUE IF NOT EXISTS 'LOGO';
ALTER TYPE "AiGarmentDesignFeature" ADD VALUE IF NOT EXISTS 'EMBROIDERY';

-- DropEnum
-- Orphaned leftover from that same abandoned wizard experiment — the enum
-- type was created live against this dev database but the table that would
-- have used it (ai_garment_design_wizard_inputs) never was. No Prisma model
-- or column references this type; safe to drop.
DROP TYPE IF EXISTS "AiGarmentWizardTargetCustomer";
