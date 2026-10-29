import { NextResponse } from "next/server";
import type { Action } from "@/config/rbac";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { PermissionService } from "@/core/rbac/PermissionService";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import {
  approveQuotation,
  cancelQuotation,
  declineApproval,
  issueQuotation,
  markQuotationSent,
  recordAcceptance,
  recordRejection,
  returnToDraft,
  reviseQuotation,
  submitForApproval,
} from "@/modules/sales-marketing/quotations/quotation-lifecycle.service";
import { linkQuotationCustomer } from "@/modules/sales-marketing/quotations/quotation-conversion.service";
import type { SalesActor } from "@/modules/sales-marketing/enquiries/sales-enquiry.service";

/**
 * POST /api/v1/sales-marketing/quotations/:id/actions/:action — one lifecycle
 * step. Each action names the `sales_quotations` permission it needs; the
 * service checks the state machine, approver rules and dates.
 */
const ACTIONS: Record<string, { permission: Action; run: (actor: SalesActor, id: string, body: unknown) => Promise<unknown> }> = {
  submit: { permission: "edit", run: submitForApproval },
  "return-to-draft": { permission: "edit", run: returnToDraft },
  approve: { permission: "approve", run: approveQuotation },
  decline: { permission: "reject", run: declineApproval },
  issue: { permission: "edit", run: issueQuotation },
  "mark-sent": { permission: "edit", run: markQuotationSent },
  accept: { permission: "edit", run: recordAcceptance },
  reject: { permission: "edit", run: recordRejection },
  revise: { permission: "edit", run: reviseQuotation },
  cancel: { permission: "cancel", run: cancelQuotation },
  "link-customer": { permission: "edit", run: linkQuotationCustomer },
};


export const POST = salesMarketingRoute<{ id: string; action: string }>({ module: "sales_quotations", action: "view" }, async ({ req, actor, params }) => {
  const action = ACTIONS[params.action];
  if (!action) throw new BusinessRuleError("NOT_FOUND", "Unknown quotation action.", { action: params.action });
  await PermissionService.assert(actor.userId, "sales_quotations", action.permission);
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ data: await action.run(actor, params.id, body) });
});
