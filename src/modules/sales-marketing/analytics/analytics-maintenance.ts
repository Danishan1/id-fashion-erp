import { purgeExpiredDeliveryFiles } from "./analytics-delivery.service";
import { pruneAnalyticsRuns } from "./analytics-reports.service";

/** Phase 17 — retention: run log (90 days) and expired delivery files (7 days). Hourly in the S&M worker. */
export async function tickAnalytics(now = new Date()) {
  const [runs, files] = await Promise.all([pruneAnalyticsRuns(now), purgeExpiredDeliveryFiles(now)]);
  return { purged: { runs, files } };
}
