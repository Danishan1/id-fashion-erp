"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TOAST_HEADER } from "@/lib/api-client";
import type { CrmPreferenceKey, CrmPreferenceValue } from "@/modules/crm/preferences/crm-preference-registry";

type Prefs = Partial<{ [K in CrmPreferenceKey]: CrmPreferenceValue<K> }>;

/**
 * The signed-in user's CRM screen preferences under a prefix (Phase 08),
 * loaded once and saved through /api/v1/crm/preferences. Saving is
 * fire-and-forget and debounced per key: a preference is a convenience, so a
 * failed save never blocks the screen (it just isn't remembered).
 */
export function useCrmPreferences(prefix: string) {
  const [prefs, setPrefs] = useState<Prefs>({});
  const [loaded, setLoaded] = useState(false);
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/crm/preferences?prefix=${encodeURIComponent(prefix)}`)
      .then((r) => (r.ok ? r.json() : { data: {} }))
      .then((b) => !cancelled && setPrefs((b.data ?? {}) as Prefs))
      .catch(() => {})
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [prefix]);

  useEffect(() => {
    const pending = timers.current;
    // Leaving the screen flushes pending saves instead of dropping them.
    return () =>
      pending.forEach((p) => {
        clearTimeout(p.timer);
        p.run();
      });
  }, []);

  const setPreference = useCallback(<K extends CrmPreferenceKey>(key: K, value: CrmPreferenceValue<K> | undefined) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    const pending = timers.current;
    const existing = pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const run = () => {
      pending.delete(key);
      const url = `/api/v1/crm/preferences/${encodeURIComponent(key)}`;
      const init: RequestInit =
        value === undefined
          ? { method: "DELETE", headers: { [TOAST_HEADER]: "off" } }
          : { method: "PUT", headers: { "Content-Type": "application/json", [TOAST_HEADER]: "off" }, body: JSON.stringify({ value }) };
      fetch(url, init).catch(() => {});
    };
    pending.set(key, { timer: setTimeout(run, 400), run });
  }, []);

  return { prefs, loaded, setPreference };
}
