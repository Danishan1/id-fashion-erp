"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Right-hand slide-over for viewing (and later quick-editing) a CRM record
 * without leaving the list. Same behaviour rules as Modal: Escape and the ✕
 * button close it; an outside click does not by default (UI_RULES §3), so
 * typed input is never lost by accident.
 */
export function CrmDrawer({
  open,
  onClose,
  title,
  children,
  footer,
  widthClass = "max-w-xl",
  closeOnBackdropClick = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  widthClass?: string;
  closeOnBackdropClick?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={closeOnBackdropClick ? onClose : undefined}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-drawer-title"
        onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-full ${widthClass} flex-col border-l border-zinc-200 bg-white shadow-xl outline-none dark:border-zinc-800 dark:bg-zinc-900`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 id="crm-drawer-title" className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{footer}</div>}
      </div>
    </div>
  );
}
