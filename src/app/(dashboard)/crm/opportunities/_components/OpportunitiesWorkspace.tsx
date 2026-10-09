"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCrmPreferences } from "@/components/crm/useCrmPreferences";
import { Button } from "@/components/ui/Button";
import { OpportunitiesListClient } from "./OpportunitiesListClient";
import { OpportunityBoardClient } from "./OpportunityBoardClient";
import type { OpportunityPermissions } from "./opportunity-types";
import { useOpportunityLookups } from "./useOpportunityLookups";

type Mode = "board" | "list";

/**
 * Opportunities page (Phase 08): Board and List over the same records, the
 * same server-side filters (kept in the URL, so switching mode keeps them)
 * and the same APIs. `?view=board|list` wins; otherwise the user's last mode.
 */
export function OpportunitiesWorkspace({ permissions }: { permissions: OpportunityPermissions }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const preferences = useCrmPreferences("opportunities.");
  const { meta, users, error, reload } = useOpportunityLookups();
  const urlMode = searchParams.get("view");
  const mode: Mode = urlMode === "board" || urlMode === "list" ? urlMode : (preferences.prefs["opportunities.mode"] ?? "list");

  const switchTo = (next: Mode) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", next);
    router.replace(`${pathname}?${params}`, { scroll: false });
    preferences.setPreference("opportunities.mode", next);
  };

  // Both modes wait for the lookups (pipelines, stages, sources, custom fields) so filters are complete from the first request.
  const ready = preferences.loaded && Boolean(meta);
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Opportunities view" className="inline-flex rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700">
        {(["board", "list"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => mode !== m && switchTo(m)}
            className={`rounded px-3 py-1 text-sm font-medium ${mode === m ? "bg-indigo-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
          >
            {m === "board" ? "Board" : "List"}
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span>{error}</span>
          <Button size="xs" variant="secondary" onClick={reload}>
            Try again
          </Button>
        </div>
      )}
      {!ready && !error && <div className="rounded-lg border border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800">Loading…</div>}
      {ready && mode === "board" && meta && <OpportunityBoardClient key="board" permissions={permissions} meta={meta} users={users} preferences={preferences} />}
      {ready && mode === "list" && <OpportunitiesListClient key="list" permissions={permissions} meta={meta} users={users} preferences={preferences} />}
    </div>
  );
}
