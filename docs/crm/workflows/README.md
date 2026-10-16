# CRM Workflows — User Guide

This folder explains **how to use CRM Workflows** (CRM → Workflows) in Fashion ERP.

It is written for the people who build and test automations: sales managers, CRM admins and testers. It is not developer documentation. For the technical design see `../PHASE_18_WORKFLOW_AUTOMATION.md`.

## What workflows do for you

A workflow is a rule that runs by itself:

> **When** something happens in the CRM → **if** the record matches your conditions → **do** these steps, waiting between them if needed.

Some examples:

- A new lead arrives from the website. Give it to the right sales person, create a call task for today, and if nobody has called within 2 days, notify the sales manager.
- An opportunity moves to "Sample Sent". Wait 5 days, then remind the owner to collect buyer feedback.
- A buyer misses an appointment. Tag the contact "No-show" and create a reschedule call.

Workflows only do what you could do by hand in the CRM, and they follow the same rules. Every change appears on the record's timeline and in the audit log.

## Reading order

| # | File | What you learn |
|---|---|---|
| 1 | [01-concepts.md](01-concepts.md) | The vocabulary: draft, publish, version, execution, run-as user, statuses |
| 2 | [02-getting-started.md](02-getting-started.md) | Build, test and publish your first workflow in about 10 minutes |
| 3 | [03-triggers.md](03-triggers.md) | Every trigger: when it fires and which extra data it gives you |
| 4 | [04-conditions.md](04-conditions.md) | Enrolment conditions, If / else, Branch, every operator, AND / OR / NOT |
| 5 | [05-actions.md](05-actions.md) | Every action, its settings, merge fields like `{{lead.full_name}}`, and what can fail |
| 6 | [06-waits-goals-exits.md](06-waits-goals-exits.md) | Waiting, goals, exit steps, exit conditions, re-entry |
| 7 | [07-testing-and-monitoring.md](07-testing-and-monitoring.md) | Test runs, reading an execution trace, pause / cancel / retry, troubleshooting |
| 8 | [08-recipes.md](08-recipes.md) | Ready-made workflows for a garment business, set up step by step |
| 9 | [09-test-scenarios.md](09-test-scenarios.md) | A tester's checklist: test cases with steps and expected results |
| 10 | [10-best-practices-and-limits.md](10-best-practices-and-limits.md) | Dos and don'ts, limits, what is not available yet, FAQ |
| 11 | [11-default-automations.md](11-default-automations.md) | The 20 ready-made automations every company gets: what each does, which start on, how to add, change or turn them off |

## Before you start

- **Access.**
  - To see workflows you need **CRM Settings → View**.
  - To create, change, publish or test them you need **CRM Settings → Edit**.
  - Ask your administrator if the "Workflows" menu item is missing.
- **The background worker must run.** Workflows are executed by the ERP's background worker (`npm run worker`, started together with `npm run dev`). If it isn't running, nothing triggers and waits never finish. Test runs still work.
- **Start with a test run.** Every workflow can be tried on a real record without changing anything (see file 07).
