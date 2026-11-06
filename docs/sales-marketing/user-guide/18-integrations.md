# 18 — Integrations with other systems

[← Back to the overview](README.md)

For administrators who connect a website, a marketplace, a BI tool or another system to Sales & Marketing. **Sales & Marketing → Integrations** (needs Integrations view; edit to configure; approve to resolve conflicts, replay deliveries and revoke keys).

## 1. The registry

The **Integrations** tab lists every connection with its status and the reason, capabilities, and last success or error:

- API keys;
- outgoing webhooks;
- enquiry intake;
- the message providers ([12](12-sending-campaign-messages.md));
- the CRM's own integrations (read-only).

Open one to see usage, sync checkpoints, delivery statistics and history. Providers are labelled *Not live-verified* until they have actually been used.

## 2. API keys

**API keys → Create.**

- Choose only the **scopes** the other system needs: campaigns, performance, segments, quotations, jobs, webhooks, enquiry intake. Each scope shows the permission it needs.
- The key **acts as you**. Every call needs the scope **and** your current permissions and visibility. If you lose a permission, the key loses it too.
- The key is **shown once**; copy it into the other system straight away. Set an **expiry** and a rate limit.
- **Rotate** with a grace period, or **Revoke** with a reason.

Give integrators the **API & webhook guide** tab. It documents the base URL, authentication, limits, errors, idempotency, every endpoint and scope, signature checking and the event list.

## 3. Outgoing webhooks

**Outgoing webhooks → Create.**

- Give the receiving URL (https only, public addresses only) and choose the **events**, for example enquiry created, quotation accepted, order booked, campaign activated.
- The signing **secret is shown once**. The receiver must check the signature on every call.
- **Test**, enable / disable, rotate the secret, and look at the **delivery log**. Failed deliveries are retried automatically and can be **redelivered** by hand.

## 4. Enquiry intake and sync conflicts

Other systems can create and update enquiries through the API, using **their own IDs**:

- a repeated call never creates a duplicate;
- an older update never overwrites a newer one.

After creation the ERP owns the enquiry. When an outside update clashes with a change made in the ERP, a **sync conflict** is recorded instead of overwriting anything.

**Sync conflicts** tab: see the ERP value next to the external value, then **Keep** the ERP value, **Apply** the external one, or **Dismiss** (with a note). Open conflicts appear on the dashboard queue.

## 5. Good practice

- One key per integrator, with the fewest scopes and an expiry date.
- Watch the metric tiles: API error rate, failed webhooks and queue lag.
