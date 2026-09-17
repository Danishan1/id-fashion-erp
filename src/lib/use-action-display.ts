"use client";

import { useEffect, useState } from "react";

export type ActionDisplayMode = "ICON" | "TEXT";
export type ActionTextStyle = "LINK" | "BUTTON";

export interface ActionDisplaySettings {
  displayMode: ActionDisplayMode;
  textStyle: ActionTextStyle;
}

const DEFAULT_SETTINGS: ActionDisplaySettings = { displayMode: "ICON", textStyle: "LINK" };

// A module-level cache: every RowAction on a page would otherwise fire its
// own identical GET on mount. The first hook instance to resolve populates
// this for every other instance already mounted or about to mount in the
// same page session — a plain in-memory cache is enough here (this is a
// company-wide, rarely-changed display preference, not per-viewer state).
let cached: ActionDisplaySettings | null = null;
let inFlight: Promise<ActionDisplaySettings> | null = null;

function fetchSettings(): Promise<ActionDisplaySettings> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    // The fetch() call itself is wrapped inside this chain (not invoked
    // directly with .then() chained onto its own return value) so that a
    // synchronous throw, or a non-Promise return value (both real
    // possibilities in a test environment with an exhausted/misconfigured
    // fetch mock — this hook fires on every RowAction mount, an extra call a
    // fixed-length mockResolvedValueOnce() queue elsewhere in the app won't
    // have anticipated), still lands in this same chain's .catch() instead
    // of throwing synchronously out of this function.
    inFlight = Promise.resolve()
      .then(() => fetch("/api/v1/action-display-settings"))
      .then((res) => res.json())
      .then((body) => {
        const data = body?.data;
        const result: ActionDisplaySettings =
          data?.displayMode === "TEXT" || data?.displayMode === "ICON"
            ? { displayMode: data.displayMode, textStyle: data.textStyle === "BUTTON" ? "BUTTON" : "LINK" }
            : DEFAULT_SETTINGS;
        cached = result;
        return result;
      })
      .catch(() => DEFAULT_SETTINGS)
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** Fails open to icon-only/link — the pre-setting default — while loading or on a failed fetch. */
export function useActionDisplaySettings(): ActionDisplaySettings {
  const [settings, setSettings] = useState<ActionDisplaySettings>(cached ?? DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    fetchSettings().then((result) => {
      if (!cancelled) setSettings(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return settings;
}

/** Called by the admin toggle right after a successful PATCH, so every already-mounted RowAction picks up the new value immediately instead of waiting for a page reload. */
export function invalidateActionDisplayCache(next?: ActionDisplaySettings) {
  cached = next ?? null;
}
