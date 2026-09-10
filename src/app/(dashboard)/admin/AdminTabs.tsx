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

export function AdminTabs({
  initialUsers,
  canManage,
  currentUserId,
}: {
  initialUsers: UserRow[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [tab, setTab] = useState<Tab>("Users");

  // Bulk Import is the one tab whose BUTTON itself is only rendered for a
  // Super Admin (canManage) — unlike every other tab here, which always
  // renders and just disables its own buttons via canManage. This matches
  // the feature spec's explicit "must be visible... ONLY to Super Admin"
  // requirement, deliberately deviating from the Module Visibility tab's
  // own "always visible, buttons disabled" precedent.
  const visibleTabs = TABS.filter((t) => t !== "Bulk Import" || canManage);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {visibleTabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t ? "border-b-2 border-indigo-600 text-indigo-600" : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Users" && <AdminUsersPanel initialUsers={initialUsers} canManage={canManage} currentUserId={currentUserId} />}
      {tab === "Branches" && <AdminBranchesPanel canManage={canManage} />}
      {tab === "Roles" && <AdminRolesPanel canManage={canManage} />}
      {tab === "Worker Settings" && <AdminWorkerSettingsPanel canManage={canManage} />}
      {tab === "Company Settings" && <AdminCompanySettingsPanel canManage={canManage} />}
      {tab === "Document Numbering" && <AdminDocumentSequencesPanel />}
      {tab === "Module Visibility" && <AdminModuleVisibilityPanel canManage={canManage} />}
      {tab === "AI Configuration" && <AdminAiProvidersPanel canManage={canManage} />}
      {tab === "Bulk Import" && canManage && <AdminBulkImportPanel />}
      {tab === "Audit Log" && <AdminAuditLogPanel />}
    </div>
  );
}
