/**
 * Sales & Marketing module map (Phase 01, 2026-10-28). Client-safe — no
 * Prisma. Lists every functional area of the module and the roadmap phase that
 * builds it, so the dashboard can show what exists and what is still planned.
 *
 * A section only gets a sidebar link and a route once its phase is built:
 * flip `status` to "AVAILABLE", set `href`, and add the leaf to
 * src/components/layout/navigation.ts in the same change.
 */

export type SalesMarketingArea = "SALES" | "MARKETING" | "ANALYTICS" | "PLATFORM";
export type SalesMarketingSectionStatus = "AVAILABLE" | "PLANNED";

export interface SalesMarketingSection {
  key: string;
  label: string;
  area: SalesMarketingArea;
  /** Roadmap phase that builds this section (docs/sales-marketing/ROADMAP). */
  phase: number;
  description: string;
  status: SalesMarketingSectionStatus;
  /** Set only when status is AVAILABLE. */
  href?: string;
}

export const SALES_MARKETING_AREAS: { key: SalesMarketingArea; label: string }[] = [
  { key: "SALES", label: "Sales Management" },
  { key: "MARKETING", label: "Marketing Management" },
  { key: "ANALYTICS", label: "Sales & Marketing Analytics" },
  { key: "PLATFORM", label: "Integrations & Settings" },
];

export const SALES_MARKETING_SECTIONS: readonly SalesMarketingSection[] = [
  { key: "enquiries", label: "Sales Enquiries", area: "SALES", phase: 2, status: "AVAILABLE", href: "/sales-marketing/enquiries", description: "Capture and qualify incoming sales enquiries." },
  { key: "quotations", label: "Quotations & Proposals", area: "SALES", phase: 2, status: "AVAILABLE", href: "/sales-marketing/quotations", description: "Prepare, revise and send quotations to customers." },
  { key: "pricing", label: "Pricing & Price Lists", area: "SALES", phase: 3, status: "AVAILABLE", href: "/sales-marketing/pricing", description: "Default and customer price lists with quantity breaks, versions and approval." },
  { key: "discounts", label: "Discounts & Approvals", area: "SALES", phase: 3, status: "AVAILABLE", href: "/sales-marketing/pricing/discounts", description: "Discount rules and approval limits." },
  { key: "sales-orders", label: "Sales Order Integration", area: "SALES", phase: 4, status: "AVAILABLE", href: "/sales-marketing/quotations", description: "Turn accepted quotations into ERP Sales Orders (Convert on an accepted quotation)." },
  { key: "targets", label: "Sales Targets", area: "SALES", phase: 5, status: "AVAILABLE", href: "/sales-marketing/targets", description: "Approved targets per rep, team, territory and period, with live attainment." },
  { key: "territories", label: "Sales Territories", area: "SALES", phase: 5, status: "AVAILABLE", href: "/sales-marketing/territories", description: "Regions, rep assignments and customer assignment." },
  { key: "team-performance", label: "Sales Team Performance", area: "SALES", phase: 5, status: "AVAILABLE", href: "/sales-marketing/performance", description: "Rep, team and territory results against targets, with drill-down." },
  { key: "forecasting", label: "Sales Forecasting", area: "SALES", phase: 6, status: "AVAILABLE", href: "/sales-marketing/forecast", description: "Booked + weighted pipeline and trend vs target, snapshots with accuracy, what-if scenarios." },
  { key: "channels", label: "Sales Channels", area: "SALES", phase: 7, status: "AVAILABLE", href: "/sales-marketing/channels", description: "Channel master set on enquiries, quotations and Sales Orders, with sales by channel." },
  { key: "commissions", label: "Commissions & Incentives", area: "SALES", phase: 7, status: "AVAILABLE", href: "/sales-marketing/commissions", description: "Approved commission plans for reps and sales agents, target incentives, monthly statements paid through Payment Requests." },
  { key: "campaigns", label: "Campaigns & Calendar", area: "MARKETING", phase: 8, status: "PLANNED", description: "Plan, run and schedule marketing campaigns." },
  { key: "segments", label: "Audience Segmentation", area: "MARKETING", phase: 9, status: "PLANNED", description: "Target groups built from customers and CRM data." },
  { key: "marketing-channels", label: "Marketing Channels", area: "MARKETING", phase: 10, status: "PLANNED", description: "Email, WhatsApp, social and ad platforms." },
  { key: "assets", label: "Assets & Templates", area: "MARKETING", phase: 11, status: "PLANNED", description: "Catalogues, creatives and message templates." },
  { key: "promotions", label: "Promotions, Offers & Budgets", area: "MARKETING", phase: 12, status: "PLANNED", description: "Offers and campaign budgets." },
  { key: "attribution", label: "Campaign Attribution & ROI", area: "MARKETING", phase: 13, status: "PLANNED", description: "Which campaigns produced enquiries, orders and revenue." },
  { key: "reports", label: "Sales & Marketing Reports", area: "ANALYTICS", phase: 17, status: "PLANNED", description: "Reports and dashboards across sales and marketing." },
  { key: "ai-insights", label: "AI-Assisted Insights", area: "ANALYTICS", phase: 18, status: "PLANNED", description: "AI help for sales and marketing decisions." },
  { key: "integrations", label: "Integrations & Webhooks", area: "PLATFORM", phase: 16, status: "PLANNED", description: "External systems, webhooks and APIs." },
  { key: "settings", label: "Settings", area: "PLATFORM", phase: 2, status: "AVAILABLE", href: "/sales-marketing/settings", description: "Module configuration, added with the first features that need it." },
];
