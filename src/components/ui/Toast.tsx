"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * The one global, top-right toast system for the whole app.
 *
 * - `toast.success/error/warning/info(message)` works from anywhere on the
 *   client (components, helpers, event handlers) — it is a module-level store,
 *   not a React context, so a caller never needs a hook or provider handle.
 * - `<ToastViewport />` (mounted once in `Providers`) renders the stack and
 *   also installs the `/api/v1` fetch interceptor (`installApiToastInterceptor`
 *   in `@/lib/api-client`), so every module's existing mutation calls get
 *   consistent success/error toasts without per-module code.
 *
 * Do not build per-module alert/banner implementations — call `toast.*`.
 */

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
  durationMs: number;
}

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  info: 4000,
  warning: 6000,
  error: 7000,
};
const MAX_VISIBLE = 5;
/** Identical messages fired within this window collapse into one toast. */
const DEDUPE_WINDOW_MS = 1500;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const recent = new Map<string, number>();
const EMPTY: ToastItem[] = [];

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return toasts;
}

function getServerSnapshot() {
  return EMPTY;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(type: ToastType, message: string, opts?: { title?: string; durationMs?: number }): number | null {
  const text = (message ?? "").trim();
  if (!text) return null;
  const key = `${type}:${text}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return null;
  recent.set(key, now);

  const id = nextId++;
  const item: ToastItem = {
    id,
    type,
    title: opts?.title,
    message: text,
    durationMs: opts?.durationMs ?? DEFAULT_DURATION[type],
  };
  toasts = [...toasts, item].slice(-MAX_VISIBLE);
  emit();
  return id;
}

export const toast = {
  success: (message: string, opts?: { title?: string; durationMs?: number }) => push("success", message, opts),
  error: (message: string, opts?: { title?: string; durationMs?: number }) => push("error", message, opts),
  warning: (message: string, opts?: { title?: string; durationMs?: number }) => push("warning", message, opts),
  info: (message: string, opts?: { title?: string; durationMs?: number }) => push("info", message, opts),
  dismiss: dismissToast,
};

const STYLES: Record<ToastType, { box: string; icon: string; label: string }> = {
  success: {
    box: "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100",
    icon: "✓",
    label: "Success",
  },
  error: {
    box: "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
    icon: "✕",
    label: "Error",
  },
  warning: {
    box: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
    icon: "!",
    label: "Warning",
  },
  info: {
    box: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
    icon: "i",
    label: "Info",
  },
};

function ToastCard({ item }: { item: ToastItem }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(item.id), item.durationMs);
    return () => window.clearTimeout(timer);
  }, [item.id, item.durationMs]);

  const style = STYLES[item.type];
  return (
    <div
      role={item.type === "error" || item.type === "warning" ? "alert" : "status"}
      className={`pointer-events-auto flex w-full items-start gap-3 rounded-lg border p-3 shadow-lg ${style.box}`}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold"
      >
        {style.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{item.title ?? style.label}</p>
        <p className="mt-0.5 whitespace-pre-line break-words text-sm">{item.message}</p>
      </div>
      <button
        type="button"
        onClick={() => dismissToast(item.id)}
        aria-label="Dismiss notification"
        className="shrink-0 text-base leading-none opacity-60 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastViewport() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
    >
      {items.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}
