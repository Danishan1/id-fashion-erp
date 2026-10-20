# 1. Concepts — the words you will see

Read this once. Every other file uses these terms.

## The parts of a workflow

```
 TRIGGER ──► ENROLMENT CONDITIONS ──► STEP ──► STEP ──► STEP …
 "Lead created"   "only if Source = Website"   Create task → Wait 2 days → If not contacted → Notify manager
```

| Part | What it is | Why it exists |
|---|---|---|
| **Trigger** | The event that starts the workflow, e.g. *Lead created* or *Opportunity stage changed*. One per workflow. | So the workflow reacts at the right moment, without anyone remembering to run it. |
| **Enrolment conditions** | Filters checked once, when the trigger fires ("only leads from the website"). | So one trigger doesn't start the workflow for records it isn't meant for. A record that doesn't match never enters, and nothing is recorded. |
| **Steps** | What happens next. There are six kinds (below). | The actual work. |
| **Settings** | Time zone, re-entry, exit conditions, and "let other workflows trigger this". | Control how often and how long a record stays in the workflow. |

## The six step types

| Step | In the editor | Use it to |
|---|---|---|
| **If / else** | *+ If / else* | Check conditions now and go one of two ways (Yes / No). |
| **Branch** | *+ Branch* | Choose between several paths: the first branch whose conditions match wins, otherwise the default path. |
| **Action** | *+ Action* | Do something: assign, tag, change status, create a task, send a message, notify, call a webhook… |
| **Wait** | *+ Wait* | Pause for a time (e.g. 2 days), until a time of day (e.g. 09:00), or until a date on the record. |
| **Goal** | *+ Goal* | "If this is already achieved, stop here as a success." For example: stop chasing once the lead is converted. |
| **Exit** | *+ Exit* | End the workflow at this point, with a reason. |

Steps are linked with **"go to"** choices (*Then go to*, *If yes, go to*, …). Choosing **"— end of workflow —"** finishes the run there. A workflow can't loop back to an earlier step; the editor refuses loops.

## Draft, publish and versions

- A new workflow is a **Draft**. Drafts never run on their own. You can save, change and test them as often as you like.
- **Publish** makes the draft the **live version** (v1, v2, …), and the workflow becomes **Active**.
- **A live version can never be changed.** When you edit an active workflow, you are working on a new draft (e.g. v3). The live version (v2) keeps running until you publish v3.
- Records already partway through a workflow **finish on the version they started with**. Publishing v3 doesn't change runs that are in progress.
- The *Versions* tab shows every version: who created and published it, when, and how many runs used it.

> Why: you can safely improve a workflow while it is live, and you can always see exactly which rules a given record went through.

## Workflow statuses (lifecycle)

| Status | Shown as | What happens | Buttons available |
|---|---|---|---|
| DRAFT | Draft | Never runs. | Publish, Archive |
| PUBLISHED | Active | New triggers start runs; waiting runs continue. | Pause, Disable, Archive |
| PAUSED | Paused | New triggers are **ignored**. Running records **hold** at their next step and continue when you resume. | Resume, Disable, Archive |
| DISABLED | Disabled | New triggers are ignored. All queued, waiting and paused runs are **cancelled**. | Resume (back to active), Archive |
| ARCHIVED | Archived | Stopped and hidden from the list (use the Status filter to see it). | Restore (back to draft; publish again to run) |

**Pause vs Disable.** Use **Pause** for a short stop, e.g. while you fix a template, when you want records to carry on afterwards. Use **Disable** when the running records should **not** continue.

## Executions

Each time a record enters a workflow, an **execution** (a "run") is created. It remembers:

- which record it is for and which version it runs;
- where it currently is, and when its next step is due (for waits);
- every step it went through, with the result: the **trace**.

| Execution status | Meaning |
|---|---|
| Queued | Created, about to run (normally only for a few seconds). |
| Running | A step is being carried out right now. |
| Waiting | Sitting on a Wait step, or waiting for an automatic retry. *Next run* shows when it continues. |
| Paused | Held because the workflow (or this run) was paused. |
| Completed | Reached the end, or a Goal was met ("Goal reached"). |
| Failed | A step failed and the step was set to stop on error. Can be retried. |
| Cancelled | Cancelled by a person, or because the workflow was disabled or archived. |
| Exited | Left early, through an Exit step or because the exit conditions matched. |

## The run-as user (who does the work)

A workflow acts **as the person who published it**, the *run-as user*. Everything the workflow does is recorded under that person's name, with a note that a workflow did it.

- When you publish, the system checks that **you** have every permission the actions need. If you don't, publishing is refused and the message says which permission is missing.
- Before **each action**, the permission is checked again. If the run-as user is deactivated or loses a permission, that run fails with a clear reason. **Publish again** (as an active user) to fix it.
- If the run-as user can only see their own records (no "View all CRM records" permission), the workflow can only act on records that user can see. The validation shows a warning about this.

> Tip: let a CRM admin or sales manager with full CRM access publish shared workflows.

## Test runs vs live runs

- A **test run** (the *Test run* tab) goes through the steps on a real record you choose. Conditions are checked for real, but **nothing is changed, sent or called**: every action only says what it *would* do, and waits are skipped. Test runs are kept separately and never mixed with live runs.
- A **live run** is started by the trigger, or by *Start for real on this record*.

## How fast does a workflow react?

A workflow usually starts within a few seconds of the event, and at most about **15 seconds** later. Waits end on time, within about 15 seconds. If the background worker was stopped, the workflow catches up on missed events from the last **24 hours** when the worker starts again.
