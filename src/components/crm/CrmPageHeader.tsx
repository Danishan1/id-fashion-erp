import type { ReactNode } from "react";
import type { BreadcrumbItem } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";

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
  return <PageHeader title={title} description={description} breadcrumbs={[{ label: "CRM", href: "/crm" }, ...breadcrumbs]} actions={actions} />;
}
