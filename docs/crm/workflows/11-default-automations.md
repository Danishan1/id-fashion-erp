# 11 — Default automations

Every company starts with **20 ready-made workflows** for routine CRM work: first-call tasks, assignment alerts, hot and high-value leads, deal handover, no-shows, the Inbox and more. They are ordinary workflows. You can turn each one on or off, edit it (a new version), duplicate it or archive it, and build your own alongside them.

- **Where:** CRM → Workflows. Default workflows carry a **Default** badge, and the list has an **On** switch for each workflow.
- **Catalogue:** the **Default automations** button lists all 20, shows which ones this company already has, and adds any that are missing.

## How they get into a company

| Situation | What happens |
|---|---|
| New database | `prisma db seed` adds all 20 for the seeded company. They run as the super admin. |
| Existing database (never re-seeded) | An admin opens Workflows → **Default automations** → **Add**. They run as that admin. |
| Already added | Never added twice; edits and on/off choices are never overwritten. |
| Archived | Not re-added: archiving means "we don't want this". Restore it from the archive instead. |

**What "added" means:**

- Each one is published as version 1 and goes through the same checks as any workflow you publish.
- The person who adds them becomes the **run-as user**. Actions run with that person's permissions.
- Alerts addressed to "the run-as user" go to that person. Give that role to a sales manager.

**Starts on vs starts off:**

- 13 start **on**. They only create tasks and in-app notifications.
- 7 start **off**. These are the nurture, tagging and long-wait ones; review them, then turn them on.
- None of them sends a message to a customer or calls an outside system.

## The catalogue

| Area | Automation | Starts | What it does |
|---|---|---|---|
| Leads | **New lead: first-call task** | On | Every new lead gets a high-priority call task for its owner, due today. Unassigned leads alert the run-as user to assign an owner. |
| Leads | **Website / API lead: 2-hour response check** | Off | Tags leads from website forms, the API and webhooks as web-lead. If nobody has contacted the lead within 2 hours, alerts the owner and tags it slow-response. |
| Leads | **Lead assigned: notify the new owner** | On | When a lead is assigned or reassigned, the new owner gets an in-app notification. |
| Leads | **Hot lead: call today** | On | The first time a lead is marked Hot, its owner is alerted and gets an urgent call task due today. |
| Leads | **High-value lead (₹5 lakh+): alert the manager** | On | New leads with an estimated value of 5,00,000 or more are tagged high-value and the run-as user (the manager who switched it on) is alerted. |
| Leads | **Uncontacted lead: follow-up cadence (day 3, day 7)** | Off | If a new lead hasn't been contacted after 3 days, the owner gets a second-attempt call task. Still nothing by day 7: the lead is marked Cold, tagged no-response and the owner is told. Stops as soon as the lead is contacted, converted, lost or archived. |
| Leads | **Lost lead: check back after 90 days** | Off | 90 days after a lead is marked lost, its owner gets a low-priority task to check back. Cancelled if the lead is reopened or archived in the meantime. |
| Leads | **Lead converted: kickoff meeting task** | On | When a lead is converted, its owner gets a kickoff meeting task (due in 2 days) to confirm the requirement and sampling plan. |
| Accounts & contacts | **Contact preferences changed: alert the owner** | On | When a contact's do-not-contact or consent preferences change, the owner is alerted before the next message goes out. |
| Accounts & contacts | **Account reassigned: notify the new owner** | On | When a company is assigned or reassigned, the new owner gets an in-app notification. |
| Opportunities | **New opportunity: qualification task** | On | Every new opportunity gets a task (due tomorrow) for its owner to confirm quantities, target price and delivery date. |
| Opportunities | **Big deal (10 lakh+): alert the manager** | On | New opportunities worth 10,00,000 or more (in their own currency) are tagged key-deal and the run-as user is alerted. |
| Opportunities | **Deal stuck in a stage for 14 days** | Off | If an open opportunity stays in the same stage for 14 days, its owner is alerted and gets a task to move it forward. |
| Opportunities | **Expected close date passed** | Off | The day after an open opportunity's expected close date (as set when it was created), the owner gets a task to update the date or close the deal. Opportunities without a close date are skipped. |
| Opportunities | **Deal won: order handover and repeat-order follow-up** | On | When a deal is won: a handover task for the owner (PO, tech pack, sampling plan), an alert to the run-as user, and 30 days later a task to ask about repeat orders. Stops if the deal is reopened. |
| Opportunities | **Deal lost: loss review and 60-day win-back** | Off | When a deal is lost, the owner gets a task to record why; 60 days later, a win-back task. Stops if the deal is reopened. |
| Appointments | **Appointment no-show: reschedule task** | On | When a customer misses an appointment, the person it was assigned to gets an urgent task to reschedule it today. |
| Inbox | **Unassigned message: alert the team** | On | When a customer message arrives in a conversation nobody is assigned to, the run-as user is alerted to assign it. |
| Inbox | **No reply within 1 hour** | Off | If a customer message is still unread an hour after it arrived, the assignee (or the run-as user when nobody is assigned) is alerted. |
| Inbox | **Message failed: alert the assignee** | On | When an outgoing message can't be delivered, the conversation's assignee (or the run-as user) is alerted to try another channel. |
(node:3276) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///tmp/claude-0/app/src/modules/crm/workflows/default-workflows.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /tmp/claude-0/app/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)

