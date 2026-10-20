# 3. Triggers — when does a workflow start?

The trigger is the event that starts a workflow. Each workflow has exactly one trigger, chosen when you create it. You can change it later on the Builder tab (the enrolment conditions are reset when you do).

## How triggers behave

- **Only active workflows react.** Drafts, paused, disabled and archived workflows ignore events.
- **Nothing that happened before publishing counts.** Publishing doesn't "catch up" on old leads. To run a workflow on existing records, use a manual start (see the bottom of this page).
- **Exactly once.** One event starts the workflow at most once per record, even if the system is busy or restarted.
- **Enrolment conditions are checked at trigger time.** If the record doesn't match then, it doesn't enter. It is not re-checked later.
- **Changes made by workflows don't trigger other workflows** unless the receiving workflow opts in (Settings → "Let changes made by other workflows start this workflow"). A workflow is **never** triggered by its own changes. This prevents endless loops (see file 10).
- **Trigger data.** Some triggers carry extra facts about the event, for example the previous and new stage. These appear in the condition field list as fields like *New stage* or *Previous owner*, and can be used in enrolment conditions and in any If / else or Branch step.

## All triggers

### Leads

| Trigger | Fires when | Extra trigger data | Typical use |
|---|---|---|---|
| Lead created | Any new lead: typed in, imported or captured | Capture channel | Welcome tasks, assignment |
| Lead imported | A lead created by a CSV / Excel import | Capture channel | Follow-up for trade-fair contact lists |
| Lead captured | A lead from a website form, the capture API, a webhook or an integration | Capture channel | Fast response to inbound enquiries |
| Lead updated | Lead details edited | — | Re-scoring after details are completed |
| Lead status changed | The lead moved to another status | Previous status, New status | Act on "Qualified", "Lost"… |
| Lead owner changed | The lead was assigned or reassigned | Previous owner, New owner | Notify the new owner |
| Lead converted | The lead was converted | — | Kick off onboarding for the new opportunity |

> "Lead created" also fires for imported and captured leads. If you have a separate "Lead imported" workflow, add the enrolment condition *Capture channel is none of `CSV, XLSX`* to the general one, or the same lead goes through both.

### Contacts and companies

| Trigger | Fires when | Extra trigger data |
|---|---|---|
| Contact created | A new contact | — |
| Contact updated | Contact details edited | — |
| Contact owner changed | Assigned or reassigned | Previous owner, New owner |
| Contact preferences changed | Do-not-contact / consent changed | — |
| Company created | A new company | — |
| Company updated | Company details edited | — |
| Company status changed | The company moved to another status | — |
| Company owner changed | Assigned or reassigned | Previous owner, New owner |

### Opportunities

| Trigger | Fires when | Extra trigger data |
|---|---|---|
| Opportunity created | A new opportunity | — |
| Opportunity updated | Value, close date… edited | — |
| Opportunity stage changed | Moved to another stage, or to another pipeline | Previous stage, New stage, Pipeline, Change type |
| Opportunity won / lost / reopened | Any status change | Previous status, New status, Reason |
| Opportunity won | Marked won | Previous status, New status, Reason |
| Opportunity lost | Marked lost **or abandoned** | Previous status, New status, Reason |
| Opportunity owner changed | Assigned or reassigned | Previous owner, New owner |

> **"Stage changed" + condition *New stage is …*** is the usual pattern, for example *New stage is "Sample Sent"*. Without that condition the workflow runs on every stage move.

### Tasks and appointments

| Trigger | Fires when | Extra trigger data |
|---|---|---|
| Task created | A task, call or meeting was scheduled | Activity type, Was overdue |
| Task completed | A task, call or meeting was completed | Activity type, Was overdue |
| Appointment booked | A new appointment | Appointment status, Previous status, Appointment type |
| Appointment confirmed | Confirmed by the team | same |
| Appointment rescheduled | Moved to another time | same |
| Appointment cancelled | Cancelled | same |
| Appointment completed | Marked done | same |
| Appointment no-show | The customer didn't come | same |

The record a task / appointment workflow runs on is the **activity itself**. Actions such as *Create task* and *Add note* work on it; *Send message* uses its linked contact.

### Conversations (Inbox)

| Trigger | Fires when | Extra trigger data |
|---|---|---|
| Message received | A customer message arrived in the Inbox | Channel, Message type |
| Message failed | An outgoing message could not be delivered | Channel, Message type |
| Conversation started | A new conversation | Channel, Message type |
| Conversation assigned | Assigned or reassigned | — |
| Conversation closed | Closed | — |

### Tags (any record)

| Trigger | Fires when | Extra trigger data |
|---|---|---|
| Tag added | A tag was added to a lead, contact, company or opportunity | Tag |
| Tag removed | A tag was removed | Tag |

Tag workflows can run on several record types, so only the fields that **all** of those types share are offered in conditions (name, owner, tags, created / updated dates…). Almost always add the condition **Tag is "<your tag>"**.

### Started manually

| Trigger | Use |
|---|---|
| Started manually | The workflow never starts on its own. You choose the record type (*Runs on*). It is started from the **Test run** tab → **Start for real on this record**, or through the API. |

Use manual workflows for checklists you run on demand, e.g. "Prepare for buyer visit" or "Re-engage this old lead".

## Not available yet

These are shown as unavailable in the editor because the modules they depend on are not built yet:

- **Form submitted**: CRM forms (Phase 13+). Use *Lead captured*; website forms that post to the capture API already produce leads.
- **Import completed**: there is no "whole import finished" event. Use *Lead imported*, which runs per lead.
- **Bulk job completed**, **Custom object created**: not built yet.
- **Date reached** (e.g. "3 days before the expected close date"): use a *Wait until a date on the record* step instead (file 06).

## Running a workflow on existing records

Publishing doesn't process old records. Options:

1. Create a copy with the **Started manually** trigger (**Duplicate**, then change the trigger) and start it record by record from the Test run tab.
2. Make a small change to the records so the trigger fires again (e.g. add a tag), together with a **Tag added** workflow.
