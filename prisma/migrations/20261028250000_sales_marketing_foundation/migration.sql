-- Sales & Marketing module, Phase 01 foundation (2026-10-28).
-- No tables: the module shell only needs its permission module and package.
--
-- 1. Permission catalog rows for "sales_marketing" (every catalog action).
WITH actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), 'sales_marketing.' || a.action, 'sales_marketing', a.action || ' access for sales_marketing', now()
FROM actions a
ON CONFLICT ("key") DO NOTHING;

-- 2. Same roles as CRM: copy every crm.<action> role grant to sales_marketing.<action>.
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), rp."role_id", np."id", now()
FROM "role_permissions" rp
JOIN "permissions" op ON op."id" = rp."permission_id" AND op."module" = 'crm'
JOIN "permissions" np ON np."key" = 'sales_marketing' || substring(op."key" FROM position('.' IN op."key"))
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- 3. Same for per-user overrides (grant or revoke).
INSERT INTO "user_permission_overrides" ("id", "company_id", "user_id", "permission_id", "effect", "reason", "created_by_user_id", "created_at")
SELECT gen_random_uuid(), o."company_id", o."user_id", np."id", o."effect", o."reason", o."created_by_user_id", now()
FROM "user_permission_overrides" o
JOIN "permissions" op ON op."id" = o."permission_id" AND op."module" = 'crm'
JOIN "permissions" np ON np."key" = 'sales_marketing' || substring(op."key" FROM position('.' IN op."key"))
ON CONFLICT ("user_id", "permission_id") DO NOTHING;

-- 4. The old "MARKETING" package becomes "SALES_MARKETING" in plans and
--    per-company overrides, so every plan/company keeps its current on/off choice.
UPDATE "company_module_entitlements" SET "package_key" = 'SALES_MARKETING' WHERE "package_key" = 'MARKETING';
UPDATE "subscription_plan_modules" SET "package_key" = 'SALES_MARKETING' WHERE "package_key" = 'MARKETING';
