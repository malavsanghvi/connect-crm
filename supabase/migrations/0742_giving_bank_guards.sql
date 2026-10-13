-- 0742 · Bank reconciliation (giving_bank) guards (docs/GIVING_REDESIGN.md section 11.1, slice M2, part 2 of 3).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0741 made Bank reconciliation an add-on of Giving. Its tables are already hidden when it is off (their restrictive
--   module_switch policies). This migration makes its functions say so too, because they run as the definer and would
--   otherwise still read and write those tables:
--     * every function below keeps its "giving" check word for word and gains the same check for "giving_bank" right
--       after it, so the sentence names the module that is actually off ("The Bank reconciliation module is switched off
--       for this community.", or 0740's "... is off because Pledges & donations is off ...");
--     * the two summary reads (SQL, security invoker) check it in the WHERE of their single row;
--     * some answers instead of refusing, so nothing that is not part of Bank reconciliation breaks:
--         my_payment_reports           an empty list (an installed member app asks on its Pledges screen)
--         worker_payment_reports_sweep skips the community's reports
--         possible_duplicate_zelle     still warns about a Zelle payment recorded twice (core data) and leaves out the
--                                      member reports, so recording a payment works as before
--         member_payment_methods       Zelle stays a way to give; "report a Zelle payment" is not offered
--   Recording, allocating and refunding payments (the core) are untouched. Money rules are unchanged: guards only refuse.
--
-- Each body is copied from the migration named in its heading (the latest definition of that function); the only changes
-- are the lines marked above. Not changed, on purpose: the private helpers only these functions call (zelle_recorded_payments,
-- _zelle_report_held, _zelle_report_notice, zelle_pair_is_exact, zelle_bank_account_id), the bank_transactions trigger,
-- the payee change functions (0597; core payment settings) and _payment_plugin_readiness (owner decision 2026-10-12: Zelle
-- reporting needs Bank reconciliation, as today).

-- ── app.confirm_bank_match (latest body: 0583) ──────────────────────────────────────────────
create or replace function app.confirm_bank_match(p_txn uuid, p_household uuid, p_pledge_ids uuid[] DEFAULT NULL::uuid[], p_learn_payer boolean DEFAULT true,
                                       p_payer_person uuid DEFAULT NULL::uuid, p_report uuid DEFAULT NULL::uuid,
                                       p_separate_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare t app.bank_transactions; v_payment uuid; v_method app.payment_method; r app.payment_reports; v_ref text; v_n int;
        v_dup record; v_dup_ids text; v_pledges uuid[];
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  perform app.assert_module_enabled(t.center_id, 'giving');
  perform app.assert_module_enabled(t.center_id, 'giving_bank');
  if t.id is null then raise exception 'bank line not found'; end if;
  if not (app.has_permission(t.center_id, 'giving.record_offline') or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'not allowed to reconcile bank lines';
  end if;
  if t.status = 'matched' then raise exception 'bank line already matched'; end if;
  if t.is_batch_deposit then raise exception 'this is a deposit of several checks — match it to the recorded payments instead'; end if;
  if t.status = 'payout' then raise exception 'this is a card-processor payout, not a gift'; end if;
  if t.amount_cents <= 0 then raise exception 'only incoming money can be matched to a household'; end if;
  if not exists (select 1 from app.households where id = p_household and center_id = t.center_id) then
    raise exception 'household not in this center';
  end if;
  v_method := case
    when t.originator_kind = 'daf' then 'daf'
    when t.originator_kind in ('matching_gift','payroll_giving') then 'matching_gift'
    when t.channel = 'zelle' then 'zelle' when t.channel = 'check' then 'check' when t.channel = 'ach' then 'ach'
    else 'other' end;
  v_ref := nullif(upper(regexp_replace(coalesce(t.reference, ''), '[^A-Za-z0-9]', '', 'g')), '');

  -- The member's report this line is: the one the treasurer chose, else the family's one open
  -- report with this confirmation number and amount (bookkeeping only; the money still needs this click).
  -- A Zelle report goes only with a Zelle line or one the bank did not label, never a check, a wire or a fund.
  if p_report is not null then
    select * into r from app.payment_reports where id = p_report for update;
    if r.id is null or r.center_id <> t.center_id then raise exception 'That Zelle report was not found.' using errcode = '22023'; end if;
    if t.originator_kind is not null or coalesce(t.channel, 'other') not in ('zelle','other') then
      raise exception 'A Zelle report can only be matched to a Zelle line, or to one the bank did not label. Confirm this line without the report.'
        using errcode = '22023';
    end if;
    if r.household_id <> p_household then
      raise exception 'That Zelle report is from another family. Confirm this line for the family that reported it, or without the report.'
        using errcode = '22023';
    end if;
    if r.status not in ('reported','unmatched') then
      raise exception 'That Zelle report is already %; confirm the line without it.', r.status using errcode = '22023';
    end if;
    if r.amount_cents <> t.amount_cents then
      raise exception 'The report says % but the bank line is %; confirm without the report, then reject or withdraw it.',
        to_char(r.amount_cents / 100.0, 'FM$999,999,990.00'), to_char(t.amount_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
    end if;
  elsif v_ref is not null and t.originator_kind is null and coalesce(t.channel, 'other') in ('zelle','other') then
    select count(*) into v_n from app.payment_reports x
     where x.center_id = t.center_id and x.household_id = p_household and x.status in ('reported','unmatched')
       and x.confirmation_normalized = v_ref and x.amount_cents = t.amount_cents;
    if v_n = 1 then
      select * into r from app.payment_reports x
       where x.center_id = t.center_id and x.household_id = p_household and x.status in ('reported','unmatched')
         and x.confirmation_normalized = v_ref and x.amount_cents = t.amount_cents
       for update;
    end if;
  end if;

  -- A line the member's report names is a Zelle even when the bank did not label it one: recorded as
  -- a Zelle, and held to the double-count guard below.
  if r.id is not null and v_method = 'other' then v_method := 'zelle'; end if;

  -- G6: a Zelle of this family and amount already recorded by hand a few days around the line.
  if (t.channel = 'zelle' and t.originator_kind is null) or r.id is not null then
    select z.id, z.receipt_number, z.received_on into v_dup
      from app.zelle_recorded_payments(p_household, t.amount_cents, t.posted_on) z where z.kind = 'hand_recorded' limit 1;
    if found then
      if app.audit_clean_reason(p_separate_reason) is null then
        select string_agg(z.id::text, ',') into v_dup_ids
          from app.zelle_recorded_payments(p_household, t.amount_cents, t.posted_on) z where z.kind = 'hand_recorded';
        raise exception using errcode = 'CCDUP',
          message = format('This family already has a Zelle of %s recorded by hand on %s (receipt %s). Attach this bank line to that payment so the gift is not counted twice, or say why this is a separate gift.',
                           to_char(t.amount_cents / 100.0, 'FM$999,999,990.00'), to_char(v_dup.received_on, 'FMMonth FMDD, YYYY'),
                           coalesce(v_dup.receipt_number, 'not numbered yet')),
          detail = v_dup_ids;
      end if;
      perform app.set_audit_context(p_separate_reason);
    end if;
  end if;

  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref,
                            check_number, received_on, recorded_by, memo, deposit_bank_transaction_id)
    values (t.center_id, p_household, coalesce(p_payer_person, r.reported_by_person), t.amount_cents, v_method, 'settled', 'bank',
            coalesce(t.reference, t.fingerprint), case when t.channel = 'check' then t.reference end, t.posted_on, auth.uid(),
            'Bank: ' || t.description, t.id)
    returning id into v_payment;
  -- The pledges the member chose on the report (still open), chosen by the donor; else earliest open first.
  v_pledges := p_pledge_ids;
  if v_pledges is null and r.id is not null and cardinality(r.pledge_ids) > 0 then
    select array_agg(u.x order by u.o) into v_pledges
      from unnest(r.pledge_ids) with ordinality as u(x, o)
     where exists (select 1 from app.pledges pl where pl.id = u.x and pl.household_id = p_household and pl.status in ('open','partially_paid'));
  end if;
  perform app.allocate_payment(v_payment, v_pledges, true);
  perform app.enqueue_payment_posting(v_payment);
  update app.bank_transactions set status = 'matched', matched_household_id = p_household, payment_id = v_payment,
         matched_by = auth.uid(), matched_at = now() where id = p_txn;
  -- Learn the payer name — but never a DAF / platform name (it is not the donor).
  if p_learn_payer and t.payer_name is not null and t.originator_kind is null then
    insert into app.external_ids (center_id, household_id, person_id, kind, system, value, label, source, confidence, created_by,
                                  times_matched, last_matched_at)
      values (t.center_id, p_household, p_payer_person, 'bank_payer',
              coalesce((select lower(institution) from app.bank_accounts where id = t.bank_account_id), 'bank'),
              t.payer_name, initcap(coalesce(t.channel, 'bank')) || ' payer name', 'learned', 0.9, auth.uid(), 1, now())
    on conflict (center_id, household_id, system, normalized) where kind = 'bank_payer'
      do update set times_matched = app.external_ids.times_matched + 1, last_matched_at = now(),
                    confidence = least(1, coalesce(app.external_ids.confidence, 0.9) + 0.02);
  end if;
  if r.id is not null then
    update app.payment_reports set status = 'matched', bank_transaction_id = t.id, payment_id = v_payment,
           matched_by = auth.uid(), matched_at = now()
     where id = r.id;
  end if;
  return v_payment;
end $function$;

-- ── app.match_deposit (latest body: 0104) ───────────────────────────────────────────────────
create or replace function app.match_deposit(p_txn uuid, p_payment_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare t app.bank_transactions; v_sum bigint; v_n int;
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  perform app.assert_module_enabled(t.center_id, 'giving');
  perform app.assert_module_enabled(t.center_id, 'giving_bank');
  if t.id is null then raise exception 'bank line not found'; end if;
  if not (app.has_permission(t.center_id, 'giving.record_offline') or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'not allowed to reconcile bank lines';
  end if;
  if t.status = 'matched' then raise exception 'bank line already matched'; end if;
  if coalesce(array_length(p_payment_ids, 1), 0) = 0 then raise exception 'choose the payments in this deposit'; end if;
  select coalesce(sum(amount_cents), 0), count(*) into v_sum, v_n from app.payments
   where id = any(p_payment_ids) and center_id = t.center_id and provider = 'offline' and deposit_bank_transaction_id is null;
  if v_n <> array_length(p_payment_ids, 1) then raise exception 'some payments are already deposited or not offline payments'; end if;
  if v_sum <> t.amount_cents then
    raise exception 'the chosen payments total % but the deposit is %', v_sum, t.amount_cents;
  end if;
  update app.payments set deposit_bank_transaction_id = t.id, status = 'settled' where id = any(p_payment_ids);
  update app.bank_transactions set status = 'matched', is_batch_deposit = true, matched_by = auth.uid(), matched_at = now()
   where id = p_txn;
  -- One QuickBooks Deposit groups the receipts (undeposited funds -> bank).
  insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month, triggered_by)
  values (t.center_id, 'deposit:' || t.id, 'bank_transactions', t.id, 'payout_deposit', t.amount_cents,
          date_trunc('month', t.posted_on)::date, auth.uid())
  on conflict (center_id, idempotency_key) do nothing;
  return v_n;
end $function$;

-- ── app.suggest_bank_matches (latest body: 0583) ────────────────────────────────────────────
create or replace function app.suggest_bank_matches(p_txn uuid)
 RETURNS TABLE(household_id uuid, household_name text, household_number text, org_household_id text, members text, primary_member text,
               primary_org_member_id text, zone text, city text, last_gift_on date, score numeric, reason text, ambiguous boolean,
               open_pledge_cents bigint, report_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  with t as (select * from app.bank_transactions where id = p_txn
             and app.assert_module_enabled(center_id, 'giving')
             and app.assert_module_enabled(center_id, 'giving_bank')
             and not is_batch_deposit and status <> 'payout'
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view'))),
  payer as (
    select e.household_id, e.value, count(*) over () as n
      from app.external_ids e, t
     where e.center_id = t.center_id and e.kind = 'bank_payer' and e.normalized = t.payer_normalized
  ),
  byname as (
    select distinct hm.household_id, p.first_name || ' ' || p.last_name as who
      from app.people p join app.household_members hm on hm.person_id = p.id and hm.left_at is null, t
     where p.center_id = t.center_id and t.payer_normalized is not null and p.merged_into_id is null
       and (app.normalize_identifier(p.first_name || ' ' || p.last_name) = t.payer_normalized
         or app.normalize_identifier(p.last_name || ' ' || p.first_name) = t.payer_normalized
         or regexp_replace(t.payer_normalized, ' [A-Z] ', ' ') = app.normalize_identifier(p.first_name || ' ' || p.last_name))
  ),
  byname_n as (select count(distinct household_id) as n from byname),
  -- Member reports of this organization for the same amount (a Zelle line, or a line the bank did not label).
  rep as (
    select r.id, r.household_id, r.confirmation, r.sender_name, r.amount_cents, r.sent_on, r.created_at,
           (case
              when r.confirmation_normalized is not null and t.reference is not null
                   and upper(regexp_replace(t.reference, '[^A-Za-z0-9]', '', 'g')) = r.confirmation_normalized then 0.99
              when t.posted_on between r.sent_on - 1 and r.due_on + 5 and r.sender_normalized is not null
                   and r.sender_normalized = t.payer_normalized then 0.93
              when t.posted_on between r.sent_on - 1 and r.due_on + 5 then 0.80
            end)::numeric as score
      from app.payment_reports r, t
     where r.center_id = t.center_id and r.status in ('reported','unmatched') and r.amount_cents = t.amount_cents
       and t.amount_cents > 0 and t.originator_kind is null and coalesce(t.channel, 'other') in ('zelle','other')
       and (app.zelle_bank_account_id(t.center_id) is null or t.bank_account_id = app.zelle_bank_account_id(t.center_id))
  ),
  rep_fit as (select * from rep where score is not null),
  rep_n as (select count(*) filter (where score = 0.80) as n80, count(*) filter (where score = 0.93) as n93 from rep_fit),
  cands as (
    select household_id, case when n = 1 then 0.95 else 0.60 end::numeric as score,
           'Known bank payer name "' || value || '"' || case when n > 1 then ' — also used by ' || (n - 1) || ' other household(s)' else '' end as reason,
           n > 1 as ambiguous
      from payer
    union all
    select b.household_id, case when (select n from byname_n) = 1 then 0.70 else 0.45 end,
           'Payer name matches member ' || b.who ||
             case when (select n from byname_n) > 1 then ' — ' || (select n from byname_n) || ' households have a member with this name' else '' end,
           (select n from byname_n) > 1
      from byname b
    union all
    select r.household_id, 0.90, 'Statement mentions ' || r.value, false
      from t, lateral regexp_matches(t.description, '([A-Z]{2,6}-(?:H-)?\d{4,6})', 'g') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind in ('connect_member', 'connect_household')
    union all
    select r.household_id, 0.90, 'Statement mentions member ID ' || r.value, false
      from t, lateral regexp_matches(t.description, '(?:member|mem|mbr)\s*(?:id|no|#)?\s*[:#]?\s*(\d{2,6})\y', 'gi') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind = 'org_member'
    union all
    select r.household_id, 0.90, 'Statement mentions household ID ' || r.value, false
      from t, lateral regexp_matches(t.description, '(?:household|hh|family|fam)\s*(?:id|no|#)?\s*[:#]?\s*(\d{2,6})\y', 'gi') as x(m),
           lateral app.resolve_identifier(t.center_id, x.m[1]) r
     where r.kind = 'org_household'
    union all
    select f.household_id, f.score,
           case when f.score = 0.99
                  then 'Member reported this Zelle (confirmation ' || f.confirmation || ', '
                       || to_char(f.amount_cents / 100.0, 'FM$999,999,990.00') || ' on ' || to_char(f.sent_on, 'FMMonth FMDD, YYYY') || ')'
                when f.score = 0.93
                  then 'Member reported a Zelle of ' || to_char(f.amount_cents / 100.0, 'FM$999,999,990.00') || ' sent on '
                       || to_char(f.sent_on, 'FMMonth FMDD, YYYY') || ' from "' || coalesce(f.sender_name, '') || '"'
                       || case when (select n93 from rep_n) > 1 then ' — ' || (select n93 from rep_n) || ' reports fit this line' else '' end
                else 'Member reported a Zelle of ' || to_char(f.amount_cents / 100.0, 'FM$999,999,990.00') || ' sent on '
                       || to_char(f.sent_on, 'FMMonth FMDD, YYYY')
                       || case when (select n80 from rep_n) > 1 then ' — ' || (select n80 from rep_n) || ' reports fit this line' else '' end
           end,
           (f.score = 0.80 and (select n80 from rep_n) > 1) or (f.score = 0.93 and (select n93 from rep_n) > 1)
      from rep_fit f
  ),
  ranked as (
    select c.household_id, max(c.score) as score, string_agg(distinct c.reason, '; ') as reason, bool_and(c.ambiguous) as ambiguous
      from cands c where c.household_id is not null group by c.household_id
  )
  select r.household_id, c.household_name, c.household_number, c.org_household_id, c.members, c.primary_member,
         c.primary_org_member_id, c.zone, c.city, c.last_gift_on,
         least(1, r.score + case when exists (select 1 from app.pledges pl, t where pl.household_id = r.household_id
                                  and pl.status in ('open','partially_paid') and pl.amount_cents - pl.paid_cents = t.amount_cents)
                            then 0.04 else 0 end),
         r.reason || coalesce((select case t.originator_kind when 'daf' then ' · via donor-advised fund'
                                                             when 'matching_gift' then ' · via matching-gift platform' end from t), ''),
         r.ambiguous, c.open_pledge_cents,
         (select f.id from rep_fit f where f.household_id = r.household_id order by f.score desc, f.created_at, f.id limit 1)
    from ranked r cross join lateral app.household_card(r.household_id) c
   order by 11 desc, c.household_name
$function$;

-- ── app.suggest_deposit_payments (latest body: 0104) ────────────────────────────────────────
create or replace function app.suggest_deposit_payments(p_txn uuid)
 RETURNS TABLE(payment_id uuid, household_name text, receipt_number text, method app.payment_method, amount_cents bigint, received_on date, check_number text, envelope_number text, exact_total boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  with t as (select * from app.bank_transactions where id = p_txn and is_batch_deposit
             and app.assert_module_enabled(center_id, 'giving')
             and app.assert_module_enabled(center_id, 'giving_bank')
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view'))),
  c as (
    select p.* from app.payments p, t
     where p.center_id = t.center_id and p.provider = 'offline' and p.deposit_bank_transaction_id is null
       and p.method in ('check','cash','stock','other') and p.status in ('captured','pending_clearing')
       and p.received_on between t.posted_on - 21 and t.posted_on
       and (t.channel <> 'cash_deposit' or p.method = 'cash')
  )
  select c.id, h.display_name, c.receipt_number, c.method, c.amount_cents, c.received_on, c.check_number, c.envelope_number,
         (select sum(amount_cents) from c) = (select amount_cents from t)
    from c join app.households h on h.id = c.household_id
   order by c.received_on, c.envelope_number nulls last, c.created_at
$function$;

-- ── app.attach_bank_line_to_payment (latest body: 0583) ─────────────────────────────────────
create or replace function app.attach_bank_line_to_payment(p_txn uuid, p_payment uuid, p_report uuid default null, p_learn_payer boolean default true)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.bank_transactions; p app.payments; r app.payment_reports;
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  if t.id is null then raise exception 'That bank line was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(t.center_id, 'giving');
  perform app.assert_module_enabled(t.center_id, 'giving_bank');
  if not (app.has_permission(t.center_id, 'giving.record_offline') or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'Attaching a bank line to a payment needs giving.record_offline or giving.manage.' using errcode = '42501';
  end if;
  if t.status = 'matched' then raise exception 'That bank line is already matched.' using errcode = '22023'; end if;
  if t.status not in ('unmatched','suggested') then
    raise exception 'Only an unmatched bank line can be attached to a payment.' using errcode = '22023';
  end if;
  if t.is_batch_deposit then
    raise exception 'This is a deposit of several checks — match it to the recorded payments instead.' using errcode = '22023';
  end if;
  if t.amount_cents <= 0 then raise exception 'Only incoming money can be attached to a payment.' using errcode = '22023'; end if;
  select * into p from app.payments where id = p_payment for update;
  if p.id is null or p.center_id <> t.center_id then raise exception 'That payment was not found.' using errcode = '22023'; end if;
  if coalesce(p.provider, '') <> 'offline' then
    raise exception 'Only a payment recorded by hand can be attached to a bank line.' using errcode = '22023';
  end if;
  if p.method not in ('zelle','ach') then
    raise exception 'Only a Zelle or ACH payment recorded by hand can be attached to a bank line; checks and cash are matched as deposits.'
      using errcode = '22023';
  end if;
  if p.status not in ('captured','pending_clearing','settled') then
    raise exception 'That payment is % and cannot be attached to a bank line.', replace(p.status::text, '_', ' ') using errcode = '22023';
  end if;
  if p.amount_cents <> t.amount_cents then
    raise exception 'The payment is % but the bank line is %; they must be the same.',
      to_char(p.amount_cents / 100.0, 'FM$999,999,990.00'), to_char(t.amount_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  if p.deposit_bank_transaction_id is not null then
    raise exception 'That payment is already attached to a bank line.' using errcode = '22023';
  end if;
  if p_report is not null then
    select * into r from app.payment_reports where id = p_report for update;
    if r.id is null or r.center_id <> t.center_id then raise exception 'That Zelle report was not found.' using errcode = '22023'; end if;
    if r.household_id <> p.household_id then raise exception 'That Zelle report is from another family.' using errcode = '22023'; end if;
    if r.status not in ('reported','unmatched') then
      raise exception 'That Zelle report is already %; attach the line without it.', r.status using errcode = '22023';
    end if;
    if r.amount_cents <> t.amount_cents then
      raise exception 'The report says % but the bank line is %; attach without the report, then reject or withdraw it.',
        to_char(r.amount_cents / 100.0, 'FM$999,999,990.00'), to_char(t.amount_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
    end if;
    if exists (select 1 from app.payment_reports o where o.payment_id = p.id and o.id <> r.id) then
      raise exception 'That payment is already linked to another report; attach the line without this one.' using errcode = '22023';
    end if;
  end if;

  perform app.set_audit_default_reason('Bank line attached to the Zelle or ACH payment already recorded by hand (G6)');
  update app.payments set deposit_bank_transaction_id = t.id, status = 'settled' where id = p.id;
  update app.bank_transactions set status = 'matched', matched_household_id = p.household_id, payment_id = p.id,
         matched_by = auth.uid(), matched_at = now()
   where id = t.id;
  if p_learn_payer and t.payer_name is not null and t.originator_kind is null then
    insert into app.external_ids (center_id, household_id, person_id, kind, system, value, label, source, confidence, created_by,
                                  times_matched, last_matched_at)
      values (t.center_id, p.household_id, null, 'bank_payer',
              coalesce((select lower(institution) from app.bank_accounts where id = t.bank_account_id), 'bank'),
              t.payer_name, initcap(coalesce(t.channel, 'bank')) || ' payer name', 'learned', 0.9, auth.uid(), 1, now())
    on conflict (center_id, household_id, system, normalized) where kind = 'bank_payer'
      do update set times_matched = app.external_ids.times_matched + 1, last_matched_at = now(),
                    confidence = least(1, coalesce(app.external_ids.confidence, 0.9) + 0.02);
  end if;
  -- One QuickBooks Deposit (undeposited funds -> bank), as match_deposit does for a check batch. A
  -- payment that never posted (history, or before the QuickBooks go-live date) has nothing to deposit.
  if app.payment_posts_to_qbo(p.id) then
    insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month, triggered_by)
    values (t.center_id, 'deposit:' || t.id, 'bank_transactions', t.id, 'payout_deposit', t.amount_cents,
            date_trunc('month', t.posted_on)::date, auth.uid())
    on conflict (center_id, idempotency_key) do nothing;
  end if;
  if r.id is not null then
    update app.payment_reports set status = 'matched', bank_transaction_id = t.id, payment_id = p.id,
           matched_by = auth.uid(), matched_at = now()
     where id = r.id;
  end if;
  -- A report linked to this payment earlier (link_payment_report) now learns its bank line.
  update app.payment_reports set bank_transaction_id = t.id
   where payment_id = p.id and status = 'matched' and bank_transaction_id is null
     and not exists (select 1 from app.payment_reports o where o.bank_transaction_id = t.id);
  return p.id;
end $$;

-- ── app.zelle_exact_matches (latest body: 0583) ─────────────────────────────────────────────
create or replace function app.zelle_exact_matches(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_bank');
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.record_offline')
          or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'Seeing Zelle reports needs giving.view or giving.record_offline.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.posted_on, x.created_at)
      from (
        select jsonb_build_object('report_id', r.id, 'bank_transaction_id', t.id, 'amount_cents', r.amount_cents,
                                  'sent_on', r.sent_on::text, 'posted_on', t.posted_on::text, 'confirmation', r.confirmation,
                                  'payer_name', t.payer_name,
                                  'household', (select to_jsonb(hc) from app.household_card(r.household_id) hc)) as j,
               t.posted_on, r.created_at
          from app.payment_reports r
          join app.bank_transactions t on t.center_id = r.center_id and t.status in ('unmatched','suggested') and t.channel = 'zelle'
               and t.reference is not null and upper(regexp_replace(t.reference, '[^A-Za-z0-9]', '', 'g')) = r.confirmation_normalized
         where r.center_id = p_center and r.status in ('reported','unmatched') and r.confirmation_normalized is not null
           and app.zelle_pair_is_exact(r.id, t.id)
         order by t.posted_on, r.created_at
         limit 200
      ) x), '[]'::jsonb);
end $$;

-- ── app.confirm_exact_zelle_matches (latest body: 0583) ─────────────────────────────────────
create or replace function app.confirm_exact_zelle_matches(p_center uuid, p_pairs jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare x jsonb; v_report uuid; v_txn uuid; r app.payment_reports; v_payment uuid; v_receipt text; v_state text; v_why text;
        v_confirmed jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb;
        v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_bank');
  if not (app.has_permission(p_center, 'giving.record_offline') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'Confirming Zelle matches needs giving.record_offline or giving.manage.' using errcode = '42501';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'Send the matches to confirm as a list.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_pairs) > 200 then raise exception 'Confirm at most 200 matches at a time.' using errcode = '22023'; end if;
  perform app.set_audit_default_reason('Confirmed exact Zelle matches (confirmation number, amount and date)');
  for x in select * from jsonb_array_elements(p_pairs) loop
    if jsonb_typeof(x) <> 'object' or coalesce(x->>'report_id', '') !~ v_uuid or coalesce(x->>'bank_transaction_id', '') !~ v_uuid then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('report_id', x->>'report_id', 'reason', 'Not a match from the list.'));
      continue;
    end if;
    v_report := (x->>'report_id')::uuid;
    v_txn := (x->>'bank_transaction_id')::uuid;
    select * into r from app.payment_reports where id = v_report;
    if r.id is null or r.center_id <> p_center or not app.zelle_pair_is_exact(v_report, v_txn) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('report_id', v_report,
        'reason', 'It is no longer an exact match (matched, changed or now ambiguous); match it by hand.'));
      continue;
    end if;
    begin
      v_payment := app.confirm_bank_match(v_txn, r.household_id, null, true, r.reported_by_person, r.id, null);
      select receipt_number into v_receipt from app.payments where id = v_payment;
      v_confirmed := v_confirmed || jsonb_build_array(jsonb_build_object('report_id', v_report, 'payment_id', v_payment, 'receipt_number', v_receipt));
    exception when others then
      -- Our own refusals are plain sentences (P0001, 22023, 42501, CCDUP). Anything else is logged on
      -- the server and shown as a plain sentence, never as raw database text.
      v_state := sqlstate;
      v_why := sqlerrm;
      if v_state not in ('P0001','22023','42501','CCDUP') then
        raise warning 'confirm_exact_zelle_matches: report % was not confirmed (%): %', v_report, v_state, v_why;
        v_why := 'It could not be recorded just now; match it by hand.';
      end if;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('report_id', v_report, 'reason', v_why));
    end;
  end loop;
  return jsonb_build_object('confirmed', v_confirmed, 'skipped', v_skipped);
end $$;

-- ── app.payment_report_queue (latest body: 0583) ────────────────────────────────────────────
create or replace function app.payment_report_queue(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_exact jsonb; v_reports jsonb; v_bank uuid; v_counts jsonb;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_bank');
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.record_offline')
          or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'Seeing Zelle reports needs giving.view or giving.record_offline.' using errcode = '42501';
  end if;
  v_exact := app.zelle_exact_matches(p_center);
  v_bank := app.zelle_bank_account_id(p_center);
  select jsonb_build_object('reported', count(*) filter (where status = 'reported'), 'unmatched', count(*) filter (where status = 'unmatched'),
                            'exact', jsonb_array_length(v_exact))
    into v_counts from app.payment_reports where center_id = p_center and status in ('reported','unmatched');
  select coalesce(jsonb_agg(q.j order by q.ord, q.due_on, q.created_at), '[]'::jsonb) into v_reports
    from (
      select case r.status when 'unmatched' then 0 else 1 end as ord, r.due_on, r.created_at,
        jsonb_build_object(
          'id', r.id, 'status', r.status, 'is_test', r.is_test, 'amount_cents', r.amount_cents,
          'sent_on', r.sent_on::text, 'due_on', r.due_on::text, 'confirmation', r.confirmation, 'sender_name', r.sender_name,
          'note', r.note, 'created_at', r.created_at,
          'reported_by_name', coalesce((select coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name
                                          from app.people pe where pe.id = r.reported_by_person), 'a member'),
          'household', (select to_jsonb(hc) from app.household_card(r.household_id) hc),
          'pledges', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'pledge_number', pl.pledge_number,
                                                                   'open_cents', greatest(0, pl.amount_cents - pl.paid_cents)) order by u.o)
                                 from unnest(r.pledge_ids) with ordinality as u(x, o) join app.pledges pl on pl.id = u.x), '[]'::jsonb),
          'candidates', coalesce((
             select jsonb_agg(jsonb_build_object('bank_transaction_id', c.id, 'posted_on', c.posted_on::text, 'amount_cents', c.amount_cents,
                                                 'description', c.description, 'payer_name', c.payer_name, 'reference', c.reference,
                                                 'exact', app.zelle_pair_is_exact(r.id, c.id), 'score', c.score)
                              order by c.score desc, c.posted_on)
               from (select t.id, t.posted_on, t.amount_cents, t.description, t.payer_name, t.reference,
                            (case
                               when r.confirmation_normalized is not null and t.reference is not null
                                    and upper(regexp_replace(t.reference, '[^A-Za-z0-9]', '', 'g')) = r.confirmation_normalized then 0.99
                               when r.sender_normalized is not null and r.sender_normalized = t.payer_normalized then 0.93
                               else 0.80 end)::numeric as score
                       from app.bank_transactions t
                      where t.center_id = r.center_id and t.status in ('unmatched','suggested') and t.amount_cents = r.amount_cents
                        and not t.is_batch_deposit and t.originator_kind is null and coalesce(t.channel, 'other') in ('zelle','other')
                        and (v_bank is null or t.bank_account_id = v_bank)
                        and (t.posted_on between r.sent_on - 1 and r.due_on + 5
                             or (r.confirmation_normalized is not null and t.reference is not null
                                 and upper(regexp_replace(t.reference, '[^A-Za-z0-9]', '', 'g')) = r.confirmation_normalized))
                      order by 7 desc, t.posted_on
                      limit 5) c), '[]'::jsonb),
          'hand_recorded', coalesce((select jsonb_agg(jsonb_build_object('kind', z.kind, 'id', z.id, 'receipt_number', z.receipt_number,
                                                                         'date', z.received_on::text, 'amount_cents', z.amount_cents))
                                       from app.zelle_recorded_payments(r.household_id, r.amount_cents, r.sent_on) z
                                      where z.kind = 'hand_recorded' and not z.linked), '[]'::jsonb),
          -- Already recorded from a bank line matched without the report: link the report to it.
          'bank_recorded', coalesce((select jsonb_agg(jsonb_build_object('kind', z.kind, 'id', z.id, 'receipt_number', z.receipt_number,
                                                                         'date', z.received_on::text, 'amount_cents', z.amount_cents))
                                       from app.zelle_recorded_payments(r.household_id, r.amount_cents, r.sent_on) z
                                      where z.kind = 'bank' and not z.linked), '[]'::jsonb)
        ) as j
        from app.payment_reports r
       where r.center_id = p_center and r.status in ('reported','unmatched')
       order by case r.status when 'unmatched' then 0 else 1 end, r.due_on, r.created_at
       limit 300
    ) q;
  return jsonb_build_object('window_days', app.zelle_report_window_days(p_center), 'bank_account_id', v_bank,
                            'counts', v_counts, 'exact', v_exact, 'reports', v_reports);
end $$;

-- ── app.payment_report_counts (latest body: 0582) ───────────────────────────────────────────
create or replace function app.payment_report_counts(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_bank');
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.record_offline')
          or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'Seeing Zelle reports needs giving.view or giving.record_offline.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('reported', count(*) filter (where status = 'reported'),
                                    'unmatched', count(*) filter (where status = 'unmatched'))
            from app.payment_reports where center_id = p_center and status in ('reported','unmatched'));
end $$;

-- ── app.link_payment_report (latest body: 0582) ─────────────────────────────────────────────
create or replace function app.link_payment_report(p_report uuid, p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payment_reports; p app.payments;
begin
  select * into r from app.payment_reports where id = p_report for update;
  if r.id is null then raise exception 'That report was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  perform app.assert_module_enabled(r.center_id, 'giving_bank');
  if not (app.has_permission(r.center_id, 'giving.record_offline') or app.has_permission(r.center_id, 'giving.manage')) then
    raise exception 'Linking a member''s Zelle report needs giving.record_offline or giving.manage.' using errcode = '42501';
  end if;
  perform app.payments_require_reason(p_reason, 'link this Zelle report to a recorded payment');
  if r.status not in ('reported','unmatched') then
    raise exception 'This report is already %, so it cannot be linked.', r.status using errcode = '22023';
  end if;
  select * into p from app.payments where id = p_payment for update;
  if p.id is null or p.center_id <> r.center_id or p.household_id <> r.household_id then
    raise exception 'That payment is not one of this family''s payments.' using errcode = '22023';
  end if;
  if p.method <> 'zelle' then raise exception 'That payment is not a Zelle payment.' using errcode = '22023'; end if;
  if coalesce(p.provider, '') not in ('offline','bank') then
    raise exception 'Only a Zelle recorded by hand or from the bank statement can be linked to a report.' using errcode = '22023';
  end if;
  if p.status in ('failed','voided') then raise exception 'That payment was voided or failed.' using errcode = '22023'; end if;
  if p.amount_cents <> r.amount_cents then
    raise exception 'The report says % but the payment is %.', to_char(r.amount_cents / 100.0, 'FM$999,999,990.00'),
      to_char(p.amount_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  if exists (select 1 from app.payment_reports o where o.payment_id = p.id and o.id <> r.id) then
    raise exception 'That payment is already linked to another report.' using errcode = '22023';
  end if;
  update app.payment_reports
     set status = 'matched', payment_id = p.id,
         bank_transaction_id = coalesce(r.bank_transaction_id,
           case when p.deposit_bank_transaction_id is not null
                 and not exists (select 1 from app.payment_reports o where o.bank_transaction_id = p.deposit_bank_transaction_id)
                then p.deposit_bank_transaction_id end),
         matched_by = auth.uid(), matched_at = now()
   where id = r.id;
end $$;

-- ── app.reject_payment_report (latest body: 0582) ───────────────────────────────────────────
create or replace function app.reject_payment_report(p_report uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payment_reports;
begin
  select * into r from app.payment_reports where id = p_report for update;
  if r.id is null then raise exception 'That report was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  perform app.assert_module_enabled(r.center_id, 'giving_bank');
  if not (app.has_permission(r.center_id, 'giving.record_offline') or app.has_permission(r.center_id, 'giving.manage')) then
    raise exception 'Closing a member''s Zelle report needs giving.record_offline or giving.manage.' using errcode = '42501';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why the report is not accepted; the member is told and the reason is kept in the audit log.' using errcode = '22023';
  end if;
  if r.status not in ('reported','unmatched') then
    raise exception 'This report is already %, so it cannot be rejected.',
      case r.status when 'matched' then 'matched' when 'rejected' then 'rejected' else 'withdrawn by the member' end
      using errcode = '22023';
  end if;
  perform app.set_audit_context(p_reason);
  update app.payment_reports set status = 'rejected', rejected_by = auth.uid(), rejected_at = now(),
         reject_reason = left(btrim(p_reason), 500)
   where id = r.id;
  perform app._zelle_report_notice(r.id, 'zelle_report_rejected');
end $$;

-- ── app.report_payment (latest body: 0582) ──────────────────────────────────────────────────
create or replace function app.report_payment(p_center uuid, p_household uuid, p_method text, p_amount_cents bigint, p_sent_on date,
                                              p_confirmation text, p_sender_name text, p_pledge_ids uuid[], p_note text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; v_today date; v_conf text; v_conf_norm text; v_sender text; v_note text; v_pledges uuid[];
        v_bad int; v_open int; v_window int; v_id uuid; v_due date; v_test boolean; v_short text;
begin
  if auth.uid() is null then raise exception 'Sign in to report a payment.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_bank');
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  v_short := coalesce(nullif(btrim(c.short_name), ''), c.name);
  if not exists (select 1 from app.households where id = p_household and center_id = p_center) then
    raise exception 'That family was not found in this community.' using errcode = '22023';
  end if;
  if not app.adult_of_household(p_center, p_household) then
    raise exception 'Only an adult of the family can report a payment.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_method, ''))) <> 'zelle' then
    raise exception 'Only a Zelle can be reported here; other gifts are recorded when they arrive.' using errcode = '22023';
  end if;
  if not exists (select 1 from app.center_payment_methods m where m.center_id = p_center and m.method = 'zelle' and m.accepted) then
    raise exception 'Zelle is not one of the ways % takes gifts.', v_short using errcode = '22023';
  end if;
  -- One report at a time per family (a double tap must not make two).
  perform 1 from app.households where id = p_household for update;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000 then
    raise exception 'Enter the amount you sent, from $0.01 to $1,000,000.' using errcode = '22023';
  end if;
  v_today := (now() at time zone coalesce(nullif(c.time_zone, ''), 'America/Chicago'))::date;
  if p_sent_on is null then raise exception 'Enter the date you sent the Zelle.' using errcode = '22023'; end if;
  if p_sent_on > v_today then raise exception 'The date you sent the Zelle cannot be after today.' using errcode = '22023'; end if;
  if p_sent_on < v_today - 60 then
    raise exception 'Report a Zelle you sent in the last 60 days. For an older one, contact the treasurer.' using errcode = '22023';
  end if;
  v_conf := nullif(btrim(coalesce(p_confirmation, '')), '');
  if v_conf is not null then
    v_conf_norm := upper(regexp_replace(v_conf, '[^A-Za-z0-9]', '', 'g'));
    if char_length(v_conf) > 60 or char_length(v_conf_norm) not between 6 and 40 then
      raise exception 'That does not look like a Zelle confirmation number. Leave it blank if you do not have it.' using errcode = '22023';
    end if;
    if exists (select 1 from app.payment_reports r where r.center_id = p_center and r.confirmation_normalized = v_conf_norm
                 and r.status not in ('withdrawn','rejected')) then
      raise exception 'That confirmation number was already reported.' using errcode = '22023';
    end if;
    if exists (select 1 from app.bank_transactions t where t.center_id = p_center and t.status = 'matched' and t.channel = 'zelle'
                 and t.reference is not null and upper(regexp_replace(t.reference, '[^A-Za-z0-9]', '', 'g')) = v_conf_norm) then
      raise exception 'That Zelle is already on the bank statement and recorded.' using errcode = '22023';
    end if;
  end if;
  v_sender := nullif(btrim(coalesce(p_sender_name, '')), '');
  if char_length(v_sender) > 120 then
    raise exception 'The name your bank shows can be at most 120 characters.' using errcode = '22023';
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if char_length(v_note) > 500 then raise exception 'The note can be at most 500 characters.' using errcode = '22023'; end if;
  -- The chosen pledges, in the order given, once each.
  select coalesce(array_agg(x order by o), '{}') into v_pledges
    from (select u.x, min(u.o) as o from unnest(coalesce(p_pledge_ids, '{}'::uuid[])) with ordinality as u(x, o)
           where u.x is not null group by u.x) s;
  if cardinality(v_pledges) > 20 then raise exception 'Choose at most 20 pledges.' using errcode = '22023'; end if;
  select count(*) into v_bad from unnest(v_pledges) x
   where not exists (select 1 from app.pledges pl where pl.id = x and pl.center_id = p_center and pl.household_id = p_household
                        and pl.status in ('open','partially_paid'));
  if v_bad > 0 then raise exception 'One of the pledges is not an open pledge of this family.' using errcode = '22023'; end if;
  if exists (select 1 from app.payment_reports r where r.household_id = p_household and r.amount_cents = p_amount_cents
               and r.sent_on = p_sent_on and r.status in ('reported','unmatched')) then
    raise exception 'You already reported this Zelle; it is waiting for the bank.' using errcode = '22023';
  end if;
  select count(*) into v_open from app.payment_reports r where r.household_id = p_household and r.status in ('reported','unmatched');
  if v_open >= 10 then
    raise exception 'Your family already has 10 Zelle reports waiting for the bank. Wait until they are matched, or contact the treasurer.'
      using errcode = '22023';
  end if;

  v_window := app.zelle_report_window_days(p_center);
  v_test := c.environment = 'sandbox';
  begin
    insert into app.payment_reports (center_id, household_id, reported_by, reported_by_person, method, amount_cents, sent_on,
                                     confirmation, sender_name, pledge_ids, note, is_test, window_days, due_on)
    values (p_center, p_household, auth.uid(), app.my_person_id(p_center), 'zelle', p_amount_cents, p_sent_on,
            v_conf, v_sender, v_pledges, v_note, v_test, v_window, p_sent_on + v_window)
    returning id, due_on into v_id, v_due;
  exception when unique_violation then
    raise exception 'That confirmation number was already reported.' using errcode = '22023';
  end;
  return jsonb_build_object('report_id', v_id, 'status', 'reported', 'due_on', v_due::text, 'is_test', v_test,
    'message', case when v_test then 'Test report saved. In a sandbox no real money moves.'
                    else 'Thank you. The treasurer matches it when it reaches the bank, usually within a few days. Until then it shows as Reported and is not counted as given.' end);
end $$;

-- ── app.withdraw_payment_report (latest body: 0582) ─────────────────────────────────────────
create or replace function app.withdraw_payment_report(p_report uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.payment_reports;
begin
  if auth.uid() is null then raise exception 'Sign in to withdraw a report.' using errcode = '42501'; end if;
  select * into r from app.payment_reports where id = p_report for update;
  if r.id is null then raise exception 'That report was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'giving');
  perform app.assert_module_enabled(r.center_id, 'giving_bank');
  if not (r.reported_by = auth.uid() or app.adult_of_household(r.center_id, r.household_id)) then
    raise exception 'Only the person who reported it, or another adult of the family, can withdraw this report.' using errcode = '42501';
  end if;
  if r.status not in ('reported','unmatched') then
    raise exception 'This report is already %, so it cannot be withdrawn.',
      case r.status when 'matched' then 'matched to the bank' when 'rejected' then 'closed by the treasurer' else r.status end
      using errcode = '22023';
  end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'The member withdrew the Zelle report'));
  update app.payment_reports set status = 'withdrawn', withdrawn_at = now() where id = r.id;
end $$;

-- ── app.my_payment_reports (latest body: 0582) ──────────────────────────────────────────────
create or replace function app.my_payment_reports(p_center uuid, p_household uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in to see your Zelle reports.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  -- 0742: with Bank reconciliation off the family's reports are hidden; an app that still asks gets an empty list.
  if not app.module_enabled(p_center, 'giving_bank') then return '[]'::jsonb; end if;
  if p_household is not null and not app.adult_of_household(p_center, p_household) then
    raise exception 'Only an adult of the family can see its Zelle reports.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', r.id, 'household_id', r.household_id, 'method', r.method, 'amount_cents', r.amount_cents,
             'sent_on', r.sent_on::text, 'due_on', r.due_on::text, 'status', r.status, 'confirmation', r.confirmation,
             'sender_name', r.sender_name, 'pledge_ids', to_jsonb(r.pledge_ids), 'is_test', r.is_test,
             'receipt_number', p.receipt_number, 'reject_reason', r.reject_reason, 'created_at', r.created_at)
           order by r.created_at desc, r.id)
      from app.payment_reports r
      left join app.payments p on p.id = r.payment_id
     where r.center_id = p_center
       and r.created_at >= now() - interval '180 days'
       and (case when p_household is null then app.adult_of_household(p_center, r.household_id) else r.household_id = p_household end)
  ), '[]'::jsonb);
end $$;

-- ── app.set_zelle_reporting (latest body: 0597) ─────────────────────────────────────────────
create or replace function app.set_zelle_reporting(p_center uuid, p_window_days int, p_bank_account uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_old text; v_keep uuid; v_pending uuid;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_bank');
  if not app.payments_can_configure(p_center) then
    raise exception 'Changing how Zelle reports are matched needs the owner, integrations.manage or giving.manage.' using errcode = '42501';
  end if;
  if p_window_days is null or p_window_days < 3 or p_window_days > 30 then
    raise exception 'The report window is 3 to 30 days.' using errcode = '22023';
  end if;
  if p_bank_account is not null and not exists (select 1 from app.bank_accounts b where b.id = p_bank_account and b.center_id = p_center and b.active) then
    raise exception 'Choose one of this organization''s active bank accounts, or none.' using errcode = '22023';
  end if;
  perform app.payments_require_reason(p_reason, 'change how Zelle reports are matched');
  select rules #>> '{payments,zelle,bank_account_id}' into v_old from app.centers where id = p_center;
  v_keep := p_bank_account;
  if v_old is not null and p_bank_account::text is distinct from v_old then
    if not app.payee_can_request(p_center) then
      raise exception 'Changing the bank account Zelle payments arrive in needs the organization owner, integrations.manage or giving.manage.' using errcode = '42501';
    end if;
    perform app.assert_step_up('payments.payee');
    v_pending := app._create_payee_change(p_center, 'zelle',
      jsonb_build_object('bank_account_id', jsonb_build_object('from', v_old, 'to', p_bank_account)), '{}'::jsonb, p_reason);
    v_keep := v_old::uuid;
  end if;
  update app.centers
     set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}',
                           case when jsonb_typeof(rules->'payments') = 'object' then rules->'payments' else '{}'::jsonb end
                           || jsonb_build_object('zelle',
                                (case when jsonb_typeof(rules #> '{payments,zelle}') = 'object' then rules #> '{payments,zelle}' else '{}'::jsonb end)
                                || jsonb_build_object('report_window_days', p_window_days, 'bank_account_id', v_keep)))
   where id = p_center;
  return jsonb_build_object('report_window_days', p_window_days, 'bank_account_id', v_keep)
         || case when v_pending is not null then jsonb_build_object('pending_change', v_pending) else '{}'::jsonb end;
end $$;

-- ── app.giving_unmatched_bank_lines (latest body: 0656) ─────────────────────────────────────
create or replace function app.giving_unmatched_bank_lines(p_center uuid, p_limit integer default 10, p_today date default null)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'UTC') as tz
  ),
  t as (
    select coalesce(p_today, (now() at time zone (select tz from z))::date) as today
  ),
  waiting as (
    select b.id, b.bank_account_id, b.posted_on, b.amount_cents, b.description, b.channel, b.payer_name, b.reference,
           b.status, b.is_batch_deposit,
           case when b.amount_cents > 0 and not b.is_batch_deposit then 'gift'
                when b.amount_cents > 0 and b.is_batch_deposit then 'deposit'
                else 'debit' end as kind
      from app.bank_transactions b
     where b.center_id = p_center and b.status in ('unmatched', 'suggested')
  ),
  credits as (
    select w.*, row_number() over (order by w.posted_on, w.id) as rn from waiting w where w.kind in ('gift', 'deposit')
  )
  select jsonb_build_object(
    'as_of', (select today from t),
    'gifts', (select count(*) from waiting where kind = 'gift')::integer,
    'gifts_cents', coalesce((select sum(amount_cents) from waiting where kind = 'gift'), 0)::bigint,
    'deposits', (select count(*) from waiting where kind = 'deposit')::integer,
    'deposits_cents', coalesce((select sum(amount_cents) from waiting where kind = 'deposit'), 0)::bigint,
    'debits', (select count(*) from waiting where kind = 'debit')::integer,
    'payouts', (select count(*) from app.bank_transactions b where b.center_id = p_center and b.status = 'payout')::integer,
    'oldest_posted_on', (select min(posted_on) from waiting where kind in ('gift', 'deposit')),
    'oldest_days', (select (select today from t) - min(posted_on) from waiting where kind in ('gift', 'deposit')),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'posted_on', c.posted_on,
               'days_waiting', (select today from t) - c.posted_on,
               'amount_cents', c.amount_cents,
               'channel', c.channel,
               'payer_name', c.payer_name,
               'reference', c.reference,
               'description', left(c.description, 200),
               'status', c.status,
               'account', (select a.name from app.bank_accounts a where a.id = c.bank_account_id))
               order by c.rn)
        from credits c
       where c.rn <= greatest(coalesce(p_limit, 10), 1)), '[]'::jsonb)
  )
  where app.assert_module_enabled(p_center, 'giving_bank')
