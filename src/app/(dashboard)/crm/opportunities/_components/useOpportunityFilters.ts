"use client";

import { useEffect, useMemo, useState } from "react";
import type { CrmFilterDefinition } from "@/components/crm/CrmFilterBar";
import { OPPORTUNITY_STATUSES } from "@/modules/crm/opportunities/opportunity-registry";
import type { OpportunityMetaDto, TagDto, UserRefDto } from "./opportunity-types";

/**
 * The opportunity filter definitions shared by the List and the Board
 * (Phase 08). Both send the same query params to the server, which parses
 * them with parseOpportunityFilterParams — one filter vocabulary, one source
 * of truth. On the Board the pipeline is chosen with its own selector, so the
 * pipeline filter is left out and stages are limited to that pipeline.
 */
export function useOpportunityFilters({ meta, users, boardPipelineId, refreshKey = 0 }: { meta: OpportunityMetaDto | null; users: UserRefDto[]; boardPipelineId?: string | null; refreshKey?: number }) {
  const [tags, setTags] = useState<TagDto[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [contacts, setContacts] = useState<{ id: string; fullName: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = <T,>(url: string, set: (v: T[]) => void) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : { data: [] }))
        .then((b) => !cancelled && set(b.data ?? []))
        .catch(() => {});
    load<TagDto>("/api/v1/crm/tags", setTags);
    load<{ id: string; name: string }>("/api/v1/crm/companies/lookup?limit=200", setCompanies);
    load<{ id: string; fullName: string }>("/api/v1/crm/contacts/lookup?limit=200", setContacts);
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const board = boardPipelineId !== undefined;
  const filters: CrmFilterDefinition[] = useMemo(() => {
    const pipelines = meta?.pipelines ?? [];
    const multiPipeline = !board && pipelines.length > 1;
    const stagePipelines = board ? pipelines.filter((p) => p.id === boardPipelineId) : pipelines;
    return [
      ...(multiPipeline ? [{ type: "select" as const, key: "pipelineIds", label: "Pipeline", options: pipelines.map((p) => ({ value: p.id, label: p.name })) }] : []),
      {
        type: "select",
        key: "stageIds",
        label: "Stage",
        options: stagePipelines.flatMap((p) => p.stages.map((s) => ({ value: s.id, label: multiPipeline ? `${p.name} · ${s.name}` : s.name }))),
      },
      {
        type: "select",
        key: "statuses",
        label: "Status",
        anyLabel: board ? "Open (default)" : undefined,
        options: Object.entries(OPPORTUNITY_STATUSES).map(([k, s]) => ({ value: k, label: s.label })),
      },
      { type: "select", key: "ownerUserIds", label: "Owner", options: users.map((u) => ({ value: u.id, label: u.fullName })) },
      { type: "select", key: "unassigned", label: "Assignment", options: [{ value: "true", label: "Unassigned only" }] },
      { type: "select", key: "crmCompanyIds", label: "Company", options: companies.map((c) => ({ value: c.id, label: c.name })) },
      { type: "select", key: "crmContactIds", label: "Contact", options: contacts.map((c) => ({ value: c.id, label: c.fullName })) },
      { type: "select", key: "sourceIds", label: "Source", options: (meta?.sources ?? []).map((s) => ({ value: s.id, label: s.name })) },
      { type: "select", key: "tagIds", label: "Tag", options: tags.map((t) => ({ value: t.id, label: t.name })) },
      {
        type: "select",
        key: "closeDue",
        label: "Closing",
        options: [
          { value: "overdue", label: "Overdue (open, date passed)" },
          { value: "next_7_days", label: "Next 7 days" },
          { value: "next_30_days", label: "Next 30 days" },
          { value: "this_month", label: "This month" },
        ],
      },
      { type: "dateRange", label: "Expected close", fromKey: "expectedCloseDateFrom", toKey: "expectedCloseDateTo" },
      { type: "numberRange", label: "Value", minKey: "amountMin", maxKey: "amountMax" },
      { type: "numberRange", label: "Probability %", minKey: "probabilityMin", maxKey: "probabilityMax", step: 5 },
      { type: "select", key: "fromLead", label: "Origin", options: [{ value: "yes", label: "From a lead" }, { value: "no", label: "Created directly" }] },
      { type: "dateRange", label: "Created", fromKey: "createdAtFrom", toKey: "createdAtTo" },
      { type: "dateRange", label: "Updated", fromKey: "updatedAtFrom", toKey: "updatedAtTo" },
      { type: "dateRange", label: "Closed (won / lost)", fromKey: "closedAtFrom", toKey: "closedAtTo" },
      ...(board
        ? []
        : [{ type: "select" as const, key: "archived", label: "Archived", anyLabel: "Active opportunities only", options: [{ value: "only", label: "Archived only" }, { value: "include", label: "Active and archived" }] }]),
    ];
  }, [meta, users, tags, companies, contacts, board, boardPipelineId]);

  return { filters, tags };
}
