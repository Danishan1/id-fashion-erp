"use client";

import { useState } from "react";
import { AdminUsersPanel } from "./AdminUsersPanel";
import { AdminAuditLogPanel } from "./AdminAuditLogPanel";
import { AdminBranchesPanel } from "./AdminBranchesPanel";
import { AdminRolesPanel } from "./AdminRolesPanel";
import { AdminCompanySettingsPanel } from "./AdminCompanySettingsPanel";
import { AdminDocumentSequencesPanel } from "./AdminDocumentSequencesPanel";
import { AdminWorkerSettingsPanel } from "./AdminWorkerSettingsPanel";
import { AdminModuleVisibilityPanel } from "./AdminModuleVisibilityPanel";
import { AdminBulkImportPanel } from "./AdminBulkImportPanel";
import { AdminAiProvidersPanel } from "./AdminAiProvidersPanel";

const TABS = [
  "Users",
  "Branches",
  "Roles",
  "Worker Settings",
  "Company Settings",
  "Document Numbering",
  "Module Visibility",
  "AI Configuration",
  "Bulk Import",
  "Audit Log",
] as const;
type Tab = (typeof TABS)[number];

interface RoleRef {
  id: string;
  name: string;
}
interface UserRow {
  id: string;
  email: string;
  fullName: string;
  status: "ACTIVE" | "SUSPENDED" | "LOCKED";
  defaultBranch: { id: string; name: string } | null;
  branchRoles: Array<{ id: string; role: RoleRef; branch: { id: string; name: string } }>;
  employeeId: string | null;
  employee: { id: string; fullName: string; employeeCode: string } | null;
}

interface AccessGrant {
  view: boolean;
  manage: boolean;
}

/**
 * Which granular Administration module (RBAC audit, 2026-09-24 split) each
 * tab is gated on — mirrors the old flat `administration.view` split into
 * `administration_users`/`administration_roles`/`administration_settings`
 * exactly as `src/config/rbac.ts` now defines them. Every tab besides Users
 * and Roles falls under Settings (Branches, Worker Settings, Company
 * Settings, Document Numbering, Module Visibility, AI Configuration, Bulk
 * Import, Audit Log) — none of these were called out as needing their own
 * finer split, so they share the one "company/system configuration" bucket.
 */
const TAB_GROUP: Record<Tab, keyof AdminAccess> = {
  Users: "users",
  Branches: "settings",
  Roles: "roles",
  "Worker Settings": "settings",
  "Company Settings": "settings",
  "Document Numbering": "settings",
  "Module Visibility": "settings",
  "AI Configuration": "settings",
  "Bulk Import": "settings",
  "Audit Log": "settings",
};

export interface AdminAccess {
  users: AccessGrant;
  roles: AccessGrant;
  settings: AccessGrant;
}

export function AdminTabs({
  initialUsers,
  currentUserId,
  access,
}: {
  initialUsers: UserRow[];
  currentUserId: string;
  access: AdminAccess;
}) {
  // Only a tab whose own group the viewer actually holds `view` on is ever
  // shown — previously every tab rendered unconditionally the moment the
  // viewer passed the single old blanket `administration.view` check, so an
  // ACCOUNTS_MANAGER (now Settings-only) would still see Users/Roles tabs
  // whose underlying panels would then fail their own API calls with a 403.
  const viewableTabs = TABS.filter((t) => access[TAB_GROUP[t]].view);
  // Bulk Import is additionally the one tab whose BUTTON itself is only
  // rendered for someone who can also MANAGE Settings, not just view them —
  // matches the feature spec's explicit "must be visible... ONLY to Super
  // Admin" requirement, deliberately deviating from Module Visibility's own
  // "always visible, buttons disabled" precedent.
  const visibleTabs = viewableTabs.filter((t) => t !== "Bulk Import" || access.settings.manage);

  const [tab, setTab] = useState<Tab>(visibleTabs[0] ?? "Users");
  // If the requested/default tab isn't actually visible for this viewer
  // (e.g. they land on a stale "Users" default with no Users access), fall
  // back to the first tab they genuinely can see, rather than rendering a
  // dead tab-strip selection with no matching panel.
  const activeTab = visibleTabs.includes(tab) ? tab : visibleTabs[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {visibleTabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${
              activeTab === t
                ? "border-b-2 border-indigo-600 text-indigo-600"
                : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === "Users" && (
        <AdminUsersPanel initialUsers={initialUsers} canManage={access.users.manage} currentUserId={currentUserId} />
      )}
      {activeTab === "Branches" && <AdminBranchesPanel canManage={access.settings.manage} />}
      {activeTab === "Roles" && <AdminRolesPanel canManage={access.roles.manage} />}
      {activeTab === "Worker Settings" && <AdminWorkerSettingsPanel canManage={access.settings.manage} />}
      {activeTab === "Company Settings" && <AdminCompanySettingsPanel canManage={access.settings.manage} />}
      {activeTab === "Document Numbering" && <AdminDocumentSequencesPanel />}
      {activeTab === "Module Visibility" && <AdminModuleVisibilityPanel canManage={access.settings.manage} />}
      {activeTab === "AI Configuration" && <AdminAiProvidersPanel canManage={access.settings.manage} />}
      {activeTab === "Bulk Import" && access.settings.manage && <AdminBulkImportPanel />}
      {activeTab === "Audit Log" && <AdminAuditLogPanel />}
    </div>
  );
}
