# 16 — Bulk jobs, exports and schedules

[← Back to the overview](README.md)

Bulk actions run in the background on many records at once. Each record is handled with exactly the same checks as when you do it by hand.

## 1. Running a bulk action

On the **Enquiries**, **Quotations**, **Campaigns**, **Promotions** or **Attribution models** list:

1. Tick records, or choose **all matching the filter / search**.
2. Click **Bulk actions** and pick an action.
3. Review, then choose:
   - **Run now**;
   - **Dry run first:** checks every record and changes nothing, then shows which would succeed, be skipped or fail and why. **Run for real** then runs only the would-succeed records;
   - **Save as a schedule**, for exports and recalculations.

| List | Actions |
|---|---|
| Enquiries | Assign owner (dry run available), Export |
| Quotations | Export, Check drafts (shows which drafts are ready to issue or need approval; changes nothing) |
| Campaigns | Export with budget figures |
| Promotions | Export, Pause |
| Attribution models | Recalculate (last 30 / 90 / 365 days or custom) |

There are deliberately no bulk stage changes, bulk approvals, bulk issues or bulk deletes. Each of those needs a person's judgement.

## 2. Following jobs

**Sales & Marketing → Bulk Jobs**:

- **Jobs:** progress, results per record, failed records with reasons, retry, cancel, and the download for exports (kept 7 days).
- **Schedules:**
  - when each schedule runs (daily, weekly or monthly, India time), the next and last runs, and failures;
  - pause, resume and delete;
  - a schedule pauses itself after 3 failures in a row and notifies its owner;
  - scheduled analytics report deliveries appear here too.

Limits: 5 running jobs per person and 20 per company.

## 3. Enquiry import

See [03 Enquiries](03-enquiries.md) §5.
