import { registerReportPageMeta } from "../report-page-meta";

const CATEGORY = "audit";

registerReportPageMeta({
  category: CATEGORY,
  key: "user-activity",
  title: "User Activity",
  description: "Audit log of every tracked create/update/approve/reject/post/cancel/delete action in the system.",
  filterFields: [{ key: "userId", label: "User", type: "select", optionsUrl: "/api/v1/users", optionsLabelKey: "fullName" }],
});

registerReportPageMeta({
  category: CATEGORY,
  key: "last-login-per-user",
  title: "Last Login per User",
  description: "The single most recent login timestamp per user — this ERP has no full login history table.",
  includeDateRange: false,
});
