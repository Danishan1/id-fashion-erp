import type { CrmCustomFieldType } from "@prisma/client";

/** Client-safe labels for the field-type picker. */
export const CRM_CUSTOM_FIELD_TYPE_LABELS: Record<CrmCustomFieldType, string> = {
  TEXT: "Text",
  TEXTAREA: "Long text",
  NUMBER: "Whole number",
  DECIMAL: "Decimal number",
  CURRENCY: "Currency amount",
  DATE: "Date",
  DATETIME: "Date & time",
  BOOLEAN: "Yes / No",
  DROPDOWN: "Dropdown",
  MULTI_SELECT: "Multi-select",
  PHONE: "Phone",
  EMAIL: "Email",
  URL: "URL",
};

export const CRM_CUSTOM_FIELD_TYPES = Object.keys(CRM_CUSTOM_FIELD_TYPE_LABELS) as CrmCustomFieldType[];

export const CHOICE_FIELD_TYPES: CrmCustomFieldType[] = ["DROPDOWN", "MULTI_SELECT"];

export interface CrmCustomFieldOption {
  value: string;
  label: string;
}

/** The subset of a definition the form renderer / validator needs (client-safe shape). */
export interface CrmCustomFieldDefinitionDto {
  id: string;
  key: string;
  label: string;
  fieldType: CrmCustomFieldType;
  description: string | null;
  options: CrmCustomFieldOption[] | null;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
}
