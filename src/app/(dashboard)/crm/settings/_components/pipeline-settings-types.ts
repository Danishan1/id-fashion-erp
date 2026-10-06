/** JSON shapes of /api/v1/crm/settings/pipelines and /api/v1/crm/pipelines/{id} (Settings → Pipelines). */

export interface RequirementOptionDto {
  key: string;
  label: string;
  group: "Fields" | "ERP documents" | "Custom fields";
  inactive?: boolean;
}

export interface TransitionRuleDto {
  id: string;
  fromStageId: string;
  toStageId: string;
  allowed: boolean;
  requiredFields: string[];
  message: string | null;
}

export interface SettingsStageDto {
  id: string;
  pipelineId: string;
  key: string;
  name: string;
  description: string | null;
  probability: number | null;
  isDefault: boolean;
  status: "ACTIVE" | "ARCHIVED";
  sortOrder: number;
  requiredFields: string[];
  requiredFieldLabels?: string[];
  transitionMode: "ANY" | "ONLY_LISTED";
  transitionRules?: TransitionRuleDto[];
  opportunityCount?: number;
  openOpportunityCount?: number;
  version: number;
}

export interface SettingsPipelineDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  opportunityCount: number;
  openOpportunityCount: number;
  stages: SettingsStageDto[];
}

export interface PipelineDetailDto extends SettingsPipelineDto {
  requirementOptions: RequirementOptionDto[];
  unavailableRequirements: readonly { key: string; label: string; reason: string }[];
}

export const PIPELINES_API = "/api/v1/crm/pipelines";
