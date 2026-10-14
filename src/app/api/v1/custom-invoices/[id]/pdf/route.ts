import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { prisma } from "@/core/db/client";
import { getCustomInvoiceById } from "@/modules/accounts/custom-invoice.service";
import {
  renderCustomInvoicePdf,
  customInvoicePdfHeaders,
  type CustomInvoicePdfData,
} from "@/modules/accounts/custom-invoice-pdf";
import { formatDocDate } from "@/core/documents/company-header";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "invoices", "export");

    const { id } = await params;
    const companyId = session.user.companyId;

    // Fetch invoice scoped strictly to caller's companyId (throws NOT_FOUND if absent or cross-tenant)
    const invoice = await getCustomInvoiceById(companyId, id);

    // Fetch company letterhead and active bank accounts concurrently
    const [company, activeBankAccounts] = await Promise.all([
      prisma.company.findUnique({
        where: { id: companyId },
        select: {
          name: true,
          legalName: true,
          taxRegistrationNo: true,
          addressJson: true,
        },
      }),
      prisma.bankAccount.findMany({
        where: { companyId, isActive: true },
        select: {
          bankName: true,
          accountHolderName: true,
          accountNumber: true,
          ifscCode: true,
          branch: true,
          upiId: true,
        },
      }),
    ]);

    const companyAddress = (company?.addressJson as { line1?: string } | null)?.line1 ?? null;

    // Bank account rule: exactly one active bank account is included; if 0 or multiple, omit to prevent ambiguity
    const singleBankAccount = activeBankAccounts.length === 1 ? activeBankAccounts[0] : null;

    // Assemble PDF data
    const pdfData: CustomInvoicePdfData = {
      company: {
        name: company?.name ?? "Fashion ERP",
        legalName: company?.legalName ?? null,
        taxRegistrationNo: company?.taxRegistrationNo ?? null,
        addressLine: companyAddress,
        branchName: session.user.defaultBranchId ? undefined : null,
      },
      customer: {
        name: invoice.customer.name,
        code: invoice.customer.code,
        taxRegistrationNo: invoice.customer.taxRegistrationNo,
        billingAddress: invoice.customer.billingAddress,
        city: invoice.customer.city,
        pinCode: invoice.customer.pinCode,
        country: invoice.customer.country,
      },
      invoice: {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: formatDocDate(invoice.invoiceDate),
        hasDueDate: invoice.hasDueDate,
        dueDate: invoice.dueDate ? formatDocDate(invoice.dueDate) : null,
        invoiceType: invoice.invoiceType,
        seriesName: invoice.invoiceSeries.name,
        isReverseCharge: invoice.isReverseCharge,
        placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
        isInterState: invoice.isInterState,
        subtotalAmount: Number(invoice.subtotalAmount),
        discountPercentage: Number(invoice.discountPercentage),
        discountAmount: Number(invoice.discountAmount),
        taxAmount: Number(invoice.taxAmount),
        cgstAmount: Number(invoice.cgstAmount),
        sgstAmount: Number(invoice.sgstAmount),
        igstAmount: Number(invoice.igstAmount),
        grandTotal: Number(invoice.grandTotal),
        advancePaymentAmount: invoice.advancePaymentAmount ? Number(invoice.advancePaymentAmount) : null,
        advancePaymentTitle: invoice.advancePaymentTitle,
        payableAmountValue: invoice.payableAmountValue ? Number(invoice.payableAmountValue) : null,
        payableAmountTitle: invoice.payableAmountTitle,
        paidAmount: Number(invoice.paidAmount),
        creditedAmount: Number(invoice.creditedAmount),
        balanceDue: Number(invoice.balanceDue),
        notes: invoice.notes.map((n) => n.note),
        termsAndConditions: invoice.termsAndConditions,
      },
      items: invoice.items.map((item) => ({
        itemName: item.itemName,
        hsnCode: item.hsnCode,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        gstPercentage: Number(item.gstPercentage),
        lineAmount: Number(item.lineAmount),
        lineTaxAmount: Number(item.lineTaxAmount),
        lineTotal: Number(item.lineTotal),
      })),
      bankAccount: singleBankAccount,
      generatedAt: new Date().toLocaleString("en-IN"),
      generatedByName: session.user.name ?? "User",
    };

    const action = req.nextUrl.searchParams.get("action");
    const dispositionParam = req.nextUrl.searchParams.get("disposition");
    const isPrintOrInline = action === "print" || dispositionParam === "inline";
    const disposition = isPrintOrInline ? "inline" : "attachment";

    const buffer = await renderCustomInvoicePdf(pdfData);
    const fileName = `${invoice.invoiceNumber}.pdf`;

    return new NextResponse(new Uint8Array(buffer), {
      headers: customInvoicePdfHeaders(fileName, disposition),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
