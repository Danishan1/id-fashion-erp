import { createHash } from "node:crypto";
import type { Prisma, SupportEventActorType } from "@prisma/client";
import { prisma } from "@/core/db/client";

/**
 * Tamper-evident support audit log (PLAT-015). One hash chain per support
 * request: every event stores the previous event's hash and its own hash
 * over (prevHash, seq, eventType, actor, method, path, detail, createdAt).
 * Editing or deleting any past row breaks every hash after it. The table is
 * also append-only at the database level (trigger in the migration).
 */

export interface SupportEventInput {
  requestId: string;
  eventType: string;
  actorType: SupportEventActorType;
  actorId?: string | null;
  method?: string | null;
  path?: string | null;
  detail?: Prisma.InputJsonValue | null;
}

type Tx = Prisma.TransactionClient;

interface HashFields {
  prevHash: string | null;
  seq: number;
  eventType: string;
  actorType: string;
  actorId: string | null;
  method: string | null;
  path: string | null;
  detail: unknown;
  createdAt: Date;
}

/** Deterministic JSON (sorted keys) so the hash doesn't depend on key order. */
function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computeSupportEventHash(fields: HashFields): string {
  const payload = [
    fields.prevHash ?? "",
    String(fields.seq),
    fields.eventType,
    fields.actorType,
    fields.actorId ?? "",
    fields.method ?? "",
    fields.path ?? "",
    stableJson(fields.detail),
    fields.createdAt.toISOString(),
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Appends one event. Takes a per-request advisory lock so two concurrent
 * events can't both claim the same `seq` / previous hash.
 */
export async function recordSupportEventInTx(tx: Tx, input: SupportEventInput): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`support-events:${input.requestId}`}))`;
  const last = await tx.supportAccessEvent.findFirst({
    where: { requestId: input.requestId },
    orderBy: { seq: "desc" },
    select: { seq: true, hash: true },
  });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? null;
  // Millisecond precision — matches what Postgres TIMESTAMP(3) stores back.
  const createdAt = new Date(Math.floor(Date.now()));
  const detail = input.detail ?? null;
  const hash = computeSupportEventHash({
    prevHash,
    seq,
    eventType: input.eventType,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    method: input.method ?? null,
    path: input.path ?? null,
    detail,
    createdAt,
  });
  await tx.supportAccessEvent.create({
    data: {
      requestId: input.requestId,
      seq,
      eventType: input.eventType,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      method: input.method ?? null,
      path: input.path ?? null,
      detail: detail === null ? undefined : detail,
      prevHash,
      hash,
      createdAt,
    },
  });
}

export async function recordSupportEvent(input: SupportEventInput): Promise<void> {
  await prisma.$transaction((tx) => recordSupportEventInTx(tx, input));
}

export interface ChainVerification {
  valid: boolean;
  eventCount: number;
  /** seq of the first event whose hash or link doesn't match. */
  brokenAtSeq: number | null;
}

/** Re-computes the whole chain for one request. */
export async function verifySupportEventChain(requestId: string): Promise<ChainVerification> {
  const events = await prisma.supportAccessEvent.findMany({ where: { requestId }, orderBy: { seq: "asc" } });
  let prevHash: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const expected = computeSupportEventHash({
      prevHash,
      seq: event.seq,
      eventType: event.eventType,
      actorType: event.actorType,
      actorId: event.actorId,
      method: event.method,
      path: event.path,
      detail: event.detail ?? null,
      createdAt: event.createdAt,
    });
    if (event.seq !== i + 1 || event.prevHash !== prevHash || event.hash !== expected) {
      return { valid: false, eventCount: events.length, brokenAtSeq: event.seq };
    }
    prevHash = event.hash;
  }
  return { valid: true, eventCount: events.length, brokenAtSeq: null };
}
