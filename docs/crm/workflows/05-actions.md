# 5. Actions — what a workflow can do

An **Action** step does one thing. Actions use the same CRM functions you use by hand, so:

- every change appears on the record's **timeline** and in the **audit log**, recorded as the **run-as user** (file 01) and marked as made by a workflow;
- the same rules apply: stage rules, required fields, do-not-contact and consent, record visibility;
- if you couldn't do it by hand (e.g. move to a stage that requires a missing field), the workflow can't either, and the step fails with the reason.

Each action is only offered for the record types it fits; unsuitable ones are greyed out ("not for this record type").

## Common settings on every action

| Setting | Meaning |
|---|---|
| **Step name** | Optional. Shown in the execution trace. Name important steps ("Call task", "Escalate"). |
| **If it fails** | **Stop the execution (failed)** (default): the run stops and shows as Failed; you can retry it later. **Record the error and continue**: the failure is noted in the trace and the run goes on. Use this for "nice to have" steps such as a webhook to a reporting tool. |
| **Then go to** | The next step, or "— end of workflow —". |

## Merge fields (`{{…}}`)

Text settings marked with merge-field help (task subject and description, note, notification title and message, won/lost reason, appointment note) can include values from the record:

```
Call {{lead.full_name}} from {{lead.company_name|unknown company}} — score {{lead.score}}
```

- `{{name}}` is replaced when the step runs. `{{name|fallback}}` uses the fallback when the value is empty.
- A value that can't be found is left empty; the step doesn't fail.
- `{{user.…}}` is the **run-as user** (the workflow's "sender").

| Group | Merge fields |
|---|---|
| Lead | `lead.full_name`, `lead.first_name`, `lead.number`, `lead.source`, `lead.status`, `lead.score`, `lead.company_name` |
| Contact | `contact.first_name`, `contact.last_name`, `contact.full_name`, `contact.email`, `contact.phone`, `contact.mobile`, `contact.whatsapp`, `contact.designation`, `contact.department`, `contact.company` |
| Company | `company.name`, `company.legal_name`, `company.email`, `company.phone`, `company.website`, `company.city`, `company.address` |
| Opportunity | `opportunity.name`, `opportunity.number`, `opportunity.value`, `opportunity.stage`, `opportunity.pipeline`, `opportunity.probability`, `opportunity.expected_close_date`, `opportunity.owner` |
| Appointment | `appointment.title`, `appointment.date`, `appointment.time`, `appointment.end_time`, `appointment.timezone`, `appointment.location`, `appointment.meeting_link` |
| User (run-as) | `user.name`, `user.first_name`, `user.email`, `user.phone` |

Values come from the record and the records linked to it. An opportunity workflow can use `opportunity.*`, plus `contact.*` and `company.*` of its linked contact and company.

> Always **test run** a step with merge fields. The simulated step shows the final text, e.g. *Would create "Call Rahul Sharma from ABC Textiles — score 72" due 2026-10-14*.

---

## Records

### Assign owner
*Leads, contacts, companies, opportunities*

- **Owner:** an active user.
- **Use it to:** route new leads, or re-assign records after a status change.
- **Fails when:** the user is no longer active.

### Add tags
*Leads, contacts, companies, opportunities*

- **Tags:** existing tags (pick several).
- **New tag names:** comma separated; tags that don't exist yet are created.
- **Use it to:** mark records for reporting or for other workflows ("Tag added" trigger), e.g. `website-hot`, `sample-followup`.

### Remove tags
*Leads, contacts, companies, opportunities*

- **Tags:** the tags to remove from the record.

### Add note
*Leads, contacts, companies, opportunities, conversations*

- **Note:** text with merge fields. Appears on the record's timeline.
- **Never retried automatically**, so a note can't be added twice.

## Leads

### Change lead status
- **Status:** any active lead status.
- You can't convert a lead this way. Converting creates a contact, company and opportunity and needs a person's decision.
- **Fails when:** the status has been deactivated since publishing.

### Update lead
- **Temperature** (Hot / Warm / Cold, or "Leave as is"), **Score (0–100)**, **Next follow-up in (days)** (counted from the moment the step runs).
- Only the settings you fill in are changed.

## Companies

### Change company status
- **Status:** any active company status.

## Opportunities

### Move opportunity stage
- **Stage:** any active stage, possibly in another pipeline.
- **Stage rules still apply.** If the stage requires fields (e.g. *Expected close date*), the move is refused and the step fails with the list of missing fields.

### Mark opportunity won / lost
- **Status:** Won, Lost, Abandoned or Reopen.
- **Reason:** text with merge fields.
- Closed opportunities can only be reopened; marking a closed opportunity won again fails.

### Update opportunity
- **Probability %**, **Expected close in (days)** from now. Only the filled settings change.

## Tasks and appointments

### Create task
*Any record type*

| Setting | Meaning |
|---|---|
| Type | Task, Call or Meeting |
| Subject / Description | Text with merge fields |
| Due in (days) | `0` = today, `1` = tomorrow … Empty = no due date |
| Due time | `HH:mm` in the workflow's time zone (e.g. `10:30`) |
| Priority | Normal, Low, High, Urgent |
| Assign to | **The record's owner** (for a task / appointment: its assignee; for a conversation: the user it is assigned to), **The workflow's run-as user**, or **A specific user** |

- The task is linked to the record and appears in the assignee's **My Tasks**.
- **Created only once per step, even if the step is retried.** A retry never duplicates a task.
- **Fails when:** "The record's owner" is chosen but the record has no owner. Add an *Assign owner* step before it, or choose a specific user.

### Update appointment
*Appointment workflows only (Tasks & appointments triggers)*

- **Change:** Confirm, Cancel, Complete or No-show.
- **Reason / note:** text with merge fields.
- The appointment's normal rules apply (e.g. a cancelled appointment can't be confirmed).

