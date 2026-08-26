"use client";

import { useState } from "react";
import { AdminUsersPanel } from "./AdminUsersPanel";
import { AdminAuditLogPanel } from "./AdminAuditLogPanel";

const TABS = ["Users", "Audit Log"] as const;
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
  branchRoles: Array<{ role: RoleRef; branch: { id: string; name: string } }>;
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
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
      {tab === "Audit Log" && <AdminAuditLogPanel />}
    </div>
  );
}
