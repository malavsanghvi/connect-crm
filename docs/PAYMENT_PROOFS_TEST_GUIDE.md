# Testing payment proofs, Soft credit and bank reconciliation

For the owner's testing (2026-10-16). Plan: `PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md`. **Payment proofs is switched ON for JSH** (and any sandbox
community) by migration 0869; every other community has it off (Settings › Modules › Payment proofs). Use sandbox money only.

**Before you start.** The member app needs the 1.26.0 update (published to the preview channel; close and reopen the app twice). Under
Settings › Payments, make sure at least one offline way (check, cash, Zelle, bank transfer) is accepted. In the member app a proof can
be sent by an **adult** of a household that has at least one open pledge. In this release a proof is attached from the **gallery**
(taking a photo or attaching a file comes with the next app build). Zelle keeps its own "I sent it" report.

## 1. Member: send a proof (member app)
1. Pledges › **I paid another way**. Choose Check, amount $250, a date, a check number, add a photo from the gallery, review, **Send**.
2. The oldest pledges show **Soft credit** (a partly covered one shows "Soft credit $X waiting"). Check the tiles: **Open balance** drops by
   what the proof covers (Open balance = amount − paid − soft credit), "Soft credit" shows the rest.
3. Try: more than the open balance (the extra is kept, not credited); a second proof while pledges are covered; a child account (refused);
   **My payment proofs** › take a proof back (pledges return to Open); RSVP › **I paid another way** (amount locked to the RSVP).

## 2. Treasury: verify (portal, Giving › Payment proofs; also the Home task "Proofs to verify")
1. Open the card: household card, photos (click to enlarge), the pledges it will cover, the system's checks.
2. **Approve**. A payment is recorded once, the pledges become **Paid**, the member gets a notice and a receipt number. Open balance does not change.
3. Try **Ask for more** (the member sees the question, answers with photos), **Reject** (a reason is required; pledges reopen), **Approve with changes**,
   and your own household (refused). Set a second-approver amount under Settings › Payments › Payment proofs and send a bigger proof.

## 3. Evidence stays with the pledges
Member app: open any paid pledge (Closed filter) › **Your proof** with the share it covered and "You can open this until <date>".
Portal: Households › a household › Pledges › Evidence. A payment that covered three pledges shows the same proof on all three.

## 4. Bank statement (Giving › Bank, needs Bank reconciliation)
1. Import a statement CSV as usual, then open **Reconcile**: each line shows what the money may already be (a payment awaiting the bank, a waiting
   proof, a Zelle report, a conflict, a lookalike, or new money) with the exact consequence in words.
2. A line that equals a recorded payment: **Attach** (no pledge changes; the pledge becomes **Bank reconciled**). A line that equals a waiting proof:
   **Approve and reconcile**. A line that looks like money already counted: creating a second payment is refused unless you type why.
3. **Unbanked** lists payments counted as paid that no bank line has banked, past their usual window. **Undo** a wrong match from History (giving.manage + reason).

## 5. Settings
Settings › Storage › **Payment proofs**: keep for 3–25 years, legal hold. Shortening asks for a reason. Settings › Payments › **Payment proofs**:
which ways need a proof, days to reach the bank, second-approver amount, reply wait.

## Known limits of this release
- Camera and file attach in the app (next app build); Zelle in the sheet; PDF statements; returned/bounced items.
- The daily removal job deletes proofs only after the years you set and only when their pledges are final (reconciled, written off or cancelled).
- If something looks wrong, note the pledge number and the time; every step is in the audit log.