**Amounts:** amounts are compared in each record's own currency, so "₹5 lakh" means a value of 5,00,000 or more.

**Tags:** tags such as `web-lead`, `high-value`, `key-deal` and `no-response` are created the first time they are used.

## Turning them on and off

- **Switch:** use the switch in the Workflows list, or **Turn on** / **Disable** on the workflow page.
- **Turning off:** asks for confirmation. Runs that are still waiting (e.g. a 30-day follow-up) are cancelled.
- **Turning back on:** applies to new events only. Nothing that happened while it was off is replayed.

## Changing a default

- Open it and edit it like any workflow (see [02-getting-started.md](02-getting-started.md)), then publish. Common tweaks:
  - thresholds (5 lakh / 10 lakh);
  - wait times (2 hours, 3 / 7 days, 14 days);
  - task wording and due dates;
  - restricting to a pipeline, source or owner.
- To send a WhatsApp or email message instead of a task, add a **Send message from template** step. This needs an active template, so the defaults don't include it.
- An edited default keeps its **Default** badge and is never overwritten by **Add default automations**.

## Good to know

- **Hot lead:** fires when a lead is **edited** to Hot (the first time only). A lead created as Hot gets the first-call task instead.
- **Deal stuck in a stage:**
  - Each stage change starts its own 14-day timer.
  - The check ignores timers whose stage has changed since.
  - Deals that never changed stage aren't watched.
- **Expected close date passed:** uses the close date set when the opportunity was created. If the date is moved later, that run ends quietly.
- **Inbox automations:** run on Inbox conversations, so they need at least one channel (Settings → Conversation channels).
- **Duplicates:** if your team already built a workflow for the same job, turn one of them off so people don't get two tasks.

## For developers

**Where it lives:**

- **Catalogue:** `src/modules/crm/workflows/default-workflows.ts`.
  - Data only, with type-only imports, because `prisma/seed.ts` imports it with plain Node.
  - It must not hold any company-specific ids or URLs.
- **Unique key:** `crm_workflows.template_key`, unique per company (migration `20261016100000_crm_default_workflows`).
- **Service:** `listDefaultWorkflows` / `installDefaultWorkflows` in `crm-workflows.service.ts`.
- **API:** `GET` / `POST /api/v1/crm/workflows/defaults`.
  - Body `{ keys?: string[] }`.
  - `crm_settings.view` for GET, `crm_settings.edit` for POST.

**Adding a default:**

1. Add an entry with a new, never-reused `key`.
2. Run `default-workflows.test.ts`. It checks every definition against the publish validator, the merge-variable registry (every variable needs a fallback) and the no-ids / no-external-actions rule.
3. Existing companies get the new entry from the button; new databases get it from the seed.

**Never** rename or reuse a key.

**Tests:**

- `default-workflows.test.ts` (catalogue).
- `default-workflows.integration.test.ts`: install, idempotency, archived copies not re-added, chosen keys only, and that switched-on defaults really create tasks, tags and notifications on lead, opportunity and won events while switched-off ones never start.
