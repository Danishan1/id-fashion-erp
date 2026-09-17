"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import {
  ICON_BUTTON_CLASS,
  ICON_BUTTON_DANGER_CLASS,
  ICON_BUTTON_SUCCESS_CLASS,
} from "./icons";
import { buttonClasses } from "./Button";
import { useActionDisplaySettings } from "@/lib/use-action-display";

export type RowActionVariant = "default" | "danger" | "success";

interface RowActionProps {
  /** The icon to show in ICON mode — ignored in TEXT mode. */
  icon: ReactNode;
  /** The name shown as a tooltip in ICON mode, or as the visible label in TEXT mode. */
  label: string;
  /** Navigates when set; otherwise renders a <button> and calls onClick. */
  href?: string;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  variant?: RowActionVariant;
  /** Row actions usually live inside a clickable table row — stop the click from also triggering the row's own navigation. Defaults to true. */
  stopPropagation?: boolean;
  className?: string;
}

const TEXT_LINK_CLASS: Record<RowActionVariant, string> = {
  default: "font-medium text-indigo-600 hover:text-indigo-500",
  danger: "font-medium text-red-600 hover:text-red-500",
  success: "font-medium text-emerald-600 hover:text-emerald-500",
};

const ICON_CLASS: Record<RowActionVariant, string> = {
  default: ICON_BUTTON_CLASS,
  danger: ICON_BUTTON_DANGER_CLASS,
  success: ICON_BUTTON_SUCCESS_CLASS,
};

const TEXT_BUTTON_VARIANT: Record<RowActionVariant, "secondary" | "danger" | "success"> = {
  default: "secondary",
  danger: "danger",
  success: "success",
};

/**
 * The one shared building block for every row-level action (Edit/View/BOM/
 * Remove/Approve/...) across the whole app — reads the company's own
 * Action Display setting (see AdminCompanySettingsPanel's "Action Display"
 * section) and renders itself as an icon-only button (the default), a
 * plain text link, or a bordered text button, so a company can switch the
 * whole app's row-action style in one place without any list page itself
 * needing to change. Callers never branch on the setting themselves — they
 * just supply an icon + a label and this component decides how to show it.
 */
export function RowAction({
  icon,
  label,
  href,
  onClick,
  disabled,
  variant = "default",
  stopPropagation = true,
  className = "",
}: RowActionProps) {
  const { displayMode, textStyle } = useActionDisplaySettings();

  function handleClick(e: MouseEvent) {
    if (stopPropagation) e.stopPropagation();
    onClick?.(e);
  }

  if (displayMode === "ICON") {
    const iconClass = `${ICON_CLASS[variant]}${disabled ? " opacity-50" : ""} ${className}`;
    if (href && !disabled) {
      return (
        <Link href={href} title={label} aria-label={label} className={iconClass} onClick={handleClick}>
          {icon}
        </Link>
      );
    }
    return (
      <button type="button" title={label} aria-label={label} onClick={handleClick} disabled={disabled} className={iconClass}>
        {icon}
      </button>
    );
  }

  const textClass =
    textStyle === "BUTTON"
      ? `${buttonClasses(TEXT_BUTTON_VARIANT[variant], "xs")} ${className}`
      : `${TEXT_LINK_CLASS[variant]} ${className}`;

  if (href && !disabled) {
    return (
      <Link href={href} className={textClass} onClick={handleClick}>
        {label}
      </Link>
    );
  }
  return (
    <button type="button" onClick={handleClick} disabled={disabled} className={`${textClass} disabled:opacity-50`}>
      {label}
    </button>
  );
}
