import type { ConditionGroup, ConditionLeaf } from "./workflow-conditions";
import type { WorkflowDefinition, WorkflowNode } from "./workflow-definition";

/**
 * Default CRM automations — a catalogue of ready-made workflows every company
 * gets (prisma/seed.ts for new databases; "Add default automations" on the
 * Workflows page for existing ones). Each becomes an ordinary workflow: the
 * team can switch it on or off, edit it (a new version), duplicate it or
 * archive it. `key` (crm_workflows.template_key) stops it being added twice.
 *
 * Rules for this file:
 *   - DATA ONLY, type-only imports: prisma/seed.ts imports it with plain
 *     Node (no path aliases, no runtime dependencies).
 *   - No ids of statuses, stages, tags, users or templates — those differ per
 *     company. Use enum / date / number fields (status kind, temperature,
 *     value, dates), new tag NAMES (created on first use) and the
 *     "record owner" / "run-as user" recipients.
 *   - Every definition must pass the workflow validator; the unit test
 *     `default-workflows.test.ts` enforces it.
 *
 * The run-as user is whoever installs the defaults (or switches one on): the
 * "manager" alerts go to that person.
 */

export const DEFAULT_WORKFLOW_CATEGORIES = ["Leads", "Accounts & contacts", "Opportunities", "Appointments", "Inbox"] as const;
export type DefaultWorkflowCategory = (typeof DEFAULT_WORKFLOW_CATEGORIES)[number];

export interface DefaultWorkflowDef {
  /** Stable id — never rename (it is how an installed copy is recognised). */
  key: string;
  name: string;
  description: string;
  category: DefaultWorkflowCategory;
  /** Switched on when installed. Off = installed published but disabled, ready to switch on. */
  enabledByDefault: boolean;
  definition: WorkflowDefinition;
}

// ── tiny builders (keep the catalogue readable) ─────────────────────────────

const leaf = (field: string, operator: ConditionLeaf["operator"], value?: ConditionLeaf["value"]): ConditionLeaf => (value === undefined ? { kind: "condition", field, operator } : { kind: "condition", field, operator, value });
const all = (...conditions: (ConditionLeaf | ConditionGroup)[]): ConditionGroup => ({ kind: "group", logic: "AND", conditions });
const any = (...conditions: (ConditionLeaf | ConditionGroup)[]): ConditionGroup => ({ kind: "group", logic: "OR", conditions });
const none = (): ConditionGroup => ({ kind: "group", logic: "AND", conditions: [] });

type Next = string | null;
const task = (id: string, next: Next, p: { type?: "TASK" | "CALL" | "MEETING"; subject: string; description?: string; dueInDays?: number; priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT"; recipient?: "RECORD_OWNER" | "RUN_AS" }, name?: string): WorkflowNode => ({
  id,
  type: "ACTION",
  ...(name ? { name } : {}),
  action: "task.create",
  params: { type: p.type ?? "TASK", subject: p.subject, ...(p.description ? { description: p.description } : {}), dueInDays: p.dueInDays ?? 0, priority: p.priority ?? "NORMAL", recipient: p.recipient ?? "RECORD_OWNER" },
  next,
  onError: "STOP",
});
const notify = (id: string, next: Next, recipient: "RECORD_OWNER" | "RUN_AS", title: string, body: string, name?: string): WorkflowNode => ({
  id,
  type: "ACTION",
  ...(name ? { name } : {}),
  action: "notification.send",
  params: { recipient, title, body },
  next,
  // A missing recipient shouldn't stop the rest of the workflow.
  onError: "CONTINUE",
});
const addTags = (id: string, next: Next, names: string): WorkflowNode => ({ id, type: "ACTION", action: "record.add_tags", params: { tagNames: names }, next, onError: "CONTINUE" });
const ifThen = (id: string, condition: ConditionGroup, onTrue: Next, onFalse: Next, name?: string): WorkflowNode => ({ id, type: "CONDITION", ...(name ? { name } : {}), condition, onTrue, onFalse });
const waitDays = (id: string, amount: number, next: Next, unit: "MINUTES" | "HOURS" | "DAYS" = "DAYS"): WorkflowNode => ({ id, type: "WAIT", wait: { mode: "DURATION", amount, unit }, next });
/** Notify the record owner when there is one, otherwise the run-as user. */
const notifyOwnerOrRunAs = (prefix: string, next: Next, title: string, body: string, ownerField = "record.owner"): WorkflowNode[] => [
  ifThen(`${prefix}_has_owner`, all(leaf(ownerField, "is_not_empty")), `${prefix}_owner`, `${prefix}_runas`, "Has an owner?"),
  notify(`${prefix}_owner`, next, "RECORD_OWNER", title, body),
  notify(`${prefix}_runas`, next, "RUN_AS", title, body),
];