$$;

-- ── app.giving_zelle_waiting (latest body: 0656) ────────────────────────────────────────────
create or replace function app.giving_zelle_waiting(p_center uuid, p_limit integer default 10, p_today date default null)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'UTC') as tz
  ),
  t as (
    select coalesce(p_today, (now() at time zone (select tz from z))::date) as today
  ),
  waiting as (
    select r.id, r.household_id, r.status, r.amount_cents, r.sent_on, r.due_on, r.sender_name, r.is_test,
           (r.confirmation_normalized is not null) as has_confirmation,
           coalesce(array_length(r.pledge_ids, 1), 0) as pledges_named,
           row_number() over (order by r.sent_on, r.created_at, r.id) as rn
      from app.payment_reports r
     where r.center_id = p_center and r.status in ('reported', 'unmatched')
  )
  select jsonb_build_object(
    'as_of', (select today from t),
    'reported', (select count(*) from waiting where status = 'reported')::integer,
    'unmatched', (select count(*) from waiting where status = 'unmatched')::integer,
    'past_window', (select count(*) from waiting where due_on < (select today from t))::integer,
    'total_cents', coalesce((select sum(amount_cents) from waiting), 0)::bigint,
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id,
               'household_id', w.household_id,
               'status', w.status,
               'amount_cents', w.amount_cents,
               'sent_on', w.sent_on,
               'days_waiting', (select today from t) - w.sent_on,
               'due_on', w.due_on,
               'past_window', w.due_on < (select today from t),
               'sender_name', w.sender_name,
               'has_confirmation', w.has_confirmation,
               'pledges_named', w.pledges_named,
               'is_test', w.is_test)
               order by w.rn)
        from waiting w
       where w.rn <= greatest(coalesce(p_limit, 10), 1)), '[]'::jsonb)
  )
  where app.assert_module_enabled(p_center, 'giving_bank')
