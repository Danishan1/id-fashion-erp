import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { canSeeCampaign } from "@/modules/sales-marketing/campaigns/campaign-common";
import { listCampaignChannels } from "@/modules/sales-marketing/delivery/delivery-run.service";
import { resolveCampaignAudience } from "@/modules/sales-marketing/delivery/audience-eligibility";
import { assertSalesEnquiryVisible } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { getConversionPlan } from "@/modules/sales-marketing/quotations/quotation-conversion.service";
import { assertQuotationVisible } from "@/modules/sales-marketing/quotations/quotation.service";
import { registerWorkflowImpl, type StepCtx, type WorkflowImpl } from "./sm-workflow-engine";
import { smWfKey, type SmWfSettings } from "./sm-workflow-registry";
import { approversFor, closeTasks, DAY_MS, ensureTask, HOUR_MS, nextCheck, taskStatus } from "./sm-workflow-steps";

/**
 * Phase 15 — the five S&M workflows. Every step reads the AUTHORITATIVE record
 * (through the module's own visibility check as the run-as user) and acts only
 * through module services (CRM tasks, notifications). Nothing here creates a
 * quotation or an order, approves anything, activates a campaign, changes a
 * budget or sends a marketing message: people do that on the module screens,
 * and the workflow notices (by event, and by re-checking).
 */

const SIX_HOURS = 6 * HOUR_MS;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// ── A. Qualified enquiry → approved quotation ────────────────────

type A = SmWfSettings<"quotation_follow_up">;
const CLOSED_STAGES = ["WON", "LOST", "NOT_QUALIFIED"];

async function loadEnquiry(ctx: StepCtx) {
  await assertSalesEnquiryVisible(ctx.runAs, ctx.instance.entityId);
  return prisma.buyerEnquiry.findFirstOrThrow({ where: { id: ctx.instance.entityId, companyId: ctx.instance.companyId }, select: { id: true, enquiryNumber: true, ownerUserId: true, salesStage: true, status: true } });
}
const enquiryClosed = (e: { salesStage: string; status: string }) => CLOSED_STAGES.includes(e.salesStage) || e.status === "CANCELLED";

async function ownerReminders(ctx: StepCtx, s: { remindAfterDays: number; escalateAfterDays: number; escalationUserIds: string[] }, owner: string | null, what: { title: string; body: string; module: string; relatedModule?: "BUYER_ENQUIRY" | "QUOTATION"; relatedRecordId?: string }, escalationTitle: string) {
  const r1 = await ctx.remindOnce("remind", s.remindAfterDays * DAY_MS, [owner], what);
  const r2 = await ctx.remindOnce("escalate", s.escalateAfterDays * DAY_MS, s.escalationUserIds, { ...what, title: escalationTitle });
  return [r1, r2];
}

