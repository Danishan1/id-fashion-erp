import type { CrmCustomFieldDefinitionDto } from "@/modules/crm/custom-fields/crm-custom-field-types";
import type { AddressDto, TagDto, UserRefDto } from "@/components/crm/CrmRecordDialogs";

/** JSON shapes returned by /api/v1/crm/companies… (dates arrive as ISO strings, Decimals as strings). */
export type { AddressDto, TagDto, UserRefDto };

export interface CompanyStatusDto {
  id: string;
  key?: string;
  name: string;
  color: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface CompanyRowDto {
  id: string;
  name: string;
  legalName: string | null;
  displayName: string | null;
  companyType: string | null;
  industry: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  ownerUserId: string | null;
  customerId: string | null;
  lastActivityAt: string | null;
  duplicateFlaggedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  owner: (UserRefDto & { status?: string }) | null;
  ownerInactive: boolean;
  status: CompanyStatusDto | null;
  source: { id: string; name: string; key: string } | null;
  customer: { id: string; code: string; name: string } | null;
  primaryContact: { id: string; fullName: string } | null;
  openOpportunities: number;
  tags: TagDto[];
}

export interface CompanyDetailDto extends Omit<CompanyRowDto, "customer" | "openOpportunities" | "primaryContact"> {
  postalCode: string | null;
  statusId: string | null;
  sourceId: string | null;
  sourceLeadId: string | null;
  primaryContactId: string | null;
  customFields: Record<string, unknown>;
  flaggedDuplicateIds: string[];
  mergedIntoId: string | null;
  mergedAt: string | null;
  createdBy: { id: string; fullName: string };
  sourceLead: { id: string; leadNumber: string; fullName: string; convertedAt: string | null } | null;
  primaryContact: { id: string; fullName: string; designation: string | null; email: string | null; mobile: string | null; phone: string | null } | null;
  customer: { id: string; code: string; name: string; type: string; status: string } | null;
  mergedInto: { id: string; name: string } | null;
  mergedFrom: { id: string; name: string; mergedAt: string | null }[];
  mergedCompanyIds: string[];
  addresses: AddressDto[];
  counts: { contacts: number; leads: number; openOpportunities: number };
  flaggedDuplicates: { id: string; name: string; website: string | null; city: string | null; customerCode: string | null; archived: boolean }[];
  updatedByName: string | null;
  archivedByName: string | null;
  mergedByName: string | null;
}

export interface CompanyMetaDto {
  statuses: CompanyStatusDto[];
  sources: { id: string; key: string; name: string; isActive?: boolean }[];
  customFields: CrmCustomFieldDefinitionDto[];
  suggestions: { company_industry: string[]; company_type: string[] };
  canPickCustomer: boolean;
}

export interface CompanyPermissions {
  create: boolean;
  edit: boolean;
  viewAll: boolean;
  settings: boolean;
}

export interface CompanyDuplicateMatchDto {
  id: string;
  name: string;
  legalName: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  owner: string | null;
  customer: { code: string; name: string } | null;
  archived: boolean;
  rules: string[];
  action: "WARN" | "BLOCK" | "FLAG";
}

export interface CustomerOptionDto {
  id: string;
  code: string;
  name: string;
  city: string | null;
  country: string | null;
  isActive: boolean;
  crmCompanyId: string | null;
  linkedCompany: { id: string; name: string; archived: boolean } | null;
}
