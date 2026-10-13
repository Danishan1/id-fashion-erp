/** Phase 21 — client shapes of GET /api/v1/crm/dashboard (see crm-dashboard.service.ts). */

export const DASHBOARD_API = "/api/v1/crm/dashboard";

export type Money = { currencyCode: string | null; total: number };

export interface KpiCard {
  key: string;
  label: string;
  value: number | null;
  money?: Money[];
  /** now = current total · period = in the selected range · next = upcoming window */
  scope: "now" | "period" | "next";
  hint: string;
  href: string;
  tone?: "warning";
}

export interface PipelineData {
  pipelines: { id: string; name: string; isDefault: boolean }[];
  pipeline: { id: string; name: string } | null;
  stages: { id: string; name: string; probability: number | null; count: number; values: Money[]; href: string }[];
  openHref?: string;
  outcomes: { unit: "day" | "week"; points: { bucket: string; won: number; lost: number }[]; won: number; lost: number; abandoned: number; winRate: number | null; wonHref: string; lostHref: string } | null;
}

export interface LeadsData {
  unit: "day" | "week";
  trend: { bucket: string; count: number }[];
  createdTotal: number;
  createdHref: string;
  bySource: { id: string | null; label: string; count: number; href: string }[];
  currentTotal: number;
  byStatus: { id: string; label: string; kind: string; count: number; href: string }[];
}

export interface LeadRow {
  id: string;
  label: string;
  sublabel: string | null;
  status: string;
  owner: string | null;
  createdAt: string;
  updatedAt: string;
  nextFollowUpAt: string | null;
  href: string;
}

export interface AttentionData {
  neverContacted: { count: number; rows: LeadRow[]; href: string };
  followUpPassed: { count: number; rows: LeadRow[]; href: string };
  followUpToday: { count: number; href: string };
  recentlyUpdated: { rows: LeadRow[]; href: string };
}

export interface WorkItem {
  id: string;
  type: string;
  typeLabel: string;
  subject: string;
  status: string;
  priority: string;
  due: { date: string | null; time: string | null } | null;
  dueState: string;
  completedAt: string | null;
  assignee: string | null;
  related: { label: string; href: string | null } | null;
}

export interface MyWorkData {
  forUser: string | null;
  overdue: { count: number; items: WorkItem[]; href: string };
  today: { count: number; items: WorkItem[]; href: string };
  upcoming: { count: number; items: WorkItem[]; href: string };
  appointments: { count: number; items: WorkItem[]; href: string };
  completed: { items: WorkItem[]; href: string };
}

export interface ActivityData {
  events: { id: string; eventType: string; label: string; category: string; summary: string | null; entityType: string; entityLabel: string; href: string | null; occurredAt: string; actor: string | null }[];
  href: string;
}

export interface AutomationData {
  bulk: { active: number; problems: number; href: string; problemsHref: string };
  workflows: {
    completed: number;
    failed: number;
    cancelled: number;
    activeNow: number;
    started: number;
    recentFailures: { id: string; workflow: string; finishedAt: string | null; errorCode: string | null; message: string; record: { entityType: string; href: string | null } | null; href: string }[];
    href: string;
    failedHref: string;
  } | null;
  integrations: { failedLeadCaptures: number; flaggedLeadCaptures: number; capturesHref: string; failedMessages: number; messagesHref: string; pausedChannels: number; channelsHref: string } | null;
}

export type WidgetResult<T> = { status: "ok"; data: T } | { status: "error"; message: string };

export interface DashboardDto {
  generatedAt: string;
  timeZone: string;
  filters: { range: { key: string; from: string; to: string; label: string; days: number }; owner: string; pipelineId: string | null; pipelineName: string | null };
  viewer: { viewAll: boolean; settingsView: boolean };
  widgets: Partial<{
    kpis: WidgetResult<{ cards: KpiCard[] }>;
    pipeline: WidgetResult<PipelineData>;
    leads: WidgetResult<LeadsData>;
    attention: WidgetResult<AttentionData>;
    myWork: WidgetResult<MyWorkData>;
    activity: WidgetResult<ActivityData>;
    automation: WidgetResult<AutomationData>;
  }>;
}

export interface DashboardPermissions {
  create: boolean;
  edit: boolean;
  viewAll: boolean;
  settings: boolean;
  settingsEdit: boolean;
}
