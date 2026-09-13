"use client";

import { useEffect, useState } from "react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { imageUrl, parseJson } from "./shared";

interface ImageRow {
  id: string;
  generationId: string;
  imageAttachmentId: string;
  decision: "PENDING" | "SELECTED" | "REJECTED";
  createdAt: string;
}

interface VersionRow {
  versionNumber: number;
  changeSummary: string | null;
  currentImage: ImageRow;
}

interface CompatibilityCheck {
  overallRating: string | null;
}

interface Props {
  projectId: string;
  readyToGenerate: boolean;
  missingReasons: string[];
  compatibilityCheck: CompatibilityCheck | null;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}

const IMAGE_COUNTS = [1, 3, 4] as const;

export function GenerateResultPanel({ projectId, readyToGenerate, missingReasons, compatibilityCheck, busy, run }: Props) {
  const [imageCount, setImageCount] = useState<1 | 3 | 4>(1);
  const [images, setImages] = useState<ImageRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [confirmingGenerate, setConfirmingGenerate] = useState(false);
  const [confirmingSelect, setConfirmingSelect] = useState<string | null>(null);

  const reloadImages = () =>
    fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/images`)
      .then((r) => r.json())
      .then((body) => setImages(body.data ?? []))
      .catch(() => {});

  const reloadVersions = () =>
    fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/versions`)
      .then((r) => r.json())
      .then((body) => setVersions(body.data ?? []))
      .catch(() => {});

  useEffect(() => {
    reloadImages();
    reloadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const needsAcknowledgement = !!compatibilityCheck && compatibilityCheck.overallRating !== "COMPATIBLE";

  const doGenerate = (acknowledgeCompatibilityWarning?: boolean) =>
    run("generate", () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageCount, acknowledgeCompatibilityWarning }),
      }).then(parseJson)
    ).then(() => {
      reloadImages();
      reloadVersions();
    });

  const handleGenerateClick = () => {
    if (needsAcknowledgement) {
      setConfirmingGenerate(true);
      return;
    }
    doGenerate();
  };

  const decide = (imageId: string, decision: "SELECT" | "REJECT", confirmed?: boolean) =>
    run(`decide-${imageId}`, () =>
      fetch(`/api/v1/ai-designer/replicate-projects/${projectId}/images/${imageId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, confirmed }),
      }).then(parseJson)
    ).then(() => reloadImages());

  return (
    <div className="space-y-4">
      {!readyToGenerate && missingReasons.length > 0 && (
        <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Complete the following before generating: {missingReasons.join(", ")}.
        </p>
      )}

      <div className="flex items-center gap-3">
        <label className="text-xs font-medium text-zinc-500">Number of images</label>
        <select value={imageCount} onChange={(e) => setImageCount(Number(e.target.value) as 1 | 3 | 4)} className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {IMAGE_COUNTS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy === "generate" || !readyToGenerate}
          onClick={handleGenerateClick}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy === "generate" ? "Generating…" : "Generate Design"}
        </button>
      </div>

      {images.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {images.map((img) => (
            <div key={img.id} className="space-y-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(img.imageAttachmentId)} alt="Generated design" className="h-48 w-full rounded object-cover" />
              <div className="flex items-center justify-between text-xs">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    img.decision === "SELECTED"
                      ? "bg-green-100 text-green-800 dark:bg-green-500/10 dark:text-green-300"
                      : img.decision === "REJECTED"
                        ? "bg-red-100 text-red-800 dark:bg-red-500/10 dark:text-red-300"
                        : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  {img.decision}
                </span>
                {img.decision === "PENDING" && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setConfirmingSelect(img.id)} className="text-indigo-600 hover:underline dark:text-indigo-400">
                      Select
                    </button>
                    <button type="button" onClick={() => decide(img.id, "REJECT")} className="text-red-600 hover:underline">
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {versions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Version History</h3>
          <ul className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
            {versions.map((v) => (
              <li key={v.versionNumber}>
                v{v.versionNumber} — {v.changeSummary ?? "No summary"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmModal
        open={confirmingGenerate}
        title="Compatibility Concern Flagged"
        message={`The compatibility check flagged concerns (${compatibilityCheck?.overallRating}). Continue generating anyway?`}
        confirmLabel="Continue Anyway"
        isDangerous
        onConfirm={() => {
          setConfirmingGenerate(false);
          doGenerate(true);
        }}
        onCancel={() => setConfirmingGenerate(false)}
      />

      <ConfirmModal
        open={!!confirmingSelect}
        title="Select This Design"
        message="Select this generated image as the final replicated design visual?"
        confirmLabel="Select"
        onConfirm={() => {
          const id = confirmingSelect!;
          setConfirmingSelect(null);
          decide(id, "SELECT", true);
        }}
        onCancel={() => setConfirmingSelect(null)}
      />
    </div>
  );
}