$$;

-- ── app.giving_deposit_context (latest body: 0659) ──────────────────────────────────────────
create or replace function app.giving_deposit_context(p_txn uuid, p_payment_ids uuid[])
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with t as (
    select b.id, b.center_id, b.posted_on, b.amount_cents, b.description, b.status, b.is_batch_deposit
      from app.bank_transactions b
     where b.id = p_txn and app.assert_module_enabled(b.center_id, 'giving_bank')
  ),
  want as (
    select distinct u as id from unnest(coalesce(p_payment_ids, '{}'::uuid[])) u
  ),
  pay as (
    select p.id, p.receipt_number, p.household_id, p.amount_cents, p.method, p.provider, p.check_number, p.envelope_number,
           p.received_on, p.deposit_bank_transaction_id,
           (p.provider = 'offline' and p.deposit_bank_transaction_id is null) as can_match
      from app.payments p
      join t on p.center_id = t.center_id
     where p.id in (select id from want)
  )
  select jsonb_build_object(
    'bank_line', (select jsonb_build_object(
                    'id', t.id, 'center_id', t.center_id, 'posted_on', t.posted_on, 'amount_cents', t.amount_cents, 'description', left(t.description, 200),
                    'status', t.status, 'is_batch_deposit', t.is_batch_deposit) from t),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'receipt_number', p.receipt_number, 'household_id', p.household_id, 'amount_cents', p.amount_cents,
               'method', p.method, 'check_number', p.check_number, 'envelope_number', p.envelope_number,
               'received_on', p.received_on, 'can_match', p.can_match,
               'already_deposited', p.deposit_bank_transaction_id is not null)
               order by p.received_on, p.id)
        from pay p), '[]'::jsonb),
    'missing_ids', coalesce((select jsonb_agg(w.id order by w.id) from want w where not exists (select 1 from pay p where p.id = w.id)), '[]'::jsonb),
    'total_cents', coalesce((select sum(p.amount_cents) from pay p), 0)::bigint,
    'difference_cents', (select t.amount_cents from t) - coalesce((select sum(p.amount_cents) from pay p), 0)::bigint
  )
  where exists (select 1 from t)
