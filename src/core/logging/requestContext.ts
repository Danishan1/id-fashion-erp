import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

/**
 * Request-scoped context (a correlation ID plus the acting user/company once
 * known) threaded into every log line without touching every one of this
 * app's ~270 route handlers individually. `enterWith` (not `run`) is used
 * deliberately — `requireSession()` is called partway through a route
 * handler's own body, not as a wrapping callback around it, so there is no
 * single call site that could hold a `run(store, () => ...)` closure around
 * "the rest of this handler." `enterWith` sets the store for the remainder of
 * the current async execution context instead, which is exactly what's
 * needed here since Node's async_hooks tracks the continuation regardless.
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
  companyId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Call once per request, as early as possible — requireSession() is the actual call site. */
export function initRequestContext(): string {
  const requestId = randomUUID();
  storage.enterWith({ requestId });
  return requestId;
}

/** Call once the session is resolved, so later log lines in this same request carry who was acting. */
export function setRequestActor(userId: string, companyId: string): void {
  const current = storage.getStore();
  if (current) {
    current.userId = userId;
    current.companyId = companyId;
  }
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
