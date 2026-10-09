import Link from "next/link";
import type { ReactNode } from "react";
import { ClientDateTime } from "@/components/ui/ClientDateTime";

export type CrmActivityTone = "neutral" | "indigo" | "green" | "amber" | "red";

const DOT_CLASSES: Record<CrmActivityTone, string> = {
  neutral: "bg-zinc-400",
  indigo: "bg-indigo-500",
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

/**
 * One entry in a CRM timeline or activity list. Deliberately generic (title,
 * who, when, optional detail) so the same row renders system events today and
 * calls, notes, tasks and messages in later phases.
 */
export function CrmActivityItem({
  title,
  occurredAt,
  actorName,
  description,
  context,
  contextHref,
  tone = "neutral",
  children,
}: {
  title: string;
  occurredAt: string | Date;
  actorName?: string | null;
  description?: string | null;
  /** e.g. "Lead" — the record this happened to (shown on company-wide feeds). */
  context?: string;
  contextHref?: string | null;
  tone?: CrmActivityTone;
  children?: ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_CLASSES[tone]}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
          {context &&
            (contextHref ? (
              <Link href={contextHref} className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
                {context}
              </Link>
            ) : (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{context}</span>
            ))}
        </div>
        {description && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">{description}</p>}
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          <ClientDateTime value={occurredAt} />
          {actorName ? ` · ${actorName}` : ""}
        </p>
        {children}
      </div>
    </li>
  );
}
