-- 0868 · Smart bank reconciliation (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §5).
--
--   app.bank_window_days(center, method)      the usual days a method takes to reach the bank (policy.windows over defaults)
--   app.reconcile_candidates(txn)             for ONE incoming bank line, what the money may already be, strongest first:
--                                             an unbanked recorded payment · a waiting proof · a member's Zelle report · a conflict (amount
--                                             differs) · a lookalike (blocked) · new money. Each row carries its tier (A certain, B likely,
--                                             C possible, D needs a look), reasons, and the exact consequence in words.
--   app.reconcile_statement(center, ...)      every unmatched incoming line with its best candidates, for the preview. Writes nothing.
--   app.unbanked_payments_report(center)      payments counted as paid that no bank line has banked, past or inside their window
--   app.unbanked_counts(center)               its Home numbers
--   app.unreconcile_bank_line(txn, reason)    undo an attach (not a payment the bank line itself created, not once QuickBooks has the deposit)
--
-- Nothing here changes money: applying a row uses the existing functions (attach_bank_line_to_payment, approve_payment_proof with a bank
-- line, confirm_bank_match, match_deposit), each re-checking at call time. A new-money row is offered only when nothing recorded or waiting
-- can be that money, and then only for pledges not already covered (0867).
set client_min_messages = warning;

create or replace function app.bank_window_days(p_center uuid, p_method text) returns int
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(nullif(((app.proof_policy(p_center) -> 'windows') ->> p_method), '')::int,
         case p_method when 'zelle' then 5 when 'ach' then 7 when 'check' then 30 when 'cash' then 14 when 'stock' then 30
                       when 'daf' then 60 when 'matching_gift' then 60 else 45 end)
$$;

-- Which statement lines a method can be: a check is a check line; Zelle is a Zelle line or one the bank did not label; the rest arrive by
-- ACH or wire or unlabelled; cash banks in a deposit (never a single line here); a card payout is never a gift.
create or replace function app._line_fits_method(p_channel text, p_method app.payment_method) returns boolean
language sql immutable as $$
  select case coalesce(p_channel, 'other')
           when 'zelle' then p_method in ('zelle', 'other')
           when 'check' then p_method = 'check'
           when 'ach' then p_method in ('ach', 'stock', 'daf', 'matching_gift', 'other')
           when 'wire' then p_method in ('ach', 'stock', 'daf', 'matching_gift', 'other')
           when 'cash_deposit' then p_method = 'cash'
           when 'card_payout' then false
           else true end
$$;

