# 11 — Content library: assets, templates and campaign content

[← Back to the overview](README.md)

Everything a campaign sends must be **approved internally** first, by someone other than its author. The Content Library keeps the files and texts, their versions and their reviews in one place.

## 1. Assets (images, logos, documents, videos)

**Sales & Marketing → Content Library → Assets → Upload.**

- **Metadata:** type, tags, alt text, usage rights and an **expiry date** (for example a licensed photo).
- **Versions:** replacing the file creates a new version. Old versions stay unchanged.
- **Review:** submit the version for review. A reviewer **approves**, **requests changes** or **rejects**.
- Campaigns can only attach **approved** asset versions to e-mails. Videos are stored and previewed, but not sent.
- The asset page shows where the asset is used, warns about duplicates, and lets you archive or restore.

## 2. Message templates

Templates are the CRM message templates (CRM → Templates), with a **marketing review** added for each version.

- Content Library → **Templates** shows each template, its review status and the version campaigns will send.
- Edit the text in CRM; review it here.
- A channel can only send a template version that has been approved.

## 3. Campaign content

For campaign-specific messages, open the campaign → **Content** → **New content from a template**:

- pick the channel and language;
- edit the subject and body, inserting **variables** (customer name and so on) from the picker;
- attach **approved** files from the library;
- every save is a new version with a change note;
- preview with sample data or a real contact;
- submit for review.

The original template is never changed. A delivery channel sends either the template as it is or the campaign's own approved content. The channel shows exactly which version and files it will send.

## 4. Channel rules to know

| Channel | Format |
|---|---|
| Email (SMTP, Brevo) | Plain text, with attachments from the library. An unsubscribe footer is always added |
| SMS (MSG91) | Needs the **DLT-approved template ID** typed into the template version |
| WhatsApp (Cloud API) | Needs the **Meta-approved template name and language** typed into the template version; no media headers |

"Approved" in this module always means approved **internally**. The provider's own approval (DLT, Meta) is something you obtain from the provider and record here.

## 5. Reviews queue

Content Library → **Reviews** lists everything waiting for review, by status and kind. Reviewers work from this queue.
