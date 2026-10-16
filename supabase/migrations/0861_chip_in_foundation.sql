-- 0861 · The optional Chip In, foundation: its settings, its ledger and the Weaver team's control of both
-- (docs/PAYMENT_ADDONS.md §6.3, §6.4, §6.6, §6.7, §11.2; the owner approved the design on 2026-10-15, "go with recommendations").
--
-- This is the first of two migrations of build slice 1 (the database); 0862 adds fee-cover and the checkout, and 0863 seeds JSH.
-- It comes first because 0862's checkout and worker functions reserve and collect the rows created here.
--
-- What this adds (all of it inert: nothing is asked of any member, no payment changes):
--
--   app.chip_in_settings          one row per organization; no row, or asking = false, means NOTHING is asked. Written only by
--                                 app.platform_set_chip_in (a Weaver platform admin, a reason, no fresh 2FA code: owner rule of
--                                 2026-10-14) and, once, by the JSH seed (0863) through the same internal writer.
--   app.chip_in_ledger            one row per Chip In: who (the paying person's login), which calendar year (in the organization's
--                                 time zone), which mode, how much, and where it stands (reserved, collected, released, refunded).
--                                 This is what the yearly limit per account is counted from.
--   app.my_chip_in_offer          what a signed-in adult may be asked: whether to ask, the suggestions that still fit, the amount
--                                 left, used and the limit. Only their own rows.
--   app.chip_in_summary           the organization's read-only view of the platform's setting (no reason, no names).
--   app.chip_in_overview          the platform team's figures for one organization (no names; test mode counted apart).
--   app.worker_release_chip_ins   the safety-net sweep for reservations that can no longer be paid.
--   app.chip_in_year / chip_in_used_cents / chip_in_lock
--                                 the year in the organization's time zone, the amount used, and the per-account advisory lock
--                                 the checkout takes so two checkouts started at once cannot both fit.
--
-- The rules this writes down:
--   * No fixed cap anywhere. The yearly limit per account is a per-organization setting, $1.00 to $1,000.00 (so a typo cannot ask
--     for $10,000), with one to four suggested amounts, ascending, each at least $1.00 and at most the limit.
--   * Asking needs a limit, at least one suggestion and asking = true. Until a platform admin saves them, nothing is asked.
--   * What counts toward the limit: the same account, the same calendar year and the same mode. A COLLECTED row counts at
--     chip_in_cents - refunded_cents (a refunded Chip In gives its allowance back); a RESERVED row counts only until its
--     expires_at (so an abandoned checkout, or a lost webhook, can never block a member for long). A test-mode row never counts
--     toward a live allowance; within test mode the limit is enforced among test rows, so the sandbox can prove it.
--   * The ledger is read by the paying person, the adults of the household it was paid for, and platform admins. Never by the
--     organization's staff (not even through giving.view): has_permission passes for a platform admin and for staff roles, so the
--     policy names the person and the household instead.
--
-- Nothing here changes a payment, a pledge, an allocation or a posting.
set client_min_messages = warning;

-- ── Suggested amounts: valid for a limit ─────────────────────────────────────
-- Cents. At most four, each $1.00 or more, none above the limit (or $1,000.00 while no limit is set), strictly ascending.
create or replace function app.chip_in_suggestions_ok(p_limit bigint, p_suggested bigint[]) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select p_suggested is not null and cardinality(p_suggested) <= 4
     and not exists (
       select 1
         from (select s.v, lag(s.v) over (order by s.i) as prev
                 from unnest(p_suggested) with ordinality as s(v, i)) x
        where x.v is null or x.v < 100 or x.v > coalesce(p_limit, 100000) or (x.prev is not null and x.v <= x.prev))
$$;

