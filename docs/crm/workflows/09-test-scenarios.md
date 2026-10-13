# 9. Test scenarios: a tester's checklist

Use this list to check that workflows behave correctly, for example after an upgrade, or before going live with a new company setup.

## Before you start

Prepare:

- **Two users:**
  - **Admin**, with CRM Settings Edit and "View all CRM records";
  - **Rep**, with CRM access but **no** CRM Settings.
- A lead source **Website**, lead statuses **New**, **Qualified** and **Lost**, and a pipeline with the stages **New → Sample Sent → Negotiation**.
- One active WhatsApp **message template**, and one contact who has a WhatsApp conversation in the Inbox.
- The **background worker running** (otherwise triggers and waits won't fire).

Name test workflows `TEST — …` and archive them afterwards. Record the result (Pass / Fail + notes) in the last column of your copy.

**Timing:** a "live" expectation should be visible within about **15 seconds**. Refresh the Executions tab.

---

## A. Access and permissions

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| A-01 | Menu visibility | Log in as **Rep**. | CRM → Workflows is **not** in the menu; opening `/crm/workflows` directly shows "not found". |
| A-02 | Admin can create | Log in as **Admin** → Workflows → New workflow → name it, pick *Lead created* → Create draft. | Opens the Builder; status Draft, badge "Draft v1". |
| A-03 | Run-as recorded | Publish any valid workflow as Admin. | Header shows "runs as <Admin>". |
| A-04 | Missing permission blocks publish | Have a user **without** permission to create CRM records publish a workflow with *Create task*. | Publish refused: "You'll be the run-as user, but you don't have crm.create — needed for 'Create task'". |
| A-05 | Webhook secret | Details & secret → Reveal, then Rotate. | A secret is shown; after Rotate a different one. Both actions appear in the audit log, without the secret value. |

## B. Drafts, publishing and versions

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| B-01 | Draft never runs | Create a draft *Lead created* → Create task. Don't publish. Create a lead. | No execution. No task. |
| B-02 | Validation errors | Add an Action *Create task* with no Subject → Validate. | Red list "Subject is required."; the step has a red border; **Publish** refused with the same list. |
| B-03 | Loop prevention | Make step n1 → n2 and n2 → n1 → Validate. | Error about a loop/cycle. |
| B-04 | Unreachable step | Add a step nobody points to → Validate. | Error: step can't be reached. |
| B-05 | Publish | Fix everything → Publish. | Status Active, "Live v1", no draft badge. |
| B-06 | Edit live creates draft | Change a setting → Save draft. | Header: "Live v1" **and** "Draft v2". New leads still use v1 (check an execution's Version column). |
| B-07 | Publish new version | Publish v2. | Versions tab: v2 Live, v1 Superseded. New runs show v2; runs that started earlier still show v1. |
| B-08 | Discard draft | Edit → Save draft (v3) → Discard draft. | v3 gone; v2 still live. |
| B-09 | Concurrent edit | Open the same workflow in two tabs; save in tab 1, then save in tab 2. | Tab 2: "This workflow was changed by someone else. Reload…". |
| B-10 | Duplicate | Duplicate an active workflow. | A new **Draft** "Copy of …" with the same steps; the original is unchanged. |

## C. Triggers

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| C-01 | Lead created | Active workflow *Lead created* → Add note. Create a lead. | One execution, Completed; the note on the lead's timeline. |
| C-02 | Exactly once | In C-01, edit the lead afterwards. | Still exactly **one** execution for that lead. |
| C-03 | Not before publish | Create a lead, **then** publish a *Lead created* workflow. | No execution for that earlier lead. |
| C-04 | Imported vs captured | Workflows on *Lead imported* and *Lead captured*. Import a CSV row; create a lead through the website form / capture API. | The import starts only the "imported" workflow; the form lead starts only the "captured" one. *Lead created* (if active) starts for both. |
| C-05 | Stage changed + trigger data | *Opportunity stage changed*, enrolment *New stage is Sample Sent*. Move an opportunity New → Negotiation, then → Sample Sent. | No run for the first move; one run for Sample Sent. |
| C-06 | Tag added | *Tag added*, enrolment *Tag is "vip"*. Add tag "vip" to a contact; add "other" to a lead. | One run (the contact) only. |
| C-07 | Message received | *Message received*. Send a WhatsApp message in from a test phone. | One run on that conversation. |
| C-08 | Paused ignores triggers | Pause the C-01 workflow. Create a lead. Resume. | No run for the lead created while paused; the next new lead runs again. |

## D. Conditions

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| D-01 | Enrolment filter | Enrolment *Source is Website*. Create a Website lead and an Email lead. | Run only for the Website lead. |
| D-02 | Test shows why | Test run on the Email lead. | Amber "would NOT be enrolled"; the Source line ends `→ false`. |
| D-03 | AND / OR / NOT | Enrolment: NOT( Country is any of India ) AND ( Temperature is Hot OR Score is at least 70 ). Test with: India Hot; UAE Hot; UAE Cold score 80; UAE Cold score 10. | Enrolled: no, yes, yes, no. |
| D-04 | Case-insensitive text | Condition *Company name contains "exports"*. Lead company "ABC EXPORTS". | Matches. |
| D-05 | Empty values | Condition *Email contains "@gmail.com"* on a lead with no email. | false; *Email is empty* is true. |
| D-06 | Branch order | Branch 1: Score at least 50 → A; Branch 2: Score at least 80 → B. Lead score 90. | Takes branch **A** (first match wins). Swap the order → B. |
| D-07 | Live values inside the flow | Wait 1 minute → If Temperature is Hot. Start on a Cold lead, change it to Hot within the minute. | The If / else takes **yes** (the current value is used). |

## E. Actions

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| E-01 | Create task + merge fields | Create task `Call {{lead.full_name}} ({{lead.company_name|none}})`, due 0 days, owner. | Task exists for the lead's owner, today, with the correct subject; for a lead without a company the subject ends "(none)". |
| E-02 | Assign owner | Assign owner → Rep. | Lead owner = Rep; the timeline shows the change by the run-as user. |
| E-03 | Tags by name | Add tags, new names `fair-2026, hot`. | Tags created if missing, and both on the record. |
| E-04 | Lead status | Change lead status → Qualified. | Status changed; a *Lead status changed* workflow (if any) does **not** start unless "Let changes made by other workflows…" is on there (see G-02). |
| E-05 | Stage rules respected | Move stage → a stage that requires *Expected close date*, on an opportunity without it. | Step **failed**, listing the missing field; the opportunity is unchanged. |
| E-06 | Send message | Send message (WhatsApp template) on a contact with a WhatsApp conversation. | Message appears in the Inbox conversation, sent by the run-as user, with the template version. |
| E-07 | Do-not-contact | Mark the contact "Do not contact" on WhatsApp, run again. | Step **failed**, with an opt-out / not contactable reason; nothing sent. |
| E-08 | No conversation | Send message on a contact without a WhatsApp conversation. | Step failed: "The contact has no WHATSAPP conversation yet…". |
| E-09 | Notify | Notify specific users, title `Hot lead {{lead.full_name}}`. | The bell notification appears for those users with the name filled in. |
| E-10 | Continue on error | E-08 with "Record the error and continue", followed by Add note. | Message step failed, note step completed, execution **Completed**. |
| E-11 | Webhook blocked | Call a webhook `https://127.0.0.1/x` or `http://example.com` → Publish. | Publish refused: private / internal address, or https required. |
| E-12 | Webhook delivered | Webhook to a test receiver (e.g. a request-inspection site with https). | Receiver gets JSON with `type: crm.workflow.webhook`, headers `X-CRM-Signature` and `Idempotency-Key`; the trace shows "Webhook answered 200". |

## F. Waits, goals, exits

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| F-01 | Duration wait | Wait 2 minutes → Add note. Trigger it. | Waiting, with *Next run* about now + 2 min; then Completed with the note. |
| F-02 | Survives restart | During F-01's wait, restart the server / worker. | Still continues and completes after the restart. |
| F-03 | Until time of day | Wait until (now + 5 min, HH:mm). | Resumes at that clock time in the workflow's time zone. |
| F-04 | Next day | Wait until a time already passed today. | *Next run* = tomorrow at that time. |
| F-05 | Weekdays | Wait until 09:00, only MON. Trigger on a Wednesday. | *Next run* = next Monday 09:00. |
| F-06 | Record date | Wait until *Expected close date*, offset −60, on an opportunity closing tomorrow 12:00. | *Next run* = tomorrow 11:00. With an empty date it continues immediately. |
| F-07 | Goal reached | Wait 2 min → Goal *Status kind is Converted* → Notify. Convert the lead during the wait. | Execution **Completed**; exit reason "Goal…/Goal reached"; no notification. |
| F-08 | Exit step | Branch default → Exit "Not relevant". | Execution **Exited** with reason "Not relevant". |
| F-09 | Exit conditions | Settings exit *Status kind is Lost*. Wait 2 min → note. Mark the lead lost during the wait. | Execution **Exited** ("Exit conditions matched"); no note. |
| F-10 | Pause holds | Workflow with Wait 1 min. Trigger, then Pause the workflow; after 2 min Resume. | While paused: execution **Paused** and no further steps; after Resume it continues and completes. |
| F-11 | Disable cancels | Same, but Disable. | Waiting execution → **Cancelled** ("Workflow disabled"). |

## G. Re-entry and loop protection

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| G-01 | Only once | *Tag added* + Only once per record. Remove and re-add the tag twice. | Exactly one execution. |
| G-02 | Workflow changes don't chain | Workflow A (*Lead created*) → Add tag "auto". Workflow B (*Tag added*, Tag is "auto"), setting off. | B does **not** run. Turn B's setting **on** → for the next new lead B runs, and its header shows "started by another workflow (depth 1)". |
| G-03 | Never triggers itself | *Lead updated* → Update lead (score 50). Edit a lead by hand. | One run; the workflow's own update doesn't start another run. |
| G-04 | After finish | *Lead updated* + "Again after previous finished" + Wait 5 min. Edit the lead twice within 5 min. | Only one run while it waits; after it finishes, the next edit starts a new run. |
| G-05 | Manual + once | Manual start on a record that already ran an "Only once" workflow. | Refused: "…already been through this workflow…". |

## H. Failures and retry

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| H-01 | Failure visible | Change lead status → a status; deactivate that status after publishing; trigger. | Execution **Failed**; the red box shows the reason; the workflow's timeline shows "execution failed". |
| H-02 | Retry | Reactivate the status → **Retry from the failed step**. | The step runs again, the execution completes, and steps after it run once. |
| H-03 | No duplicate on retry | A workflow with Create task → Change status (failing as in H-01). Retry after fixing. | Still exactly **one** task. |
| H-04 | Run-as deactivated | Deactivate the publisher; trigger. | Failed with RUN_AS_INVALID; publish again as another admin → new runs succeed. |
| H-05 | Cancel / pause one run | On a waiting execution: Pause → Resume → Cancel. | The status follows; a cancelled run never continues. |

## I. Test mode

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| I-01 | Nothing changes | Test a workflow with Create task, Send message, Notify, Webhook, Change status. | Every action **simulated** with a "Would …" summary; no task / message / notification / webhook / status change in reality. |
| I-02 | Waits skipped | Test a workflow with a 30-day wait. | Completes at once; the wait step shows "would resume at" in 30 days. |
| I-03 | Not in live list | After tests, open Executions with the default (Live) filter. | Test runs are not listed; Mode = Tests shows them. |
| I-04 | Draft vs live | Change the draft, save, test with Version = Draft and then Live. | Each trace reflects its own version. |

## J. Other

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| J-01 | Template in use | Archive the WhatsApp template used by an **active** workflow. | Refused: the template is used by Workflow "…". Pause/archive the workflow or change the step first. |
| J-02 | Audit / timeline | Open CRM → Activity Log (workflow events are listed there), or the ERP audit log for table `crm_workflows`. | "Workflow created", "draft saved", "published", "paused", … each with the user and time. |
| J-03 | Archive / restore | Archive → find it with Status filter "Archived" → Restore. | Restored as **Draft**; publish again to run. |
