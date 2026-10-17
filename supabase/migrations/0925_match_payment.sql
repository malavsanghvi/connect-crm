-- 0925 · CatchTheMatch Phase 1, piece 3 (slice 4): the match arrives (docs/CATCH_THE_MATCH.md sections 8, 9 and 13; owner request of 2026-10-17).
-- NEEDS OWNER OK: MONEY (a new way a payment is recorded; year-end statements, the year-end review, household credit and the receipt email
-- change for the payments it records).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   When the employer's match reaches the organization, a manager records it against the claim:
--     app.record_match_payment(center, claim, amount_cents, received_on, note)
--   It records ONE payment in Giving, method 'matching_gift', offline, for the DONOR'S HOUSEHOLD (that is the donor's soft credit: the
--   match shows in the household's giving history beside their own gifts), exactly once (idempotency key 'match:<claim>'), in whole cents,
--   not in the future, and marks the claim RECEIVED on that day. It needs matching.manage AND giving.record_offline (or giving.manage):
--   a CatchTheMatch manager alone cannot move money, and a clerk alone cannot see or touch a claim. Nobody under 18, never a platform admin.
--   The payment is NOT applied to any pledge and NOT credit: the employer's money never pays down the donor's own pledge, and nothing
--   applies it later by itself (a treasurer can still apply it by hand, as for any payment). It is numbered like any payment (a reference for the ledger
--   and the bank) but no receipt goes for it: never a tax receipt to the donor for the employer's money.
--   app.match_payments        the link from that payment to its claim, the donor, the household and the employer's name at the time. The
--                             organization's own data under 0757's contract (module 'matching', its readers, adults only, restrictive
--                             module_switch, private audit). The employer's name lives ONLY here: the payment's memo says "Employer matching gift".
--   WHAT A MATCH PAYMENT IS NOT, EVERYWHERE THE DONOR'S OWN MONEY IS COUNTED (these functions are replaced; each is its latest body plus one change):
--     app.year_end_statement   (0743)  the donor's year-end statement leaves it out of the lines, the count and the TAX-DEDUCTIBLE TOTAL and lists it
--                                      apart as "employer_matches", with a sentence: it is the employer's gift, not the donor's. The employer's name shows
--                                      to the household's adults and to CatchTheMatch readers; to giving staff who are neither it reads "Employer matching gift".
--     app.year_end_review      (0746)  the statements to send: a match is not part of a household's total, and a household with only a match gets none.
--     app.receipt_copy         (0746)  refuses: the employer's money has no receipt to the donor.
--     app.payments_receipt_email (0770) sends no receipt email for it.
--     app.household_credit     (0862)  it is not credit.
--     app._match_gifts / _match_gifts_of (0886, 0922)  it is not a gift that can itself be matched (no double claim).
--   WHAT STAYS: it is real money received. It counts in the organization's giving totals and reports (as money not applied to a pledge), it posts to
--   QuickBooks like any offline payment, and it is reconciled in the Bank tab by the existing engine (app.reconcile_candidates proposes it for an
--   incoming line of the same amount; a batch from a matching platform goes through the deposit sets). The donor's thank-you: DonorDelight's
--   thank-you steps already open one for every gift that went through, so when DonorDelight is on for the community the match opens a step; when it
--   is off nothing is added. (src/lib/care and the care migrations are not touched.)
--   app.set_match_claim_state: a claim with a payment recorded cannot be moved off received ("refund or correct it in Giving first").
--   app.match_claims_list shows, for each claim, whether the match was recorded and (only for a role that also sees giving) the amount.
set client_min_messages = warning;

-- ── The link from a payment to its claim ─────────────────────────────────────
create table if not exists app.match_payments (
  payment_id    uuid primary key references app.payments(id) on delete cascade,
  center_id     uuid not null references app.centers(id) on delete cascade,
  claim_id      uuid not null unique references app.match_claims(id),
  person_id     uuid not null references app.people(id),
  household_id  uuid not null references app.households(id),
  employer_name text not null check (char_length(employer_name) between 1 and 160),
  recorded_by   uuid references auth.users(id),
  recorded_at   timestamptz not null default now()
);
create index if not exists match_payments_household_idx on app.match_payments (household_id);
create index if not exists match_payments_center_idx on app.match_payments (center_id);
comment on table app.match_payments is
  'The payment (method matching_gift) that records an employer''s match against a CatchTheMatch claim (0925): the donor, the donor''s household (the soft credit) and the employer''s name then. The organization''s own data: its CatchTheMatch readers only, no platform-admin read, a private audit. A payment named here is the employer''s money: never a tax receipt, statement total, credit or gift of the donor. Written only by app.record_match_payment.';

