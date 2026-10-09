"use client";

import { useState } from "react";
import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";
import { formatCurrency } from "@/lib/currency";
import { OPPORTUNITY_STATUSES, type OpportunityStatus } from "@/modules/crm/opportunities/opportunity-registry";

export function OpportunityStatusBadge({ status }: { status: string }) {
  const s = OPPORTUNITY_STATUSES[status as OpportunityStatus];
  return <CrmBadge label={s?.label ?? status} tone={(s?.tone ?? "neutral") as CrmBadgeTone} />;
}

/** "INR 5,00,000" — the estimated CRM value (not an ERP document amount). */
export function opportunityValue(amount: string | number | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined || amount === "") return null;
  return `${currency ?? ""} ${formatCurrency(String(amount))}`.trim();
}

/** Expected close with an "overdue" hint for open deals (a past date never closes anything automatically). */
export function CloseDate({ value, status }: { value: string | null; status: string }) {
  // Business-day "today" (Asia/Kolkata), computed once per mount.
  const [today] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  if (!value) return <span className="text-zinc-400">—</span>;
  const day = value.slice(0, 10);
  const overdue = status === "OPEN" && day < today;
  return (
    <span className={overdue ? "font-medium text-red-600 dark:text-red-400" : undefined} title={overdue ? "Expected close date has passed" : undefined}>
      {day}
      {overdue && " · overdue"}
    </span>
  );
}
