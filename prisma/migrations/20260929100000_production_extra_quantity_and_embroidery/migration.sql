-- CreateEnum
CREATE TYPE "ProductionOrderQuantityChangeType" AS ENUM ('EXTRA_PRODUCTION');


-- CreateTable
CREATE TABLE "production_order_quantity_changes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "change_type" "ProductionOrderQuantityChangeType" NOT NULL,
    "previous_quantity" DECIMAL(18,4) NOT NULL,
    "added_quantity" DECIMAL(18,4) NOT NULL,
    "new_quantity" DECIMAL(18,4) NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_order_quantity_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_order_quantity_changes_production_order_id_idx" ON "production_order_quantity_changes"("production_order_id");

-- CreateIndex
CREATE INDEX "production_order_quantity_changes_company_id_idx" ON "production_order_quantity_changes"("company_id");

-- AddForeignKey
ALTER TABLE "production_order_quantity_changes" ADD CONSTRAINT "production_order_quantity_changes_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_quantity_changes" ADD CONSTRAINT "production_order_quantity_changes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data: add the EMBROIDERY production stage (stone, sequin, lace, brooch and
-- other decorative accessories) right after STITCHING for every company that
-- has a STITCHING stage and no EMBROIDERY stage yet. Later stages shift down
-- by one so the working order stays Cutting -> Stitching -> Embroidery -> ...
-- Companies can still reorder, rename or deactivate it from
-- Masters -> Production Config.
UPDATE "production_stages" ps
SET "sequence" = ps."sequence" + 1, "updated_at" = CURRENT_TIMESTAMP
FROM "production_stages" st
WHERE st."company_id" = ps."company_id"
  AND upper(trim(st."code")) = 'STITCHING'
  AND ps."sequence" > st."sequence"
  AND NOT EXISTS (
    SELECT 1 FROM "production_stages" e
    WHERE e."company_id" = ps."company_id" AND upper(trim(e."code")) = 'EMBROIDERY'
  );

INSERT INTO "production_stages" ("id", "company_id", "code", "name", "sequence", "is_final", "allow_rework", "is_qc_recommended", "allows_extra_quantity", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid(), st."company_id", 'EMBROIDERY', 'Embroidery', st."sequence" + 1, false, true, false, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "production_stages" st
WHERE upper(trim(st."code")) = 'STITCHING'
  AND NOT EXISTS (
    SELECT 1 FROM "production_stages" e
    WHERE e."company_id" = st."company_id" AND upper(trim(e."code")) = 'EMBROIDERY'
  );
