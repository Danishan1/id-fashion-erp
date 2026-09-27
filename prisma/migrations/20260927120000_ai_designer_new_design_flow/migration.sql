-- 4-step "New Design" flow (additive, nullable).
ALTER TYPE "AiDesignerPromptType" ADD VALUE IF NOT EXISTS 'GARMENT_ANALYSIS';
ALTER TYPE "AiDesignerPromptType" ADD VALUE IF NOT EXISTS 'COLOR_VARIANT';

CREATE TYPE "AiDesignerDesignSource" AS ENUM ('FABRIC', 'GARMENT', 'SKETCH');
CREATE TYPE "AiDesignerNewDesignStep" AS ENUM ('SOURCE', 'GARMENT', 'GENERATE', 'DESIGNS');

ALTER TABLE "ai_projects"
  ADD COLUMN "design_source" "AiDesignerDesignSource",
  ADD COLUMN "new_design_step" "AiDesignerNewDesignStep",
  ADD COLUMN "source_image_attachment_id" TEXT,
  ADD COLUMN "source_analysis_json" JSONB,
  ADD COLUMN "garment_suggestions_json" JSONB,
  ADD COLUMN "garment_template_key" TEXT,
  ADD COLUMN "custom_template_attachment_id" TEXT;
