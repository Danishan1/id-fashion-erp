import { NextRequest, NextResponse } from "next/server";
import { requireSession, handleApiError } from "@/lib/api-route";
import { resolveProductUnitTraceability, packUnitIntoCarton } from "@/modules/product-units/product-unit.service";
import { prisma } from "@/core/db/client";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const lotId = searchParams.get("lotId");

    if (code) {
      const unit = await resolveProductUnitTraceability(
        { companyId: session.user.companyId, userId: session.user.id },
        code
      );
      return NextResponse.json({ data: unit });
    }

    if (lotId) {
      const units = await prisma.productUnit.findMany({
        where: { companyId: session.user.companyId, lotId },
        include: {
          product: { select: { styleCode: true, styleName: true } },
          productVariant: { include: { color: true, size: true } },
          carton: { select: { cartonNumber: true } },
        },
        orderBy: { unitCode: "asc" },
      });
      return NextResponse.json({ data: units });
    }

    const units = await prisma.productUnit.findMany({
      where: { companyId: session.user.companyId },
      include: {
        product: { select: { styleCode: true, styleName: true } },
        productVariant: { include: { color: true, size: true } },
        lot: { select: { lotNumber: true } },
      },
      take: 50,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ data: units });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json();

    if (body.action === "PACK_INTO_CARTON") {
      const unit = await packUnitIntoCarton(
        { companyId: session.user.companyId, userId: session.user.id },
        body.cartonId,
        body.unitCode
      );
      return NextResponse.json({ data: unit });
    }

    return NextResponse.json({ error: { message: "Invalid action." } }, { status: 400 });
  } catch (error) {
    return handleApiError(error);
  }
}
