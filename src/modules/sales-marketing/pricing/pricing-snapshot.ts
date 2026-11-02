import type { PricingResult } from "./pricing-engine";

/**
 * What a document stores about how a line was priced (Phase 03): enough to
 * explain and audit the price later without re-running the engine. Pure.
 */
export function pricingSnapshot(r: PricingResult) {
  return {
    status: r.status,
    message: r.message,
    quantity: r.quantity,
    uomCode: r.uomCode,
    source: r.source,
    listUnitPrice: r.listUnitPrice,
    rules: r.rules,
    ruleDiscountAmount: r.ruleDiscountAmount,
    ruleDiscountCapped: r.ruleDiscountCapped,
    netUnitPrice: r.netUnitPrice,
    explanation: r.explanation,
  };
}

export type PricingSnapshot = ReturnType<typeof pricingSnapshot>;
