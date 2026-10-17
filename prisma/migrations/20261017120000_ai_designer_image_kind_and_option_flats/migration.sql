-- AI Designer: garment/sketch kind + pairing on generated images; CAD-flat
-- variant for option reference images.

CREATE TYPE "AiDesignerImageKind" AS ENUM ('GARMENT', 'SKETCH');
CREATE TYPE "AiDesignerOptionImageVariant" AS ENUM ('PHOTO', 'CAD_FLAT');

ALTER TABLE "ai_images"
  ADD COLUMN "kind" "AiDesignerImageKind" NOT NULL DEFAULT 'GARMENT',
  ADD COLUMN "sketch_for_image_id" UUID;

CREATE UNIQUE INDEX "ai_images_sketch_for_image_id_key" ON "ai_images"("sketch_for_image_id");

ALTER TABLE "ai_images"
  ADD CONSTRAINT "ai_images_sketch_for_image_id_fkey"
  FOREIGN KEY ("sketch_for_image_id") REFERENCES "ai_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: generated sketches were only distinguishable by their attachment label.
UPDATE "ai_images" i
SET "kind" = 'SKETCH'
FROM "attachments" a
WHERE a."id"::text = i."image_attachment_id"
  AND a."context_label" = 'GENERATED_SKETCH_IMAGE';

-- Backfill pairing: in "BOTH" generations the sketch was drawn from the first
-- garment of the same generation. Link each such sketch to that garment
-- (only when that garment has no sketch linked yet).
WITH first_garment AS (
  SELECT DISTINCT ON ("generation_id") "generation_id", "id" AS garment_id
  FROM "ai_images"
  WHERE "kind" = 'GARMENT'
  ORDER BY "generation_id", "created_at" ASC, "id" ASC
),
first_sketch AS (
  SELECT DISTINCT ON ("generation_id") "generation_id", "id" AS sketch_id
  FROM "ai_images"
  WHERE "kind" = 'SKETCH'
  ORDER BY "generation_id", "created_at" ASC, "id" ASC
)
UPDATE "ai_images" s
SET "sketch_for_image_id" = fg.garment_id
FROM first_sketch fs
JOIN first_garment fg ON fg."generation_id" = fs."generation_id"
WHERE s."id" = fs.sketch_id;

-- Option reference images: PHOTO (existing rows) vs CAD_FLAT.
ALTER TABLE "ai_designer_option_reference_images"
  ADD COLUMN "variant" "AiDesignerOptionImageVariant" NOT NULL DEFAULT 'PHOTO';

DROP INDEX IF EXISTS "ai_designer_option_reference_images_company_id_option_value_key";
CREATE UNIQUE INDEX "ai_designer_option_reference_images_company_id_variant_opti_key"
  ON "ai_designer_option_reference_images"("company_id", "variant", "option_value");