drop trigger if exists audit_match_payments on app.match_payments;
create trigger audit_match_payments after insert or update or delete on app.match_payments
  for each row execute function app.audit_private_row('matching', 'payment_id');
insert into app.module_tables (table_name, module_key) values ('match_payments', 'matching')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.match_payments enable row level security;
drop policy if exists match_payments_read on app.match_payments;
create policy match_payments_read on app.match_payments for select to authenticated
  using (center_id = any ((select app.matching_org_readable_centers())::uuid[]) and app.match_ask_readable(center_id, person_id));
drop policy if exists module_switch on app.match_payments;
create policy module_switch on app.match_payments as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])));
revoke all on app.match_payments from public, anon, authenticated;
grant select on app.match_payments to authenticated;
grant all on app.match_payments to service_role;

-- Is this payment an employer's match? (internal; the money functions below ask it)
create or replace function app._is_match_payment(p_payment uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.match_payments mp where mp.payment_id = p_payment)
$$;
revoke execute on function app._is_match_payment(uuid) from public, anon, authenticated;

-- ── A match payment is not a gift that can itself be matched ─────────────────
create or replace function app._match_gifts(p_center uuid)
returns table (payment_id uuid, person_id uuid, household_id uuid, received_on date, donation_cents bigint)
language sql stable security definer set search_path = app, public, extensions as $$
  with pay as (
    select p.id, p.payer_person_id, p.household_id, p.received_on, greatest(p.amount_cents - p.refunded_cents, 0)::bigint as net
      from app.payments p
     where p.center_id = p_center
       and p.status in ('captured', 'settled', 'partially_refunded')
       and not p.is_opening_balance and not p.is_historical
       and p.payer_person_id is not null and not app.person_is_minor(p.payer_person_id)
       and not exists (select 1 from app.match_payments mp where mp.payment_id = p.id)
  ),
  fee as (
    select al.payment_id, sum(al.amount_cents)::bigint as fee
      from app.payment_allocations al join app.pledges pl on pl.id = al.pledge_id
     where al.center_id = p_center and pl.source in ('membership_fee', 'pathshala_fee', 'store')
     group by al.payment_id
  )
  select pay.id, pay.payer_person_id, pay.household_id, pay.received_on, pay.net - least(coalesce(fee.fee, 0), pay.net)
    from pay left join fee on fee.payment_id = pay.id
   where pay.net - least(coalesce(fee.fee, 0), pay.net) > 0
$$;

create or replace function app._match_gifts_of(p_center uuid, p_person uuid)
returns table (payment_id uuid, person_id uuid, household_id uuid, received_on date, donation_cents bigint)
language sql stable security definer set search_path = app, public, extensions as $$
  with pay as (
    select p.id, p.payer_person_id, p.household_id, p.received_on, greatest(p.amount_cents - p.refunded_cents, 0)::bigint as net
      from app.payments p
     where p.center_id = p_center and p.payer_person_id = p_person
       and p.status in ('captured', 'settled', 'partially_refunded')
       and not p.is_opening_balance and not p.is_historical
       and not app.person_is_minor(p.payer_person_id)
       and not exists (select 1 from app.match_payments mp where mp.payment_id = p.id)
  ),
  fee as (
    select al.payment_id, sum(al.amount_cents)::bigint as fee
      from app.payment_allocations al join app.pledges pl on pl.id = al.pledge_id
     where al.center_id = p_center and pl.source in ('membership_fee', 'pathshala_fee', 'store')
       and al.payment_id in (select id from pay)
     group by al.payment_id
  )
  select pay.id, pay.payer_person_id, pay.household_id, pay.received_on, pay.net - least(coalesce(fee.fee, 0), pay.net)
    from pay left join fee on fee.payment_id = pay.id
   where pay.net - least(coalesce(fee.fee, 0), pay.net) > 0