$$;

-- ── app.worker_payment_reports_sweep (latest body: 0582) ────────────────────────────────────
create or replace function app.worker_payment_reports_sweep() returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; v_marked int := 0; v_notices int := 0; v_failures int := 0; v_held int := 0; v_n jsonb;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Zelle report not seen on the bank statement within its window');
  select count(*) into v_held
    from app.payment_reports pr join app.centers c on c.id = pr.center_id
   where pr.status = 'reported'
     and pr.due_on < (now() at time zone coalesce(nullif(c.time_zone, ''), 'America/Chicago'))::date
     and app.module_enabled(pr.center_id, 'giving')
     and app.module_enabled(pr.center_id, 'giving_bank')
     and app._zelle_report_held(pr.id);
  for r in
    select pr.id
      from app.payment_reports pr
      join app.centers c on c.id = pr.center_id
     where pr.status = 'reported'
       and pr.due_on < (now() at time zone coalesce(nullif(c.time_zone, ''), 'America/Chicago'))::date
       and app.module_enabled(pr.center_id, 'giving')
       and app.module_enabled(pr.center_id, 'giving_bank')
       and not app._zelle_report_held(pr.id)
     order by pr.due_on, pr.created_at
     limit 500
     for update of pr skip locked
  loop
    update app.payment_reports set status = 'unmatched', unmatched_at = now() where id = r.id and status = 'reported';
    if not found then continue; end if;
    v_marked := v_marked + 1;
    v_n := app._zelle_report_notice(r.id, 'zelle_report_unmatched');
    if (v_n->>'queued')::int > 0 then v_notices := v_notices + 1; end if;
    if (v_n->>'failed')::int > 0 then v_failures := v_failures + 1; end if;
  end loop;
  return jsonb_build_object('marked', v_marked, 'notices', v_notices, 'notice_failures', v_failures, 'held_for_review', v_held);