create or replace function app.reconcile_candidates(p_txn uuid)
returns table (rank int, tier text, kind text, ref_id uuid, household_id uuid, household_name text, label text, reasons jsonb,
               consequence text, blocked boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare t app.bank_transactions; v_ref text;
begin
  select * into t from app.bank_transactions where id = p_txn;
  if t.id is null then return; end if;
  perform app.assert_module_enabled(t.center_id, 'giving');
  perform app.assert_module_enabled(t.center_id, 'giving_bank');
  if not (app._proof_staff(t.center_id) or app.has_permission(t.center_id, 'giving.view')) then
    raise exception 'Reconciling the bank needs giving.record_offline or giving.view.' using errcode = '42501';
  end if;
  if t.amount_cents <= 0 or t.is_batch_deposit or t.status in ('matched', 'ignored', 'payout') then return; end if;
  v_ref := nullif(upper(regexp_replace(coalesce(t.reference, ''), '[^A-Za-z0-9]', '', 'g')), '');
  return query
  with hh as (select s.household_id, s.score, s.report_id from app.suggest_bank_matches(p_txn) s),
  fit as (   -- unbanked recorded payments and waiting proofs of exactly this amount, inside the method's window
    select 'payment'::text as kind, p.id, p.household_id, p.method, p.received_on as on_date, p.receipt_number as ref_text,
           (v_ref is not null and upper(regexp_replace(coalesce(p.check_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_ref) as ref_ok
      from app.payments p
     where p.center_id = t.center_id and p.provider = 'offline' and p.deposit_bank_transaction_id is null
       and p.status in ('captured', 'pending_clearing') and p.amount_cents = t.amount_cents and p.method <> 'cash'
       and app._line_fits_method(t.channel, p.method)
       and p.received_on between t.posted_on - app.bank_window_days(t.center_id, p.method::text) and t.posted_on + 3
    union all
    select 'proof', q.id, q.household_id, q.method, q.paid_on, q.reference,
           (v_ref is not null and upper(regexp_replace(coalesce(q.reference, ''), '[^A-Za-z0-9]', '', 'g')) = v_ref)
      from app.payment_proofs q
     where q.center_id = t.center_id and q.status in ('submitted', 'needs_info') and q.amount_cents = t.amount_cents and q.method <> 'cash'
       and app._line_fits_method(t.channel, q.method)
       and q.paid_on between t.posted_on - app.bank_window_days(t.center_id, q.method::text) and t.posted_on + 3
  ),
  scored as (
    select f.*, coalesce((select max(h.score) from hh h where h.household_id = f.household_id), 0) as who, count(*) over () as n
      from fit f
  ),
  rows_fit as (
    select case when s.ref_ok and s.n = 1 then 'A'
                when s.ref_ok then 'B'
                when s.n = 1 and s.who >= 0.9 then 'A'
                when s.n = 1 and s.who > 0 then 'B'
                else 'C' end as tier,
           s.kind, s.id as ref_id, s.household_id,
           case s.kind when 'payment' then 'Receipt ' || coalesce(s.ref_text, '?') || ', ' || replace(s.method::text, '_', ' ') || ', ' || to_char(s.on_date, 'FMMon FMDD') || ', not yet on the bank'
                       else 'Proof sent for ' || to_char(s.on_date, 'FMMon FMDD') || ', ' || replace(s.method::text, '_', ' ') || coalesce(' ' || s.ref_text, '') end as label,
           (select jsonb_agg(x) from (values ('Amount matches'), (case when s.ref_ok then 'Reference matches' end),
                  (case when s.who >= 0.9 then 'Known payer name' when s.who > 0 then 'Payer fits this family' end),
                  ('Inside the usual window'), (case when s.n = 1 then 'Only one candidate' else s.n || ' candidates fit' end)) v(x) where x is not null) as reasons,
           case s.kind when 'payment' then 'The line is attached to this payment. No pledge changes.'
                       else 'The proof is approved and banked in one step: its pledges become Paid, then Bank reconciled.' end as consequence,
           s.who
      from scored s
  ),
  rows_zelle as (
    select case when h.score >= 0.99 then 'A' when h.score >= 0.9 then 'B' else 'C' end as tier, 'zelle_report'::text as kind, h.report_id as ref_id,
           h.household_id, 'A Zelle report from this family'::text as label,
           '["Amount matches","Member reported this Zelle"]'::jsonb as reasons,
           'Confirm the line with the family''s report: a payment is recorded and its pledges are chosen as the family said.'::text as consequence,
           h.score as who
      from hh h where h.report_id is not null and not exists (select 1 from fit)
  ),
  rows_conflict as (   -- same family, same kind of money, but the amount differs by up to a fifth
    select 'D'::text as tier, 'conflict'::text as kind, c.id as ref_id, c.household_id,
           'Recorded ' || to_char(c.amount_cents / 100.0, 'FM$999,999,990.00') || ', the bank shows ' || to_char(t.amount_cents / 100.0, 'FM$999,999,990.00')
             || ' (' || case when t.amount_cents > c.amount_cents then 'more' else 'less' end || ' by ' || to_char(abs(t.amount_cents - c.amount_cents) / 100.0, 'FM$999,999,990.00') || ')' as label,
           '["Same family","Amount differs"]'::jsonb as reasons,
           'Nothing is attached until you choose: record the bank''s amount (the bank is the truth) with a reason, or leave the line.'::text as consequence,
           0::numeric as who
      from (select p.id, p.household_id, p.amount_cents, p.method, p.received_on from app.payments p
             where p.center_id = t.center_id and p.provider = 'offline' and p.deposit_bank_transaction_id is null and p.status in ('captured', 'pending_clearing')
               and p.method <> 'cash' and p.amount_cents <> t.amount_cents and abs(p.amount_cents - t.amount_cents) <= p.amount_cents / 5
               and app._line_fits_method(t.channel, p.method)
               and p.received_on between t.posted_on - app.bank_window_days(t.center_id, p.method::text) and t.posted_on + 3
            union all
            select q.id, q.household_id, q.amount_cents, q.method, q.paid_on from app.payment_proofs q
             where q.center_id = t.center_id and q.status in ('submitted', 'needs_info') and q.method <> 'cash' and q.amount_cents <> t.amount_cents
               and abs(q.amount_cents - t.amount_cents) <= q.amount_cents / 5 and app._line_fits_method(t.channel, q.method)
               and q.paid_on between t.posted_on - app.bank_window_days(t.center_id, q.method::text) and t.posted_on + 3) c
     where exists (select 1 from hh h where h.household_id = c.household_id) and not exists (select 1 from fit)
  ),
  rows_new as (       -- nothing recorded or waiting can be this money: new money, or a blocked lookalike in the family it points to
    select case when exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on)) then 'D'
                when h.score >= 0.9 then 'B' else 'C' end as tier,
           case when exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on)) then 'lookalike' else 'new_money' end as kind,
           null::uuid as ref_id, h.household_id,
           case when exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on))
                then 'This family has ' || (select z.label from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on) z limit 1) || ' of this amount not on the bank yet'
                else 'No recorded payment or proof explains this money' end as label,
           (select jsonb_agg(x) from (values (case when h.score >= 0.9 then 'Known payer name' else 'Payer name or ID suggests this family' end),
                  (case when not exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on)) then 'No lookalike found' end)) v(x) where x is not null) as reasons,
           case when exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on))
                then 'Creating a second payment is blocked. Attach the line to that payment (or approve that proof with it), or say why this is a separate gift.'
                else coalesce('A payment is recorded from the line. Oldest uncovered pledges first: ' ||
                              (select string_agg(coalesce(a.pledge_number, 'a pledge') || ' ' || to_char(a.amount_cents / 100.0, 'FM$999,999,990.00'), ', ' order by a.pledge_number)
                                 from app.preview_allocation(h.household_id, t.amount_cents) a) || '. Pledges already covered by a proof are skipped.',
                              'A payment is recorded from the line; this family has no open pledge, so it stays unallocated.') end as consequence,
           h.score as who
      from (select * from hh order by score desc limit 3) h
     where not exists (select 1 from fit) and not exists (select 1 from rows_zelle) and not exists (select 1 from rows_conflict)
  )
  select (row_number() over (order by u.tier, u.who desc))::int, u.tier, u.kind, u.ref_id, u.household_id, h2.display_name, u.label,
         coalesce(u.reasons, '[]'::jsonb), u.consequence, (u.kind = 'lookalike')
    from (select tier, kind, ref_id, household_id, label, reasons, consequence, who from rows_fit
          union all select tier, kind, ref_id, household_id, label, reasons, consequence, who from rows_zelle
          union all select tier, kind, ref_id, household_id, label, reasons, consequence, who from rows_conflict
          union all select tier, kind, ref_id, household_id, label, reasons, consequence, who from rows_new) u
    join app.households h2 on h2.id = u.household_id
   order by 1;