$$;

-- ── Recording the match ──────────────────────────────────────────────────────
create or replace function app.record_match_payment(p_center uuid, p_claim uuid, p_amount_cents bigint, p_received_on date default null,
                                                    p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  c app.match_claims; v_pay app.payments; v_today date; v_day date; v_note text; v_employer text; v_hh uuid; v_gift bigint;
begin
  perform app._match_manager_or_raise(p_center);
  perform app.assert_module_enabled(p_center, 'giving');
  if not (app.has_permission(p_center, 'giving.record_offline') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'Recording the match in Giving needs giving.record_offline (or giving.manage) as well as matching.manage.' using errcode = '42501';
  end if;
  select * into c from app.match_claims where id = p_claim and center_id = p_center for update;
  if c.id is null then raise exception 'That claim was not found.' using errcode = '22023'; end if;
  if app.person_is_minor(c.person_id) then raise exception 'Gift matching is for adults only.' using errcode = '22023'; end if;
  if c.state in ('declined', 'expired', 'withdrawn') then
    raise exception 'This claim ended without a match. Open it again first if the employer did pay.' using errcode = '22023';
  end if;
  if exists (select 1 from app.match_payments mp where mp.claim_id = c.id) then
    raise exception 'A payment is already recorded for this match.' using errcode = '23505';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Enter an amount greater than zero.' using errcode = '22023';
  end if;
  v_today := app._match_today(p_center);
  v_day := coalesce(p_received_on, v_today);
  if v_day > v_today then raise exception 'The match cannot have been received in the future.' using errcode = '22023'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 200 then raise exception 'The note is too long (200 characters at most).' using errcode = '22023'; end if;
  -- The donor's household is the gift's own; the gift is what the match is checked against (ten times is a typing slip, not a match).
  select pay.household_id, greatest(pay.amount_cents - pay.refunded_cents, 0) into v_hh, v_gift from app.payments pay where pay.id = c.payment_id and pay.center_id = p_center;
  if v_hh is null then raise exception 'The gift this claim is for was not found.' using errcode = '22023'; end if;
  if p_amount_cents > greatest(v_gift, 100) * 10 then
    raise exception 'That is more than ten times the gift it matches, which is far beyond any employer''s match. Check the amount.' using errcode = '22023';
  end if;
  select m.company_name into v_employer from app._match_program_current(c.program_id) m;
  v_employer := coalesce(v_employer, (select x.company_name from app.match_programs x where x.id = c.program_id));

  perform app.set_audit_context('Recorded an employer''s match in Giving');
  -- The payment is numbered like any other (a reference for the ledger and the bank), but it is the employer's money: no receipt email goes for it.
  -- The payment's own trigger runs before its link exists, so it is told by this setting, for this transaction only.
  perform set_config('app.match_payment', 'on', true);
  insert into app.payments (center_id, household_id, amount_cents, method, status, provider, received_on, recorded_by, memo, idempotency_key)
  values (p_center, v_hh, p_amount_cents, 'matching_gift', 'captured', 'offline', v_day, auth.uid(),
          'Employer matching gift' || coalesce(' · ' || v_note, ''), 'match:' || c.id::text)
  returning * into v_pay;
  insert into app.match_payments (payment_id, center_id, claim_id, person_id, household_id, employer_name, recorded_by)
  values (v_pay.id, p_center, c.id, c.person_id, v_hh, v_employer, auth.uid());
  perform set_config('app.match_payment', '', true);
  update app.match_claims
     set state = 'received', state_at = case when c.state = 'received' then state_at else now() end, state_by = auth.uid(),
         received_on = coalesce(c.received_on, v_day)
   where id = c.id;
  return jsonb_build_object('payment_id', v_pay.id, 'claim_id', c.id, 'household_id', v_hh, 'amount_cents', p_amount_cents, 'received_on', v_day);
end $$;

-- ── A claim with a payment cannot be moved off "received" (0886's body plus the one guard) ──
create or replace function app.set_match_claim_state(p_center uuid, p_claim uuid, p_state text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.match_claims; v_note text;
begin
  perform app._match_manager_or_raise(p_center);
  if p_state is null or p_state not in ('asked', 'requested', 'verified', 'received', 'declined', 'expired', 'withdrawn') then
    raise exception 'Choose where the claim stands: asked, requested, verified, received, declined, expired or withdrawn.' using errcode = '22023';
  end if;
  select * into c from app.match_claims where id = p_claim and center_id = p_center for update;
  if c.id is null then raise exception 'That claim was not found.' using errcode = '22023'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note is too long (500 characters at most).' using errcode = '22023';
  end if;
  if c.state = p_state then return jsonb_build_object('id', c.id, 'state', c.state); end if;
  if p_state <> 'received' and exists (select 1 from app.match_payments mp where mp.claim_id = c.id) then
    raise exception 'The match was recorded in Giving for this claim. Refund or correct that payment in Giving first; the claim stays received.' using errcode = '22023';
  end if;
  -- A claim that ended (received, declined, expired, withdrawn) is only ever opened again, to "asked": it was a mistake.
  if c.state in ('received', 'declined', 'expired', 'withdrawn') and p_state <> 'asked' then
    raise exception 'This claim has ended. Open it again first if it was a mistake.' using errcode = '22023';
  end if;
  update app.match_claims
     set state = p_state, state_at = now(), state_by = auth.uid(),
         received_on = case when p_state = 'received' then app._match_today(p_center) end,
         note = coalesce(v_note, note)
   where id = c.id;
  return jsonb_build_object('id', c.id, 'state', p_state);
end $$;

-- ── Household credit: the employer's match is not credit (0862's body plus the one condition) ──
create or replace function app.household_credit(p_household uuid) returns bigint
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_credit bigint;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then return 0; end if;
  if not app.adult_of_household(v_center, p_household) then raise exception 'only an adult of the household can see its credit'; end if;
  select coalesce(sum(greatest(p.amount_cents - p.donor_covered_fee_cents - p.refunded_cents - coalesce(a.alloc, 0), 0)), 0) into v_credit
    from app.payments p
    left join lateral (select sum(amount_cents) as alloc from app.payment_allocations where payment_id = p.id) a on true
   where p.household_id = p_household and p.status in ('captured', 'settled', 'pending_clearing', 'partially_refunded')
     and not exists (select 1 from app.match_payments mp where mp.payment_id = p.id);
  return v_credit;
end $$;

-- ── No receipt email for the employer's money (0770's body plus the one condition) ──
create or replace function app.payments_receipt_email() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_auto uuid;
begin
  -- A donation upload: remember the payment for app.email_receipts_for_uploaded, and send nothing from here.
  if app._email_in_upload() then
    if tg_op = 'INSERT' then
      insert into app.email_upload_marks (payment_id, center_id) values (new.id, new.center_id) on conflict (payment_id) do nothing;
    end if;
    return null;
  end if;
  if app._email_in_import() then return null; end if;
  if not app.statement_counted_status(new.status) or new.is_opening_balance or new.is_historical
     or coalesce(btrim(new.receipt_number), '') = '' or new.crm_external_id is not null
     or coalesce(current_setting('app.match_payment', true), '') = 'on'
     or exists (select 1 from app.match_payments mp where mp.payment_id = new.id) then
    return null;
  end if;
  if tg_op = 'UPDATE' and app.statement_counted_status(old.status) then return null; end if;
  v_auto := app._email_automation_on(new.center_id, 'payment_receipt');
  if v_auto is null then return null; end if;
  begin
    perform app._email_compose_later(new.center_id, v_auto, new.id);
  exception when others then
    -- The payment is recorded whatever happens to its email; the reason is in the database log.
    raise warning 'payments_receipt_email: could not queue the receipt email for payment %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

-- ── The donor's year-end statement (0743's body; the employer's match is listed apart and is not in the total) ──
create or replace function app.year_end_statement(p_household uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_lines jsonb; v_total bigint; v_n int; v_ob_total bigint; v_ob_n int; v_matches jsonb; v_match_total bigint; v_names boolean;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then raise exception 'That household was not found.'; end if;
  perform app.assert_module_enabled(v_center, 'giving');
  perform app.assert_module_enabled(v_center, 'giving_statements');
  if not (app.adult_of_household(v_center, p_household)
          or app.has_permission(v_center, 'giving.view') or app.has_permission(v_center, 'giving.manage')) then
    raise exception 'Seeing this household''s year-end statement needs an adult of the household, giving.view or giving.manage.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_year is null or p_year < 1990 or p_year > 2200 then raise exception 'Choose a tax year.'; end if;
  -- The employer's name is the household's own business and CatchTheMatch readers'; other giving staff see only that it was an employer's match.
  v_names := app.adult_of_household(v_center, p_household) or app._matching_org_can(v_center);

  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'receipt_number', p.receipt_number, 'received_on', p.received_on, 'method', p.method,
           'amount_cents', p.amount_cents, 'refunded_cents', p.refunded_cents, 'given_cents', p.amount_cents - p.refunded_cents,
           'receipt_name', p.receipt_name, 'joint_receipt', p.joint_receipt)
         order by p.received_on, p.receipt_number), '[]'::jsonb),
         coalesce(sum(p.amount_cents - p.refunded_cents), 0), count(*)
    into v_lines, v_total, v_n
    from app.payments p
   where p.household_id = p_household and p.center_id = v_center
     and p.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
     and app.statement_counted_status(p.status)
     and not p.is_opening_balance
     and not exists (select 1 from app.match_payments mp where mp.payment_id = p.id);

  select coalesce(sum(p.amount_cents - p.refunded_cents), 0), count(*) into v_ob_total, v_ob_n
    from app.payments p
   where p.household_id = p_household and p.center_id = v_center
     and p.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
     and app.statement_counted_status(p.status)
     and p.is_opening_balance;

  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'received_on', p.received_on, 'given_cents', p.amount_cents - p.refunded_cents,
           'employer', case when v_names then mp.employer_name else 'Employer matching gift' end)
         order by p.received_on, p.id), '[]'::jsonb),
         coalesce(sum(p.amount_cents - p.refunded_cents), 0)
    into v_matches, v_match_total
    from app.payments p join app.match_payments mp on mp.payment_id = p.id
   where p.household_id = p_household and p.center_id = v_center
     and p.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
     and app.statement_counted_status(p.status);

  return jsonb_build_object(
    'household_id', p_household, 'tax_year', p_year,
    'lines', v_lines, 'gift_count', v_n, 'total_cents', v_total,
    'employer_matches', v_matches, 'employer_match_cents', v_match_total,
    'employer_match_note', case when jsonb_array_length(v_matches) > 0 then
      'Employer matching gifts are listed apart: they are your employer''s gift to us, not yours, so they are not in your total and are not a gift you can deduct. We thank you and your employer.' end,
    'left_out', jsonb_build_object(
      'opening_balance_count', v_ob_n, 'opening_balance_cents', v_ob_total,
      'reason', case when v_ob_n > 0 then
        'Opening-balance lines are left out: they record what was paid on a pledge before the imported payment history begins, not gifts received in ' || p_year || '. They still show in the household''s giving history.'
      end));
