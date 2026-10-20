import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  children: ReactNode;
}

export function FormField({ label, htmlFor, required, error, children }: FormFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <div className="mt-1">{children}</div>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

const baseInputClass =
  "block w-full rounded-md border border-zinc-300 px-3 py-2 text-input sm:text-body shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";

export function textInputClass(hasError?: boolean) {
  return `${baseInputClass} ${hasError ? "border-red-400 dark:border-red-500" : ""}`;
}
