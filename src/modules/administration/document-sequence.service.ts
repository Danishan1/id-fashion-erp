import { prisma } from "@/core/db/client";

/**
 * Read-only — troubleshooting visibility into "why did this document number
 * jump/what's the next number for X" only. No edit/reset capability is
 * exposed: manually rewinding a counter risks issuing a duplicate document
 * number, and nothing in this pass asked for that — see
 * generateDocumentNumber()'s own atomic increment, the sole writer of this
 * table.
 */
export async function listDocumentSequences(companyId: string) {
  const rows = await prisma.documentSequence.findMany({
    where: { companyId },
    select: {
      id: true,
      documentType: true,
      prefix: true,
      fiscalYear: true,
      currentNumber: true,
      paddingLength: true,
      branch: { select: { id: true, name: true } },
    },
    orderBy: [{ documentType: "asc" }, { fiscalYear: "desc" }],
  });

  return rows.map((r) => ({
    id: r.id,
    documentType: r.documentType,
    prefix: r.prefix,
    // Master-code sequences (Customer/Supplier/Employee/Style/Material) use
    // the sentinel fiscalYear = 0 so they never reset annually — surfaced
    // as-is rather than hidden, since that's a real, meaningful fact about
    // this row, not a display bug.
    fiscalYear: r.fiscalYear,
    currentNumber: Number(r.currentNumber),
    paddingLength: r.paddingLength,
    branchName: r.branch?.name ?? null,
    nextNumberPreview: `${r.prefix}-${r.fiscalYear === 0 ? "" : `${r.fiscalYear}-`}${(Number(r.currentNumber) + 1).toString().padStart(r.paddingLength, "0")}`,
  }));
}
