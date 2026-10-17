-- 0886 · CatchTheMatch Phase 1, part 1: claims, and the finder of the match a member missed
-- (docs/CATCH_THE_MATCH.md section 12; owner direction of 2026-10-17: first help the member claim from their own employer, with
-- Weaver's team acting as the organization's agent only later). Builder CTM3.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.match_claims   one row per gift and per employer program: "this person gave this gift, and their employer's program
--                      may match it". The organization's own data (0757's contract): module 'matching', read by its own
--                      CatchTheMatch readers (and, from Phase 2, a live Weaver filing grant: 0758), adults only, a restrictive
--                      module_switch with no platform-admin pass, the private audit. States, in the order they usually go:
--                        asked       the organization asked the member to request it (staff recorded it)
--                        requested   the member says they asked their employer
--                        verified    staff saw the gift verified in the employer's portal
--                        received    the employer paid the organization (received_on)
--                      or closed without a match: declined (the employer said no), expired (the deadline passed), withdrawn.
--                      No money is recorded here: Phase 1 never stores a match amount, and it never touches a payment. (Putting
--                      the match into Giving and thanking the donor is slice 4.)
--   THE MATCH A MEMBER MISSED. A program is PROVEN HERE when a claim of this community for it is received: somebody did the
--   paperwork and the employer paid. app._match_catch then finds the other gifts of people whose employer on file (0759) is
--   linked to that same program (0767) that have no claim at all: "this employer matches gifts to us, and these members have
--   not asked". Nothing is guessed from a company name: a person is only found through the link a member of staff confirmed.
--     app.record_match_claim(center, person, payment, state, day, note)  records a claim the staff already know about, such as
--                                                           the first match an employer ever paid this community (matching.manage)
--     app.ask_match_claims(center, person, program, note)   records "asked" for every gift of that person that can still be
--                                                           caught (matching.manage)
--     app.set_match_claim_state(center, claim, state, note) moves a claim on, closes it or reopens it (matching.manage)
--   Reading the list is 0888. The member's own side (the app, the message that carries the steps) is a later change: it needs
--   the owner's approval for messaging and an email provider.
set client_min_messages = warning;

-- ── A day in the community's own time ────────────────────────────────────────
create or replace function app._match_today(p_center uuid) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select (now() at time zone coalesce((select c.time_zone from app.centers c where c.id = p_center), 'America/Chicago'))::date
$$;
revoke execute on function app._match_today(uuid) from public, anon, authenticated;

-- ── Claims ───────────────────────────────────────────────────────────────────
create table if not exists app.match_claims (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  person_id   uuid not null references app.people(id) on delete cascade,
  program_id  uuid not null references app.match_programs(id),
  payment_id  uuid not null references app.payments(id) on delete cascade,
  state       text not null default 'asked' check (state in ('asked', 'requested', 'verified', 'received', 'declined', 'expired', 'withdrawn')),
  state_at    timestamptz not null default now(),
  state_by    uuid references auth.users(id),
  received_on date,
  note        text check (note is null or char_length(note) <= 500),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  constraint match_claims_once unique (payment_id, program_id),
  constraint match_claims_received_day check ((state = 'received') = (received_on is not null))
);
create index if not exists match_claims_center_state_idx on app.match_claims (center_id, state);
create index if not exists match_claims_program_idx on app.match_claims (center_id, program_id) where state = 'received';
create index if not exists match_claims_person_idx on app.match_claims (person_id);
comment on table app.match_claims is
  'One gift of an adult and the employer program that may match it (0886, CatchTheMatch Phase 1): asked, requested, verified, received, or closed (declined, expired, withdrawn). The organization''s own data: its CatchTheMatch readers only, no platform-admin read, a private audit. No amount: Phase 1 records no match money.';

-- A claim is an adult's own gift in their own community; who and what it is cannot change afterwards.
create or replace function app.match_claims_check() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.payments;
begin
  if tg_op = 'UPDATE' and (new.center_id, new.person_id, new.program_id, new.payment_id)
                          is distinct from (old.center_id, old.person_id, old.program_id, old.payment_id) then
    raise exception 'A claim keeps its gift, its person and its program.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    select * into p from app.payments where id = new.payment_id;
    if p.id is null or p.center_id <> new.center_id then
      raise exception 'That gift was not found in this community.' using errcode = '23514';
    end if;
    if p.payer_person_id is distinct from new.person_id then
      raise exception 'A claim is for a person''s own gift.' using errcode = '23514';
    end if;
    if not exists (select 1 from app.people x where x.id = new.person_id and x.center_id = new.center_id) then
      raise exception 'That person was not found in this community.' using errcode = '23514';
    end if;
    if app.person_is_minor(new.person_id) then
      raise exception 'Gift matching is for adults only.' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function app.match_claims_check() from public, anon, authenticated;
