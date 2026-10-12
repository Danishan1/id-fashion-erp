import { describe, expect, it } from "vitest";
import { CRM_ENTITY_TYPE_CONFIG, CRM_ENTITY_TYPES, crmEntityHref, crmEntityLabel, isCrmEntityType } from "./crm-entity-types";
import { CRM_EVENT_TYPES, CRM_EVENT_TYPE_NAMES, crmEventCategory, crmEventLabel, isCrmEventType } from "./crm-event-types";

describe("CRM entity type registry", () => {
  it("covers every CRM record type (incl. Phase 09 activities, Phase 11 conversations, Phase 12 templates) with labels and audit table names", () => {
    expect(CRM_ENTITY_TYPES.sort()).toEqual(["ACTIVITY", "COMPANY", "CONTACT", "CONVERSATION", "LEAD", "OPPORTUNITY", "TEMPLATE"]);
    expect(crmEntityHref("ACTIVITY", "abc")).toBe("/crm/activities/abc");
    expect(crmEntityHref("CONVERSATION", "abc")).toBe("/crm/inbox/abc");
    expect(crmEntityHref("TEMPLATE", "abc")).toBe("/crm/templates/abc");
    for (const type of CRM_ENTITY_TYPES) {
      expect(CRM_ENTITY_TYPE_CONFIG[type].tableName).toMatch(/^crm_/);
    }
    expect(crmEntityLabel("OPPORTUNITY")).toBe("Opportunity");
  });

  it("links every CRM entity type to its detail page", () => {
    expect(crmEntityHref("LEAD", "abc")).toBe("/crm/leads/abc");
    expect(crmEntityHref("CONTACT", "abc")).toBe("/crm/contacts/abc");
    expect(crmEntityHref("COMPANY", "abc")).toBe("/crm/companies/abc");
    expect(crmEntityHref("OPPORTUNITY", "abc")).toBe("/crm/opportunities/abc");
  });


  it("validates entity type strings", () => {
    expect(isCrmEntityType("LEAD")).toBe(true);
    expect(isCrmEntityType("lead")).toBe(false);
    expect(isCrmEntityType(undefined)).toBe(false);
  });
});

describe("CRM event type registry", () => {
  it("uses <entity>.<verb> names whose prefix matches the declared entity type", () => {
    // Appointments are activities (Phase 10): appointment.* events are stored on the ACTIVITY record.
    // Messages belong to conversations (Phase 11): message.* events are stored on the CONVERSATION record.
    const ALIASES: Record<string, string> = { APPOINTMENT: "ACTIVITY", MESSAGE: "CONVERSATION" };
    for (const name of CRM_EVENT_TYPE_NAMES) {
      expect(name).toMatch(/^[a-z_]+\.[a-z_]+$/);
      const prefix = name.split(".")[0].toUpperCase();
      expect(CRM_EVENT_TYPES[name].entityType).toBe(ALIASES[prefix] ?? prefix);
    }
  });

  it("includes the events named in the integration plan", () => {
    for (const name of ["lead.created", "lead.updated", "contact.created", "opportunity.created", "opportunity.stage_changed", "appointment.created", "appointment.rescheduled", "appointment.cancelled", "appointment.completed", "appointment.no_show"]) {
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
