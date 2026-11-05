"use client";

import { useCallback, useEffect, useState } from "react";
import { getApiErrorMessage } from "@/lib/api-client";

/** Shared bits of the Phase 07 commission screens. */

export { Badge, CARD, TextDialog, inr, type TextDialogSpec } from "../pricing/pricing-ui";

export const PAYEE_LABELS = { REP: "Sales rep", AGENT: "Sales agent" } as const;
export const BASIS_LABELS = { INVOICED: "Invoiced value", COLLECTED: "Collected value" } as const;
export const BASIS_HINTS = {
  INVOICED: "Earned when the Sales Invoice is posted (before GST); reversed if the invoice is cancelled.",
  COLLECTED: "Earned as customer payments are allocated to the invoice, pro rata before GST; reversed if the payment is cancelled.",
} as const;
export const VERSION_STATUS = {
  DRAFT: { label: "Draft", tone: "zinc" },
  PENDING_APPROVAL: { label: "Waiting for approval", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
  WITHDRAWN: { label: "Withdrawn", tone: "zinc" },
  RETIRED: { label: "Retired", tone: "zinc" },
} as const;
export const STATEMENT_STATUS = {
  DRAFT: { label: "Draft", tone: "zinc" },
  PENDING_APPROVAL: { label: "Waiting for approval", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
} as const;
export const LINE_KIND_LABELS = { EARNING: "Commission", REVERSAL: "Reversal", CARRY_FORWARD: "Carried forward", ADJUSTMENT: "Adjustment", INCENTIVE: "Incentive" } as const;
export const PAYMENT_TONE: Record<string, "zinc" | "green" | "amber" | "red" | "indigo"> = { PENDING_APPROVAL: "amber", APPROVED: "indigo", PARTIALLY_PAID: "indigo", PAID: "green", REJECTED: "red", CANCELLED: "red" };

export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
export const signedInr = (v: number) => `${v < 0 ? "−" : ""}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** GET a JSON `data` payload; `reload()` fetches again. */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url, { headers: { "x-toast": "off" } })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) return setError(await getApiErrorMessage(r));
        setError(null);
        setData((await r.json()).data);
      })
      .catch(() => alive && setError("Couldn't load. Check your connection."));
    return () => {
      alive = false;
    };
  }, [url, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, setData };
}

/** Sends JSON; returns the `data` payload or throws the API's message. */
export async function send<T = unknown>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json", "x-toast": "off" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return (await res.json()).data as T;
}
