# 10 — Audience segments

[← Back to the overview](README.md)

A segment is a named group of people or companies, for example "Export buyers in Europe who ordered in the last 365 days". Campaigns use segments as their audience. Choosing an audience never sends anything.

## 1. Creating a segment

**Sales & Marketing → Audience Segments → New.**

1. **Source** (one per segment):
   - CRM **contacts**;
   - CRM **companies**;
   - CRM **leads**;
   - ERP **customers**.
2. **Type:**
   - **Dynamic:** members come from rules and are refreshed;
   - **Static:** a hand-picked list.
3. **Rules** (dynamic): groups of conditions joined by **ALL** (and) or **ANY** (or), one level deep, for example *country is India* AND *last order date in the last 365 days*. Customer rules include last order date, booked order value and booked order count.
4. **Exclusions:** exclusion rules, plus records you exclude by hand (with a reason).
5. **Channel (optional):** Email, WhatsApp, SMS or Phone. Records without an address for that channel, and **contacts who opted out or are on DND** for it, are marked *ineligible*.
6. **Refresh:** manual, or *every night* (02:00 India time).

**Preview** shows a live count with examples, but it isn't saved. **Evaluate** (refresh) takes a **snapshot**: who was in, who was left out and why.

## 2. Who is in a segment

Every record ends up as exactly one of:

- **Included**;
- **Excluded**, for one of these reasons:
  - not available (archived, merged, inactive);
  - not visible to you;
  - manual exclusion;
  - exclusion rule;
- **Ineligible:** no address, or consent restricted.

Consent is recorded only for CRM contacts. For companies, leads and customers the screen says consent **can't be verified**. Never treat them as cleared for marketing messages.

## 3. Versions and snapshots

- Every change to the definition is a new **version**. Old versions stay readable.
- The newest 5 snapshots keep their member lists. Mark a snapshot **Keep** (with a label) to hold it longer, for example the audience you actually sent to. Snapshots used by a campaign are kept too.

## 4. Using segments in a campaign

On the campaign page → **Audience**:

- add segments of one record type as **Include** or **Exclude**;
- optionally **pin** a snapshot, so the audience doesn't change while the campaign runs, or follow the latest one.

The campaign shows the combined count, with duplicates removed and exclusions subtracted. Segments can also restrict **promotions** to their members ([13](13-promotions.md)).

## 5. Good practice

- Set the segment's **channel** whenever you plan to message it. Consent is then checked for you.
- **Pin** the snapshot just before sending so the audience is fixed and traceable.
- Prefer dynamic segments with nightly refresh for audiences you use again and again.
