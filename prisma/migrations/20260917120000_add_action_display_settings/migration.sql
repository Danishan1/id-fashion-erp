-- CreateEnum
CREATE TYPE "ActionDisplayMode" AS ENUM ('ICON', 'TEXT');

-- CreateEnum
CREATE TYPE "ActionTextStyle" AS ENUM ('LINK', 'BUTTON');

-- CreateTable
CREATE TABLE "action_display_settings" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "display_mode" "ActionDisplayMode" NOT NULL DEFAULT 'ICON',
    "text_style" "ActionTextStyle" NOT NULL DEFAULT 'LINK',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_display_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "action_display_settings_company_id_key" ON "action_display_settings"("company_id");

-- AddForeignKey
ALTER TABLE "action_display_settings" ADD CONSTRAINT "action_display_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
