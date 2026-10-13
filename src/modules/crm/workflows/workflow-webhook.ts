import { createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * Outbound webhook calls made by the "Call a webhook" workflow action.
 *
 * Server-side request forgery protection:
 *   - https only (plain http only when CRM_WORKFLOW_WEBHOOK_ALLOW_HTTP=true, for local testing);
 *   - the host is resolved once and EVERY address must be public — loopback,
 *     private, link-local (incl. cloud metadata 169.254.169.254), CGNAT,
 *     multicast and reserved ranges are refused, IPv4 and IPv6;
 *   - the connection is pinned to the vetted address (no DNS re-resolution →
 *     no DNS-rebinding), SNI / Host keep the original name;
 *   - no redirects are followed, 10 s timeout, response capped at 64 KB;
 *   - hosts an administrator deliberately allows (an on-premise system) go in
 *     CRM_WORKFLOW_WEBHOOK_ALLOWED_HOSTS (comma separated, exact names).
 *
 * Every request is signed: X-CRM-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">
 * with the workflow's own secret, plus an Idempotency-Key the receiver can
 * de-duplicate on. Secrets never appear in logs or execution traces.
 */

export class WebhookBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookBlockedError";
  }
}

export class WebhookCallError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** True when the receiver may not have processed it (timeout / connection reset) — not retried automatically. */
    readonly uncertain: boolean
  ) {
    super(message);
    this.name = "WebhookCallError";
  }
}

const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 256 * 1024;

function v4Blocked(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Is this IP address one a workflow may never call? */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Blocked(ip);
  if (kind !== 6) return true;
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return v4Blocked(mapped[1]);
  if (lower.startsWith("::ffff:")) return true;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 /* fc00::/7 */ || (first & 0xffc0) === 0xfe80 /* fe80::/10 */ || (first & 0xff00) === 0xff00 /* multicast */ || lower.startsWith("64:ff9b:") || lower.startsWith("2001:db8:");
}

function allowedHosts(): Set<string> {
  return new Set(
    (process.env.CRM_WORKFLOW_WEBHOOK_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Validates the URL shape (no network). Throws WebhookBlockedError. */
export function assertWebhookUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookBlockedError("The webhook URL isn't a valid URL.");
  }
  const allowHttp = process.env.CRM_WORKFLOW_WEBHOOK_ALLOW_HTTP === "true";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) throw new WebhookBlockedError("Webhook URLs must use https.");
  if (url.username || url.password) throw new WebhookBlockedError("Don't put credentials in the webhook URL.");
  if (url.port && !["443", "8443", ...(allowHttp ? ["80", "8080"] : [])].includes(url.port) && !allowedHosts().has(url.hostname.toLowerCase())) throw new WebhookBlockedError("Webhook URLs may only use the standard https ports (443, 8443).");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(url.hostname) && !allowedHosts().has(url.hostname.toLowerCase())) throw new WebhookBlockedError("Webhook URLs can't point to internal host names.");
  return url;
}

/** Resolves the host and returns one vetted public address (or an allow-listed host's address). */
export async function resolveSafeAddress(url: URL): Promise<{ address: string; family: 4 | 6 }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const allowListed = allowedHosts().has(host.toLowerCase());
  const literal = isIP(host);
  const addresses = literal ? [{ address: host, family: literal as 4 | 6 }] : ((await dnsLookup(host, { all: true, verbatim: true }).catch(() => [])) as { address: string; family: 4 | 6 }[]);
  if (!addresses.length) throw new WebhookBlockedError(`Couldn't resolve ${host}.`);
  if (!allowListed && addresses.some((a) => isBlockedAddress(a.address))) throw new WebhookBlockedError(`${host} resolves to a private or internal address; workflows can only call public URLs.`);
  return addresses[0];
}

export function signWebhookBody(secret: string, body: string, timestamp: number): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export interface WebhookResult {
  status: number;
  /** First 1 KB of the response, for the execution trace. */
  bodyPreview: string;
  durationMs: number;
}

/** POSTs JSON. 2xx = success; anything else throws WebhookCallError. */
export async function postSignedWebhook(rawUrl: string, payload: unknown, opts: { secret: string; idempotencyKey: string; eventId: string }): Promise<WebhookResult> {
  const url = assertWebhookUrlShape(rawUrl);
  const target = await resolveSafeAddress(url);
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new WebhookBlockedError("The webhook body is too large (max 256 KB).");
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "FashionERP-CRM-Workflows/1",
    "X-CRM-Event-Id": opts.eventId,
    "Idempotency-Key": opts.idempotencyKey,
    "X-CRM-Signature": signWebhookBody(opts.secret, body, ts),
    "Content-Length": String(Buffer.byteLength(body)),
  };
  const started = Date.now();
  const client = url.protocol === "https:" ? https : http;
  return new Promise<WebhookResult>((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers,
        servername: isIP(url.hostname) ? undefined : url.hostname,
        // Pin the connection to the vetted address (no second DNS lookup).
        lookup: (_host: string, options: unknown, cb: (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void) => {
          const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
          if (all) cb(null, [{ address: target.address, family: target.family }]);
          else cb(null, target.address, target.family);
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= MAX_RESPONSE_BYTES) chunks.push(c);
          else res.destroy();
        });
        const done = () => {
          const status = res.statusCode ?? 0;
          const preview = Buffer.concat(chunks).toString("utf8").slice(0, 1024);
          if (status >= 200 && status < 300) resolve({ status, bodyPreview: preview, durationMs: Date.now() - started });
          else if (status >= 300 && status < 400) reject(new WebhookCallError(`The webhook answered with a redirect (${status}); redirects are not followed.`, status, false));
          else reject(new WebhookCallError(`The webhook answered ${status}.`, status, false));
        };
        res.on("end", done);
        res.on("close", () => {
          if (!res.complete) done();
        });
      }
    );
    req.on("timeout", () => req.destroy(new WebhookCallError(`The webhook didn't answer within ${TIMEOUT_MS / 1000} s.`, null, true)));
    req.on("error", (e) => reject(e instanceof WebhookCallError ? e : new WebhookCallError(`Couldn't call the webhook: ${e.message}`, null, true)));
    req.end(body);
  });
}
