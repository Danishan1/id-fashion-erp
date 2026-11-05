import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { REVIEW_SUBJECT_KEYS, type ReviewSubject } from "@/modules/sales-marketing/content/content-registry";
import { reviewHistory } from "@/modules/sales-marketing/content/content-review.service";

export const GET = salesMarketingRoute<{ subjectType: string; subjectId: string }>({ module: "marketing_content", action: "view" }, async ({ actor, params }) => {
  if (!(REVIEW_SUBJECT_KEYS as readonly string[]).includes(params.subjectType)) throw new BusinessRuleError("NOT_FOUND", "Unknown review subject.");
  return NextResponse.json({ data: await reviewHistory(actor, params.subjectType as ReviewSubject, params.subjectId) });
});
