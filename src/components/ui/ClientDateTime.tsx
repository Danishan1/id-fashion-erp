import { formatDate, formatDateTime } from "@/lib/date-format";

/**
 * Renders a Date/ISO string using the app's pinned-locale/timezone
 * formatters (see `@/lib/date-format`), so a Server Component (or a Client
 * Component rendering server-passed data on first render) never disagrees
 * with its own client-side hydration pass. `suppressHydrationWarning` is
 * kept as a defensive backstop only — the real fix is that `formatDate`/
 * `formatDateTime` are deterministic regardless of the running process's
 * own locale/timezone, so there should be nothing left to suppress.
 */
export function ClientDateTime({ value, mode = "datetime" }: { value: string | Date; mode?: "date" | "datetime" }) {
  const text = mode === "date" ? formatDate(value) : formatDateTime(value);
  return <span suppressHydrationWarning>{text}</span>;
}
