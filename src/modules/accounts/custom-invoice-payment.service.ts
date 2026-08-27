import { writeAuditLog } from "@/core/audit/AuditLogger";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { prisma } from "@/core/db/client";
import { round2 } from "@/lib/money";
import type { CustomInvoicePaymentInput } from "./custom-invoice-payment.schema";
import { CustomInvoicePaymentRepository } from "./custom-invoice-payment.repository";
import { CustomInvoiceRepository } from "./custom-invoice.repository";
import { computeBalanceDue } from "./custom-invoice.service";

interface ActorContext {
  companyId: string;
  userId: string;
}

export async function recordCustomInvoicePayment(actor: ActorContext, customInvoiceId: string, input: CustomInvoicePaymentInput) {
  const invoice = await CustomInvoiceRepository.findAnyById(actor.companyId, customInvoiceId);
  if (!invoice) throw new BusinessRuleError("NOT_FOUND", "Custom invoice not found.", { customInvoiceId });
  if (invoice.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "Cannot record a payment against a cancelled invoice.", { customInvoiceId });
  }

  const paidSoFar = Number(invoice.paidAmount);
  const available = round2(Number(invoice.grandTotal) - Number(invoice.creditedAmount) - paidSoFar);
  if (input.amount > available) {
    throw new BusinessRuleError(
      "OVER_PAYMENT_NOT_ALLOWED",
      `This payment exceeds what's still owed. Available: ${available.toFixed(2)}, Requested: ${input.amount.toFixed(2)}.`,
      { available, requested: input.amount }
    );
  }

  const payment = await prisma.$transaction(async (tx) => {
    // Guarded on the exact paidAmount value already read above — the same
    // compare-and-swap idiom every other accumulator in this project uses;
    // a lost race here means someone else's payment landed first, so this
    // one is rejected rather than silently over-crediting the invoice.
    const guard = await tx.customInvoice.updateMany({
      where: { id: customInvoiceId, paidAmount: invoice.paidAmount },
      data: { paidAmount: { increment: input.amount } },
    });
    if (guard.count === 0) {
      throw new BusinessRuleError("OVER_PAYMENT_NOT_ALLOWED", "This invoice was just updated by someone else — reload and try again.", {
        customInvoiceId,
      });
    }

    const refreshed = await tx.customInvoice.findUniqueOrThrow({ where: { id: customInvoiceId } });
    const balanceDue = computeBalanceDue({
      grandTotal: Number(refreshed.grandTotal),
      advancePaymentAmount: refreshed.advancePaymentAmount ? Number(refreshed.advancePaymentAmount) : null,
      payableAmountValue: refreshed.payableAmountValue ? Number(refreshed.payableAmountValue) : null,
      paidAmount: Number(refreshed.paidAmount),
      creditedAmount: Number(refreshed.creditedAmount),
    });
    await tx.customInvoice.update({ where: { id: customInvoiceId }, data: { balanceDue } });

    return tx.customInvoicePayment.create({
      data: {
        companyId: actor.companyId,
        customInvoiceId,
        paymentDate: new Date(input.paymentDate),
        amount: input.amount,
        paymentTypeId: input.paymentTypeId || null,
        referenceNote: input.referenceNote || null,
        receivedByUserId: actor.userId,
      },
      include: { paymentType: { select: { id: true, name: true, type: true } }, receivedBy: { select: { id: true, fullName: true } } },
    });
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "custom_invoice_payments",
    recordId: payment.id,
    action: "CREATE",
    newValues: payment,
  });

  return payment;
}

export async function cancelCustomInvoicePayment(actor: ActorContext, paymentId: string) {
  const payment = await CustomInvoicePaymentRepository.findAnyById(actor.companyId, paymentId);
  if (!payment) throw new BusinessRuleError("NOT_FOUND", "Payment not found.", { paymentId });
  if (payment.status === "CANCELLED") {
    throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This payment is already cancelled.", { paymentId });
  }

  await prisma.$transaction(async (tx) => {
    const invoice = await tx.customInvoice.findUniqueOrThrow({ where: { id: payment.customInvoiceId } });

    const guard = await tx.customInvoice.updateMany({
      where: { id: payment.customInvoiceId, paidAmount: invoice.paidAmount },
      data: { paidAmount: { decrement: Number(payment.amount) } },
    });
    if (guard.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This invoice was just updated by someone else — reload and try again.", {
        customInvoiceId: payment.customInvoiceId,
      });
    }

    const refreshed = await tx.customInvoice.findUniqueOrThrow({ where: { id: payment.customInvoiceId } });
    const balanceDue = computeBalanceDue({
      grandTotal: Number(refreshed.grandTotal),
      advancePaymentAmount: refreshed.advancePaymentAmount ? Number(refreshed.advancePaymentAmount) : null,
      payableAmountValue: refreshed.payableAmountValue ? Number(refreshed.payableAmountValue) : null,
      paidAmount: Number(refreshed.paidAmount),
      creditedAmount: Number(refreshed.creditedAmount),
    });
    await tx.customInvoice.update({ where: { id: payment.customInvoiceId }, data: { balanceDue } });

    const paymentGuard = await tx.customInvoicePayment.updateMany({
      where: { id: paymentId, status: "RECORDED" },
      data: { status: "CANCELLED" },
    });
    if (paymentGuard.count === 0) {
      throw new BusinessRuleError("INVALID_STATE_TRANSITION", "This payment was already cancelled by someone else.", { paymentId });
    }
  });

  await writeAuditLog({
    companyId: actor.companyId,
    userId: actor.userId,
    tableName: "custom_invoice_payments",
    recordId: paymentId,
    action: "UPDATE",
    oldValues: { status: "RECORDED" },
    newValues: { status: "CANCELLED" },
  });

  return CustomInvoicePaymentRepository.findAnyById(actor.companyId, paymentId);
}
