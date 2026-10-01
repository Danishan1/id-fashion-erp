"use client";

import { TOAST_HEADER, TOAST_SUCCESS_HEADER } from "@/lib/api-client";

export interface CrmApiError {
  status: number;
  code: string | null;
  message: string;
  details: Record<string, unknown> | null;
  /** Field → first message, from Zod (`errors`) or BusinessRuleError details.fieldErrors. */
  fieldErrors: Record<string, string>;
}

export type CrmApiResult<T> = { ok: true; data: T } | { ok: false; error: CrmApiError };

/**
 * fetch wrapper for CRM screens. Mutations still go through the app-wide toast
 * interceptor; `toast: "errors"` keeps only error toasts, `"off"` silences it
 * (e.g. when a 409 duplicate warning is shown inline instead).
 */
export async function crmRequest<T>(
  url: string,
  { method = "GET", body, toast = "auto", successMessage }: { method?: string; body?: unknown; toast?: "auto" | "errors" | "off"; successMessage?: string } = {}
): Promise<CrmApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (toast !== "auto") headers[TOAST_HEADER] = toast;
  if (successMessage) headers[TOAST_SUCCESS_HEADER] = successMessage;
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, error: { status: 0, code: null, message: "Couldn't reach the server. Check your connection and try again.", details: null, fieldErrors: {} } };
  }
  const json = await res.json().catch(() => null);
  if (res.ok) return { ok: true, data: (json?.data ?? json) as T };
  const inner = json?.error ?? null;
  const fieldErrors: Record<string, string> = {};
  if (json?.errors && typeof json.errors === "object") {
    for (const [k, v] of Object.entries(json.errors as Record<string, unknown>)) fieldErrors[k] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  const detailFieldErrors = inner?.details?.fieldErrors;
  if (detailFieldErrors && typeof detailFieldErrors === "object") {
    for (const [k, v] of Object.entries(detailFieldErrors as Record<string, unknown>)) fieldErrors[k] = String(v);
  }
  return {
    ok: false,
    error: {
      status: res.status,
      code: typeof inner?.code === "string" ? inner.code : null,
      message: (typeof json?.message === "string" && json.message) || (typeof inner?.message === "string" && inner.message) || "Something went wrong.",
      details: inner?.details ?? null,
      fieldErrors,
    },
  };
}
