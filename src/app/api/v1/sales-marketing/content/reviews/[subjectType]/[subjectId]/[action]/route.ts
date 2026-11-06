import { NextResponse } from "next/server";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { REVIEW_ACTION_KEYS, REVIEW_SUBJECT_KEYS, type ReviewAction, type ReviewSubject } from "@/modules/sales-marketing/content/content-registry";
import { reviewVersion } from "@/modules/sales-marketing/content/content-review.service";

/** POST { comment? }: submit | withdraw | approve | request_changes | reject. Permissions are checked per action in the service. */
export const POST = salesMarketingRoute<{ subjectType: string; subjectId: string; action: string }>({ module: "marketing_content", action: "view" }, async ({ req, actor, params }) => {
  if (!(REVIEW_SUBJECT_KEYS as readonly string[]).includes(params.subjectType) || !(REVIEW_ACTION_KEYS as readonly string[]).includes(params.action)) throw new BusinessRuleError("NOT_FOUND", "Unknown review action.");
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ data: await reviewVersion(actor, params.subjectType as ReviewSubject, params.subjectId, params.action as ReviewAction, body) });
});
