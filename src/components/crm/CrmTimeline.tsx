"use client";

import { useCallback, useEffect, useState } from "react";
import { readApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/date-format";
import { CrmActivityItem } from "./CrmActivityItem";
import { CrmEmptyState, CrmErrorState, CrmLoadingState } from "./CrmStates";
import { crmEventTone, type CrmTimelineEventDto } from "./crm-timeline-types";

/**
 * Newest-first CRM event feed, grouped by day, with "Load more".
 * Give `entityType` + `entityId` for one record's timeline; omit both for the
 * company-wide feed (each row then shows which record it belongs to).
 */
export function CrmTimeline({
  entityType,
  entityId,
  pageSize = 20,
  emptyTitle = "No activity yet",
  emptyDescription = "Changes to CRM records will appear here as they happen.",
  refreshKey,
}: {
  entityType?: string;
  entityId?: string;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  refreshKey?: number;
}) {
  const [events, setEvents] = useState<CrmTimelineEventDto[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const isRecordTimeline = Boolean(entityType && entityId);

  const buildUrl = useCallback(
    (p: number) => {
      const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (entityType) params.set("entityType", entityType);
      if (entityId) params.set("entityId", entityId);
      return `/api/v1/crm/events?${params.toString()}`;
    },
    [entityType, entityId, pageSize]
  );

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(buildUrl(page), { signal: controller.signal });
        if (!res.ok) throw new Error((await readApiError(res, "Could not load activity.")).message);
        const body = (await res.json()) as { data: CrmTimelineEventDto[]; meta: { totalPages: number } };
        setEvents((prev) => (page === 1 ? body.data : [...prev, ...body.data]));
        setTotalPages(body.meta.totalPages);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError((err as Error).message);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [buildUrl, page, refreshKey, reloadTick]);

  const [lastResetKey, setLastResetKey] = useState(`${buildUrl(1)}|${refreshKey}`);
  const resetKey = `${buildUrl(1)}|${refreshKey}`;
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setPage(1);
  }

  if (error && events.length === 0) {
    return <CrmErrorState message={error} onRetry={() => setReloadTick((t) => t + 1)} />;
  }
  if (isLoading && events.length === 0) return <CrmLoadingState />;
  if (events.length === 0) return <CrmEmptyState title={emptyTitle} description={emptyDescription} />;

  const groups: { day: string; items: CrmTimelineEventDto[] }[] = [];
  for (const event of events) {
    const day = formatDate(event.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(event);
    else groups.push({ day, items: [event] });
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.day} aria-label={group.day}>
          <h3 className="mb-2 text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">{group.day}</h3>
          <ul>
            {group.items.map((e) => (
              <CrmActivityItem
                key={e.id}
                title={e.label}
                description={e.summary}
                occurredAt={e.occurredAt}
                actorName={e.actor?.fullName ?? "System"}
                context={isRecordTimeline ? undefined : e.entityLabel}
                contextHref={isRecordTimeline ? undefined : e.entityHref}
                tone={crmEventTone(e.category)}
              />
            ))}
          </ul>
        </section>
      ))}
      {error && <CrmErrorState message={error} onRetry={() => setReloadTick((t) => t + 1)} />}
      {page < totalPages && (
        <button
          type="button"
          disabled={isLoading}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {isLoading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
