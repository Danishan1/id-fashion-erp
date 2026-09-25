import { prisma } from "@/core/db/client";
import type { Prisma } from "@prisma/client";

export const BuyerEnquiryRepository = {
  findMany: (where: Prisma.BuyerEnquiryWhereInput, args: Omit<Prisma.BuyerEnquiryFindManyArgs, "where">) =>
    prisma.buyerEnquiry.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        buyer: { select: { id: true, name: true } },
        requestedBy: { select: { id: true, fullName: true } },
        _count: { select: { lines: true } },
      },
      ...args,
    }),

  count: (where: Prisma.BuyerEnquiryWhereInput) => prisma.buyerEnquiry.count({ where }),

  /** Top N enquiry-number matches for this company — backs the Topbar Global
   * Search's Buyer Enquiries group. `customer`/`prospectName` are mutually
   * exclusive (see the model's own comment) so the caller picks whichever is set. */
  searchTop: (companyId: string, term: string, limit: number) =>
    prisma.buyerEnquiry.findMany({
      where: { companyId, enquiryNumber: { contains: term, mode: "insensitive" as const } },
      select: { id: true, enquiryNumber: true, prospectName: true, customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),

  findByIdWithDetails: (companyId: string, id: string) =>
    prisma.buyerEnquiry.findFirst({
      where: { id, companyId },
      include: {
        // A narrow `select`, not `customer: true` — see the identical fix
        // and rationale in sales-order.repository.ts.
        customer: { select: { id: true, name: true, code: true, country: true, defaultCurrencyCode: true } },
        buyer: true,
        requestedBy: { select: { id: true, fullName: true } },
        lines: {
          orderBy: { createdAt: "asc" },
          include: {
            product: { select: { id: true, styleName: true, styleCode: true } },
            size: { select: { id: true, name: true } },
            sampleRequest: { select: { id: true, requestNumber: true, status: true } },
          },
        },
      },
    }),

  findAnyById: (companyId: string, id: string) => prisma.buyerEnquiry.findFirst({ where: { id, companyId } }),

  createWithLines: (data: Prisma.BuyerEnquiryUncheckedCreateInput) =>
    prisma.buyerEnquiry.create({ data, include: { lines: true } }),

  update: (id: string, data: Prisma.BuyerEnquiryUncheckedUpdateInput) =>
    prisma.buyerEnquiry.update({ where: { id }, data }),
};

export const BuyerEnquiryLineRepository = {
  /** Used to verify tenant ownership before any scoped line action — same pattern as SampleMaterialRepository.findWithRequestOwner. */
  findWithEnquiryOwner: (id: string) =>
    prisma.buyerEnquiryLine.findUnique({
      where: { id },
      include: { buyerEnquiry: true },
    }),

  findByEnquiryId: (buyerEnquiryId: string) => prisma.buyerEnquiryLine.findMany({ where: { buyerEnquiryId } }),

  update: (id: string, data: Prisma.BuyerEnquiryLineUncheckedUpdateInput) =>
    prisma.buyerEnquiryLine.update({ where: { id }, data }),

  /**
   * Atomic guarded conversion write — the `where` clause re-asserts the exact
   * preconditions the service already checked (still APPROVED_FOR_SAMPLING,
   * still unconverted) so a concurrent double-convert can't both succeed.
   * `count === 0` means someone else won the race. Same "express the
   * precondition directly in the update's where clause" pattern as the
   * over-receipt/over-reversal guards in purchasing (see CLAUDE.md).
   */
  convertGuarded: (id: string, sampleRequestId: string) =>
    prisma.buyerEnquiryLine.updateMany({
      where: { id, sampleRequestId: null, lineStatus: "APPROVED_FOR_SAMPLING" },
      data: { sampleRequestId, lineStatus: "CONVERTED" },
    }),
};
