"use client";

import { useSyncExternalStore } from "react";
import { CopyableCode } from "@/components/crm/SecretOnce";
import type { CrmSettingsTab } from "./CrmSettingsClient";

/**
 * Phase 22 — CRM Settings → API access: how to call the lead capture API.
 * Everything documented here is what POST /api/v1/crm/leads/ingest actually
 * does (see that route); examples use the placeholder YOUR_API_KEY — a stored
 * key is never shown again after it is created.
 */

const noop = () => () => {};
/** The address this ERP is served from (the browser's origin), so examples match the deployment. */
export function useOrigin() {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => "https://your-erp.example.com"
  );
}

const RESPONSES: [string, string][] = [
  ["201", "Imported — a new lead was created."],
  ["200", "Updated or skipped as a duplicate (per the key's duplicate policy), or a replay of an earlier request with the same Idempotency-Key (header Idempotent-Replayed: true)."],
  ["202", "Flagged for review — a possible duplicate waits in Leads → Imports for someone to decide."],
  ["400", "The body isn't valid JSON or has a malformed reserved field (channel, externalLeadId, duplicatePolicy…)."],
  ["401", "Missing, invalid, expired or revoked API key."],
  ["409", "The same Idempotency-Key is still being processed — retry in a few seconds."],
  ["413", "Body larger than 100 KB."],
  ["422", "The lead was rejected (e.g. no name or contact detail, invalid email) — outcome FAILED; `messages` explains what to fix."],
  ["429", "More than 120 requests per minute for this key — slow down and retry."],
];

export function ApiAccessTab({ onSelect }: { onSelect: (t: CrmSettingsTab) => void }) {
  const origin = useOrigin();
  const endpoint = `${origin}/api/v1/crm/leads/ingest`;
  const curl = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: form-submission-123" \\
  -d '{
    "channel": "WEBSITE_FORM",
    "name": "Asha Rao",
    "email": "asha@example.com",
    "mobile": "+91 98765 43210",
    "companyName": "Rao Exports",
    "requirement": "5,000 polo shirts",
    "utmSource": "google",
    "externalLeadId": "web-123"
  }'`;
  const node = `// Server-side only: never put the API key in browser JavaScript or a mobile app.
const res = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.CRM_API_KEY}\`,
    "Content-Type": "application/json",
    "Idempotency-Key": submission.id, // same value when you retry
  },
  body: JSON.stringify({ channel: "WEBSITE_FORM", name, email, mobile, requirement }),
});
const { data } = await res.json(); // { submissionId, outcome, leadId, leadNumber, messages, unmappedFields, replayed }`;
  const response = `HTTP/1.1 201 Created
{
  "data": {
    "submissionId": "…",
    "outcome": "IMPORTED",
    "reason": null,
    "leadId": "…",
    "leadNumber": "LEAD-2026-00042",
    "messages": [],
    "unmappedFields": [],
    "replayed": false
  }
}`;
  return (
    <div className="max-w-4xl space-y-5 text-sm text-zinc-700 dark:text-zinc-300">
      <p>
        The lead capture API lets your website, landing pages or another system create leads. Every request goes through the same validation, duplicate rules and assignment as imports. It is the only public CRM API today: other CRM endpoints are for
        signed-in users of this application.
      </p>
      <section className="space-y-2">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">1. Create a key</h3>
        <p>
          In <button type="button" className="text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => onSelect("api-keys")}>API keys</button>, create one key per website or system, choosing its lead source, owner and duplicate policy. The key is
          shown once — store it in that system&apos;s secret manager or environment variables. Keys can only create leads (scope <code>leads:ingest</code>), can expire, and can be revoked at any time.
        </p>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">2. Send leads</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-zinc-500">Endpoint</dt>
          <dd>
            <code className="break-all">POST {endpoint}</code>
          </dd>
          <dt className="text-zinc-500">Authentication</dt>
          <dd>
            <code>Authorization: Bearer &lt;key&gt;</code> (or <code>X-API-Key: &lt;key&gt;</code>)
          </dd>
          <dt className="text-zinc-500">Body</dt>
          <dd>JSON, up to 100 KB — lead fields flat or under <code>lead</code>; <code>customFields</code> by key</dd>
          <dt className="text-zinc-500">Retries</dt>
          <dd>
            Send an <code>Idempotency-Key</code> header (or <code>externalEventId</code>): repeating it returns the first result instead of a second lead
          </dd>
          <dt className="text-zinc-500">Rate limit</dt>
          <dd>120 requests per minute per key</dd>
        </dl>
        <p>
          Field names: exact CRM keys (<code>fullName</code>, <code>firstName</code>, <code>lastName</code>, <code>email</code>, <code>mobile</code>, <code>companyName</code>, <code>requirement</code>, <code>source</code>, <code>tags</code>,{" "}
          <code>utmSource</code>…) are used as-is; common alternatives (&quot;name&quot;, &quot;mobile_no&quot;, &quot;Email ID&quot;) are matched like import headers, and anything unrecognised is returned in <code>unmappedFields</code> rather than rejected.{" "}
          <code>externalLeadId</code> lets the CRM recognise the same lead from your system later. <code>&quot;channel&quot;: &quot;WEBSITE_FORM&quot;</code> marks website form submissions.
        </p>
        <CopyableCode title="curl" code={curl} />
        <CopyableCode title="Node.js (server-side)" code={node} />
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">3. Handle the response</h3>
        <CopyableCode title="Example response" code={response} />
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {RESPONSES.map(([code, text]) => (
                <tr key={code}>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{code}</td>
                  <td className="px-3 py-1.5">{text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Errors use <code>{"{ \"error\": { \"code\", \"message\", \"details\" } }"}</code>. Retry 409, 429 and 5xx with back-off and the same Idempotency-Key; fix the request for 4xx.
        </p>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Security checklist</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Call the API from your server or form backend — never from browser JavaScript, where anyone can read the key.</li>
          <li>One key per system; revoke and replace a key that may have leaked. Keys can&apos;t be viewed again after creation.</li>
          <li>Don&apos;t log request headers that contain the key.</li>
          <li>
            Tools that can only send webhooks (Zapier, Make, Pabbly) can use a signed{" "}
            <button type="button" className="text-indigo-700 hover:underline dark:text-indigo-300" onClick={() => onSelect("webhooks")}>
              incoming lead webhook
            </button>{" "}
            instead.
          </li>
        </ul>
      </section>
    </div>
  );
}
