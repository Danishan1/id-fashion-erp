import type { ReactNode } from "react";
import { CrmBadge, type CrmBadgeTone } from "./CrmBadge";

export interface CrmRecordMeta {
  label: string;
  value: ReactNode;
}

/**
 * Header block for a CRM record (lead, contact, company, opportunity…):
 * name, a secondary line (number / company / email), status badges, a row of
 * key facts and the record's actions. Used on detail pages and in drawers.
 */
export function CrmRecordHeader({
  title,
  subtitle,
  badges = [],
  meta = [],
  actions,
  metaColumns = 4,
}: {
  title: string;
  subtitle?: ReactNode;
  badges?: { label: string; tone?: CrmBadgeTone }[];
  meta?: CrmRecordMeta[];
  actions?: ReactNode;
  /** 4 on full-width pages; use 2 inside a drawer. */
  metaColumns?: 2 | 4;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
            {badges.map((b) => (
              <CrmBadge key={b.label} label={b.label} tone={b.tone} />
            ))}
          </div>
          {subtitle && <div className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {meta.length > 0 && (
        <dl className={`grid grid-cols-2 gap-x-4 gap-y-2 ${metaColumns === 4 ? "sm:grid-cols-4" : ""}`}>
          {meta.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">{m.label}</dt>
              <dd className="mt-0.5 break-words text-sm text-zinc-900 dark:text-zinc-100">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
