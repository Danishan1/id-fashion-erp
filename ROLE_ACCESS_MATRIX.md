# Role (Post) Access Matrix

> **Updated 2026-09-24** — RBAC granular-permission audit split `inventory` → `inventory`+
> `material_request`, `purchasing` → `purchase_order`, `piece_rate` → `piece_rate`+`rate_card`,
> and `administration` → `administration_users`/`administration_roles`/`administration_settings`.
> This file has been refreshed to match; full details + rationale in
> [RBAC_AUDIT_REPORT.md](RBAC_AUDIT_REPORT.md).

Har "post" (Role) ke liye — kaunse Module access hain, unme kya-kya Action (permission)
milta hai, aur uske result me Sidebar me kaunse Section/Submodule dikhte hain.

Source of truth (auto-generated from the actual code, hand-edited if the app changes):
- Module + Action permissions: `src/config/rbac.ts` (`ROLE_PERMISSIONS`)
- Sidebar Section/Submodule mapping: `src/components/layout/navigation.ts` (`NAV_SECTIONS`)

**Kaise padhein**: ek Role ek ya zyada **Module** access karta hai; har Module ke andar
usko specific **Actions** milte hain (view/create/edit/delete/approve/reject/post/cancel/
export/print/override). Sidebar me jo **Section** (e.g. "Manufacturing") aur uske andar
jo **Submodule/link** (e.g. "BOM / MRP", "Production") dikhta hai, wo is Module access se
hi automatically decide hota hai — kisi Role ko kisi Module pe `view` nahi hai to wo
Section/link sidebar me dikhega hi nahi.

Do modules — **QC** (`qc`) aur **Piece Rate** (`piece_rate`) — ka apna koi dedicated
top-level sidebar link nahi hai; inka access Production/Sampling screens ke andar hi
(inline) use hota hai (e.g. Job Order pe QC Inspection record karna, Assign Worker modal
me piece-rate dikhna).

---

## Quick reference — kis Role ko kaunsa Sidebar Section dikhta hai

| Role (Post) | Sidebar me dikhne wale Sections |
|---|---|
| **SUPER_ADMIN** | Sab kuch (har Section, har Submodule, har Action) |
| **MANAGEMENT** | Sab kuch (har Section dikhta hai, par zyadatar sirf View/Approve/Export — Create/Edit/Delete nahi) |
| **MERCHANDISER** | Dashboard, AI Garment Flow, AI Designer, Masters, CRM, Marketing, Merchandising, Sales, Purchase, Manufacturing, Inventory, Reports |
| **SAMPLING_MANAGER** | Dashboard, Masters, Merchandising, Sales, Manufacturing, Reports |
| **PRODUCTION_MANAGER** | Dashboard, Masters, Merchandising, Sales, Manufacturing, Inventory, Purchase, Reports |
| **PRODUCTION_SUPERVISOR** | Dashboard, Masters, Sales, Manufacturing, Inventory, Reports |
| **PRODUCTION_WORKER** | Dashboard, Manufacturing (sirf Production/Job Work/My Work/Pending Approvals — BOM/MRP nahi) |
| **EXTERNAL_UNIT_USER** (Vendor/Job-Work login) | Dashboard, Manufacturing (sirf Production/Job Work/My Work/Pending Approvals — BOM/MRP nahi) |
| **QC_MANAGER** | Dashboard, Masters, Merchandising, Manufacturing, Inventory, Reports |
| **STORE_MANAGER** | Dashboard, Masters, Manufacturing, Inventory, Purchase, Dispatch, Reports |
| **ACCOUNTS_MANAGER** | Dashboard, Masters, Sales, Purchase, Accounts, Administration, Reports |
| **ACCOUNTS_EXECUTIVE** | Dashboard, Masters, Sales, Purchase, Accounts, Reports |
| **DISPATCH_MANAGER** | Dashboard, Masters, Sales, Manufacturing (Production only), Inventory, Dispatch, Reports |
| **WAREHOUSE_USER** | Dashboard, Masters, Manufacturing, Inventory, Purchase, Dispatch, Reports |
| **VIEWER** | Sab kuch dikhta hai (har Section) — par har jagah sirf View, kuch bhi Create/Edit/Delete/Approve nahi kar sakte |

---

## 1. SUPER_ADMIN
Har module pe har action (view/create/edit/delete/approve/reject/post/cancel/export/print/override) — company ke andar full control, koi restriction nahi.

**Sidebar**: Dashboard, AI Garment Flow, AI Designer, Masters, CRM, Marketing, HRMS, Merchandising, Sales, Purchase, Manufacturing, Inventory, Accounts, Dispatch, Reports, Administration — sab.

---

