# 4. Conditions — deciding who and which way

Conditions appear in five places, and they all work the same way:

| Where | Question it answers | When it is checked |
|---|---|---|
| **Enrolment conditions** (section 1 of the Builder) | Should this record enter the workflow at all? | Once, when the trigger fires |
| **If / else** step | Which of two paths? | When the step is reached |
| **Branch** step | Which of several paths? | When the step is reached |
| **Goal** step | Is the goal already achieved? | When the step is reached |
| **Exit conditions** (section 3, Settings) | Should this record leave the workflow now? | Before **every** step |

Conditions inside a running workflow always use the record's **current** values at that moment, not the values from when the workflow started. That is what makes "wait 2 days, then check whether the lead was contacted" work.

## Building a condition

Each condition is one row:

```
[ Field ▼ ]   [ Operator ▼ ]   [ Value ]   Remove
```

- **Field:** only fields from a fixed list can be used. The list depends on the record type of the trigger. It includes the record's own fields, its custom fields, the trigger data (e.g. *New stage*), and three common fields:
  - **Change made by (user):** the person whose action fired the trigger.
  - **Change made by a workflow:** yes when the trigger was caused by a workflow.
  - **Execution started:** when this run began.
- **Operator:** only operators that make sense for the field's type are offered.
- **Value:** a drop-down for statuses, stages, users, tags and fixed lists; a text box, number or date otherwise.

There are no formulas or code. This is deliberate, so a workflow can never run arbitrary logic.

## Groups: AND, OR, NOT

Every condition list is a **group**:

- **All of these (AND):** every row must be true.
- **Any of these (OR):** at least one row must be true.
- **NOT:** tick it to reverse the whole group.
- **+ Group** adds a group inside a group, up to 4 levels deep.

An **empty group always matches**. No enrolment conditions means "every record".

### Example: nested logic

"Hot website leads, **or** any lead worth more than ₹5 lakh, but never archived leads":

```
All of these (AND)
├─ Archived  is no
└─ Any of these (OR)                 ← + Group
   ├─ All of these (AND)             ← + Group
   │  ├─ Source       is  Website
   │  └─ Temperature  is  Hot
   └─ Estimated value  is greater than  500000
```

### Example: NOT

"Leads that are **not** from India or Bangladesh":

```
NOT ☑  All of these (AND)
└─ Country  is any of  India, Bangladesh
```

This is the same as *Country is none of India, Bangladesh*. Use whichever reads better.

## Operators

| Operator | Field types | Notes |
|---|---|---|
| is / is not | text, number, date, choice, reference | Text is compared **ignoring upper/lower case and extra spaces**. For dates, "is" compares the **day only**. |
| is any of / is none of | text, number, choice, reference | Pick several values. For text fields, type them separated by commas. |
| contains / does not contain | text | Ignores upper/lower case. `contains "export"` matches "ABC Exports Pvt Ltd". |
| starts with / ends with | text | Ignores upper/lower case. |
| is greater than / is at least / is less than / is at most | number | |
| is between | number | Type `min, max`; both ends are included. |
| is before / is after | date | Compares the exact date and time. |
| is within the last … days | date | Past dates only, e.g. last activity within the last 7 days. |
| is within the next … days | date | Future dates only, e.g. expected close within the next 14 days. |
| is more than … days ago | date | Good for "no activity for 30 days". |
| is yes / is no | yes-no fields | An empty value counts as **no**. |
| has tag / does not have tag | Tags | |
| is empty / is not empty | all except yes-no | Empty = no value, blank text or no tags. |

### How empty values behave

If the record has **no value** for a field:

- *is empty* is true; *is not empty* is false;
- *is not*, *is none of* and *does not contain* are **true**;
- every other operator is **false**.

> Example: *Email contains "@gmail.com"* is false for a lead without an email, so a lead without an email never goes down a "Gmail" path by accident.

A field that doesn't exist on a record (e.g. after a custom field is deleted) counts as empty. It never causes an error during a run, but **Validate** and **Publish** report unknown fields so you can fix them.

## If / else step

```
If / else  "Is the lead hot?"
  Temperature is Hot
  If yes, go to → n4 (Create urgent call)
  If no,  go to → n5 (Add to nurture)
```

Leaving a path as "— end of workflow —" ends the run on that path. That is fine, for example "if not hot, do nothing".

## Branch step

Use a Branch when there are more than two outcomes. Branches are checked **from top to bottom**; the **first** one that matches is taken. If none matches, the run follows **Otherwise (default) go to**.

```
Branch "Route by country"
  1. India        Country is India              → n10 (assign to Domestic team)
  2. Middle East  Country is any of UAE, Saudi  → n11 (assign to Export team A)
  3. Europe       Country is any of …           → n12
  Otherwise (default) go to                     → n13 (assign to Export lead)
```

Up to 10 branches. Order matters: put the most specific branch first.

## Using trigger data

For triggers that carry extra data (file 03), the fields appear with names like **New stage**, **Previous owner**, **Tag** or **Capture channel**.

- *Opportunity stage changed* + enrolment condition **New stage is "Sample Sent"** runs only when an opportunity enters Sample Sent, not on every stage move.
- *Lead owner changed* + **Previous owner is not empty** ignores the first assignment and only reacts to re-assignments.
- *Opportunity lost* + **Reason contains "price"** starts a "price objection" follow-up.

## Common mistakes

| Symptom | Likely cause |
|---|---|
| The workflow never starts | An enrolment condition is never true. Use a **test run** on a record that should match; the box shows each condition with true / false. |
| It starts for records it shouldn't | Missing condition on the trigger data (e.g. no *New stage is …* on a stage trigger). |
| An If / else always goes "No" | You compared a reference field to text. Choose the value from the drop-down. |
| A date condition doesn't match | *is before / is after* compare exact times; use *is within the last / next … days* for ranges. |
