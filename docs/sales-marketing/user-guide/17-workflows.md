# 17 — Workflows: automatic follow-ups and reminders

[← Back to the overview](README.md)

Workflows watch what happens in Sales & Marketing and make sure nothing is forgotten. They **check, assign tasks, remind, escalate and record**. They never approve, price, issue, convert, launch or post anything: people still do that.

## 1. The five workflows

| Workflow | Starts when | What it does | Finishes when |
|---|---|---|---|
| **Enquiry → approved quotation** | An enquiry is marked *Qualified* | Checks there is an owner (otherwise notifies escalation users), gives the owner a "make a quotation" task, reminds and escalates while waiting, then follows the quotation's approval and reminds approvers | The quotation is issued, or it or the enquiry is closed |
| **Quotation → Sales Order** | A quotation is accepted | Checks it can be converted (lists blockers), gives a conversion task, reminds, records the order and notifies | The order exists |
| **Campaign readiness** | A campaign is submitted | Checks the audience, channels, approved content and budget; a "get campaign ready" task; reminds approvers; notifies the owner when ready | Someone activates the campaign, or it is closed |
| **Budget exception** | A campaign budget alert is raised | A review task for the campaign, and notifies reviewers. It never changes money | The alert clears or the task is completed |
| **Processing follow-up** | An attribution calculation or bulk job fails (or too much is unattributed) | Records the problem, notifies, and waits for a successful re-run | Resolved by a re-run, a retry or a person |

Tasks appear in CRM **My Tasks**. Reminders and escalations are in-app notifications.

## 2. Switching a workflow on

**Sales & Marketing → Workflows** (needs Workflows *edit*).

1. Open a workflow card. Review its **settings**: reminder and escalation timings, who gets escalations, whether tasks are created, and the entry conditions (for example only enquiries above a value).
2. **Check**, then **Save**.
3. **Switch on.** The person who switches it on becomes its **run-as user**, so they must hold the permissions the workflow needs. These are re-checked before every step.
4. To change an active workflow, edit and switch on again. A new version applies to new runs only; running ones finish on their own version.

## 3. Watching and fixing

- The **Running & history** tab lists runs, with filters by workflow, record and status.
- A run page shows its plan, current step, tasks, references and history.
- **Needs attention / Failed** runs appear on the dashboard queue. On the run page:
  - **Retry**;
  - **Resolve** (a note is required);
  - **Cancel**: only the open tasks the workflow itself created are cancelled. Business records are never undone.
- **Start on a record** lets you start a workflow by hand on an existing enquiry, quotation or campaign.

## 4. Good practice

- Start with **Enquiry → approved quotation** and **Quotation → Sales Order**. They catch the most common slips.
- Make sure owners have CRM access. Otherwise they get notifications instead of tasks.
