import type { ReactNode } from "react";
import { assertPerformanceView } from "@/modules/sales-marketing/performance/performance-page";

/** Forecast screens need `sales_performance.view` (Phase 06 reuses the Phase 05 module). */
export default async function Layout({ children }: { children: ReactNode }) {
  await assertPerformanceView();
  return <>{children}</>;
}
