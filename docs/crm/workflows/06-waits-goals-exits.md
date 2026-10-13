# 6. Waits, goals, exits and re-entry

These features control **time** and **when a record leaves** a workflow. They are what turn a list of actions into a real follow-up process.

## Wait step

A Wait pauses this record's run. Other records are not affected. While waiting, the execution shows **Waiting** and its **Next run** time.

Waits are **stored in the database**, not held in memory, so a restart, a deploy or a computer being switched off doesn't lose them. When the time comes, the run continues within about 15 seconds.

### The three kinds of wait

| Wait | Settings | Example | Behaviour |
|---|---|---|---|
| **For a duration** | Amount + minutes / hours / days | Wait 2 days | Continues exactly 2 × 24 h later. |
| **Until a time of day** | HH:mm, optionally weekdays | Until 09:00 on MON–FRI | Continues at the **next** 09:00 on an allowed day, in the workflow's **time zone** (Settings). If it is already past 09:00 today, it continues tomorrow (or the next allowed day). No days ticked = any day. |
| **Until a date on the record** | A date field + offset in minutes (negative = before) | Until *Expected close date* −1440 (1 day before) | Continues at that moment. If that moment has **already passed**, or the record has **no date**, it continues **immediately**. |

- The longest wait is 365 days.
- Daylight-saving changes (for time zones that use them) are handled: "09:00" is always 09:00 local time. A time that doesn't exist on the night clocks jump forward is moved one hour later.
- *Until a date on the record* reads the date **when the wait starts**. If someone changes the date later, the wait doesn't move. To handle moving dates, follow the wait with an If / else that checks the date again.

### Typical patterns

**Business-hours follow-up.** A lead arrives at 23:40 and you don't want the call task to appear at night:

```
Wait until 09:30 on MON, TUE, WED, THU, FRI, SAT  →  Create task "Call {{lead.full_name}}" due today
```

**"If nothing happened, escalate":**

```
Create task (call) → Wait 2 days → If / else: Last contacted is within the last 2 days
                                      yes → end
                                      no  → Notify sales manager
```

**Reminder before a date:**

```
Wait until Expected close date, offset −4320 (3 days before) → Notify owner "Close date in 3 days"
```

## Goal step

A Goal asks: *"Have we already achieved what this workflow is for?"*

- **Conditions match:** the run ends **Completed – Goal reached**.
- **Otherwise:** the run continues to the next step.

Place goals **after waits**, where "maybe it already happened" is likely:

```
Create task → Wait 3 days → GOAL "Lead qualified" (Status kind is Converted, or Status is Qualified)
                                   reached → done (shown as Goal reached)
                                   not yet → Notify manager → Wait 3 days → GOAL again → …
```

> Why use a Goal instead of If / else → end? Both stop the run, but a Goal is **reported as a success** ("Goal reached") in the executions list. That lets you see how many records reached the goal versus finished all steps without reaching it.

## Exit step

An Exit ends the run on purpose, with a **reason** shown in the trace (e.g. "Not an export lead"). The execution shows **Exited**.

Use it to make a path's end explicit. "— end of workflow —" does the same thing technically, but without a reason and shown as Completed.

## Exit conditions (Settings)

**Exit the workflow when** is checked **before every step** of every run. When it matches, the run stops immediately as **Exited** ("Exit conditions matched").

This is the safety net for long workflows. Examples:

| Workflow | Exit when |
|---|---|
| Lead nurture over 3 weeks | Status kind is Converted **or** Status kind is Lost **or** Archived is yes |
| Sample follow-up on an opportunity | Status is any of Won, Lost, Abandoned |
| Unanswered conversation reminders | Status is Closed |

Without exit conditions, a lead converted on day 2 would still receive the day-7 and day-14 reminders.

## Re-entry: can the same record go through again?

Settings → **Can a record enter again?**

| Option | Meaning | Use for |
|---|---|---|
| **Only once per record** | A record that has **ever** been through this workflow (live) never enters again. | Welcome / onboarding flows |
| **Again after the previous run finished** (default) | A record can enter again, but not while its previous run is still going. | Most workflows: stage changes, re-assignments |
| **Every time (runs can overlap)** | Every trigger starts a new run, even if one is still running. | Rare: e.g. "notify on every message received" |

For safety, a single record can start the same workflow at most **20 times per hour**, whatever this setting.

Manual starts (**Start for real on this record**) respect this setting. Test runs ignore it.

## Let changes made by other workflows start this workflow

Off by default. When **off**, a change made by **another** workflow (e.g. workflow A adds the tag "hot") does **not** start this workflow (e.g. workflow B on *Tag added*).

Turn it **on** only when you deliberately chain workflows (A tags, B reacts). Chains are limited to 3 levels, and a workflow is **never** started by its own changes, so there are no endless loops.
