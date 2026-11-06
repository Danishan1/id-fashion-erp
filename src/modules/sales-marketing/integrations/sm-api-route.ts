import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { BusinessRuleError, toErrorResponse } from "@/core/errors/BusinessRuleError";
import { logger } from "@/core/logging/logger";
import { runWithRequestContext } from "@/core/logging/requestContext";
import { PermissionService } from "@/core/rbac/PermissionService";
import { checkRateLimit } from "@/modules/crm/capture/capture-rate-limit";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { SM_API_LIMITS, SM_API_SCOPES, SM_API_VERSION, type SmApiScope } from "./integration-registry";
import { recordUsage, type UsageOutcome } from "./integration-registry.service";
import { authenticateSmApiKey, type ApiKeyIdentity } from "./sm-api-keys.service";

/**
 * Phase 16 — every /api/v1/integrations/sales-marketing/* route goes through
 * this wrapper, in this order:
 *
 *   1. body size (writes: 64 KB);
 *   2. API key (Bearer or X-API-Key) → 401 for anything not active;
 *   3. scope on the key → 403;
 *   4. rate limits: per key (its own limit, writes tighter) and per company → 429 + Retry-After;
 *   5. the run-as user (the key's creator) must still hold the scope's permission → 403;
 *   6. the handler, as that user, through the module's own service (record
 *      visibility and business rules are the service's, never re-implemented).
 *
 * Every response carries X-Request-Id and X-API-Version; counters per key and
 * endpoint (volume, errors, refusals, 429s) feed the registry and metrics.
 * Session cookies are never accepted here: these routes are for systems.
 */

export interface SmApiContext<P> {
  req: NextRequest;
  params: P;
  key: ApiKeyIdentity;
  actor: SalesActor;
  requestId: string;
}

type Handler<P> = (ctx: SmApiContext<P>) => Promise<{ data: unknown; meta?: unknown; status?: number; headers?: Record<string, string> } | Response>;

