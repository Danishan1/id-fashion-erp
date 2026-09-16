"use client";

import { Button } from "@/components/ui/Button";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Set to true to allow an outside click to dismiss the dialog — defaults to false, matching Modal.tsx's own default. */
  closeOnBackdropClick?: boolean;
}

/** Shared confirmation dialog — use for any destructive or state-changing action (deactivate, delete, cancel, etc). */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  isDangerous = false,
  isBusy = false,
  onConfirm,
  onCancel,
  closeOnBackdropClick = false,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={closeOnBackdropClick ? onCancel : undefined}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-5 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-modal-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{message}</p>

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="secondary" onClick={onCancel} disabled={isBusy}>
            {cancelLabel}
          </Button>
          <Button variant={isDangerous ? "danger" : "primary"} onClick={onConfirm} isLoading={isBusy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
