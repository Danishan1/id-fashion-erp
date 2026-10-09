export type CrmBadgeTone = "neutral" | "indigo" | "green" | "amber" | "red";

const TONE_CLASSES: Record<CrmBadgeTone, string> = {
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  indigo: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
  green: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300",
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  red: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

/** Small status/label pill. Text always carries the meaning; colour only supports it. */
export function CrmBadge({ label, tone = "neutral" }: { label: string; tone?: CrmBadgeTone }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}>{label}</span>;
}