## 2. MANAGEMENT
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view |
| Masters (Finance) | view |
| CRM | view, export |
| Marketing | view, approve, reject, export |
| HRMS Attendance | view, create, edit, approve, reject, export |
| HRMS Leave | view, create, edit, approve, reject, export |
| Sampling | view, approve, reject |
| Buyer Enquiries | view, reject |
| Sales Orders | view, approve, export |
| BOM / MRP | view, approve |
| Production | view, approve, export |
| QC | view, export |
| Piece Rate | view, approve, export |
| Rate Card | view (sirf dekh sakte hain — banana/edit karna sirf Production Manager kar sakta hai) |
| Inventory | view, export |
| Material Requests | view, export |
| Purchase Orders | view, approve |
| Accounts | view, export |
| Invoices | view, export |
| Payments | view, approve |
| Expenses | view, approve, reject |
| Financial Reports | view, export, print |
| Dispatch | view, export |
| Reports | view, export, print |
| Administration — Users | view |
| Administration — Roles | view |
| Administration — Settings | view |
| AI Garment Flow | view |
| AI Designer | view, approve |

**Sidebar**: har Section dikhta hai (Management sab modules pe kam se kam `view` rakhta hai) — but is role ka kaam mostly **approval/oversight** hai, roz-marra ka Create/Edit karna nahi.

---

## 3. MERCHANDISER
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view, create, edit |
| CRM | view, create, edit, export, print |
| Marketing | view, create, edit, export, print |
| Sampling | view, create, edit, export, print |
| Buyer Enquiries | view, create, edit, reject, export, print |
| Sales Orders | view, create, edit, cancel, export, print |
| BOM / MRP | view, create, edit |
| Production | view |
| QC | view |
| Inventory | view (sirf dekh sakte hain — Stock Balance/Movement/Goods Receipt) |
| Material Requests | view, create, edit, cancel (apni khud ki Material Requests raise/edit/cancel kar sakte hain) |
| Purchase Orders | view (**2026-09-24 se create nahi** — direct commercial PO ab nahi bana sakte; jab Material Request se shortfall PO auto-generate hota hai, wo `material_request.edit` se chalta hai, isliye Merchandiser ka apna sanctioned flow bilkul waisa hi kaam karta hai) |
| Reports | view, export, print |
| AI Garment Flow | view, create, edit, delete, cancel, export, print |
| AI Designer | view, create, edit, delete, cancel, export, print |

**Sidebar**: Dashboard, AI Garment Flow, AI Designer, Masters, CRM, Marketing, Merchandising, Sales, Purchase (sirf "Purchase Orders" list dikhta hai, "New Purchase Order" button/action nahi), Manufacturing, Inventory (Material Requests bhi isi ke andar), Reports.
**Nahi milega**: HRMS, Accounts, Dispatch, Administration.

---

## 4. SAMPLING_MANAGER
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view |
| Sampling | view, create, edit, delete, approve, reject, export, print (full control) |
| Buyer Enquiries | view |
| Sales Orders | view |
| BOM / MRP | view |
| Production | view |
| QC | view, create |
| Reports | view, export, print |

**Sidebar**: Dashboard, Masters, Merchandising, Sales, Manufacturing, Reports.
**Nahi milega**: AI Garment Flow, AI Designer, CRM, Marketing, HRMS, Purchase, Inventory, Accounts, Dispatch, Administration.

---

## 5. PRODUCTION_MANAGER
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view |
| Sampling | view |
| Buyer Enquiries | view |
| Sales Orders | view |
| BOM / MRP | view, create, edit, approve, export |
| Production | view, create, edit, approve, cancel, export, print |
| QC | view |
| Piece Rate | view, create, approve, override, export (worker assign karna / rate resolve karna / earning approve karna) |
| Rate Card | view, create, edit (**ab company ke Rate Card ka asli owner sirf yahi role hai** — 2026-09-24 se `rate_card` alag module ban gaya, Piece Rate se) |
| Inventory | view |
| Material Requests | view, create, edit, cancel |
| Purchase Orders | view, create (koi change nahi — Production Manager pehle jaisa hi direct PO bana sakta hai) |
| Reports | view, export, print |

**Sidebar**: Dashboard, Masters, Merchandising, Sales, Manufacturing, Inventory (Material Requests bhi isi ke andar), Purchase, Reports.
**Nahi milega**: AI Garment Flow, AI Designer, CRM, Marketing, HRMS, Accounts, Dispatch, Administration.

---

## 6. PRODUCTION_SUPERVISOR
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view |
| Sales Orders | view |
| BOM / MRP | view |
| Production | view, create, edit, approve (worker self-entry approve bhi) |
| QC | view, create |
| Piece Rate | view, create (worker assign kar sakta hai, rate override nahi kar sakta) |
| Rate Card | **kuch nahi milta** (2026-09-24 se fix hua ek real gap — pehle `piece_rate.create` se hi company ka master Rate Card bhi bana sakta tha, ab Rate Card ek alag module hai aur Supervisor ko iska koi grant nahi hai) |
| Inventory | view |
| Material Requests | view, create |
| Reports | view |

