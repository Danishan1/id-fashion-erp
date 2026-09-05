import { prisma } from "@/core/db/client";

/** Company letterhead info shared by every printable document PDF — a
 * single small query, not a repository-per-caller duplication. */
export async function getCompanyHeaderLines(companyId: string): Promise<{ companyName: string; companyDetailLines: string[] }> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, legalName: true, taxRegistrationNo: true, addressJson: true },
  });
  if (!company) return { companyName: "Fashion ERP", companyDetailLines: [] };

  const addressLine = (company.addressJson as { line1?: string } | null)?.line1;
  const lines: string[] = [];
  if (addressLine) lines.push(addressLine);
  if (company.taxRegistrationNo) lines.push(`GSTIN/Tax Reg. No.: ${company.taxRegistrationNo}`);

  return { companyName: company.legalName ?? company.name, companyDetailLines: lines };
}

export function formatDocDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
}

/** Accepts a plain number/string or a Prisma Decimal — every money column
 * this app's PDF routes read from is a Decimal, and re-typing every call
 * site with `Number(...)` first would be pure boilerplate. */
export function formatMoney(value: number | string | { toString(): string }, currencyCode: string): string {
  return `${currencyCode} ${Number(value.toString()).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