end $$;

create or replace function app.reconcile_statement(p_center uuid, p_account uuid default null, p_limit int default 300) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_bank');
  if not (app._proof_staff(p_center) or app.has_permission(p_center, 'giving.view')) then
    raise exception 'Reconciling the bank needs giving.record_offline or giving.view.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'txn', jsonb_build_object('id', l.id, 'posted_on', l.posted_on, 'amount_cents', l.amount_cents, 'description', l.description,
                                       'channel', l.channel, 'reference', l.reference, 'payer_name', l.payer_name),
             'candidates', coalesce((select jsonb_agg(to_jsonb(c) - 'rank' order by c.rank) from (select * from app.reconcile_candidates(l.id) limit 4) c), '[]'::jsonb))
           order by l.posted_on desc, l.id)
      from (select id, posted_on, amount_cents, description, channel, reference, payer_name from app.bank_transactions
             where center_id = p_center and amount_cents > 0 and not is_batch_deposit and status in ('unmatched', 'suggested')
               and (p_account is null or bank_account_id = p_account)
             order by posted_on desc, id limit greatest(1, least(coalesce(p_limit, 300), 500))) l), '[]'::jsonb);
end $$;

create or replace function app.unbanked_payments_report(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_tz text; v_today date;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not (app._proof_staff(p_center) or app.has_permission(p_center, 'giving.view')) then
    raise exception 'Seeing unbanked payments needs giving.record_offline or giving.view.' using errcode = '42501';
  end if;
  select time_zone into v_tz from app.centers where id = p_center;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  return coalesce((
    select jsonb_agg(x.j order by (x.j ->> 'days')::int desc) from (
      select jsonb_build_object('payment_id', p.id, 'receipt_number', p.receipt_number, 'household_id', p.household_id,
               'household_name', h.display_name, 'method', p.method, 'amount_cents', p.amount_cents, 'verified_on', p.received_on,
               'source', case when p.idempotency_key like 'proof:%' then 'proof' else 'recorded by hand' end,
               'days', v_today - p.received_on, 'window', app.bank_window_days(p.center_id, p.method::text),
               'past_window', v_today - p.received_on > app.bank_window_days(p.center_id, p.method::text)) as j
        from app.payments p join app.households h on h.id = p.household_id
       where p.center_id = p_center and p.provider = 'offline' and p.deposit_bank_transaction_id is null
         and p.status in ('captured', 'pending_clearing') and not coalesce(p.is_historical, false)
         and not exists (select 1 from app.counting_sessions cs where cs.payment_id = p.id)) x), '[]'::jsonb);
end $$;

create or replace function app.unbanked_counts(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r jsonb := app.unbanked_payments_report(p_center);
begin
  return jsonb_build_object('total', jsonb_array_length(r),
                            'past_window', (select count(*) from jsonb_array_elements(r) e where (e ->> 'past_window')::boolean),
                            'oldest_days', coalesce((select max((e ->> 'days')::int) from jsonb_array_elements(r) e), 0));
end $$;

create or replace function app.unreconcile_bank_line(p_txn uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.bank_transactions; p app.payments; v_reason text := nullif(btrim(p_reason), '');
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  if t.id is null then raise exception 'That bank line was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(t.center_id, 'giving_bank');
  if not app.has_permission(t.center_id, 'giving.manage') then raise exception 'Undoing a bank match needs giving.manage.' using errcode = '42501'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Say why you are undoing it, in a few words.' using errcode = '22023'; end if;
  if t.status <> 'matched' then raise exception 'That bank line is not matched.' using errcode = '22023'; end if;
  select * into p from app.payments where deposit_bank_transaction_id = t.id and provider = 'offline' limit 1;
  if p.id is null then
    raise exception 'This line created its payment, or banked a whole deposit. Undo that from the payment (a refund or a correction), not here.' using errcode = '22023';
  end if;
  if exists (select 1 from app.ledger_postings l where l.center_id = t.center_id and l.idempotency_key = 'deposit:' || t.id and l.status in ('posting', 'posted')) then
    raise exception 'QuickBooks already has this deposit, so it cannot be undone here.' using errcode = '22023';
  end if;
  perform app.set_audit_context(v_reason);
  delete from app.ledger_postings where center_id = t.center_id and idempotency_key = 'deposit:' || t.id and status in ('queued', 'failed');
  update app.payments set deposit_bank_transaction_id = null, status = 'captured' where id = p.id;
  update app.bank_transactions set status = 'unmatched', matched_household_id = null, payment_id = null, matched_by = null, matched_at = null where id = t.id;
  update app.payment_proofs set bank_transaction_id = null where bank_transaction_id = t.id;
  update app.payment_reports set bank_transaction_id = null where bank_transaction_id = t.id and status = 'matched';
end $$;

do $$ declare fn text;
begin
  foreach fn in array array['reconcile_candidates(uuid)', 'reconcile_statement(uuid,uuid,int)', 'unbanked_payments_report(uuid)',
                            'unbanked_counts(uuid)', 'unreconcile_bank_line(uuid,text)', 'bank_window_days(uuid,text)'] loop
    execute format('revoke all on function app.%s from public, anon', fn);
    execute format('grant execute on function app.%s to authenticated, service_role', fn);
  end loop;
  revoke all on function app._line_fits_method(text, app.payment_method) from public, anon;
  grant execute on function app._line_fits_method(text, app.payment_method) to authenticated, service_role;
end $$;
