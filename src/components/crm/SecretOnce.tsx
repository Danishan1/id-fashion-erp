"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

/** Copies text to the clipboard; resolves false (never throws) when the browser refuses. */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A secret shown once (Phase 22): the plaintext exists only in the create /
 * rotate response held in the caller's state — it is never re-fetched, stored
 * in the browser or logged. The copy button reports what really happened (no
 * "Copied" when the clipboard refused), and with `onDone` the reveal can only
 * be dismissed after the user confirms they've stored the secret; leaving the
 * page before that asks for confirmation.
 */
export function SecretOnce({ label, value, onDone, doneLabel = "Done", children }: { label: string; value: string; onDone?: () => void; doneLabel?: string; children?: React.ReactNode }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [stored, setStored] = useState(false);
  const valueRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!onDone || stored) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [onDone, stored]);
  const doCopy = async () => {
    const ok = await copyText(value);
    setCopy(ok ? "copied" : "failed");
    const el = valueRef.current;
    const sel = window.getSelection();
    if (!ok && el && sel) {
      // Select the text so it can be copied by hand.
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };
  return (
    <div className="space-y-3" data-testid="secret-once">
      <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{label} — copy it now. It won&apos;t be shown again; if it&apos;s lost, rotate it to get a new one.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <code ref={valueRef} className="block flex-1 select-all break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
            {value}
          </code>
          <Button variant="secondary" onClick={doCopy}>
            {copy === "copied" ? "Copied" : "Copy"}
          </Button>
        </div>
        <p role="status" aria-live="polite" className="text-xs text-amber-900 dark:text-amber-100">
          {copy === "failed" ? "Your browser blocked copying. The text is selected — press Ctrl+C (⌘C on Mac) to copy it." : copy === "copied" ? "Copied to the clipboard." : ""}
        </p>
      </div>
      {children}
      {onDone && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} />I have stored this secret somewhere safe
          </label>
          <Button variant="secondary" disabled={!stored} onClick={onDone}>
            {doneLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A copy button that reports the real outcome (Phase 22: no false "Copied"). */
export function CopyButton({ value, label = "Copy", size = "xs" }: { value: string; label?: string; size?: "xs" | "sm" }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2500);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <Button variant="secondary" size={size} onClick={async () => setState((await copyText(value)) ? "copied" : "failed")} aria-live="polite">
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed — select and copy manually" : label}
    </Button>
  );
}

/** A code sample with a working copy button. Never pass a stored secret here — only placeholders or a just-created one. */
export function CopyableCode({ code, title }: { code: string; title?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        {title ? <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{title}</p> : <span />}
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 text-xs leading-relaxed text-zinc-100">{code}</pre>
    </div>
  );
}
