import type { CrmCustomFieldDefinitionDto } from "@/modules/crm/custom-fields/crm-custom-field-types";
import type { TagDto, UserRefDto } from "@/components/crm/CrmRecordDialogs";

/** JSON shapes returned by /api/v1/crm/opportunities… (dates arrive as ISO strings, Decimals as strings). */
export type { TagDto, UserRefDto };

export interface StageDto {
  id: string;
  pipelineId: string;
  key: string;
  name: string;
  probability: number | null;
  isActive: boolean;
  sortOrder: number;
}
export interface PipelineDto {
  id: string;
  key: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  stages: StageDto[];
}

export interface OpportunityRowDto {
  id: string;
  opportunityNumber: string;
  name: string;
  status: string;
  amount: string | null;
  currencyCode: string | null;
  probability: number | null;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  version: number;
  ownerUserId: string | null;
  leadId: string | null;
  crmCompanyId: string | null;
  crmContactId: string | null;
  pipelineId: string | null;
  stageId: string | null;
  owner: (UserRefDto & { status?: string }) | null;
  ownerInactive: boolean;
  crmCompany: { id: string; name: string } | null;
  crmContact: { id: string; fullName: string; email: string | null; mobile: string | null; phone: string | null } | null;
  pipeline: { id: string; name: string } | null;
  stage: { id: string; name: string; probability: number | null; sortOrder: number } | null;
  source: { id: string; key: string; name: string } | null;
  tags: TagDto[];
}

export interface OpportunityDetailDto extends Omit<OpportunityRowDto, "crmCompany" | "crmContact"> {
  description: string | null;
  customFields: Record<string, unknown>;
  closeReason: string | null;
  stageChangedAt: string | null;
  sourceId: string | null;
  createdBy: { id: string; fullName: string };
  lead: { id: string; leadNumber: string; fullName: string; convertedAt: string | null } | null;
  crmCompany: {
    id: string;
    name: string;
    industry: string | null;
    city: string | null;
    country: string | null;
    archivedAt: string | null;
    mergedIntoId: string | null;
    owner: { id: string; fullName: string } | null;
    status: { id: string; name: string; color: string | null } | null;
    primaryContact: { id: string; fullName: string } | null;
    customer: { id: string; code: string } | null;
  } | null;
  crmContact: {
    id: string;
    fullName: string;
    designation: string | null;
    email: string | null;
    mobile: string | null;
    phone: string | null;
    archivedAt: string | null;
    mergedIntoId: string | null;
    crmCompany: { id: string; name: string } | null;
  } | null;
  companyVisible: boolean;
  contactVisible: boolean;
  erpLinkCount: number;
  updatedByName: string | null;
  archivedByName: string | null;
  closedByName: string | null;
}

export interface OpportunityMetaDto {
  pipelines: PipelineDto[];
  statuses: { key: string; label: string; closed: boolean }[];
  sources: { id: string; key: string; name: string; isActive?: boolean }[];
  customFields: CrmCustomFieldDefinitionDto[];
  suggestions: { opportunity_close_reason: string[] };
  baseCurrencyCode: string;
}

export interface OpportunityPermissions {
  create: boolean;
  edit: boolean;
  viewAll: boolean;
  settings: boolean;
}

export interface OpportunityDuplicateMatchDto {
  id: string;
  opportunityNumber: string;
  name: string;
  amount: string | null;
  currencyCode: string | null;
  expectedCloseDate: string | null;
  stage: string | null;
  owner: string | null;
  company: string | null;
  contact: string | null;
  visible: boolean;
}
