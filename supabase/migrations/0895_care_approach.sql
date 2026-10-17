-- 0895 · DonorDelight slice 7: who to approach, held behind the touch balance (docs/DONORDELIGHT.md sections 5.10 and 7, docs/GIVING_INSIGHTS.md section 4 and 5; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   A ranked list of the households an organization could ask, each with the reasons, built only from the organization's OWN records. It does not ask anyone: it
--   orders a list for a person to read. A household is READY for an ask only when nothing holds it; otherwise it is HELD, with the reason in words (visible), or not shown at all
--   (a household that asked not to be asked is counted, never explained). The holds, in this order:
--       pledge   behind on a pledge by more than 60 days: remind first, do not ask
--       thank    a gift of theirs has not been thanked yet (the thank-you tracker, 0881): thank first
--       rest     asked within the rest period (default 60 days): the household rests
--       balance  fewer no-ask touches than the touch balance since the last ask (default 3, editable): care first, ask last. Never asked: the no-ask touches of the last 12 months
--       quiet    inside one of the community's quiet periods (a fast, a mourning period, a season): asks wait
--   Not shown: do-not-ask (with or without a rest-until date), set on the Care profile (0761); and a household that has never given (it is invited, not asked).
--   Score (visible, additive; the same function returns the score and its signals, so the explanation cannot disagree with the number): years of the last five with a gift,
--   how recent the last gift is, taking part in the last 12 months (adults who checked in or served), and all gifts thanked. The weights are the organization's to change.
--   RANGE: the median and the highest of the household's OWN gifts of the last five years (and, with a fund chosen, to that fund), only with three or more gifts, only with
--   amounts access (care + giving.view/manage); never an amount for anyone else, never anything from outside the organization (no wealth screening, no property, no income).
--   Respect (docs section 7, carried unchanged): no one under 18 (the household card lists adults only; a minor payer's gift never counts, 0882), no religion, tradition, caste,
--   ethnicity, language, gender, age, health or occupation signal; nothing is sent or asked automatically.
--   app.care_approach_settings   per community: the list is OFF until a care manager reads what it uses and turns it on; the touch balance; the rest days; the weights
--   app.care_quiet_periods       the community's quiet periods as data: a name, from and to, optionally every year
--   app.care_approach(center, fund, limit)        care.own and up: own households only for care.own; care.view/manage every household; logged
--   app.care_approach_household(household)        the same answer for one household (the Care card); logged
--   Audit: app.audit_private_row (0758): who, when, which columns, never the words.
set client_min_messages = warning;

create table if not exists app.care_approach_settings (
  center_id     uuid primary key references app.centers(id) on delete cascade,
  enabled       boolean not null default false,
  touch_balance integer not null default 3 check (touch_balance between 1 and 10),
  rest_days     integer not null default 60 check (rest_days between 0 and 365),
  weights       jsonb not null default '{}'::jsonb check (jsonb_typeof(weights) = 'object'),
  enabled_at    timestamptz,
  enabled_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);
comment on table app.care_approach_settings is
  'DonorDelight (0895): whether "Who to approach" is on (off until a care manager turns it on), the touch balance, the rest days and the score weights. Written only by app.save_care_approach_settings (care.manage).';

create table if not exists app.care_quiet_periods (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  starts_on   date not null,
  ends_on     date not null,
  yearly      boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  constraint care_quiet_periods_order check (ends_on >= starts_on and ends_on - starts_on < 366)
);
create index if not exists care_quiet_periods_center_idx on app.care_quiet_periods (center_id) where archived_at is null;
comment on table app.care_quiet_periods is
  'DonorDelight (0895): the community''s quiet periods (a fast, a mourning period, a season), as data. Asks wait inside one. Written only by app.save_care_quiet_period (care.manage); archived, never deleted.';

drop trigger if exists audit_care_approach_settings on app.care_approach_settings;
create trigger audit_care_approach_settings after insert or update or delete on app.care_approach_settings
  for each row execute function app.audit_private_row('care', 'center_id');
drop trigger if exists audit_care_quiet_periods on app.care_quiet_periods;
create trigger audit_care_quiet_periods after insert or update or delete on app.care_quiet_periods
  for each row execute function app.audit_private_row('care');
insert into app.module_tables (table_name, module_key) values ('care_approach_settings', 'care'), ('care_quiet_periods', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.care_approach_settings enable row level security;
alter table app.care_quiet_periods enable row level security;
drop policy if exists care_approach_settings_read on app.care_approach_settings;
create policy care_approach_settings_read on app.care_approach_settings for select to authenticated using (app.care_can(center_id, 'own'));
drop policy if exists care_quiet_periods_read on app.care_quiet_periods;
create policy care_quiet_periods_read on app.care_quiet_periods for select to authenticated using (app.care_can(center_id, 'own'));
drop policy if exists module_switch on app.care_approach_settings;
create policy module_switch on app.care_approach_settings as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
drop policy if exists module_switch on app.care_quiet_periods;
create policy module_switch on app.care_quiet_periods as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_approach_settings, app.care_quiet_periods from public, anon, authenticated;
grant select on app.care_approach_settings, app.care_quiet_periods to authenticated;
grant all on app.care_approach_settings, app.care_quiet_periods to service_role;

-- ── The weights ───────────────────────────────────────────────────────────────
create or replace function app._care_approach_default_weights() returns jsonb
language sql immutable as $$
  select jsonb_build_object('years_per', 8, 'years_max', 40, 'recent_12', 15, 'recent_24', 10, 'recent_36', 5, 'took_part', 8, 'well_thanked', 4)
$$;
create or replace function app._care_approach_weights(p_saved jsonb) returns jsonb
language sql immutable as $$
  select app._care_approach_default_weights() || coalesce(p_saved, '{}'::jsonb)
$$;
revoke execute on function app._care_approach_default_weights(), app._care_approach_weights(jsonb) from public, anon, authenticated;

-- ── Quiet periods ─────────────────────────────────────────────────────────────
-- Is this day inside the period (a yearly one repeats every year, and may cross the new year)? And the day the period it is in ends.
create or replace function app._care_quiet_covers(p_day date, p_from date, p_to date, p_yearly boolean) returns date
language plpgsql immutable as $$
declare v_md integer := extract(month from p_day)::int * 100 + extract(day from p_day)::int;
  v_s integer := extract(month from p_from)::int * 100 + extract(day from p_from)::int;
  v_e integer := extract(month from p_to)::int * 100 + extract(day from p_to)::int;
  v_y integer; v_m integer; v_d integer;
begin
  if not p_yearly then
    return case when p_day between p_from and p_to then p_to end;
  end if;
  if v_s <= v_e then
    if v_md < v_s or v_md > v_e then return null; end if;
    v_y := extract(year from p_day)::int;
  else
    if v_md < v_s and v_md > v_e then return null; end if;
    v_y := extract(year from p_day)::int + case when v_md >= v_s then 1 else 0 end;
  end if;
  v_m := extract(month from p_to)::int;
  v_d := least(extract(day from p_to)::int, extract(day from (make_date(v_y, v_m, 1) + interval '1 month - 1 day'))::int);
  return make_date(v_y, v_m, v_d);
end $$;
revoke execute on function app._care_quiet_covers(date, date, date, boolean) from public, anon, authenticated;

create or replace function app.save_care_quiet_period(p_center uuid, p_period jsonb) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare q app.care_quiet_periods; k text; v_name text; v_from date; v_to date; v_yearly boolean; v_archive boolean; v_id uuid;
  v_allowed constant text[] := array['id', 'name', 'starts_on', 'ends_on', 'yearly', 'archived'];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  if p_period is null or jsonb_typeof(p_period) <> 'object' then raise exception 'Nothing to save: send the quiet period.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_period) loop
    if not (k = any (v_allowed)) then raise exception 'A quiet period has no field "%".', k using errcode = '22023'; end if;
  end loop;
  if nullif(p_period->>'id', '') is not null then
    select * into q from app.care_quiet_periods x where x.id = (p_period->>'id')::uuid and x.center_id = p_center for update;
    if q.id is null then raise exception 'That quiet period was not found.' using errcode = 'P0002'; end if;
  end if;
  v_name := btrim(coalesce(p_period->>'name', q.name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 80 then raise exception 'Give the quiet period a name of up to 80 characters.' using errcode = '23514'; end if;
  begin
    v_from := coalesce(nullif(p_period->>'starts_on', '')::date, q.starts_on);
    v_to := coalesce(nullif(p_period->>'ends_on', '')::date, q.ends_on);
  exception when others then raise exception 'The dates of a quiet period are days, like 2027-03-01.' using errcode = '22007';
  end;
  if v_from is null or v_to is null then raise exception 'Say when the quiet period starts and ends.' using errcode = '23514'; end if;
  if v_to < v_from then raise exception 'A quiet period cannot end before it starts.' using errcode = '23514'; end if;
  if v_to - v_from >= 366 then raise exception 'A quiet period is at most a year long.' using errcode = '23514'; end if;
  if p_period ? 'yearly' and jsonb_typeof(p_period->'yearly') <> 'boolean' then raise exception 'Every year is yes or no.' using errcode = '22023'; end if;
  v_yearly := coalesce((p_period->>'yearly')::boolean, q.yearly, false);
  if p_period ? 'archived' and jsonb_typeof(p_period->'archived') <> 'boolean' then raise exception 'Archived is yes or no.' using errcode = '22023'; end if;
  v_archive := coalesce((p_period->>'archived')::boolean, false);
  perform app.set_audit_context('Care quiet period saved');
  if q.id is null then
    insert into app.care_quiet_periods (center_id, name, starts_on, ends_on, yearly, archived_at, updated_by)
    values (p_center, v_name, v_from, v_to, v_yearly, case when v_archive then now() end, auth.uid()) returning id into v_id;
  else
    v_id := q.id;
    update app.care_quiet_periods set name = v_name, starts_on = v_from, ends_on = v_to, yearly = v_yearly,
           archived_at = case when v_archive then coalesce(q.archived_at, now()) else null end, updated_at = now(), updated_by = auth.uid()
     where id = v_id;
  end if;
  return v_id;
end $$;

-- ── The settings ──────────────────────────────────────────────────────────────
create or replace function app.care_approach_settings_get(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_approach_settings;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  select * into s from app.care_approach_settings where center_id = p_center;
  return jsonb_build_object(
    'enabled', coalesce(s.enabled, false), 'touch_balance', coalesce(s.touch_balance, 3), 'rest_days', coalesce(s.rest_days, 60),
    'weights', app._care_approach_weights(s.weights), 'defaults', app._care_approach_default_weights(),
    'enabled_at', s.enabled_at, 'can_manage', app.care_can(p_center, 'manage'), 'label', app._module_label(p_center, 'care'),
    'quiet_periods', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'name', q.name, 'starts_on', q.starts_on, 'ends_on', q.ends_on, 'yearly', q.yearly)
                                                order by q.starts_on, q.id), '[]'::jsonb)
                        from app.care_quiet_periods q where q.center_id = p_center and q.archived_at is null));
end $$;

-- p_settings: {enabled?, touch_balance?, rest_days?, weights?}; a key left out keeps its value. weights: any of the signals, whole numbers 0 to 50 (years_max 0 to 100).
create or replace function app.save_care_approach_settings(p_center uuid, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_approach_settings; k text; v_enabled boolean; v_balance integer; v_rest integer; v_weights jsonb; w text; v_val integer; v_max integer;
  v_allowed constant text[] := array['enabled', 'touch_balance', 'rest_days', 'weights'];
  v_signals constant text[] := array['years_per', 'years_max', 'recent_12', 'recent_24', 'recent_36', 'took_part', 'well_thanked'];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'Nothing to save: send the settings.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_settings) loop
    if not (k = any (v_allowed)) then raise exception 'The settings have no field "%".', k using errcode = '22023'; end if;
  end loop;
  select * into s from app.care_approach_settings where center_id = p_center for update;
  if p_settings ? 'enabled' and jsonb_typeof(p_settings->'enabled') <> 'boolean' then raise exception 'Who to approach is on or off.' using errcode = '22023'; end if;
  v_enabled := coalesce((p_settings->>'enabled')::boolean, s.enabled, false);
  v_balance := coalesce(case when p_settings ? 'touch_balance' then nullif(p_settings->>'touch_balance', '')::integer end, s.touch_balance, 3);
  if v_balance < 1 or v_balance > 10 then raise exception 'The touch balance is 1 to 10 touches with no ask for every ask.' using errcode = '23514'; end if;
  v_rest := coalesce(case when p_settings ? 'rest_days' then nullif(p_settings->>'rest_days', '')::integer end, s.rest_days, 60);
  if v_rest < 0 or v_rest > 365 then raise exception 'The rest after an ask is 0 to 365 days.' using errcode = '23514'; end if;
  v_weights := coalesce(s.weights, '{}'::jsonb);
  if p_settings ? 'weights' then
    if jsonb_typeof(p_settings->'weights') <> 'object' then raise exception 'The weights are a list of whole numbers.' using errcode = '22023'; end if;
    for w in select jsonb_object_keys(p_settings->'weights') loop
      if not (w = any (v_signals)) then raise exception 'The score has no signal "%".', w using errcode = '22023'; end if;
      if jsonb_typeof(p_settings->'weights'->w) <> 'number' or (p_settings->'weights'->>w) !~ '^[0-9]+$' then raise exception 'Each weight is a whole number of points.' using errcode = '22023'; end if;
      v_val := (p_settings->'weights'->>w)::integer;
      v_max := case when w = 'years_max' then 100 else 50 end;
      if v_val < 0 or v_val > v_max then raise exception 'A weight is 0 to 50 points (the most for years is 100).' using errcode = '23514'; end if;
      v_weights := v_weights || jsonb_build_object(w, v_val);
    end loop;
  end if;
  perform app.set_audit_context(case when v_enabled and not coalesce(s.enabled, false) then 'Who to approach switched on' when not v_enabled and coalesce(s.enabled, false) then 'Who to approach switched off' else 'Who to approach settings saved' end);
  insert into app.care_approach_settings (center_id, enabled, touch_balance, rest_days, weights, enabled_at, enabled_by, updated_by)
  values (p_center, v_enabled, v_balance, v_rest, v_weights, case when v_enabled then now() end, case when v_enabled then auth.uid() end, auth.uid())
  on conflict (center_id) do update
    set enabled = excluded.enabled, touch_balance = excluded.touch_balance, rest_days = excluded.rest_days, weights = excluded.weights,
        enabled_at = case when excluded.enabled and not app.care_approach_settings.enabled then now() when not excluded.enabled then null else app.care_approach_settings.enabled_at end,
        enabled_by = case when excluded.enabled and not app.care_approach_settings.enabled then auth.uid() when not excluded.enabled then null else app.care_approach_settings.enabled_by end,
        updated_at = now(), updated_by = auth.uid();
  return app.care_approach_settings_get(p_center);
end $$;

-- ── The rows ──────────────────────────────────────────────────────────────────
-- One row per household that has a gift in the last five years (a household that never gave is invited, not asked), with its state and the facts. Private:
-- the readers below check access first. holds: structured (the portal words them). signals: the score's parts.
drop function if exists app._care_approach_rows(uuid, uuid, uuid);
create or replace function app._care_approach_rows(p_center uuid, p_fund uuid, p_household uuid)
returns table (household_id uuid, state text, holds jsonb, score integer, signals jsonb, last_gift_on date, last_ask_on date, no_ask_since integer, gifts_n integer, range_low bigint, range_high bigint)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_today date; v_tz text; s app.care_approach_settings; w jsonb; v_balance integer; v_rest integer; v_events boolean; v_vol boolean; v_thanks boolean; v_fees boolean;
  v_quiet_name text; v_quiet_until date; q record;
begin
  v_today := app._care_today(p_center);
  v_tz := coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'America/Chicago');
  select * into s from app.care_approach_settings where center_id = p_center;
  w := app._care_approach_weights(s.weights);
  v_balance := coalesce(s.touch_balance, 3);
  v_rest := coalesce(s.rest_days, 60);
  v_events := app._care_source_on(p_center, 'attendees');
  v_vol := app._care_source_on(p_center, 'volunteer_assignments');
  v_thanks := app.module_enabled(p_center, 'giving') and exists (select 1 from app.care_settings x where x.center_id = p_center);
  v_fees := coalesce((select x.count_fees from app.care_settings x where x.center_id = p_center), false);
  for q in select * from app.care_quiet_periods z where z.center_id = p_center and z.archived_at is null order by z.starts_on loop
    v_quiet_until := app._care_quiet_covers(v_today, q.starts_on, q.ends_on, q.yearly);
    if v_quiet_until is not null then v_quiet_name := q.name; exit; end if;
  end loop;
  if not app.module_enabled(p_center, 'giving') then return; end if;

  return query
  with hh as (
    select h.id as hid from app.households h
     where h.center_id = p_center and h.merged_into_id is null and (p_household is null or h.id = p_household)
  ),
  gl as (
    select g.household_id as hid, g.received_on as d, g.donation_cents as amt
      from app._care_gifts(p_center) g join hh on hh.hid = g.household_id
     where p_fund is null and g.received_on > v_today - 1826 and g.received_on <= v_today
    union all
    select p.household_id, p.received_on, sum(al.amount_cents)::bigint
      from app.payment_allocations al join app.pledges pl on pl.id = al.pledge_id join app.payments p on p.id = al.payment_id join hh on hh.hid = p.household_id
     where p_fund is not null and al.center_id = p_center and pl.fund_id = p_fund and p.received_on > v_today - 1826 and p.received_on <= v_today
       and p.id in (select g.payment_id from app._care_gifts(p_center) g)
     group by p.id, p.household_id, p.received_on
  ),
  gs as (
    select gl.hid, count(*)::int as n, count(distinct ((v_today - gl.d) / 365))::int as years, max(gl.d) as last_on,
           percentile_cont(0.5) within group (order by gl.amt) as med, max(gl.amt) as hi
      from gl group by gl.hid
  ),
  adults as (
    select hm.household_id as hid, hm.person_id, coalesce(hm.joined_at, '-infinity'::date) as from_day, coalesce(hm.left_at, 'infinity'::date) as to_day
      from app.household_members hm join hh on hh.hid = hm.household_id
     where not app.person_is_minor(hm.person_id)
  ),
  part as (
    select a.hid, (a2.checked_in_at at time zone v_tz)::date as day
      from app.attendees a2 join adults a on a.person_id = a2.person_id
     where v_events and a2.center_id = p_center and a2.checked_in_at is not null and not a2.is_child_under_12
       and (a2.checked_in_at at time zone v_tz)::date between a.from_day and a.to_day
    union all
    select a.hid, (coalesce(vs.starts_at, va.created_at) at time zone v_tz)::date
      from app.volunteer_assignments va
      join adults a on a.person_id = va.person_id
      join app.volunteer_shifts vs on vs.id = va.shift_id
     where v_vol and va.center_id = p_center
       and (va.status = 'completed' or (va.status = 'confirmed' and coalesce(vs.ends_at, vs.starts_at) < now()))
       and (coalesce(vs.starts_at, va.created_at) at time zone v_tz)::date between a.from_day and a.to_day
  ),
  ps as (
    select p.hid, count(*)::int as p12 from part p where p.day > v_today - 365 and p.day <= v_today group by p.hid
  ),
  ta as (
    select hh.hid,
           (select max(t.touched_at) from app.care_touches t
             where t.household_id = hh.hid and t.voided_at is null and t.is_ask and t.outcome <> 'no_answer') as last_ask
      from hh
  ),
  tn as (
    select ta.hid, ta.last_ask,
           (select count(*)::int from app.care_touches t
             where t.household_id = ta.hid and t.voided_at is null and not t.is_ask and t.outcome = 'done'
               and t.touched_at > coalesce(ta.last_ask, now() - interval '365 days')) as no_ask
      from ta
  ),
  pb as (
    select pl.household_id as hid, max(v_today - pl.due_on)::int as days
      from app.pledges pl join hh on hh.hid = pl.household_id
     where pl.center_id = p_center and pl.status in ('open', 'partially_paid') and pl.paid_cents < pl.amount_cents
       and pl.due_on is not null and pl.due_on < v_today - 60 and (v_fees or pl.source::text not in ('membership_fee', 'pathshala_fee', 'store'))
     group by pl.household_id
  ),
  th as (
    select p.household_id as hid, count(*)::int as n
      from app.care_thanks t join app.payments p on p.id = t.payment_id join hh on hh.hid = p.household_id
      left join app._care_thanked(p_center) x on x.thank_id = t.id
     where v_thanks and t.center_id = p_center and t.set_aside_at is null and x.thanked_at is null
     group by p.household_id
  ),
  c as (
    select gs.hid, gs.n, gs.years, gs.last_on, gs.med, gs.hi, coalesce(ps.p12, 0) as p12, tn.last_ask, coalesce(tn.no_ask, 0) as no_ask, pb.days as pb_days, coalesce(th.n, 0) as th_n,
           coalesce(cp.do_not_ask and (cp.rest_until is null or cp.rest_until >= v_today), false) as dna
      from gs
      left join ps on ps.hid = gs.hid left join tn on tn.hid = gs.hid left join pb on pb.hid = gs.hid left join th on th.hid = gs.hid
      left join app.care_profiles cp on cp.household_id = gs.hid
  ),
  sc as (
    select c.*,
           least(c.years * (w->>'years_per')::int, (w->>'years_max')::int) as p_years,
           case when v_today - c.last_on <= 365 then (w->>'recent_12')::int when v_today - c.last_on <= 730 then (w->>'recent_24')::int
                when v_today - c.last_on <= 1095 then (w->>'recent_36')::int else 0 end as p_recent,
           case when c.p12 > 0 then (w->>'took_part')::int else 0 end as p_part,
           case when v_thanks and c.th_n = 0 then (w->>'well_thanked')::int else 0 end as p_thanked,
           (select coalesce(jsonb_agg(h), '[]'::jsonb) from (values
              (case when c.pb_days is not null then jsonb_build_object('code', 'pledge', 'days', c.pb_days) end),
              (case when c.th_n > 0 then jsonb_build_object('code', 'thank', 'n', c.th_n) end),
              (case when v_rest > 0 and c.last_ask is not null and (c.last_ask at time zone v_tz)::date + v_rest > v_today
                    then jsonb_build_object('code', 'rest', 'last_ask_on', (c.last_ask at time zone v_tz)::date, 'until', (c.last_ask at time zone v_tz)::date + v_rest) end),
              (case when c.no_ask < v_balance then jsonb_build_object('code', 'balance', 'have', c.no_ask, 'need', v_balance) end),
              (case when v_quiet_name is not null then jsonb_build_object('code', 'quiet', 'name', v_quiet_name, 'until', v_quiet_until) end)
            ) hv(h) where h is not null) as holds
      from c
  )
  select sc.hid,
         case when sc.dna then 'excluded' when jsonb_array_length(sc.holds) > 0 then 'held' else 'ready' end,
         sc.holds,
         (sc.p_years + sc.p_recent + sc.p_part + sc.p_thanked)::int,
         jsonb_build_array(
           jsonb_build_object('key', 'years', 'points', sc.p_years, 'n', sc.years),
           jsonb_build_object('key', 'recent', 'points', sc.p_recent, 'days', v_today - sc.last_on),
           jsonb_build_object('key', 'took_part', 'points', sc.p_part, 'n', sc.p12),
           jsonb_build_object('key', 'well_thanked', 'points', sc.p_thanked)),
         sc.last_on, (sc.last_ask at time zone v_tz)::date, sc.no_ask, sc.n,
         case when sc.n >= 3 then round(sc.med)::bigint end, case when sc.n >= 3 then sc.hi end
    from sc;
end $$;
revoke execute on function app._care_approach_rows(uuid, uuid, uuid) from public, anon, authenticated;

-- ── The reads ─────────────────────────────────────────────────────────────────
create or replace function app.care_approach(p_center uuid, p_fund uuid default null, p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_approach_settings; v_all boolean; v_mine uuid[]; v_amounts boolean; v_limit integer := greatest(1, least(coalesce(p_limit, 50), 100));
  v_ready jsonb; v_held jsonb; v_ready_total integer; v_held_total integer; v_not_shown integer; v_logged integer; v_funds jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  select * into s from app.care_approach_settings where center_id = p_center;
  if not coalesce(s.enabled, false) then
    perform app.log_private_read(p_center, 'care', 'approach', 0);
    return jsonb_build_object('state', 'off', 'can_manage', app.care_can(p_center, 'manage'), 'label', app._module_label(p_center, 'care'));
  end if;
  if not app.module_enabled(p_center, 'giving') then
    perform app.log_private_read(p_center, 'care', 'approach', 0);
    return jsonb_build_object('state', 'giving_off', 'can_manage', app.care_can(p_center, 'manage'), 'label', app._module_label(p_center, 'care'));
  end if;
  if p_fund is not null and not exists (select 1 from app.funds f where f.id = p_fund and f.center_id = p_center) then
    raise exception 'That fund was not found.' using errcode = 'P0002';
  end if;
  perform app._care_thanks_sync(p_center);
  v_all := app.care_can(p_center, 'view');
  v_mine := app.care_my_households();
  v_amounts := app.care_amounts_can(p_center);

  create temp table if not exists _care_appr (household_id uuid, state text, holds jsonb, score integer, signals jsonb, last_gift_on date, last_ask_on date,
                                              no_ask_since integer, gifts_n integer, range_low bigint, range_high bigint) on commit drop;
  truncate _care_appr;
  insert into _care_appr select * from app._care_approach_rows(p_center, p_fund, null) r where v_all or r.household_id = any (v_mine);
  select count(*) filter (where state = 'ready'), count(*) filter (where state = 'held'), count(*) filter (where state = 'excluded') into v_ready_total, v_held_total, v_not_shown from _care_appr;

  select coalesce(jsonb_agg(x.j order by x.score desc, x.last_gift_on desc, x.household_id), '[]'::jsonb) into v_ready from (
    select r.score, r.last_gift_on, r.household_id, jsonb_build_object(
             'household', app._care_household_head(r.household_id),
             'owner', (select case when o.owner_user_id is not null then app._user_label(p_center, o.owner_user_id) end from app.care_owners o where o.household_id = r.household_id),
             'state', r.state, 'holds', r.holds, 'score', r.score, 'signals', r.signals, 'last_gift_on', r.last_gift_on, 'last_ask_on', r.last_ask_on, 'no_ask_since', r.no_ask_since,
             'gifts', r.gifts_n, 'range', case when v_amounts and r.range_low is not null then jsonb_build_object('low', r.range_low, 'high', r.range_high, 'n', r.gifts_n) end) as j
      from _care_appr r where r.state = 'ready' order by r.score desc, r.last_gift_on desc, r.household_id limit v_limit) x;
  select coalesce(jsonb_agg(x.j order by x.nholds, x.score desc, x.last_gift_on desc, x.household_id), '[]'::jsonb) into v_held from (
    select jsonb_array_length(r.holds) as nholds, r.score, r.last_gift_on, r.household_id, jsonb_build_object(
             'household', app._care_household_head(r.household_id),
             'owner', (select case when o.owner_user_id is not null then app._user_label(p_center, o.owner_user_id) end from app.care_owners o where o.household_id = r.household_id),
             'state', r.state, 'holds', r.holds, 'score', r.score, 'signals', r.signals, 'last_gift_on', r.last_gift_on, 'last_ask_on', r.last_ask_on, 'no_ask_since', r.no_ask_since,
             'gifts', r.gifts_n, 'range', null) as j
      from _care_appr r where r.state = 'held' order by jsonb_array_length(r.holds), r.score desc, r.last_gift_on desc, r.household_id limit 50) x;
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.name), '[]'::jsonb) into v_funds from app.funds f where f.center_id = p_center and f.active;
  v_logged := jsonb_array_length(v_ready) + jsonb_array_length(v_held);
  perform app.log_private_read(p_center, 'care', 'approach', v_logged);
  return jsonb_build_object('state', 'ok', 'ready', v_ready, 'held', v_held, 'ready_total', v_ready_total, 'held_total', v_held_total, 'not_shown', v_not_shown,
                            'fund', p_fund, 'funds', v_funds, 'amounts', v_amounts, 'all', v_all, 'touch_balance', s.touch_balance, 'rest_days', s.rest_days,
                            'can_manage', app.care_can(p_center, 'manage'), 'label', app._module_label(p_center, 'care'), 'today', app._care_today(p_center));
end $$;

create or replace function app.care_approach_household(p_household uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; s app.care_approach_settings; r record; v_amounts boolean; v_found boolean;
begin
  v_center := app._care_household_or_raise(p_household);
  select * into s from app.care_approach_settings where center_id = v_center;
  if not coalesce(s.enabled, false) then return jsonb_build_object('state', 'off'); end if;
  if not app.module_enabled(v_center, 'giving') then return jsonb_build_object('state', 'giving_off'); end if;
  perform app._care_thanks_sync(v_center);
  v_amounts := app.care_amounts_can(v_center);
  select * into r from app._care_approach_rows(v_center, null, p_household) x limit 1;
  v_found := found;
  perform app.log_private_read(v_center, 'care', 'approach_household', 1);
  if not v_found then return jsonb_build_object('state', 'no_history'); end if;
  return jsonb_build_object('state', r.state, 'holds', r.holds, 'score', r.score, 'signals', r.signals, 'last_gift_on', r.last_gift_on, 'last_ask_on', r.last_ask_on,
                            'no_ask_since', r.no_ask_since, 'gifts', r.gifts_n, 'touch_balance', s.touch_balance, 'rest_days', s.rest_days,
                            'range', case when v_amounts and r.range_low is not null then jsonb_build_object('low', r.range_low, 'high', r.range_high, 'n', r.gifts_n) end);
end $$;

revoke execute on function app.save_care_quiet_period(uuid, jsonb), app.care_approach_settings_get(uuid), app.save_care_approach_settings(uuid, jsonb),
  app.care_approach(uuid, uuid, integer), app.care_approach_household(uuid) from public, anon;
grant execute on function app.save_care_quiet_period(uuid, jsonb), app.care_approach_settings_get(uuid), app.save_care_approach_settings(uuid, jsonb),
  app.care_approach(uuid, uuid, integer), app.care_approach_household(uuid) to authenticated, service_role;
