"use client";

import { toast } from "@/components/ui/Toast";

/**
 * Shared client-side API helpers + the global toast interceptor.
 *
 * Every API error body has the shape produced by `toErrorResponse`
 * (src/core/errors/BusinessRuleError.ts):
 *   { success: false, message, errors?: { "field.path": [msg] }, error: { code, message, details } }
 */

export interface ApiError {
  status: number;
  code: string | null;
  message: string;
  /** Field-keyed validation messages (Zod), e.g. { assignedQuantity: ["..."] }. */
  fieldErrors: Record<string, string[]>;
}

/** Request header: `"off"` suppresses the automatic toast(s) for this call. */
export const TOAST_HEADER = "x-toast";
/** Request header: overrides the automatic success message for this call. */
export const TOAST_SUCCESS_HEADER = "x-toast-success";

export function fallbackMessageForStatus(status: number): string {
  if (status === 0) return "Could not reach the server. Check your connection and try again.";
  if (status === 400) return "Please check the highlighted values and try again.";
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You do not have permission to perform this action.";
  if (status === 404) return "The requested record was not found.";
  if (status === 409) return "This action conflicts with the record's current state.";
  if (status >= 500) return "Something went wrong on the server. Please try again.";
  return "Request failed. Please try again.";
}

/** Parses an error Response without consuming it for any other reader. */
export async function readApiError(res: Response, fallback?: string): Promise<ApiError> {
  const body = await res
    .clone()
    .json()
    .catch(() => null);
  const inner = body?.error ?? null;
  const message =
    (typeof body?.message === "string" && body.message) ||
    (typeof inner?.message === "string" && inner.message) ||
    fallback ||
    fallbackMessageForStatus(res.status);
  return {
    status: res.status,
    code: typeof inner?.code === "string" ? inner.code : null,
    message,
    fieldErrors: body?.errors && typeof body.errors === "object" ? body.errors : {},
  };
}

/** Convenience: just the user-facing message. Drop-in for the copy-pasted `parseErrorMessage` helpers. */
export async function getApiErrorMessage(res: Response, fallback?: string): Promise<string> {
  return (await readApiError(res, fallback)).message;
}

// ---------------------------------------------------------------------------
// Global interceptor
// ---------------------------------------------------------------------------

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Endpoints whose POST/PATCH is a read, a preview, or background chatter —
 * never worth a "saved" toast (errors from them are still toasted).
 */
const NO_SUCCESS_TOAST_PATTERNS: RegExp[] = [
  /^\/api\/v1\/notifications/,
  /\/resolve(\/|$|\?)/,
  /\/preview(\/|$|\?)/,
  /\/duplicate-check/,
  /\/search(\/|$|\?)/,
  /\/validate(\/|$|\?)/,
  /\/export(\/|$|\?)/,
];

/** Endpoints never toasted at all (auth has its own UI, notifications poll quietly). */
const IGNORED_PATTERNS: RegExp[] = [/^\/api\/auth\//, /^\/api\/v1\/notifications/];

function successMessageFor(method: string): string {
  if (method === "DELETE") return "Deleted successfully.";
  if (method === "PATCH" || method === "PUT") return "Updated successfully.";
  return "Saved successfully.";
}

function resolvePath(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

let installed = false;

/**
 * Wraps `window.fetch` once so every same-origin `/api/v1/*` mutation shows a
 * success toast on 2xx and an error toast (using the API's own message) on
 * non-2xx or network failure. GETs are never toasted — list/detail loads keep
 * their own inline loading/error states. Callers can opt out per request with
 * the `x-toast: off` header or customise the success text with
 * `x-toast-success`; both headers are stripped before the request is sent.
 */
export function installApiToastInterceptor() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = resolvePath(input);
    const method = resolveMethod(input, init);
    const eligible =
      path !== null &&
      path.startsWith("/api/") &&
      MUTATING_METHODS.has(method) &&
      !IGNORED_PATTERNS.some((p) => p.test(path));

    if (!eligible) return originalFetch(input, init);

    let toastMode: string | null = null;
    let successOverride: string | null = null;
    let effectiveInit = init;
    if (init?.headers) {
      const headers = new Headers(init.headers);
      toastMode = headers.get(TOAST_HEADER);
      successOverride = headers.get(TOAST_SUCCESS_HEADER);
      if (toastMode !== null || successOverride !== null) {
        headers.delete(TOAST_HEADER);
        headers.delete(TOAST_SUCCESS_HEADER);
        effectiveInit = { ...init, headers };
      }
    }
    const silent = toastMode === "off";
    const errorsOnly = toastMode === "errors";

    let res: Response;
    try {
      res = await originalFetch(input, effectiveInit);
    } catch (err) {
      if (!silent && !(err instanceof DOMException && err.name === "AbortError")) {
        toast.error(fallbackMessageForStatus(0));
      }
      throw err;
    }

    if (silent) return res;
    if (res.ok) {
      if (!errorsOnly && !NO_SUCCESS_TOAST_PATTERNS.some((p) => p.test(path!))) {
        toast.success(successOverride || successMessageFor(method));
      }
    } else {
      const apiError = await readApiError(res);
      toast.error(apiError.message);
    }
    return res;
  };
}
