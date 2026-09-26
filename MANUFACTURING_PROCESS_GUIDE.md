# Manufacturing Module — How the Process Works (with Employee Login)

A practical, current walkthrough of how a garment actually moves through the Manufacturing
(Production) module in this ERP, and exactly how Employee logins fit into every step. This is
written for anyone using or training on the system — merchandisers, production managers,
supervisors, and factory-floor workers — not just developers.

For the deep technical/schema design behind this module, see `PRODUCTION_MODULE_DESIGN.md`
(the original architecture proposal) and the dated Production sections in `CLAUDE.md` (what was
actually built, including later additions like Piece-Rate and External Job-Work). This file is
the up-to-date, plain-English version of "how does it actually work today."

---

## 1. The big picture

```
Sales Order (or Make-to-Stock)
        │
        ▼
Production Order  ──►  Lot(s)  ──►  Job Order (Lot × Stage)  ──►  Job Order (next Stage)  ──► ...
                                         │
                                         ├─ Assign Worker(s)
                                         ├─ Log Progress (Supervisor or the worker's own login)
                                         ├─ Forward to next stage / Revert to a previous stage
                                         └─ QC Inspection (accept / reject / rework)
                                                        │
                                                        ▼
                                         Finished Goods stock (on final-stage completion)
                                                        │
                                                        ▼
                                                    Dispatch
```

Every physical garment lot moves stage by stage (Cutting → Stitching → Checking → Finishing →
Packing, or whatever stages your company has configured in **Masters → Production Config**). At
each stage, a real person — logged into the ERP as themselves — records what actually happened:
who worked on it, how many pieces were completed, how many were rejected/damaged, and when it's
ready to move on.

---

## 2. Step by step: from order to finished goods

### 2.1 Production Order (`/production-orders`)

A Production Order is created either:
- **Against a real Sales Order line** — the system checks you're not planning more than what the
  customer actually ordered (minus whatever other Production Orders already claim), and
- **Make-to-Stock** — no Sales Order at all, for building up inventory ahead of demand.

Created by a **Production Manager** (or Merchandiser/Management, depending on your company's
role setup) via "New Production Order."

### 2.2 Lots (`Add Lot` on a Production Order)

A Production Order is split into one or more **Lots** — the actual physical batches that move
through the factory. When creating a Lot, you can enter its **color/size breakdown** (how many of
each color and size are in this lot) — if the order is linked to a real Sales Order, the system
suggests the breakdown from the order's own line items so nothing has to be re-typed.

### 2.3 Job Orders — a Lot at a Stage

The moment a Lot starts, the system creates its first **Job Order** — the actual unit of work
(`Lot × Production Stage`, e.g. "Lot L01 at Cutting"). Everything that happens on the factory
floor happens against a Job Order:

- **Assign Worker(s)** — pick which Employee(s) are doing this stage's work, and how much
  quantity each is assigned.
