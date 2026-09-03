"use client";

import { useEffect, useState } from "react";
import type { SubmoduleKey } from "@/config/submodule-registry";

type VisibilityMap = Partial<Record<SubmoduleKey, { isVisible: boolean; isLocked: boolean }>>;

/**
 * Reads the per-company submodule visibility map (see
 * SubmoduleVisibilityService) and returns an `isVisible(key)` check for
 * consumer forms to conditionally render a field/tab.
 *
 * Fails open by design: an unknown key, or the map while still loading or
 * on a failed fetch, defaults to visible. This is a deliberate choice, not
 * an oversight -- visibility here is a UI decluttering feature, not a
 * server-enforced business rule (none of the write endpoints that use
 * these fields validate against it), so a slow/failed request briefly
 * showing a field a company chose to hide is a cosmetic miss, not a
 * correctness bug.
 */
export function useSubmoduleVisibility() {
  const [map, setMap] = useState<VisibilityMap>({});

  useEffect(() => {
    fetch("/api/v1/submodule-visibility")
      .then((res) => res.json())
      .then((body) => setMap(body.data ?? {}))
      .catch(() => {});
  }, []);

  return (key: SubmoduleKey) => map[key]?.isVisible ?? true;
}