end $$;

-- ── The year-end review: a match is not part of a household's total (0746's body plus the one condition) ──
create or replace function app.year_end_review(p_center uuid, p_year int, p_majority int default 18)
returns table (household_id uuid, household_name text, household_number text, org_household_id text, city text,
               adults jsonb, gift_count int, given_cents bigint, refunded_cents bigint, refunded_count int,
               opening_balance_count int, opening_balance_cents bigint, mail_opt_in boolean, address_complete boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_statements');
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'The year-end review needs giving.view or giving.manage.' using errcode = 'insufficient_privilege';
  end if;
  if p_year is null or p_year < 1990 or p_year > 2200 then raise exception 'Choose a tax year.'; end if;

  return query
  with pay as (
    select p.household_id as hid,
           count(*) filter (where app.statement_counted_status(p.status) and not p.is_opening_balance) as n,
           coalesce(sum(p.amount_cents - p.refunded_cents)
                      filter (where app.statement_counted_status(p.status) and not p.is_opening_balance), 0)::bigint as given,
           coalesce(sum(p.refunded_cents)
                      filter (where (app.statement_counted_status(p.status) or p.status = 'refunded') and not p.is_opening_balance), 0)::bigint as refunded,
           count(*) filter (where p.status = 'refunded' and not p.is_opening_balance) as refunded_n,
           count(*) filter (where app.statement_counted_status(p.status) and p.is_opening_balance) as ob_n,
           coalesce(sum(p.amount_cents - p.refunded_cents)
                      filter (where app.statement_counted_status(p.status) and p.is_opening_balance), 0)::bigint as ob
      from app.payments p
     where p.center_id = p_center
       and p.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
       and not exists (select 1 from app.match_payments mp where mp.payment_id = p.id)
     group by p.household_id
  )
  select h.id, h.display_name, h.household_number,
         (select e.value from app.external_ids e where e.household_id = h.id and e.kind = 'org_household'
            and e.valid_to is null order by e.is_primary desc, e.created_at limit 1),
         h.city,
         coalesce((select jsonb_agg(jsonb_build_object(
                            'name', btrim(coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) || ' ' || pe.last_name),
                            'primary', hm.is_primary,
                            'email', coalesce(btrim(pe.email), '') <> '',
                            'app', exists (select 1 from app.center_users cu where cu.center_id = p_center and cu.person_id = pe.id))
                          order by hm.is_primary desc, pe.date_of_birth nulls last, pe.first_name)
                     from app.household_members hm join app.people pe on pe.id = hm.person_id
                    where hm.household_id = h.id and hm.left_at is null and not pe.is_deceased and pe.merged_into_id is null
                      and app._statement_adult(pe.date_of_birth, hm.role, p_majority)), '[]'::jsonb),
         pay.n::int, pay.given, pay.refunded, pay.refunded_n::int, pay.ob_n::int, pay.ob,
         coalesce(h.physical_mail_opt_in, false),
         coalesce(btrim(h.address_line1), '') <> '' and coalesce(btrim(h.city), '') <> '' and coalesce(btrim(h.postal_code), '') <> ''
    from pay join app.households h on h.id = pay.hid and h.center_id = p_center
   where pay.n > 0
   order by h.display_name, h.id;