const quotationFollowUp: WorkflowImpl = {
  key: "quotation_follow_up",
  label: async (companyId, _t, id) => (await prisma.buyerEnquiry.findFirst({ where: { id, companyId }, select: { enquiryNumber: true } }))?.enquiryNumber ?? null,
  snapshot: async (companyId, _t, id) => {
    const e = await prisma.buyerEnquiry.findFirst({ where: { id, companyId }, select: { priority: true, source: true, estimatedValue: true, customerId: true } });
    return e ? { "enquiry.priority": e.priority, "enquiry.source": e.source, "enquiry.estimatedValue": num(e.estimatedValue), "enquiry.hasCustomer": Boolean(e.customerId) } : null;
  },
  steps: {
    check: async (ctx) => {
      const s = ctx.settings as A;
      const e = await loadEnquiry(ctx);
      if (enquiryClosed(e)) return { type: "complete", outcome: "ENQUIRY_CLOSED", summary: `Enquiry ${e.enquiryNumber} is already closed.` };
      if (e.ownerUserId) return { type: "next", summary: `Enquiry ${e.enquiryNumber} is qualified and has an owner.`, result: { ownerUserId: e.ownerUserId } };
      // No owner: tell the escalation users (assignment stays a person's decision) and wait for one.
      await ctx.notify("no-owner", s.escalationUserIds, { title: `Qualified enquiry ${e.enquiryNumber} has no owner`, body: "Assign an owner in Sales & Marketing → Enquiries so a quotation can be prepared.", module: "sales_marketing", relatedModule: "BUYER_ENQUIRY", relatedRecordId: e.id });
      return { type: "wait", status: "WAITING_EVENT", recheckAt: nextCheck(ctx.now, SIX_HOURS), summary: "Waiting for an owner to be assigned." };
    },
    task: async (ctx) => {
      const s = ctx.settings as A;
      const e = await loadEnquiry(ctx);
      const t = await ensureTask(ctx, { key: "quote", entityType: "ENQUIRY", entityId: e.id, assigneeId: e.ownerUserId, subject: `Prepare a quotation for enquiry ${e.enquiryNumber}`, description: "The enquiry is qualified. Create the quotation from the enquiry page; it goes through the usual pricing and approval rules.", dueDays: s.quoteDueDays });
      if (!t.taskId) await ctx.notify("quote-needed", [e.ownerUserId], { title: `Enquiry ${e.enquiryNumber} is qualified — prepare a quotation`, body: "Create the quotation from the enquiry page.", module: "sales_marketing", relatedModule: "BUYER_ENQUIRY", relatedRecordId: e.id });
      return { type: "next", summary: t.note, result: { taskId: t.taskId } };
    },
    await_quotation: async (ctx) => {
      const s = ctx.settings as A;
      const e = await loadEnquiry(ctx);
      const q = await prisma.quotation.findFirst({ where: { companyId: ctx.instance.companyId, buyerEnquiryId: e.id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true, quotationNumber: true } });
      if (q) {
        ctx.data = { ...ctx.data, quotationId: q.id, quotationNumber: q.quotationNumber };
        ctx.watch(smWfKey("QUOTATION", q.id));
        return { type: "next", summary: `Quotation ${q.quotationNumber} started.`, result: { quotationId: q.id } };
      }
      if (enquiryClosed(e)) {
        await closeTasks(ctx, "cancel", "The enquiry was closed.");
        return { type: "complete", outcome: "ENQUIRY_CLOSED", summary: `Enquiry ${e.enquiryNumber} was closed before a quotation was made.` };
      }
      const due = await ownerReminders(ctx, s, e.ownerUserId, { title: `Reminder: quotation for enquiry ${e.enquiryNumber}`, body: "No quotation has been started yet.", module: "sales_marketing", relatedModule: "BUYER_ENQUIRY", relatedRecordId: e.id }, `Escalation: enquiry ${e.enquiryNumber} still has no quotation`);
      return { type: "wait", status: "WAITING_EVENT", recheckAt: nextCheck(ctx.now, SIX_HOURS, ...due), summary: "Waiting for a quotation to be started." };
    },
    await_approval: async (ctx) => {
      const s = ctx.settings as A;
      const qid = ctx.data.quotationId as string;
      await assertQuotationVisible(ctx.runAs, qid);
      const q = await prisma.quotation.findFirstOrThrow({ where: { id: qid, companyId: ctx.instance.companyId }, select: { id: true, quotationNumber: true, status: true, ownerUserId: true, currentRevisionNumber: true, revisions: { orderBy: { revisionNumber: "desc" }, take: 1, select: { createdByUserId: true, updatedByUserId: true, submittedByUserId: true } } } });
      const msgBase = { module: "sales_quotations", relatedModule: "QUOTATION" as const, relatedRecordId: q.id };
      switch (q.status) {
        case "APPROVED":
        case "ISSUED":
        case "ACCEPTED":
        case "CONVERTED":
          return { type: "next", summary: `Quotation ${q.quotationNumber} is ${q.status.toLowerCase()}.`, result: { quotationStatus: q.status } };
        case "REJECTED":
        case "CANCELLED":
          await closeTasks(ctx, "cancel", `Quotation ${q.quotationNumber} was ${q.status.toLowerCase()}.`);
          return { type: "complete", outcome: "QUOTATION_CLOSED", summary: `Quotation ${q.quotationNumber} was ${q.status.toLowerCase()}.` };
        case "PENDING_APPROVAL": {
          const rev = q.revisions[0];
          // Separation of duties: never the people who prepared or submitted it.
          const approvers = await approversFor(ctx.instance.companyId, "sales_quotations", [rev?.createdByUserId, rev?.updatedByUserId, rev?.submittedByUserId]);
          const r1 = await ctx.remindOnce(`approval-r${q.currentRevisionNumber}`, s.approvalReminderHours * HOUR_MS, approvers, { ...msgBase, title: `Quotation ${q.quotationNumber} is waiting for your approval`, body: "Approve or decline it on the quotation page." });
          const r2 = await ctx.remindOnce(`approval-esc-r${q.currentRevisionNumber}`, s.escalateAfterDays * DAY_MS, s.escalationUserIds, { ...msgBase, title: `Escalation: quotation ${q.quotationNumber} still awaits approval`, body: "It has been waiting for approval longer than expected." });
          return { type: "wait", status: "WAITING_APPROVAL", recheckAt: nextCheck(ctx.now, SIX_HOURS, r1, r2), summary: "Waiting for the quotation approval (decided on the quotation page)." };
        }
        default: {
          // DRAFT: not yet submitted / issued, or declined and back for changes.
          const due = await ownerReminders(ctx, s, q.ownerUserId, { ...msgBase, title: `Reminder: quotation ${q.quotationNumber} is still a draft`, body: "Submit it for approval or issue it." }, `Escalation: quotation ${q.quotationNumber} is still a draft`);
          return { type: "wait", status: "WAITING_EVENT", recheckAt: nextCheck(ctx.now, SIX_HOURS, ...due), summary: "Waiting for the draft to be submitted or issued." };
        }
      }
    },
    finish: async (ctx) => {
      const closed = await closeTasks(ctx, "complete", `Quotation ${ctx.data.quotationNumber ?? ""} is approved / issued.`);
      return { type: "complete", outcome: "QUOTED", summary: `Quotation ${ctx.data.quotationNumber ?? ""} reached approval / issue.${closed.length ? " Task closed." : ""}` };
    },
  },
  compensate: async (ctx) => `Cancelled tasks: ${(await closeTasks(ctx, "cancel", "The workflow was cancelled.")).length}.`,
};

