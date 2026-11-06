import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "@/config/rbac";

/** module → actions some non-super-admin role is actually granted. */
const MODULE_ACTIONS_FOR_TEST: Record<string, string[]> = {};
for (const [role, grants] of Object.entries(ROLE_PERMISSIONS)) {
  if (role === "SUPER_ADMIN") continue;
  for (const [m, actions] of Object.entries(grants)) MODULE_ACTIONS_FOR_TEST[m] = [...new Set([...(MODULE_ACTIONS_FOR_TEST[m] ?? []), ...(actions ?? [])])];
}

/** Phase 16 — pure units of the integration layer (no database). */

const R = await import("./integration-registry");
const { minimalPayload, sampleSmEnvelope, buildSmEnvelope } = await import("./public-events");
const { decideFields, snapshotOf, intakeSchema } = await import("./enquiry-intake.service");
const { nextStatus } = await import("./integration-registry.service");
const { keyState } = await import("./sm-api-keys.service");
const { SM_WF_EVENT_TYPES } = await import("@/modules/sales-marketing/workflows/sm-workflow-registry");

describe("registry lifecycle", () => {
  it("REVOKED is final; DISABLED only by a person for API clients; illegal moves are refused", () => {
    expect(R.INTEGRATION_TRANSITIONS.REVOKED).toEqual([]);
    expect(R.canIntegrationTransition("REVOKED", "CONNECTED")).toBe(false);
    expect(R.canIntegrationTransition("DRAFT", "CONNECTED")).toBe(false);
    expect(R.canIntegrationTransition("CONNECTED", "DEGRADED")).toBe(true);
    expect(nextStatus("API_CLIENT", "DISABLED", "CONNECTED")).toBe("DISABLED");
    expect(nextStatus("API_CLIENT", "DISABLED", "REVOKED")).toBe("REVOKED");
    expect(nextStatus("API_CLIENT", "REVOKED", "CONNECTED")).toBe("REVOKED");
    expect(nextStatus("WEBHOOK_SUBSCRIPTION", "DISABLED", "PENDING_VERIFICATION")).toBe("PENDING_VERIFICATION");
    expect(nextStatus("DELIVERY_PROVIDER", "DRAFT", "CONNECTED")).toBe("DRAFT");
    expect(nextStatus("DELIVERY_PROVIDER", null, "CONFIGURED")).toBe("CONFIGURED");
  });

  it("key state: revoked > expired > owner inactive > active", () => {
    const now = new Date("2026-11-06T00:00:00Z");
    expect(keyState({ revokedAt: now, expiresAt: null, createdBy: { status: "ACTIVE" } }, now)).toBe("REVOKED");
    expect(keyState({ revokedAt: null, expiresAt: new Date(now.getTime() - 1), createdBy: { status: "ACTIVE" } }, now)).toBe("EXPIRED");
    expect(keyState({ revokedAt: null, expiresAt: null, createdBy: { status: "INACTIVE" } }, now)).toBe("OWNER_INACTIVE");
    expect(keyState({ revokedAt: null, expiresAt: new Date(now.getTime() + 1), createdBy: { status: "ACTIVE" } }, now)).toBe("ACTIVE");
  });

  it("every scope maps to a real module action", () => {
    for (const [scope, def] of Object.entries(R.SM_API_SCOPES)) {
      expect(MODULE_ACTIONS_FOR_TEST[def.permission.module], scope).toContain(def.permission.action);
    }
  });
});

