import { logger } from "@/core/logging/logger";
import type { CrmEventRow } from "./crm-event.repository";
import type { CrmEventType } from "./crm-event-types";

/**
 * In-process subscribers for CRM events, called only AFTER the transaction
 * that wrote the event has committed (see runCrmMutation). Nothing subscribes
 * yet; this is the hook later phases use (e.g. notifications in Phase 09,
 * workflow triggers in Phase 18).
 *
 * Durable work must not rely on this alone — subscribers run in the web
 * process and are lost on a crash. Anything that must happen exactly once
 * (workflows, webhooks) should read from the persisted `crm_events` table /
 * a queue; subscribers here are for best-effort, fast side effects.
 *
 * A subscriber error is logged and never propagates: the user's change has
 * already been saved, so it must not be reported as failed.
 */
export type CrmEventHandler = (event: CrmEventRow) => void | Promise<void>;

const globalForBus = globalThis as unknown as { __crmEventHandlers?: Map<string, Set<CrmEventHandler>> };
const handlers = (globalForBus.__crmEventHandlers ??= new Map<string, Set<CrmEventHandler>>());

/** Subscribe to one event type, or "*" for all. Returns an unsubscribe function. */
export function subscribeCrmEvent(eventType: CrmEventType | "*", handler: CrmEventHandler): () => void {
  const set = handlers.get(eventType) ?? new Set<CrmEventHandler>();
  set.add(handler);
  handlers.set(eventType, set);
  return () => {
    set.delete(handler);
  };
}

export async function dispatchCrmEvents(events: CrmEventRow[]): Promise<void> {
  for (const event of events) {
    const targets = [...(handlers.get(event.eventType) ?? []), ...(handlers.get("*") ?? [])];
    for (const handler of targets) {
      try {
        await handler(event);
      } catch (error) {
        logger.error("CRM event subscriber failed", {
          eventId: event.id,
          eventType: event.eventType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

/** Test helper. */
export function clearCrmEventSubscribers(): void {
  handlers.clear();
}
