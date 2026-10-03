-- Payments plan PR 3 · 2 of 2 (docs/PAYMENTS_PLAN.md §2.9, finding G6; owner decisions 2026-10-02):
-- member Zelle reports meet the bank statement.
--
--   app.possible_duplicate_zelle      Zelle payments of a family of this amount around a date that
--                                     are already recorded (by hand, from the bank) or reported
--   app.zelle_pair_is_exact           internal: report and bank line are the same Zelle beyond doubt
--                                     (confirmation number = the line's reference, same amount, date
--                                     in the window, the configured bank account, strictly one to one,
--                                     nothing recorded by hand that it could duplicate)
--   app.zelle_exact_matches           those pairs for the treasurer (household cards)
--   app.confirm_exact_zelle_matches   "Confirm every exact match": only the pairs the treasurer sent,
--                                     each re-checked at call time, each its own confirm_bank_match
--   app.suggest_bank_matches          (replaced) 0104 + member reports as a candidate source and the
--                                     strongest report per household (report_id)
--   app.confirm_bank_match            (replaced) 0104 + p_report (its pledges decide the allocation,
--                                     chosen by the donor; the report is marked matched), an exact
--                                     confirmation-number report is linked automatically, the payer
--                                     defaults to the reporter, a line a report names is a Zelle (a
--                                     report goes only with a Zelle or unlabelled line), and the G6
--                                     double-count guard (SQLSTATE CCDUP) for a Zelle already
--                                     recorded by hand
--   app.attach_bank_line_to_payment   the Zelle counterpart of match_deposit: the bank line settles a
--                                     hand-recorded Zelle/ACH payment (one QuickBooks Deposit,
--                                     undeposited funds -> bank) instead of creating a second payment
--   app.payment_report_queue          the treasurer's Zelle reports panel
--
-- A treasurer click is always required; nothing here runs on its own. Refunds, fees, the
-- two-person rules and card data are untouched.
set client_min_messages = warning;

-- ── What may already be recorded ─────────────────────────────────────────────
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
      ) x), '[]'::jsonb);
end $$;

-- ── Exact pairs ──────────────────────────────────────────────────────────────
create or replace function app.zelle_pair_is_exact(p_report uuid, p_txn uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((
    select true
      from app.payment_reports r
      join app.bank_transactions t on t.id = p_txn and t.center_id = r.center_id
     where r.id = p_report and r.status in ('reported','unmatched')
       and t.status in ('unmatched','suggested') and t.channel = 'zelle' and not t.is_batch_deposit and t.originator_kind is null
       and t.amount_cents > 0 and t.amount_cents = r.amount_cents
       and r.confirmation_normalized is not null and t.reference is not null
       and upper(regexp_replace(t.reference, '[^A-Za-z0-9]', '', 'g')) = r.confirmation_normalized
       and t.posted_on between r.sent_on - 1 and r.due_on + 5
       and (app.zelle_bank_account_id(r.center_id) is null or t.bank_account_id = app.zelle_bank_account_id(r.center_id))
       -- strictly one to one
       and not exists (select 1 from app.payment_reports o where o.center_id = r.center_id and o.id <> r.id
                         and o.status in ('reported','unmatched') and o.confirmation_normalized = r.confirmation_normalized)
       and not exists (select 1 from app.bank_transactions o where o.center_id = t.center_id and o.id <> t.id
                         and o.status in ('unmatched','suggested') and o.reference is not null
                         and upper(regexp_replace(o.reference, '[^A-Za-z0-9]', '', 'g')) = r.confirmation_normalized)
       -- never past the double-count guard
       and not exists (select 1 from app.zelle_recorded_payments(r.household_id, t.amount_cents, t.posted_on) z where z.kind = 'hand_recorded')
  ), false)
$$;

create or replace function app.zelle_exact_matches(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving');
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

-- ── Suggestions: 0104's ranking plus member reports ──────────────────────────
drop function if exists app.suggest_bank_matches(uuid);
create function app.suggest_bank_matches(p_txn uuid)
 RETURNS TABLE(household_id uuid, household_name text, household_number text, org_household_id text, members text, primary_member text,
               primary_org_member_id text, zone text, city text, last_gift_on date, score numeric, reason text, ambiguous boolean,
               open_pledge_cents bigint, report_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  with t as (select * from app.bank_transactions where id = p_txn
             and app.assert_module_enabled(center_id, 'giving')
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

-- ── Confirming a gift line: 0104 + the report and the double-count guard ─────
drop function if exists app.confirm_bank_match(uuid, uuid, uuid[], boolean, uuid);
create function app.confirm_bank_match(p_txn uuid, p_household uuid, p_pledge_ids uuid[] DEFAULT NULL::uuid[], p_learn_payer boolean DEFAULT true,
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

-- ── Attach a bank line to a payment recorded by hand (G6) ────────────────────
create or replace function app.attach_bank_line_to_payment(p_txn uuid, p_payment uuid, p_report uuid default null, p_learn_payer boolean default true)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.bank_transactions; p app.payments; r app.payment_reports;
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  if t.id is null then raise exception 'That bank line was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(t.center_id, 'giving');
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

-- ── "Confirm every exact match" (Q2): only the pairs sent, each re-checked ───
create or replace function app.confirm_exact_zelle_matches(p_center uuid, p_pairs jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare x jsonb; v_report uuid; v_txn uuid; r app.payment_reports; v_payment uuid; v_receipt text; v_state text; v_why text;
        v_confirmed jsonb := '[]'::jsonb; v_skipped jsonb := '[]'::jsonb;
        v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  perform app.assert_module_enabled(p_center, 'giving');
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

-- ── The treasurer's Zelle reports panel ──────────────────────────────────────
create or replace function app.payment_report_queue(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_exact jsonb; v_reports jsonb; v_bank uuid; v_counts jsonb;
begin
  perform app.assert_module_enabled(p_center, 'giving');
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

-- ── Grants ───────────────────────────────────────────────────────────────────
revoke execute on function app.possible_duplicate_zelle(uuid, bigint, date), app.zelle_pair_is_exact(uuid, uuid),
  app.zelle_exact_matches(uuid), app.suggest_bank_matches(uuid),
  app.confirm_bank_match(uuid, uuid, uuid[], boolean, uuid, uuid, text),
  app.attach_bank_line_to_payment(uuid, uuid, uuid, boolean), app.confirm_exact_zelle_matches(uuid, jsonb),
  app.payment_report_queue(uuid)
  from public, anon, authenticated, service_role;
grant execute on function app.possible_duplicate_zelle(uuid, bigint, date), app.zelle_exact_matches(uuid), app.suggest_bank_matches(uuid),
  app.confirm_bank_match(uuid, uuid, uuid[], boolean, uuid, uuid, text),
  app.attach_bank_line_to_payment(uuid, uuid, uuid, boolean), app.confirm_exact_zelle_matches(uuid, jsonb),
  app.payment_report_queue(uuid)
  to authenticated, service_role;
