"use client";

import { CopyableCode } from "@/components/crm/SecretOnce";
import { SM_API_BASE, SM_API_LIMITS, SM_API_SCOPES, SM_API_SCOPE_KEYS, SM_API_VERSION, SM_PUBLIC_EVENTS, SM_PUBLIC_EVENT_TYPES, SM_WEBHOOK_LIMITS } from "@/modules/sales-marketing/integrations/integration-registry";
import { sampleSmEnvelope } from "@/modules/sales-marketing/integrations/public-event-contract";
import { CARD } from "./integration-ui";

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/campaigns", "sm.campaigns:read"],
  ["GET", "/campaigns/{id}", "sm.campaigns:read"],
  ["GET", "/campaigns/performance", "sm.performance:read"],
  ["GET", "/segments", "sm.segments:read"],
  ["GET", "/quotations", "sm.quotations:read"],
  ["GET", "/quotations/{id}", "sm.quotations:read"],
  ["POST", "/enquiries", "sm.enquiries:write"],
  ["GET", "/enquiries/{system}/{externalId}", "sm.enquiries:read"],
  ["POST", "/exports", "sm.exports:create"],
  ["GET", "/jobs/{id}", "sm.jobs:read"],
  ["GET", "/jobs/{id}/file", "sm.jobs:read"],
  ["GET · POST", "/webhooks", "sm.webhooks:manage"],
  ["GET · PATCH · DELETE", "/webhooks/{id}", "sm.webhooks:manage"],
  ["GET", "/webhooks/{id}/deliveries", "sm.webhooks:manage"],
  ["POST", "/webhooks/{id}/test", "sm.webhooks:manage"],
  ["POST", "/webhooks/{id}/rotate-secret", "sm.webhooks:manage"],
  ["GET", "/webhooks/events", "sm.webhooks:manage"],
];

const VERIFY = `import crypto from "node:crypto";
// rawBody: the request body exactly as received; secret: from your secret store.
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));   // "t=…,v1=…"
  const expected = crypto.createHmac("sha256", secret).update(\`\${parts.t}.\${rawBody}\`).digest("hex");
  const ok = parts.v1 && parts.v1.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;            // reject replays > 5 min
  return ok && fresh;
}
// Then de-duplicate on the Idempotency-Key header and answer 2xx within 10 s.`;