// ── B. Accepted quotation → Sales Order ──────────────────────────

type B = SmWfSettings<"quotation_to_order">;

const quotationToOrder: WorkflowImpl = {
  key: "quotation_to_order",
  label: async (companyId, _t, id) => (await prisma.quotation.findFirst({ where: { id, companyId }, select: { quotationNumber: true } }))?.quotationNumber ?? null,
  snapshot: async (companyId, _t, id) => {
    const q = await prisma.quotation.findFirst({ where: { id, companyId }, select: { customerId: true, currentRevisionNumber: true, revisions: { orderBy: { revisionNumber: "desc" }, take: 1, select: { grandTotal: true } } } });
    return q ? { "quotation.grandTotal": num(q.revisions[0]?.grandTotal), "quotation.hasCustomer": Boolean(q.customerId) } : null;
  },
  steps: {
    check: async (ctx) => {
      const plan = await getConversionPlan(ctx.runAs, ctx.instance.entityId);
      ctx.data = { ...ctx.data, quotationNumber: plan.quotationNumber, revisionId: plan.revisionId, revisionNumber: plan.revisionNumber };
      // Reconcile first: an order may already exist for this quotation (converted by hand, a retry…).
      if (plan.existingOrder) return { type: "next", goto: "record_order", summary: `Order ${plan.existingOrder.orderNumber} already exists for this quotation.`, result: { orderId: plan.existingOrder.id } };
      if (plan.status !== "ACCEPTED") return { type: "complete", outcome: "NOT_ACCEPTED", summary: `Quotation ${plan.quotationNumber} is ${plan.status.toLowerCase().replace(/_/g, " ")} — nothing to convert.` };
      ctx.data = { ...ctx.data, blockers: plan.blockers };
      return { type: "next", summary: plan.blockers.length ? `Accepted; ${plan.blockers.length} thing(s) to fix before conversion.` : "Accepted and ready to convert.", result: { blockers: plan.blockers } };
    },
    task: async (ctx) => {
      const s = ctx.settings as B;
      const q = await prisma.quotation.findFirstOrThrow({ where: { id: ctx.instance.entityId, companyId: ctx.instance.companyId }, select: { id: true, quotationNumber: true, ownerUserId: true } });
      const blockers = (ctx.data.blockers as string[] | undefined) ?? [];
      const desc = `Open the quotation and choose "Convert to Sales Order" — enter the colour × size split; prices and terms come from the accepted revision.${blockers.length ? `\n\nFix first:\n- ${blockers.join("\n- ")}` : ""}`;
      const t = await ensureTask(ctx, { key: "convert", entityType: "QUOTATION", entityId: q.id, assigneeId: q.ownerUserId, subject: `Convert accepted quotation ${q.quotationNumber} to a Sales Order`, description: desc, dueDays: s.convertDueDays });
      if (!t.taskId) await ctx.notify("convert-needed", [q.ownerUserId], { title: `Quotation ${q.quotationNumber} was accepted — convert it to a Sales Order`, body: "Use Convert to Sales Order on the quotation page.", module: "sales_quotations", relatedModule: "QUOTATION", relatedRecordId: q.id });
      ctx.watch(smWfKey("QUOTATION", q.id));
      return { type: "next", summary: t.note, result: { taskId: t.taskId } };
    },
    await_order: async (ctx) => {
      const s = ctx.settings as B;
      await assertQuotationVisible(ctx.runAs, ctx.instance.entityId);
      const q = await prisma.quotation.findFirstOrThrow({ where: { id: ctx.instance.entityId, companyId: ctx.instance.companyId }, select: { id: true, quotationNumber: true, status: true, ownerUserId: true } });
      // The authoritative link: the order made from this quotation's revision (unique per revision, Phase 04).
      const order = await prisma.salesOrder.findFirst({ where: { companyId: ctx.instance.companyId, sourceQuotationRevision: { quotationId: q.id } }, select: { id: true, orderNumber: true } });
      if (order) return { type: "next", summary: `Sales Order ${order.orderNumber} was created.`, result: { orderId: order.id } };
      if (q.status === "CONVERTED") return { type: "attention", code: "RECONCILE_ORDER", summary: `Quotation ${q.quotationNumber} is marked converted but no Sales Order from it was found. Check it before continuing.` };
      if (q.status !== "ACCEPTED") {
        await closeTasks(ctx, "cancel", `Quotation ${q.quotationNumber} is no longer accepted.`);
        return { type: "complete", outcome: "NOT_ACCEPTED", summary: `Quotation ${q.quotationNumber} is ${q.status.toLowerCase()} — no conversion needed.` };
      }
      const msg = { module: "sales_quotations", relatedModule: "QUOTATION" as const, relatedRecordId: q.id };
      const r1 = await ctx.remindOnce("remind", s.remindAfterDays * DAY_MS, [q.ownerUserId], { ...msg, title: `Reminder: convert quotation ${q.quotationNumber}`, body: "The accepted quotation has not been converted to a Sales Order yet." });
      const r2 = await ctx.remindOnce("escalate", s.escalateAfterDays * DAY_MS, s.escalationUserIds, { ...msg, title: `Escalation: accepted quotation ${q.quotationNumber} not converted`, body: "It has been waiting for conversion longer than expected." });
      return { type: "wait", status: "WAITING_EVENT", recheckAt: nextCheck(ctx.now, SIX_HOURS, r1, r2), summary: "Waiting for the Sales Order (converted by a person on the quotation)." };
    },
    record_order: async (ctx) => {
      const s = ctx.settings as B;
      const order = await prisma.salesOrder.findFirstOrThrow({ where: { companyId: ctx.instance.companyId, sourceQuotationRevision: { quotationId: ctx.instance.entityId } }, select: { id: true, orderNumber: true, status: true } });
      ctx.data = { ...ctx.data, orderId: order.id, orderNumber: order.orderNumber };
      // The quotation owner is already told by the conversion itself; these are the extra people.
      await ctx.notify("converted", s.notifyUserIds, { title: `Quotation ${ctx.data.quotationNumber ?? ""} converted to Sales Order ${order.orderNumber}`, body: "Open the Sales Order for its details and status.", module: "sales_orders", relatedModule: "SALES_ORDER", relatedRecordId: order.id });
      return { type: "next", summary: `Recorded Sales Order ${order.orderNumber} (status ${order.status.toLowerCase()}, owned by the Sales Order module).`, result: { orderId: order.id, orderNumber: order.orderNumber } };
    },
    finish: async (ctx) => {
      const closed = await closeTasks(ctx, "complete", `Converted to Sales Order ${ctx.data.orderNumber ?? ""}.`);
      return { type: "complete", outcome: "CONVERTED", summary: `Converted to Sales Order ${ctx.data.orderNumber ?? ""}.${closed.length ? " Task closed." : ""}` };
    },
  },
  compensate: async (ctx) => `Cancelled tasks: ${(await closeTasks(ctx, "cancel", "The workflow was cancelled.")).length}.`,
};

