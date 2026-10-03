"use client";

import { useEffect, useState } from "react";
import type { CompanyMetaDto, UserRefDto } from "./company-types";

/** Company meta (statuses, sources, custom fields, suggestions) + active users for owner pickers, loaded once per screen. */
export function useCompanyLookups() {
  const [meta, setMeta] = useState<CompanyMetaDto | null>(null);
  const [users, setUsers] = useState<UserRefDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/v1/crm/companies/meta").then((r) => (r.ok ? r.json() : Promise.reject(r))), fetch("/api/v1/users").then((r) => (r.ok ? r.json() : { data: [] }))])
      .then(([m, u]) => {
        if (cancelled) return;
        setMeta(m.data);
        setUsers(u.data ?? []);
        setError(null);
      })
      .catch(() => !cancelled && setError("Could not load company settings."));
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { meta, users, error, reload: () => setTick((t) => t + 1) };
}
