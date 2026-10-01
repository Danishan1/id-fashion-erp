import type { CrmCustomFieldDefinitionDto } from "@/modules/crm/custom-fields/crm-custom-field-types";

/** JSON shapes returned by /api/v1/crm/leads… (Decimals arrive as strings, dates as ISO strings). */
export interface LeadStatusDto {
  id: string;
  key?: string;
  name: string;
  kind: "OPEN" | "CONVERTED" | "LOST";
  color: string | null;
  isDefault?: boolean;
  isActive?: boolean;
}
export interface LeadSourceDto {
  id: string;
  key: string;
  name: string;
  isActive?: boolean;
}
export interface UserRefDto {
  id: string;
  fullName: string;
  status?: string;
}
export interface TagDto {
  id: string;
  name: string;
  color: string | null;
}

export interface LeadRowDto {
  id: string;
  leadNumber: string;
  firstName: string;
  lastName: string | null;
  fullName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp: string | null;
  score: number;
  temperature: "COLD" | "WARM" | "HOT" | null;
  estimatedValue: string | null;
  currencyCode: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  convertedAt: string | null;
  ownerUserId: string | null;
  version: number;
  status: LeadStatusDto;
  source: LeadSourceDto | null;
  owner: UserRefDto | null;
  ownerInactive: boolean;
  crmCompany: { id: string; name: string } | null;
  tags: TagDto[];
}

export interface LeadDetailDto extends LeadRowDto {
  designation: string | null;
  alternateEmail: string | null;
  crmCompanyId: string | null;
  crmContactId: string | null;
  statusId: string;
  sourceId: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  requirement: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  campaignSource: string | null;
  referralSource: string | null;
  customFields: Record<string, unknown>;
  convertedOpportunityId: string | null;
  createdBy: { id: string; fullName: string };
  crmContact: { id: string; fullName: string; email: string | null; phone: string | null } | null;
  convertedOpportunity: { id: string; name: string; opportunityNumber: string; status: string } | null;
  opportunities: { id: string; name: string; opportunityNumber: string; status: string; amount: string | null; currencyCode: string | null; createdAt: string }[];
  captureChannel: string;
  captureProvider: string | null;
  importJob: { id: string; fileName: string } | null;
  externalRefs: { provider: string; externalId: string }[];
  convertedByName: string | null;

  archivedByName: string | null;
  updatedByName: string | null;
}

export interface LeadMetaDto {
  statuses: LeadStatusDto[];
  sources: LeadSourceDto[];
  customFields: CrmCustomFieldDefinitionDto[];
  baseCurrencyCode: string;
}

export interface LeadPermissions {
  create: boolean;
  edit: boolean;
  viewAll: boolean;
  settings: boolean;
}

export interface DuplicateMatchDto {
  id: string;
  leadNumber: string;
  fullName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  owner: string | null;
  archived: boolean;
  rules: string[];
  action: "WARN" | "BLOCK";
}