end $$;

-- ── app.possible_duplicate_zelle (latest body: 0583) ────────────────────────────────────────
create or replace function app.possible_duplicate_zelle(p_household uuid, p_amount_cents bigint, p_on date) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then raise exception 'That family was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(v_center, 'giving');
  if not (app.has_permission(v_center, 'giving.view') or app.has_permission(v_center, 'giving.record_offline')
          or app.has_permission(v_center, 'giving.manage')) then
    raise exception 'Checking for a Zelle recorded twice needs giving.view or giving.record_offline.' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_on is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.d, x.k)
      from (
        select jsonb_build_object('kind', z.kind, 'id', z.id, 'receipt_number', z.receipt_number, 'date', z.received_on::text,
                                  'amount_cents', z.amount_cents) as j, z.received_on as d, z.kind as k
          from app.zelle_recorded_payments(p_household, p_amount_cents, p_on) z
        union all
        select jsonb_build_object('kind', 'report', 'id', r.id, 'receipt_number', null, 'date', r.sent_on::text,
                                  'amount_cents', r.amount_cents), r.sent_on, 'report'
          from app.payment_reports r
         where r.household_id = p_household and r.amount_cents = p_amount_cents and r.status in ('reported','unmatched')
           and app.module_enabled(v_center, 'giving_bank')   -- 0742: no report rows while Bank reconciliation is off
      ) x), '[]'::jsonb);
