# 8. Recipes: ready-made workflows for a garment business

Each recipe gives:

- **why** the workflow is useful;
- **exactly what to enter**;
- **how to test it**;
- **what you should see**.

Build them on the Builder tab as described in [02-getting-started.md](02-getting-started.md). Step ids (`n1`, `n2`, …) are created automatically. The "go to" columns below use them.

Replace example values (statuses, stages, users, templates) with your own.

---

## Recipe 1: Website enquiry — route, call, escalate

**Why:** Buyers who fill in the website form expect an answer the same day. This makes sure every enquiry gets an owner and a call task, and escalates to the manager if nobody called within 2 days.

| | |
|---|---|
| **Trigger** | Leads → Lead captured |
| **Enrolment** | Archived is no |
| **Settings** | Re-entry: Only once per record. Exit when: Status kind is any of Converted, Lost. |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 "Route by country" | Branch | 1. **India**: Country is any of `India` → n2 · 2. **GCC**: Country is any of `UAE, Saudi Arabia, Qatar, Oman, Kuwait, Bahrain` → n3 · Otherwise → n4 | — |
| n2 | Action: Assign owner | Owner: *Domestic sales lead* | n5 |
| n3 | Action: Assign owner | Owner: *Middle-East export manager* | n5 |
| n4 | Action: Assign owner | Owner: *Export sales head* | n5 |
| n5 "Call task" | Action: Create task | Call · `Call {{lead.full_name}} — website enquiry` · due in 0 days · High · Assign to: record's owner | n6 |
| n6 | Wait | For a duration: 2 days | n7 |
| n7 "Already contacted?" | Goal | Last contacted is within the last 2 days | n8 |
| n8 "Escalate" | Action: Notify users | Specific users: *Sales manager* · Title `Website lead not contacted: {{lead.full_name}}` · Message `Owner has not contacted {{lead.full_name}} ({{lead.company_name|no company}}) for 2 days.` | end |

**Test it**
- Test run on leads with country India, UAE and Germany. The trace should take branch **India**, **GCC** and **default** respectively.
- The Wait shows *would resume at* now + 2 days.
- The Goal: with the test data, *Last contacted* is usually empty, so it continues to n8.

**Expected (live):** a new website lead from Dubai is owned by the Middle-East manager within seconds and has a High call task due today. If nobody logs contact for 2 days, the sales manager gets a notification. If the lead is converted or lost first, the run **exits**.

---

## Recipe 2: Trade-fair lead list — next-day follow-up

**Why:** After a fair you import hundreds of visiting cards. Each one needs a follow-up, spread across the team, without anyone forgetting.

| | |
|---|---|
| **Trigger** | Leads → Lead imported |
| **Enrolment** | Email is not empty **or** Phone (any) is not empty (group: *Any of these*) |
| **Settings** | Re-entry: Only once per record |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 | Action: Add tags | New tag names: `fair-2026` | n2 |
| n2 | Action: Update lead | Temperature: Warm · Next follow-up in: 1 day | n3 |
| n3 | Action: Create task | Task · `Follow up {{lead.full_name}} from the fair` · due in 1 day · due time `10:00` · Assign to: record's owner | end |

**Tip:** if the import doesn't set owners, add an *Assign owner* step first, or the task step fails with "no owner".

**Test:** import a small CSV with 3 rows, one without email or phone. Two executions should appear, each with the tag, the temperature and a task due tomorrow at 10:00. No execution should appear for the row without email or phone.

---

## Recipe 3: Sample sent — chase buyer feedback

**Why:** Samples go out but feedback isn't chased, and the order slips. This reminds the owner after 5 working days and nudges them again later.

| | |
|---|---|
| **Trigger** | Opportunities → Opportunity stage changed |
| **Enrolment** | New stage is *Sample Sent* |
| **Settings** | Re-entry: Again after the previous run finished. Exit when: Status is any of Won, Lost, Abandoned. |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 | Wait | For a duration: 5 days | n2 |
| n2 | Wait | Until a time of day: `10:00`, MON–SAT | n3 |
| n3 "Moved on?" | Goal | Stage is not *Sample Sent* | n4 |
| n4 | Action: Create task | Call · `Get sample feedback: {{opportunity.name}}` · due in 0 days · Assign to: record's owner | n5 |
| n5 | Wait | For a duration: 7 days | n6 |
| n6 | Goal | Stage is not *Sample Sent* | n7 |
| n7 | Action: Notify users | Record's owner + manager (Specific users) · `Sample feedback still pending: {{opportunity.name}}` | end |

**Why two waits in a row?** 5 days later might be 22:00 on a Sunday. The second wait moves the task to the next working morning at 10:00.

**Test:** test-run an opportunity with simulated trigger data `{ "toStageId": "<Sample Sent stage id>" }`. Check that the enrolment box is green and that the trace shows *would resume* times for both waits. Then move a real opportunity to Sample Sent. It shows **Waiting** with *Next run* in 5 days. Move it to the next stage and win it: the run **exits** at its next check.

---

## Recipe 4: Big order alert to management

**Why:** Management wants to know immediately about large opportunities so they can support the deal (pricing, capacity).

| | |
|---|---|
| **Trigger** | Opportunities → Opportunity created |
| **Enrolment** | Value is at least `1000000` |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 | Action: Add tags | New tag names: `key-account` | n2 |
| n2 | Action: Notify users | Specific users: *Directors* · `Large opportunity: {{opportunity.name}}` · `{{opportunity.value}} for {{company.name|unknown company}}, owner {{opportunity.owner}}.` | end |