const def = (trigger: WorkflowDefinition["trigger"], entryNodeId: string, nodes: WorkflowNode[], settings: Partial<WorkflowDefinition["settings"]> = {}): WorkflowDefinition => ({
  schemaVersion: 1,
  trigger: { ...trigger, conditions: trigger.conditions ?? none() },
  entryNodeId,
  nodes,
  settings: { timezone: "Asia/Kolkata", reentry: "AFTER_FINISH", allowWorkflowTriggers: false, ...settings },
});

// ── the catalogue ───────────────────────────────────────────────────────────

export const DEFAULT_WORKFLOWS: DefaultWorkflowDef[] = [
  // ── Leads ──
  {
    key: "lead-first-contact",
    name: "New lead: first-call task",
    description: "Every new lead gets a high-priority call task for its owner, due today. Unassigned leads alert the run-as user to assign an owner.",
    category: "Leads",
    enabledByDefault: true,
    definition: def({ type: "lead.created" }, "owner", [
      ifThen("owner", all(leaf("record.owner", "is_not_empty")), "call", "unassigned", "Has an owner?"),
      task("call", null, {
        type: "CALL",
        subject: "First call: {{lead.full_name|new lead}}",
        description: "New lead ({{lead.source|source not set}}). Call today, qualify the requirement — product, quantity, target price, timeline — and set the next follow-up.",
        priority: "HIGH",
      }),
      notify("unassigned", null, "RUN_AS", "Unassigned new lead: {{lead.full_name|new lead}}", "A new lead has no owner yet. Assign it so someone calls today."),
    ], { reentry: "ONCE" }),
  },
  {
    key: "lead-web-speed-to-lead",
    name: "Website / API lead: 2-hour response check",
    description: "Tags leads from website forms, the API and webhooks as web-lead. If nobody has contacted the lead within 2 hours, alerts the owner and tags it slow-response.",
    category: "Leads",
    enabledByDefault: false,
    definition: def({ type: "lead.captured" }, "tag", [
      addTags("tag", "wait", "web-lead"),
      waitDays("wait", 2, "check", "HOURS"),
      ifThen("check", all(leaf("record.status_kind", "eq", "OPEN"), leaf("record.last_contacted_at", "is_empty")), "slow", null, "Still not contacted?"),
      addTags("slow", "alert_has_owner", "slow-response"),
      ...notifyOwnerOrRunAs("alert", null, "Not contacted in 2 hours: {{lead.full_name|web lead}}", "This lead came in from the website / API 2 hours ago and hasn't been contacted. Fast replies win more web leads."),
    ], { reentry: "ONCE" }),
  },
  {
    key: "lead-assigned-notify",
    name: "Lead assigned: notify the new owner",
    description: "When a lead is assigned or reassigned, the new owner gets an in-app notification.",
    category: "Leads",
    enabledByDefault: true,
    definition: def({ type: "lead.owner_changed", conditions: all(leaf("trigger.toUserId", "is_not_empty")) }, "notify", [
      notify("notify", null, "RECORD_OWNER", "Lead assigned to you: {{lead.full_name|a lead}}", "{{lead.full_name|This lead}} ({{lead.company_name|no company}}) is now yours. Review the details and plan the next follow-up."),
    ]),
  },
  {
    key: "lead-hot-alert",
    name: "Hot lead: call today",
    description: "The first time a lead is marked Hot, its owner is alerted and gets an urgent call task due today.",
    category: "Leads",
    enabledByDefault: true,
    definition: def({ type: "lead.updated", conditions: all(leaf("record.temperature", "eq", "HOT"), leaf("record.status_kind", "eq", "OPEN")) }, "alert_has_owner", [
      ...notifyOwnerOrRunAs("alert", "call", "Hot lead: {{lead.full_name|a lead}}", "{{lead.full_name|This lead}} was marked Hot. Call today."),
      task("call", null, { type: "CALL", subject: "Hot lead — call {{lead.full_name|now}}", priority: "URGENT" }),
    ], { reentry: "ONCE" }),
  },
  {
    key: "lead-high-value",
    name: "High-value lead (₹5 lakh+): alert the manager",
    description: "New leads with an estimated value of 5,00,000 or more are tagged high-value and the run-as user (the manager who switched it on) is alerted.",
    category: "Leads",
    enabledByDefault: true,
    definition: def({ type: "lead.created", conditions: all(leaf("record.estimated_value", "gte", 500000)) }, "tag", [
      addTags("tag", "notify", "high-value"),
      notify("notify", null, "RUN_AS", "High-value lead: {{lead.full_name|new lead}}", "Estimated value is 5,00,000 or more ({{lead.company_name|no company}}). Make sure the right person owns it."),
    ], { reentry: "ONCE" }),
  },
  {
    key: "lead-no-response-cadence",
    name: "Uncontacted lead: follow-up cadence (day 3, day 7)",
    description: "If a new lead hasn't been contacted after 3 days, the owner gets a second-attempt call task. Still nothing by day 7: the lead is marked Cold, tagged no-response and the owner is told. Stops as soon as the lead is contacted, converted, lost or archived.",
    category: "Leads",
    enabledByDefault: false,
    definition: def({ type: "lead.created" }, "wait3", [
      waitDays("wait3", 3, "check3"),
      ifThen("check3", all(leaf("record.last_contacted_at", "is_empty")), "retry", null, "Still not contacted?"),
      task("retry", "wait7", { type: "CALL", subject: "Second attempt: {{lead.full_name|lead}}", description: "No contact recorded in 3 days. Try another channel (WhatsApp / email) if calls aren't answered.", priority: "HIGH" }),
      waitDays("wait7", 4, "check7"),
      ifThen("check7", all(leaf("record.last_contacted_at", "is_empty")), "cold", null, "Still not contacted?"),
      { id: "cold", type: "ACTION", action: "lead.update", params: { temperature: "COLD" }, next: "tag", onError: "CONTINUE" },
      addTags("tag", "tell_has_owner", "no-response"),
      ...notifyOwnerOrRunAs("tell", null, "No response after 7 days: {{lead.full_name|lead}}", "The lead was marked Cold and tagged no-response. Decide whether to keep nurturing or close it."),
    ], {
      reentry: "ONCE",
      exitConditions: any(leaf("record.status_kind", "neq", "OPEN"), leaf("record.is_archived", "is_true"), leaf("record.last_contacted_at", "is_not_empty")),
    }),
  },
  {
    key: "lead-lost-reactivation",
    name: "Lost lead: check back after 90 days",
    description: "90 days after a lead is marked lost, its owner gets a low-priority task to check back. Cancelled if the lead is reopened or archived in the meantime.",
    category: "Leads",
    enabledByDefault: false,
    definition: def({ type: "lead.status_changed", conditions: all(leaf("record.status_kind", "eq", "LOST")) }, "wait", [
      waitDays("wait", 90, "task"),
      task("task", null, { subject: "Check back with {{lead.full_name|lost lead}}", description: "This lead was lost 90 days ago. Is there a new season, collection or requirement?", priority: "LOW" }),
    ], { exitConditions: any(leaf("record.status_kind", "neq", "LOST"), leaf("record.is_archived", "is_true")) }),
  },
  {
    key: "lead-converted-kickoff",
    name: "Lead converted: kickoff meeting task",
    description: "When a lead is converted, its owner gets a kickoff meeting task (due in 2 days) to confirm the requirement and sampling plan.",
    category: "Leads",
    enabledByDefault: true,
    definition: def({ type: "lead.converted" }, "kickoff", [
      task("kickoff", null, { type: "MEETING", subject: "Kickoff: {{lead.full_name|converted lead}}", description: "Confirm the requirement, quantities, target price, sampling plan and delivery timeline. Make sure the opportunity has a value and expected close date.", dueInDays: 2 }),
    ], { reentry: "ONCE" }),
  },
  // ── Accounts & contacts ──
  {
    key: "contact-preferences-changed",
    name: "Contact preferences changed: alert the owner",
    description: "When a contact's do-not-contact or consent preferences change, the owner is alerted before the next message goes out.",
    category: "Accounts & contacts",
    enabledByDefault: true,
    definition: def({ type: "contact.contactability_changed" }, "owner", [
      ifThen("owner", all(leaf("record.owner", "is_not_empty")), "notify", null, "Has an owner?"),
      notify("notify", null, "RECORD_OWNER", "Contact preferences changed: {{contact.full_name|a contact}}", "Do-not-contact or consent settings changed. Check them before the next message or campaign."),
    ]),
  },
  {
    key: "company-owner-changed",
    name: "Account reassigned: notify the new owner",
    description: "When a company is assigned or reassigned, the new owner gets an in-app notification.",
    category: "Accounts & contacts",
    enabledByDefault: true,
    definition: def({ type: "company.owner_changed", conditions: all(leaf("trigger.toUserId", "is_not_empty")) }, "notify", [
      notify("notify", null, "RECORD_OWNER", "Account assigned to you: {{company.name|a company}}", "{{company.name|This account}} is now yours. Review open opportunities and recent activity."),
    ]),
  },
  // ── Opportunities ──
  {
    key: "opportunity-qualify",
    name: "New opportunity: qualification task",
    description: "Every new opportunity gets a task (due tomorrow) for its owner to confirm quantities, target price and delivery date.",
    category: "Opportunities",
    enabledByDefault: true,
    definition: def({ type: "opportunity.created" }, "task", [
      task("task", null, { subject: "Qualify {{opportunity.name|the opportunity}}", description: "Confirm style / product, quantities, target price, delivery date and decision maker. Update the value and expected close date.", dueInDays: 1 }),
    ], { reentry: "ONCE" }),
  },
  {
    key: "opportunity-big-deal",
    name: "Big deal (10 lakh+): alert the manager",
    description: "New opportunities worth 10,00,000 or more (in their own currency) are tagged key-deal and the run-as user is alerted.",
    category: "Opportunities",
    enabledByDefault: true,
    definition: def({ type: "opportunity.created", conditions: all(leaf("record.amount", "gte", 1000000)) }, "tag", [
      addTags("tag", "notify", "key-deal"),
      notify("notify", null, "RUN_AS", "Big deal: {{opportunity.name|new opportunity}}", "Value {{opportunity.value|10,00,000+}} in {{opportunity.pipeline|the pipeline}}, owned by {{opportunity.owner|nobody yet}}."),
    ], { reentry: "ONCE" }),
  },
  {
    key: "opportunity-stuck-in-stage",
    name: "Deal stuck in a stage for 14 days",
    description: "If an open opportunity stays in the same stage for 14 days, its owner is alerted and gets a task to move it forward.",
    category: "Opportunities",
    enabledByDefault: false,
    definition: def({ type: "opportunity.stage_changed" }, "wait", [
      waitDays("wait", 14, "check"),
      ifThen("check", all(leaf("record.status", "eq", "OPEN"), leaf("record.stage_changed_at", "more_than_days_ago", 13)), "alert_has_owner", null, "Still in the same stage?"),
      ...notifyOwnerOrRunAs("alert", "task", "Stuck for 14 days: {{opportunity.name|an opportunity}}", "{{opportunity.name|This deal}} has been in {{opportunity.stage|the same stage}} for 14 days."),
      task("task", null, { subject: "Move {{opportunity.name|the deal}} forward", description: "Agree the next step with the buyer, or update the stage / close the deal.", priority: "HIGH" }),
    ], {
      // Every stage change starts its own 14-day timer; the check ignores timers whose stage has since changed.
      reentry: "ALWAYS",
      exitConditions: all(leaf("record.status", "neq", "OPEN")),
    }),
  },
  {
    key: "opportunity-close-date-passed",
    name: "Expected close date passed",
    description: "The day after an open opportunity's expected close date (as set when it was created), the owner gets a task to update the date or close the deal. Opportunities without a close date are skipped.",
    category: "Opportunities",
    enabledByDefault: false,
    definition: def({ type: "opportunity.created", conditions: all(leaf("record.expected_close_date", "is_not_empty")) }, "wait", [
      { id: "wait", type: "WAIT", wait: { mode: "UNTIL_FIELD", field: "record.expected_close_date", offsetMinutes: 1440 }, next: "check" },
      ifThen("check", all(leaf("record.status", "eq", "OPEN"), leaf("record.expected_close_date", "more_than_days_ago", 0)), "task", null, "Still open and overdue?"),
      task("task", null, { subject: "Close date passed: {{opportunity.name|opportunity}}", description: "Update the expected close date, or mark the deal won / lost.", priority: "HIGH" }),
    ], { reentry: "ONCE", exitConditions: all(leaf("record.status", "neq", "OPEN")) }),
  },
  {
    key: "opportunity-won-handover",
    name: "Deal won: order handover and repeat-order follow-up",
    description: "When a deal is won: a handover task for the owner (PO, tech pack, sampling plan), an alert to the run-as user, and 30 days later a task to ask about repeat orders. Stops if the deal is reopened.",
    category: "Opportunities",
    enabledByDefault: true,
    definition: def({ type: "opportunity.won" }, "handover", [
      task("handover", "notify", { subject: "Hand over {{opportunity.name|the order}} to merchandising", description: "Share the PO, tech pack, approved samples and delivery dates with merchandising / production.", dueInDays: 1, priority: "HIGH" }),
      notify("notify", "wait", "RUN_AS", "Deal won: {{opportunity.name|an opportunity}}", "{{opportunity.owner|The team}} won {{opportunity.name|a deal}} worth {{opportunity.value|—}}."),
      waitDays("wait", 30, "repeat"),
      task("repeat", null, { type: "CALL", subject: "Repeat-order check: {{opportunity.name|customer}}", description: "Ask how the order went, collect feedback and discuss the next season's requirement." }),
    ], { reentry: "AFTER_FINISH", exitConditions: all(leaf("record.status", "neq", "WON")) }),
  },
  {
    key: "opportunity-lost-review",
    name: "Deal lost: loss review and 60-day win-back",
    description: "When a deal is lost, the owner gets a task to record why; 60 days later, a win-back task. Stops if the deal is reopened.",
    category: "Opportunities",
    enabledByDefault: false,
    definition: def({ type: "opportunity.lost" }, "review", [
      task("review", "wait", { subject: "Loss review: {{opportunity.name|lost deal}}", description: "Record the real reason (price, lead time, quality, competitor) so the team can learn from it.", dueInDays: 2, priority: "LOW" }),
      waitDays("wait", 60, "winback"),
      task("winback", null, { type: "CALL", subject: "Win-back: reconnect about {{opportunity.name|the lost deal}}", priority: "LOW" }),
    ], { exitConditions: all(leaf("record.status", "eq", "OPEN")) }),
  },
  // ── Appointments ──
  {
    key: "appointment-no-show",
    name: "Appointment no-show: reschedule task",
    description: "When a customer misses an appointment, the person it was assigned to gets an urgent task to reschedule it today.",
    category: "Appointments",
    enabledByDefault: true,
    definition: def({ type: "appointment.no_show" }, "task", [
      task("task", null, { type: "CALL", subject: "Reschedule missed appointment: {{appointment.title|appointment}}", description: "The customer didn't come to the appointment on {{appointment.date|its date}}. Call to reschedule.", priority: "HIGH" }),
    ]),
  },
  // ── Inbox ──
  {
    key: "inbox-unassigned-message",
    name: "Unassigned message: alert the team",
    description: "When a customer message arrives in a conversation nobody is assigned to, the run-as user is alerted to assign it.",
    category: "Inbox",
    enabledByDefault: true,
    definition: def({ type: "message.received", conditions: all(leaf("record.assigned_to", "is_empty")) }, "notify", [
      notify("notify", null, "RUN_AS", "Unassigned message from {{contact.full_name|a customer}}", "A new message is waiting in the Inbox with nobody assigned. Assign the conversation so the customer gets a reply."),
    ]),
  },
  {
    key: "inbox-reply-sla",
    name: "No reply within 1 hour",
    description: "If a customer message is still unread an hour after it arrived, the assignee (or the run-as user when nobody is assigned) is alerted.",
    category: "Inbox",
    enabledByDefault: false,
    definition: def({ type: "message.received" }, "wait", [
      waitDays("wait", 60, "check", "MINUTES"),
      ifThen("check", all(leaf("record.status", "neq", "CLOSED"), leaf("record.unread_count", "gt", 0)), "alert_has_owner", null, "Still unread?"),
      ...notifyOwnerOrRunAs("alert", null, "Waiting over 1 hour: {{contact.full_name|a customer}}", "A customer message has been unread for an hour. Reply from the Inbox.", "record.assigned_to"),
    ], { exitConditions: all(leaf("record.status", "eq", "CLOSED")) }),
  },
  {
    key: "inbox-message-failed",
    name: "Message failed: alert the assignee",
    description: "When an outgoing message can't be delivered, the conversation's assignee (or the run-as user) is alerted to try another channel.",
    category: "Inbox",
    enabledByDefault: true,
    definition: def({ type: "message.failed" }, "alert_has_owner", [
      ...notifyOwnerOrRunAs("alert", null, "Message not delivered: {{contact.full_name|a customer}}", "An outgoing message could not be delivered. Check the conversation and try another channel.", "record.assigned_to"),
    ]),
  },
];

export const DEFAULT_WORKFLOW_KEYS: ReadonlySet<string> = new Set(DEFAULT_WORKFLOWS.map((d) => d.key));
