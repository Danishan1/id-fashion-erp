import type { ReactNode } from "react";
import { assertPerformanceView } from "@/modules/sales-marketing/performance/performance-page";

/** Targets, territories and team performance need `sales_performance.view` (Phase 05). */
export default async function Layout({ children }: { children: ReactNode }) {
  await assertPerformanceView();
  return <>{children}</>;
}
