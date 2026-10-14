# Communications: copy as a new draft, and saved templates

Owner request 2026-10-14: use a recent communication as the starting point of a new one, and save templates. Emails first; the same
for texts (SMS) and WhatsApp wherever the community has them. Built in migration `0800`, test `800`, with the screens under
`src/app/(app)/comms/`. Nothing here sends anything.

## What a person can do

| Where | What | Who |
|---|---|---|
| Communications › Newsletters, the **Recent** list, the ⋯ menu on a row | **Copy as new draft**, **Save as template** | `comms.send` |
| An open communication (`/comms/campaigns/<id>`), top right | the same two buttons | `comms.send` |
| Newsletters, the **Start from** card above the composer | **Blank** / **A saved template** / **A recent communication** | `comms.send` |
| Communications › **Templates** (`/comms/templates`) | every saved template: who made it and when, **Use**, **Rename**, **Delete** | `comms.send` |

The actions are on any communication the person can read, whatever its state (sent, scheduled, awaiting approval, a draft or cancelled),
except alerts and surveys. A person without `comms.send` sees none of them, and the Templates tab is hidden.

### Start from

- **Blank**: the composer below, as before.
- **A saved template**: the community's templates, filtered by channel (the chips list only the channels the community has) and searched by
  name or subject. **Use this template** makes a new draft with the template's words and **no audience**, and opens it.
- **A recent communication**: the last 50 that were sent, scheduled, awaiting approval or drafts (a cancelled one is left out), filtered by
  channel and searched by name, subject, audience or who wrote it. Each row shows its channels, audience in words, status, date and author.
  **Use this one** does exactly what **Copy as new draft** does.

## A copy

`app.copy_campaign_as_draft(center, campaign, name?)` makes a **new draft** in the same community.

| A copy keeps | A copy leaves behind |
|---|---|
| kind, subject, message (merge fields such as `{{recipient_first_name}}` stay as written), translations, channels | the schedule and the sent time |
| the audience and the saved-segment link | recipient and open counts, and the recipients (nothing is queued for a copy) |
| the name, as `Copy of <name>` (or of the subject), editable | the approvals (first and second approver) |

The "needs two approvers" flag is worked out again from the audience. The sender and the branding are the community's own (Settings ›
Email, the community profile) and are applied when a communication is sent; nothing about them is stored on a communication.

The copy opens in the composer on `/comms/campaigns/<id>`. Alerts and surveys are not copied.

### The new status: working draft

Until now a saved communication was always "Awaiting approval" (`draft`): its writer had pressed *Send for approval*. A copy must not appear
in the approvers' tasks half written, so it has its own status, **`working_draft`** ("Draft · not sent for approval"). The approval screens,
the Home tasks and the approve command look only for `draft` and `pending_approval`, so nobody can approve or schedule a working draft.

In the composer a working draft has two buttons:

- **Save draft** keeps it a working draft. Nothing is sent and nobody is asked. The audience can wait; the name, subject, message and at
  least one channel are needed.
- **Send for approval** (or **Schedule send**, for someone with `comms.approve` and an audience that is not all members) runs the compose
  form's usual rules: it needs an audience, and the two-person rule for all-member sends is unchanged (the database trigger enforces it).

**Discard draft** cancels it (status `cancelled`; it was never sent). If a draft's audience was set up outside the composer (for example a
boli's targeted households), the composer says it cannot show it and that saving replaces it.

## A template

`app.comms_templates` keeps the **words only**: name, channels, subject, message, translations, who made it and when. Not the audience, and
no statistic. A name is 1 to 120 characters and unique within the community (capitals and spaces at the ends do not count).

- Save: `app.save_campaign_as_template(center, campaign, name?)`. The name defaults to the communication's name, else its subject.
- Use: `app.create_campaign_from_template(center, template, name?)` makes a working draft with no audience.
- Rename and delete: `app.rename_comms_template`, `app.delete_comms_template`. Deleting a template changes nothing already made from it.
- Read: `comms.send` in the community (RLS). Writes go only through the functions; signed-in people have no insert, update or delete on the
  table. The table is audited (`audit_comms_templates`) and belongs to the Communications module (switch off, and nothing is read or written).

Templates are **not** `app.message_templates` (the wording of automatic and transactional messages, one row per key, channel and language) and
not `app.receipt_templates`; those are untouched.

### WhatsApp

A WhatsApp template saved here is **only a starting point for the words**. It is not a message template approved by WhatsApp (Meta): those are
submitted for approval in Settings › WhatsApp (`app.whatsapp_template_submissions`). The screens say so wherever a WhatsApp template is shown
(the save dialog, the picker, the Templates tab), and never call one approved.

## Channels the community has

Every action checks that the community has one of the communication's channels, on the screen (the action is not offered) and again in the
Server Action:

| Channel | The community has it when |
|---|---|
| Email, Push teaser, In-app archive | Communications is on |
| Text (SMS) | the carriers approved its texting registration (Settings › Texting) |
| WhatsApp | the WhatsApp product (module `channels`) is on **and** Meta approved its account (Settings › WhatsApp) |

A communication that uses only channels the community does not have gets no Copy or Save action, and the Start-from chips list only the
channels it has. If which channels are set up cannot be read, the page says so and leaves text and WhatsApp out; it never silently treats a
channel as off.

## Tests

- `supabase/tests/800_comms_copy_templates_test.sql`: the shape (status, table, RLS, audit, module, functions), what a copy carries and
  drops (including that no message is queued), who may copy, tenant isolation (another community's communication or template is "not found",
  and naming another community gives no rights), templates (save, unique names, words only, reads, no direct writes), start from, rename,
  delete, and Communications switched off.
- `tests/comms-templates.test.ts` (the rules and the SQL read from here), `tests/comms-template-actions.test.ts` (every action: success and each
  plain-English failure; saving and sending a working draft), `tests/comms-templates-render.test.ts` (the menu is present only with the
  permission, the Start-from card, the composer), and cases added to `tests/commands/messages-commands.test.ts` for the new status.

## Not done here (backlog)

Insert-a-merge-field and insert-a-button in the editor, a rich content editor, a custom sender, send-a-test-email, draft preview on large and
mobile screens, saved audiences that are re-evaluated at send time. Neon's "View statistics", "Resend to non-openers", "Archive" and "Delete
email" are not part of this change.
