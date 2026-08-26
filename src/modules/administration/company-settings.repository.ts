import { prisma } from "@/core/db/client";

const COMPANY_SELECT = {
  id: true,
  name: true,
  legalName: true,
  taxRegistrationNo: true,
  baseCurrencyCode: true,
  fiscalYearStartMonth: true,
  addressJson: true,
} as const;

export const CompanySettingsRepository = {
  findById: (id: string) => prisma.company.findUnique({ where: { id }, select: COMPANY_SELECT }),

  update: (
    id: string,
    data: {
      name: string;
      legalName: string | null;
      taxRegistrationNo: string | null;
      fiscalYearStartMonth: number;
      addressJson: object | undefined;
    }
  ) => prisma.company.update({ where: { id }, data, select: COMPANY_SELECT }),
};
