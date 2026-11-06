import { prisma } from "@/core/db/client";
import type { DatasetDef, TimeGrain } from "./analytics-registry";
import type { ResultRow } from "./analytics-engine";

/**
 * Display labels for dimension keys (ids stay the canonical value, so filters,
 * drill-down and exports always use ids). Names are looked up within the
 * company only. Missing values read "Not set", never blank.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function periodLabel(start: string, grain: TimeGrain, fiscalStartMonth = 4) {
  const [y, m] = start.split("-").map(Number);
  switch (grain) {
    case "day":
      return start;
    case "week":
      return `Week of ${start}`;
    case "month":
      return `${MONTHS[m - 1]} ${y}`;
    case "quarter":
      return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    case "year":
      return String(y);
    case "fiscal_year": {
      // FY named by its start and end years, e.g. FY 2026-27 for April 2026 – March 2027.
      return fiscalStartMonth === 1 ? `FY ${y}` : `FY ${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    }
    case "fiscal_quarter": {
      const fyStartYear = m >= fiscalStartMonth ? y : y - 1;
      const q = Math.floor((((m - fiscalStartMonth + 12) % 12) / 3)) + 1;
      return fiscalStartMonth === 1 ? `Q${q} FY ${fyStartYear}` : `Q${q} FY ${fyStartYear}-${String((fyStartYear + 1) % 100).padStart(2, "0")}`;
    }
  }
}

export async function resolveLabels(companyId: string, dataset: DatasetDef, rows: ResultRow[], grain: TimeGrain, fiscalStartMonth = 4) {
  const dims = new Set(rows.flatMap((r) => Object.keys(r.keys)));
  for (const key of dims) {
    const def = key === "period" ? { kind: "time" as const } : dataset.dimensions.find((d) => d.key === key);
    if (!def) continue;
    const ids = [...new Set(rows.map((r) => r.keys[key]).filter((x): x is string => Boolean(x)))];
    let names = new Map<string, string>();
    if (def.kind === "user" && ids.length) names = new Map((await prisma.user.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
    if (def.kind === "channel" && ids.length) names = new Map((await prisma.salesChannel.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    if (def.kind === "territory" && ids.length) names = new Map((await prisma.salesTerritory.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    if (def.kind === "customer" && ids.length) names = new Map((await prisma.customer.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    if (def.kind === "campaign" && ids.length) names = new Map((await prisma.marketingCampaign.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, code: true, name: true } })).map((u) => [u.id, `${u.code} — ${u.name}`]));
    for (const r of rows) {
      const k = r.keys[key];
      if (k === null || k === undefined) {
        r.labels[key] = "Not set";
        continue;
      }
      if (def.kind === "time") r.labels[key] = periodLabel(k, grain, fiscalStartMonth);
      else if (def.kind === "enum" || def.kind === "text") r.labels[key] = ("options" in def && def.options?.[k]) || r.labels[key] || k;
      else r.labels[key] = names.get(k) ?? r.labels[key] ?? "Unknown";
    }
  }
}
