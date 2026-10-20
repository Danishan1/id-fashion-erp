-- P1 (2026-10-21): workers see only their own assigned production work.
-- `production.view` now means "assigned work only"; `production.view_all`
-- means "everything" (subject to branch/stage limits).

-- 1. Make sure the catalog has production.view_all (it normally already
--    exists: the catalog is every module x every action).
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
VALUES (gen_random_uuid(), 'production.view_all', 'production', 'view_all access for production', NOW())
ON CONFLICT ("key") DO NOTHING;

-- 2. Every existing role that can see production today keeps seeing all of
--    it -- system and custom roles alike -- except worker and external-unit
--    roles, which become assigned-only / contractor-scoped.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), rp."role_id", va."id", NOW()
FROM "role_permissions" rp
JOIN "permissions" v ON v."id" = rp."permission_id" AND v."key" = 'production.view'
JOIN "roles" r ON r."id" = rp."role_id"
CROSS JOIN (SELECT "id" FROM "permissions" WHERE "key" = 'production.view_all') va
WHERE r."name" NOT IN ('PRODUCTION_WORKER', 'EXTERNAL_UNIT_USER')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- 3. Workers no longer get general production.create (logging progress for
--    anyone, creating job work / production orders). Their own progress is
--    submitted through My Work, which needs only production.view.
DELETE FROM "role_permissions" rp
USING "permissions" p, "roles" r
WHERE rp."permission_id" = p."id"
  AND rp."role_id" = r."id"
  AND p."key" = 'production.create'
  AND r."name" = 'PRODUCTION_WORKER'
  AND r."is_system_role" = TRUE;
