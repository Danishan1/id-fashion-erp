# 2. Getting started — your first workflow

**Goal:** when a new lead arrives from the website, create a call task for its owner due today, and add a note to the lead.

Time: about 10 minutes. You need CRM Settings → Edit, at least one lead you can see, and one lead source called "Website" (or any source you use).

---

## Step 1 — Create the workflow

1. Open **CRM → Workflows**.
2. Click **New workflow**.
3. Fill in:
   - **Name:** `Website lead — call today`
   - **Description:** `Every new website lead gets a call task for its owner.`
   - **Trigger:** `Leads → Lead created`
4. Click **Create draft**. The workflow opens on the **Builder** tab. Its status is **Draft** and the badge shows **Draft v1**.

## Step 2 — Limit it to website leads (enrolment conditions)

In section **1. Trigger — when does it start?**, under **Only start when (enrolment conditions)**:

1. Click **+ Condition**.
2. **Field:** `Source` · **Operator:** `is` · **Value:** `Website`.

> Why here and not in an If / else step? Enrolment conditions stop non-matching records from entering at all, so they never appear as executions. Use If / else for decisions **inside** the workflow.

## Step 3 — Add the steps

In section **2. Steps**:

1. Click **+ Action**. Step `n1` appears and is set as the **First step** automatically.
   - **Step name:** `Call task`
   - **Action:** `Tasks → Create task`
   - **Type:** `Call`
   - **Subject:** `Call {{lead.full_name}} ({{lead.company_name|no company}})`
   - **Due in (days):** `0` (today)
   - **Priority:** `High`
   - **Assign to:** `The record's owner`
   - **If it fails:** `Stop the execution (failed)`
2. Click **+ Action** again. Step `n2` is added and `n1 → Then go to` is set to `n2` automatically.
   - **Step name:** `Welcome note`
   - **Action:** `Records → Add note`
   - **Note:** `Website lead received. Call task created for the owner.`
   - **Then go to:** `— end of workflow —`

> `{{lead.full_name}}` is a **merge field**: it is replaced with the lead's name when the step runs. `|no company` is a fallback, used when the lead has no company name. All merge fields are listed in [05-actions.md](05-actions.md).

## Step 4 — Check the settings

In section **3. Settings**:

- **Time zone:** `Asia/Kolkata` (used for waits and due times).
- **Can a record enter again?** `Again after the previous run finished`. This is the default; it is fine here because a lead is only *created* once.
- Leave "Let changes made by other workflows start this workflow" **off**.

Click **Save draft**, then **Validate**.

- No problems: nothing red appears.
- Problems: a red list appears and the faulty step gets a red border. Each line says what to fix (e.g. "Subject is required.").

## Step 5 — Test it without changing anything

1. Open the **Test run** tab.
2. **Record type:** Lead. **Record:** search for a lead whose source is Website.
3. Click **Run test (dry run)**.

You should see:

- a green box: *"This record matches the enrolment conditions"*. Under it, each condition is listed with the record's actual value and `true` / `false`. Reference fields such as Source, Status or Owner show the internal id rather than the name;
- an execution marked **Test — nothing was changed or sent**;
- two steps, both marked **simulated**. Open **Input / output** to see the task that *would* be created, with the subject already filled in, e.g. "Call Rahul Sharma (ABC Textiles)".

Now pick a lead from **another** source and test again. The box turns amber: *"This record would NOT be enrolled"*. The test still shows the steps so you can see them, but a live trigger would not start this workflow for that lead.

## Step 6 — Publish

Click **Publish**. The status becomes **Active**, the badge shows **Live v1**, and the header shows **runs as <your name>**.

If publishing is refused, a red list explains why (for example "You don't have crm.create — needed for 'Create task'", or "A step uses a lead status that no longer exists").

## Step 7 — See it work for real

1. Create a new lead with source **Website** and an owner (CRM → Leads → New).
2. Wait about 15 seconds, then open the workflow's **Executions** tab. There is one execution with status **Completed**.
3. Open it: both steps are **completed**.
4. Open the lead. The call task is on the owner's **My Tasks**, and the note is on the lead's timeline.

## Step 8 — Change it safely

Suppose you want the task due tomorrow instead.

1. On the **Builder** tab, change **Due in (days)** to `1`. A red **Unsaved changes** badge appears.
2. Click **Save draft**. The header now shows **Live v1** and **Draft v2**.
3. Test it again on the **Test run** tab with **Version: Draft v2**.
4. Click **Publish**. v2 is live, and v1 shows as *Superseded* on the **Versions** tab.

If you change your mind before publishing, **Discard draft** throws v2 away. The live version is untouched.

---

Next: [03-triggers.md](03-triggers.md) — choosing the right trigger.
