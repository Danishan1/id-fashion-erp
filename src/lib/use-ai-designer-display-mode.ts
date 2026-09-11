"use client";

import { useEffect, useState } from "react";

export type AiDesignerAttributeDisplayMode = "CLIPART" | "TEXT";

/**
 * Reads the company's admin-controlled AI Designer display-mode setting
 * (see ai-designer-settings.service.ts) — whether the Product Design step's
 * attribute pickers show clipart icons or plain text buttons.
 *
 * Fails open to "CLIPART" (the original, pre-setting behavior) while
 * loading or on a failed fetch, matching useSubmoduleVisibility's own
 * "fail open, this is a display preference not a server-enforced rule"
 * convention.
 */
export function useAiDesignerDisplayMode(): AiDesignerAttributeDisplayMode {
  const [mode, setMode] = useState<AiDesignerAttributeDisplayMode>("CLIPART");

  useEffect(() => {
    fetch("/api/v1/ai-designer/settings")
      .then((res) => res.json())
      .then((body) => {
        if (body?.data?.productDesignDisplayMode === "TEXT") setMode("TEXT");
      })
      .catch(() => {});
  }, []);

  return mode;
}
