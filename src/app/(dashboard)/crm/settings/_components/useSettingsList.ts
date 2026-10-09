"use client";

import { useCallback, useEffect, useState } from "react";
import { crmRequest } from "@/components/crm/crm-api";

/** GET a settings list once, with reload(). setState only happens in the fetch callback. */
export function useSettingsList<T>(url: string) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    crmRequest<T[]>(url).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setRows(res.data);
        setError(null);
      } else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, error, reload, setRows };
}
