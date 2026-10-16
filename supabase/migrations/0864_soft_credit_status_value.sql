-- 0864 · Payment proofs, step 1 of 4: the pledge status "soft_credit" (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §3.1).
-- A new enum value cannot be used in the transaction that adds it, so it is a file of its own; 0865 uses it.
alter type app.pledge_status add value if not exists 'soft_credit';
