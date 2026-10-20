-- Rollback for 20261021140000_employee_reporting_lines.
-- Removes the HRMS view_all grants added by the migration (except SUPER_ADMIN,
-- which holds every action) and drops the reporting-lines table.
DELETE FROM "role_permissions" rp
USING "permissions" p, "roles" r
WHERE rp."permission_id" = p."id"
  AND rp."role_id" = r."id"
  AND p."key" IN ('hrms_leave.view_all', 'hrms_attendance.view_all')
  AND r."name" <> 'SUPER_ADMIN';

DROP TABLE IF EXISTS "employee_reporting_lines";
DROP TYPE IF EXISTS "HierarchyModule";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261021140000_employee_reporting_lines';
