import { z } from "zod";

export const AD_PLATFORMS = ["META", "GOOGLE"] as const;
export type AdPlatformValue = (typeof AD_PLATFORMS)[number];

export const linkCampaignSchema = z.object({
  // null explicitly clears an existing link — distinct from omitting the
  // field, which Zod would treat as "no change" if this were PATCH-style;
  // this endpoint always fully replaces the link, so null is meaningful.
  localCampaignId: z.string().uuid().nullable(),
});
export type LinkCampaignInput = z.infer<typeof linkCampaignSchema>;

export const syncConnectionSchema = z.object({
  // How many trailing days of daily insights to pull per sync — kept small
  // by default (ad platforms report at day granularity with a short
  // finalization lag, so re-pulling the last few days catches any
  // last-minute revisions the platform made to numbers already synced).
  daysBack: z.coerce.number().int().min(1).max(90).default(7),
});
export type SyncConnectionInput = z.infer<typeof syncConnectionSchema>;
