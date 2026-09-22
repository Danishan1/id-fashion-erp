"use client";

import { TARGET_CUSTOMER_LABELS, type TargetCustomer } from "@/core/ai-designer/catalogs/customer-catalog";
import { getEnvironmentByKey } from "@/core/ai-designer/catalogs/environment-catalog";
import { AiSuggestedBadge } from "@/components/ui/AiSuggestedBadge";
import { GeneratedImageGrid, type AiDesignerImageRow } from "./GeneratedImageGrid";

interface SuggestionItem {
  productCategory: string;
  priorityRank: number;
  ageGroup: string;
  environmentKey: string;
  reasoning: string;
}

interface SuggestionGroup {
  targetCustomer: TargetCustomer;
  items: SuggestionItem[];
}

export interface ProductSuggestionsData {
  groups: SuggestionGroup[];
  overallSummary: string;
}

interface Props {
  hasFabric: boolean;
  suggestions: ProductSuggestionsData | null;
  busy: string | null;
  /**
   * Per-card generation failure, keyed by the same `apply-suggestion-${groupIndex}-${itemIndex}`
   * string as `busy` — shown directly on the card that failed (e.g. "every
   * image-generation provider is currently down") instead of leaving the
   * user unsure whether the click did anything at all.
   */
  errors: Record<string, string>;
  /** Images generated from a suggestion click, filtered by the parent to just `fromSuggestion` ones — shown inline on this same step so the user never has to navigate to Generate Design to see (or select) them. */
  generatedImages: AiDesignerImageRow[];
  onRun: () => void;
  onApply: (groupIndex: number, itemIndex: number) => void;
  onSelectImage: (imageId: string) => void;
  onRejectImage: (imageId: string) => void;
  /** Marks this step complete with no AI call and moves on — same destination as the step's own Next button, just with a visible, deliberate "I'm choosing to skip this" action and a checkmark to show for it, instead of the step staying permanently unchecked after a silent Next click. */
  onSkip: () => void;
}

/**
 * Step 2b — AI Product Suggestions. Every suggestion here is the AI's own
 * text, never something the user typed — the "AI-Generated Suggestions"
 * badge at the top and the per-item priority/reasoning are always visible
 * together, per the explicit "clear indication this is AI-generated"
 * request. Clicking a suggested item calls onApply(), which the parent
 * wires to a single request that both auto-fills Target Customer/Age
 * Group/Product Category/Environment AND generates 3 designs immediately.
 */
export function ProductSuggestionsPanel({
  hasFabric,
  suggestions,
  busy,
  errors,
  generatedImages,
  onRun,
  onApply,
  onSelectImage,
  onRejectImage,
  onSkip,
}: Props) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        AI reviews the fabric&apos;s own analyzed characteristics and suggests which specific garments are
        worth producing from it, per customer segment (Men/Women/Boys/Girls/Baby), ranked by commercial
        priority. This is entirely optional — you can always skip straight to picking Target Customer/Age
        Group/Product Category manually below instead.
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy === "run-suggestions" || !hasFabric}
          onClick={onRun}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          title={!hasFabric ? "Analyze the fabric first (Step 2)." : undefined}
        >
          {busy === "run-suggestions" ? "Thinking…" : suggestions ? "Re-run Product Suggestions" : "Suggest Products With AI"}
        </button>
        <button
          type="button"
          disabled={busy === "skip-suggestions"}
          onClick={onSkip}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900/40"
        >
          {busy === "skip-suggestions" ? "Skipping…" : "Skip this step →"}
        </button>
      </div>
      {!hasFabric && <p className="text-sm text-amber-700 dark:text-amber-400">Analyze the fabric first (Step 2).</p>}

      {suggestions && (
        <div className="space-y-4">
          <div className="flex items-start gap-2">
            <AiSuggestedBadge label="AI-Generated Suggestions" />
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{suggestions.overallSummary}</p>
          </div>

          {suggestions.groups.map((group, groupIndex) => (
            <div key={group.targetCustomer} className="space-y-2">
              <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{TARGET_CUSTOMER_LABELS[group.targetCustomer]}</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.items
                  .slice()
                  .sort((a, b) => a.priorityRank - b.priorityRank)
                  .map((item) => {
                    const itemIndex = group.items.indexOf(item);
                    const env = getEnvironmentByKey(item.environmentKey);
                    const busyKey = `apply-suggestion-${groupIndex}-${itemIndex}`;
                    const cardError = errors[busyKey];
                    return (
                      <button
                        key={`${item.productCategory}-${item.priorityRank}`}
                        type="button"
                        disabled={busy === busyKey}
                        onClick={() => onApply(groupIndex, itemIndex)}
                        className={`rounded-md border p-3 text-left text-sm hover:bg-indigo-50/50 disabled:opacity-50 dark:hover:bg-indigo-500/5 ${
                          cardError
                            ? "border-red-300 dark:border-red-800"
                            : "border-zinc-200 hover:border-indigo-400 dark:border-zinc-800"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-zinc-800 dark:text-zinc-200">{item.productCategory}</span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            Priority {item.priorityRank}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-500">
                          {item.ageGroup} · {env?.label ?? item.environmentKey}
                        </p>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{item.reasoning}</p>
                        {cardError ? (
                          <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
                            ⚠ {cardError} Click to try again →
                          </p>
                        ) : (
                          <p className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                            {busy === busyKey ? "Generating 3 designs…" : "Click to generate 3 sample designs →"}
                          </p>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}

          {generatedImages.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Generated Designs</h4>
              <p className="text-xs text-zinc-500">
                Select the one you want to continue with — it becomes the design every later step (Multi-Fabric,
                Embellishments, Branding, Tech Pack, …) works on.
              </p>
              <GeneratedImageGrid images={generatedImages} onSelect={onSelectImage} onReject={onRejectImage} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
