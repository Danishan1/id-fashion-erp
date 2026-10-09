"use client";

import { useEffect, useState } from "react";
import type { LeadMetaDto, UserRefDto } from "./lead-types";

/** Statuses, sources, custom fields (lead meta) + active users for owner pickers, loaded once per screen. */
export function useLeadLookups() {
  const [meta, setMeta] = useState<LeadMetaDto | null>(null);
  const [users, setUsers] = useState<UserRefDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/v1/crm/leads/meta").then((r) => (r.ok ? r.json() : Promise.reject(r))), fetch("/api/v1/users").then((r) => (r.ok ? r.json() : { data: [] }))])
      .then(([m, u]) => {
        if (cancelled) return;
        setMeta(m.data);
        setUsers(u.data ?? []);
        setError(null);
      })
      .catch(() => !cancelled && setError("Could not load lead settings."));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { meta, users, error, reload: () => setTick((t) => t + 1) };
}
