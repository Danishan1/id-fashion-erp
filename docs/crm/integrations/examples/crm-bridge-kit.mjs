// CRM channel bridge kit — shared helpers for every example bridge.
//
// Zero dependencies: Node.js 18+ (global fetch, FormData, Blob, Request).
// A "bridge" is a small service you run that sits between a messaging
// provider (WhatsApp, Messenger, Twilio, Mailgun, your website chat…) and the
// Fashion ERP CRM:
//
//   provider webhook ──► bridge ──► CRM channel webhook   (inbound + delivery receipts)
//   CRM outbound URL ──► bridge ──► provider send API     (replies from the inbox)
//
// Configuration (environment variables, one CRM channel per bridge instance):
//   CRM_WEBHOOK_URL      the channel's webhook URL from CRM Settings → Channels
//   CRM_SIGNING_SECRET   the channel's signing secret (whsec_…), shown once
//
// See docs/crm/integrations/README.md for the full contract.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";

export const CRM_TOLERANCE_SECONDS = 300;

// ── Signing (identical algorithm in both directions) ─────────────────────────

/** "sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>" */
export function signCrm(secret, timestamp, rawBody) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checks a request the CRM sent to your outbound URL. Returns null when valid, otherwise the reason. */
export function verifyCrmRequest(headers, rawBody, secret, now = Date.now()) {
  const ts = headers["x-crm-timestamp"];
  const sig = headers["x-crm-signature"];
  if (!ts || !sig) return "missing signature headers";
  if (!/^\d{9,11}$/.test(ts)) return "bad timestamp";
  if (Math.abs(now / 1000 - Number(ts)) > CRM_TOLERANCE_SECONDS) return "timestamp outside the 5-minute window";
  if (!safeEqual(signCrm(secret, ts, rawBody), sig)) return "invalid signature";
  return null;
}