-- ── The platform's setting for one organization ──────────────────────────────
create table if not exists app.chip_in_settings (
  center_id          uuid primary key references app.centers(id) on delete cascade,
  asking             boolean not null default false,
  yearly_limit_cents bigint check (yearly_limit_cents is null or yearly_limit_cents between 100 and 100000),
  suggested_cents    bigint[] not null default '{}',
  reason             text check (reason is null or char_length(reason) <= 500),
  updated_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chip_in_settings_suggestions check (app.chip_in_suggestions_ok(yearly_limit_cents, suggested_cents)),
  constraint chip_in_settings_asking_needs_setup check (not asking or (yearly_limit_cents is not null and cardinality(suggested_cents) >= 1))
);
comment on table app.chip_in_settings is
  'The Weaver team''s setting for one organization''s optional Chip In (docs/PAYMENT_ADDONS.md §6.3). No row, or asking = false, or no limit: nothing is asked. Written only by app.platform_set_chip_in and the JSH seed (app._chip_in_write).';

-- ── The ledger: one row per Chip In ──────────────────────────────────────────
create table if not exists app.chip_in_ledger (
  id                    uuid primary key default gen_random_uuid(),
  center_id             uuid not null references app.centers(id) on delete cascade,
  household_id          uuid references app.households(id),
  account_person_id     uuid not null references app.people(id),
  calendar_year         integer not null check (calendar_year between 2000 and 2200),
  checkout_id           uuid not null unique references app.payment_checkouts(id) on delete cascade,
  payment_id            uuid references app.payments(id),
  mode                  text not null check (mode in ('test','live')),
  chip_in_cents         bigint not null check (chip_in_cents > 0),
  application_fee_cents bigint not null default 0 check (application_fee_cents >= 0 and application_fee_cents <= chip_in_cents),
  refunded_cents        bigint not null default 0 check (refunded_cents >= 0 and refunded_cents <= chip_in_cents),
  status                text not null default 'reserved' check (status in ('reserved','collected','released','refunded')),
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now(),
  collected_at          timestamptz,
  released_at           timestamptz,
  updated_at            timestamptz not null default now(),
  constraint chip_in_ledger_payment_when_collected check ((payment_id is not null) = (status in ('collected','refunded')))
);
comment on table app.chip_in_ledger is
  'One row per Chip In (docs/PAYMENT_ADDONS.md §6.4): the paying person''s login, the calendar year in the organization''s time zone, the mode and the amount. The yearly limit per account is counted here. A reserved row counts only until expires_at. Written only by the checkout and worker functions; read by the paying person, the adults of the household and platform admins, never by the organization''s staff.';
comment on column app.chip_in_ledger.expires_at is
  'A reserved row counts toward the yearly limit only until this moment (a card checkout: 26 hours; a bank-debit checkout: 14 days), so an abandoned checkout or a lost provider event cannot block a member for long. A collected row has no expiry.';
create index if not exists chip_in_ledger_account_idx on app.chip_in_ledger (center_id, account_person_id, calendar_year, mode);
create index if not exists chip_in_ledger_household_idx on app.chip_in_ledger (household_id) where household_id is not null;
create index if not exists chip_in_ledger_reserved_idx on app.chip_in_ledger (expires_at) where status = 'reserved';

-- A Chip In record keeps its account, year, mode and amount, only moves forward (reserved to collected or released, released to
-- collected when the money arrives after all, collected to refunded) and never gets a refund taken back.
create or replace function app.chip_in_ledger_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if new.center_id is distinct from old.center_id or new.household_id is distinct from old.household_id
     or new.account_person_id is distinct from old.account_person_id or new.calendar_year is distinct from old.calendar_year
     or new.checkout_id is distinct from old.checkout_id or new.mode is distinct from old.mode
     or new.chip_in_cents is distinct from old.chip_in_cents then
    raise exception 'A Chip In record keeps its account, year, mode and amount.' using errcode = '22023';
  end if;
  if new.refunded_cents < old.refunded_cents then
    raise exception 'A refunded Chip In cannot be taken back.' using errcode = '22023';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'reserved' and new.status in ('collected','released'))
    or (old.status = 'released' and new.status = 'collected')
    or (old.status = 'collected' and new.status = 'refunded')) then
    raise exception 'A Chip In cannot change from % to %.', old.status, new.status using errcode = '22023';
  end if;
  if new.status = 'refunded' and new.refunded_cents <> new.chip_in_cents then
    raise exception 'A Chip In is marked refunded only when all of it was refunded.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists chip_in_ledger_guard on app.chip_in_ledger;
