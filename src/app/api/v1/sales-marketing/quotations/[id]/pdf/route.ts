import { NextResponse } from "next/server";
import { businessDocumentPdfHeaders, renderBusinessDocumentPdf } from "@/core/documents/document-pdf";
import { salesMarketingRoute } from "@/modules/sales-marketing/sales-marketing-route";
import { getQuotation } from "@/modules/sales-marketing/quotations/quotation.service";
import { buildQuotationPdfDescriptor } from "@/modules/sales-marketing/quotations/quotation-pdf";
import { prisma } from "@/core/db/client";

/** GET ?revision=n&disposition=inline — the quotation PDF for a revision (default: current). Needs sales_quotations.print. */
export const GET = salesMarketingRoute<{ id: string }>({ module: "sales_quotations", action: "print" }, async ({ req, actor, params }) => {
  const sp = req.nextUrl.searchParams;
  const revision = Number(sp.get("revision"));
  const q = await getQuotation(actor, params.id, Number.isInteger(revision) && revision > 0 ? revision : undefined);
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { fullName: true } });
  const buffer = await renderBusinessDocumentPdf(await buildQuotationPdfDescriptor(q, user?.fullName ?? "—"));
  const name = `${q.quotationNumber}${q.current.revisionNumber > 1 ? `-R${q.current.revisionNumber}` : ""}.pdf`;
  const headers = businessDocumentPdfHeaders(name);
  if (sp.get("disposition") === "inline") headers["Content-Disposition"] = headers["Content-Disposition"].replace("attachment", "inline");
  return new NextResponse(new Uint8Array(buffer), { headers });
});