end $$;

-- ── A copy of a receipt: the employer's money has none (0746's body plus the one refusal) ──
create or replace function app.receipt_copy(p_payment uuid, p_majority int default 18)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v app.payments; v_payer_adult boolean; v_minors text[]; v_name text; v_hidden boolean := false;
begin
  select * into v from app.payments where id = p_payment;
  if v.id is null then raise exception 'That payment was not found.'; end if;
  perform app.assert_module_enabled(v.center_id, 'giving');
  if not (app.has_permission(v.center_id, 'giving.view') or app.has_permission(v.center_id, 'giving.manage')) then
    raise exception 'A copy of a receipt needs giving.view or giving.manage.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from app.match_payments mp where mp.payment_id = v.id) then
    raise exception 'This is an employer''s matching gift, not the donor''s: there is no receipt to the donor for it.';
  end if;
  if v.is_opening_balance then
    raise exception 'An opening-balance line never gets a receipt: it records what was paid before the imported payment history begins.';
  end if;
  if v.status = 'refunded' then raise exception 'This payment was refunded in full, so there is no receipt to copy.'; end if;
  if not app.statement_counted_status(v.status) then
    raise exception 'This payment did not go through, so there is no receipt to copy.';
  end if;
  if coalesce(btrim(v.receipt_number), '') = '' then
    raise exception 'This payment has no receipt number yet, so there is no receipt to copy.';
  end if;

  if v.payer_person_id is not null then
    select app._statement_adult(pe.date_of_birth,
             (select hm.role from app.household_members hm
               where hm.person_id = pe.id and hm.household_id = v.household_id and hm.left_at is null limit 1), p_majority)
      into v_payer_adult
      from app.people pe where pe.id = v.payer_person_id;
  end if;

  select coalesce(array_agg(distinct lower(btrim(n))) filter (where length(btrim(n)) >= 2), '{}'::text[]) into v_minors
    from app.household_members hm join app.people pe on pe.id = hm.person_id
         cross join lateral unnest(array[pe.first_name, pe.preferred_name]) n
   where hm.household_id = v.household_id and hm.left_at is null
     and not app._statement_adult(pe.date_of_birth, hm.role, p_majority);

  v_name := nullif(btrim(v.receipt_name), '');
  if v_name is not null and ((v.payer_person_id is not null and v_payer_adult is not true)
       or exists (select 1 from unnest(v_minors) m where position(m in lower(v_name)) > 0)) then
    v_name := null;
    v_hidden := true;
  end if;

  return jsonb_build_object(
    'payment_id', v.id, 'center_id', v.center_id, 'household_id', v.household_id,
    'household', (select jsonb_build_object('name', h.display_name, 'number', h.household_number, 'city', h.city,
                     'org_id', (select e.value from app.external_ids e where e.household_id = h.id and e.kind = 'org_household'
                                  and e.valid_to is null order by e.is_primary desc, e.created_at limit 1))
                    from app.households h where h.id = v.household_id),
    'receipt_number', v.receipt_number, 'received_on', v.received_on, 'method', v.method, 'status', v.status,
    'amount_cents', v.amount_cents, 'refunded_cents', v.refunded_cents,
    'receipt_name', v_name, 'receipt_name_hidden', v_hidden, 'joint_receipt', v.joint_receipt,
    'payer_is_adult', v_payer_adult,
    'adults', coalesce((select jsonb_agg(btrim(coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) || ' ' || pe.last_name)
                                         order by hm.is_primary desc, pe.date_of_birth nulls last, pe.first_name)
                          from app.household_members hm join app.people pe on pe.id = hm.person_id
                         where hm.household_id = v.household_id and hm.left_at is null and not pe.is_deceased
                           and pe.merged_into_id is null and app._statement_adult(pe.date_of_birth, hm.role, p_majority)), '[]'::jsonb),
    'applied_to', coalesce((select jsonb_agg(distinct coalesce(f.name, c.name))
                              from app.payment_allocations a join app.pledges pl on pl.id = a.pledge_id
                              left join app.funds f on f.id = pl.fund_id
                              left join app.campaigns c on c.id = pl.campaign_id
                             where a.payment_id = v.id and coalesce(f.name, c.name) is not null), '[]'::jsonb),
    'templates', app.check_statement_templates_approved(v.center_id));
