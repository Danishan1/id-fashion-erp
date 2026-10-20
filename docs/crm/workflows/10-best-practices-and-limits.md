# 10. Best practices, limits and FAQ

## Design tips that save trouble

1. **One purpose per workflow.** "Website lead follow-up" and "Big order alert" should be two workflows, not one with a giant Branch. Small workflows are easier to test, pause and change.
2. **Filter at the door.** Put "who is this for" in the **enrolment conditions**, not in an If / else at step 1. Non-matching records then never create executions, and the list stays clean.
3. **Always add exit conditions to long workflows.** Anything with a wait of more than a day should exit when the record is converted, won, lost, closed or archived.
4. **Use a Goal after each wait.** "Wait 3 days → Goal (already done?) → act" stops reminders for work that is already finished.
5. **Name your steps.** "Call task", "Escalate to manager" read far better in the trace than `n4`.
6. **Pick the right "record's owner".** If records may arrive without an owner, put *Assign owner* before any step that uses "the record's owner".
7. **Make optional steps tolerant.** For messages and webhooks that are "nice to have", choose *Record the error and continue*.
8. **Keep business hours.** Follow a duration wait with *Wait until 09:30 on working days* before anything customer-facing.
9. **Avoid duplicates between workflows.** Two active workflows on overlapping triggers (e.g. *Lead created* and *Lead captured*) both run. Use enrolment conditions to keep them apart.
10. **Chain workflows deliberately.** Chaining (A tags, B reacts) only works if B allows changes from other workflows. Keep chains short (max 3 levels); prefer one workflow if possible.
11. **Publish with the right person.** The publisher becomes the run-as user. Use an account that stays active and can see all relevant records ("View all CRM records"); otherwise the workflow can't act on records that person can't see.
12. **Test every path, then publish, then watch the first live runs.** Check the Executions tab after the first few real triggers.

## Choosing the right control

| You want… | Use |
|---|---|
| Only some records to enter | Enrolment conditions |
| Two paths inside the workflow | If / else |
| Three or more paths | Branch (most specific first) |
| To stop as a **success** when the work is done | Goal |
| To stop on a path with a reason | Exit step |
| To stop **anywhere** when something changes | Exit conditions (Settings) |
| A delay | Wait (duration) |
| Business hours | Wait until a time of day, with weekdays |
| A date-based reminder | Wait until a date on the record (with an offset) |
| A short stop for maintenance | **Pause** the workflow (runs continue afterwards) |
| To stop and drop running records | **Disable** the workflow |

## Limits

| Limit | Value | Why |
|---|---|---|
| Steps per workflow | 100 | Keeps workflows understandable |
| Conditions per condition list | 50, nested up to 4 levels | Same |
| Branches per Branch step | 10 | Same |
| Longest wait | 365 days | — |
| Steps one run can take | 300 | Protection against runaway workflows |
| Starts of one workflow for one record | 20 per hour | Protection against trigger storms |
| Workflow chain depth | 3 | Loop protection |
| Reaction time | Usually a few seconds, at most about 15 seconds | Background scheduling |
| Catch-up after the worker was down | Events from the last 24 hours | — |
| Webhook reply time | 10 seconds; response capped at 64 KB | — |
| Automatic retries (temporary errors) | 3, after 1 min / 5 min / 30 min | — |

## Not available yet

These depend on parts of the CRM that are not built yet. They appear in the editor as unavailable, with the reason:

- Triggers: **Form submitted**, **Import completed** (use *Lead imported*), **Bulk job completed**, **Custom object created**, **Date reached** (use a Wait until a date on the record).
- Actions: **Start / stop a sequence**, **Run a bulk action**, **Create a custom object**, **Start a new conversation** (messages go into an existing conversation).
- A **visual canvas** builder. The current editor is form-based, plus *Edit as JSON*.

## FAQ

**I published a workflow; why didn't it run on my existing leads?**
Workflows react to events that happen *after* publishing. Use *Start for real on this record* (file 07), or a manual-trigger copy, for existing records.

**I changed the workflow. Do records already inside it follow the new steps?**
No. A run always finishes on the version it started with. Only new runs use the new version. To move records onto the new logic, cancel their runs and start them again manually.

**I edited a step but nothing changed.**
Either you didn't **Save draft** and **Publish** (check the header for "Unsaved changes" or a "Draft vN" badge), or the record is still on the old version (see above).

**Can a workflow send emails or WhatsApp messages on its own?**
Yes, through *Send message from template*, into the contact's existing conversation on that channel. Do-not-contact and consent rules are always respected.

**Will a workflow ever message the same customer twice by mistake?**
A single step never sends twice, including on retry. Two different workflows (or two steps) sending the same template will each send. Design them to avoid overlap.

**What does "runs as" mean, and what if that person leaves?**
Actions are performed with that person's permissions and appear under their name, marked as done by a workflow. If the account is deactivated, runs fail with RUN_AS_INVALID. Another admin should **Publish** again (the workflow then runs as them), and **Retry** the failed runs.

**Who can see workflows?**
Users with CRM Settings → View. Changing, testing and publishing need CRM Settings → Edit.

**Can I undo what a workflow did?**
Not automatically. Every change is on the record's timeline, with the workflow marked, so you can correct it by hand. Use **Test run** to avoid surprises.

**How do I stop everything quickly?**
**Pause** the workflow: no new runs start, and running ones hold. Use **Disable** if the running ones should be dropped.

**Where do I report a problem?**
Note the **execution id** (shown in the execution's URL) and the failed step's error. The trace contains everything support needs.
