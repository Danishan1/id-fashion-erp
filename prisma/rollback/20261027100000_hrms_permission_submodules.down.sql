-- Rollback for 20261027100000_hrms_permission_submodules
-- Removes the per-screen HRMS permission rows (their role grants and user
-- overrides cascade). The old hrms_attendance / hrms_leave grants were never
-- touched, so the old code keeps working.
DELETE FROM "permissions" WHERE "module" IN (
  'hrms_attendance_team', 'hrms_attendance_records', 'hrms_attendance_regularization',
  'hrms_attendance_outdoor', 'hrms_attendance_overtime', 'hrms_attendance_photos',
  'hrms_attendance_salary', 'hrms_attendance_settings', 'hrms_leave_balances', 'hrms_leave_types'
);
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261027100000_hrms_permission_submodules';