// ── Sending to the CRM ───────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CrmRejectedError extends Error {
  constructor(status, body) {
    super(`CRM rejected the delivery (HTTP ${status}): ${body?.error?.message ?? body?.message ?? "no details"}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * POSTs events ({ events: [...] }) to the CRM channel webhook, signed.
 * Retries network errors, 429 and 5xx (incl. 503 "channel paused", honouring
 * Retry-After) with exponential backoff. 4xx other than 429 are permanent —
 * fix the payload, don't retry. Re-sending the same message id is always safe:
 * the CRM stores it once and answers "duplicate".
 */
export async function sendToCrm(events, { url = process.env.CRM_WEBHOOK_URL, secret = process.env.CRM_SIGNING_SECRET, attempts = 5 } = {}) {
  if (!url || !secret) throw new Error("Set CRM_WEBHOOK_URL and CRM_SIGNING_SECRET");
  if (!events.length) return { received: 0, results: [] };
  const rawBody = JSON.stringify({ events });
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // Sign every attempt with a fresh timestamp (the CRM rejects signatures older than 5 minutes).
    const ts = Math.floor(Date.now() / 1000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CRM-Timestamp": String(ts), "X-CRM-Signature": signCrm(secret, ts, rawBody) },
        body: rawBody,
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json().catch(() => null);
      if (res.ok) return body.data;
      if (res.status !== 429 && res.status < 500) throw new CrmRejectedError(res.status, body);
      lastError = new CrmRejectedError(res.status, body);
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 2 ** attempt * 500);
    } catch (e) {
      if (e instanceof CrmRejectedError && e.status !== 429 && e.status < 500) throw e;
      lastError = e;
      await sleep(2 ** attempt * 500);
    }
  }
  throw lastError;
}

/**
 * Delivery receipts can arrive before the CRM has saved the provider's message
 * id for a reply it just sent (the provider answers the send call and fires
 * the "sent" webhook almost at once). The CRM then answers "unknown_message";
 * wait a moment and send the receipt again.
 */
export async function sendStatusesToCrm(statusEvents, opts = {}) {
  let pending = statusEvents;
  for (let round = 0; round < 4 && pending.length; round++) {
    if (round) await sleep(3000 * round);
    const data = await sendToCrm(pending, opts);
    const unknown = new Set(data.results.filter((r) => r.outcome === "unknown_message").map((r) => r.id));
    pending = pending.filter((e) => unknown.has(e.messageId));
  }
  return pending.length;
}

// ── Outbound (CRM → your bridge) ─────────────────────────────────────────────

/**
 * The CRM sends a reply at most once per click, but it re-sends the SAME id
 * (X-CRM-Idempotency-Key) when a user presses Retry after a timeout. Remember
 * what each id produced so a retry never messages the customer twice.
 * In-memory here; use Redis / your database when you run more than one bridge process.
 */
export function createIdempotencyStore(ttlMs = 24 * 3600 * 1000) {
  const seen = new Map();
  return {
    get(key) {
      const hit = seen.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.value;
      seen.delete(key);
      return undefined;
    },
    set(key, value) {
      seen.set(key, { at: Date.now(), value });
    },
  };
}

/**
 * Standard outbound handler: verifies the CRM signature, de-duplicates by
 * idempotency key, calls `deliver(payload)` and answers the CRM.
 *
 * `deliver` returns { messageId, status? } on success, or throws
 * ProviderError(httpStatus, reason). Answer codes the CRM understands:
 *   2xx { messageId }  → message SENT (or DELIVERED / READ if you pass status)
 *   429 / 5xx          → FAILED, "retryable" (temporary problem)
 *   other 4xx          → FAILED, not retryable (e.g. outside the 24-hour window)
 * The CRM never shows your response body to users — log details on your side.
 */
export class ProviderError extends Error {
  constructor(httpStatus, reason) {
    super(reason);
    this.httpStatus = httpStatus;
  }
}

export function outboundHandler({ secret = process.env.CRM_SIGNING_SECRET, deliver, store = createIdempotencyStore(), log = console }) {
  return async (req, res, rawBody) => {
    const problem = verifyCrmRequest(req.headers, rawBody, secret);
    if (problem) return sendJson(res, 401, { error: problem });
    const payload = JSON.parse(rawBody);
    const key = req.headers["x-crm-idempotency-key"] ?? payload.id;
    const cached = store.get(key);
    if (cached) return sendJson(res, 200, cached);
    try {
      const result = await deliver(payload);
      const answer = { messageId: result.messageId, ...(result.status ? { status: result.status } : {}) };
      store.set(key, answer);
      return sendJson(res, 200, answer);
    } catch (e) {
      const status = e instanceof ProviderError ? e.httpStatus : 502;
      log.error?.(`[outbound ${key}] ${e.message}`);
      return sendJson(res, status, { error: e.message });
    }
  };
}

// ── Tiny HTTP server ────────────────────────────────────────────────────────

export function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Reads the raw body (needed for every signature check) with a size cap. */
export function readRawBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * routes: { "POST /path": async (req, res, rawBody: string, rawBuffer: Buffer, url: URL) => void }
 * Unhandled errors answer 500 — providers (Meta, Twilio, Mailgun) then retry,
 * which is safe because the CRM de-duplicates by message id.
 */
export function startServer(port, routes, log = console) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const handler = routes[`${req.method} ${url.pathname}`] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && `${req.method} ${url.pathname}`.startsWith(k.slice(0, -1)))?.[1];
    if (!handler) return sendJson(res, 404, { error: "not found" });
    try {
      const buf = await readRawBody(req);
      await handler(req, res, buf.toString("utf8"), buf, url);
    } catch (e) {
      log.error?.(`[${req.method} ${url.pathname}] ${e.message}`);
      if (!res.headersSent) sendJson(res, 500, { error: "bridge error" });
    }
  });
  server.listen(port, () => log.info?.(`bridge listening on :${port}`));
  return server;
}

// ── Mapping helpers ─────────────────────────────────────────────────────────

/** Types the CRM file store accepts (others are listed in the thread as "not stored"). */
export const CRM_STORABLE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.ms-excel",
  "text/csv",
]);

/** Unix seconds / milliseconds → ISO-8601 for the CRM "timestamp" field. */
export function isoFromUnix(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

/** Downloads a file and returns a CRM attachment with inline content (or null if too big / not storable). */
export async function fetchAsCrmAttachment(url, { fileName, mimeType, headers = {}, maxBytes = 8 * 1024 * 1024 } = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const type = (mimeType ?? res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes || !CRM_STORABLE_MIME.has(type)) return null;
  return { fileName: fileName ?? `file-${randomUUID().slice(0, 8)}`, mimeType: type, contentBase64: buf.toString("base64"), size: buf.length };
}

export const env = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${name}`);
  return v;
};
