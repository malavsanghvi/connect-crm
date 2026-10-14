# Print and email a pledge

Owner request, 2026-10-14. Migrations 0790 to 0793. Giving › Pledges › ⋯ now has **Print…** and **Email…**, a pledge is emailed to its
family automatically however it was made, and a bulk upload reports what happened to each email.

## What a person sees

| Where | What |
|---|---|
| Giving › Pledges, each row's ⋯ menu | **Print…** (giving.view or giving.manage) and **Email…** (giving.manage), just before *Open family*. Not for a deleted pledge. |
| A family's Pledges tab | **Print** and **Email** beside *Edit*. |
| Print | The PDF opens in the browser's print dialog (a hidden frame; a new tab where a browser will not print a frame). When it cannot be made (no access, no answer, a blocked window) a dialog says why in plain English, next to the pledge, with *Try again*. |
| Email | A sheet with the household card, the pledge, and a **To** text box that starts with the **primary member's email** and can be edited. Under it: whose address it is ("Tarun Patni, primary member"), or that it is not theirs. No address on file: the box is empty with a plain note and the person types one. *Send* names the pledge and the address. The sheet then asks the database how it went (sending, sent, or failed/not sent with the reason) and never says "Sent" before the server does. Earlier emails of the pledge are listed. |
| The pledge's History | Every send, automatic or by hand, is an entry: `pledge.email_requested` (who, which address, when), `pledge.email_queued` (automatic), `pledge.email_not_sent` (and why). |
| Giving › Pledges › Upload | **Email each family their pledge** (ticked by default). After recording, a panel reports how many families were emailed, how many had no email address on file, how many could not be sent (with the reason), and each pledge held back with its reason. It updates by itself until nothing is waiting. |
| Settings › Automatic emails | The pledge confirmation says **on by default**, who gets it, and that a bulk upload is included. Switch it off there per community. |

## The PDF

`src/lib/pledge-pdf/`: `document.ts` builds what it says (pure, integer cents formatted at the edge in the community's currency, locale
and time zone), `render.ts` draws it with pdf-lib, `logo.ts` picks the community's logo (PNG or JPEG from the public branding bucket;
an SVG or WebP logo is skipped and the community's name is drawn), `print.ts` is the browser side. One renderer serves the Print route
(`/giving/pledges/<id>/pdf`) and the email attachment, so they never differ.

Contents: the community (logo or name, legal name, address, contact, website, tax id), pledge number, date made, due date and status, the
household as its card shows it (name without children's first names, Connect household number, the organization's own household ID,
primary member, address), campaign, fund, opportunity, dedication, who pledged (an adult), amount, paid to date, balance, the payments
applied (date, method, receipt number, amount), instalments, the community's pledge-confirmation signer and note, how to pay (the
community's own contact), and a footer saying it is a record of a pledge, not a receipt. US Letter where Letter is used, A4 elsewhere.

The PDF uses the built-in Helvetica. Letters outside Western European alphabets are drawn in a plainer form (or "?"), and the page says
so in a small note. Embedding a Unicode font is a follow-up (needs `@pdf-lib/fontkit` and a font file).

## The automatic email

- **On by default for every community** (0790): every community has its `pledge_recorded` row in `app.email_automations`, switched on
  (made with the community, and backfilled; an email a person had switched off stays off). The Settings screen switches it per community.
- **Who**: the household's **primary member**, not the person who pledged. No usable address (none, a child as primary member, a primary
  member who died, no primary member): nothing is sent, and the reason is written to the pledge's History and the upload result.
- **Once per pledge**, whatever the address. The **Email…** menu item is the only way to send again.
- **Every path**: a member's own pledge (the app's insert), staff one at a time (`record_manual_pledge`), a bulk upload
  (`record_pledge_upload`), `close_boli` and the rest: they all go through the same trigger on `app.pledges`.
- **Not sent** for imported history (the import tool, a CRM or QuickBooks id), fees, recurring cycles, store orders and RSVP commitments,
  a pledge already paid, a pledge dated **more than 30 days** before it was recorded (an upload of old pledge cards), a demo community
  (nothing is queued at all), or an upload whose box was unticked (each pledge records "declined").
- **The treasurer's approval still gates it** (0770): until the treasurer's approval of the receipt templates is current, the automatic
  email waits and says so (History, upload result, Settings). The Email… menu item is not held back by it (a person is writing on purpose).
- **Sandboxes** reach only verified test recipients and **demo communities** are never sent anything (the sender refuses them): both
  exactly as before.

## How it is sent

`app.pledges` trigger → `messaging.compose` job (ids only) → the background service reads `app.worker_email_facts`, writes the values and
queues the email through `app.worker_email_enqueue` → `app.enqueue_notice` (suppressions, opt-outs, sandbox rule) → `messaging.send`.

**Attachments** (`worker/src/message-attachments.ts`): the message names the file in its payload, `{attachments: [{kind: "pledge_pdf",
pledge_id}]}`: ids only, no bytes and nothing about a person. `messaging.send` draws the PDF from `app.worker_pledge_document` (which
answers only for a pledge the message names, in the message's community) and hands it to Resend (`attachments`) or Postmark
(`Attachments`) as base64. At most 3 files and 5 MB per message; an unknown kind or a failed PDF stops the email and records a plain
reason (it is never sent without its PDF). The demo-community refusal happens before any PDF is drawn.

**By hand** (`app.send_pledge_email`): giving.manage, one address checked (shape, one @, no commas), once per confirmation key (a double
click is one email), at most 40 an hour per person. The request row (`app.pledge_emails`) holds who, which pledge, which address and
when; the job carries only the request id, never the address. A household adult at the typed address is greeted by name; any other
address gets "Dear friend".

## Reading the results

- One email: `app.pledge_email_request_status` (waiting, sent, failed, not_sent, with the reason).
- Many: `app.pledge_email_status(center, pledges)` states: `sent`, `waiting`, `pending` (not written yet), `no_email`, `declined`,
  `history`, `not_approved`, `switched_off`, `failed`, `not_sent`. The upload's panel turns them into the three numbers.
- Why an email was not sent is a word (`email_automation_sends.reason_code`) and a sentence (`reason`).

## Tests

`supabase/tests/184_pledge_print_email_test.sql` (database), `tests/pledge-pdf.test.ts`, `pledge-pdf-route.test.ts`,
`pledge-print.test.ts`, `pledge-email.test.ts`, `pledge-email-actions.test.ts`, `giving-email-pledge-render.test.ts`,
`messaging-attachments.test.ts`, `giving-lists-pledges.test.ts` (the menu items), `worker/test/messaging.attachments.test.ts` and
`worker/test/messaging.compose.test.ts`.

## Decisions to confirm

1. The automatic email still waits for the treasurer's current approval of the receipt templates (0770's rule). A community that never
   approved them sends nothing automatically, and says why. Drop the gate for the pledge email if the owner prefers.
2. The Email… menu item is not held back by that approval (a person is writing to a family on purpose), only by giving.manage, the
   address check and the 40-an-hour limit.
3. Pledges dated more than 30 days before they are recorded count as history and are not emailed (the owner's "historical pledges must
   not trigger emails" needs a line somewhere; 30 days lets last week's pledge cards still go).
4. The automatic email goes to the primary member only, even when someone else of the household made the pledge.
5. Fonts: Helvetica only (see above).
