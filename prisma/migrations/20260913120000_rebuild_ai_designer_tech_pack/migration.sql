-- AlterTable
ALTER TABLE "ai_tech_packs" DROP COLUMN "bom_json",
DROP COLUMN "flat_sketch_image_attachment_id",
DROP COLUMN "measurements_json",
ADD COLUMN     "designer_notes" TEXT,
ADD COLUMN     "garment_analysis_json" JSONB,
ADD COLUMN     "suggested_additional_views" TEXT;

-- CreateTable
CREATE TABLE "ai_tech_pack_pages" (
    "id" UUID NOT NULL,
    "tech_pack_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "page_title" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "image_attachment_id" TEXT,

    CONSTRAINT "ai_tech_pack_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_tech_pack_pages_tech_pack_id_page_number_key" ON "ai_tech_pack_pages"("tech_pack_id", "page_number");

-- AddForeignKey
ALTER TABLE "ai_tech_pack_pages" ADD CONSTRAINT "ai_tech_pack_pages_tech_pack_id_fkey" FOREIGN KEY ("tech_pack_id") REFERENCES "ai_tech_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
