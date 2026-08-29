-- Restricts a Role to specific ProductionStage(s) for floor-level access
-- separation (e.g. a "Cutting Supervisor" role that should never see
-- Stitching's lots) — layered on top of the existing module/action RBAC.
-- A Role with ZERO rows here is unrestricted (sees every stage) — this
-- default keeps every pre-existing role behaving exactly as before, no
-- backfill needed.

-- CreateTable
CREATE TABLE "role_production_stage_access" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "production_stage_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_production_stage_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_production_stage_access_role_id_production_stage_id_key" ON "role_production_stage_access"("role_id", "production_stage_id");

-- AddForeignKey
ALTER TABLE "role_production_stage_access" ADD CONSTRAINT "role_production_stage_access_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_production_stage_access" ADD CONSTRAINT "role_production_stage_access_production_stage_id_fkey" FOREIGN KEY ("production_stage_id") REFERENCES "production_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
