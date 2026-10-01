import { createHmac, timingSafeEqual } from "node:crypto";
import { suggestLeadMapping } from "../../ingestion/lead-field-catalog";
import { AdapterPayloadError, type AdapterLeadRecord, type LeadProviderAdapter } from "./lead-provider-adapter";

/**
 * Generic signed webhook — for website forms, Zapier / Make / Pabbly, or any
 * system that can POST JSON.
 *
 * Signature (required): headers
 *   X-CRM-Timestamp: <unix seconds>
 *   X-CRM-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 * Requests older than 5 minutes are rejected (replay protection).
 * Optional X-CRM-Event-Id makes a single-lead delivery idempotent.
 *
 * Body: one lead object, or { "leads": [ … ] } (up to 50). Field mapping:
 * the endpoint's mapping (CRM field → dotted JSON path) when set, otherwise
 * automatic by key name (same aliases as the import wizard).
 */
export const MAX_LEADS_PER_DELIVERY = 50;
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function signGenericWebhook(secret: string, timestamp: number | string, rawBody: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc) && /^\d+$/.test(part)) return acc[Number(part)];
    return typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined;
  }, obj);
}

/** Top-level keys plus one nested level ("contact.email"), for automatic mapping. */
function flatten(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) out[`${k}.${k2}`] = v2;
    } else out[k] = v;
  }
  return out;
}

const text = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v).slice(0, 200));

export function mapRecord(record: Record<string, unknown>, fieldMapping: Record<string, string>): Omit<AdapterLeadRecord, "externalEventId" | "raw"> {
  const mapped: Record<string, unknown> = {};

  let unmappedKeys: string[] = [];
  if (Object.keys(fieldMapping).length) {
    for (const [target, path] of Object.entries(fieldMapping)) {
      const v = getPath(record, path);
      if (v !== undefined) mapped[target] = v;
    }
    const used = new Set(Object.values(fieldMapping).map((p) => p.split(".")[0]));
    unmappedKeys = Object.keys(record).filter((k) => !used.has(k));
  } else {
    const flat = flatten(record);
    // Custom fields can be sent as { customFields: { key: value } } or cf:<key>.
    const custom = record.customFields && typeof record.customFields === "object" ? (record.customFields as Record<string, unknown>) : {};
    const keys = Object.keys(flat).filter((k) => !k.startsWith("customFields."));
    const suggestion = suggestLeadMapping(keys.map((k) => k.replace(/^(lead|contact|data|fields)\./, "")));
    keys.forEach((k) => {
      const target = suggestion[k.replace(/^(lead|contact|data|fields)\./, "")];
      if (k.startsWith("cf:")) mapped[k] = flat[k];
      else if (target) mapped[target] = flat[k];
      else if (!["id", "event_id", "eventId", "externalLeadId", "external_lead_id", "externalEventId"].includes(k)) unmappedKeys.push(k);
    });
    for (const [k, v] of Object.entries(custom)) mapped[`cf:${k}`] = v;
  }
  const externalLeadId = text(mapped.externalId) ?? text(record.externalLeadId) ?? text(record.external_lead_id) ?? text(record.lead_id) ?? text(record.id);
  delete mapped.externalId;
  return { mapped, externalLeadId, unmappedKeys };
}

export const genericWebhookAdapter: LeadProviderAdapter = {
  provider: "generic",
  label: "Generic signed webhook",
  channel: "WEBHOOK",
  defaultSourceKey: "website",
  verifySignature({ headers, rawBody, secret, now }) {
    const ts = headers.get("x-crm-timestamp");
    const sig = headers.get("x-crm-signature");
    if (!ts || !sig) return { ok: false, reason: "Missing X-CRM-Timestamp or X-CRM-Signature header." };
    if (!/^\d{9,11}$/.test(ts)) return { ok: false, reason: "X-CRM-Timestamp must be a Unix time in seconds." };
    if (Math.abs(now.getTime() / 1000 - Number(ts)) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "The request timestamp is too old or in the future." };
    const expected = Buffer.from(signGenericWebhook(secret, ts, rawBody));
    const given = Buffer.from(sig.trim());
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: "Invalid signature." };
    return { ok: true };
  },
  parse({ headers, rawBody, fieldMapping }) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      throw new AdapterPayloadError("The body must be JSON.");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new AdapterPayloadError("The body must be a JSON object.");
    const obj = body as Record<string, unknown>;
    const records = Array.isArray(obj.leads) ? obj.leads : [obj];
    if (!records.length) throw new AdapterPayloadError("No leads in the payload.");
    if (records.length > MAX_LEADS_PER_DELIVERY) throw new AdapterPayloadError(`At most ${MAX_LEADS_PER_DELIVERY} leads per delivery.`);
    const headerEventId = text(headers.get("x-crm-event-id"));
    return records.map((r, i) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) throw new AdapterPayloadError(`Lead ${i + 1} is not a JSON object.`);
      const rec = r as Record<string, unknown>;
      const eventId = text(rec.event_id) ?? text(rec.eventId) ?? text(rec.externalEventId) ?? (headerEventId ? (records.length > 1 ? `${headerEventId}:${i}` : headerEventId) : null);
      return { ...mapRecord(rec, fieldMapping), externalEventId: eventId, raw: rec };

    });
  },
};
