import {
  SALES_ENQUIRY_PRIORITIES,
  SALES_ENQUIRY_STAGES,
  TONE_BADGE,
  type SalesEnquiryPriority,
  type SalesEnquiryStage,
} from "@/modules/sales-marketing/enquiries/sales-enquiry-registry";

const BADGE = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium";

export function StageBadge({ stage }: { stage: SalesEnquiryStage }) {
  const meta = SALES_ENQUIRY_STAGES[stage];
  return <span className={`${BADGE} ${TONE_BADGE[meta?.tone ?? "neutral"]}`}>{meta?.label ?? stage}</span>;
}

export function PriorityBadge({ priority }: { priority: SalesEnquiryPriority }) {
  const meta = SALES_ENQUIRY_PRIORITIES[priority];
  return <span className={`${BADGE} ${TONE_BADGE[meta?.tone ?? "neutral"]}`}>{meta?.label ?? priority}</span>;
}
