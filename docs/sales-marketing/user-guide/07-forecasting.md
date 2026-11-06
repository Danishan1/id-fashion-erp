# 07 — Sales forecasting

[← Back to the overview](README.md)

The forecast estimates **booked order value** for a month, quarter or year: what you have already booked plus what the open pipeline is likely to bring. It is always labelled *Forecast*, and never shown as orders, invoices, revenue or cash.

## 1. Two methods

| Method | How it works | Best for |
|---|---|---|
| **Pipeline-weighted** (default) | Booked so far in the period + Σ (pipeline value × win probability) of items expected to close within the period | The current and next periods |
| **Moving-average trend** | Average booked value of the last *N* complete periods (Settings, default 3) | A sanity check; needs at least *N* periods of history |

## 2. What is in the pipeline

| Item | Included when | Probability |
|---|---|---|
| Quotation **approved** (not yet issued) | — | default 30 % |
| Quotation **issued**, not expired | — | default 50 % |
| Quotation **accepted**, not yet ordered | expected today | default 90 % |
| CRM **opportunity**, open, with an amount and expected close date | not already covered by a quotation or order | the opportunity's own probability |

Change the default probabilities in **Sales & Marketing → Settings → Forecast**. An opportunity linked to a quotation in the pipeline is never counted twice.

**Excluded** items are listed with the reason, never silently dropped:

- no expected date;
- expected date already passed (overdue);
- no amount;
- another currency;
- expired quotation.

## 3. The forecast page

**Sales & Marketing → Forecast.** Pick the period. You see:

- **Overview:** actual so far, weighted pipeline, forecast (both methods), target, forecast − target, **still needed**, and **coverage** (weighted pipeline ÷ still needed);
- a chart of past actuals against targets and the forecast;
- rows per **rep**, **team** and **territory**;
- **pipeline items** with value, probability and weighted value, plus the excluded list;
- **data-quality warnings** (stale opportunities, default probabilities in use, no target, not enough history).

> **Tip:** the excluded list is a to-do list. Give overdue opportunities a new date, add amounts, close dead deals. The forecast is only as good as the pipeline.

## 4. Snapshots and accuracy

- An **automatic snapshot** is taken at the start of each month (and each quarter and year).
- Click **Save snapshot** (with a note) any time, for example before a board meeting.
- When a period has ended, each snapshot shows its **accuracy**: error and % error against the actual. Over time, **MAE**, **WAPE** and **bias** show whether your forecasts run too high or too low.

## 5. What-if scenarios

**Forecast → Scenarios → New.** Choose a period and assumptions:

- **probability factor:** e.g. 80 % = be more cautious;
- **slip:** move expected dates later by some days;
- include overdue items or not;
- growth % for the trend.

Results appear next to the baseline. Saved scenarios keep their last result.

## 6. Reports

Report Center → Sales & Marketing: **Forecast Pipeline** and **Forecast Accuracy**.
