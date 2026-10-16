# Payment proofs, soft credit and bank reconciliation prototype (2026-10-15)

Reference only, never shipped (CLAUDE.md). Made because the owner asked to see the screens, mobile and CRM, before the build.
Plan: [`docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md`](../../../PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md) (owner accepted every recommended answer, 2026-10-15).
Live canvas, private to the owner: https://claude.ai/artifact/FU2zQgj6rsvnAGM4obYm69

Owner rule shown on every screen: the outstanding Open balance never includes Soft credit or reconciled money
(Open balance = amount - paid - soft credit).

- `Main.dc.html`: how a pledge moves (Open, Soft credit, Paid, Bank reconciled), the open-balance rule with a worked example, and the order a bank line is tried in.
- `AppFlow.dc.html`: member app, Open pledges to "I paid another way" to proof, review and sent (clickable).
- `AppCheckout.dc.html`: the same sheet at RSVP checkout (amount locked) and store checkout (pay at pickup, or already paid).
- `AppProofs.dc.html`: My payment proofs (waiting, needs more, paid, not accepted), the proof detail, the reply, and the notices.
- `AppPledgeDetail.dc.html`: the Closed filter and Pledge details of any old pledge with its proofs, the share each covered, the kept-until date, and the same screen after the years ran out (photo removed, receipt stays).
- `Queue.dc.html`: Giving > Today with "Proofs to verify" and the review sheet (approve, change, ask, reject; duplicate and second-person cases) (clickable).
- `Household.dc.html`: a household's pledges in the four states, evidence panel with retention date, timeline.
- `Reconcile.dc.html`: Giving > Bank reconciliation preview (Certain, Likely, Possible, Conflict, Already accounted for, New money) and "Paid, not on the bank" (clickable).
- `Settings.dc.html`: Settings > Storage "Payment proofs" years and legal hold, and the proof rules per method (clickable years).

Files are Design-canvas `.dc.html` artboards; sample data only (Riverbend Community Center). Not rendered or checked by the
author after publishing.
