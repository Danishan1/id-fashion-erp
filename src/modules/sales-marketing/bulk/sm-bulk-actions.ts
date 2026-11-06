import { z } from "zod";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { todayIsoDate } from "@/lib/date";
import { BULK_EXPORT_TTL_DAYS, exportRowOutcome, writeBulkExportFile } from "@/modules/bulk-actions/bulk-export-file";
import { registerAction, registerEntity } from "@/modules/bulk-actions/bulk-registry";
import { BulkItemError } from "@/modules/bulk-actions/bulk-safety";
import type { BulkActionDefinition, BulkItemContext, BulkItemOutcome } from "@/modules/bulk-actions/bulk-types";
import { checkRunRequest, executeRun, requestRun } from "../attribution/attribution-run.service";
import { assignSalesEnquiry, checkSalesEnquiryAssign, listEligibleOwners } from "../enquiries/sales-enquiry.service";
import { checkPromotionAction, promotionAction } from "../promotions/promotion.service";
import { checkQuotationDraft } from "../quotations/quotation-lifecycle.service";
import { SM_BULK_ENTITIES, smBulkEntity } from "./sm-bulk-entities";
import { smExportColumns, smExportRows, type SmExportEntity } from "./sm-bulk-export";

/**
 * Phase 14 (Sales & Marketing) — the S&M bulk actions, on the shared bulk
 * engine built for CRM Phase 14. Every per-record step calls the SAME service
 * function the screens use (assignSalesEnquiry, promotionAction, requestRun /
 * executeRun, the quotation issue checks), as the user who started the job —
 * so visibility, state rules, permissions, audit and notifications apply to
 * each record exactly as if done by hand. Nothing here writes S&M tables.
 *
 * Dry run: actions that change data also implement `validateItem`, which runs
 * the service's own check function (checkSalesEnquiryAssign,
 * checkPromotionAction, checkRunRequest) and changes nothing.
 *
 * Deliberately not offered (spec: no generic mass edit): bulk stage changes,
 * bulk quotation issue/approve/cancel, bulk campaign status changes, bulk
 * deletes — each needs per-record judgement or approval.
 */

const MAX_MUTATION = 2_000;
const MAX_EXPORT = 20_000;
const MAX_CHECK = 1_000;
const MAX_RECALC = 50;

const uuid = z.string().uuid();
const blankToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);
const skipped = (message: string): BulkItemOutcome => ({ status: "SKIPPED", message });
const done = (message?: string, result?: Record<string, unknown>): BulkItemOutcome => ({ status: "SUCCEEDED", ...(message ? { message } : {}), ...(result ? { result } : {}) });

const exportSchema = z.object({ format: z.enum(["CSV", "XLSX"]).default("XLSX") }).strict();
const EXPORT_NO_DRY_RUN = "An export changes nothing — just run it.";

function exportAction(entityType: SmExportEntity, opts: { label: string; description: string; permission: { module: "sales_marketing" | "sales_quotations" | "marketing_campaigns" | "marketing_promotions"; action: "export" } }): BulkActionDefinition<z.infer<typeof exportSchema>> {
  const entity = smBulkEntity(entityType);
  return {
    key: `${entityType.toLowerCase()}.export`,
    entityType,
    kind: "export",
    label: opts.label,
    description: `${opts.description} Runs in the background; you can download the file for ${BULK_EXPORT_TTL_DAYS} days.`,
    permissions: [opts.permission],
    paramsSchema: exportSchema,
    fields: async () => [{ key: "format", label: "Format", type: "select", required: true, options: [{ value: "XLSX", label: "Excel (.xlsx)" }, { value: "CSV", label: "CSV (.csv)" }] }],
    confirmation: "none",
    retrySafe: true,
    cancellable: true,
    maxItems: MAX_EXPORT,
    schedulable: true,
    dryRunUnavailableReason: EXPORT_NO_DRY_RUN,
    prepare: async (_a, p) => ({ params: p, summary: `Export to ${p.format === "CSV" ? "CSV" : "Excel"}` }),
    executeBatch: async (ctx) => {
      const rows = await smExportRows(ctx.actor, entityType, ctx.items.map((i) => i.entityId));
      return new Map(ctx.items.map((i) => [i.id, exportRowOutcome(rows.get(i.entityId))]));
    },
    finalize: async (ctx) => writeBulkExportFile(ctx.job, smExportColumns(entityType), ctx.params.format, entity.pluralLabel),
  };
}

