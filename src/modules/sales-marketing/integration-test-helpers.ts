/** Helpers for the Sales & Marketing database integration tests (not used by app code). */

/**
 * Known ERP limitation (CLAUDE.md): document counters are per branch while
 * enquiry numbers are unique per company, so on a database whose existing
 * enquiries were numbered from a branch counter the company-wide (null branch)
 * counter can hand out a number already used. Tests run without a branch, so
 * move that counter past every existing number first.
 */
export async function alignEnquiryCounter(prisma: typeof import("@/core/db/client").prisma, companyId: string) {
  const year = new Date().getFullYear();
  const rows = await prisma.buyerEnquiry.findMany({ where: { companyId, enquiryNumber: { startsWith: `ENQ-${year}-` } }, select: { enquiryNumber: true } });
  const max = Math.max(0, ...rows.map((r) => Number(r.enquiryNumber.split("-").pop()) || 0));
  const seq = await prisma.documentSequence.findFirst({ where: { companyId, branchId: null, documentType: "BUYER_ENQUIRY", fiscalYear: year } });
  if (seq && seq.currentNumber < BigInt(max)) await prisma.documentSequence.update({ where: { id: seq.id }, data: { currentNumber: BigInt(max) } });
  if (!seq) await prisma.documentSequence.create({ data: { companyId, branchId: null, documentType: "BUYER_ENQUIRY", fiscalYear: year, prefix: "ENQ", currentNumber: BigInt(max) } });
}