drop trigger if exists match_claims_check on app.match_claims;
create trigger match_claims_check before insert or update on app.match_claims
  for each row execute function app.match_claims_check();

drop trigger if exists audit_match_claims on app.match_claims;
create trigger audit_match_claims after insert or update or delete on app.match_claims
  for each row execute function app.audit_private_row('matching');
insert into app.module_tables (table_name, module_key) values ('match_claims', 'matching')
  on conflict (table_name) do update set module_key = excluded.module_key;

-- For the read policy: an adult's claim, in a community the caller may read (answers false to anyone who may not).
create or replace function app.match_claim_readable(p_center uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.matching_can(p_center, 'view') and not app.person_is_minor(p_person)
$$;
revoke execute on function app.match_claim_readable(uuid, uuid) from public, anon;
grant execute on function app.match_claim_readable(uuid, uuid) to authenticated;

alter table app.match_claims enable row level security;
drop policy if exists match_claims_read on app.match_claims;
create policy match_claims_read on app.match_claims for select to authenticated
  using (center_id = any ((select app.matching_readable_centers())::uuid[]) and app.match_claim_readable(center_id, person_id));
drop policy if exists module_switch on app.match_claims;
create policy module_switch on app.match_claims as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])));
-- No write policies: only the functions below write.
revoke all on app.match_claims from public, anon, authenticated;
grant select on app.match_claims to authenticated;
grant all on app.match_claims to service_role;

