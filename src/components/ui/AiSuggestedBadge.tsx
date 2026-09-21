/**
 * Marks any value/content that came from an AI suggestion rather than a
 * manual user choice — the "clear indication this is AI-generated"
 * convention requested for AI Designer's Product Suggestions feature.
 * Deliberately shared (not module-duplicated) since it's a plain, generic
 * provenance tag with no confidence tiers of its own — unlike
 * ConfidenceBadge (AI Garment Flow's own 3-tier confidence pill), which
 * this intentionally does not reuse or extend, since "AI suggested this"
 * and "how confident is the AI" are two different, non-overlapping ideas.
 * Same visual discipline as ConfidenceBadge: symbol + text label together,
 * never color alone.
 */
export function AiSuggestedBadge({ label = "AI Suggested", className = "" }: { label?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-500/10 dark:text-indigo-300 ${className}`}
    >
      <span aria-hidden="true">✨</span>
      {label}
    </span>
  );
}