create trigger chip_in_ledger_guard before update on app.chip_in_ledger
  for each row execute function app.chip_in_ledger_guard();

drop trigger if exists touch_chip_in_settings on app.chip_in_settings;
create trigger touch_chip_in_settings before update on app.chip_in_settings
  for each row execute function app.touch_updated_at();

-- ── Audit and modules ────────────────────────────────────────────────────────
-- Both tables belong to Giving. The audit rows carry the organization's id (as payments and payment_checkouts do), so the
-- organization's audit readers can see that a setting changed and why; the Weaver team's reason is written to be read by them.
insert into app.module_tables (table_name, module_key) values ('chip_in_settings', 'giving'), ('chip_in_ledger', 'giving')
on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_chip_in_settings on app.chip_in_settings;
create trigger audit_chip_in_settings after insert or update or delete on app.chip_in_settings
  for each row execute function app.audit_row('center_id');
drop trigger if exists audit_chip_in_ledger on app.chip_in_ledger;
create trigger audit_chip_in_ledger after insert or update or delete on app.chip_in_ledger
  for each row execute function app.audit_row();

-- ── Who can read what (RLS) ──────────────────────────────────────────────────
alter table app.chip_in_settings enable row level security;
alter table app.chip_in_ledger enable row level security;

-- The setting: platform admins only. The organization reads a summary through app.chip_in_summary.
drop policy if exists chip_in_settings_read on app.chip_in_settings;
create policy chip_in_settings_read on app.chip_in_settings for select to authenticated
  using ((select app.is_platform_admin()));

-- The ledger: the paying person, the adults of the household it was paid for, platform admins. NOT has_permission: that passes
-- for the organization's staff roles, and the organization's staff are not to read a member's Chip Ins.
drop policy if exists chip_in_ledger_read on app.chip_in_ledger;
create policy chip_in_ledger_read on app.chip_in_ledger for select to authenticated
  using ((select app.is_platform_admin())
         or account_person_id = (select app.my_person_id(center_id))
         or (household_id is not null and app.adult_of_household(center_id, household_id)));

do $$
declare t text; v_qual text := '(select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers(''giving''))::uuid[]))';
begin
  foreach t in array array['chip_in_settings','chip_in_ledger'] loop
    execute format('drop policy if exists module_switch on app.%I', t);
    execute format('create policy module_switch on app.%I as restrictive for all to public using (%s) with check (%s)', t, v_qual, v_qual);
  end loop;
end $$;

-- Read-only over the API; every write goes through the functions below.
revoke all on app.chip_in_settings, app.chip_in_ledger from public, anon, authenticated, connect_worker;
grant select on app.chip_in_settings, app.chip_in_ledger to authenticated;
grant all on app.chip_in_settings, app.chip_in_ledger to service_role;

-- ── The calendar year, the amount used and the lock ──────────────────────────
-- The year the checkout STARTED, in the organization's time zone: 23:30 on 31 December in Houston is still that year, whatever
-- UTC says.
create or replace function app.chip_in_year(p_center uuid, p_at timestamptz default now()) returns integer
language sql stable security definer set search_path = app, public, extensions as $$
  select extract(year from p_at at time zone coalesce((select nullif(btrim(c.time_zone), '') from app.centers c where c.id = p_center), 'America/Chicago'))::integer
$$;

