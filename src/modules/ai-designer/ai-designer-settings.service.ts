import { prisma } from "@/core/db/client";
import type { AiDesignerAttributeDisplayMode } from "@prisma/client";

/**
 * Company-wide, Super-Admin-controlled setting for how the Product Design
 * step's attribute pickers render -- clipart icons (default) or plain text
 * buttons. A missing row means CLIPART, so no backfill was needed when this
 * setting was introduced. Deliberately no lock/has-data logic (unlike
 * SubmoduleVisibility) -- nothing about this choice becomes unsafe once real
 * project data exists, it's a pure display preference.
 */
export async function getProductDesignDisplayMode(companyId: string): Promise<AiDesignerAttributeDisplayMode> {
  const row = await prisma.aiDesignerSettings.findUnique({ where: { companyId } });
  return row?.productDesignDisplayMode ?? "CLIPART";
}

export async function setProductDesignDisplayMode(
  companyId: string,
  mode: AiDesignerAttributeDisplayMode
): Promise<AiDesignerAttributeDisplayMode> {
  const row = await prisma.aiDesignerSettings.upsert({
    where: { companyId },
    update: { productDesignDisplayMode: mode },
    create: { companyId, productDesignDisplayMode: mode },
  });
  return row.productDesignDisplayMode;
}
