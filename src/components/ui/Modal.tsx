"use client";

import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Tailwind max-width class for the dialog card — wider forms (e.g. a multi-field add-row) can pass "max-w-lg"/"max-w-xl". */
  maxWidthClass?: string;
}

/**
 * Generic reusable dialog for small, focused form content — Add/Edit
 * Material, Add/Edit Other Charge, posting a Comment, uploading an
 * Attachment, recording an Approval/Rejection decision, and similar
 * "small configuration action" CRUD. Same visual language as ConfirmModal
 * (backdrop, centered card, border/shadow) generalized to arbitrary
 * children instead of a fixed confirm/cancel button pair, plus
 * FilePreviewModal's Escape-to-close behavior.
 *
 * Keep full pages/tabs for anything bigger than a small focused action
 * (record creation, the detailed workflow panel, a costing/timeline
 * overview) — don't reach for this component there.
 */
export function Modal({ open, onClose, title, children, maxWidthClass = "max-w-md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidthClass} max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-5 shadow-lg dark:border-zinc-800 dark:bg-zinc-900`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="modal-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-lg leading-none text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
