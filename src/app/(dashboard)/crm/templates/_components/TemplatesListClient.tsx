"use client";

import Link from "next/link";
import { useState } from "react";
import { CrmBadge } from "@/components/crm/CrmBadge";
import type { CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { CrmTable } from "@/components/crm/CrmTable";
import { TemplateCategoriesDialog } from "@/components/crm/templates/TemplateDialogs";
import { TemplateStatusBadge, useTemplateMeta } from "@/components/crm/templates/TemplateParts";
import { TEMPLATES_API, type TemplateListRowDto } from "@/components/crm/templates/template-types";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/date-format";
import type { CrmPagePermissions } from "@/modules/crm/core/crm-page";

/**
 * Template library: server-side search (name, description, current text),
 * channel / status / category filters, sortable columns, paging. Bodies are
 * never loaded for the list. Archived templates show only when filtered for.
 */
export function TemplatesListClient({ permissions }: { permissions: CrmPagePermissions }) {
  const { meta, error, reload } = useTemplateMeta();
  const [managing, setManaging] = useState(false);
  if (error) return <CrmErrorState message={error} onRetry={reload} />;
  if (!meta) return <CrmLoadingState />;
  const filters: CrmFilterDefinition[] = [
    { type: "select", key: "channels", label: "Channel", options: meta.channels.map((c) => ({ value: c.key, label: c.label })) },
    { type: "select", key: "statuses", label: "Status", options: meta.statuses.map((s) => ({ value: s.key, label: s.label })), anyLabel: "Draft + active" },
    { type: "select", key: "categoryIds", label: "Category", options: meta.categories.map((c) => ({ value: c.id, label: c.name + (c.archived ? " (archived)" : "") })) },
  ];
  return (
    <div className="space-y-3">
      <CrmTable<TemplateListRowDto>
        fetchUrl={TEMPLATES_API}
        filters={filters}
        searchPlaceholder="Search name, description or text…"
        rowHref={(r) => `/crm/templates/${r.id}`}
        newHref={permissions.create ? "/crm/templates/new" : undefined}
        newLabel="New template"
        initialSort={{ sortBy: "updatedAt", sortOrder: "desc" }}
        toolbar={
          permissions.settingsEdit ? (
            <Button variant="secondary" onClick={() => setManaging(true)}>
              Categories
            </Button>
          ) : undefined
        }
        columns={[
          { key: "name", header: "Name", sortable: true, render: (r) => <Link className="font-medium text-indigo-700 hover:underline dark:text-indigo-300" href={`/crm/templates/${r.id}`}>{r.name}</Link> },
          { key: "channelType", header: "Channel", sortable: true, render: (r) => <CrmBadge label={r.channelLabel} tone="indigo" /> },
          { key: "category", header: "Category", render: (r) => (r.category ? <span className={r.category.archived ? "text-zinc-400" : ""}>{r.category.name}</span> : <span className="text-zinc-400">—</span>) },
          { key: "status", header: "Status", sortable: true, render: (r) => <TemplateStatusBadge status={r.status} /> },
          { key: "currentVersionNumber", header: "Version", render: (r) => `v${r.currentVersionNumber}` },
          { key: "usageCount", header: "Used", render: (r) => (r.usageCount ? `${r.usageCount}×` : "—") },
          { key: "updatedBy", header: "Updated by", render: (r) => r.updatedBy.name ?? "—" },
          { key: "updatedAt", header: "Updated", sortable: true, render: (r) => formatDateTime(r.updatedAt) },
        ]}
      />
      {managing && <TemplateCategoriesDialog open={managing} onClose={() => setManaging(false)} meta={meta} onChanged={reload} />}
    </div>
  );
}
