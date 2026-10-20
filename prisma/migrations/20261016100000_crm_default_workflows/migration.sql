-- Default CRM automations: remember which catalogue entry a workflow was installed from,
-- so "Add default automations" (and the seed) never add the same one twice.
ALTER TABLE "crm_workflows" ADD COLUMN "template_key" TEXT;

CREATE UNIQUE INDEX "crm_workflows_company_id_template_key_key" ON "crm_workflows"("company_id", "template_key");
