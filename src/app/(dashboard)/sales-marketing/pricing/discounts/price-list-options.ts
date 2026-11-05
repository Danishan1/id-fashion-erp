import { prisma } from "@/core/db/client";

/** Price lists as picker options for a discount rule. */
export async function priceListOptions(companyId: string) {
  const rows = await prisma.priceList.findMany({ where: { companyId }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" }, take: 500 });
  return rows.map((r) => ({ id: r.id, label: `${r.code} — ${r.name}` }));
}