## Conversations (Inbox)

### Assign conversation
- **User:** active user. The conversation is assigned as if done from the Inbox.

### Change conversation status
- **Status:** Open, Pending or Closed.

### Send message from template
*Any record type*

- **Template:** any **active** message template (CRM → Templates). The template decides the channel (email, SMS, WhatsApp) and the text.
- **Where it is sent:**
  - in a conversation workflow, into **that conversation**;
  - otherwise, into the **record's contact's latest conversation on the template's channel**.
- Merge fields in the template are filled from that conversation's contact and company, and from the run-as user.
- **Do-not-contact and consent rules are always checked.** A contact who opted out is not messaged; the step fails with the reason.
- **Never re-sent automatically.** If the outcome is unknown (e.g. the provider timed out), the step fails and waits for a person. A manual **Retry** is safe: a message that really went out is not sent a second time.
- **Fails when:** the template was deactivated, the contact has no conversation on that channel, or the contact opted out.
- Starting a **brand-new** conversation is not available yet.

> While a live workflow uses a template, that template **can't be archived**. Change the workflow first.

## Communication and integrations

### Notify users
*Any record type*

- **Notify:** the record's owner, the run-as user, or specific users.
- **Title / Message:** text with merge fields. Appears in the ERP notification bell.
- **Use it to:** escalate ("Lead not contacted in 2 days"), or tell a manager about a big order.
- **Never retried automatically**, so people are never notified twice.

### Call a webhook
*Any record type. Needs CRM Settings → Edit to publish.*

Sends a signed JSON message to another system (e.g. a reporting tool or Zapier).

| Setting | Meaning |
|---|---|
| URL (https) | Must be a public **https** address. Internal / private addresses (localhost, 10.x, 192.168.x, cloud metadata…) are refused at publish **and** at run time. |
| Include the record's fields | Adds the record's values to the message |
| Extra JSON fields | A fixed JSON object added as `data`, e.g. `{"source":"crm","team":"export"}` |

The message looks like:

```json
{
  "id": "…step key…",
  "type": "crm.workflow.webhook",
  "occurredAt": "2026-10-13T10:15:00.000Z",
  "workflow": { "id": "…", "name": "Website lead — call today" },
  "execution": { "id": "…" },
  "trigger": { "eventId": "…", "eventType": "lead.created" },
  "record": { "entityType": "LEAD", "entityId": "…", "fields": { "record.full_name": "…" } },
  "data": { "source": "crm" }
}
```

- **Security for the receiving system.** Each request carries `X-CRM-Signature: t=<unix time>,v1=<HMAC-SHA256 of "t.body">`, signed with the workflow's own secret (Details & secret tab → Reveal). The receiver should check the signature, reject messages older than 5 minutes, and de-duplicate on the `Idempotency-Key` header.
- **Delivery rules.**
  - The receiver must answer 2xx within 10 seconds. Redirects are not followed.
  - Not retried automatically; use *Record the error and continue* if the webhook is optional.

---

## Not available yet

| Action | Why |
|---|---|
| Start / stop a sequence | Sales sequences are not built yet |
| Run a bulk action | The bulk engine is not built yet |
| Create a custom object | Custom objects are not built yet |
| Start a new conversation | Messages go into an existing conversation only |
