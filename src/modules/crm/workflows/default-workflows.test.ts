import { describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOWS, DEFAULT_WORKFLOW_CATEGORIES } from "./default-workflows";
import { WORKFLOW_ACTIONS, type WorkflowActionKey } from "./workflow-action-catalog";
import { canonicalJson, validateDefinitionStructure, workflowDefinitionSchema } from "./workflow-definition";

describe("default CRM automations", () => {
  it("are 15–20 uniquely keyed, categorised workflows, with a mix of on and off", () => {
    expect(DEFAULT_WORKFLOWS.length).toBeGreaterThanOrEqual(15);
    expect(DEFAULT_WORKFLOWS.length).toBeLessThanOrEqual(20);
    expect(new Set(DEFAULT_WORKFLOWS.map((d) => d.key)).size).toBe(DEFAULT_WORKFLOWS.length);
    expect(new Set(DEFAULT_WORKFLOWS.map((d) => d.name)).size).toBe(DEFAULT_WORKFLOWS.length);
    for (const d of DEFAULT_WORKFLOWS) {
      expect(d.key).toMatch(/^[a-z0-9-]{3,60}$/);
      expect(DEFAULT_WORKFLOW_CATEGORIES).toContain(d.category);
      expect(d.name.length).toBeLessThanOrEqual(120);
      expect(d.description.length).toBeGreaterThan(20);
    }
    expect(DEFAULT_WORKFLOWS.some((d) => d.enabledByDefault)).toBe(true);
    expect(DEFAULT_WORKFLOWS.some((d) => !d.enabledByDefault)).toBe(true);
  });

  it.each(DEFAULT_WORKFLOWS.map((d) => [d.key, d] as const))("%s parses and passes the publish validator", (_key, d) => {
    const parsed = workflowDefinitionSchema.parse(d.definition);
    // Parsing must not change it (what is stored is what was written here).
    expect(canonicalJson(parsed)).toBe(canonicalJson(d.definition));
    expect(validateDefinitionStructure(parsed)).toEqual([]);
  });

  it("never reference company-specific ids (statuses, stages, tags, users, templates) or external URLs", () => {
    for (const d of DEFAULT_WORKFLOWS) {
      for (const n of d.definition.nodes) {
        if (n.type !== "ACTION") continue;
        const def = WORKFLOW_ACTIONS[n.action as WorkflowActionKey];
        expect(def, `${d.key}/${n.id}`).toBeTruthy();
        expect(def.sideEffect, `${d.key}/${n.id}: defaults stay inside the CRM`).not.toMatch(/MESSAGE|EXTERNAL/);
        for (const p of def.params) {
          const v = (n.params as Record<string, unknown>)[p.key];
          if (["leadStatus", "companyStatus", "stage", "tags", "user", "users", "template", "url"].includes(p.type)) expect(v, `${d.key}/${n.id}.${p.key}`).toBeUndefined();
        }
      }
      expect(JSON.stringify(d.definition)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  it("only use merge variables of the Phase 12 registry, always with a fallback", async () => {
    const { TEMPLATE_VARIABLE_MAP } = await import("../templates/template-registry");
    for (const d of DEFAULT_WORKFLOWS) {
      for (const m of JSON.stringify(d.definition).matchAll(/\{\{([^}]+)\}\}/g)) {
        const [name, fallback] = m[1].split("|");
        expect(TEMPLATE_VARIABLE_MAP.has(name.trim()), `${d.key}: ${m[0]}`).toBe(true);
        expect(fallback?.trim(), `${d.key}: ${m[0]} needs a fallback`).toBeTruthy();
      }
    }
  });
});
