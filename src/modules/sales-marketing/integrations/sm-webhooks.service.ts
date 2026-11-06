import { PermissionService } from "@/core/rbac/PermissionService";
import * as subs from "@/modules/crm/webhooks-out/crm-webhook-subscriptions.service";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";
import { SM_PUBLIC_EVENTS, SM_PUBLIC_EVENT_TYPES } from "./integration-registry";
import { ensureRegistryRow, refreshRegistry } from "./integration-registry.service";
import { sampleSmEnvelope } from "./public-events";

/**
 * Phase 16 — outgoing webhooks for S&M events. The CRM Phase 22 engine with
 * scope SALES_MARKETING: same signing (HMAC-SHA256 over "t.body"), secret
 * shown once, https + public-address-only destinations (checked on save and
 * on every send, connection pinned, no redirects), retries, delivery log,
 * redeliver and rotation. Permissions: sales_integrations view / edit; a
 * redelivery (replay) needs approve.
 */

const SCOPE = "SALES_MARKETING" as const;
const crm = (a: SalesActor) => ({ companyId: a.companyId, userId: a.userId, branchId: a.branchId ?? null });
const view = (a: SalesActor) => PermissionService.assert(a.userId, "sales_integrations", "view");
const edit = (a: SalesActor) => PermissionService.assert(a.userId, "sales_integrations", "edit");

export async function listSmSubscriptions(actor: SalesActor) {
  await view(actor);
  return subs.listSubscriptions(crm(actor), SCOPE);
}

export async function getSmSubscription(actor: SalesActor, id: string) {
  await view(actor);
  return subs.getSubscription(crm(actor), id, SCOPE);
}

export async function createSmSubscription(actor: SalesActor, raw: unknown) {
  await edit(actor);
  const r = await subs.createSubscription(crm(actor), raw, SCOPE);
  await ensureRegistryRow(actor.companyId, "WEBHOOK_SUBSCRIPTION", r.id);
  return r;
}

export async function updateSmSubscription(actor: SalesActor, id: string, raw: unknown) {
  await edit(actor);
  const r = await subs.updateSubscription(crm(actor), id, raw, SCOPE);
  await ensureRegistryRow(actor.companyId, "WEBHOOK_SUBSCRIPTION", id);
  return r;
}

export async function rotateSmSubscriptionSecret(actor: SalesActor, id: string, raw: unknown) {
  await edit(actor);
  const r = await subs.rotateSubscriptionSecret(crm(actor), id, raw, SCOPE);
  await ensureRegistryRow(actor.companyId, "WEBHOOK_SUBSCRIPTION", id, { credentialRotatedAt: new Date() });
  return r;
}

export async function deleteSmSubscription(actor: SalesActor, id: string) {
  await edit(actor);
  const r = await subs.deleteSubscription(crm(actor), id, SCOPE);
  await refreshRegistry(actor.companyId, { kind: "WEBHOOK_SUBSCRIPTION", resourceId: id });
  return r;
}

export async function testSmSubscription(actor: SalesActor, id: string, raw: unknown) {
  await edit(actor);
  const r = await subs.sendTestDelivery(crm(actor), id, raw, SCOPE);
  await ensureRegistryRow(actor.companyId, "WEBHOOK_SUBSCRIPTION", id);
  return r;
}

export async function listSmDeliveries(actor: SalesActor, id: string, q: { status?: string; skip: number; take: number }) {
  await view(actor);
  return subs.listDeliveries(crm(actor), id, q, SCOPE);
}

/** Replay of a finished delivery (same Idempotency-Key). */
export async function redeliverSm(actor: SalesActor, id: string, deliveryId: string) {
  await PermissionService.assert(actor.userId, "sales_integrations", "approve");
  return subs.redeliver(crm(actor), id, deliveryId, SCOPE);
}

/** Event catalogue with a synthetic sample per type (UI and docs). */
export function smEventCatalogue() {
  return SM_PUBLIC_EVENT_TYPES.map((t) => ({ type: t, ...SM_PUBLIC_EVENTS[t], version: 1, sample: sampleSmEnvelope(t) }));
}
