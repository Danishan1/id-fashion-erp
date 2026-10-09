import type { CrmCustomFieldDefinitionDto } from "@/modules/crm/custom-fields/crm-custom-field-types";
import type { ContactabilityChannel, ContactabilityStatus, CrmOptionListKey } from "@/modules/crm/contacts/contact-registry";

/** JSON shapes returned by /api/v1/crm/contacts… (dates arrive as ISO strings, Decimals as strings). */
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

export interface ContactRowDto {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string | null;
  fullName: string;
  designation: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp: string | null;
  ownerUserId: string | null;
  createdByUserId: string;
  lastActivityAt: string | null;
  duplicateFlaggedAt: string | null;
  archivedAt: string | null;
  mergedIntoId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  owner: UserRefDto | null;
  ownerInactive: boolean;
  source: { id: string; name: string; key: string } | null;
  crmCompany: { id: string; name: string; customerId: string | null } | null;
  restrictedChannels: string[];
  tags: TagDto[];
}

export interface AddressDto {
  id: string;
  addressType: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  isPrimary: boolean;
}

export interface ChannelDto {
  id: string;
  channelType: string;
  value: string;
  label: string | null;
}

export interface ConsentDto {
  id: string;
  channel: ContactabilityChannel;
  status: ContactabilityStatus;
  reason: string | null;
  source: string;
  changedAt: string;
  changedByName: string | null;
}

export interface ContactDetailDto extends Omit<ContactRowDto, "restrictedChannels"> {
  relationshipRole: string | null;
  alternateEmail: string | null;
  crmCompanyId: string | null;
  sourceId: string | null;
  sourceLeadId: string | null;
  customFields: Record<string, unknown>;
  flaggedDuplicateIds: string[];
  mergedAt: string | null;
  createdBy: { id: string; fullName: string };
  sourceLead: { id: string; leadNumber: string; fullName: string; convertedAt: string | null } | null;
  crmCompany: {
    id: string;
    name: string;
    customerId: string | null;
    website: string | null;
    industry: string | null;
    city: string | null;
    country: string | null;
    customer: { id: string; code: string; name: string } | null;
  } | null;
  mergedInto: { id: string; fullName: string } | null;
  mergedFrom: { id: string; fullName: string; mergedAt: string | null }[];
  mergedContactIds: string[];
  addresses: AddressDto[];
  channels: ChannelDto[];
  consents: ConsentDto[];
  contactability: { channel: ContactabilityChannel; row: ConsentDto | null; allowed: boolean; effectiveStatus: ContactabilityStatus }[];
  flaggedDuplicates: { id: string; fullName: string; email: string | null; phone: string | null; companyName: string | null; archived: boolean }[];
  updatedByName: string | null;
  archivedByName: string | null;
  mergedByName: string | null;
}

export interface ContactMetaDto {
  sources: { id: string; key: string; name: string; isActive?: boolean }[];
  customFields: CrmCustomFieldDefinitionDto[];
  suggestions: Record<CrmOptionListKey, string[]>;
  canPickCustomer: boolean;
}

export interface ContactPermissions {
  create: boolean;
  edit: boolean;
  viewAll: boolean;
  settings: boolean;
}

export interface ContactDuplicateMatchDto {
  id: string;
  fullName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  owner: string | null;
  archived: boolean;
  rules: string[];
  action: "WARN" | "BLOCK" | "FLAG";
}

export interface BulkResult {
  requested: number;
  updated: number;
  skipped: { id: string; reason: string }[];
}
