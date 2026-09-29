"use client";

import { useRef, useState, type KeyboardEvent } from "react";

/**
 * Universal scanner input (Barcode Management & Scanning System, Phase 1,
 * 2026-09-29) — a keyboard-wedge-friendly, always-focused text input. A
 * USB/Bluetooth barcode scanner types the scanned code's characters as fast
 * keystrokes and then sends Enter (occasionally Tab) — this component just
 * needs to be a normal, focused text field to receive that, no camera or
 * native SDK involved. Deliberately dumb/reusable: it only reports the raw
 * scanned string via `onScan`; resolving it against the real Barcode
 * registry is the caller's job (or pass `onResolve`, which does both).
 */

interface ResolvedBarcodeEntity {
  entityType: string;
  entityId: string;
  code: string;
  summary: Record<string, unknown>;
}

interface BarcodeScanInputProps {
  /** Fired with the raw scanned/typed string on Enter/Tab. */
  onScan?: (code: string) => void;
  /**
   * When given, this component calls the universal resolve endpoint itself
   * (GET /api/v1/barcodes/resolve/:code) and reports the outcome here instead
   * of (or in addition to) onScan — the common case for a scan-driven
   * screen that just wants "what did the user just scan," without having to
   * repeat the fetch/error-handling boilerplate at every call site.
   */
  onResolve?: (result: { ok: true; data: ResolvedBarcodeEntity } | { ok: false; message: string }) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function BarcodeScanInput({
  onScan,
  onResolve,
  placeholder = "Scan or type a barcode…",
  autoFocus = true,
  className = "",
}: BarcodeScanInputProps) {
  const [value, setValue] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function commit(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setValue("");
    onScan?.(trimmed);

    if (onResolve) {
      setIsResolving(true);
      try {
        const res = await fetch(`/api/v1/barcodes/resolve/${encodeURIComponent(trimmed)}`);
        const body = await res.json();
        if (!res.ok) {
          onResolve({ ok: false, message: body?.error?.message ?? "Could not resolve this barcode." });
        } else {
          onResolve({ ok: true, data: body.data });
        }
      } catch {
        onResolve({ ok: false, message: "Network error while resolving the scanned code." });
      } finally {
        setIsResolving(false);
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      void commit(value);
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="text"
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        // Re-focus shortly after a blur that wasn't caused by committing a
        // scan (e.g. a stray click elsewhere on the page) — a scan gun has
        // no way to "click back into" the field, so it must stay ready.
        setTimeout(() => inputRef.current?.focus(), 50);
      }}
      placeholder={isResolving ? "Resolving…" : placeholder}
      disabled={isResolving}
      className={`w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 ${className}`}
    />
  );
}