end $$;

-- ── app.member_payment_methods (latest body: 0597) ──────────────────────────────────────────
create or replace function app.member_payment_methods(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; v_staff boolean; v_forced boolean; v_offline boolean; v_rehearsal boolean;
        v_methods jsonb := '[]'::jsonb; v_online boolean := false; v_test_mode boolean := false; v_unavailable text;
        r record; cp app.center_payment_processors; v_conn text; v_instr jsonb; v_window text; v_shown jsonb; v_notice jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to see how to give.' using errcode = '42501'; end if;
  v_staff := app.payments_can_view(p_center);
  if not (app.is_member_of(p_center) or v_staff) then
    raise exception 'Only members of this community can see how to give.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  if not v_staff and not app.i_am_adult(p_center) then
    raise exception 'Only an adult of the family can pay for it.' using errcode = '42501';
  end if;
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  v_forced := c.environment = 'sandbox' or app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb;
  v_offline := coalesce((c.rules #>> '{payments,offline_only}')::boolean, false);
  v_rehearsal := c.environment = 'sandbox';

  for r in
    select pl.key, pl.family, pl.provider, pl.legacy_method,
           coalesce(cpp.label_override, pl.label) as label, coalesce(cpp.sort, pl.sort) as sort
      from app.payment_plugins pl
      left join app.center_payment_plugins cpp on cpp.center_id = p_center and cpp.plugin_key = pl.key
     where not app.payment_plugin_is_paused(p_center, pl.key) and app.payment_plugin_enabled(p_center, pl.key)
     order by coalesce(cpp.sort, pl.sort), pl.sort, pl.key
  loop
    if r.family = 'provider_checkout' then
      -- One entry per processor: the wallets and ACH are part of Card's entry.
      continue when r.key not in ('card','paypal');
      select * into cp from app.center_payment_processors where center_id = p_center and processor = r.provider;
      select ic.status into v_conn from app.integration_connections ic where ic.id = cp.connection_id;
      if cp.status = 'test' and not v_forced then v_test_mode := true; end if;
      continue when v_offline or cp.center_id is null or cp.status not in ('test','live')
                 or not (cp.status = 'live' or v_forced) or v_conn is distinct from 'connected';
      v_notice := case when r.key = 'paypal' then app.payee_notice(p_center, 'paypal') end;
      v_methods := v_methods || jsonb_build_array(jsonb_build_object(
        'key', r.key, 'family', r.family, 'label', r.label, 'provider', r.provider,
        'mode', app.payment_api_mode(p_center, r.provider),
        'wallets', case when r.key = 'card' then
                     (select coalesce(jsonb_agg(w.key order by w.sort), '[]'::jsonb) from app.payment_plugins w
                       where w.key in ('apple_pay','google_pay') and not app.payment_plugin_is_paused(p_center, w.key)
                         and app.payment_plugin_enabled(p_center, w.key))
                   else '[]'::jsonb end,
        'also', case when r.key = 'card' then
                  (select coalesce(jsonb_agg(w.key order by w.sort), '[]'::jsonb) from app.payment_plugins w
                    where w.key = 'bank_debit' and not app.payment_plugin_is_paused(p_center, w.key)
                      and app.payment_plugin_enabled(p_center, w.key))
                else case when 'venmo' = any (cp.methods) then '["venmo"]'::jsonb else '[]'::jsonb end end,
        'sort', r.sort)
        || case when v_notice is not null then jsonb_build_object('payee_notice', v_notice) else '{}'::jsonb end);
      v_online := true;
    elsif r.family = 'reported_transfer' then
      select m.instructions into v_instr from app.center_payment_methods m
       where m.center_id = p_center and m.method = r.legacy_method::app.payment_method;
      v_instr := coalesce(v_instr, '{}'::jsonb);
      v_shown := case when v_rehearsal
                      then jsonb_build_object('name', 'Sandbox: no real money moves')
                           || jsonb_strip_nulls(jsonb_build_object('memo_hint', nullif(btrim(coalesce(v_instr->>'memo_hint', '')), '')))
                      else jsonb_strip_nulls(jsonb_build_object(
                             'recipient', nullif(btrim(coalesce(v_instr->>'recipient', '')), ''),
                             'name', nullif(btrim(coalesce(v_instr->>'name', '')), ''),
                             'memo_hint', nullif(btrim(coalesce(v_instr->>'memo_hint', '')), ''))) end;
      v_window := c.rules #>> '{payments,zelle,report_window_days}';
      v_notice := case when not v_rehearsal then app.payee_notice(p_center, 'zelle') end;
      v_methods := v_methods || jsonb_build_array(jsonb_build_object(
        'key', r.key, 'family', r.family, 'label', r.label,
        'mode', case when v_rehearsal then 'rehearsal' else 'live' end,
        'instructions', v_shown,
        'report', jsonb_build_object(
          'available', to_regprocedure('app.report_payment(uuid,uuid,text,bigint,date,text,text,uuid[],text)') is not null
                       and app.module_enabled(p_center, 'giving_bank'),   -- 0742: reporting needs Bank reconciliation
          'confirmation', 'ask',
          -- 3 to 30 days, 10 when not set (the same rule plan PR 3's app.zelle_report_window_days applies).
          'window_days', least(30, greatest(3, case when v_window ~ '^\s*\d{1,4}\s*$' then v_window::int else 10 end))),
        'sort', r.sort)
        || case when v_notice is not null then jsonb_build_object('payee_notice', v_notice) else '{}'::jsonb end);
    else
      select m.instructions into v_instr from app.center_payment_methods m
       where m.center_id = p_center and m.method = r.legacy_method::app.payment_method;
      v_methods := v_methods || jsonb_build_array(jsonb_build_object(
        'key', r.key, 'family', r.family, 'label', r.label, 'method', r.legacy_method,
        'instructions', coalesce(v_instr, '{}'::jsonb), 'sort', r.sort));
    end if;
  end loop;

  if v_offline then v_unavailable := 'offline_only';
  elsif not v_online then v_unavailable := case when v_test_mode then 'test_mode' else 'not_connected' end;
  end if;
  return jsonb_build_object('environment', c.environment, 'currency', lower(coalesce(c.currency, 'usd')),
                            'online_unavailable', v_unavailable, 'methods', v_methods);
end $$;
