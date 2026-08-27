import { prisma } from "@/core/db/client";

export const InvoiceSeriesRepository = {
  findMany: (companyId: string) => prisma.invoiceSeries.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
  findActive: (companyId: string) =>
    prisma.invoiceSeries.findMany({ where: { companyId, isActive: true }, orderBy: { name: "asc" } }),
  findById: (id: string, companyId: string) => prisma.invoiceSeries.findFirst({ where: { id, companyId } }),
  create: (data: Parameters<typeof prisma.invoiceSeries.create>[0]["data"]) => prisma.invoiceSeries.create({ data }),
  update: (id: string, data: Parameters<typeof prisma.invoiceSeries.update>[0]["data"]) =>
    prisma.invoiceSeries.update({ where: { id }, data }),
};