-- ── Amounts: only to someone who also sees giving ────────────────────────────
create or replace function app.match_amounts_can(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app._matching_org_can(p_center)
     and app.module_enabled(p_center, 'giving')
     and (app._org_holds(p_center, auth.uid(), 'giving.view') or app._org_holds(p_center, auth.uid(), 'giving.manage'))
$$;
revoke execute on function app.match_amounts_can(uuid) from public, anon;
grant execute on function app.match_amounts_can(uuid) to authenticated;

-- ── The gifts a match may be asked for ───────────────────────────────────────
-- An adult's own gifts that went through, less refunds, without what paid a fee (a membership, a class, a store order), never an
-- opening balance or a history import: the rule DonorDelight's thank-yous use (0882), by person instead of household.
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
revoke execute on function app._match_gifts(uuid) from public, anon, authenticated;

-- The last day to ask for the match of a gift, by the program's own deadline rule (null: no deadline known or none).
create or replace function app._match_deadline(p_kind text, p_months int, p_month int, p_day int, p_gift date) returns date
language sql immutable set search_path = app, public, extensions as $$
  select case p_kind
           when 'end_of_gift_year' then make_date(extract(year from p_gift)::int, 12, 31)
           when 'months_after_gift' then (p_gift + make_interval(months => p_months))::date
           when 'date_next_year' then least(make_date(extract(year from p_gift)::int + 1, p_month, 1) + (p_day - 1),
                                           (make_date(extract(year from p_gift)::int + 1, p_month, 1) + interval '1 month - 1 day')::date)
           else null
         end
$$;
revoke execute on function app._match_deadline(text, int, int, int, date) from public, anon, authenticated;

-- ── The match somebody got and somebody else did not ask for ─────────────────
-- One row per gift, in the last two years, of an adult whose employer on file is linked to a program that has paid this
-- community at least once, with the claim on it if there is one. Callers keep the rows with no claim (the ones to catch).
create or replace function app._match_catch(p_center uuid)
returns table (person_id uuid, household_id uuid, program_id uuid, employer text, payment_id uuid, received_on date,
               donation_cents bigint, deadline_on date, claim_id uuid, claim_state text, claim_state_at timestamptz)
language sql stable security definer set search_path = app, public, extensions as $$
  with linked as (
    select l.person_id, e.employer_name as employer, g.id as program_id, g.min_gift_cents,
           g.deadline_kind, g.deadline_months, g.deadline_month, g.deadline_day
      from app.person_match_programs l
      join app.person_match_employers e on e.person_id = l.person_id and e.withdrawn_at is null and e.employer_name is not null
      cross join lateral app._match_program_current(l.program_id) g
     where l.center_id = p_center and g.status = 'active' and g.gift_match and not app.person_is_minor(l.person_id)
  ),
  proven as (
    select g.id as program_id
      from app.match_claims c cross join lateral app._match_program_current(c.program_id) g
     where c.center_id = p_center and c.state = 'received'
     group by g.id
  )
  select ln.person_id, gi.household_id, ln.program_id, ln.employer, gi.payment_id, gi.received_on, gi.donation_cents,
         app._match_deadline(ln.deadline_kind, ln.deadline_months, ln.deadline_month, ln.deadline_day, gi.received_on),
         c.id, c.state, c.state_at
    from linked ln
    join proven pr on pr.program_id = ln.program_id
    join app._match_gifts(p_center) gi on gi.person_id = ln.person_id
         and (ln.min_gift_cents is null or gi.donation_cents >= ln.min_gift_cents)
         and gi.received_on > app._match_today(p_center) - 730
    left join lateral (select x.id, x.state, x.state_at from app.match_claims x
                        where x.payment_id = gi.payment_id and x.center_id = p_center
                        order by x.created_at desc limit 1) c on true
$$;
revoke execute on function app._match_catch(uuid) from public, anon, authenticated;

-- ── Writing (matching.manage) ────────────────────────────────────────────────
create or replace function app._match_manager_or_raise(p_center uuid) returns void
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or not app.org_private_can(p_center, 'matching.manage') then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
end $$;
revoke execute on function app._match_manager_or_raise(uuid) from public, anon, authenticated;

create or replace function app.ask_match_claims(p_center uuid, p_person uuid, p_program uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_program uuid; v_note text; v_n int;
begin
  perform app._match_manager_or_raise(p_center);
  select g.id into v_program from app._match_program_current(p_program) g;
  if v_program is null then raise exception 'That employer program was not found.' using errcode = '22023'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note is too long (500 characters at most).' using errcode = '22023';
  end if;
  insert into app.match_claims (center_id, person_id, program_id, payment_id, state, state_by, created_by, note)
  select p_center, c.person_id, c.program_id, c.payment_id, 'asked', auth.uid(), auth.uid(), v_note
    from app._match_catch(p_center) c
   where c.person_id = p_person and c.program_id = v_program and c.claim_id is null
     and (c.deadline_on is null or c.deadline_on >= app._match_today(p_center))
  on conflict (payment_id, program_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nothing is left to ask for: this person has no gift that can still be claimed, or each one already has a claim.'
      using errcode = '22023';
  end if;
  return jsonb_build_object('asked', v_n);
end $$;

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

-- Records a claim the staff already know about: the first match a program ever paid this community (nothing is proven until one
-- is received), or a request a member told the office they made. For the person's confirmed employer program (0767), on one of
-- their own gifts.
create or replace function app.record_match_claim(p_center uuid, p_person uuid, p_payment uuid, p_state text default 'received',
                                                  p_received_on date default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_program uuid; v_note text; v_id uuid; v_today date; v_day date;
begin
  perform app._match_manager_or_raise(p_center);
  if p_state is null or p_state not in ('asked', 'requested', 'verified', 'received') then
    raise exception 'A claim you record starts as asked, requested, verified or received.' using errcode = '22023';
  end if;
  if p_received_on is not null and p_state <> 'received' then
    raise exception 'A day of receipt only goes with a claim that was received.' using errcode = '22023';
  end if;
  v_today := app._match_today(p_center);
  v_day := case when p_state = 'received' then coalesce(p_received_on, v_today) end;
  if v_day > v_today then raise exception 'The match cannot have been received in the future.' using errcode = '22023'; end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note is too long (500 characters at most).' using errcode = '22023';
  end if;
  select g.id into v_program
    from app.person_match_programs l cross join lateral app._match_program_current(l.program_id) g
   where l.person_id = p_person and l.center_id = p_center;
  if v_program is null then
    raise exception 'Confirm this person''s employer first: choose its program under Employers on file.' using errcode = '22023';
  end if;
  begin
    insert into app.match_claims (center_id, person_id, program_id, payment_id, state, state_by, created_by, received_on, note)
    values (p_center, p_person, v_program, p_payment, p_state, auth.uid(), auth.uid(), v_day, v_note)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This gift already has a claim.' using errcode = '23505';
  end;
  return jsonb_build_object('id', v_id, 'state', p_state);
end $$;

revoke execute on function app.ask_match_claims(uuid, uuid, uuid, text), app.set_match_claim_state(uuid, uuid, text, text),
  app.record_match_claim(uuid, uuid, uuid, text, date, text) from public, anon;
grant execute on function app.ask_match_claims(uuid, uuid, uuid, text), app.set_match_claim_state(uuid, uuid, text, text),
  app.record_match_claim(uuid, uuid, uuid, text, date, text) to authenticated, service_role;
