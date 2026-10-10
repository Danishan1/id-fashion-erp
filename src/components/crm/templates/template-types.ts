import type { TemplateIssue, TemplateStatus } from "@/modules/crm/templates/template-registry";

export const TEMPLATES_API = "/api/v1/crm/templates";

export interface TemplateMetaDto {
  channels: { key: string; label: string; subject: "required" | "none"; maxBodyLength: number; recommendedMaxLength?: number; smsSegments?: boolean; providerFields: { key: string; label: string; help: string; pattern: string; maxLength: number }[] }[];
  statuses: { key: TemplateStatus; label: string; tone: string; help: string }[];
  entities: { key: string; label: string; variables: { key: string; label: string; sample: string }[] }[];
  unavailable: { key: string; reason: string }[];
  categories: { id: string; name: string; archived: boolean; sortOrder: number }[];
  categoryListKey: string;
  testChannels: { id: string; name: string; channelType: string; canSend: boolean; reason: string | null }[];
}

export interface TemplateListRowDto {
  id: string;
  name: string;
  channelType: string;
  channelLabel: string;
  status: TemplateStatus;
  description: string | null;
  category: { id: string; name: string; archived: boolean } | null;
  currentVersionNumber: number;
  usageCount: number;
  createdBy: { id: string; name: string | null };
  updatedBy: { id: string; name: string | null };
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TemplateVersionDto {
  id: string;
  templateId: string;
  versionNumber: number;
  subject: string | null;
  body: string;
  variables: string[];
  providerMetadata: Record<string, string>;
  changeNote: string | null;
  restoredFromId: string | null;
  restoredFromNumber: number | null;
  createdBy: { id: string; name: string | null };
  createdAt: string;
  usageCount: number;
  isCurrent?: boolean;
}

export interface TemplateValidationDto {
  valid: boolean;
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
  variables: string[];
  sms?: { encoding: string; units: number; segments: number };
}

export interface TemplateDetailDto {
  id: string;
  name: string;
  channelType: string;
  channelLabel: string;
  status: TemplateStatus;
  description: string | null;
  category: { id: string; name: string; archived: boolean } | null;
  currentVersion: TemplateVersionDto | null;
  currentVersionNumber: number;
  versionCount: number;
  validation: TemplateValidationDto | null;
  usage: { key: string; label: string; count: number; lastUsedAt: string | null; byVersion: Record<string, number>; activeReferences: { label: string; href?: string | null }[] }[];
  usageCount: number;
  lastUsedAt: string | null;
  duplicatedFrom: { id: string; name: string } | null;
  createdBy: { id: string; name: string | null };
  updatedBy: { id: string; name: string | null } | null;
  activatedAt: string | null;
  activatedBy: { id: string; name: string | null } | null;
  archivedAt: string | null;
  archivedBy: { id: string; name: string | null } | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface TemplatePreviewDto {
  subject: string | null;
  body: string;
  errors: TemplateIssue[];
  warnings: TemplateIssue[];
  ok: boolean;
  missing: { key: string; reason: "NO_VALUE" | "NO_CONTEXT"; usedFallback: boolean }[];
  sms?: { encoding: string; units: number; segments: number };
  version?: { id: string; versionNumber: number };
  template?: { id: string; name: string; channelType: string; status: TemplateStatus };
}

export interface TemplatePreviewContext {
  contactId?: string;
  companyId?: string;
  opportunityId?: string;
  leadId?: string;
  conversationId?: string;
}

export const STATUS_TONE: Record<TemplateStatus, "amber" | "green" | "neutral"> = { DRAFT: "amber", ACTIVE: "green", ARCHIVED: "neutral" };
