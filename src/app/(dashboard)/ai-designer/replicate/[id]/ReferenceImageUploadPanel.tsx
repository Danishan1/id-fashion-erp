"use client";

import { imageUrl, parseJson } from "./shared";

const SLOTS: { slot: "FRONT" | "BACK" | "SIDE" | "DETAIL"; label: string; required?: boolean }[] = [
  { slot: "FRONT", label: "Front (required for analysis)", required: true },
  { slot: "BACK", label: "Back" },
  { slot: "SIDE", label: "Side" },
  { slot: "DETAIL", label: "Detail (close-up)" },
];

interface Props {
  projectId: string;
  project: {
    referenceFrontImageAttachmentId: string | null;
    referenceBackImageAttachmentId: string | null;
    referenceSideImageAttachmentId: string | null;
    referenceDetailImageAttachmentId: string | null;
  };
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}

export function ReferenceImageUploadPanel({ projectId, project, busy, run }: Props) {
  const attachmentIdBySlot: Record<string, string | null> = {
    FRONT: project.referenceFrontImageAttachmentId,
    BACK: project.referenceBackImageAttachmentId,
    SIDE: project.referenceSideImageAttachmentId,
    DETAIL: project.referenceDetailImageAttachmentId,
  };
  const upload = (slot: string, file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("slot", slot);
    return run(`upload-${slot}`, () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/reference-images`, { method: "POST", body: formData }).then(parseJson)
    );
  };

  const remove = (attachmentId: string, slot: string) =>
    run(`delete-${slot}`, () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/reference-images/${attachmentId}`, { method: "DELETE" }).then(parseJson)
    );

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Upload photos of the existing garment you want to replicate. Only the Front photo is analyzed for
        Design DNA — Back/Side/Detail are optional extra context for whoever reviews the project later.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {SLOTS.map(({ slot, label, required }) => {
          const attachmentId = attachmentIdBySlot[slot];
          const key = `upload-${slot}`;
          return (
            <div key={slot} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                {label}
                {required && <span className="text-red-500"> *</span>}
              </p>
              {attachmentId ? (
                <div className="mt-2 space-y-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(attachmentId)} alt={label} className="h-32 w-full rounded border object-cover" />
                  <button
                    type="button"
                    disabled={busy === `delete-${slot}`}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    onClick={() => remove(attachmentId, slot)}
                  >
                    {busy === `delete-${slot}` ? "Removing…" : "Remove"}
                  </button>
                </div>
              ) : (
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy === key}
                  className="mt-2 block w-full text-xs"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload(slot, file);
                    e.target.value = "";
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
