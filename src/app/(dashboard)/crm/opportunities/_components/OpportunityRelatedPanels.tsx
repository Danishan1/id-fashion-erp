"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { ClientDateTime } from "@/components/ui/ClientDateTime";
import { humanizeStatus } from "@/lib/humanize-status";
import { OPPORTUNITY_FUTURE_SECTIONS } from "@/modules/crm/opportunities/opportunity-registry";
import { opportunityValue } from "./OpportunityBadges";
import type { StageHistoryDto } from "./opportunity-types";

interface ErpDocDto {
  id: string;
  number: string;
  date: string;
  status: string;
  amount: string | null;
  currencyCode: string | null;
  dueDate: string | null;
  subtitle: string | null;
  customerName: string | null;
  person: string | null;
  href: string;
}
interface ErpDocumentsDto {
  customerLinked: boolean;
  sections: { type: string; label: string; allowed: boolean; rows: { linkId: string; docId: string; docNumber: string; linkedAt: string; doc: ErpDocDto | null }[] }[];
  notAvailable: { key: string; label: string; reason: string }[];
  unknown: { linkId: string; docType: string; docNumber: string }[];
}

const label = "text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400";

/**
 * ERP documents linked to the opportunity, read live from the ERP. Rows the
 * viewer may not see (module or branch access) show only the number.
 */
export function OpportunityErpDocuments({ opportunityId, refreshKey, canEdit, onUnlink }: { opportunityId: string; refreshKey: number; canEdit: boolean; onUnlink: (row: { linkId: string; docNumber: string }) => void }) {
  const [data, setData] = useState<ErpDocumentsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    crmRequest<ErpDocumentsDto>(`/api/v1/crm/opportunities/${opportunityId}/erp-documents`).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setData(res.data);
        setError(null);
      } else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [opportunityId, refreshKey, tick]);

  if (error) return <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!data) return <CrmLoadingState />;
  return (
    <div className="space-y-4 text-sm">
      {data.notAvailable.map((n) => (
        <div key={n.key}>
          <p className={label}>{n.label}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{n.reason}</p>
        </div>
      ))}
      {data.sections.map((s) => (
        <div key={s.type}>
          <p className={label}>
            {s.label}
            {s.rows.length > 0 && <span className="ml-1 font-normal normal-case">({s.rows.length})</span>}
          </p>
          {s.rows.length === 0 ? (
            <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">None linked.</p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {s.rows.map((r) => (
                <li key={r.linkId} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="min-w-0">
                    {r.doc ? (
                      <Link href={r.doc.href} className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
                        {r.doc.number}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.docNumber}</span>
                    )}
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {r.doc ? (
                        <>
                          <ClientDateTime value={r.doc.date} mode="date" />
                          {[humanizeStatus(r.doc.status), opportunityValue(r.doc.amount, r.doc.currencyCode), r.doc.dueDate ? `Due ${r.doc.dueDate.slice(0, 10)}` : null, r.doc.subtitle, r.doc.customerName].filter(Boolean).map((t) => ` · ${t}`)}
                        </>
                      ) : !s.allowed ? (
                        `You don't have access to ${s.label.toLowerCase()}.`
                      ) : (
                        "Not available — outside your branch access, or no longer in the ERP."
                      )}
                    </span>
                  </span>
                  {canEdit && (
                    <button type="button" className="text-xs text-red-600 hover:underline dark:text-red-400" onClick={() => onUnlink({ linkId: r.linkId, docNumber: r.docNumber })}>
                      Unlink
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {data.unknown.length > 0 && (
        <div>
          <p className={label}>Other references</p>
          <ul className="mt-1 text-xs text-zinc-500">
            {data.unknown.map((u) => (
              <li key={u.linkId}>
                {u.docType} {u.docNumber}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Amounts and statuses come from the ERP and never change the opportunity&apos;s estimated value.</p>
    </div>
  );
}

const CHANGE_LABEL: Record<StageHistoryDto["changeType"], string> = {
  INITIAL: "Started in",
  STAGE_CHANGE: "Moved",
  PIPELINE_TRANSFER: "Moved to another pipeline",
  STAGE_REASSIGNED: "Moved (stage archived)",
};
const SOURCE_LABEL: Record<string, string> = { FORM: "edit form", STAGE_ACTION: "stage change", BULK: "bulk change", TRANSFER: "pipeline move", STAGE_ARCHIVE: "stage archived", PIPELINE_ARCHIVE: "pipeline archived", CREATE: "created", BACKFILL: "earlier history" };

/** Applied stage / pipeline changes (newest first) from crm_opportunity_stage_history. */
export function OpportunityStageHistory({ opportunityId, refreshKey }: { opportunityId: string; refreshKey: number }) {
  const [rows, setRows] = useState<StageHistoryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    crmRequest<StageHistoryDto[]>(`/api/v1/crm/opportunities/${opportunityId}/stage-history`).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setRows(res.data);
        setError(null);
      } else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [opportunityId, refreshKey, tick]);

  if (error) return <CrmErrorState message={error} onRetry={() => setTick((t) => t + 1)} />;
  if (!rows) return <CrmLoadingState />;
  if (!rows.length) return <p className="text-sm text-zinc-500 dark:text-zinc-400">No stage changes yet.</p>;
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <ol className="space-y-2 text-sm">
      {rows.map((h) => (
        <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="min-w-0">
            <span className="text-zinc-500 dark:text-zinc-400">{CHANGE_LABEL[h.changeType] ?? h.changeType}: </span>
            {h.fromStage && h.changeType !== "INITIAL" ? `${h.fromStage.name} → ` : ""}
            <span className="font-medium">{h.toStage.name}</span>
            {h.changeType === "PIPELINE_TRANSFER" && <span className="text-zinc-500 dark:text-zinc-400"> ({h.fromPipeline?.name ?? "—"} → {h.toPipeline.name})</span>}
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              Probability {h.changeType === "INITIAL" ? pct(h.toProbability) : `${pct(h.fromProbability)} → ${pct(h.toProbability)}`}
              {h.probabilitySource === "MANUAL" ? " (set by hand)" : ""}
              {` · ${SOURCE_LABEL[h.source] ?? h.source}`}
              {h.changedBy?.name ? ` · ${h.changedBy.name}` : ""}
              {h.reason ? ` · ${h.reason}` : ""}
            </span>
          </span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            <ClientDateTime value={h.changedAt} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function OpportunityUpcomingSections() {
  return (
    <ul className="space-y-1.5 text-sm">
      {OPPORTUNITY_FUTURE_SECTIONS.map((s) => (
        <li key={s.key}>
          <span className="text-zinc-800 dark:text-zinc-100">{s.title}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Arrives with {s.phase}.</span>
        </li>
      ))}
    </ul>
  );
}