// ── C. Campaign readiness and launch ─────────────────────────────

type C = SmWfSettings<"campaign_readiness">;

async function loadCampaign(ctx: StepCtx) {
  if (!(await canSeeCampaign(ctx.runAs, ctx.instance.entityId))) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.");
  return prisma.marketingCampaign.findFirstOrThrow({ where: { id: ctx.instance.entityId, companyId: ctx.instance.companyId }, select: { id: true, code: true, name: true, status: true, ownerUserId: true, plannedBudget: true, plannedStartDate: true } });
}

/** The readiness checklist, from the modules' own checks (Phase 09 audience, Phase 10 delivery checks, Phase 11 content approval, Phase 12 budget). */
export async function campaignChecklist(ctx: StepCtx, c: { id: string; plannedBudget: unknown }) {
  const s = ctx.settings as C;
  const items: { key: string; label: string; ok: boolean; detail: string }[] = [];
  if (s.requireAudience) {
    try {
      const a = await resolveCampaignAudience(ctx.instance.companyId, c.id);
      items.push({ key: "audience", label: "Audience", ok: a.contactIds.length > 0, detail: a.contactIds.length ? `${a.contactIds.length} contact(s) from ${a.segments.length} snapshot(s).` : "The audience snapshots contain no contacts." });
    } catch (e) {
      items.push({ key: "audience", label: "Audience", ok: false, detail: e instanceof BusinessRuleError ? e.message : "The audience could not be resolved." });
    }
  }
  if (s.requireChannels) {
    const { channels } = await listCampaignChannels(ctx.runAs, c.id);
    const active = channels.filter((ch) => ch.isActive);
    const problems = active.flatMap((ch) => ch.problems.map((p) => `${ch.connection.name}: ${p}`));
    items.push({ key: "channels", label: "Channels", ok: active.length > 0 && problems.length === 0, detail: !active.length ? "No active channel." : problems.length ? problems.slice(0, 5).join(" ") : `${active.length} channel(s) ready.` });
  }
  if (s.requireApprovedContent) {
    const contents = await prisma.marketingCampaignContent.findMany({ where: { campaignId: c.id, companyId: ctx.instance.companyId, status: "ACTIVE" }, select: { name: true, approvedVersionId: true, currentVersionId: true } });
    const pending = contents.filter((x) => !x.approvedVersionId || x.approvedVersionId !== x.currentVersionId);
    items.push({ key: "content", label: "Content", ok: pending.length === 0, detail: pending.length ? `Not approved (latest version): ${pending.map((x) => x.name).join(", ")}.` : contents.length ? "All content approved." : "No campaign content (templates are checked with the channels)." });
  }
  if (s.requireBudget) {
    const open = await prisma.marketingBudgetAlert.count({ where: { campaignId: c.id, status: "OPEN" } });
    const ok = c.plannedBudget !== null && open === 0;
    items.push({ key: "budget", label: "Budget", ok, detail: c.plannedBudget === null ? "No planned budget." : open ? `${open} open budget alert(s).` : "Planned budget set, no open alerts." });
  }
  return items;
}

