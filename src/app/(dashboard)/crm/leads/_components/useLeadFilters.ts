"use client";

import { useEffect, useMemo, useState } from "react";
import type { CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
import type { LeadMetaDto, TagDto, UserRefDto } from "./lead-types";

/**
 * The lead filter definitions shared by the List and the Board. Both send the
 * same query params, parsed on the server by parseLeadFilterParams. The board
 * never shows archived leads, so it leaves that filter out.
 */
export function useLeadFilters({ meta, users, board = false, refreshKey = 0 }: { meta: LeadMetaDto | null; users: UserRefDto[]; board?: boolean; refreshKey?: number }) {
  const [tags, setTags] = useState<TagDto[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/crm/tags")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((b) => !cancelled && setTags(b.data ?? []))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filters: CrmFilterDefinition[] = useMemo(
    () => [
      { type: "select", key: "statusIds", label: "Status", options: (meta?.statuses ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { type: "select", key: "sourceIds", label: "Source", options: (meta?.sources ?? []).map((s) => ({ value: s.id, label: s.name })) },
      {
        type: "select",
        key: "captureChannels",
        label: "Captured via",
        options: [
          { value: "MANUAL", label: "Manual entry" },
          { value: "CSV", label: "CSV import" },
          { value: "XLSX", label: "Excel import" },
          { value: "WEBSITE_FORM", label: "Website form" },
          { value: "API", label: "API" },
          { value: "WEBHOOK", label: "Webhook" },
        ],
      },
      { type: "text", key: "importJobId", label: "Import ID", placeholder: "From Import history" },
      { type: "select", key: "ownerUserIds", label: "Owner", options: users.map((u) => ({ value: u.id, label: u.fullName })) },
      { type: "select", key: "unassigned", label: "Assignment", options: [{ value: "true", label: "Unassigned only" }] },
      {
        type: "select",
        key: "temperatures",
        label: "Temperature",
        options: [
          { value: "HOT", label: "Hot" },
          { value: "WARM", label: "Warm" },
          { value: "COLD", label: "Cold" },
        ],
      },
      { type: "select", key: "tagIds", label: "Tag", options: tags.map((t) => ({ value: t.id, label: t.name })) },
      { type: "text", key: "companyName", label: "Company", placeholder: "Company name contains…" },
      { type: "text", key: "industry", label: "Industry" },
      { type: "text", key: "location", label: "Location", placeholder: "City, state or country" },
      { type: "text", key: "campaignSource", label: "Campaign source" },
      { type: "text", key: "referralSource", label: "Referred by" },
      { type: "numberRange", label: "Score", minKey: "scoreMin", maxKey: "scoreMax", step: 1 },
      { type: "numberRange", label: "Estimated value", minKey: "estimatedValueMin", maxKey: "estimatedValueMax" },
      { type: "dateRange", label: "Created", fromKey: "createdAtFrom", toKey: "createdAtTo" },
      { type: "dateRange", label: "Updated", fromKey: "updatedAtFrom", toKey: "updatedAtTo" },
      { type: "dateRange", label: "Last contacted", fromKey: "lastContactedAtFrom", toKey: "lastContactedAtTo" },
      { type: "dateRange", label: "Next follow-up", fromKey: "nextFollowUpAtFrom", toKey: "nextFollowUpAtTo" },
      ...(board
        ? []
        : [
            {
              type: "select" as const,
              key: "archived",
              label: "Archived",
              anyLabel: "Active leads only",
              options: [
                { value: "only", label: "Archived only" },
                { value: "include", label: "Active and archived" },
              ],
            },
          ]),
    ],
    [meta, users, tags, board]
  );
  return { filters, tags };
}