describe("public event contract", () => {
  it("every published type comes from a real Phase 15 event or a workflow transition", () => {
    for (const t of R.SM_PUBLIC_EVENT_TYPES) {
      if (t.startsWith("sm.workflow.")) continue;
      expect(SM_WF_EVENT_TYPES[t.slice(3) as keyof typeof SM_WF_EVENT_TYPES], t).toBeTruthy();
    }
    // Internal-only types are not published.
    expect(R.INTERNAL_TO_PUBLIC["campaign.changed"]).toBeUndefined();
    expect(R.INTERNAL_TO_PUBLIC["quotation.withdrawn"]).toBeUndefined();
    expect(R.INTERNAL_TO_PUBLIC["quotation.accepted"]).toBe("sm.quotation.accepted");
  });

  it("payloads keep only documented scalar keys", () => {
    expect(minimalPayload("sm.budget.alert_raised", { kind: "OVER_BUDGET", campaignId: "c", message: "secret note", amount: 1200 })).toEqual({ kind: "OVER_BUDGET", campaignId: "c" });
    expect(minimalPayload("sm.campaign.approved", { eventType: "APPROVED", owner: "Asha" })).toEqual({});
    expect(minimalPayload("sm.bulk.job_finished", { status: "FAILED", recordType: { nested: true } })).toEqual({ status: "FAILED", recordType: "[object Object]" });
    expect((minimalPayload("sm.enquiry.qualified", { toStage: "x".repeat(500) }).toStage as string).length).toBe(200);
  });

  it("every type's sample validates against the published envelope schema", () => {
    for (const t of R.SM_PUBLIC_EVENT_TYPES) expect(() => sampleSmEnvelope(t), t).not.toThrow();
    const env = buildSmEnvelope({ id: crypto.randomUUID(), companyId: crypto.randomUUID(), eventType: "sm.quotation.accepted", eventVersion: 1, occurredAt: new Date(), entityType: "QUOTATION", entityId: crypto.randomUUID(), correlationId: null, payload: { revisionNumber: 2 } });
    expect(R.smPublicEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(R.smPublicEnvelopeSchema.safeParse({ ...env, extra: 1 }).success).toBe(false);
    expect(R.smPublicEnvelopeSchema.safeParse({ ...env, data: { ...env.data, payload: { nested: { a: 1 } } } }).success).toBe(false);
  });
});

describe("enquiry intake field ownership", () => {
  const base = { subject: "A", remarks: "R", priority: "NORMAL", prospectName: "P", prospectContactPerson: null, prospectEmail: "e@x.com", prospectPhone: null, prospectCountry: null, lines: "[]" };
  const erp = { ...base, lines: null };
  const decide = (incoming: Record<string, string | null>, last = base, e: Record<string, string | null> = erp, stage = "NEW") => Object.fromEntries(decideFields(incoming, last, e, stage).map((d) => [d.field, d.action === "conflict" ? `conflict:${d.reason}` : d.action]));

  it("applies an intake field nobody changed in the ERP while at intake", () => {
    expect(decide({ ...base, subject: "B" }).subject).toBe("apply");
    expect(decide({ ...base }).subject).toBe("unchanged");
  });
  it("conflicts when the ERP changed it, when past intake, or for create-only fields", () => {
    expect(decide({ ...base, remarks: "R2" }, base, { ...erp, remarks: "edited in ERP" }).remarks).toBe("conflict:ERP_CHANGED");
    expect(decide({ ...base, subject: "B" }, base, erp, "QUALIFIED").subject).toBe("conflict:RECORD_ADVANCED");
    expect(decide({ ...base, prospectEmail: "n@x.com" }).prospectEmail).toBe("conflict:NOT_UPDATABLE");
    expect(decide({ ...base, lines: "[1]" }).lines).toBe("conflict:NOT_UPDATABLE");
  });
  it("an unchanged external value never conflicts, even if the ERP differs", () => {
    expect(decide({ ...base }, base, { ...erp, remarks: "edited" }).remarks).toBe("unchanged");
  });
  it("omitted priority is the ERP default; empty strings are null", () => {
    const s = snapshotOf({ subject: "", lines: [{ styleName: "Polo", quantity: 1 }] } as never);
    expect(s.priority).toBe("NORMAL");
    expect(s.subject).toBeNull();
  });
  it("intake schema: strict, bounded, system id format", () => {
    const ok = { system: "website", externalId: "1", enquiry: { prospect: { name: "P" }, lines: [{ styleName: "x" }] } };
    expect(intakeSchema.safeParse(ok).success).toBe(true);
    expect(intakeSchema.safeParse({ ...ok, system: "Web Site" }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...ok, enquiry: { ...ok.enquiry, lines: [] } }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...ok, enquiry: { ...ok.enquiry, lines: Array.from({ length: 51 }, () => ({ styleName: "x" })) } }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...ok, enquiry: { ...ok.enquiry, ownerUserId: crypto.randomUUID() } }).success).toBe(false);
  });
});