const json = (body: unknown, status: number, headers: Record<string, string>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function errorBody(code: string, message: string, requestId: string) {
  return { success: false, message, error: { code, message, details: { requestId } } };
}

export function presentedKey(req: NextRequest) {
  return req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? req.headers.get("x-api-key");
}

export function smApiRoute<P = Record<string, never>>(opts: { scope: SmApiScope; endpoint: string; write?: boolean }, handler: Handler<P>) {
  return async (req: NextRequest, ctx: { params: Promise<P> }) => {
    const requestId = randomUUID();
    const base: Record<string, string> = { "X-Request-Id": requestId, "X-API-Version": SM_API_VERSION };
    let key: ApiKeyIdentity | null = null;
    let outcome: UsageOutcome = "ok";
    let status = 200;
    try {
      if (opts.write && Number(req.headers.get("content-length") ?? 0) > SM_API_LIMITS.maxBodyBytes) {
        status = 413;
        return json(errorBody("PAYLOAD_TOO_LARGE", `The body is larger than ${SM_API_LIMITS.maxBodyBytes / 1024} KB.`, requestId), 413, base);
      }
      key = await authenticateSmApiKey(presentedKey(req));
      if (!key) {
        status = 401;
        logger.warn("S&M API: invalid credentials", { requestId, endpoint: opts.endpoint });
        return json(errorBody("INVALID_API_CREDENTIALS", "Invalid, expired, revoked or disabled API key.", requestId), 401, { ...base, "WWW-Authenticate": 'Bearer realm="erp"' });
      }
      if (!key.scopes.includes(opts.scope)) {
        [outcome, status] = ["denied", 403];
        return json(errorBody("PERMISSION_DENIED", `This key doesn't have the "${opts.scope}" scope.`, requestId), 403, base);
      }
      const perKey = opts.write ? Math.min(key.rateLimitPerMinute, SM_API_LIMITS.writePerKeyPerMinute) : key.rateLimitPerMinute;
      const k = checkRateLimit(`smapi:key:${key.keyId}:${opts.write ? "w" : "r"}`, perKey);
      const c = checkRateLimit(`smapi:co:${key.companyId}`, SM_API_LIMITS.perCompanyPerMinute);
      const rl = { "X-RateLimit-Limit": String(perKey), "X-RateLimit-Remaining": String(k.remaining), "X-RateLimit-Reset": String(Math.ceil(k.resetAt / 1000)) };
      if (!k.allowed || !c.allowed) {
        [outcome, status] = ["rate_limited", 429];
        const retry = Math.max(1, Math.ceil(((!k.allowed ? k.resetAt : c.resetAt) - Date.now()) / 1000));
        return json(errorBody("RATE_LIMITED", !k.allowed ? `Too many requests for this key — at most ${perKey} per minute.` : "Too many requests for this company. Slow down.", requestId), 429, { ...base, ...rl, "Retry-After": String(retry) });
      }
      const perm = SM_API_SCOPES[opts.scope].permission;
      if (!(await PermissionService.can(key.userId, perm.module as never, perm.action as never))) {
        [outcome, status] = ["denied", 403];
        return json(errorBody("PERMISSION_DENIED", `The user this key acts as no longer has ${perm.module}.${perm.action}.`, requestId), 403, { ...base, ...rl });
      }
      const actor: SalesActor = { companyId: key.companyId, userId: key.userId, branchId: null };
      const params = await ctx.params;
      const ident = key;
      const r = await runWithRequestContext({ requestId: `api:${requestId}`, userId: ident.userId, companyId: ident.companyId }, () => handler({ req, params, key: ident, actor, requestId }));
      if (r instanceof Response) {
        status = r.status;
        for (const [h, v] of Object.entries({ ...base, ...rl })) r.headers.set(h, v);
        return r;
      }
      status = r.status ?? 200;
      return json({ data: r.data, ...(r.meta !== undefined ? { meta: r.meta } : {}) }, status, { ...base, ...rl, ...(r.headers ?? {}) });
    } catch (e) {
      const { status: s, body } = toErrorResponse(e);
      status = s;
      outcome = s === 403 ? "denied" : "error";
      if (s >= 500) logger.error("S&M API error", { requestId, endpoint: opts.endpoint, error: (e as Error)?.message });
      // Business errors keep their message; anything else is generic, with the request id for support.
      const out = e instanceof BusinessRuleError || s < 500 ? { ...(body as object), error: { ...((body as { error: object }).error ?? {}), details: { ...(((body as { error?: { details?: object } }).error?.details as object) ?? {}), requestId } } } : errorBody("INTERNAL_ERROR", "Something went wrong. Quote the request id to support.", requestId);
      return json(out, s, base);
    } finally {
      if (key) await recordUsage({ companyId: key.companyId, clientId: key.keyId, endpoint: opts.endpoint, outcome: status >= 400 && outcome === "ok" ? "error" : outcome, status });
    }
  };
}

/** Paging for list endpoints (page / pageSize, max 100). */
export function pageOf(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Math.min(10_000, Number(sp.get("page") ?? 1) || 1));
  const pageSize = Math.max(1, Math.min(SM_API_LIMITS.maxPageSize, Number(sp.get("pageSize") ?? 25) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
export const pageMeta = (total: number, p: { page: number; pageSize: number }) => ({ page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) });

/** Reads a JSON body within the size limit. */
export async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (Buffer.byteLength(text) > SM_API_LIMITS.maxBodyBytes) throw new BusinessRuleError("PAYLOAD_TOO_LARGE", `The body is larger than ${SM_API_LIMITS.maxBodyBytes / 1024} KB.`);
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "application/json")) throw new BusinessRuleError("VALIDATION_ERROR", "Send Content-Type: application/json.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new BusinessRuleError("VALIDATION_ERROR", "The body must be JSON.");
  }
}
