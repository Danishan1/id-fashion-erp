"use client";

import { useRef, useState } from "react";
import { DesignOptionImage } from "@/core/ai-designer/catalogs/design-icon-catalog";

async function parseJson(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? "Request failed.");
  return body;
}

/**
 * One option value's photo-override thumbnail + Upload/Replace/Reset —
 * shared between the Reference Photos tab (OptionReferenceImagesPanel) and
 * the Product Design Add/Edit Attribute modal (ProductDesignAttributesPanel),
 * so an admin typing brand-new option values doesn't have to leave the
 * modal and go hunt for them in the Reference Photos tab afterward. Reuses
 * the same reference-images endpoint either way — the override is keyed by
 * the option's own VALUE string, independent of which attribute it's typed
 * under.
 */
export function OptionPhotoUploadControl({
  optionValue,
  attachmentId,
  onChanged,
  variant = "PHOTO",
}: {
  optionValue: string;
  attachmentId: string | null;
  onChanged: () => void;
  /** CAD_FLAT = a construction-option sketch (Construction Flats panel). */
  variant?: "PHOTO" | "CAD_FLAT";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("optionValue", optionValue);
      formData.append("file", file);
      formData.append("variant", variant);
      await parseJson(await fetch("/api/v1/ai-designer/product-design-attributes/reference-images", { method: "POST", body: formData }));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await parseJson(
        await fetch("/api/v1/ai-designer/product-design-attributes/reference-images", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ optionValue, variant }),
        })
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-zinc-200 p-2 text-center dark:border-zinc-800">
      <DesignOptionImage
        value={optionValue}
        overrideAttachmentId={attachmentId}
        variant={variant}
        className={variant === "CAD_FLAT" ? "h-16 w-16 rounded bg-white object-contain sm:h-20 sm:w-20" : undefined}
      />
      <p className="max-w-[6rem] truncate text-xs font-medium leading-tight text-zinc-900 dark:text-zinc-100" title={optionValue}>
        {optionValue}
      </p>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50"
        >
          {busy ? "…" : attachmentId ? "Replace" : "Upload"}
        </button>
        {attachmentId && (
          <button type="button" disabled={busy} onClick={reset} className="text-xs font-medium text-zinc-500 hover:underline disabled:opacity-50">
            Reset
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
