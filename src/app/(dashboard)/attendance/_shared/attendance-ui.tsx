"use client";

import type { ReactNode } from "react";

export const WEEKDAY_OPTIONS = [
  { value: "MONDAY", short: "Mon" },
  { value: "TUESDAY", short: "Tue" },
  { value: "WEDNESDAY", short: "Wed" },
  { value: "THURSDAY", short: "Thu" },
  { value: "FRIDAY", short: "Fri" },
  { value: "SATURDAY", short: "Sat" },
  { value: "SUNDAY", short: "Sun" },
] as const;

export function weekdayShort(v: string): string {
  return WEEKDAY_OPTIONS.find((w) => w.value === v)?.short ?? v;
}

/** Fetch JSON from our API; throws the API's own message on failure. */
export async function apiJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? `Request failed (${res.status}).`);
  return (body?.data ?? body) as T;
}

export function WeekdayPicker({ value, onChange, disabled }: { value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAY_OPTIONS.map((d) => {
        const on = value.includes(d.value);
        return (
          <button
            key={d.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((v) => v !== d.value) : [...value, d.value])}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              on
                ? "border-indigo-600 bg-indigo-600 text-white"
                : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
            value === t.id
              ? "border-indigo-600 text-indigo-600 dark:text-indigo-400"
              : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const STATUS_TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300",
  red: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  purple: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950 dark:text-violet-300",
  zinc: "bg-zinc-100 text-zinc-700 ring-zinc-500/20 dark:bg-zinc-800 dark:text-zinc-300",
};

export function Pill({ tone = "zinc", children }: { tone?: keyof typeof STATUS_TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_TONES[tone]}`}>{children}</span>;
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{message}</p>;
}

const IST = "Asia/Kolkata";
export function fmtTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleTimeString("en-IN", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: true });
}
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-IN", { timeZone: IST, day: "2-digit", month: "short", year: "numeric" });
}
/** For `@db.Date` values (UTC midnight) — format without a zone shift. */
export function fmtDbDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-IN", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}
export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-IN", { timeZone: IST, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}
export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return "—";
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}
/** Today's IST date key in the browser. */
export function todayIst(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