const campaignReadiness: WorkflowImpl = {
  key: "campaign_readiness",
  label: async (companyId, _t, id) => {
    const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId }, select: { code: true, name: true } });
    return c ? `${c.code} · ${c.name}` : null;
  },
  snapshot: async (companyId, _t, id) => {
    const c = await prisma.marketingCampaign.findFirst({ where: { id, companyId }, select: { priority: true, plannedBudget: true } });
    return c ? { "campaign.priority": c.priority, "campaign.plannedBudget": num(c.plannedBudget) } : null;
  },
  steps: {
    check: async (ctx) => {
      const c = await loadCampaign(ctx);
      if (c.status === "ACTIVE") return { type: "complete", outcome: "LAUNCHED", summary: `${c.code} is already active.` };
      if (["COMPLETED", "CANCELLED"].includes(c.status)) return { type: "complete", outcome: "CAMPAIGN_CLOSED", summary: `${c.code} is ${c.status.toLowerCase()}.` };
      return { type: "next", summary: `${c.code} is ${c.status.toLowerCase().replace(/_/g, " ")}.` };
    },
    readiness: async (ctx) => {
      const s = ctx.settings as C;
      const c = await loadCampaign(ctx);
      if (["COMPLETED", "CANCELLED"].includes(c.status)) {
        await closeTasks(ctx, "cancel", `The campaign was ${c.status.toLowerCase()}.`);
        return { type: "complete", outcome: "CAMPAIGN_CLOSED", summary: `${c.code} is ${c.status.toLowerCase()}.` };
      }
      const items = await campaignChecklist(ctx, c);
      ctx.data = { ...ctx.data, checklist: items, checkedAt: ctx.now.toISOString() };
      const missing = items.filter((i) => !i.ok);
      if (!missing.length) {
        await closeTasks(ctx, "complete", "All readiness checks pass.");
        return { type: "next", summary: "All readiness checks pass.", result: { checklist: items } };
      }
      const list = missing.map((m) => `${m.label}: ${m.detail}`).join("\n- ");
      const t = await ensureTask(ctx, { key: "readiness", entityType: "CAMPAIGN", entityId: c.id, assigneeId: c.ownerUserId, subject: `Get campaign ${c.code} ready`, description: `Before launch:\n- ${list}`, dueDays: 2 });
      const msg = { module: "marketing_campaigns", title: `Campaign ${c.code} isn't ready yet`, body: `${missing.length} check(s) to fix: ${missing.map((m) => m.label).join(", ")}.` };
      if (!t.taskId) await ctx.notify("not-ready", [c.ownerUserId], msg);
      const esc = await ctx.remindOnce("escalate", s.escalateAfterDays * DAY_MS, s.escalationUserIds, { ...msg, title: `Escalation: campaign ${c.code} still not ready` });
      return { type: "wait", status: "WAITING_EVENT", recheckAt: nextCheck(ctx.now, s.recheckHours * HOUR_MS, esc), summary: `Not ready: ${missing.map((m) => m.label).join(", ")}.`, result: { checklist: items } };
    },
    await_approval: async (ctx) => {
      const s = ctx.settings as C;
      const c = await loadCampaign(ctx);
      if (c.status === "APPROVED" || c.status === "ACTIVE") return { type: "next", summary: `${c.code} is ${c.status.toLowerCase()}.` };
      if (["COMPLETED", "CANCELLED"].includes(c.status)) return { type: "complete", outcome: "CAMPAIGN_CLOSED", summary: `${c.code} is ${c.status.toLowerCase()}.` };
      if (c.status === "PENDING_APPROVAL") {
        const rev = await prisma.marketingCampaignRevision.findFirst({ where: { campaignId: c.id, status: "PENDING_APPROVAL" }, select: { requestedByUserId: true, revisionNumber: true } });
        const approvers = await approversFor(ctx.instance.companyId, "marketing_campaigns", [rev?.requestedByUserId, c.ownerUserId]);
        const due = await ctx.remindOnce(`approval-r${rev?.revisionNumber ?? 0}`, s.approvalReminderHours * HOUR_MS, approvers, { module: "marketing_campaigns", title: `Campaign ${c.code} is waiting for your approval`, body: "Approve or send it back on the campaign page. Readiness checks pass." });
        return { type: "wait", status: "WAITING_APPROVAL", recheckAt: nextCheck(ctx.now, s.recheckHours * HOUR_MS, due), summary: "Waiting for the campaign approval (decided on the campaign page)." };
      }
      // DRAFT (sent back): back to the readiness checks when it is resubmitted.
      return { type: "wait", status: "WAITING_EVENT", recheckAt: nextCheck(ctx.now, s.recheckHours * HOUR_MS), summary: "Sent back to draft — waiting for it to be resubmitted." };
    },
    await_launch: async (ctx) => {
      const s = ctx.settings as C;
      const c = await loadCampaign(ctx);
      if (c.status === "ACTIVE") return { type: "next", summary: `${c.code} was activated.` };
      if (["COMPLETED", "CANCELLED"].includes(c.status)) return { type: "complete", outcome: "CAMPAIGN_CLOSED", summary: `${c.code} is ${c.status.toLowerCase()}.` };
      if (c.status !== "APPROVED") return { type: "next", goto: "readiness", summary: `${c.code} is ${c.status.toLowerCase().replace(/_/g, " ")} again — checking readiness again.` };
      // Prerequisites must still hold before telling anyone to launch.
      const items = await campaignChecklist(ctx, c);
      ctx.data = { ...ctx.data, checklist: items, checkedAt: ctx.now.toISOString() };
      if (items.some((i) => !i.ok)) return { type: "next", goto: "readiness", summary: "Something is no longer ready — back to the readiness checks.", result: { checklist: items } };
      await ctx.notify("ready", [c.ownerUserId], { module: "marketing_campaigns", title: `Campaign ${c.code} is approved and ready`, body: "Activate it on the campaign page when it starts. Messages go out only through delivery runs." });
      const start = c.plannedStartDate.getTime();
      const late = start + DAY_MS <= ctx.now.getTime() ? await ctx.remindOnce("late", 0, [c.ownerUserId, ...s.escalationUserIds], { module: "marketing_campaigns", title: `Campaign ${c.code} is past its planned start`, body: "It is approved and ready but not activated yet." }) : null;
      return { type: "wait", status: "WAITING_EVENT", recheckAt: nextCheck(ctx.now, s.recheckHours * HOUR_MS, late, start + DAY_MS > ctx.now.getTime() ? new Date(start + DAY_MS) : null), summary: "Approved and ready — waiting for a person to activate it." };
    },
    finish: async (ctx) => {
      await closeTasks(ctx, "complete", "The campaign was activated.");
      return { type: "complete", outcome: "LAUNCHED", summary: "Campaign activated. (Activation is not delivery: messages are sent by delivery runs with their own checks.)" };
    },
  },
  compensate: async (ctx) => `Cancelled tasks: ${(await closeTasks(ctx, "cancel", "The workflow was cancelled.")).length}.`,
};