**Sidebar**: Dashboard, Masters, Sales, Manufacturing (BOM/MRP bhi dikhta hai, sirf view), Inventory (Material Requests bhi isi ke andar), Reports.
**Nahi milega**: AI Garment Flow, AI Designer, CRM, Marketing, HRMS, Merchandising, Purchase Orders (sirf Goods Receipts dikhta hai Purchase section ke andar), Accounts, Dispatch, Administration.

---

## 7. PRODUCTION_WORKER (shop-floor self-entry login)
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Production | view, create (sirf apni khud ki progress entry submit karne ke liye) |
| Piece Rate | view (sirf apni khud ki rate, agar company setting ne allow kiya ho) |

**Sidebar**: Dashboard, Manufacturing — par Manufacturing ke andar sirf Production / Job Work Orders / My Work / Pending Approvals dikhte hain, **BOM / MRP nahi**.
**Nahi milega**: baaki sab kuch.

---

## 8. EXTERNAL_UNIT_USER (Vendor / Job-Work Contractor login)
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Production | view, create (sirf apni khud ki Job Work Order ka progress) |

**Sidebar**: Dashboard, Manufacturing — sirf Production / Job Work Orders / My Work / Pending Approvals, **BOM / MRP nahi**.
**Nahi milega**: sales_orders/accounts/financial_reports waghera bilkul bhi nahi — sirf filter nahi, unreachable hai.

---

## 9. QC_MANAGER
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view |
| Sampling | view |
| Buyer Enquiries | view |
| BOM / MRP | view |
| Production | view |
| QC | view, create, edit, approve, reject, export, print (full control) |
| Inventory | view |
| Material Requests | view |
| Reports | view, export, print |

**Sidebar**: Dashboard, Masters, Merchandising, Manufacturing, Inventory (Material Requests bhi isi ke andar), Reports.
**Nahi milega**: AI Garment Flow, AI Designer, CRM, Marketing, HRMS, **Sales**, Purchase, Accounts, Dispatch, Administration.

---

## 10. STORE_MANAGER
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view, create, edit |
| BOM / MRP | view |
| Production | view |
| Inventory | view, create, edit, delete, export, print (full control) |
| Material Requests | view, create, edit, cancel, export |
| Purchase Orders | view, create, edit, approve, export, print |
| Dispatch | view |
| Reports | view, export, print |

**Sidebar**: Dashboard, Masters, Manufacturing, Inventory (Material Requests bhi isi ke andar), Purchase, Dispatch, Reports.
**Nahi milega**: AI Garment Flow, AI Designer, CRM, Marketing, HRMS, Merchandising, Sales, Accounts, Administration.

---

## 11. ACCOUNTS_MANAGER
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view, create, edit |
| Masters (Finance) | view, create, edit |
| Sales Orders | view |
| Purchase Orders | view, approve |
| Accounts | view, create, edit, post, cancel, export, print |
| Invoices | view, create, edit, post, cancel, export, print |
| Payments | view, create, approve, cancel, export, print |
| Expenses | view, create, edit, approve, reject, post, cancel, export, print (full control) |
| Financial Reports | view, export, print |
| Piece Rate | view, export (read-only, payroll ke liye — Rate Card ka koi grant nahi, rates modify kabhi nahi kar sakte) |
| Administration — Users | **kuch nahi milta** (2026-09-24 se fix hua — pehle poori company ki Users list, emails samet, dikh jaati thi) |
| Administration — Roles | **kuch nahi milta** (Roles ka permission matrix bhi ab nahi dikhega) |
| Administration — Settings | view (Company Settings, AI Provider config, Branches, Document Numbering, Audit Log — itna hi) |
| Reports | view, export, print |

**Sidebar**: Dashboard, Masters, Sales, Purchase, Accounts, Administration (sirf Branches/Worker Settings/Company Settings/Document Numbering/Module Visibility/AI Configuration/Audit Log tabs — **Users aur Roles tab ab nahi dikhte**), Reports.
**Nahi milega**: AI Garment Flow, AI Designer, CRM, Marketing, HRMS, Merchandising, **Manufacturing**, **Inventory**, Dispatch.

---

## 12. ACCOUNTS_EXECUTIVE
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view |
| Masters (Finance) | view |
| Sales Orders | view, create |
| Purchase Orders | view, create |
| Accounts | view, create |
| Invoices | view, create, edit |
| Payments | view, create |
| Expenses | view, create, edit |
| Financial Reports | view, export |
| Reports | view, export, print |