**Variant:** use *Opportunity updated* with the same condition and re-entry **Only once per record**. That also catches deals that *grow* past ₹10 lakh, but alerts only once per deal.

---

## Recipe 5: Lost on price — win-back after 60 days

**Why:** Buyers who left over price often come back next season. This creates a reminder to re-quote.

| | |
|---|---|
| **Trigger** | Opportunities → Opportunity lost |
| **Enrolment** | Reason contains `price` |
| **Settings** | Re-entry: Again after the previous run finished. Exit when: Status is Open (it was reopened in the meantime). |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 | Action: Add note | `Lost on price: {{opportunity.name}}. Win-back reminder in 60 days.` | n2 |
| n2 | Wait | For a duration: 60 days | n3 |
| n3 | Action: Create task | Call · `Re-quote {{opportunity.name}} — lost on price 60 days ago` · due in 0 days · Assign to: record's owner | end |

**Test:** mark a test opportunity lost with reason "Price too high vs competitor". An execution appears and waits 60 days. Mark it lost with reason "Delivery time": no execution.

---

## Recipe 6: Appointment no-show — reschedule

**Why:** A buyer who missed a showroom visit should get a quick, polite reschedule call.

| | |
|---|---|
| **Trigger** | Tasks & appointments → Appointment no-show |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 | Action: Create task | Call · `Reschedule visit: {{appointment.title}}` · due in 0 days · High · Assign to: record's owner (for an appointment, its assignee) | n2 |
| n2 | Action: Send message from template | Template: *Missed appointment — reschedule (WhatsApp)* · If it fails: **Record the error and continue** | end |

**Why "continue" on the message?** Some contacts have no WhatsApp conversation or have opted out. The call task is the important part and has already been created.

**Test:** mark a test appointment No-show. The call task appears. Check the trace: the message step is completed, or failed with a reason, and the run is **Completed** either way.

---

## Recipe 7: Inbox — unanswered customer message

**Why:** Customers on WhatsApp expect quick replies. If a message sits unread for 30 minutes, alert the assignee.

| | |
|---|---|
| **Trigger** | Conversations → Message received |
| **Enrolment** | Status is not Closed |
| **Settings** | Re-entry: Again after the previous run finished (one reminder at a time per conversation) |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 | Wait | For a duration: 30 minutes | n2 |
| n2 "Still unread?" | If / else | Unread messages is greater than `0` | yes → n3 · no → end |
| n3 | If / else | Assigned to is not empty | yes → n4 · no → n5 |
| n4 | Action: Notify users | Record's owner · `Customer waiting 30 min` · `Unanswered message in the Inbox.` | end |
| n5 | Action: Assign conversation | User: *Inbox supervisor* | end |

For a conversation, the "record's owner" is the user it is assigned to.

---

## Recipe 8: Close date approaching

**Why:** Deals stall near their expected close date without anyone noticing.

| | |
|---|---|
| **Trigger** | Opportunities → Opportunity created |
| **Enrolment** | Expected close date is not empty |
| **Settings** | Exit when: Status is any of Won, Lost, Abandoned |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 | Wait | Until a date on the record: *Expected close date*, offset `-4320` (3 days before) | n2 |
| n2 | Action: Notify users | Record's owner · `{{opportunity.name}} closes in 3 days` · `Stage: {{opportunity.stage}}, probability {{opportunity.probability}}.` | end |

**Limitation:** the date is read when the wait starts. If the close date is moved later, the reminder still uses the old date. Add an If / else after the wait (*Expected close date is within the next 4 days*) to skip outdated reminders.

---

## Recipe 9: Manual checklist — buyer visit preparation

**Why:** Before a buyer visits, the same 3 tasks are always needed. One click creates them.

| | |
|---|---|
| **Trigger** | Started manually · Runs on: Company |
| **Settings** | Re-entry: Every time |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 | Action: Create task | Task · `Prepare sample range for {{company.name}}` · due in 1 day · Assign to: record's owner | n2 |
| n2 | Action: Create task | Task · `Book meeting room / showroom` · due in 1 day · Assign to: run-as user | n3 |
| n3 | Action: Create task | Task · `Print price list & catalogue for {{company.name}}` · due in 2 days · Assign to: record's owner | end |

**Use:** open the workflow → Test run → pick the company → **Start for real on this record**.

---

## Recipe 10: Won deal → notify the reporting system

**Why:** The MIS / BI system should know about won deals without manual exports.

| | |
|---|---|
| **Trigger** | Opportunities → Opportunity won |

| Step | Type | Settings | Go to |
|---|---|---|---|
| n1 | Action: Call a webhook | URL `https://bi.example.com/hooks/crm-won` · Include the record's fields: yes · Extra JSON `{"event":"deal_won"}` · If it fails: Record the error and continue | n2 |
| n2 | Action: Add tags | New tag names: `won-2026` | end |

Give the receiving team the **webhook signing secret** and the verification rules in file 05. The secret is only shown when it is generated: open the Details & secret tab, choose **Rotate secret** (if the receiver is already live, it must switch to the new secret at the same time) and copy the value from the one-time display. For a stream of CRM events rather than one call per workflow, see Outgoing webhooks (CRM Settings → Integrations, Phase 22).