// ── D. Campaign budget exception ─────────────────────────────────

type D = SmWfSettings<"budget_exception">;

const budgetException: WorkflowImpl = {
  key: "budget_exception",
  label: async (companyId, _t, id) => {
    const a = await prisma.marketingBudgetAlert.findFirst({ where: { id, companyId }, select: { kind: true, campaign: { select: { code: true } } } });
    return a ? `${a.campaign.code} · ${a.kind.toLowerCase().replace(/_/g, " ")}` : null;
  },
  snapshot: async (companyId, _t, id) => {
    const a = await prisma.marketingBudgetAlert.findFirst({ where: { id, companyId }, select: { kind: true, campaign: { select: { plannedBudget: true } } } });
    return a ? { "alert.kind": a.kind, "campaign.plannedBudget": num(a.campaign.plannedBudget) } : null;
  },
  steps: {
    check: async (ctx) => {
      const a = await prisma.marketingBudgetAlert.findFirst({ where: { id: ctx.instance.entityId, companyId: ctx.instance.companyId }, select: { status: true, campaignId: true } });
      if (!a) throw new BusinessRuleError("NOT_FOUND", "Budget alert not found.");
      if (!(await canSeeCampaign(ctx.runAs, a.campaignId))) throw new BusinessRuleError("NOT_FOUND", "Campaign not found.");
      ctx.watch(smWfKey("CAMPAIGN", a.campaignId));
      ctx.data = { ...ctx.data, campaignId: a.campaignId };
      if (a.status !== "OPEN") return { type: "complete", outcome: "CLEARED", summary: "The alert had already cleared." };
      return { type: "next", summary: "The alert is open." };
    },
    task: async (ctx) => {
      const s = ctx.settings as D;
      const a = await prisma.marketingBudgetAlert.findFirstOrThrow({ where: { id: ctx.instance.entityId, companyId: ctx.instance.companyId }, select: { kind: true, message: true, campaign: { select: { id: true, code: true, ownerUserId: true } } } });
      const t = await ensureTask(ctx, { key: "review", entityType: "CAMPAIGN", entityId: a.campaign.id, assigneeId: a.campaign.ownerUserId, subject: `Review budget exception on ${a.campaign.code}`, description: `${a.message}\n\nReview the campaign's Budget panel (allocations, linked expenses, purchase orders and invoices). Complete this task when reviewed — the workflow doesn't change any budget or financial record.`, dueDays: s.reviewDueDays });
      const msg = { module: "marketing_campaigns", title: `Budget exception on campaign ${a.campaign.code}`, body: `${a.kind.toLowerCase().replace(/_/g, " ")} — see the campaign's Budget panel.` };
      await ctx.notify("reviewers", [...s.reviewerUserIds, ...(t.taskId ? [] : [a.campaign.ownerUserId])], msg);
      return { type: "next", summary: t.note, result: { taskId: t.taskId } };
    },
    await_resolution: async (ctx) => {
      const s = ctx.settings as D;
      const a = await prisma.marketingBudgetAlert.findFirstOrThrow({ where: { id: ctx.instance.entityId, companyId: ctx.instance.companyId }, select: { status: true, clearedAt: true, campaign: { select: { code: true, status: true, ownerUserId: true } } } });
      if (a.status !== "OPEN") {
        await closeTasks(ctx, "complete", "The budget alert cleared.");
        return { type: "complete", outcome: "CLEARED", summary: `The alert cleared${a.clearedAt ? ` on ${a.clearedAt.toISOString().slice(0, 10)}` : ""}.` };
      }
      const task = await taskStatus(ctx, "review");
      if (task?.status === "COMPLETED") return { type: "complete", outcome: "REVIEWED", summary: `Reviewed (task completed${task.outcome ? `: ${task.outcome}` : ""}); the alert stays open on the Budget panel until the figures change.` };
      if (a.campaign.status === "CANCELLED") return { type: "complete", outcome: "CAMPAIGN_CLOSED", summary: `${a.campaign.code} was cancelled.` };
      const esc = await ctx.remindOnce("escalate", s.escalateAfterDays * DAY_MS, s.reviewerUserIds.length ? s.reviewerUserIds : [a.campaign.ownerUserId], { module: "marketing_campaigns", title: `Escalation: budget exception on ${a.campaign.code} not reviewed`, body: "The budget alert is still open and not reviewed." });
      return { type: "wait", status: "WAITING_EVENT", recheckAt: nextCheck(ctx.now, SIX_HOURS, esc), summary: "Waiting for the alert to clear or the review task to be completed." };
    },
  },
  compensate: async (ctx) => `Cancelled tasks: ${(await closeTasks(ctx, "cancel", "The workflow was cancelled.")).length}.`,
};

