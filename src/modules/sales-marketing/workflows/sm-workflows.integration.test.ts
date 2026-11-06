/**
 * Sales & Marketing Phase 15 — workflow orchestration against a real, migrated
 * Postgres database: event-triggered starts from committed S&M events,
 * duplicate events, CRM tasks, the quotation approval and Phase 04 conversion,
 * campaign readiness / approval / launch, budget exceptions, processing
 * follow-up, crash recovery, run-as permission revocation, operator actions,
 * compensation, tenant isolation and audit.
 *
 * Skipped unless CRM_IT_DATABASE_URL points at a DISPOSABLE database. Each run
 * uses its own company (workflow definitions are per company). Permissions are
 * mocked: allowed unless a test denies them; approving one's own work is not.
 * Budget alerts and attribution / bulk results are synthetic fixtures written
 * to their tables (the real Phase 12/13/14 engines are covered by their own tests).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const DB_URL = process.env.CRM_IT_DATABASE_URL;
if (DB_URL) process.env.DATABASE_URL = DB_URL;
delete process.env.REDIS_URL;

const denied = new Set<string>(); // "userId:module.action"
const can = async (userId: string, module: string, action: string, ctx?: { createdBy?: string }) => {
  if (denied.has(`${userId}:${module}.${action}`)) return false;
  if ((action === "approve" || action === "reject") && ctx?.createdBy === userId) return false;
  return true;
};
vi.mock("@/core/rbac/PermissionService", () => ({
  PermissionService: {
    can: vi.fn(can),
    assert: vi.fn(async (userId: string, module: string, action: string, ctx?: { createdBy?: string }) => {
      if (!(await can(userId, module, action, ctx))) {
        const { BusinessRuleError } = await import("@/core/errors/BusinessRuleError");
        throw new BusinessRuleError("PERMISSION_DENIED", "denied");
      }
    }),
    assertAny: vi.fn(async () => undefined),
    getAllowedBranchIds: vi.fn(async () => null),
    invalidate: vi.fn(),
  },
}));

type Actor = { companyId: string; userId: string; branchId: string | null };

describe.skipIf(!DB_URL)("S&M workflows (database integration)", async () => {
  const { prisma } = await import("@/core/db/client");
  const wf = await import("./sm-workflows.service");
  const engine = await import("./sm-workflow-engine");
  const quotes = await import("@/modules/sales-marketing/quotations/quotation.service");
  const life = await import("@/modules/sales-marketing/quotations/quotation-lifecycle.service");
  const conv = await import("@/modules/sales-marketing/quotations/quotation-conversion.service");
  const enquiries = await import("@/modules/sales-marketing/enquiries/sales-enquiry.service");
  const campaigns = await import("@/modules/sales-marketing/campaigns/campaign.service");
  const lookups = await import("@/modules/sales-marketing/campaigns/campaign-lookup.service");
  const settings = await import("@/modules/sales-marketing/settings/sales-marketing-settings.service");
  const activities = await import("@/modules/crm/activities/crm-activities.service");

  const run = `w${Date.now().toString(36)}`;
  let admin: Actor, rep: Actor, approver: Actor, outsider: Actor;
  let customer = "", buyer = "", gst5 = "", style = "", variant = "";
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const expectCode = (p: Promise<unknown>, code: string) =>
    code === "VALIDATION_ERROR"
      ? p.then(
          () => expect.unreachable("expected a validation error"),
          (e: { name?: string; code?: string }) => expect(e.name === "ZodError" || e.code === "VALIDATION_ERROR").toBe(true)
        )
      : expect(p).rejects.toMatchObject({ code });
  const later = (ms: number) => new Date(Date.now() + ms);
  const tick = (now = new Date()) => engine.tickSmWorkflows(now);
  const instanceOf = (entityId: string, workflowKey: string) => prisma.smWorkflowInstance.findFirstOrThrow({ where: { companyId: admin.companyId, entityId, workflowKey }, orderBy: { createdAt: "desc" } });
  const tasksOn = (entityId: string) => prisma.crmActivity.findMany({ where: { companyId: admin.companyId, entityId, source: "SM_WORKFLOW" } });
  const activate = async (key: string, s: Record<string, unknown> = {}, entry: unknown = { kind: "group", logic: "AND", conditions: [] }) => {
    const d = await wf.getDefinition(admin, key);
    const saved = await wf.saveDraft(admin, key, { version: d.version, settings: { ...(d.draft?.settings ?? d.activeVersion?.settings ?? {}), ...s }, conditions: { entry } });
    return wf.activateDefinition(admin, key, { version: saved.version });
  };
  const notes = (userId: string, title: string) => prisma.notification.count({ where: { userId, title: { contains: title } } });
  const accepted = async () => {
    const q = await quotes.createQuotation(rep, { customerId: customer, buyerId: buyer, title: `${run} order`, quotationDate: today, validUntil: plusDays(30), lines: [{ productId: style, description: "Polo", quantity: 12, unitPrice: 100, taxRateId: gst5 }] } as never);
    await life.issueQuotation(rep, q.id, {});
    await life.recordAcceptance(rep, q.id, { decisionDate: today, method: "PURCHASE_ORDER", customerReference: "PO-1" });
    return q.id;
  };
  const convert = async (id: string) => {
    const plan = await conv.getConversionPlan(rep, id);
    return conv.convertQuotationToSalesOrder(rep, id, {
      customerId: plan.customerId,
      buyerId: plan.buyerId ?? "",
      orderDate: today,
      requiredShipDate: plan.requiredShipDate ?? "",
      customerPoNumber: plan.customerPoNumber ?? "",
      quotationLineIds: plan.lines.map((l) => l.quotationLineId),
      items: plan.lines.map((l) => ({ productId: l.productId!, sampleRequestId: "", unitPrice: 1, notes: "", breakdown: [{ productVariantId: variant, orderedQuantity: l.pieces! }] })),
    });
  };
  const campaign = async (code: string, extra: Record<string, unknown> = {}) => {
    const all = await prisma.marketingCampaignLookup.findMany({ where: { companyId: admin.companyId } });
    return prisma.marketingCampaign.create({
      data: { companyId: admin.companyId, code: `${code}-${run}`.toUpperCase(), name: code, typeId: all.find((l) => l.kind === "TYPE")!.id, objectiveId: all.find((l) => l.kind === "OBJECTIVE")!.id, ownerUserId: rep.userId, status: "DRAFT", plannedStartDate: new Date(`${today}T00:00:00Z`), plannedEndDate: new Date(`${plusDays(30)}T00:00:00Z`), plannedBudget: 10000, currencyCode: "INR", createdByUserId: rep.userId, updatedByUserId: rep.userId, ...extra },
    });
  };

  beforeAll(async () => {
    // Our own company: definitions are per company, and no other suite's events can start anything here.
    const company = await prisma.company.create({ data: { name: `Workflow Co ${run}`, baseCurrencyCode: "INR" } });
    const mk = (n: string, companyId = company.id) => prisma.user.create({ data: { companyId, email: `${n}.${run}@wf-it.local`, passwordHash: "x", fullName: `${n} ${run}` } });
    const [a, r, ap] = await Promise.all([mk("admin"), mk("rep"), mk("approver")]);
    const actor = (id: string) => ({ companyId: company.id, userId: id, branchId: null });
    [admin, rep, approver] = [actor(a.id), actor(r.id), actor(ap.id)];
    const other = await prisma.company.create({ data: { name: `Other ${run}`, baseCurrencyCode: "INR" } });
    outsider = { companyId: other.id, userId: (await mk("outsider", other.id)).id, branchId: null };
    await settings.updateSalesMarketingSettings(admin, { quotationApprovalMaxDiscountPercent: 10, quotationApprovalMaxTotal: 500000, quotationDefaultValidityDays: 30, quotationDefaultTerms: "" });
    const c = await prisma.customer.create({ data: { companyId: company.id, code: `WF-${run}`, name: `Workflow Customer ${run}`, buyers: { create: { companyId: company.id, code: `WFB-${run}`, name: `Buyer ${run}` } } }, include: { buyers: true } });
    customer = c.id;
    buyer = c.buyers[0].id;
    const taxType = await prisma.taxType.create({ data: { companyId: company.id, code: `GSTW-${run}`, name: "GST" } });
    gst5 = (await prisma.taxRate.create({ data: { companyId: company.id, taxTypeId: taxType.id, name: `GST 5% ${run}`, ratePercentage: "5", effectiveFrom: new Date("2020-01-01") } })).id;
    const pcs = await prisma.unitOfMeasure.findFirstOrThrow({ where: { code: "PCS" } });
    style = (await prisma.product.create({ data: { companyId: company.id, styleCode: `WFP-${run}`, styleName: `Polo ${run}`, itemType: "STYLE", baseUomId: pcs.id } })).id;
    const col = await prisma.color.create({ data: { companyId: company.id, code: `NV-${run}`, name: `Navy ${run}` } });
    const sz = await prisma.size.create({ data: { companyId: company.id, code: `M-${run}`, name: `M ${run}`, sortOrder: 1 } });
    variant = (await prisma.productVariant.create({ data: { productId: style, colorId: col.id, sizeId: sz.id, skuCode: `WFP-${run}-NV-M` } })).id;
    await lookups.ensureCampaignLookups(company.id);
  });

  afterAll(async () => {
    await prisma.smWorkflowDefinition.updateMany({ where: { companyId: admin.companyId }, data: { status: "INACTIVE" } });
    await prisma.$disconnect();
  });

  it("definitions: off by default, typed settings, allow-listed conditions, activation by a permitted user, frozen versions", async () => {
    const list = await wf.listDefinitions(admin);
    expect(list.map((d) => [d.key, d.status])).toEqual([
      ["quotation_follow_up", "INACTIVE"],
      ["quotation_to_order", "INACTIVE"],
      ["campaign_readiness", "INACTIVE"],
      ["budget_exception", "INACTIVE"],
      ["processing_follow_up", "INACTIVE"],
    ]);
    const d = await wf.getDefinition(admin, "quotation_to_order");
    expect(d.draft?.settings).toMatchObject({ createTask: true, convertDueDays: 2 });
    await expectCode(wf.saveDraft(admin, "quotation_to_order", { version: d.version, settings: { convertDueDays: 0 }, conditions: { entry: { kind: "group", logic: "AND", conditions: [] } } }), "VALIDATION_ERROR");
    await expectCode(wf.saveDraft(admin, "quotation_to_order", { version: d.version, settings: {}, conditions: { entry: { kind: "group", logic: "AND", conditions: [{ kind: "condition", field: "quotation.internalNotes", operator: "eq", value: "x" }] } } }), "VALIDATION_ERROR");
    await expectCode(wf.saveDraft(admin, "quotation_to_order", { version: d.version, settings: { notifyUserIds: [outsider.userId] }, conditions: { entry: { kind: "group", logic: "AND", conditions: [] } } }), "VALIDATION_ERROR"); // another company's user
    await expectCode(wf.getDefinition(admin, "drop_tables"), "NOT_FOUND");

    // The activator becomes the run-as user and must hold what the actions need.
    denied.add(`${admin.userId}:sales_orders.view`);
    await expectCode(activate("quotation_to_order", {}, { kind: "group", logic: "AND", conditions: [{ kind: "condition", field: "quotation.grandTotal", operator: "gt", value: 0 }] }), "PERMISSION_DENIED");
    denied.delete(`${admin.userId}:sales_orders.view`);
    const on = await activate("quotation_to_order", {}, { kind: "group", logic: "AND", conditions: [{ kind: "condition", field: "quotation.grandTotal", operator: "gt", value: 0 }] });
    expect(on).toMatchObject({ status: "ACTIVE", runAs: { id: admin.userId }, activeVersion: { status: "ACTIVE" }, draft: null });
    // An activated version can't change (DB trigger).
    await expect(prisma.smWorkflowDefinitionVersion.update({ where: { id: on.activeVersion!.id }, data: { settings: { convertDueDays: 9 } } })).rejects.toThrow();
    // Editing makes a new draft; the active version keeps running.
    const v2 = await wf.saveDraft(admin, "quotation_to_order", { version: on.version, settings: { ...on.activeVersion!.settings, convertDueDays: 3 }, conditions: on.activeVersion!.conditions, changeNote: "3 days" });
    expect([v2.activeVersion?.versionNumber, v2.draft?.versionNumber]).toEqual([on.activeVersion!.versionNumber, on.activeVersion!.versionNumber + 1]);
    expect(await prisma.auditLog.count({ where: { tableName: "sm_workflow_definitions", companyId: admin.companyId } })).toBeGreaterThanOrEqual(2);
  });

  it("accepted quotation → Sales Order: started by the committed event once, task for the owner, conversion through Phase 04, recorded and completed", async () => {
    const id = await accepted();
    const t1 = await tick();
    expect(t1.started).toBeGreaterThanOrEqual(1);
    let inst = await instanceOf(id, "quotation_to_order");
    expect(inst).toMatchObject({ status: "WAITING_EVENT", currentStep: "await_order", triggerSource: "EVENT", entityType: "QUOTATION" });
    const [task] = await tasksOn(id);
    expect(task).toMatchObject({ entityType: "QUOTATION", assignedToUserId: rep.userId, status: "PENDING" });

    // Duplicate delivery: re-reading the same events (checkpoint reset) starts nothing new; a manual start returns the live one.
    await prisma.smWorkflowCheckpoint.deleteMany({ where: { source: "quotation" } });
    expect((await tick()).started).toBe(0);
    expect(await prisma.smWorkflowInstance.count({ where: { entityId: id, workflowKey: "quotation_to_order" } })).toBe(1);
    expect((await wf.startWorkflowManually(admin, "quotation_to_order", { entityId: id })).created).toBe(false);

    const order = await convert(id); // a person converts on the quotation (Phase 04)
    await tick(); // quotation.converted wakes it
    inst = await instanceOf(id, "quotation_to_order");
    expect(inst).toMatchObject({ status: "COMPLETED", outcome: "CONVERTED" });
    expect((inst.context as { orderNumber?: string }).orderNumber).toBe(order.orderNumber);
    expect((await tasksOn(id))[0].status).toBe("COMPLETED");
    expect(await prisma.salesOrder.count({ where: { sourceQuotationRevision: { quotationId: id } } })).toBe(1);
    const steps = await prisma.smWorkflowStepRun.findMany({ where: { instanceId: inst.id }, orderBy: { sequence: "asc" } });
    expect(steps.map((s) => [s.stepKey, s.status])).toEqual([["check", "DONE"], ["task", "DONE"], ["await_order", "DONE"], ["record_order", "DONE"], ["finish", "DONE"]]);
    expect(await prisma.auditLog.count({ where: { tableName: "sm_workflow_instances", recordId: inst.id } })).toBeGreaterThanOrEqual(2);
  });

  it("reconciles an order that already exists instead of asking for another conversion", async () => {
    const id = await accepted();
    await prisma.smWorkflowDefinition.update({ where: { companyId_workflowKey: { companyId: admin.companyId, workflowKey: "quotation_to_order" } }, data: { status: "INACTIVE" } });
    await convert(id);
    await tick();
    await prisma.smWorkflowDefinition.update({ where: { companyId_workflowKey: { companyId: admin.companyId, workflowKey: "quotation_to_order" } }, data: { status: "ACTIVE" } });
    const started = await wf.startWorkflowManually(admin, "quotation_to_order", { entityId: id });
    expect(started).toMatchObject({ status: "COMPLETED", outcome: "CONVERTED", triggerSource: "MANUAL" });
    expect(await tasksOn(id)).toHaveLength(0);
  });

  it("crash between an action and its checkpoint: the lease expires, the step re-runs, and the task is not duplicated", async () => {
    const id = await accepted();
    const def = await prisma.smWorkflowDefinition.findFirstOrThrow({ where: { companyId: admin.companyId, workflowKey: "quotation_to_order" }, include: { activeVersion: true } });
    const { instance } = await engine.startInstance(def, { entityType: "QUOTATION", entityId: id }, { source: "MANUAL", eventKey: null, userId: admin.userId, event: null });
    await expect(engine.runInstance(instance.id, { crashAfterStep: "task" })).rejects.toThrow("simulated crash");
    expect(await tasksOn(id)).toHaveLength(1);
    expect(await engine.runInstance(instance.id)).toBeNull(); // another worker holds the (live) lease
    expect(await engine.runInstance(instance.id, { now: later(6 * 60_000) })).toBe("WAITING_EVENT"); // lease expired
    expect(await tasksOn(id)).toHaveLength(1);
    // Two workers at once: only one runs it.
    await prisma.smWorkflowInstance.update({ where: { id: instance.id }, data: { nextRunAt: new Date() } });
    const both = await Promise.all([engine.runInstance(instance.id, { now: later(7 * 60_000) }), engine.runInstance(instance.id, { now: later(7 * 60_000) })]);
    expect(both.filter((s) => s !== null)).toHaveLength(1);

    // Operator cancel: compensation cancels the open task; nothing else changes.
    await expectCode(wf.instanceAction(admin, instance.id, { action: "resolve" }), "VALIDATION_ERROR");
    const cancelled = await wf.instanceAction(admin, instance.id, { action: "cancel", note: "Handled by phone" });
    expect(cancelled).toMatchObject({ status: "CANCELLED", compensationStatus: "DONE" });
    expect((await tasksOn(id))[0].status).toBe("CANCELLED");
    expect((await prisma.quotation.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");
    await expectCode(wf.instanceAction(admin, instance.id, { action: "cancel" }), "INVALID_STATE_TRANSITION");
    // Another company can't see it; operator actions need sales_workflows.approve.
    await expectCode(wf.getInstance(outsider, instance.id), "NOT_FOUND");
    denied.add(`${rep.userId}:sales_workflows.approve`);
    await expectCode(wf.instanceAction(rep, instance.id, { action: "retry" }), "PERMISSION_DENIED");
    denied.delete(`${rep.userId}:sales_workflows.approve`);
  });

  it("qualified enquiry → quotation: owner task, approval reminders (never the preparer, exactly once), completes on approval", async () => {
    await activate("quotation_follow_up", { approvalReminderHours: 1, escalationUserIds: [] });
    const e = await enquiries.createSalesEnquiry(admin, { customerId: customer, enquiryDate: today, subject: `${run} qualify`, ownerUserId: rep.userId, lines: [{ productId: style, targetQuantity: 100 }] });
    await enquiries.changeSalesEnquiryStage(admin, e.id, { stage: "QUALIFIED" });
    await tick();
    let inst = await instanceOf(e.id, "quotation_follow_up");
    expect(inst).toMatchObject({ status: "WAITING_EVENT", currentStep: "await_quotation" });
    expect((await tasksOn(e.id))[0]).toMatchObject({ entityType: "ENQUIRY", assignedToUserId: rep.userId });

    // 12% discount → needs approval under the 10% limit.
    const q = await quotes.createQuotation(rep, { buyerEnquiryId: e.id, customerId: customer, title: `${run} from enquiry`, quotationDate: today, validUntil: plusDays(30), lines: [{ productId: style, description: "Polo", quantity: 100, unitPrice: 100, discountPercent: 12, taxRateId: gst5 }] } as never);
    await tick();
    await life.submitForApproval(rep, q.id, {});
    await tick();
    inst = await instanceOf(e.id, "quotation_follow_up");
    expect(inst).toMatchObject({ status: "WAITING_APPROVAL", currentStep: "await_approval" });
    // Reminder after the configured hour — to approvers, never the preparer; exactly once.
    await tick(later(2 * 3600_000));
    await tick(later(3 * 3600_000));
    expect(await notes(approver.userId, "waiting for your approval")).toBe(1);
    expect(await notes(rep.userId, "waiting for your approval")).toBe(0);

    await life.approveQuotation(approver, q.id, {});
    await tick();
    inst = await instanceOf(e.id, "quotation_follow_up");
    expect(inst).toMatchObject({ status: "COMPLETED", outcome: "QUOTED" });
    expect((await tasksOn(e.id))[0].status).toBe("COMPLETED");
    // The workflow never approved anything itself.
    expect((await prisma.quotationRevision.findFirstOrThrow({ where: { quotationId: q.id } })).approvedByUserId).toBe(approver.userId);
  });

  it("campaign readiness: checks budget/content, waits while not ready, follows the approval, tells the owner, completes on activation", async () => {
    await activate("campaign_readiness", { requireAudience: false, requireChannels: false, requireApprovedContent: true, requireBudget: true, recheckHours: 1 });
    const c = await campaign("RDY");
    const alert = await prisma.marketingBudgetAlert.create({ data: { companyId: admin.companyId, campaignId: c.id, scopeKey: "TOTAL", kind: "WARN_THRESHOLD", message: "80% used" } });
    await campaigns.campaignAction(rep, c.id, "submit", {});
    await tick();
    let inst = await instanceOf(c.id, "campaign_readiness");
    expect(inst).toMatchObject({ status: "WAITING_EVENT", currentStep: "readiness" });
    expect((inst.context as { checklist: { key: string; ok: boolean }[] }).checklist.find((i) => i.key === "budget")?.ok).toBe(false);
    expect((await tasksOn(c.id))[0]).toMatchObject({ entityType: "CAMPAIGN", assignedToUserId: rep.userId, status: "PENDING" });

    await prisma.marketingBudgetAlert.update({ where: { id: alert.id }, data: { status: "CLEARED", clearedAt: new Date() } });
    await tick(); // budget.alert_cleared wakes it
    inst = await instanceOf(c.id, "campaign_readiness");
    expect(inst).toMatchObject({ status: "WAITING_APPROVAL", currentStep: "await_approval" });
    expect((await tasksOn(c.id))[0].status).toBe("COMPLETED");

    await campaigns.campaignAction(approver, c.id, "approve", {});
    await tick();
    inst = await instanceOf(c.id, "campaign_readiness");
    expect(inst).toMatchObject({ status: "WAITING_EVENT", currentStep: "await_launch" });
    expect(await notes(rep.userId, `is approved and ready`)).toBe(1);
    expect((await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("APPROVED"); // never activated by the workflow

    await campaigns.campaignAction(rep, c.id, "activate", {});
    await tick();
    expect(await instanceOf(c.id, "campaign_readiness")).toMatchObject({ status: "COMPLETED", outcome: "LAUNCHED" });
  });

  it("budget exception: review task + reviewers notified; completes when reviewed or when the alert clears; no financial change", async () => {
    await activate("budget_exception", { reviewerUserIds: [approver.userId] });
    const c = await campaign("BDG", { status: "ACTIVE", approvedRevisionNumber: 1, actualStartDate: new Date(`${today}T00:00:00Z`) });
    const a1 = await prisma.marketingBudgetAlert.create({ data: { companyId: admin.companyId, campaignId: c.id, scopeKey: "TOTAL", kind: "OVER_BUDGET", message: "Over budget" } });
    await tick();
    const i1 = await instanceOf(a1.id, "budget_exception");
    expect(i1).toMatchObject({ status: "WAITING_EVENT", currentStep: "await_resolution", entityType: "BUDGET_ALERT" });
    expect(await notes(approver.userId, "Budget exception")).toBe(1);
    const [task] = await tasksOn(c.id);
    await activities.completeActivity(rep, task.id, { outcome: "Agreed overrun" });
    await tick(later(7 * 3600_000)); // periodic re-check
    expect(await instanceOf(a1.id, "budget_exception")).toMatchObject({ status: "COMPLETED", outcome: "REVIEWED" });

    const a2 = await prisma.marketingBudgetAlert.create({ data: { companyId: admin.companyId, campaignId: c.id, scopeKey: "LINE", kind: "WARN_THRESHOLD", message: "Line at 85%" } });
    await tick();
    await prisma.marketingBudgetAlert.update({ where: { id: a2.id }, data: { status: "CLEARED", clearedAt: new Date() } });
    await tick();
    expect(await instanceOf(a2.id, "budget_exception")).toMatchObject({ status: "COMPLETED", outcome: "CLEARED" });
    expect(Number((await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: c.id } })).plannedBudget)).toBe(10000);
  });

  it("processing follow-up: only exceptions start it; a later successful run resolves it", async () => {
    await activate("processing_follow_up", { unattributedShareAbove: 50 });
    const m = await prisma.marketingAttributionModel.create({ data: { companyId: admin.companyId, code: `M-${run}`.toUpperCase(), name: "Model", ownerUserId: rep.userId, createdByUserId: rep.userId } });
    const v = await prisma.marketingAttributionModelVersion.create({ data: { companyId: admin.companyId, modelId: m.id, versionNumber: 1, status: "DRAFT", modelType: "LINEAR", windowDays: 30, touchpointTypes: ["MESSAGE_SENT"], conversionTypes: ["SALES_ORDER_BOOKED"], createdByUserId: rep.userId } as never });
    const runRow = (status: string, conversions: number, unattributed: number, at: Date) =>
      prisma.marketingAttributionRun.create({ data: { companyId: admin.companyId, modelId: m.id, modelVersionId: v.id, periodFrom: new Date("2026-10-01"), periodTo: new Date("2026-10-31"), status, trigger: "MANUAL", requestedByUserId: admin.userId, conversions, unattributed, finishedAt: at, error: status === "FAILED" ? "boom" : null } });
    const fine = await runRow("COMPLETED", 10, 2, new Date());
    const bad = await runRow("COMPLETED", 10, 8, new Date());
    await tick();
    expect(await prisma.smWorkflowInstance.count({ where: { entityId: fine.id } })).toBe(0);
    const inst = await instanceOf(bad.id, "processing_follow_up");
    expect(inst).toMatchObject({ status: "WAITING_EVENT", entityType: "ATTRIBUTION_RUN" });
    expect(await notes(admin.userId, "needs attention")).toBe(1);
    await runRow("COMPLETED", 10, 1, later(1000));
    await tick(later(2000));
    expect(await instanceOf(bad.id, "processing_follow_up")).toMatchObject({ status: "COMPLETED", outcome: "RESOLVED_BY_RERUN" });
  });

  it("run-as permission revoked: the instance stops for a person; retry after it is restored continues", async () => {
    const id = await accepted();
    await tick();
    const inst = await instanceOf(id, "quotation_to_order");
    denied.add(`${admin.userId}:sales_quotations.view_all`);
    await prisma.smWorkflowInstance.update({ where: { id: inst.id }, data: { nextRunAt: new Date() } });
    expect(await engine.runInstance(inst.id)).toBe("NEEDS_ATTENTION");
    expect(await instanceOf(id, "quotation_to_order")).toMatchObject({ errorCode: "RUN_AS_INVALID" });
    denied.delete(`${admin.userId}:sales_quotations.view_all`);
    const retried = await wf.instanceAction(admin, inst.id, { action: "retry", note: "Permission restored" });
    expect(retried.status).toBe("WAITING_EVENT");
    const m = await wf.workflowMetrics(admin);
    expect(m.waiting).toBeGreaterThanOrEqual(1);
    expect(m.byWorkflow.find((b) => b.key === "quotation_to_order")!.live).toBeGreaterThanOrEqual(1);
  });

  it("definitions and instances are per company", async () => {
    const list = await wf.listInstances(outsider, {}, { skip: 0, take: 50 });
    expect(list.totalCount).toBe(0);
    expect((await wf.listDefinitions(outsider)).every((d) => d.status === "INACTIVE")).toBe(true);
  });
});
