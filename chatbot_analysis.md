git # Fashion ERP — Chatbot Integration Analysis
## Permission-Aware Chatbot: Best Approach & Cost Strategy

---

## 🏗️ Project ki Existing Architecture (Summary)

Yeh project **Next.js 15 + PostgreSQL (Prisma)** pe based hai.

### Permission System (RBAC)

| Layer | Description |
|---|---|
| `User` | Company ke andar ek user |
| `Role` | SUPER_ADMIN, MANAGEMENT, MERCHANDISER, PRODUCTION_MANAGER, ACCOUNTS_MANAGER, VIEWER, etc. (13 roles) |
| `Permission` | `module.action` format — jaise `invoices.view`, `hrms_attendance.view` |
| `UserBranchRole` | User → Branch → Role mapping (ek user multiple branches/roles le sakta hai) |
| `PermissionService.can()` | Live DB check — suspended user ka session bhi block hota hai |

### 23 Modules hain:
`dashboard`, `masters_core`, `masters_finance`, `crm`, `marketing`, `hrms_attendance`, `hrms_leave`, `sampling`, `buyer_enquiries`, `sales_orders`, `bom_mrp`, `production`, `qc`, `inventory`, `purchasing`, `accounts`, `invoices`, `payments`, `expenses`, `financial_reports`, `dispatch`, `reports`, `administration`

---

## ❓ Example Questions ka Module Mapping

| Sawaal | Required Module | Required Action | Kon dekh sakta hai? |
|---|---|---|---|
| Aaj ka kitna sales hua? | `sales_orders` / `invoices` | `view` | MANAGEMENT, MERCHANDISER, ACCOUNTS_MANAGER, ACCOUNTS_EXECUTIVE, SUPER_ADMIN |
| Jun 2026 ka sales & purchase? | `sales_orders` + `purchasing` | `view` | MANAGEMENT, ACCOUNTS_MANAGER, SUPER_ADMIN |
| Romanchal nayak ka attendance report | `hrms_attendance` | `view` | MANAGEMENT, SUPER_ADMIN |
| Sare employee ki salary | `hrms_attendance` (payroll) | `view` + `export` | MANAGEMENT, SUPER_ADMIN |
| Lot 8001 ka status | `production` | `view` | MANAGEMENT, PRODUCTION_MANAGER, PRODUCTION_SUPERVISOR, MERCHANDISER, SUPER_ADMIN |
| Anjayan textile ka ledger | `accounts` / `financial_reports` | `view` | ACCOUNTS_MANAGER, MANAGEMENT, SUPER_ADMIN |
| Cutting master ramu ke pending kaam | `production` (job orders) | `view` | PRODUCTION_MANAGER, PRODUCTION_SUPERVISOR, MANAGEMENT, SUPER_ADMIN |

---

## ✅ Question 1: Best Way — Permission-Aware Chatbot Architecture

### Recommended Approach: **"Tool-Calling + Existing API Routes"**

```
User → Chatbot UI
         ↓ (user ka session/JWT bhi saath bheja jaye)
    Chatbot Backend (LLM)
         ↓ (intent samjho, tools select karo)
    Existing /api/v1/* Routes   ← YE ALREADY PERMISSION CHECK KARTI HAIN
         ↓
    PostgreSQL (Prisma)
         ↓
    Response back to LLM → Natural Language Answer → User
```

### Kyun ye BEST approach hai?

**1. Zero Duplicate Permission Logic**

Existing routes ALREADY `requireSession()` + `PermissionService.assert()` use karti hain.
Chatbot ko alag se koi permission check nahi likhna — sirf un APIs ko call karo jo user ke
session se already gated hain. Agar user ke paas permission nahi hai → API 403 return karega →
LLM user ko bolta hai "aapke paas yeh data dekhne ka access nahi hai."

**2. LLM ko "Tool Functions" dena**

Modern LLMs (Gemini, GPT-4o, Claude) "Function Calling / Tool Use" support karte hain.
Chatbot ko define karo ki uske paas ye "tools" hain:

```typescript
// Chatbot tools (LLM ko btao ki ye functions available hain)
tools: [
  { name: "getSalesData",       params: { dateFrom, dateTo, type: "sales|purchase" } },
  { name: "getAttendanceReport",params: { employeeId?, month, year } },
  { name: "getSalaryReport",    params: { month, year, employeeId? } },
  { name: "getLotStatus",       params: { lotNumber } },
  { name: "getPartyLedger",     params: { partyName, partyType: "supplier|customer" } },
  { name: "getPendingJobOrders",params: { employeeName?, department?, stageId? } },
]
```

LLM user ka question samjhega → sahi tool choose karega → apke existing API hit karega →
response ko natural language mein format karke user ko dega.

**3. Session Forwarding — Critical Point**

Chatbot ke backend call mein **user ka session cookie / JWT token** forward karna ZARURI hai.
Tabhi existing permission checks kaam karengi. Do tarike:

- **Server-side (Recommended):** Chatbot API route bhi Next.js mein ho (`/api/v1/chat`).
  Wahan `requireSession()` call karo — phir internal service functions directly call karo
  (HTTP nahi, direct function import), session.user.id pass karo.
- **Client-side proxy:** Client se chatbot request bhejo → Next.js API handler → wahan
  session verify karo → DB ya internal API se data lo.

---

## 💰 Question 2: Kam Cost ya Free Approach

### Comparison Table

