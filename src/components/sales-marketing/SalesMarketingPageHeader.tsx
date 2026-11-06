import type { ReactNode } from "react";
import type { BreadcrumbItem } from "@/components/ui/Breadcrumb";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Standard header for every Sales & Marketing page. The breadcrumb is always
 * rooted at "Sales & Marketing"; pass only the crumbs after it. On the module
 * dashboard itself (no crumbs) the root is the current page.
 */
export function SalesMarketingPageHeader({
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
  return (
    <PageHeader
      title={title}
      description={description}
      breadcrumbs={[{ label: "Sales & Marketing", href: "/sales-marketing" }, ...breadcrumbs]}
      actions={actions}
    />
  );
}