**Sidebar**: Dashboard, Masters, Sales, Purchase, Accounts, Reports.
**Nahi milega**: AI Garment Flow, AI Designer, CRM, Marketing, HRMS, Merchandising, Manufacturing, Inventory, Dispatch, Administration.
(Accounts Manager se junior — post/approve/cancel kahin nahi milta.)

---

## 13. DISPATCH_MANAGER
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view |
| Sales Orders | view |
| Production | view |
| Inventory | view |
| Material Requests | view |
| Dispatch | view, create, edit, post, delete, cancel, export, print (full control) |
| Reports | view, export, print |

**Sidebar**: Dashboard, Masters, Sales, Manufacturing (Production dikhta hai, **BOM / MRP nahi**), Inventory (Material Requests bhi isi ke andar), Dispatch, Reports.
**Nahi milega**: AI Garment Flow, AI Designer, CRM, Marketing, HRMS, Merchandising, Purchase, Accounts, Administration.

---

## 14. WAREHOUSE_USER
| Module | Access (Actions) |
|---|---|
| Dashboard | view |
| Masters (Core) | view |
| BOM / MRP | view |
| Production | view |
| QC | view |
| Inventory | view, create, edit |
| Material Requests | view, create, edit, cancel |
| Purchase Orders | view, create |
| Dispatch | view, create, edit |
| Reports | view |

**Sidebar**: Dashboard, Masters, Manufacturing, Inventory (Material Requests bhi isi ke andar), Purchase, Dispatch, Reports.
**Nahi milega**: AI Garment Flow, AI Designer, CRM, Marketing, HRMS, Merchandising, Sales, Accounts, Administration.

---

## 15. VIEWER
Har module pe sirf `view` — koi bhi Create/Edit/Delete/Approve/Post/Cancel nahi.

**Sidebar**: har Section dikhta hai (kyunki har module pe view hai) — par har jagah sirf dekhne ki permission, kuch change nahi kar sakte.

> Note (already flagged, not changed — business-policy decision hai): VIEWER role ko
> company ka har module dikh jaata hai, financial data (P&L, Balance Sheet, General
> Ledger) aur poori user list bhi — ye code ka bug nahi, `rbac.ts` me jaan-boojh kar
> "company-wide read-only auditor" ke roop me likha gaya hai. Agar isko restrict karna
> ho to ye ek separate decision hoga.

---

## Company ke real staff (2026-09-24 ko create kiye gaye) — kaun kis Role pe hai

| Naam | Employee Code | Login Email | Role (Post) |
|---|---|---|---|
| Super Admin | — | admin@indradhar.com | SUPER_ADMIN |
| Narendar | — | narendar@gmail.com | SUPER_ADMIN |
| Kavita Gosein | EMP-00001 | kavita.gosein@indradhar.com | SAMPLING_MANAGER |
| Deepa Pandey | EMP-00002 | deepa.pandey@indradhar.com | QC_MANAGER |
| Shiv Singh Rawat | EMP-00003 | shiv.rawat@indradhar.com | STORE_MANAGER |
| Romanchal | EMP-00004 | romanchal.dev@indradhar.com | VIEWER |
| Ajay Moti | EMP-00005 | ajay.moti@indradhar.com | VIEWER |
| Vinay Kumar | EMP-00006 | vinay.kumar@indradhar.com | ACCOUNTS_MANAGER |
| Ajeet Yadav | EMP-00007 | ajeet.yadav@indradhar.com | VIEWER |
| Anubhav Bhatt | EMP-00008 | anubhav.bhatt@indradhar.com | WAREHOUSE_USER |
| Satya Dev Gautam | EMP-00009 | satya.gautam@indradhar.com | DISPATCH_MANAGER |
| Babita Gadoo | EMP-00010 | babita.gadoo@indradhar.com | MANAGEMENT |
| Ravikant | EMP-00011 | ravikant@indradhar.com | VIEWER |
| Amrita | EMP-00012 | amrita.sampling@indradhar.com | SAMPLING_MANAGER |
| Rajesh Verma | EMP-00013 | rajesh.verma@indradhar.com | PRODUCTION_MANAGER |
| Manoj Tiwari | EMP-00014 | manoj.tiwari@indradhar.com | PRODUCTION_SUPERVISOR |
| Sunita Devi | EMP-00015 | sunita.devi@indradhar.com | PRODUCTION_WORKER |
| Priya Sharma | EMP-00016 | priya.sharma@indradhar.com | ACCOUNTS_EXECUTIVE |
| Neha Kapoor | EMP-00017 | neha.kapoor@indradhar.com | MERCHANDISER |
| HP Cotton — Job-Work Unit | (Supplier login) | hpcotton.jobwork@indradhar.com | EXTERNAL_UNIT_USER |

Sab naye login ka password: `Staff@123` (jitni jaldi ho sake, admin panel se reset karwa
lena — `/admin` → Users → Reset Password).