-- What an account has used of its yearly limit, in one mode. Collected rows count at amount minus what was refunded; reserved
-- rows only until they expire; released and fully refunded rows not at all.
create or replace function app.chip_in_used_cents(p_center uuid, p_person uuid, p_year integer, p_mode text) returns bigint
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(sum(l.chip_in_cents - l.refunded_cents), 0)::bigint
    from app.chip_in_ledger l
   where l.center_id = p_center and l.account_person_id = p_person and l.calendar_year = p_year and l.mode = p_mode
     and (l.status = 'collected' or (l.status = 'reserved' and l.expires_at > now()))
$$;

-- Two checkouts of one account in one year are serialised: the second waits for the first to commit, then counts again and sees
-- the first's reserved row. Held until the end of the transaction. Taken by app.create_checkout (0862).
create or replace function app.chip_in_lock(p_center uuid, p_person uuid, p_year integer) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('chip_in:' || p_center::text || ':' || p_person::text || ':' || p_year::text, 0));
end $$;

-- The state of one account's allowance, for the functions below and for the checkout: {configured, asking, calendar_year,
-- yearly_limit_cents, used_cents, left_cents, suggested_cents (those that still fit)}.
create or replace function app._chip_in_state(p_center uuid, p_person uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.chip_in_settings; v_year integer := app.chip_in_year(p_center); v_used bigint; v_left bigint;
begin
  select * into s from app.chip_in_settings where center_id = p_center;
  if s.center_id is null or s.yearly_limit_cents is null then
    return jsonb_build_object('configured', false, 'asking', false, 'calendar_year', v_year);
  end if;
  v_used := app.chip_in_used_cents(p_center, p_person, v_year, p_mode);
  v_left := greatest(s.yearly_limit_cents - v_used, 0);
  return jsonb_build_object(
    'configured', true, 'asking', s.asking, 'calendar_year', v_year,
    'yearly_limit_cents', s.yearly_limit_cents, 'used_cents', v_used, 'left_cents', v_left,
    'suggested_cents', coalesce((select jsonb_agg(x order by x) from unnest(s.suggested_cents) x where x <= v_left), '[]'::jsonb));
end $$;

-- ── What a signed-in adult may be asked ──────────────────────────────────────
-- {ask, reason, mode, calendar_year, yearly_limit_cents, used_cents, left_cents, suggested_cents, min_other_cents, max_other_cents}.
-- ask = false carries a reason code and nothing else the member should not learn: switched_off (nothing is asked of this
-- organization, whatever the cause), limit_reached, not_adult, no_account, not_usd, no_stripe, paused. At the limit the app draws no
-- Chip In block and says nothing about it. Only the caller's own rows are ever read.
create or replace function app.my_chip_in_offer(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; v_person uuid; v_mode text; v_state jsonb; v_left bigint; cp app.center_payment_processors;
        v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to pay.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  v_person := app.my_person_id(p_center);
  v_mode := app.payment_api_mode(p_center, 'stripe');
  v_out := jsonb_build_object('ask', false, 'mode', v_mode);
  if v_person is null then return v_out || jsonb_build_object('reason', 'no_account'); end if;
  v_state := app._chip_in_state(p_center, v_person, v_mode);
  if not coalesce((v_state->>'configured')::boolean, false) or not coalesce((v_state->>'asking')::boolean, false) then
    return v_out || jsonb_build_object('reason', 'switched_off', 'calendar_year', (v_state->>'calendar_year')::integer);
  end if;
  if not app.i_am_adult(p_center) then return v_out || jsonb_build_object('reason', 'not_adult'); end if;
  if upper(coalesce(c.currency, 'USD')) <> 'USD' then return v_out || jsonb_build_object('reason', 'not_usd'); end if;
  select * into cp from app.center_payment_processors
   where center_id = p_center and processor = 'stripe' and status in ('test','live');
  if cp.center_id is null then return v_out || jsonb_build_object('reason', 'no_stripe'); end if;
  if app.payment_plugin_is_paused(p_center, 'card') then return v_out || jsonb_build_object('reason', 'paused'); end if;
  v_left := (v_state->>'left_cents')::bigint;
  v_out := v_out || jsonb_build_object('calendar_year', (v_state->>'calendar_year')::integer,
    'yearly_limit_cents', (v_state->>'yearly_limit_cents')::bigint, 'used_cents', (v_state->>'used_cents')::bigint,
    'left_cents', v_left);
  if v_left < 100 then return v_out || jsonb_build_object('reason', 'limit_reached', 'suggested_cents', '[]'::jsonb); end if;
  return v_out || jsonb_build_object('ask', true, 'reason', null, 'suggested_cents', v_state->'suggested_cents',
    'min_other_cents', 100, 'max_other_cents', v_left);
end $$;

-- ── The Weaver team's control ────────────────────────────────────────────────
-- Validates and writes one organization's setting; the caller has already checked who may and set the audit reason. Used by
-- platform_set_chip_in and by the JSH seed (0863), so the seed is written, audited and validated exactly like a platform
-- admin's save. Returns {center_id, changed, asking, yearly_limit_cents, suggested_cents, updated_at}. Saving the same values again
-- changes nothing and writes no audit row.
create or replace function app._chip_in_write(p_center uuid, p_limit bigint, p_suggested bigint[], p_asking boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.chip_in_settings; v_sug bigint[] := coalesce(p_suggested, '{}'); v_asking boolean := coalesce(p_asking, false);
        v_changed boolean := true;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.' using errcode = '22023';
  end if;
  if p_limit is not null and (p_limit < 100 or p_limit > 100000) then
    raise exception 'The yearly limit per account is between $1.00 and $1,000.00.' using errcode = '22023';
  end if;
  if cardinality(v_sug) > 4 then raise exception 'Suggest at most four amounts.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_sug) x where x is null or x < 100) then
    raise exception 'Each suggested amount is at least $1.00.' using errcode = '22023';
  end if;
  if p_limit is not null and exists (select 1 from unnest(v_sug) x where x > p_limit) then
    raise exception 'A suggested amount cannot be more than the yearly limit.' using errcode = '22023';
  end if;
  if p_limit is null and exists (select 1 from unnest(v_sug) x where x > 100000) then
    raise exception 'A suggested amount cannot be more than $1,000.00.' using errcode = '22023';
  end if;
  if not app.chip_in_suggestions_ok(p_limit, v_sug) then
    raise exception 'List the suggested amounts from the smallest to the largest, each different.' using errcode = '22023';
  end if;
  if v_asking and p_limit is null then
    raise exception 'Set the yearly limit per account before asking members for a Chip In.' using errcode = '22023';
  end if;
  if v_asking and cardinality(v_sug) = 0 then
    raise exception 'Add at least one suggested amount before asking members for a Chip In.' using errcode = '22023';
  end if;
  select * into s from app.chip_in_settings where center_id = p_center for update;
  if s.center_id is not null and s.asking = v_asking and s.yearly_limit_cents is not distinct from p_limit and s.suggested_cents = v_sug then
    v_changed := false;
  else
    insert into app.chip_in_settings (center_id, asking, yearly_limit_cents, suggested_cents, reason, updated_by)
    values (p_center, v_asking, p_limit, v_sug, left(app.audit_clean_reason(p_reason), 500), auth.uid())
    on conflict (center_id) do update
       set asking = excluded.asking, yearly_limit_cents = excluded.yearly_limit_cents, suggested_cents = excluded.suggested_cents,
           reason = excluded.reason, updated_by = excluded.updated_by;
  end if;
  select * into s from app.chip_in_settings where center_id = p_center;
  return jsonb_build_object('center_id', s.center_id, 'changed', v_changed, 'asking', s.asking,
                            'yearly_limit_cents', s.yearly_limit_cents, 'suggested_cents', to_jsonb(s.suggested_cents),
                            'updated_at', s.updated_at);
end $$;

-- A platform admin sets an organization's yearly limit per account, the suggested amounts and whether members are asked. A
-- reason is required and is kept in the audit log with who, when and the old and new values. No fresh 2FA code (owner rule of
-- 2026-10-14: that is asked only for creating a sandbox, approving go-live, promoting and granting a module).
create or replace function app.platform_set_chip_in(p_center uuid, p_limit_cents bigint, p_suggested_cents bigint[], p_asking boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Weaver team can change the Chip In settings.' using errcode = '42501';
  end if;
  perform app.payments_require_reason(p_reason, 'change the Chip In settings');
  return app._chip_in_write(p_center, p_limit_cents, p_suggested_cents, p_asking, p_reason);
end $$;

-- What the organization sees of the platform's setting (Settings › Payments, read-only): {configured, asking, yearly_limit_cents,
-- suggested_cents, updated_at}. No reason and no names. Anyone who may see the payment settings.
create or replace function app.chip_in_summary(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare s app.chip_in_settings;
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.payments_can_view(p_center) then
    raise exception 'Seeing the Chip In summary needs integrations.view, giving.view or the organization owner.' using errcode = '42501';
  end if;
  select * into s from app.chip_in_settings where center_id = p_center;
  return jsonb_build_object(
    'configured', s.center_id is not null and s.yearly_limit_cents is not null,
    'asking', coalesce(s.asking, false),
    'yearly_limit_cents', s.yearly_limit_cents,
    'suggested_cents', to_jsonb(coalesce(s.suggested_cents, '{}'::bigint[])),
    'updated_at', s.updated_at);
end $$;

-- The platform team's figures for one organization and one calendar year (default: this year in its time zone), live and test
-- apart, with no names: accounts that chipped in, collected, refunded, in flight (reserved and not expired) and how many accounts
-- have used their whole limit.
create or replace function app.chip_in_overview(p_center uuid, p_year integer default null) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_year integer; s app.chip_in_settings; v_live jsonb; v_test jsonb;
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Weaver team can see the Chip In figures.' using errcode = '42501';
  end if;
  if not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.' using errcode = '22023';
  end if;
  v_year := coalesce(p_year, app.chip_in_year(p_center));
  select * into s from app.chip_in_settings where center_id = p_center;
  select jsonb_object_agg(m.mode, jsonb_build_object(
           'accounts', coalesce(x.accounts, 0), 'collected_cents', coalesce(x.collected, 0), 'refunded_cents', coalesce(x.refunded, 0),
           'in_flight_cents', coalesce(x.in_flight, 0), 'accounts_at_limit', coalesce(x.at_limit, 0)))
    into v_live
    from (values ('live'), ('test')) m(mode)
    left join lateral (
      select count(distinct a.account_person_id) filter (where a.collected > 0) as accounts,
             sum(a.collected) as collected, sum(a.refunded) as refunded, sum(a.in_flight) as in_flight,
             count(*) filter (where s.yearly_limit_cents is not null
                                and coalesce(a.collected, 0) - coalesce(a.refunded, 0) + coalesce(a.in_flight, 0) >= s.yearly_limit_cents) as at_limit
        from (select l.account_person_id,
                     sum(l.chip_in_cents) filter (where l.status in ('collected','refunded')) as collected,
                     sum(l.refunded_cents) filter (where l.status in ('collected','refunded')) as refunded,
                     sum(l.chip_in_cents) filter (where l.status = 'reserved' and l.expires_at > now()) as in_flight
                from app.chip_in_ledger l
               where l.center_id = p_center and l.calendar_year = v_year and l.mode = m.mode
               group by l.account_person_id) a
    ) x on true;
  return jsonb_build_object('center_id', p_center, 'calendar_year', v_year, 'asking', coalesce(s.asking, false),
                            'yearly_limit_cents', s.yearly_limit_cents, 'live', v_live->'live', 'test', v_live->'test');
end $$;

-- ── Collecting and releasing a reservation ───────────────────────────────────
-- Used by the worker functions of 0862. A payment that arrives for a released reservation (a bank debit that settled after the
-- sweep gave up on it) is collected all the same: the money was taken, so it counts.
create or replace function app._chip_in_release(p_checkout uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare n integer;
begin
  update app.chip_in_ledger set status = 'released', released_at = now() where checkout_id = p_checkout and status = 'reserved';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function app._chip_in_collect(p_checkout uuid, p_payment uuid, p_application_fee bigint) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare n integer;
begin
  update app.chip_in_ledger
     set status = 'collected', payment_id = p_payment, collected_at = now(), released_at = null,
         application_fee_cents = least(greatest(coalesce(p_application_fee, 0), 0), chip_in_cents)
   where checkout_id = p_checkout and status in ('reserved','released');
  get diagnostics n = row_count;
  return n;
end $$;

-- The safety net (the daily sweep): a reservation that can no longer be paid stops counting. It never is the only thing that
-- frees an allowance (a reserved row stops counting at expires_at by itself); it tidies the ledger and its audit trail.
create or replace function app.worker_release_chip_ins() returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare n integer;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.set_audit_context('Background service: released Chip In reservations that can no longer be paid');
  update app.chip_in_ledger l
     set status = 'released', released_at = now()
   where l.status = 'reserved'
     and (l.expires_at <= now()
          or exists (select 1 from app.payment_checkouts k where k.id = l.checkout_id and k.status in ('failed','cancelled','expired')));
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Execute rights ───────────────────────────────────────────────────────────
-- Internal helpers: nobody calls them over the API. The checkout, worker and seed functions (security definer) do.
revoke execute on function app.chip_in_year(uuid, timestamptz), app.chip_in_used_cents(uuid, uuid, integer, text),
  app.chip_in_lock(uuid, uuid, integer), app._chip_in_state(uuid, uuid, text),
  app._chip_in_write(uuid, bigint, bigint[], boolean, text), app._chip_in_release(uuid), app._chip_in_collect(uuid, uuid, bigint),
  app.chip_in_ledger_guard()
  from public, anon, authenticated, service_role;
-- What the apps and the portal call.
revoke execute on function app.my_chip_in_offer(uuid), app.platform_set_chip_in(uuid, bigint, bigint[], boolean, text),
  app.chip_in_summary(uuid), app.chip_in_overview(uuid, integer) from public, anon;
grant execute on function app.my_chip_in_offer(uuid), app.platform_set_chip_in(uuid, bigint, bigint[], boolean, text),
  app.chip_in_summary(uuid), app.chip_in_overview(uuid, integer) to authenticated, service_role;
-- The background service.
revoke execute on function app.worker_release_chip_ins() from public, anon, authenticated, service_role;
grant execute on function app.worker_release_chip_ins() to connect_worker;

-- ── A demo or sandbox clear leaves the platform's setting alone ──────────────
-- 0785's list plus chip_in_settings (the ledger is cleared with the payments it belongs to). 0862 adds payment_fee_rates.
create or replace function app.demo_keep_tables() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    -- the organization, its people in charge and its agreements
    'centers','center_owners','role_grants','org_agreements','org_profiles','org_leaders','org_documents',
    'center_entitlements','center_modules','number_sequences','support_grants',
    -- onboarding progress and go-live
    'center_setup_steps','center_attestations','golive_requests','golive_approvals','sandbox_codes','sandbox_expiry_notices','center_demo_state',
    -- connections, secrets and what the providers returned
    'integration_connections','integration_secrets','secret_access_log','oauth_states','webhook_events',
    'center_payment_processors','payment_processor_tests','paypal_email_verifications','center_payment_plugins',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    -- templates and documents (Setup stage 2), saved import mappings and the organization's own pick-lists
    'legal_documents','message_templates','receipt_templates','import_mappings','dietary_options',
    -- history that is never deleted
    'audit_log','jobs',
    -- 0785: what a demo community's reset puts back
    'demo_qbo_links',
    -- 0861: the Weaver team's Chip In setting for the organization
    'chip_in_settings'
  ]::text[]
$$;
