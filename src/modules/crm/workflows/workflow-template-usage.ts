import { prisma } from "@/core/db/client";
import { registerTemplateUsageProvider } from "../templates/template-usage";

/**
 * Phase 18: a template used by a live workflow's "Send message" step is an
 * active reference — it can't be archived until the workflow stops using it.
 * Live = the PUBLISHED version of a workflow that is published or paused
 * (a paused workflow resumes with the same version). Drafts don't block.
 * Messages a workflow actually sent are counted by the Inbox provider
 * (they are ordinary crm_messages rows), so the count here is 0.
 */
registerTemplateUsageProvider({
  key: "workflows",
  label: "Workflows",
  async summarize(companyId, templateId) {
    const rows = await prisma.$queryRaw<{ id: string; name: string }[]>`
      SELECT w.id, w.name
      FROM crm_workflows w
      JOIN crm_workflow_versions v ON v.id = w.published_version_id
      WHERE w.company_id = ${companyId}::uuid
        AND w.status IN ('PUBLISHED', 'PAUSED')
        AND v.definition::text LIKE ${`%"templateId": "${templateId}"%`}
      ORDER BY w.name
      LIMIT 50`;
    return {
      count: 0,
      lastUsedAt: null,
      byVersion: {},
      activeReferences: rows.map((r) => ({ label: `Workflow "${r.name}"`, href: `/crm/workflows/${r.id}` })),
    };
  },
});
