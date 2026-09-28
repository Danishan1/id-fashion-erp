-- Master-prompt Tech Pack: per-page AI image status (additive, nullable).
ALTER TABLE "ai_tech_pack_pages"
  ADD COLUMN "image_status" "AiDesignerRunStatus",
  ADD COLUMN "image_error" TEXT,
  ADD COLUMN "prompt_edited" BOOLEAN NOT NULL DEFAULT false;
