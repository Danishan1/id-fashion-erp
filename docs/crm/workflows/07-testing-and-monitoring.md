# 7. Testing and monitoring

## 7.1 Test run (dry run): try before you publish

**Where:** a workflow → **Test run** tab.

| Field | What to choose |
|---|---|
| Record type | Offered according to the trigger (e.g. Lead) |
| Record | Search for a **real** record you can see |
| Version | **Draft vN** (what you are editing) or **Live vN** (what is running) |
| Simulated trigger data | Optional JSON for conditions on trigger data, e.g. `{ "toStageId": "<stage id>" }` |

Click **Run test (dry run)**.

### What a test does and doesn't do

| Does | Doesn't |
|---|---|
| Reads the record's real current values | Change any record |
| Evaluates every condition for real | Send any message or notification |
| Walks the steps in order, following the real If / else and Branch paths | Call any webhook |
| Works out what each action **would** do: the final task subject with merge fields filled in, which template version would be sent, which stage, etc. | Wait. Waits are skipped and only show when they *would* resume. |
| Checks the action is possible, e.g. the record has an owner and the contact has a conversation on the template's channel | Count as a live run, or affect re-entry |

The result shows:

1. **The enrolment box.** Green: *matches the enrolment conditions*. Amber: *would NOT be enrolled*. Below it, each condition is listed with the record's actual value and `true` / `false`. The test runs the steps either way so you can check them.
2. **The trace.** Each step with a coloured status (**simulated**, completed, failed), the path taken (e.g. `→ yes`, `→ India`), and **Input / output** with the details.

> **Save first.** Tests run the **saved** version. If the header shows *Unsaved changes*, click **Save draft** before testing.

### Good test habits

- Test with at least **one record that should enter** and **one that shouldn't**.
- Test **every path**. For a Branch with 3 branches, find (or prepare) a record for each branch, plus one for the default path.
- After a change, test the **draft** before publishing.
- For conditions on trigger data (e.g. *New stage is Sample Sent*), give the value in **Simulated trigger data**. Reference values (stage, status, user, tag) are internal ids; a CRM admin can read them from the record pages or the API.

## 7.2 Start for real on one record

On an **active** workflow, the Test run tab also shows **Start for real on this record**. This starts a **live** run immediately on the chosen record, whatever the trigger, and actions really happen.

Use it for:

- workflows with the **Started manually** trigger;
- running a new workflow on an existing record (publishing doesn't process old records);
- re-running a workflow after a fix.

Re-entry rules apply: a record that already went through an "Only once per record" workflow is refused, with a message.

## 7.3 Executions: watching live runs

- **One workflow:** open it → **Executions** tab.
- **All workflows:** CRM → Workflows → **All executions**.

| Column | Meaning |
|---|---|
| Started | When the run began (click to open it) |
| Record | The lead / contact / … (click to open the record) |
| Status | See the status table in file 01; "(test)" marks test runs |
| Version | Which version the run uses |
| Trigger | What started it |
| Next run | For waiting runs: when it continues |
| Error / exit | Why it failed or exited |

Filters: **Status** (e.g. only Failed) and **Mode** (Live, which is the default, or Tests).

### Reading one execution

Open an execution to see:

- the header: workflow, version, trigger, record, start/finish time, number of steps, run-as user, who started it (for manual runs), and *started by another workflow (depth N)* if a chained workflow started it;
- a red box with the error code and message if it failed;
- the step list in order, with name, step id, status, the path taken, the attempt number when retried, and Input / output.

### What you can do with an execution

| Button | When | Effect |
|---|---|---|
| **Pause** | Queued or Waiting | Holds this one run. |
| **Resume** | Paused (and the workflow is Active) | Continues from where it stopped. A wait that already ended continues immediately. |
| **Cancel** | Queued, Waiting or Paused | Stops this run for good. |
| **Retry from the failed step** | Failed (and the workflow is Active) | Runs the failed step again, then continues. A message that actually went out the first time is **not** sent twice; a task is **not** created twice. |
| **Refresh** | Any | Reloads the trace. |

A run that is busy with a step at that very moment (Running) can't be paused or cancelled. Wait a second and try again.

## 7.4 Automatic retries

Some failures are temporary: someone edited the same record at the same moment, the system was busy, or a rate limit was hit. For these, the step is **retried automatically** after 1 minute, then 5, then 30. Meanwhile the run shows **Waiting**, and the trace shows the attempt number.

Messages, notifications, notes and webhooks are **never** retried automatically, because a retry could duplicate them. They fail and wait for a person to press **Retry**.

## 7.5 Troubleshooting

| Problem | What to check |
|---|---|
| No execution appears at all | 1) Is the workflow **Active**? 2) Did the event happen **after** publishing? 3) Run a **test** on that record: does it match the enrolment conditions? 4) Re-entry: has the record already been through ("Only once") or is its previous run still going? 5) Was the change made by another workflow? Those are ignored unless the setting is on. 6) Is the background worker running? |
| Execution stays **Queued** | The background worker isn't running. Ask IT to start it (`npm run worker`). |
| Execution stays **Waiting** past *Next run* | Same: the worker. Waits resume within about 15 seconds of their time when it runs. |
| **Failed: RUN_AS_INVALID** | The run-as user was deactivated or lost a permission. Publish again as an active user with the needed rights, then retry. |
| **Failed** on *Move opportunity stage* | The stage requires fields the opportunity doesn't have. The error lists them. |
| **Failed** on *Send message* | Template inactive, no conversation on that channel for the contact, or the contact opted out. |
| **Failed** on *Create task* with "no owner" | The record has no owner. Add *Assign owner* first, or assign to a specific user. |
| **Failed** on *Call a webhook* | Read the message: refused address (must be public https), timeout, or the receiver's error code. |
| Publish refused | Read the red list. Each item names the step and what to fix (missing setting, deleted status / stage / tag / user, inactive template, loop, step not reachable, missing permission). |
| "Workflow was changed by someone else" | Someone saved the same workflow at the same time. Reload the page and repeat your change. |
| Task or message created twice | This shouldn't happen. Check for **two workflows** doing the same thing, e.g. "Lead created" and "Lead captured" both active. |
