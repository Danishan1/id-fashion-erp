"use client";

import { AiSuggestedBadge } from "@/components/ui/AiSuggestedBadge";

export interface AiDesignerImageRow {
  id: string;
  generationId: string;
  imageAttachmentId: string;
  decision: "PENDING" | "SELECTED" | "REJECTED";
  createdAt: string;
  /** Set only on the response of the "click a suggested product" action — never persisted, never re-derived on reload. */
  fromSuggestion?: boolean;
  /**
   * The exact Target Customer/Age Group/Product Category/Environment that
   * this specific image was generated from — set alongside `fromSuggestion`,
   * same "never persisted" lifetime. Needed because generating from a SECOND
   * suggestion overwrites the project's own current wizard selections, so an
   * older image's own originating context would otherwise be lost by the
   * time the user comes back and Selects it. On Select, the parent re-applies
   * this exact context so the selected image and the wizard's own
   * Target Customer/Age Group/Product Category always agree.
   */
  suggestionContext?: {
    targetCustomer: string;
    ageGroup: string;
    productCategory: string;
    environmentKey: string;
  };
}

export function imageUrl(attachmentId: string) {
  return `/api/v1/ai-designer/attachments/${attachmentId}/download?disposition=inline`;
}

interface Props {
  images: AiDesignerImageRow[];
  onSelect: (imageId: string) => void;
  onReject: (imageId: string) => void;
}

/**
 * The per-image card grid (thumbnail + decision badge + Select/Reject) — was
 * originally inline only under the Generate Design step. Extracted so
 * ProductSuggestionsPanel can render the exact same gallery right on the AI
 * Product Suggestions step for images generated from a suggestion, instead
 * of the user having to navigate away to Generate Design to even see them —
 * a real, reported gap ("mujhe issi page me chahiye"). Select still goes
 * through the parent's single shared ConfirmModal (`onSelect` just sets
 * which image id is pending), so "selecting a suggestion-generated image"
 * and "selecting a Generate-Design-generated image" behave identically and
 * both correctly become `currentImage` for every later step.
 */
export function GeneratedImageGrid({ images, onSelect, onReject }: Props) {
  if (images.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {images.map((img) => (
        <div key={img.id} className="space-y-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
          {img.fromSuggestion && <AiSuggestedBadge label="Generated from AI Suggestion" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl(img.imageAttachmentId)} alt="Generated design" className="aspect-[3/4] w-full rounded object-cover" />
          <div className="flex items-center justify-between text-xs">
            <span
              className={
                img.decision === "SELECTED" ? "text-green-600" : img.decision === "REJECTED" ? "text-red-600" : "text-zinc-500"
              }
            >
              {img.decision}
            </span>
            <div className="flex gap-2">
              {img.decision !== "SELECTED" && (
                <button type="button" className="text-indigo-600 hover:underline" onClick={() => onSelect(img.id)}>
                  Select
                </button>
              )}
              {img.decision !== "REJECTED" && (
                <button type="button" className="text-red-600 hover:underline" onClick={() => onReject(img.id)}>
                  Reject
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
