import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { createCustomerReturn, listCustomerReturns } from "@/modules/returns/customer-return.service";

export async function GET() {
  try {
    const session = await requireSession();
    const returns = await listCustomerReturns({
      companyId: session.user.companyId,
      userId: session.user.id,
    });
    return NextResponse.json({ data: returns });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json();

    const result = await createCustomerReturn(
      { companyId: session.user.companyId, userId: session.user.id },
      body
    );

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
