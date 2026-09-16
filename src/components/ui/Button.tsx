import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "success";
export type ButtonSize = "sm" | "xs";

/**
 * The one place every button's color/size/focus-state is defined — created
 * to close audit item #6 (primary-button color drift: a shared `Button`
 * never existed, so every one of ~116 files hand-copied its own class
 * string, which is how `bg-purple-600`/`bg-emerald-600` drifted in
 * unnoticed). The four variants below aren't invented — each already exists
 * as the app's own real, dominant convention:
 *  - primary:   bg-indigo-600 — the standard action color (112 files today).
 *  - secondary: the bordered/neutral style already used for every Cancel/
 *               secondary action (ConfirmModal, SimpleLookupManager, ...).
 *  - danger:    bg-red-600 — already exclusively used for destructive
 *               confirmations (ConfirmModal's isDangerous branch).
 *  - success:   bg-emerald-600 — already an existing, internally-consistent
 *               convention for Approve-type actions across several AI
 *               Garment Flow panels and BomVersionPanel/ApprovalsClient;
 *               formalized here as a real variant rather than each of those
 *               files continuing to hand-copy the same string.
 *
 * Deliberately does NOT retrofit every existing button in the app — see the
 * Design System Consistency batch notes for which files were intentionally
 * left untouched and why.
 */
const BASE_CLASSES =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-60";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500",
  secondary:
    "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
  danger: "bg-red-600 text-white hover:bg-red-500",
  success: "bg-emerald-600 text-white hover:bg-emerald-500",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  xs: "px-2.5 py-1 text-xs",
};

/**
 * Pure class-string builder — use directly on a non-`<button>` element
 * styled to look like one (e.g. `next/link`'s `<Link>`, for a "New Record"
 * action that navigates instead of opening a modal). `<Button>` below is the
 * ordinary `<button>`-element wrapper around these same classes for every
 * other case.
 */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "sm", className = ""): string {
  return `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}${className ? ` ${className}` : ""}`;
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When true, disables the button and swaps its label for `loadingLabel` — matches this app's existing "Saving…"/"Please wait…" convention. */
  isLoading?: boolean;
  loadingLabel?: ReactNode;
  className?: string;
}

export function Button({
  variant = "primary",
  size = "sm",
  isLoading = false,
  loadingLabel = "Please wait…",
  disabled,
  type = "button",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} disabled={disabled || isLoading} className={buttonClasses(variant, size, className)} {...rest}>
      {isLoading ? loadingLabel : children}
    </button>
  );
}
