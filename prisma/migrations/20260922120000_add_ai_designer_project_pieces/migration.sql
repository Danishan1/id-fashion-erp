-- CreateEnum
CREATE TYPE "AiDesignerProjectMode" AS ENUM ('SINGLE', 'SET');

-- AlterTable
ALTER TABLE "ai_projects" ADD COLUMN     "project_mode" "AiDesignerProjectMode" NOT NULL DEFAULT 'SINGLE';

-- CreateTable
CREATE TABLE "ai_project_pieces" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "piece_index" INTEGER NOT NULL,
    "piece_label" TEXT NOT NULL,
    "product_category" TEXT,
    "design_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_project_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_project_pieces_project_id_piece_index_key" ON "ai_project_pieces"("project_id", "piece_index");

-- AddForeignKey
ALTER TABLE "ai_project_pieces" ADD CONSTRAINT "ai_project_pieces_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "ai_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
