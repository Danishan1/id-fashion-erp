import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/core/db/client";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { SM_API_LIMITS } from "./integration-registry";

/**
 * Phase 16 — Idempotency-Key for API writes (24 h, per API key). The first
 * request claims the key; a repeat with the same body returns the stored
 * response (header Idempotent-Replayed: true); a repeat with a different body
 * is refused; a repeat while the first is still running gets 409
 * REQUEST_IN_PROGRESS. Failed requests release the key so a retry can run.
 */

const KEY_RE = /^[A-Za-z0-9_.:-]{8,100}$/;

export type IdempotentResult<T> = { replayed: boolean; status: number; data: T };

export async function withIdempotency<T>(scope: { companyId: string; apiKeyId: string }, rawKey: string | null, fingerprint: string, run: () => Promise<{ status: number; data: T }>): Promise<IdempotentResult<T>> {
  if (!rawKey) return { replayed: false, ...(await run()) };
  const key = rawKey.trim();
  if (!KEY_RE.test(key)) throw new BusinessRuleError("VALIDATION_ERROR", "Idempotency-Key must be 8–100 letters, digits, '_', '.', ':' or '-'.");
  const requestHash = createHash("sha256").update(fingerprint).digest("hex");
  const since = new Date(Date.now() - SM_API_LIMITS.idempotencyHours * 3_600_000);
  // Expired keys are free again.
  await prisma.integrationIdempotency.deleteMany({ where: { apiKeyId: scope.apiKeyId, key, createdAt: { lt: since } } });
  let claimId: string;
  try {
    claimId = (await prisma.integrationIdempotency.create({ data: { companyId: scope.companyId, apiKeyId: scope.apiKeyId, key, requestHash }, select: { id: true } })).id;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    const prior = await prisma.integrationIdempotency.findUnique({ where: { apiKeyId_key: { apiKeyId: scope.apiKeyId, key } } });
    if (!prior) throw new BusinessRuleError("REQUEST_IN_PROGRESS", "Retry shortly.");
    if (prior.requestHash !== requestHash) throw new BusinessRuleError("VALIDATION_ERROR", "This Idempotency-Key was already used for a different request.");
    if (prior.status === null) throw new BusinessRuleError("REQUEST_IN_PROGRESS", "The first request with this Idempotency-Key is still running. Retry shortly.");
    return { replayed: true, status: prior.status, data: prior.response as T };
  }
  try {
    const r = await run();
    await prisma.integrationIdempotency.update({ where: { id: claimId }, data: { status: r.status, response: r.data as Prisma.InputJsonValue } });
    return { replayed: false, ...r };
  } catch (e) {
    await prisma.integrationIdempotency.delete({ where: { id: claimId } }).catch(() => undefined);
    throw e;
  }
}

export async function purgeIdempotency(now = new Date()) {
  const { count } = await prisma.integrationIdempotency.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - SM_API_LIMITS.idempotencyHours * 3_600_000) } } });
  return count;
}
