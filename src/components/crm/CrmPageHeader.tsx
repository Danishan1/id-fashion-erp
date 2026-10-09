import type { ReactNode } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/Breadcrumb";

/**
 * Standard header for every CRM page: breadcrumb (always rooted at "CRM"),
 * title, optional one-line description and right-aligned actions.
 * Pass only the crumbs after "CRM"; the current page is the last crumb.
 */
export function CrmPageHeader({
  title,
  description,
  breadcrumbs = [],
  actions,
}: {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
}) {
  const items: BreadcrumbItem[] = [{ label: "CRM", href: "/crm" }, ...breadcrumbs];
  return (
    <div className="space-y-2">
      <Breadcrumb items={items} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">{title}</h1>
          {description && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