| Option | Cost | Quality | Setup Effort | Recommendation |
|---|---|---|---|---|
| **Google Gemini 2.0 Flash** | **Free (1500 req/day)** | Excellent | Low | ⭐ Best Free Option |
| **Gemini 1.5 Flash** | Free (15 req/min) | Very Good | Low | ✅ Backup |
| **Groq (Llama 3.1 70B)** | Free tier available | Good | Medium | ✅ Free Option |
| **Ollama (local LLM)** | Free | Medium | High | ⚠️ Slow, needs good hardware |
| **GPT-4o Mini** | ~\$0.15/1M tokens | Excellent | Low | 💲 Cheapest paid |
| **Claude Haiku** | ~\$0.25/1M tokens | Excellent | Low | 💲 Cheap paid |

### 🎯 Recommended Free Stack

```
Gemini 2.0 Flash API (free tier: 1500 requests/day)
+ Next.js API Route as chatbot backend (/api/v1/chat)
+ Existing PermissionService + API services
+ Vercel AI SDK (@ai-sdk/google) — free, open source
```

**Cost:** ₹0 for typical small business usage (<1500 queries/day)

---

## 🔒 Permission Flow — Detailed Diagram

```
USER (e.g., PRODUCTION_MANAGER role)
    |
    | "Lot 8001 ka status kya hai?"
    ▼
CHATBOT UI (browser)
    |
    | POST /api/v1/chat  { message: "..." }
    | (session cookie automatically send hota hai)
    ▼
/api/v1/chat  (Next.js Route Handler)
    |
    ├─ requireSession() → user.id, user.companyId milta hai
    |
    ├─ LLM ko message bhejo (tools ke saath)
    |
    ├─ LLM decides: "getLotStatus" tool call karo, lotNumber="8001"
    |
    ├─ getLotStatus() internally calls:
    |     PermissionService.assert(userId, "production", "view")
    |         ✅ PRODUCTION_MANAGER ke paas hai → pass
    |     DB query: lots where lotNumber = "8001" AND companyId = user.companyId
    |
    ├─ Result LLM ko wapas bhejo
    |
    └─ LLM formats: "Lot 8001 abhi Stitching stage mein hai, 450/800 pieces complete hain"
    ▼
USER ko natural language response
```

### Agar user ke paas permission NAHI hai:

```
USER (e.g., PRODUCTION_SUPERVISOR)
    | "Sare employees ki salary batao"
    ▼
/api/v1/chat
    ├─ PermissionService.assert(userId, "hrms_attendance", "view")
    |     ❌ PRODUCTION_SUPERVISOR ke paas nahi hai
    |     → BusinessRuleError("PERMISSION_DENIED") throw
    |
    └─ Chatbot responds: "Aapke paas salary report dekhne ka access nahi hai.
                          Iske liye Management ya HR admin se sampark karein."
```

---

## 📋 Role-wise Chatbot Access Summary

| Role | Sales | Purchase | Attendance/Salary | Production/Lots | Accounts/Ledger | Reports |
|---|---|---|---|---|---|---|
| **SUPER_ADMIN** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **MANAGEMENT** | ✅ | ✅ (view) | ✅ | ✅ | ✅ | ✅ |
| **MERCHANDISER** | ✅ | ✅ (view) | ❌ | ✅ (view) | ❌ | ✅ |
| **PRODUCTION_MANAGER** | ✅ (view) | ✅ (view) | ❌ | ✅ | ❌ | ✅ |
| **PRODUCTION_SUPERVISOR** | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ (view) |
| **ACCOUNTS_MANAGER** | ✅ (view) | ✅ | ❌ | ❌ | ✅ | ✅ |
| **ACCOUNTS_EXECUTIVE** | ✅ (view) | ✅ (view) | ❌ | ❌ | ✅ (limited) | ✅ |
| **STORE_MANAGER** | ❌ | ✅ | ❌ | ✅ (view) | ❌ | ✅ |
| **VIEWER** | ✅ (view) | ✅ (view) | ✅ (view) | ✅ (view) | ✅ (view) | ✅ (view) |

---

## 🛠️ Implementation Plan (High-Level, No Code Change Yet)

### Phase 1 — Chatbot Backend Route
- `POST /api/v1/chat` route banao
- `requireSession()` se auth enforce karo
- Gemini AI SDK integrate karo (free tier)
- Tools define karo (getSalesData, getLotStatus, etc.)

### Phase 2 — Tool Functions (Service Layer)
- Har tool ke andar existing service functions call karo
- `PermissionService.assert()` call karo pehle
- Data DB se lo, format karke LLM ko do

### Phase 3 — Chatbot UI
- Dashboard mein floating chatbot button add karo
- Chat window jo `/api/v1/chat` se baat kare
- Session automatically browser se forward hogi

### Phase 4 — Smart Permission Messages
- Jab permission deny ho, chatbot ko friendly message
- "Is module ka access chahiye toh admin se milein" type response

---

## 💡 Key Decisions Summary

> [!IMPORTANT]
> **Apne existing API/service layer ko reuse karo.** Naya permission system mat banao.
> `PermissionService.assert()` already sab kuch handle karta hai — chatbot sirf ek
> user ki taraf se act karne wala ek naya "client" hai.

> [!TIP]
> **Gemini 2.0 Flash free tier** se shuru karo — 1500 requests/day bahut hai ek
> garment company ke internal chatbot ke liye. Production mein scale hone pe
> paid tier par ja sakte ho (bahut sasta hai).

> [!NOTE]
> **Company Isolation automatic hai** — `session.user.companyId` se sab queries
> already filter hoti hain. Chatbot ke zariye koi dusri company ka data leak nahi hoga.

> [!WARNING]
> **LLM ko kabhi bhi direct DB access mat do.** Sirf existing service functions
> call karne do — warna permission checks bypass ho sakti hain.
