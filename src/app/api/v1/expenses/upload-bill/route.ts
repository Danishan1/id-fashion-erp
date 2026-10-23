import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { PermissionService } from "@/core/rbac/PermissionService";
import { BusinessRuleError } from "@/core/errors/BusinessRuleError";
import { uploadAttachment } from "@/core/attachments/AttachmentService";
import { billUploadExpenseSchema } from "@/modules/accounts/expense.schema";
import { createBillUploadExpense, discardFailedBillUpload } from "@/modules/accounts/expense.service";

const MAX_FILES = 10;

/**
 * "Upload Bill": multipart form with the bill date/amount/description plus
 * one or more files (`files`) — bill photos/PDFs and an optional voice note.
 * Creates a PENDING_APPROVAL expense that the accountant classifies later.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    await PermissionService.assert(session.user.id, "expenses", "create");

    const formData = await req.formData();
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) {
      throw new BusinessRuleError("VALIDATION_ERROR", "Attach at least one bill (photo, PDF or voice note).");
    }
    if (files.length > MAX_FILES) {
      throw new BusinessRuleError("VALIDATION_ERROR", `You can attach at most ${MAX_FILES} files at once.`);
    }

    const text = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v !== "" ? v : undefined;
    };
    const input = billUploadExpenseSchema.parse({
      expenseDate: text("expenseDate"),
      amount: text("amount"),
      description: text("description"),
      supplierId: text("supplierId"),
      referenceNumber: text("referenceNumber"),
      idempotencyKey: text("idempotencyKey"),
    });

    const actor = { companyId: session.user.companyId, userId: session.user.id, branchId: session.user.defaultBranchId };
    const expense = await createBillUploadExpense(actor, input);

    try {
      for (const file of files) {
        await uploadAttachment(
          actor,
          "EXPENSE",
          expense.id,
          { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, mimeType: file.type || "application/octet-stream" },
          "PENDING_APPROVAL"
        );
      }
    } catch (err) {
      await discardFailedBillUpload(session.user.companyId, expense.id);
      throw err;
    }

    return NextResponse.json({ data: expense }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
