-- Lets a Super Admin hide, per company, tabbed-masters submodules this
-- company doesn't use (starting with Fabric Configuration's GSM/Dye/Weave
-- Type/Width/Composition). A missing row means "visible" -- no backfill
-- needed for existing companies. Whether a submodule is locked (has real
-- data) is derived live at read time, never stored in this table.

-- CreateTable
CREATE TABLE "submodule_visibility" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "submodule_key" TEXT NOT NULL,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "submodule_visibility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "submodule_visibility_company_id_submodule_key_key" ON "submodule_visibility"("company_id", "submodule_key");

-- AddForeignKey
ALTER TABLE "submodule_visibility" ADD CONSTRAINT "submodule_visibility_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
