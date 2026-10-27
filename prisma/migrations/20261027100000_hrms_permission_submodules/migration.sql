-- HRMS split into one permission module per screen (2026-10-27).
-- "hrms_attendance" stays My Attendance and "hrms_leave" stays Leave Requests.
-- Every role and every user override keeps exactly the access it had: each
-- grant on the old module is copied to every new sibling module. Admins can
-- then untick screens per role. Data only - no tables change.

-- 1. Permission catalog rows for the new modules (every catalog action).
WITH new_modules(module, parent) AS (
  VALUES
    ('hrms_attendance_team', 'hrms_attendance'),
    ('hrms_attendance_records', 'hrms_attendance'),
    ('hrms_attendance_regularization', 'hrms_attendance'),
    ('hrms_attendance_outdoor', 'hrms_attendance'),
    ('hrms_attendance_overtime', 'hrms_attendance'),
    ('hrms_attendance_photos', 'hrms_attendance'),
    ('hrms_attendance_salary', 'hrms_attendance'),
    ('hrms_attendance_settings', 'hrms_attendance'),
    ('hrms_leave_balances', 'hrms_leave'),
    ('hrms_leave_types', 'hrms_leave')
),
actions(action) AS (
  VALUES ('view'), ('create'), ('edit'), ('delete'), ('approve'), ('reject'), ('post'),
         ('cancel'), ('export'), ('print'), ('override'), ('scan'), ('view_all')
)
INSERT INTO "permissions" ("id", "key", "module", "description", "created_at")
SELECT gen_random_uuid(), nm.module || '.' || a.action, nm.module, a.action || ' access for ' || nm.module, now()
FROM new_modules nm CROSS JOIN actions a
ON CONFLICT ("key") DO NOTHING;

-- 2. Copy role grants: old_module.action -> new_module.action.
WITH new_modules(module, parent) AS (
  VALUES
    ('hrms_attendance_team', 'hrms_attendance'),
    ('hrms_attendance_records', 'hrms_attendance'),
    ('hrms_attendance_regularization', 'hrms_attendance'),
    ('hrms_attendance_outdoor', 'hrms_attendance'),
    ('hrms_attendance_overtime', 'hrms_attendance'),
    ('hrms_attendance_photos', 'hrms_attendance'),
    ('hrms_attendance_salary', 'hrms_attendance'),
    ('hrms_attendance_settings', 'hrms_attendance'),
    ('hrms_leave_balances', 'hrms_leave'),
    ('hrms_leave_types', 'hrms_leave')
)
INSERT INTO "role_permissions" ("id", "role_id", "permission_id", "created_at")
SELECT gen_random_uuid(), rp."role_id", np."id", now()
FROM "role_permissions" rp
JOIN "permissions" op ON op."id" = rp."permission_id"
JOIN new_modules nm ON nm.parent = op."module"
JOIN "permissions" np ON np."key" = nm.module || substring(op."key" FROM position('.' IN op."key"))
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

-- 3. Copy per-user overrides the same way (grant or revoke).
WITH new_modules(module, parent) AS (
  VALUES
    ('hrms_attendance_team', 'hrms_attendance'),
    ('hrms_attendance_records', 'hrms_attendance'),
    ('hrms_attendance_regularization', 'hrms_attendance'),
    ('hrms_attendance_outdoor', 'hrms_attendance'),
    ('hrms_attendance_overtime', 'hrms_attendance'),
    ('hrms_attendance_photos', 'hrms_attendance'),
    ('hrms_attendance_salary', 'hrms_attendance'),
    ('hrms_attendance_settings', 'hrms_attendance'),
    ('hrms_leave_balances', 'hrms_leave'),
    ('hrms_leave_types', 'hrms_leave')
)
INSERT INTO "user_permission_overrides" ("id", "company_id", "user_id", "permission_id", "effect", "reason", "created_by_user_id", "created_at")
SELECT gen_random_uuid(), o."company_id", o."user_id", np."id", o."effect", o."reason", o."created_by_user_id", now()
FROM "user_permission_overrides" o
JOIN "permissions" op ON op."id" = o."permission_id"
JOIN new_modules nm ON nm.parent = op."module"
JOIN "permissions" np ON np."key" = nm.module || substring(op."key" FROM position('.' IN op."key"))
ON CONFLICT ("user_id", "permission_id") DO NOTHING;