end $$;

-- ── The claims list says whether the match was recorded (0922's body plus the payment) ──
create or replace function app.match_claims_list(p_center uuid, p_filter text default 'open', p_limit int default 50,
                                                 p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_filter text := case when p_filter in ('open', 'ended') then p_filter else 'open' end;
        v_today date; v_amounts boolean; v_total int; v_rows jsonb; v_states text[];
begin
  perform app._match_org_reader_or_raise(p_center);
  v_today := app._match_today(p_center);
  v_amounts := app.match_amounts_can(p_center);
  v_states := case when v_filter = 'open' then array['asked', 'requested', 'verified']
                   else array['received', 'declined', 'expired', 'withdrawn'] end;
  with base as (
    select c.*, pay.household_id, pay.received_on as gift_on, greatest(pay.amount_cents - pay.refunded_cents, 0)::bigint as gift_cents,
           m.company_name, m.portal, m.portal_url, m.deadline_kind, m.deadline_months, m.deadline_month, m.deadline_day,
           mp.payment_id as match_payment_id, greatest(mpay.amount_cents - mpay.refunded_cents, 0)::bigint as match_cents
      from app.match_claims c
      join app.payments pay on pay.id = c.payment_id
      join app.match_programs m on m.id = c.program_id
      left join app.match_payments mp on mp.claim_id = c.id
      left join app.payments mpay on mpay.id = mp.payment_id
     where c.center_id = p_center and c.state = any (v_states) and not app.person_is_minor(c.person_id)
  ),
  pg as (select * from base order by state_at desc, id
          limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', x.id, 'state', x.state, 'state_at', x.state_at, 'received_on', x.received_on, 'note', x.note,
             'asked_by_message_at', x.asked_by_message_at, 'requested_by_member_at', x.requested_by_member_at,
             'person', jsonb_build_object('id', x.person_id, 'name', app._care_person_name(x.person_id)),
             'household', app._care_household_head(x.household_id),
             'program', jsonb_build_object('id', x.program_id, 'company_name', x.company_name, 'portal', x.portal, 'portal_url', x.portal_url),
             'gift', jsonb_build_object('payment_id', x.payment_id, 'received_on', x.gift_on,
                                        'amount_cents', case when v_amounts then x.gift_cents end),
             'match', jsonb_build_object('recorded', x.match_payment_id is not null,
                                         'payment_id', case when v_amounts then x.match_payment_id end,
                                         'amount_cents', case when v_amounts then x.match_cents end),
             'deadline_on', app._match_deadline(x.deadline_kind, x.deadline_months, x.deadline_month, x.deadline_day, x.gift_on))
             order by x.state_at desc, x.id) from pg x), '[]'::jsonb)
    into v_total, v_rows;
  perform app.log_private_read(p_center, 'matching', 'claims', jsonb_array_length(v_rows));
  return jsonb_build_object('filter', v_filter, 'total', v_total, 'rows', v_rows, 'amounts', v_amounts, 'today', v_today,
                            'can_manage', app.org_private_can(p_center, 'matching.manage'),
                            'can_record', app.org_private_can(p_center, 'matching.manage') and app.module_enabled(p_center, 'giving')
                                          and (app.has_permission(p_center, 'giving.record_offline') or app.has_permission(p_center, 'giving.manage')));