/** Phase 16 — developer guide, rendered from the same registry the API enforces. */
export function ApiGuidePanel({ origin }: { origin: string }) {
  const base = `${origin}${SM_API_BASE}`;
  const intake = `curl -X POST ${base}/enquiries \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: website-12345-v1" \\
  -d '{
    "system": "website",
    "externalId": "12345",
    "sourceUpdatedAt": "2026-11-06T09:30:00Z",
    "enquiry": {
      "subject": "Polo shirts for spring",
      "prospect": { "name": "Example Retail Ltd", "email": "buyer@example.com" },
      "lines": [{ "styleName": "Polo", "quantity": 500, "targetUnitPrice": 4.2 }]
    }
  }'`;
  return (
    <div className="space-y-4 text-sm">
      <section className={CARD}>
        <h3 className="font-semibold">Basics</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Base URL: <code>{base}</code> · version header <code>X-API-Version: {SM_API_VERSION}</code>. Fields may be added within v1; nothing is removed or renamed without a new version and notice.
          </li>
          <li>
            Authentication: <code>Authorization: Bearer &lt;key&gt;</code> (or <code>X-API-Key</code>). Keys come from the API keys tab and act as the person who created them.
          </li>
          <li>
            Limits: {SM_API_LIMITS.defaultPerKeyPerMinute} requests / minute per key (configurable 1–600; writes at most {SM_API_LIMITS.writePerKeyPerMinute}), {SM_API_LIMITS.perCompanyPerMinute} / minute per company. Over the limit: HTTP 429 with <code>Retry-After</code>; every response has <code>X-RateLimit-Limit / Remaining / Reset</code>.
          </li>
          <li>
            Bodies up to {SM_API_LIMITS.maxBodyBytes / 1024} KB; pages up to {SM_API_LIMITS.maxPageSize}; date ranges up to {SM_API_LIMITS.maxDateRangeDays} days.
          </li>
          <li>
            Errors: <code>{`{ "error": { "code", "message", "details": { "requestId" } } }`}</code> — 400 invalid, 401 bad key, 403 scope / permission, 404 not found or not visible, 409 conflict / in progress, 413 too large, 429 rate limited.
          </li>
          <li>
            Writes accept <code>Idempotency-Key</code> (8–100 characters, kept {SM_API_LIMITS.idempotencyHours} h): a repeat returns the first answer with <code>Idempotent-Replayed: true</code>.
          </li>
        </ul>
      </section>
      <section className={CARD}>
        <h3 className="font-semibold">Endpoints and scopes</h3>
        <table className="mt-2 w-full">
          <tbody>
            {ENDPOINTS.map(([m, p, s]) => (
              <tr key={`${m}${p}`} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 pr-3 font-mono text-xs">{m}</td>
                <td className="py-1 pr-3 font-mono text-xs">{p}</td>
                <td className="py-1 font-mono text-xs text-zinc-500">{s}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4 className="mt-3 font-medium">Scopes</h4>
        <ul className="mt-1 space-y-0.5 text-xs">
          {SM_API_SCOPE_KEYS.map((s) => (
            <li key={s}>
              <code>{s}</code> — {SM_API_SCOPES[s].label} (the key&apos;s user needs {SM_API_SCOPES[s].permission.module}.{SM_API_SCOPES[s].permission.action})
            </li>
          ))}
        </ul>
      </section>
      <section className={CARD}>
        <h3 className="font-semibold">Enquiry intake</h3>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          One enquiry per (system, externalId). The first call creates it (201); later calls update intake fields under the ownership rules (200 UPDATED / UNCHANGED), ignore anything older than what was last applied (STALE_IGNORED), and list conflicts instead of overwriting ERP data.
        </p>
        <div className="mt-2">
          <CopyableCode code={intake} title="Example" />
        </div>
      </section>
      <section className={CARD}>
        <h3 className="font-semibold">Webhooks</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            Each delivery is a POST with <code>X-CRM-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex HMAC-SHA256(secret, &quot;t.body&quot;)&gt;</code>, <code>Idempotency-Key</code> (the delivery id, same on retries), <code>X-ERP-Event-Type</code>, <code>X-ERP-Event-Version</code> and <code>X-ERP-Delivery-Attempt</code>.
          </li>
          <li>
            Delivery is <strong>at-least-once, not guaranteed and not ordered</strong>: retries after 1 min, 5 min, 30 min, 2 h and 6 h for timeouts, network errors, 408, 429 and 5xx; other answers and redirects fail at once. A 2xx means your receiver accepted it — not that its own processing finished. Up to {SM_WEBHOOK_LIMITS.maxPendingPerSubscription} queued deliveries per webhook; events are kept {SM_WEBHOOK_LIMITS.eventRetentionDays} days.
          </li>
          <li>Payloads are minimal (ids and statuses). Fetch details through the API with your own scopes.</li>
        </ul>
        <div className="mt-2 space-y-2">
          <CopyableCode code={VERIFY} title="Verify a delivery (Node.js)" />
          <CopyableCode code={JSON.stringify(sampleSmEnvelope("sm.quotation.accepted", false), null, 2)} title="Example body (synthetic)" />
        </div>
        <h4 className="mt-3 font-medium">Event types (version 1)</h4>
        <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
          {SM_PUBLIC_EVENT_TYPES.map((t) => (
            <li key={t}>
              <code>{t}</code> — {SM_PUBLIC_EVENTS[t].label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
