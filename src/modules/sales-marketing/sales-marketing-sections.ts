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
  { key: "pricing", label: "Pricing & Price Lists", area: "SALES", phase: 3, status: "PLANNED", description: "Price lists per customer, channel and currency." },
  { key: "discounts", label: "Discounts & Approvals", area: "SALES", phase: 3, status: "PLANNED", description: "Discount rules and approval limits." },
  { key: "sales-orders", label: "Sales Order Integration", area: "SALES", phase: 4, status: "PLANNED", description: "Turn accepted quotations into ERP Sales Orders." },
  { key: "targets", label: "Sales Targets", area: "SALES", phase: 5, status: "PLANNED", description: "Targets per person, team, territory and period." },
  { key: "territories", label: "Sales Territories", area: "SALES", phase: 5, status: "PLANNED", description: "Regions and customer assignment." },
  { key: "team-performance", label: "Sales Team Performance", area: "SALES", phase: 5, status: "PLANNED", description: "Achievement against targets." },
  { key: "forecasting", label: "Sales Forecasting", area: "SALES", phase: 6, status: "PLANNED", description: "Forecast from pipeline, quotations and history." },
  { key: "channels", label: "Sales Channels", area: "SALES", phase: 7, status: "PLANNED", description: "Export, domestic, retail and online channels." },
  { key: "commissions", label: "Commissions & Incentives", area: "SALES", phase: 7, status: "PLANNED", description: "Commission rules for sales agents and staff." },
  { key: "campaigns", label: "Campaigns & Calendar", area: "MARKETING", phase: 8, status: "PLANNED", description: "Plan, run and schedule marketing campaigns." },
  { key: "segments", label: "Audience Segmentation", area: "MARKETING", phase: 9, status: "PLANNED", description: "Target groups built from customers and CRM data." },
  { key: "marketing-channels", label: "Marketing Channels", area: "MARKETING", phase: 10, status: "PLANNED", description: "Email, WhatsApp, social and ad platforms." },
  { key: "assets", label: "Assets & Templates", area: "MARKETING", phase: 11, status: "PLANNED", description: "Catalogues, creatives and message templates." },
  { key: "promotions", label: "Promotions, Offers & Budgets", area: "MARKETING", phase: 12, status: "PLANNED", description: "Offers and campaign budgets." },
  { key: "attribution", label: "Campaign Attribution & ROI", area: "MARKETING", phase: 13, status: "PLANNED", description: "Which campaigns produced enquiries, orders and revenue." },
  { key: "reports", label: "Sales & Marketing Reports", area: "ANALYTICS", phase: 17, status: "PLANNED", description: "Reports and dashboards across sales and marketing." },
  { key: "ai-insights", label: "AI-Assisted Insights", area: "ANALYTICS", phase: 18, status: "PLANNED", description: "AI help for sales and marketing decisions." },
  { key: "integrations", label: "Integrations & Webhooks", area: "PLATFORM", phase: 16, status: "PLANNED", description: "External systems, webhooks and APIs." },
  { key: "settings", label: "Settings", area: "PLATFORM", phase: 2, status: "PLANNED", description: "Module configuration, added with the first features that need it." },
];
