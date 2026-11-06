-- Rollback for 20261110090000_sm_workflows_phase15. The CrmEntityType values ENQUIRY / QUOTATION
-- stay (Postgres can't drop enum values); delete CRM activities on them first if required.
DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT "id" FROM "permissions" WHERE "module" = 'sales_workflows');
DELETE FROM "permissions" WHERE "module" = 'sales_workflows';
DROP TABLE IF EXISTS "sm_workflow_step_runs";
DROP TABLE IF EXISTS "sm_workflow_instances";
ALTER TABLE IF EXISTS "sm_workflow_definitions" DROP CONSTRAINT IF EXISTS "sm_workflow_definitions_active_version_id_fkey";
DROP TABLE IF EXISTS "sm_workflow_definition_versions";
DROP TABLE IF EXISTS "sm_workflow_definitions";
DROP FUNCTION IF EXISTS sm_workflow_version_guard();
DROP TABLE IF EXISTS "sm_workflow_event_log";
DROP TABLE IF EXISTS "sm_workflow_checkpoints";