// ── Enquiries ────────────────────────────────────────────────────

const assignSchema = z.object({ ownerUserId: z.preprocess(blankToUndef, uuid.nullable().optional()) }).strict();

const enquiryAssign: BulkActionDefinition<z.infer<typeof assignSchema>> = {
  key: "enquiry.assign",
  entityType: "ENQUIRY",
  kind: "assign",
  label: "Assign owner",
  description: "Give the selected enquiries a new owner (or leave them unassigned). Closed or cancelled enquiries are not changed; the new owner is notified as usual.",
  permissions: [{ module: "sales_marketing", action: "edit" }],
  paramsSchema: assignSchema,
  fields: async (actor) => [
    { key: "ownerUserId", label: "New owner", type: "user", allowNone: true, noneLabel: "Unassigned", help: "Only users with access to Sales & Marketing.", options: (await listEligibleOwners(actor)).map((u) => ({ value: u.id, label: u.fullName })) },
  ],
  confirmation: "confirm",
  retrySafe: true,
  cancellable: true,
  maxItems: MAX_MUTATION,
  prepare: async (actor, p) => {
    if (!p.ownerUserId) return { params: { ownerUserId: null }, summary: "Owner → Unassigned" };
    const owner = (await listEligibleOwners(actor)).find((u) => u.id === p.ownerUserId);
    if (!owner) throw new BusinessRuleError("VALIDATION_ERROR", "Choose an active user who has access to Sales & Marketing.", { fieldErrors: { ownerUserId: "Not an eligible owner." } });
    return { params: p, summary: `Owner → ${owner.fullName}` };
  },
  validateItem: async (ctx) => {
    const r = await checkSalesEnquiryAssign(ctx.actor, ctx.item.entityId, { ownerUserId: ctx.params.ownerUserId ?? null });
    return r.unchanged ? skipped("Already assigned to this owner.") : done("Would be reassigned.");
  },
  executeItem: async (ctx) => {
    const r = await checkSalesEnquiryAssign(ctx.actor, ctx.item.entityId, { ownerUserId: ctx.params.ownerUserId ?? null });
    if (r.unchanged) return skipped("Already assigned to this owner.");
    await assignSalesEnquiry(ctx.actor, ctx.item.entityId, { ownerUserId: ctx.params.ownerUserId ?? null });
    return done();
  },
};

// ── Quotations ───────────────────────────────────────────────────

const emptySchema = z.object({}).strict();
const money = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const quotationCheckDrafts: BulkActionDefinition<Record<string, never>> = {
  key: "quotation.check_drafts",
  entityType: "QUOTATION",
  kind: "validate",
  label: "Check drafts",
  description:
    "Runs the checks a draft must pass before it can be issued (valid-until date, references, GST rates, unchanged price-list prices) and reports whether it needs approval. Nothing is changed; quotations that aren't drafts are skipped.",
  permissions: [{ module: "sales_quotations", action: "view" }],
  paramsSchema: emptySchema as unknown as z.ZodType<Record<string, never>>,
  confirmation: "none",
  retrySafe: true,
  cancellable: true,
  maxItems: MAX_CHECK,
  dryRunUnavailableReason: "This action only checks — it never changes a quotation.",
  prepare: async (_a, p) => ({ params: p, summary: "Check drafts (no changes)" }),
  executeItem: async (ctx) => {
    const r = await checkQuotationDraft(ctx.actor, ctx.item.entityId);
    if (!r) return skipped("Not a draft — nothing to check.");
    if (r.approvalReasons.length) return done(`Valid — needs approval before issue: ${r.approvalReasons.join("; ")}`, { grandTotal: r.grandTotal, approval: true });
    return done(`Ready to issue (${money(r.grandTotal)}).`, { grandTotal: r.grandTotal, approval: false });
  },
};

// ── Promotions ───────────────────────────────────────────────────

