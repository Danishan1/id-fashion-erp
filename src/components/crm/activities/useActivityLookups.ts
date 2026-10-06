"use client";

import { useEffect, useState } from "react";
import type { ActivityMetaDto, UserOptionDto } from "./activity-types";

/** Activity meta (types, priorities, reminders, outcome suggestions) + ERP users for the assignee picker, loaded once per screen. */
export function useActivityLookups() {
  const [state, setState] = useState<{ meta: ActivityMetaDto | null; users: UserOptionDto[]; error: string | null }>({ meta: null, users: [], error: null });

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/v1/crm/activities/meta").then((r) => (r.ok ? r.json() : Promise.reject(r))), fetch("/api/v1/users").then((r) => (r.ok ? r.json() : { data: [] }))])
      .then(([m, u]) => {
        if (!cancelled) setState({ meta: m.data, users: (u.data ?? []).filter((x: { status?: string }) => !x.status || x.status === "ACTIVE"), error: null });
      })
      .catch(() => !cancelled && setState((s) => ({ ...s, error: "Could not load activity settings." })));
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