// ── E. Attribution & bulk processing follow-up ───────────────────

type E = SmWfSettings<"processing_follow_up">;

function attributionException(d: { status?: unknown; conversions?: unknown; unattributed?: unknown }, threshold: number | null) {
  if (d.status === "FAILED") return "The calculation failed.";
  const conv = Number(d.conversions ?? 0);
  const un = Number(d.unattributed ?? 0);
  if (threshold !== null && conv > 0 && (un / conv) * 100 > threshold) return `${Math.round((un / conv) * 1000) / 10}% of conversions are unattributed (above ${threshold}%).`;
  return null;
}

const processingFollowUp: WorkflowImpl = {
  key: "processing_follow_up",
  accepts: (ev, raw) => {
    const s = raw as E;
    if (ev.type === "attribution.run_finished") return s.includeAttribution && attributionException(ev.data, s.unattributedShareAbove) !== null;
    if (ev.type === "bulk.job_finished") return s.includeBulkJobs && (ev.data.status === "FAILED" || (s.includeCompletedWithErrors && ev.data.status === "COMPLETED_WITH_ERRORS"));
    return false;
  },
  label: async (companyId, t, id) => {
    if (t === "ATTRIBUTION_RUN") {
      const r = await prisma.marketingAttributionRun.findFirst({ where: { id, companyId }, select: { model: { select: { code: true } }, periodFrom: true, periodTo: true } });
      return r ? `${r.model.code} ${r.periodFrom.toISOString().slice(0, 10)} → ${r.periodTo.toISOString().slice(0, 10)}` : null;
    }
    const j = await prisma.bulkJob.findFirst({ where: { id, companyId }, select: { actionKey: true, summary: true } });
    return j ? `${j.actionKey}${j.summary ? ` · ${j.summary}` : ""}`.slice(0, 120) : null;
  },
  snapshot: async (companyId, t, id) => {
    if (t === "ATTRIBUTION_RUN") return { "source.kind": "ATTRIBUTION", "source.failedCount": 0 };
    const j = await prisma.bulkJob.findFirst({ where: { id, companyId }, select: { failedCount: true } });
    return j ? { "source.kind": "BULK", "source.failedCount": j.failedCount } : null;
  },
  steps: {
    check: async (ctx) => {
      const s = ctx.settings as E;
      if (ctx.instance.entityType === "ATTRIBUTION_RUN") {
        const r = await prisma.marketingAttributionRun.findFirstOrThrow({ where: { id: ctx.instance.entityId, companyId: ctx.instance.companyId }, select: { status: true, error: true, conversions: true, unattributed: true, modelId: true, modelVersionId: true, finishedAt: true, requestedByUserId: true, model: { select: { code: true, ownerUserId: true } } } });
        const why = attributionException(r, s.unattributedShareAbove);
        ctx.data = { ...ctx.data, kind: "ATTRIBUTION", modelId: r.modelId, modelVersionId: r.modelVersionId, modelCode: r.model.code, finishedAt: r.finishedAt?.toISOString() ?? null, responsible: [r.requestedByUserId, r.model.ownerUserId].filter(Boolean), exception: why, error: r.error };
        ctx.watch(smWfKey("ATTRIBUTION_MODEL", r.modelId));
        if (!why) return { type: "complete", outcome: "NO_EXCEPTION", summary: "No exception." };
        return { type: "next", summary: `${r.model.code}: ${why}${r.error ? ` (${r.error.slice(0, 200)})` : ""}`, result: { status: r.status, conversions: r.conversions, unattributed: r.unattributed } };
      }
      const j = await prisma.bulkJob.findFirstOrThrow({ where: { id: ctx.instance.entityId, companyId: ctx.instance.companyId }, select: { status: true, failedCount: true, succeededCount: true, totalCount: true, errorMessage: true, actionKey: true, requestedByUserId: true } });
      const exception = j.status === "FAILED" ? `The job failed${j.errorMessage ? `: ${j.errorMessage}` : ""}.` : j.failedCount ? `${j.failedCount} of ${j.totalCount} record(s) failed.` : null;
      ctx.data = { ...ctx.data, kind: "BULK", actionKey: j.actionKey, responsible: [j.requestedByUserId], exception };
      if (!exception) return { type: "complete", outcome: "NO_EXCEPTION", summary: "No exception." };
      return { type: "next", summary: `${j.actionKey}: ${exception}`, result: { status: j.status, failed: j.failedCount, succeeded: j.succeededCount } };
    },
    notify: async (ctx) => {
      const s = ctx.settings as E;
      const isAttr = ctx.data.kind === "ATTRIBUTION";
      const n = await ctx.notify("exception", [...((ctx.data.responsible as string[]) ?? []), ...s.notifyUserIds], {
        module: isAttr ? "marketing_attribution" : "sales_marketing",
        title: isAttr ? `Attribution ${ctx.data.modelCode ?? ""}: needs attention` : `Bulk job ${ctx.data.actionKey ?? ""}: records failed`,
        body: `${String(ctx.data.exception ?? "")} Open Sales & Marketing → Workflows for the details and the retry.`.slice(0, 1000),
      });
      return { type: "next", summary: `Notified ${n} user(s).` };
    },
    await_resolution: async (ctx) => {
      const s = ctx.settings as E;
      if (ctx.data.kind === "ATTRIBUTION") {
        const later = await prisma.marketingAttributionRun.findFirst({
          where: { companyId: ctx.instance.companyId, modelId: ctx.data.modelId as string, status: { in: ["COMPLETED", "PURGED"] }, finishedAt: { gt: new Date((ctx.data.finishedAt as string) ?? 0) } },
          orderBy: { finishedAt: "desc" },
          select: { id: true, status: true, conversions: true, unattributed: true },
        });
        if (later && !attributionException(later, s.unattributedShareAbove)) return { type: "complete", outcome: "RESOLVED_BY_RERUN", summary: "A later calculation of the model succeeded.", result: { runId: later.id } };
      } else {
        const retry = await prisma.bulkJob.findFirst({ where: { companyId: ctx.instance.companyId, retryOfJobId: ctx.instance.entityId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, failedCount: true } });
        if (retry && retry.status === "COMPLETED") return { type: "complete", outcome: "RESOLVED_BY_RETRY", summary: "The retry of the failed records succeeded.", result: { jobId: retry.id } };
        if (retry) ctx.watch(smWfKey("BULK_JOB", retry.id));
      }
      const due = await ctx.remindOnce("remind", s.reviewDueDays * DAY_MS, [...((ctx.data.responsible as string[]) ?? []), ...s.notifyUserIds], {
        module: ctx.data.kind === "ATTRIBUTION" ? "marketing_attribution" : "sales_marketing",
        title: "Reminder: a processing exception is still open",
        body: String(ctx.data.exception ?? "").slice(0, 500),
      });
      return { type: "wait", status: "WAITING_EVENT", recheckAt: nextCheck(ctx.now, 12 * HOUR_MS, due), summary: "Waiting for a successful re-run / retry, or a person to resolve it." };
    },
  },
};

for (const impl of [quotationFollowUp, quotationToOrder, campaignReadiness, budgetException, processingFollowUp]) registerWorkflowImpl(impl);

export const SM_WORKFLOW_IMPLS_LOADED = true;