- **Log Progress** — record completed / rejected / damaged quantities as work actually gets done
  (this can happen multiple times as the stage progresses — it's not a single one-shot entry).
- **Forward** — once enough is done, move the (partial or full) completed quantity to the next
  stage — this automatically creates the next Job Order if one doesn't exist yet.
- **Revert** — send work back to an earlier stage if something needs redoing.
- **QC Inspection** — record a Pass, Partial Pass, or Fail with a rejected/damaged quantity;
  a rejected quantity can be routed to a rework stage.

A single Lot can have several Job Orders open at once across different stages (e.g. part of the
lot already at Stitching while the rest is still finishing Cutting) — partial forwarding is the
normal way this module works, not an edge case.

### 2.4 Split / Merge

A Lot can be **split** into two or more child Lots (e.g. to send part of a batch to a different
worker or process it separately) or **merged** back together. This is gated behind Management/
Production Manager approval (`production.approve`), since it restructures the batch itself, not
just its progress.

### 2.5 Finished Goods and Dispatch

When a Job Order at the **final** stage is completed, the system automatically posts the
completed quantity into Finished Goods stock. From there, the style is ready to be picked and
shipped through the **Dispatch** module.

---

## 3. Employee Login — who logs in, and what they can do

This is the part most people actually ask about: **a "worker" in this system is not just a name
on a form — it's a real Employee record, and it can be tied to a real login (User account)** so
that person can use the app themselves on the shop floor.

### 3.1 The two identities: Employee vs. User

- **Employee** — the master record (Masters → Employees). This is who actually did the work —
  every quantity, every assignment, every earning is tracked against the Employee.
- **User** — the login (email + password, or an Admin-assigned account). A User can optionally
  be linked to one Employee (`User.employeeId`, set by an Admin under Administration → Users).

This split matters because **not every Employee needs their own login.** A Supervisor can log
progress on behalf of any of their assigned workers without those workers ever touching the app
themselves — that's the default, normal way this module works. Giving a worker their own login
(self-entry) is an optional upgrade, not a requirement.

### 3.2 The roles

| Role | What they can do in Manufacturing |
|---|---|
| **PRODUCTION_MANAGER** | Full access — create Production Orders, approve Lot split/merge, view BOM/MRP, oversee everything. |
| **PRODUCTION_SUPERVISOR** | Runs the floor day to day — assign workers, log progress on their behalf, forward/revert stages, do QC, approve workers' own self-submitted entries. |
| **PRODUCTION_WORKER** | A shop-floor login for a specific Employee — can log their **own** progress (if enabled — see §3.4) and see their own assignments/piece-rate earnings, nothing else in the module. |
| **QC_MANAGER** | Records QC inspections; full view access across Sampling/BOM/Production for context, but doesn't run day-to-day floor operations. |
| **EXTERNAL_UNIT_USER** | A vendor/contractor's own login (see §5 — External Job-Work), scoped only to that vendor's own job-work orders. |

Every one of these is a real seeded role under Administration → Roles, and can be further
narrowed — see §3.5.

### 3.3 Assign Worker

On a Job Order, "Assign Worker" picks a real Employee and how much quantity they're responsible
for. If your company has Piece-Rate tracking on (see §4) and the Employee is paid piece-rate,
this is also the moment the system resolves and locks in their rate for this specific job.

### 3.4 Two ways progress gets logged

**A. Supervisor logs it (the default)** — a Supervisor (or Manager) opens the Job Order and
enters completed/rejected/damaged quantities directly, on behalf of whichever worker did the
work. This applies immediately.

**B. The worker logs their own progress (self-entry)** — only available once an Admin has
explicitly turned on `selfEntryEnabled` for that specific Employee (Masters → Employees → edit).
Once enabled, and once that Employee's User login is linked (§3.1), they can go to **My Work**
(`/production/my-work`) and see:
- **Assigned to Me** — every Job Order they're currently assigned to.
- **My Submitted Entries** — the progress entries they've logged and their approval status.

A self-entry always starts as **Pending** — it does not update the Job Order's real quantities
until a Supervisor reviews it under **Pending Approvals** (`/production/approvals`) and either
approves (quantities now apply for real) or rejects it. A Supervisor can also correct the
numbers before approving, if the worker mis-entered something.

**Optional stricter mode**: a company can turn on `supervisorApprovalRequired` (Admin →
Production Settings), which routes even a *Supervisor's own* direct entries through the same
Pending → Approve flow — useful if a company wants every entry double-checked regardless of who
typed it in.

### 3.5 Login scoped to just one stage

A role can be restricted to specific Production Stages (Admin → Roles → a role's own page →
"Production Stage Access"). For example, a "Cutting Supervisor" role checked to just Cutting
won't see or be able to act on Lots/Job Orders sitting at Stitching, Finishing, or any other
stage — even though they hold the same underlying Production permissions as a full Supervisor.
Leaving nothing checked means unrestricted (sees every stage), which is the default for every
role today.

### 3.6 What a worker sees about their own pay

If Piece-Rate tracking is on and `workersCanViewOwnRate` is enabled, a PRODUCTION_WORKER login
can see their own resolved rate and earnings for their own assignments — never anyone else's.

---

## 4. Piece-Rate pay (optional)

Turned on per company via Admin → Production Settings (`pieceRateTrackingEnabled`). When on, and
an Employee's Pay Type is set to Piece Rate:

1. **Assign Worker** requires picking which real Operation (e.g. "Sleeve Attach") the assignment
   is for, and resolves a rate automatically, checked in this order: a rate specific to that
   worker → a rate for that worker's grade/category → a default rate for that Style + Operation
   → a general default for that Operation → (last resort) the Employee's own flat legacy rate. If
   nothing resolves, the assignment is blocked unless a Manager supplies an authorized override
   rate — the system never silently pays ₹0.
2. The resolved rate is **frozen** on that assignment the moment it's set, so a rate-card change
   later never rewrites what was already agreed for in-progress work.
3. An **earning** is generated automatically (no manual step) once the payable quantity is
   confirmed — by default, once QC actually accepts the pieces (`pieceRatePaymentQuantityRule`
   can instead be set to pay on completed quantity, before QC). Rework never double-pays — each
   stage attempt is tracked separately.

---

## 5. External Job-Work (outside vendor login)

For work sent to an outside contractor rather than an internal worker:

- Only Suppliers explicitly flagged **"Job-Work Contractor"** (Masters → Suppliers) appear in the
  "Send to External Job-Work" picker — not every vendor in the system.
- The vendor's own login (`EXTERNAL_UNIT_USER`, linked to a real `Supplier` via `User.supplierId`)
  can see and act **only on their own job-work orders** — every other vendor's data, and every
  other module in the app, is completely unreachable to that login, not merely hidden.
- Depending on `externalEntryBy` (Admin → Production Settings), the vendor can submit their own
  receipt quantities directly, or it can be restricted so only an internal Supervisor may enter
  a receipt on the vendor's behalf.
- A vendor-submitted receipt is never applied automatically — it sits **Pending** until an
  internal user approves it, exactly like a worker's own self-entry.
- Job-Work also supports Piece-Rate — a Supplier can have its own rate card per Operation.

---

## 6. QC Inspection

Recorded against a Job Order once its work is genuinely done (or partially done). A Pass moves
the accepted quantity forward normally; a Fail/Partial Fail records rejected/damaged quantities
separately (never silently mixed into "completed") and can route the rejected amount to a named
rework stage. QC is what actually determines the piece-rate-payable quantity by default (§4).

---

## 7. Where to configure all of this

| Setting | Where |
|---|---|
| Link a User login to a real Employee | Administration → Users → edit user |
| Enable a worker's own self-entry | Masters → Employees → edit employee |
| Supervisor-approval-required (even for direct entries) | Administration → Production Settings |
| Piece-Rate on/off, payment quantity rule, worker rate visibility | Administration → Production Settings |
| Who can submit an external job-work receipt | Administration → Production Settings |
| Restrict a role to specific Production Stages | Administration → Roles → a role → Production Stage Access |
| Restrict a role to specific Branches | Administration → Roles → a role → Branch Access |
| Mark a Supplier as a Job-Work Contractor | Masters → Suppliers → edit supplier |
| Production Stages themselves (Cutting/Stitching/…) | Masters → Production Config |

---

## 8. Quick reference — where each real action happens in the app

| Action | Page |
|---|---|
| Create a Production Order | `/production-orders` → New |
| Add a Lot | Production Order detail page |
| Start a Lot / view its Job Orders | Lot detail page |
| Assign a worker, log progress, forward/revert, QC | Job Order actions on the Lot detail page |
| A worker's own assignments and submitted entries | `/production/my-work` |
| A Supervisor's approval queue for self-submitted entries | `/production/approvals` |
| Send work to an external contractor | Lot detail page → "Send to External Job-Work" |
| An external vendor's own orders | `/production/job-work` (scoped automatically to their login) |
