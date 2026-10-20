-- Rollback for 20261021100000_production_view_all_worker_scope.
-- Removes production.view_all from every role except SUPER_ADMIN (which held
-- every action before P1) and gives the PRODUCTION_WORKER system role back
-- production.create. The permission catalog row itself stays (it predates P1).
DELETE FROM "role_permissions" rp
USING "permissions" p, "roles" r
WHERE rp."permission_id" = p."id"
  AND rp."role_id" = r."id"
  AND p."key" = 'production.view_all'
  AND r."name" <> 'SUPER_ADMIN';

INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), r."id", p."id", NOW()
FROM "roles" r
CROSS JOIN (SELECT "id" FROM "permissions" WHERE "key" = 'production.create') p
WHERE r."name" = 'PRODUCTION_WORKER' AND r."is_system_role" = TRUE
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261021100000_production_view_all_worker_scope';