const commentSchema = z.object({ comment: z.string().trim().max(1000).optional().or(z.literal("")) }).strict();

async function promotionStatus(ctx: BulkItemContext<unknown>) {
  const p = await prisma.marketingPromotion.findFirst({ where: { id: ctx.item.entityId, companyId: ctx.actor.companyId }, select: { status: true } });
  if (!p) throw new BulkItemError("The promotion no longer exists.", "NOT_FOUND");
  return p.status;
}

const promotionPause: BulkActionDefinition<z.infer<typeof commentSchema>> = {
  key: "promotion.pause",
  entityType: "PROMOTION",
  kind: "status",
  label: "Pause",
  description: "Stop applying the selected promotions to new prices. Quotations already issued keep their prices and reservations. Promotions that aren't on are skipped.",
  permissions: [{ module: "marketing_promotions", action: "edit" }],
  paramsSchema: commentSchema,
  fields: async () => [{ key: "comment", label: "Comment (kept on each promotion's history)", type: "text", maxLength: 1000, multiline: true }],
  confirmation: "confirm",
  retrySafe: true,
  cancellable: true,
  maxItems: MAX_MUTATION,
  prepare: async (_a, p) => ({ params: p, summary: p.comment ? `Pause — "${p.comment.slice(0, 80)}"` : "Pause" }),
  validateItem: async (ctx) => {
    if ((await promotionStatus(ctx)) === "PAUSED") return skipped("Already paused.");
    await checkPromotionAction(ctx.actor, ctx.item.entityId, "pause");
    return done("Would be paused.");
  },
  executeItem: async (ctx) => {
    if ((await promotionStatus(ctx)) === "PAUSED") return skipped("Already paused.");
    await promotionAction(ctx.actor, ctx.item.entityId, "pause", { comment: ctx.params.comment || null });
    return done();
  },
};

// ── Attribution ──────────────────────────────────────────────────

const PERIODS = { LAST_30: 30, LAST_90: 90, LAST_365: 365 } as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const recalcSchema = z
  .object({
    period: z.enum(["LAST_30", "LAST_90", "LAST_365", "CUSTOM"]).default("LAST_365"),
    from: z.preprocess(blankToUndef, isoDate.optional()),
    to: z.preprocess(blankToUndef, isoDate.optional()),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.period !== "CUSTOM") return;
    if (!v.from) ctx.addIssue({ code: "custom", path: ["from"], message: "Choose the first day." });
    if (!v.to) ctx.addIssue({ code: "custom", path: ["to"], message: "Choose the last day." });
  });
type RecalcParams = z.infer<typeof recalcSchema>;

/** Relative periods are resolved when each record runs, so a saved schedule always covers the latest days. */
export function recalcPeriod(p: RecalcParams, today = todayIsoDate()): { from: string; to: string } {
  if (p.period === "CUSTOM") return { from: p.from!, to: p.to! };
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (PERIODS[p.period] - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to: today };
}

const PERIOD_LABEL: Record<RecalcParams["period"], string> = { LAST_30: "last 30 days", LAST_90: "last 90 days", LAST_365: "last 365 days", CUSTOM: "custom period" };

