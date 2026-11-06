import { prisma } from "@/core/db/client";
import { PermissionService } from "@/core/rbac/PermissionService";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { FRESHNESS, type DatasetDef, type FreshnessStatus } from "./analytics-registry";

/**
 * Phase 17 — freshness per source, so a report never shows one misleading
 * timestamp for several sources:
 *  - live datasets: CURRENT (read at request time), with the latest change of
 *    an included record;
 *  - attribution (campaign performance): the current run's age and coverage —
 *    REFRESHING while a run is going, FAILED if the newest run failed, STALE
 *    if the calculation is older than 36 h (the nightly job runs daily),
 *    INCOMPLETE if the run doesn't cover the whole requested range or a
 *    touchpoint source hasn't synced in 36 h, UNKNOWN with no calculation;
 *  - workflow events: STALE if the Phase 15 event reader is more than 10
 *    minutes behind.
 * Missing data is never replaced by zero: a source we can't evaluate is UNKNOWN.
 */

export interface Freshness {
  source: string;
  status: FreshnessStatus;
  label: string;
  asOf: string | null;
  detail: string;
}

const STALE_ATTRIBUTION_MS = 36 * 3_600_000;
const STALE_EVENTS_MS = 10 * 60_000;

const f = (source: string, status: FreshnessStatus, asOf: Date | string | null, detail: string): Freshness => ({ source, status, label: FRESHNESS[status].label, asOf: asOf ? new Date(asOf).toISOString() : null, detail });

/** Pure: attribution freshness from its facts (unit-tested). */
export function attributionFreshness(facts: { running: boolean; latestFailed: boolean; current: { finishedAt: Date; periodFrom: string; periodTo: string } | null; syncLagMs: number | null }, range: { from: string; to: string }, now = Date.now()): Freshness {
  const src = "Phase 13 attribution calculation";
  if (facts.running) return f(src, "REFRESHING", facts.current?.finishedAt ?? null, "A recalculation is running; figures are from the previous calculation.");
  if (!facts.current) return f(src, facts.latestFailed ? "FAILED" : "UNKNOWN", null, facts.latestFailed ? "The last calculation failed and there is no earlier one." : "Nothing calculated yet for the default model.");
  if (facts.latestFailed) return f(src, "FAILED", facts.current.finishedAt, "The newest calculation failed; figures are from the previous successful one.");
  if (range.from < facts.current.periodFrom || range.to > facts.current.periodTo) return f(src, "INCOMPLETE", facts.current.finishedAt, `The calculation covers ${facts.current.periodFrom} – ${facts.current.periodTo} only.`);
  if (facts.syncLagMs !== null && facts.syncLagMs > STALE_ATTRIBUTION_MS) return f(src, "INCOMPLETE", facts.current.finishedAt, "Touchpoints haven't been synced for more than 36 hours.");
  if (now - facts.current.finishedAt.getTime() > STALE_ATTRIBUTION_MS) return f(src, "STALE", facts.current.finishedAt, "Calculated more than 36 hours ago.");
  return f(src, "CURRENT", facts.current.finishedAt, "Latest successful calculation.");
}

export async function datasetFreshness(actor: SalesActor, ds: DatasetDef, range: { from: string; to: string }, latest: Date | null): Promise<Freshness[]> {
  const now = new Date();
  if (ds.freshness === "live") return [f(ds.source, "CURRENT", now, latest ? `Read live. Latest change in an included record: ${new Date(latest).toISOString().slice(0, 16).replace("T", " ")} UTC.` : "Read live. No records in the range.")];
  if (ds.freshness === "workflow-events") {
    const cps = await prisma.smWorkflowCheckpoint.findMany({ select: { updatedAt: true } });
    const oldest = cps.length ? Math.min(...cps.map((c) => c.updatedAt.getTime())) : null;
    if (oldest === null) return [f(ds.source, "CURRENT", now, "Read live."), f("Phase 15 event reader", "UNKNOWN", null, "The workflow worker hasn't read events yet.")];
    const lag = now.getTime() - oldest;
    return [f(ds.source, "CURRENT", now, "Read live."), f("Phase 15 event reader", lag > STALE_EVENTS_MS ? "STALE" : "CURRENT", new Date(oldest), lag > STALE_EVENTS_MS ? `Events read ${Math.round(lag / 60_000)} minutes ago — new workflow starts are delayed.` : "Events read recently.")];
  }
  // attribution
  if (!(await PermissionService.can(actor.userId, "marketing_attribution", "view"))) return [f("Phase 13 attribution calculation", "UNKNOWN", null, "You can't see attribution.")];
  const model = await prisma.marketingAttributionModel.findFirst({ where: { companyId: actor.companyId, isDefault: true }, select: { id: true } });
  if (!model) return [f("Phase 13 attribution calculation", "UNKNOWN", null, "No default attribution model.")];
  const runs = await prisma.marketingAttributionRun.findMany({ where: { companyId: actor.companyId, modelId: model.id }, orderBy: { queuedAt: "desc" }, take: 5, select: { status: true, finishedAt: true, periodFrom: true, periodTo: true } });
  const ok = runs.find((r) => (r.status === "COMPLETED" || r.status === "PURGED") && r.finishedAt);
  const checkpoints = await prisma.marketingAttributionCheckpoint.findMany({ where: { companyId: actor.companyId }, select: { lastSyncAt: true } }).catch(() => [] as { lastSyncAt: Date | null }[]);
  const syncs = checkpoints.map((c) => c.lastSyncAt?.getTime() ?? 0);
  return [
    attributionFreshness(
      {
        running: runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING"),
        latestFailed: runs[0]?.status === "FAILED",
        current: ok ? { finishedAt: ok.finishedAt!, periodFrom: ok.periodFrom.toISOString().slice(0, 10), periodTo: ok.periodTo.toISOString().slice(0, 10) } : null,
        syncLagMs: syncs.length ? now.getTime() - Math.min(...syncs) : null,
      },
      range
    ),
    f("Phase 12 actual spend", "CURRENT", now, "Approved expenses and posted purchase invoices, read live."),
  ];
}
