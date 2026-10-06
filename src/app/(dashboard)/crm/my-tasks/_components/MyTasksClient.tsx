"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActivityComposer } from "@/components/crm/activities/ActivityComposer";
import { ActivityDetailModal } from "@/components/crm/activities/ActivityDetail";
import { ActivityRows } from "@/components/crm/activities/ActivityList";
import { ACTIVITIES_API, type ActivityDto } from "@/components/crm/activities/activity-types";
import { useActivityLookups } from "@/components/crm/activities/useActivityLookups";
import { CrmErrorState, CrmLoadingState } from "@/components/crm/CrmStates";
import { Button } from "@/components/ui/Button";

const SECTIONS = [
  { key: "overdue", title: "Overdue", params: "due=overdue&sortBy=dueAt&sortOrder=asc", empty: "Nothing overdue." },
  { key: "today", title: "Due today", params: "due=today&sortBy=dueAt&sortOrder=asc", empty: "Nothing due today." },
  { key: "upcoming", title: "Upcoming", params: "due=upcoming&sortBy=dueAt&sortOrder=asc", empty: "Nothing scheduled after today." },
  { key: "no_due_date", title: "No due date", params: "due=no_due_date&sortBy=createdAt&sortOrder=desc", empty: "" },
  { key: "completed", title: "Recently completed", params: "due=completed&sortBy=completedAt&sortOrder=desc", empty: "Nothing completed yet." },
] as const;
const PAGE = 10;

function Section({ title, params, empty, refreshKey, canEdit, onOpen, onChanged }: { title: string; params: string; empty: string; refreshKey: number; canEdit: boolean; onOpen: (a: ActivityDto) => void; onChanged: () => void }) {
  const [state, setState] = useState<{ rows: ActivityDto[] | null; total: number; error: string | null }>({ rows: null, total: 0, error: null });
  const [limit, setLimit] = useState(PAGE);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch(`${ACTIVITIES_API}?mine=assigned&${params}&pageSize=${limit}`)
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (!r.ok) return setState({ rows: null, total: 0, error: body?.error?.message ?? "Could not load tasks." });
        setState({ rows: body.data, total: body.meta?.totalCount ?? body.data.length, error: null });
      })
      .catch(() => !cancelled && setState({ rows: null, total: 0, error: "Could not load tasks." }));
    return () => {
      cancelled = true;
    };
  }, [params, limit, refreshKey, tick]);

  if (state.error) return <CrmErrorState message={state.error} onRetry={() => setTick((t) => t + 1)} />;
  if (!state.rows) return <CrmLoadingState />;
  if (!state.rows.length && !empty) return null;
  return (
    <section aria-label={title} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
        <span className="rounded-full bg-zinc-100 px-2 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{state.total}</span>
      </h2>
      {state.rows.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{empty}</p>
      ) : (
        <>
          <ActivityRows rows={state.rows} canEdit={canEdit} onOpen={onOpen} onChanged={onChanged} />
          {state.total > state.rows.length && (
            <button type="button" className="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({state.total - state.rows.length})
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** The signed-in user's tasks grouped by when they are due. */
export function MyTasksClient({ currentUserId, canCreate, canEdit }: { currentUserId: string; canCreate: boolean; canEdit: boolean }) {
  const { meta, users } = useActivityLookups();
  const [refreshKey, setRefreshKey] = useState(0);
  const [opened, setOpened] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const refresh = () => setRefreshKey((k) => k + 1);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Tick a task to complete it. <Link href="/crm/activities" className="text-indigo-600 hover:underline dark:text-indigo-400">All activities</Link>
        </p>
        {canCreate && (
          <Button onClick={() => setComposing(true)} disabled={!meta}>
            New task
          </Button>
        )}
      </div>
      {SECTIONS.map((s) => (
        <Section key={s.key} title={s.title} params={s.params} empty={s.empty} refreshKey={refreshKey} canEdit={canEdit} onOpen={(a) => setOpened(a.id)} onChanged={refresh} />
      ))}
      {composing && meta && (
        <ActivityComposer
          meta={meta}
          users={users}
          currentUserId={currentUserId}
          onClose={() => setComposing(false)}
          onSaved={() => {
            setComposing(false);
            refresh();
          }}
        />
      )}
      {opened && <ActivityDetailModal activityId={opened} meta={meta} users={users} canEdit={canEdit} onClose={() => setOpened(null)} onChanged={refresh} />}
    </div>
  );
}