const attributionRecalculate: BulkActionDefinition<RecalcParams> = {
  key: "attribution_model.recalculate",
  entityType: "ATTRIBUTION_MODEL",
  kind: "recalculate",
  label: "Recalculate",
  description:
    "Recalculate each selected model over a period (a new run per model, through the normal calculation). Models without approved rules, retired models and models already being calculated are skipped. Reports switch to the new results when each run completes.",
  permissions: [{ module: "marketing_attribution", action: "edit" }],
  paramsSchema: recalcSchema as unknown as z.ZodType<RecalcParams>,
  fields: async () => [
    {
      key: "period",
      label: "Period (conversion dates)",
      type: "select",
      required: true,
      options: [
        { value: "LAST_30", label: "Last 30 days" },
        { value: "LAST_90", label: "Last 90 days" },
        { value: "LAST_365", label: "Last 365 days" },
        { value: "CUSTOM", label: "Custom dates" },
      ],
      help: "For a schedule, the last-N-days periods move forward with each run.",
    },
    { key: "from", label: "From (custom)", type: "date" },
    { key: "to", label: "To (custom)", type: "date" },
  ],
  confirmation: "confirm",
  // A record re-run after a crash finds its own run by idempotency key; it never creates a second one.
  retrySafe: true,
  cancellable: true,
  maxItems: MAX_RECALC,
  schedulable: true,
  prepare: async (_a, p) => {
    if (p.period === "CUSTOM") {
      const { from, to } = recalcPeriod(p);
      if (to < from) throw new BusinessRuleError("VALIDATION_ERROR", "The period ends before it starts.", { fieldErrors: { to: "Before the start." } });
      if (to > todayIsoDate()) throw new BusinessRuleError("VALIDATION_ERROR", "The period can't end in the future.", { fieldErrors: { to: "In the future." } });
      return { params: p, summary: `Recalculate ${from} → ${to}` };
    }
    return { params: { period: p.period }, summary: `Recalculate the ${PERIOD_LABEL[p.period]}` };
  },
  validateItem: async (ctx) => {
    const { busy } = await checkRunRequest(ctx.actor, ctx.item.entityId, recalcPeriod(ctx.params));
    if (busy) return skipped("A calculation of this model is already queued or running.");
    return done(`Would recalculate ${recalcPeriod(ctx.params).from} → ${recalcPeriod(ctx.params).to}.`);
  },
  executeItem: async (ctx) => {
    const period = recalcPeriod(ctx.params);
    const pre = await checkRunRequest(ctx.actor, ctx.item.entityId, period);
    // Busy with a run that isn't this item's own (a re-run after a crash finds its own run below).
    if (pre.busy && pre.busy.idempotencyKey !== ctx.idempotencyKey) return skipped("A calculation of this model is already queued or running.");
    let run;
    try {
      ({ run } = await requestRun(ctx.actor, ctx.item.entityId, { ...period, idempotencyKey: ctx.idempotencyKey }));
    } catch (e) {
      if (e instanceof BusinessRuleError && e.code === "INVALID_STATE_TRANSITION" && /already queued or running/.test(e.message)) return skipped("A calculation of this model is already queued or running.");
      throw e;
    }
    if (run.status === "QUEUED") await executeRun(run.id, { onBatch: ctx.keepAlive });
    const after = await prisma.marketingAttributionRun.findUniqueOrThrow({ where: { id: run.id }, select: { id: true, status: true, error: true, conversions: true, attributed: true } });
    if (after.status === "COMPLETED" || after.status === "PURGED") return done(`Calculated: ${after.conversions} conversions, ${after.attributed} attributed.`, { runId: after.id });
    if (after.status === "RUNNING") return skipped("The calculation is still running in another worker.");
    throw new BulkItemError(`The calculation failed: ${after.error ?? "unknown error"}`.slice(0, 500), "ATTRIBUTION_RUN_FAILED");
  },
};

// ── Registration ─────────────────────────────────────────────────

export function registerSalesMarketingBulkActions() {
  for (const e of SM_BULK_ENTITIES) registerEntity(smBulkEntity(e));
  const defs: BulkActionDefinition<never>[] = [
    enquiryAssign,
    exportAction("ENQUIRY", { label: "Export", description: "Export the selected enquiries (sales stage, owner, follow-up, value) to Excel or CSV.", permission: { module: "sales_marketing", action: "export" } }),
    exportAction("QUOTATION", { label: "Export", description: "Export the selected quotations (current revision, status, totals) to Excel or CSV.", permission: { module: "sales_quotations", action: "export" } }),
    quotationCheckDrafts,
    exportAction("CAMPAIGN", { label: "Export with budget figures", description: "Export the selected campaigns with their budget figures (approved, actual spend, committed, in approval, remaining).", permission: { module: "marketing_campaigns", action: "export" } }),
    exportAction("PROMOTION", { label: "Export", description: "Export the selected promotions with their approved terms to Excel or CSV.", permission: { module: "marketing_promotions", action: "export" } }),
    promotionPause,
    attributionRecalculate,
  ] as unknown as BulkActionDefinition<never>[];
  for (const def of defs) registerAction(def);
}
