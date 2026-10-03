import { describe, expect, it } from "vitest";
import { CRM_ENTITY_TYPE_CONFIG, CRM_ENTITY_TYPES, crmEntityHref, crmEntityLabel, isCrmEntityType } from "./crm-entity-types";
import { CRM_EVENT_TYPES, CRM_EVENT_TYPE_NAMES, crmEventCategory, crmEventLabel, isCrmEventType } from "./crm-event-types";

describe("CRM entity type registry", () => {
  it("covers the four Phase 01 record types with labels and audit table names", () => {
    expect(CRM_ENTITY_TYPES.sort()).toEqual(["COMPANY", "CONTACT", "LEAD", "OPPORTUNITY"]);
    for (const type of CRM_ENTITY_TYPES) {
      expect(CRM_ENTITY_TYPE_CONFIG[type].tableName).toMatch(/^crm_/);
    }
    expect(crmEntityLabel("OPPORTUNITY")).toBe("Opportunity");
  });

  it("links leads, contacts and companies to their detail pages and has no links for entities without pages yet", () => {
    expect(crmEntityHref("LEAD", "abc")).toBe("/crm/leads/abc");
    expect(crmEntityHref("CONTACT", "abc")).toBe("/crm/contacts/abc");
    expect(crmEntityHref("COMPANY", "abc")).toBe("/crm/companies/abc");
    expect(crmEntityHref("OPPORTUNITY", "abc")).toBeNull();
  });


  it("validates entity type strings", () => {
    expect(isCrmEntityType("LEAD")).toBe(true);
    expect(isCrmEntityType("lead")).toBe(false);
    expect(isCrmEntityType(undefined)).toBe(false);
  });
});

describe("CRM event type registry", () => {
  it("uses <entity>.<verb> names whose prefix matches the declared entity type", () => {
    for (const name of CRM_EVENT_TYPE_NAMES) {
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
      const prefix = name.split(".")[0].toUpperCase();
      expect(CRM_EVENT_TYPES[name].entityType).toBe(prefix);
    }
  });

  it("includes the events named in the integration plan", () => {
    for (const name of ["lead.created", "lead.updated", "contact.created", "opportunity.created", "opportunity.stage_changed"]) {
      expect(isCrmEventType(name)).toBe(true);
    }
  });

  it("labels known events and falls back to a readable label for unknown historical ones", () => {
    expect(crmEventLabel("opportunity.won")).toBe("Opportunity won");
    expect(crmEventLabel("task.completed")).toBe("Task Completed");
    expect(crmEventCategory("opportunity.lost")).toBe("lost");
    expect(crmEventCategory("task.completed")).toBe("other");
  });
});