end $$;

-- ── One claim, as the screen that records its match needs it ─────────────────
-- The same row as the list's, with the gift's day and (only for a role that also sees giving) the gift's amount, so the form can say what is
-- being matched; whether the match can be recorded here and by this person; the organization's own readers; logged.
create or replace function app.match_claim_get(p_center uuid, p_claim uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_amounts boolean; v_row jsonb; v_can_record boolean;
begin
  perform app._match_org_reader_or_raise(p_center);
  v_amounts := app.match_amounts_can(p_center);
  v_can_record := app.org_private_can(p_center, 'matching.manage') and app.module_enabled(p_center, 'giving')
                  and (app.has_permission(p_center, 'giving.record_offline') or app.has_permission(p_center, 'giving.manage'));
  select jsonb_build_object(
           'id', c.id, 'state', c.state, 'state_at', c.state_at, 'received_on', c.received_on, 'note', c.note,
           'person', jsonb_build_object('id', c.person_id, 'name', app._care_person_name(c.person_id)),
           'household', app._care_household_head(pay.household_id),
           'program', jsonb_build_object('id', c.program_id, 'company_name', m.company_name, 'portal', m.portal, 'portal_url', m.portal_url),
           'gift', jsonb_build_object('payment_id', c.payment_id, 'received_on', pay.received_on,
                                      'amount_cents', case when v_amounts then greatest(pay.amount_cents - pay.refunded_cents, 0) end),
           'match', jsonb_build_object('recorded', mp.payment_id is not null,
                                       'payment_id', case when v_amounts then mp.payment_id end,
                                       'amount_cents', case when v_amounts and mp.payment_id is not null
                                                            then (select greatest(x.amount_cents - x.refunded_cents, 0) from app.payments x where x.id = mp.payment_id) end),
           'deadline_on', app._match_deadline(m.deadline_kind, m.deadline_months, m.deadline_month, m.deadline_day, pay.received_on))
    into v_row
    from app.match_claims c
    join app.payments pay on pay.id = c.payment_id
    join app.match_programs m on m.id = c.program_id
    left join app.match_payments mp on mp.claim_id = c.id
   where c.id = p_claim and c.center_id = p_center and not app.person_is_minor(c.person_id);
  if v_row is null then raise exception 'That claim was not found.' using errcode = '22023'; end if;
  perform app.log_private_read(p_center, 'matching', 'claim', 1);
  return jsonb_build_object('claim', v_row, 'amounts', v_amounts, 'today', app._match_today(p_center),
                            'can_manage', app.org_private_can(p_center, 'matching.manage'), 'can_record', v_can_record);
end $$;

revoke execute on function app.record_match_payment(uuid, uuid, bigint, date, text), app.match_claim_get(uuid, uuid) from public, anon;
grant execute on function app.record_match_payment(uuid, uuid, bigint, date, text), app.match_claim_get(uuid, uuid) to authenticated, service_role;

-- ── The screen (the activity catalog lists every tab: 0620) ──────────────────
select app.activity_register('screen:/giving/matching/claims/pay', 'screen', 'portal', 'Gift matching: record the match in Giving');
