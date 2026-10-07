# CRM — Lead Board (addition to Phase 08)

Status: implemented, tested and verified (2026-10-07).

The Leads page now has **Board** and **List** views, like Opportunities. The List is the Phase 02 list, unchanged apart from its filter definitions, which are now shared with the Board.

## How it works

**Columns and cards**

- There is one column per **lead status**, in the order set in Settings → Lead statuses. Leads have no pipeline; the status is their stage.
- An inactive status shows as a column only while leads still use it. Archived leads never appear.
- Each column header shows the count, estimated value and average per currency. These come from one grouped query over the filtered, visible set (`GET /api/v1/crm/leads/board`).
- Columns load 20 cards each, newest first. "Load more" fetches the next page of that column only (`statusId` + `offset`).

**Filters and preferences**

- The Board uses the List's filters and search, applied on the server and kept in the URL, so switching views keeps them.
- Card fields are configurable, including custom fields, and remembered per user (`leads.board.cardFields`).
- The last view used is remembered too (`leads.mode`); `?view=board|list` takes priority.

**Card menu**

Open, Edit, Change status, Assign owner, Convert, Archive.

## Moving a card

- A drop calls the existing **`POST /api/v1/crm/leads/{id}/status`** with the lead's `version`. The server decides; nothing is re-validated in the browser.
- **Optimistic move:** the card moves at once and shows "saving…". If the server refuses, the card goes back to its exact original position:
  - A refusal (inactive status, converted lead, permission) shows the server's message with **[Open Lead]**.
  - A version conflict shows: "This lead was updated by another user. Please refresh and try again."
- **Dropping on a "Converted" status** opens the existing **Convert** drawer instead. Conversion creates or links the contact, company and opportunity, which a plain status change must never do. The card stays in place until the conversion is completed; then the board reloads.

## Shared board component

The mechanics of the board now live in one component, `src/components/crm/CrmKanbanBoard.tsx`, used by both the Opportunity and Lead boards:

- columns and per-column paging;
- HTML5 drag and drop with optimistic move and exact rollback;
- the refusal dialog;
- loading, empty and error states;
- the single-column phone layout.

Each entity supplies its own query, header, card, move call and summary. The Opportunity board was moved onto it with no behaviour change; all its existing tests pass unchanged.

## Database

No changes. There are no new tables, columns or migrations. The per-column query uses the existing `crm_leads (company_id, status_id)` index. The two new preference keys are code-only (registry).

## Files

**New:**

- `src/components/crm/CrmKanbanBoard.tsx`
- `src/modules/crm/leads/lead-board.service.ts`
- `src/modules/crm/leads/lead-board.integration.test.ts`
- `src/app/api/v1/crm/leads/board/route.ts`, `route.test.ts`
- `src/app/(dashboard)/crm/leads/_components/LeadBoardClient.tsx`, `LeadsWorkspace.tsx`, `useLeadFilters.ts`, `lead-board.test.tsx`

**Changed:**

- `leads/page.tsx` — renders the workspace.
- `LeadsListClient.tsx` — shared filters; lookups passed in by the page.
- `OpportunityBoardClient.tsx` — now uses the shared board.
- `board-components.test.tsx` — `moveFailureNotice` takes only the error now.
- `crm-preference-registry.ts` and its test — two lead keys added.

## Testing

**Integration** (`lead-board.integration.test.ts`, real Postgres):

- columns in status order;
- count, value and average (only leads with a value count toward the average);
- archived leads excluded, even with an `archived` filter;
- visibility (a rep sees only their own leads);
- temperature, value and owner filters;
- column paging without duplicates;
- an inactive status kept only while used;
- the drop path: version conflict, Converted refused by the status endpoint, audit row written.

**Route test:** `crm.view` required; query params passed through.

**Component tests** (`lead-board.test.tsx`):

- headers and card fields, including a custom field;
- a drop calls `/status` with the version, then the board reloads;
- a refusal rolls the card back to its original position and shows the server message with Open Lead;
- the version-conflict message;
- dropping on Converted opens Convert without calling `/status`;
- card-field preference saved.

**Regression:** the full suite passes (157 files, 2,481 tests), including all Opportunity board tests. `tsc` is clean; eslint has 0 errors.

**Browser** (Chromium, real pointer drags):

- the Board tab and URL;
- seven status columns with totals;
- New → Contacted saved on the server;
- conflict rollback;
- drop on Converted opens Convert while the lead stays New;
- search kept when switching to the List;
- mode remembered;
- phone layout shows one column.

## Limitations

- **Ordering:** cards are ordered newest first within a status. There is no manual ordering within a column.
- **Off-screen columns:** with many statuses, some columns sit off-screen on narrower displays. Chrome scrolls while you drag near the edge, and the card menu's Change status / Convert need no dragging.
- **Values:** values are per currency, with no conversion.
- **Saved views:** saved views open from the List; the Board uses the same URL filters.
