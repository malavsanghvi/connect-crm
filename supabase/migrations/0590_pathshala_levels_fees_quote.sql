-- 0590_pathshala_levels_fees_quote.sql: Pathshala registration, database pull request 1 of 5 (DB1: levels, fees,
-- payment mode, quote). docs/PATHSHALA_REGISTRATION_PLAN.md version 2, accepted by the owner on 2026-10-06 (every
-- recommended answer, P15–P32; P1–P14 accepted 2026-10-01). No money moves here: nothing bills, places or takes a
-- payment. The registration itself (seats, holds, pledges) is 0591.
--
--   app.pathshala_levels           + active (a level is retired, never deleted once used) + an age-band check (0–120,
--                                  minimum not above maximum). A level whose minimum age is 18 or more is an ADULT CLASS,
--                                  one whose maximum age is under 18 a CHILDREN'S LEVEL, one with no band is open to
--                                  anyone (§2.1, P24). The seed sets no ages.
--   app.save_pathshala_level       pathshala.manage: add or change a level (name, key, order, ages, active) with
--                                  plain-English refusals; a used level cannot be deleted (trigger) or moved to another track
--   app.pathshala_level_fees       an explicit fee per level per term ($0 = Free, else at least $0.50) (§2.2, P21, P22)
--   app.set_pathshala_level_fees   the principal while the term is a draft; after registration opens only the treasurer
--                                  (giving.manage) with a reason, for new registrations only (P9)
--   app.pathshala_terms            + payment_mode (pledge | pay_now), hold_hours (48; 1–168), office_payment_allowed,
--                                  office_hold_days (7; 1–21), seat_rule (automatic | office; office only with pledge),
--                                  campaign_id, fund_id, late_registration_closes_at, late_fee_cents, withdrawal_credit_until
--                                  (default: the first class day + 14 days), age_cutoff_on (default: the first day of term),
--                                  fees_locked_at, fees_locked_by (§2.10)
--   app.set_pathshala_term_rules   the same people as the fees: payment mode, windows, office payment, seat rule, sibling %,
--                                  family cap, late window and fee, withdrawal deadline, age cut-off, fund (giving.manage);
--                                  pay now is refused with the readiness sentence (P15–P20)
--   app.pathshala_pay_now_ready    null when pay now may be chosen, else why not. Closed until 0595 (fee receipts, P13):
--                                  "Pay at registration waits for fee receipts (P13)."
--   app.open_pathshala_registration  refuses while an offered level (an active level with a class this term) has no fee and,
--                                  for pay now, while pay now is not ready; with Pledges & donations on it creates or reuses the
--                                  closed campaign "Pathshala fees <term>" (kind pathshala) linked to the Pathshala fund;
--                                  locks the fees and the rules; status → registration
--   trigger pathshala_terms_guard  a write through the API (the term form) or the bulk import (app.client_app = 'import')
--                                  cannot take a term out of Draft (or back to it once open), choose pay now, touch the
--                                  lock, campaign or fund, or change a locked rule (the payment and fee rules, the
--                                  registration dates, the membership rule). The database's own functions, migrations, the demo pack and test
--                                  fixtures write as the owner and are not checked; terms already out of Draft keep their
--                                  status.
--   app.pathshala_enrollment_fees  the locked quote, one row per enrollment, kept off the enrollment row that children read
--                                  (finding F2). Created here; written by 0591.
--   app.pathshala_quote            THE pricing function (§2.4): the level fee; the sibling discount among children only (the
--                                  first child pays full, every other child gets the term's % off each of their lines); the
--                                  family cap on the children's lines only; the late fee per learner in the late window; fee
--                                  assistance (none is approved before 0592). Adults are outside the discount and the cap;
--                                  children are under 18 on the term's age cut-off date (toddlers included; no birth date:
--                                  the 0587 household rule). Writes nothing.
--   app.pathshala_registration_options, app.preview_pathshala_registration, app.pathshala_fee_example ("Try a family"),
--   app.pathshala_seats            the §2.17 contract shapes the portal and the member app are built against
--   app.payment_checkouts / app.create_checkout   accept the checkout context 'pathshala' (finding F17)
--
-- ACCESS AND MONEY (the owner approves this pull request before it merges): no app role writes any new table directly
-- (functions only); level fees are read by the community's members once the term is out of Draft and by Pathshala and
-- giving staff; enrollment fees by the household's adults (a child never), pathshala.manage and giving staff. Nothing is
-- billed here.
set client_min_messages = warning;

-- ═════════════════════════════════════════════════════════════════════════════
-- Small helpers (internal)
-- ═════════════════════════════════════════════════════════════════════════════
-- Money as the screens say it: $1,234.50.
create or replace function app.pathshala_money(p_cents bigint) returns text
language sql immutable set search_path = app, public, extensions as $$
  select to_char(coalesce(p_cents, 0) / 100.0, 'FM$999,999,990.00')
$$;

-- A timestamp as ISO 8601 in the community's time zone, with its offset: 2026-09-01T23:59:00-05:00.
create or replace function app.pathshala_iso(p_ts timestamptz, p_tz text) returns text
language plpgsql stable set search_path = app, public, extensions as $$
declare v_local timestamp; v_off interval; v_min int;
begin
  if p_ts is null then return null; end if;
  v_local := p_ts at time zone coalesce(nullif(p_tz, ''), 'America/Chicago');
  v_off := v_local - (p_ts at time zone 'UTC');
  v_min := (extract(epoch from v_off) / 60)::int;
  return to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS') || case when v_min < 0 then '-' else '+' end
         || lpad((abs(v_min) / 60)::text, 2, '0') || ':' || lpad((abs(v_min) % 60)::text, 2, '0');
end $$;

-- A person's first name as the screens say it.
create or replace function app.pathshala_first_name(p_person uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) from app.people p where p.id = p_person
$$;

-- Whole years on a date (the age band and the child rule are measured on the term's age cut-off date).
create or replace function app.pathshala_age_on(p_dob date, p_on date) returns integer
language sql immutable set search_path = app, public, extensions as $$
  select case when p_dob is null or p_on is null then null else extract(year from age(p_on, p_dob))::int end
$$;

-- A child for Pathshala (§2.3, P23): under 18 on the cut-off date; with no birth date on file, app.person_is_minor's
-- household rule (a current "child" role somewhere and no current "primary" or "spouse" role anywhere).
create or replace function app.pathshala_counts_as_child(p_person uuid, p_on date) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select case when p.date_of_birth is not null then p.date_of_birth > (p_on - interval '18 years')::date
                               else exists (select 1 from app.household_members hm
                                             where hm.person_id = p.id and hm.left_at is null and hm.role = 'child')
                                    and not exists (select 1 from app.household_members hm
                                                     where hm.person_id = p.id and hm.left_at is null and hm.role in ('primary', 'spouse')) end
                     from app.people p where p.id = p_person), false)
$$;

-- An adult of this household by the same rule (homework's: a child with no birth date on file is not an adult). The money
-- and registration rules of Pathshala use it; RLS of the new tables too.
create or replace function app.pathshala_adult_of_household(p_center uuid, p_household uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and p_household is not null and auth.uid() is not null
     and app.in_my_household(p_center, p_household) and app.gyan_i_am_adult(p_center)
$$;

-- A level's band: adult (minimum 18 or more), children (maximum under 18), any (no band, or a band that crosses 18).
create or replace function app.pathshala_level_band(p_min integer, p_max integer) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when p_min is not null and p_min >= 18 then 'adult'
              when p_max is not null and p_max < 18 then 'children'
              else 'any' end
$$;

-- Typed reads of a JSON field with a plain sentence when the value is the wrong type (null or "" mean "not given").
create or replace function app._pathshala_uuid(p jsonb, p_key text, p_label text) returns uuid
language plpgsql immutable set search_path = app, public, extensions as $$
declare v jsonb := p -> p_key; s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  s := btrim(v #>> '{}');
  if s = '' then return null; end if;
  if jsonb_typeof(v) = 'string' and s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return s::uuid; end if;
  raise exception '% is not a valid id.', p_label using errcode = '22023';
end $$;

create or replace function app._pathshala_int(p jsonb, p_key text, p_label text) returns bigint
language plpgsql immutable set search_path = app, public, extensions as $$
declare v jsonb := p -> p_key; s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  s := btrim(v #>> '{}');
  if s = '' and jsonb_typeof(v) = 'string' then return null; end if;
  if jsonb_typeof(v) in ('number', 'string') and s ~ '^-?\d{1,12}$' then return s::bigint; end if;
  raise exception '% must be a whole number.', p_label using errcode = '22023';
end $$;

create or replace function app._pathshala_bool(p jsonb, p_key text, p_label text) returns boolean
language plpgsql immutable set search_path = app, public, extensions as $$
declare v jsonb := p -> p_key;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'boolean' then return (v #>> '{}')::boolean; end if;
  if jsonb_typeof(v) = 'string' and lower(btrim(v #>> '{}')) in ('true', 'false') then return lower(btrim(v #>> '{}'))::boolean; end if;
  raise exception '% must be true or false.', p_label using errcode = '22023';
end $$;

create or replace function app._pathshala_date(p jsonb, p_key text, p_label text) returns date
language plpgsql immutable set search_path = app, public, extensions as $$
declare v jsonb := p -> p_key; s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  s := btrim(v #>> '{}');
  if s = '' then return null; end if;
  if jsonb_typeof(v) = 'string' and s ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      return s::date;
    exception when others then null;
    end;
  end if;
  raise exception '% must be a date (YYYY-MM-DD).', p_label using errcode = '22023';
end $$;

create or replace function app._pathshala_ts(p jsonb, p_key text, p_label text) returns timestamptz
language plpgsql stable set search_path = app, public, extensions as $$
declare v jsonb := p -> p_key; s text;
begin
  if v is null or jsonb_typeof(v) = 'null' then return null; end if;
  s := btrim(v #>> '{}');
  if s = '' then return null; end if;
  if jsonb_typeof(v) = 'string' and s ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then
    begin
      return s::timestamptz;
    exception when others then null;
    end;
  end if;
  raise exception '% must be a date and time.', p_label using errcode = '22023';
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Levels (§2.1)
-- ═════════════════════════════════════════════════════════════════════════════
alter table app.pathshala_levels add column if not exists active boolean not null default true;
comment on column app.pathshala_levels.active is 'false = retired: not offered any more; its history (classes, registrations, reports) stays. A level that was used is never deleted (0590).';
comment on column app.pathshala_levels.min_age is 'Whole years on the term''s age cut-off date. 18 or more: an adult class (adults only). Empty: no lower bound (0590).';
comment on column app.pathshala_levels.max_age is 'Whole years on the term''s age cut-off date. Under 18: a children''s level (children only; outside the band the office confirms, P24). Empty: no upper bound (0590).';

-- The band check. NOT VALID first, so a community whose imported ages break it still deploys; validated right away when
-- every existing row passes (the seed sets no ages; the demo pack's pass).
alter table app.pathshala_levels drop constraint if exists pathshala_levels_age_band;
alter table app.pathshala_levels add constraint pathshala_levels_age_band
  check ((min_age is null or min_age between 0 and 120) and (max_age is null or max_age between 0 and 120)
         and (min_age is null or max_age is null or min_age <= max_age)) not valid;
do $$
begin
  alter table app.pathshala_levels validate constraint pathshala_levels_age_band;
exception when check_violation then
  raise notice 'pathshala_levels_age_band stays NOT VALID: an existing level has an age band outside 0–120 or a minimum above its maximum. Fix it on Pathshala › Levels.';
end $$;

-- A level with classes, registrations, reports or teacher positions is never deleted: retire it. (The foreign keys
-- would refuse too, with a technical message; this says it plainly.)
create or replace function app.pathshala_levels_delete_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if exists (select 1 from app.pathshala_classes c where c.level_id = old.id)
     or exists (select 1 from app.pathshala_enrollments e where e.requested_level_id = old.id)
     or exists (select 1 from app.pathshala_progress_reports r where r.recommended_next_level_id = old.id)
     or exists (select 1 from app.teacher_positions tp where tp.level_id = old.id) then
    raise exception '% has classes or registrations, so it cannot be deleted. Retire it instead (Pathshala › Levels).', old.name
      using errcode = '22023';
  end if;
  return old;
end $$;
drop trigger if exists pathshala_levels_delete_guard on app.pathshala_levels;
create trigger pathshala_levels_delete_guard before delete on app.pathshala_levels
  for each row execute function app.pathshala_levels_delete_guard();

create or replace function app.pathshala_level_used(p_level uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.pathshala_classes c where c.level_id = p_level)
      or exists (select 1 from app.pathshala_enrollments e where e.requested_level_id = p_level)
$$;

create or replace function app._pathshala_level_json(p_level uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('id', l.id, 'track_id', l.track_id, 'track', t.name, 'key', l.key, 'name', l.name,
                            'sort_order', l.sort_order, 'min_age', l.min_age, 'max_age', l.max_age, 'active', l.active,
                            'band', app.pathshala_level_band(l.min_age, l.max_age), 'used', app.pathshala_level_used(l.id))
    from app.pathshala_levels l join app.pathshala_tracks t on t.id = l.track_id where l.id = p_level
$$;

-- Add (no "id") or change a level. Keys: id, track_id, key, name, sort_order, min_age, max_age, active. A key left out
-- keeps its value; min_age / max_age null clears that bound. Retiring is active = false.
create or replace function app.save_pathshala_level(p_center uuid, p_level jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare l app.pathshala_levels; tr app.pathshala_tracks; v_id uuid; v_track uuid; v_key text; v_name text; v_sort bigint;
        v_min bigint; v_max bigint; v_active boolean; v_bad text; v_reason text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
  perform app.assert_module_enabled(p_center, 'pathshala');
  if not app.has_permission(p_center, 'pathshala.manage') then
    raise exception 'Changing Pathshala levels needs pathshala.manage (the Pathshala principal).' using errcode = '42501';
  end if;
  if p_level is null or jsonb_typeof(p_level) <> 'object' then
    raise exception 'Send the level''s details (name, key, track, ages).' using errcode = '22023';
  end if;
  select k into v_bad from jsonb_object_keys(p_level) k
   where k not in ('id', 'track_id', 'key', 'name', 'sort_order', 'min_age', 'max_age', 'active') limit 1;
  if v_bad is not null then raise exception 'A level has no field called "%".', v_bad using errcode = '22023'; end if;

  v_id := app._pathshala_uuid(p_level, 'id', 'The level');
  if v_id is not null then
    select * into l from app.pathshala_levels where id = v_id and center_id = p_center for update;
    if l.id is null then raise exception 'That level was not found.' using errcode = 'P0002'; end if;
  end if;
  v_track := coalesce(app._pathshala_uuid(p_level, 'track_id', 'The track'), l.track_id);
  if v_track is null then raise exception 'Choose the track for the new level (Jainism, Gujarati, Hindi …).' using errcode = '22023'; end if;
  select * into tr from app.pathshala_tracks where id = v_track and center_id = p_center;
  if tr.id is null then raise exception 'That track is not one of this community''s tracks.' using errcode = '22023'; end if;
  if l.id is not null and v_track <> l.track_id and app.pathshala_level_used(l.id) then
    raise exception '% has classes or registrations, so it cannot move to another track. Add a new level in % instead.', l.name, tr.name
      using errcode = '22023';
  end if;

  v_name := case when p_level ? 'name' then nullif(btrim(p_level ->> 'name'), '') else l.name end;
  if v_name is null then raise exception 'Give the level a name.' using errcode = '22023'; end if;
  if char_length(v_name) > 80 then raise exception 'A level''s name can be at most 80 characters.' using errcode = '22023'; end if;
  v_key := case when p_level ? 'key' then lower(nullif(btrim(p_level ->> 'key'), '')) else l.key end;
  if v_key is null then
    v_key := left(nullif(trim(both '_' from regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g')), ''), 40);
  end if;
  if v_key is null or v_key !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then
    raise exception 'A level''s key can use letters, digits, - and _ (for example 3 or adult_moms), up to 40 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from app.pathshala_levels o where o.track_id = v_track and o.key = v_key and o.id is distinct from l.id) then
    raise exception 'There is already a level with the key "%" in %.', v_key, tr.name using errcode = '22023';
  end if;
  v_sort := case when p_level ? 'sort_order' then app._pathshala_int(p_level, 'sort_order', 'The order') else l.sort_order end;
  if v_sort is null then
    select coalesce(max(o.sort_order), -1) + 1 into v_sort from app.pathshala_levels o where o.track_id = v_track;
  end if;
  if v_sort not between -1000 and 1000 then raise exception 'The order must be between -1000 and 1000.' using errcode = '22023'; end if;
  v_min := case when p_level ? 'min_age' then app._pathshala_int(p_level, 'min_age', 'The minimum age') else l.min_age end;
  v_max := case when p_level ? 'max_age' then app._pathshala_int(p_level, 'max_age', 'The maximum age') else l.max_age end;
  if v_min is not null and v_min not between 0 and 120 then
    raise exception 'The minimum age must be between 0 and 120 (it is %).', v_min using errcode = '22023';
  end if;
  if v_max is not null and v_max not between 0 and 120 then
    raise exception 'The maximum age must be between 0 and 120 (it is %).', v_max using errcode = '22023';
  end if;
  if v_min is not null and v_max is not null and v_min > v_max then
    raise exception 'The minimum age (%) is above the maximum age (%).', v_min, v_max using errcode = '22023';
  end if;
  v_active := coalesce(app._pathshala_bool(p_level, 'active', 'Active'), l.active, true);

  v_reason := coalesce(app.audit_clean_reason(p_reason),
    case when l.id is null then 'Added the Pathshala level ' || v_name || ' (' || tr.name || ')'
         when l.active and not v_active then 'Retired the Pathshala level ' || v_name || ' (' || tr.name || ')'
         when not l.active and v_active then 'Offered the Pathshala level ' || v_name || ' again (' || tr.name || ')'
         else 'Changed the Pathshala level ' || v_name || ' (' || tr.name || ')' end);
  perform app.set_audit_context(v_reason);
  if l.id is null then
    insert into app.pathshala_levels (center_id, track_id, key, name, sort_order, min_age, max_age, active)
    values (p_center, v_track, v_key, v_name, v_sort, v_min, v_max, v_active)
    returning id into v_id;
  else
    update app.pathshala_levels
       set track_id = v_track, key = v_key, name = v_name, sort_order = v_sort, min_age = v_min, max_age = v_max, active = v_active
     where id = l.id;
  end if;
  return app._pathshala_level_json(v_id);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Terms: the rules each term needs (§2.10)
-- ═════════════════════════════════════════════════════════════════════════════
alter table app.pathshala_terms
  add column if not exists payment_mode text not null default 'pledge',
  add column if not exists hold_hours integer not null default 48,
  add column if not exists office_payment_allowed boolean not null default false,
  add column if not exists office_hold_days integer not null default 7,
  add column if not exists seat_rule text not null default 'automatic',
  add column if not exists campaign_id uuid references app.campaigns(id),
  add column if not exists fund_id uuid references app.funds(id),
  add column if not exists late_registration_closes_at timestamptz,
  add column if not exists late_fee_cents integer not null default 0,
  add column if not exists withdrawal_credit_until date,
  add column if not exists age_cutoff_on date,
  add column if not exists fees_locked_at timestamptz,
  add column if not exists fees_locked_by uuid references auth.users(id);

alter table app.pathshala_terms drop constraint if exists pathshala_terms_payment_rules;
alter table app.pathshala_terms add constraint pathshala_terms_payment_rules check (
  payment_mode in ('pledge', 'pay_now') and hold_hours between 1 and 168 and office_hold_days between 1 and 21
  and seat_rule in ('automatic', 'office') and (seat_rule = 'automatic' or payment_mode = 'pledge')
  and late_fee_cents between 0 and 100000000 and (late_fee_cents = 0 or late_fee_cents >= 50));
-- The older money columns get their bounds too (NOT VALID first, so old data never stops a deploy).
alter table app.pathshala_terms drop constraint if exists pathshala_terms_discount_cap;
alter table app.pathshala_terms add constraint pathshala_terms_discount_cap check (
  sibling_discount_pct between 0 and 100 and (fee_per_family_cap_cents is null or fee_per_family_cap_cents >= 0)) not valid;
do $$
begin
  alter table app.pathshala_terms validate constraint pathshala_terms_discount_cap;
exception when check_violation then
  raise notice 'pathshala_terms_discount_cap stays NOT VALID: an existing term has a sibling discount outside 0–100 or a negative family cap.';
end $$;

comment on column app.pathshala_terms.payment_mode is 'pledge (default): a learner who gets a seat adds one fee pledge per enrollment, paid any time before it is due. pay_now: the fee is paid while registering; the seat is held hold_hours while the payment completes (P15). Chosen only through app.set_pathshala_term_rules, which refuses pay now with app.pathshala_pay_now_ready''s sentence (P20).';
comment on column app.pathshala_terms.hold_hours is 'Pay now: how long a seat is held for an online payment (48 by default, 1–168, P17).';
comment on column app.pathshala_terms.office_payment_allowed is 'Pay now: the family may pay at the office (Zelle, check, cash) instead; the seat is then held office_hold_days (P18).';
comment on column app.pathshala_terms.seat_rule is 'automatic (default): a learner gets a free seat at registration. office: the office places every learner (pledge mode only; P12 as version 1).';
comment on column app.pathshala_terms.campaign_id is 'The closed campaign "Pathshala fees <term>" (kind pathshala) every fee pledge carries; created or reused by app.open_pathshala_registration.';
comment on column app.pathshala_terms.fund_id is 'The fund every fee pledge carries: the Pathshala fund (found by key), or the one the treasurer chose.';
comment on column app.pathshala_terms.late_registration_closes_at is 'The end of the optional late window after registration_closes_at (P4): families may still register, with late_fee_cents per learner.';
comment on column app.pathshala_terms.withdrawal_credit_until is 'Withdrawing on or before this date cancels the fee pledge (anything paid becomes credit, P5). Empty: the first class day + 14 days (fixed when registration opens).';
comment on column app.pathshala_terms.age_cutoff_on is 'The date ages are measured on (age bands, the child rule). Empty: the first day of term (fixed when registration opens).';
comment on column app.pathshala_terms.fees_locked_at is 'Set by app.open_pathshala_registration: the fees and the rules are locked; later changes need giving.manage and a reason and apply to new registrations only (P9, P16).';
comment on column app.pathshala_terms.fee_per_child_cents is 'Kept only to pre-fill the Fees screen (0590): every offered level has its own fee in app.pathshala_level_fees, and nothing falls back to this.';

-- The first class day of a term (or of one class): the first date on or after the start that falls on a class's day and
-- is not a no-class date. A term with no classes: its first day.
create or replace function app.pathshala_first_class_day(p_term uuid, p_class uuid default null) returns date
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; r record; d date; v date; v_dow int;
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then return null; end if;
  for r in select c.meets_on from app.pathshala_classes c where c.term_id = p_term and (p_class is null or c.id = p_class) loop
    v_dow := case lower(btrim(r.meets_on)) when 'sunday' then 0 when 'monday' then 1 when 'tuesday' then 2 when 'wednesday' then 3
                                           when 'thursday' then 4 when 'friday' then 5 when 'saturday' then 6 end;
    continue when v_dow is null;
    d := t.starts_on + ((v_dow - extract(dow from t.starts_on)::int + 7) % 7);
    while d = any (t.no_class_dates) and d <= t.ends_on loop d := d + 7; end loop;
    if d <= t.ends_on and (v is null or d < v) then v := d; end if;
  end loop;
  return coalesce(v, t.starts_on);
end $$;

-- The age cut-off and the withdrawal deadline as they apply now (explicit once registration opens).
create or replace function app.pathshala_age_cutoff(p_term uuid) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(t.age_cutoff_on, t.starts_on) from app.pathshala_terms t where t.id = p_term
$$;
create or replace function app.pathshala_withdrawal_deadline(p_term uuid) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(t.withdrawal_credit_until, app.pathshala_first_class_day(t.id) + 14) from app.pathshala_terms t where t.id = p_term
$$;

-- The registration window (§2.17): open, late, closed or not_yet. A term must be out of Draft with its fees locked.
create or replace function app.pathshala_registration_window(p_term uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; v_tz text; v_state text;
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then return null; end if;
  select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = t.center_id;
  v_state := case
    when t.status = 'closed' then 'closed'
    when t.status = 'draft' or t.fees_locked_at is null then 'not_yet'
    when t.registration_opens_at is not null and now() < t.registration_opens_at then 'not_yet'
    when t.registration_closes_at is not null and now() > t.registration_closes_at then
      case when t.late_registration_closes_at is not null and now() <= t.late_registration_closes_at then 'late' else 'closed' end
    else 'open' end;
  return jsonb_build_object('state', v_state,
                            'opens_at', app.pathshala_iso(t.registration_opens_at, v_tz),
                            'closes_at', app.pathshala_iso(t.registration_closes_at, v_tz),
                            'late_until', app.pathshala_iso(t.late_registration_closes_at, v_tz),
                            'late_fee_cents', t.late_fee_cents);
end $$;

-- Is a registration made now in the late part (after registration closed)? The late fee applies then (P4): to families in
-- the late window, and to the office registering after it.
create or replace function app.pathshala_is_late(p_term uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select t.registration_closes_at is not null and now() > t.registration_closes_at
                     from app.pathshala_terms t where t.id = p_term), false)
$$;

-- The term guard. It checks the two writers that act for a person: a write through the API (the term form) runs as the
-- authenticated role, and the bulk import marks every write of a run with app.client_app = 'import' (app.import_audit,
-- app.import_undo; it runs as the owner, being security definer, so the role alone would let it through). The database's
-- own functions (set_pathshala_term_rules, open_pathshala_registration), migrations, the demo pack and test fixtures
-- write as the owner with no import mark, and are not checked.
create or replace function app.pathshala_terms_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if not (current_user in ('authenticated', 'anon') or coalesce(current_setting('app.client_app', true), '') = 'import') then
    return new;
  end if;
  -- A family cap of $0 would make every child free (review C11): a cap is at least $0.50, or empty for no cap. A cap
  -- already stored at $0 is left as it is (pricing treats it as no cap).
  if new.fee_per_family_cap_cents is not null and new.fee_per_family_cap_cents < 50
     and (tg_op = 'INSERT' or new.fee_per_family_cap_cents is distinct from old.fee_per_family_cap_cents) then
    raise exception 'A family cap is at least $0.50 (at most $1,000,000); leave it empty for no cap.' using errcode = '22023';
  end if;
  if (tg_op = 'INSERT' and new.status <> 'draft')
     or (tg_op = 'UPDATE' and old.status = 'draft' and new.status <> 'draft') then
    raise exception 'To open registration for %, use Open registration on its Fees screen: it checks that every level with a class has its fee, then locks the fees.',
      new.name using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if new.fees_locked_at is not null or new.fees_locked_by is not null or new.payment_mode <> 'pledge'
       or new.campaign_id is not null or new.fund_id is not null then
      raise exception 'Set the payment mode and the fee rules of % on its Fees screen.', new.name using errcode = '22023';
    end if;
    return new;
  end if;
  if new.fees_locked_at is distinct from old.fees_locked_at or new.fees_locked_by is distinct from old.fees_locked_by
     or new.campaign_id is distinct from old.campaign_id or new.fund_id is distinct from old.fund_id
     or (new.payment_mode is distinct from old.payment_mode and new.payment_mode = 'pay_now') then
    raise exception 'Set the payment mode and the fee rules of % on its Fees screen.', new.name using errcode = '22023';
  end if;
  if old.fees_locked_at is not null and old.status <> 'draft' and new.status = 'draft' then
    raise exception '% has opened for registration, so it cannot go back to Draft.', new.name using errcode = '22023';
  end if;
  -- Locked rules: the payment rules, the fees' rules, and (review C10) the registration dates, which decide the late fee
  -- (P4), and the membership rule (P6). The first day of term and the no-class dates stay with the principal: they move
  -- only what is worked out afterwards (a pledge keeps the due date it was given).
  if old.fees_locked_at is not null and (
       new.payment_mode is distinct from old.payment_mode or new.hold_hours is distinct from old.hold_hours
    or new.office_payment_allowed is distinct from old.office_payment_allowed or new.office_hold_days is distinct from old.office_hold_days
    or new.seat_rule is distinct from old.seat_rule or new.sibling_discount_pct is distinct from old.sibling_discount_pct
    or new.fee_per_family_cap_cents is distinct from old.fee_per_family_cap_cents
    or new.late_registration_closes_at is distinct from old.late_registration_closes_at or new.late_fee_cents is distinct from old.late_fee_cents
    or new.withdrawal_credit_until is distinct from old.withdrawal_credit_until or new.age_cutoff_on is distinct from old.age_cutoff_on
    or new.registration_opens_at is distinct from old.registration_opens_at or new.registration_closes_at is distinct from old.registration_closes_at
    or new.membership_required is distinct from old.membership_required) then
    raise exception 'The fee rules of % are locked since registration opened. The treasurer changes them on its Fees screen, with a reason; a change applies to new registrations only.',
      new.name using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists pathshala_terms_guard on app.pathshala_terms;
create trigger pathshala_terms_guard before insert or update on app.pathshala_terms
  for each row execute function app.pathshala_terms_guard();

-- ═════════════════════════════════════════════════════════════════════════════
-- Level fees (§2.2)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists app.pathshala_level_fees (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  term_id    uuid not null references app.pathshala_terms(id) on delete cascade,
  level_id   uuid not null references app.pathshala_levels(id) on delete cascade,
  fee_cents  integer not null check (fee_cents = 0 or fee_cents between 50 and 100000000),
  set_by     uuid references auth.users(id),
  set_at     timestamptz not null default now(),
  unique (term_id, level_id)
);
create index if not exists pathshala_level_fees_center_idx on app.pathshala_level_fees (center_id, term_id);
comment on table app.pathshala_level_fees is
  'The fee of a level in a term (0590, P21): every level with a class this term (an offered level) needs one before registration opens; $0 is Free, otherwise at least $0.50 (the smallest online payment). Written only by app.set_pathshala_level_fees: the principal while the term is a draft, the treasurer (giving.manage) with a reason after it opens, for new registrations only. Quotes and pledges already made never change.';

-- ═════════════════════════════════════════════════════════════════════════════
-- Enrollment fees: the locked quote, one row per enrollment (§2.10; written from 0591)
-- ═════════════════════════════════════════════════════════════════════════════
create table if not exists app.pathshala_enrollment_fees (
  id                        uuid primary key default gen_random_uuid(),
  center_id                 uuid not null references app.centers(id) on delete cascade,
  enrollment_id             uuid not null unique references app.pathshala_enrollments(id),
  registration_id           uuid,
  term_id                   uuid not null references app.pathshala_terms(id),
  household_id              uuid not null references app.households(id),
  level_id                  uuid references app.pathshala_levels(id),
  learner_kind              text not null check (learner_kind in ('child', 'adult')),
  family_rank               integer check (family_rank is null or family_rank >= 1),
  base_fee_cents            bigint not null default 0 check (base_fee_cents >= 0),
  sibling_discount_cents    bigint not null default 0 check (sibling_discount_cents >= 0),
  cap_reduction_cents       bigint not null default 0 check (cap_reduction_cents >= 0),
  late_fee_cents            bigint not null default 0 check (late_fee_cents >= 0),
  assistance_cents          bigint not null default 0 check (assistance_cents >= 0),
  total_cents               bigint not null default 0 check (total_cents >= 0),
  priced                    boolean not null default true,
  rule_snapshot             jsonb not null default '{}'::jsonb,
  quoted_at                 timestamptz not null default now(),
  status                    text not null default 'quoted'
                            check (status in ('quoted', 'billed', 'paid', 'no_fee', 'cancelled', 'not_billed_giving_off')),
  pledge_id                 uuid unique references app.pledges(id),
  billed_at                 timestamptz,
  paid_at                   timestamptz,
  billing_note              text check (billing_note is null or char_length(billing_note) <= 500),
  requotes                  jsonb not null default '[]'::jsonb,
  assistance_requested      boolean not null default false,
  assistance_note           text check (assistance_note is null or char_length(assistance_note) <= 1000),
  assistance_proposed_cents bigint check (assistance_proposed_cents is null or assistance_proposed_cents >= 0),
  assistance_proposed_by    uuid references auth.users(id),
  assistance_proposed_at    timestamptz,
  assistance_approved_by    uuid references auth.users(id),
  assistance_approved_at    timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint pathshala_enrollment_fees_parts check (
    total_cents = base_fee_cents - sibling_discount_cents - cap_reduction_cents + late_fee_cents - assistance_cents),
  constraint pathshala_enrollment_fees_child_rank check ((learner_kind = 'child') = (family_rank is not null)),
  constraint pathshala_enrollment_fees_two_people check (
    assistance_approved_by is null or (assistance_proposed_by is not null and assistance_approved_by <> assistance_proposed_by))
);
create index if not exists pathshala_enrollment_fees_household_idx on app.pathshala_enrollment_fees (household_id, term_id);
create index if not exists pathshala_enrollment_fees_center_idx on app.pathshala_enrollment_fees (center_id, term_id, status);
comment on table app.pathshala_enrollment_fees is
  'The locked quote of one enrollment (0590; written by the registration functions from 0591): level fee, sibling discount, cap reduction, late fee, assistance and the total (the parts must add up), the rules it was priced with (rule_snapshot), its status (quoted, billed, paid, no_fee, cancelled, not_billed_giving_off) and the one fee pledge (pledges.source_ref_id = the enrollment). Kept off the enrollment row, which children read (finding F2). Read by the household''s adults, pathshala.manage and giving staff; never by children, teachers or the committee. Never re-priced, except a move to a level with another price (P26, 0592), recorded in requotes.';
comment on column app.pathshala_enrollment_fees.assistance_note is 'Private (fee assistance, P8): masked in the audit log.';
comment on column app.pathshala_enrollment_fees.priced is 'false: a "not sure of the level" learner (P25) or another line the office still has to price; priced when the office places them.';

drop trigger if exists touch_pathshala_enrollment_fees on app.pathshala_enrollment_fees;
create trigger touch_pathshala_enrollment_fees before update on app.pathshala_enrollment_fees
  for each row execute function app.touch_updated_at();

insert into app.module_tables (table_name, module_key) values
  ('pathshala_level_fees', 'pathshala'), ('pathshala_enrollment_fees', 'pathshala')
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_pathshala_level_fees on app.pathshala_level_fees;
create trigger audit_pathshala_level_fees after insert or update or delete on app.pathshala_level_fees
  for each row execute function app.audit_row();
drop trigger if exists audit_pathshala_enrollment_fees on app.pathshala_enrollment_fees;
create trigger audit_pathshala_enrollment_fees after insert or update or delete on app.pathshala_enrollment_fees
  for each row execute function app.audit_row();

alter table app.pathshala_level_fees enable row level security;
alter table app.pathshala_enrollment_fees enable row level security;
-- Members read a term's level fees once the term is out of Draft (as they read the term itself, 0010); staff always.
drop policy if exists pathshala_level_fees_read on app.pathshala_level_fees;
create policy pathshala_level_fees_read on app.pathshala_level_fees for select to authenticated
  using (app.has_permission(center_id, 'pathshala.view') or app.has_permission(center_id, 'pathshala.manage')
         or app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage')
         or (app.is_member_of(center_id)
             and exists (select 1 from app.pathshala_terms t where t.id = pathshala_level_fees.term_id and t.status <> 'draft')));
-- What a family is charged: the household's adults (never a child), the principal and giving staff.
drop policy if exists pathshala_enrollment_fees_read on app.pathshala_enrollment_fees;
create policy pathshala_enrollment_fees_read on app.pathshala_enrollment_fees for select to authenticated
  using (app.pathshala_adult_of_household(center_id, household_id)
         or app.has_permission(center_id, 'pathshala.manage')
         or app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage'));
do $$
declare t text;
begin
  foreach t in array array['pathshala_level_fees', 'pathshala_enrollment_fees'] loop
    execute format('drop policy if exists module_switch on app.%I', t);
    execute format($p$create policy module_switch on app.%I as restrictive for all to public
      using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('pathshala'))::uuid[])))
      with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('pathshala'))::uuid[])))$p$, t);
    -- No write policy and no write grant: the functions are the only way in.
    execute format('revoke all on app.%I from public, anon, authenticated, connect_worker', t);
    execute format('grant select on app.%I to authenticated', t);
    execute format('grant all on app.%I to service_role', t);
  end loop;
end $$;

-- The assistance note is private (P8): masked in the audit log. Starts from 0587's definition (the latest on main) plus
-- 0589's clause, copied verbatim from feat/upload-scan (it names only the 'homework' bucket, which 0587 made, so it is
-- safe without 0589); 0589 is to carry this file's clause too, so the two can merge in either order. Anyone who changes
-- app.audit_mask again must start from THIS one (0590):
--   0102   date_of_birth and the secrets / tokens
--   0546   the emergency contact's name and number, both dietary fields
--   0545   staged_rows (the uploaded rows, personal data) and merge_answers (they grow with the file)
--   0573   niva_tsv (derived search vector, dropped rather than masked)
--   0578   result.image_b64 (AI flyer art bytes in app.jobs.result)
--   0587   text_answer, parent_note, review_note (homework), and the file name of a homework part's storage_path
--   0589   the file name of a homework file in a row that names its bucket (app.upload_scans)
--   0590   assistance_note (Pathshala fee assistance)
create or replace function app.audit_mask(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - 'date_of_birth' - 'provider_ref' - 'fee_authorization_ref' - 'secret_ref' - 'niva_tsv'
      || case when j ? 'date_of_birth' then jsonb_build_object('date_of_birth', '***') else '{}'::jsonb end
      || case when j->>'ticket_token' is not null then jsonb_build_object('ticket_token', '***') else '{}'::jsonb end
      || case when j->>'attendance_token' is not null then jsonb_build_object('attendance_token', '***') else '{}'::jsonb end
      || case when j->>'token' is not null then jsonb_build_object('token', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_name' is not null then jsonb_build_object('emergency_contact_name', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_phone' is not null then jsonb_build_object('emergency_contact_phone', '***') else '{}'::jsonb end
      || case when j->>'dietary_other' is not null then jsonb_build_object('dietary_other', '***') else '{}'::jsonb end
      || case when j->'dietary' is not null and j->'dietary' <> '[]'::jsonb and j->'dietary' <> 'null'::jsonb
              then jsonb_build_object('dietary', '***') else '{}'::jsonb end
      || case when j ? 'staged_rows' then jsonb_build_object('staged_rows', '***') else '{}'::jsonb end
      || case when j ? 'merge_answers' then jsonb_build_object('merge_answers', '***') else '{}'::jsonb end
      || case when jsonb_typeof(j->'result') = 'object' and (j->'result') ? 'image_b64'
              then jsonb_build_object('result', (j->'result') || jsonb_build_object('image_b64', '***')) else '{}'::jsonb end
      || case when j->>'text_answer' is not null
              then jsonb_build_object('text_answer', '*** (' || char_length(j->>'text_answer') || ' characters)') else '{}'::jsonb end
      || case when j->>'parent_note' is not null
              then jsonb_build_object('parent_note', '*** (' || char_length(j->>'parent_note') || ' characters)') else '{}'::jsonb end
      || case when j->>'review_note' is not null
              then jsonb_build_object('review_note', '*** (' || char_length(j->>'review_note') || ' characters)') else '{}'::jsonb end
      || case when j->>'storage_path' ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[^/]+$'
              then jsonb_build_object('storage_path', regexp_replace(j->>'storage_path', '[^/]+$', '***')) else '{}'::jsonb end
      || case when coalesce(j->>'bucket_id', j->>'bucket') = 'homework'
                   and j->>'name' ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[^/]+$'
              then jsonb_build_object('name', regexp_replace(j->>'name', '[^/]+$', '***')) else '{}'::jsonb end
      || case when j->>'assistance_note' is not null
              then jsonb_build_object('assistance_note', '*** (' || char_length(j->>'assistance_note') || ' characters)') else '{}'::jsonb end
  end
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Who may set fees and rules (P9, P16)
-- ═════════════════════════════════════════════════════════════════════════════
-- Before the lock: pathshala.manage (or the treasurer). After it: giving.manage and a reason. Returns the reason to use.
create or replace function app._pathshala_assert_fee_editor(t app.pathshala_terms, p_reason text, p_what text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if t.status = 'closed' then
    raise exception '% is closed, so its % cannot change.', t.name, p_what using errcode = '22023';
  end if;
  if t.fees_locked_at is null then
    if not (app.has_permission(t.center_id, 'pathshala.manage') or app.has_permission(t.center_id, 'giving.manage')) then
      raise exception 'Setting the % of % needs pathshala.manage (the Pathshala principal).', p_what, t.name using errcode = '42501';
    end if;
    return app.audit_clean_reason(p_reason);
  end if;
  if not app.has_permission(t.center_id, 'giving.manage') then
    raise exception 'Registration for % is open, so its % are locked. The treasurer (giving.manage) can change them, with a reason; a change applies to new registrations only.',
      t.name, p_what using errcode = '42501';
  end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Registration for % is open: say why the % change. The reason is kept in the audit log.', t.name, p_what
      using errcode = '22023';
  end if;
  return app.audit_clean_reason(p_reason);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Pay now: may it be chosen? (§2.7, P20)
-- ═════════════════════════════════════════════════════════════════════════════
-- Card or PayPal payments work for this community right now: the plugin is on, the community does not take offline
-- payments only, the processor is test or live (live in production unless the community is held to test), and its
-- connection is connected (the same conditions app.member_payment_methods and app.create_checkout apply).
create or replace function app.pathshala_online_payments_ready(p_center uuid) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; v_forced boolean; r record;
begin
  select * into c from app.centers where id = p_center;
  if c.id is null or not app.module_enabled(p_center, 'giving') then return false; end if;
  if coalesce((c.rules #>> '{payments,offline_only}')::boolean, false) then return false; end if;
  v_forced := c.environment = 'sandbox' or app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb;
  for r in
    select cp.status, ic.status as conn
      from app.payment_plugins pl
      join app.center_payment_processors cp on cp.center_id = p_center and cp.processor = pl.provider
      left join app.integration_connections ic on ic.id = cp.connection_id
     where pl.key in ('card', 'paypal') and pl.status <> 'suspended' and app.payment_plugin_enabled(p_center, pl.key)
  loop
    if r.status in ('test', 'live') and (r.status = 'live' or v_forced) and r.conn = 'connected' then return true; end if;
  end loop;
  return false;
end $$;

-- Why pay now cannot be chosen (null = it can). The fee-receipt condition (P13) opens in 0595.
create or replace function app._pathshala_pay_now_problem(p_center uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app.module_enabled(p_center, 'giving') then
    return 'Pay at registration needs Pledges & donations switched on (Settings › Modules).';
  end if;
  if not app.pathshala_online_payments_ready(p_center) then
    return 'Pay at registration needs card or PayPal payments connected and taking payments (Settings › Payments).';
  end if;
  return 'Pay at registration waits for fee receipts (P13).';
end $$;

create or replace function app.pathshala_pay_now_ready(p_center uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'pathshala');
  if not (app.has_permission(p_center, 'pathshala.view') or app.has_permission(p_center, 'pathshala.manage')
          or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'Seeing whether pay at registration can be chosen needs pathshala.view.' using errcode = '42501';
  end if;
  return app._pathshala_pay_now_problem(p_center);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Fees and rules
-- ═════════════════════════════════════════════════════════════════════════════
-- p_fees: [{"level_id": "…", "fee_cents": 13000}, …]; fee_cents 0 is Free, null removes the fee (only before the lock).
create or replace function app.set_pathshala_level_fees(p_term uuid, p_fees jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; e jsonb; v_level uuid; v_fee bigint; l app.pathshala_levels; v_reason text; v_seen uuid[] := '{}';
        v_lines text[] := '{}'; v_set_levels uuid[] := '{}'; v_set_fees integer[] := '{}';
begin
  select * into t from app.pathshala_terms where id = p_term for update;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  v_reason := app._pathshala_assert_fee_editor(t, p_reason, 'fees');
  if p_fees is null or jsonb_typeof(p_fees) <> 'array' or jsonb_array_length(p_fees) = 0 then
    raise exception 'Choose at least one level and its fee.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_fees) > 200 then raise exception 'Set at most 200 fees at a time.' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p_fees) loop
    if jsonb_typeof(e) <> 'object' then raise exception 'Each fee is a level and an amount.' using errcode = '22023'; end if;
    v_level := app._pathshala_uuid(e, 'level_id', 'The level');
    if v_level is null then raise exception 'Choose the level for each fee.' using errcode = '22023'; end if;
    select * into l from app.pathshala_levels where id = v_level and center_id = t.center_id;
    if l.id is null then raise exception 'That level is not one of this community''s levels.' using errcode = '22023'; end if;
    if v_level = any (v_seen) then raise exception '% is listed twice.', l.name using errcode = '22023'; end if;
    v_seen := v_seen || v_level;
    v_fee := app._pathshala_int(e, 'fee_cents', 'The fee of ' || l.name);
    if v_fee is null then
      if t.fees_locked_at is not null and exists (select 1 from app.pathshala_classes c where c.term_id = t.id and c.level_id = l.id) then
        raise exception '% has a class in %, so its fee cannot be removed while registration is open.', l.name, t.name using errcode = '22023';
      end if;
      perform app.set_audit_context(coalesce(v_reason, 'Removed the Pathshala fee of ' || l.name || ' for ' || t.name));
      delete from app.pathshala_level_fees where term_id = t.id and level_id = l.id;
      v_lines := v_lines || (l.name || ' no fee');
      continue;
    end if;
    if v_fee < 0 or (v_fee between 1 and 49) then
      raise exception 'A fee is $0 (Free) or at least $0.50 (% was %).', l.name, app.pathshala_money(v_fee) using errcode = '22023';
    end if;
    if v_fee > 100000000 then raise exception 'A fee can be at most $1,000,000.' using errcode = '22023'; end if;
    v_lines := v_lines || (l.name || ' ' || case when v_fee = 0 then 'Free' else app.pathshala_money(v_fee) end);
    v_set_levels := v_set_levels || l.id;
    v_set_fees := v_set_fees || v_fee::integer;
  end loop;
  perform app.set_audit_context(coalesce(v_reason, left('Set Pathshala fees for ' || t.name || ': ' || array_to_string(v_lines, ', '), 500)));
  insert into app.pathshala_level_fees (center_id, term_id, level_id, fee_cents, set_by, set_at)
  select t.center_id, t.id, x.level_id, x.fee_cents, auth.uid(), now()
    from unnest(v_set_levels, v_set_fees) as x(level_id, fee_cents)
  on conflict (term_id, level_id) do update
     set fee_cents = excluded.fee_cents, set_by = excluded.set_by, set_at = excluded.set_at
   where app.pathshala_level_fees.fee_cents is distinct from excluded.fee_cents;
  return app._pathshala_fees_json(t.id);
end $$;

create or replace function app._pathshala_fees_json(p_term uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'term_id', t.id, 'locked', t.fees_locked_at is not null,
    'fees', coalesce((select jsonb_agg(jsonb_build_object('level_id', f.level_id, 'level', l.name, 'track_id', l.track_id,
                                                          'fee_cents', f.fee_cents, 'set_at', f.set_at)
                                       order by tr.name, l.sort_order, l.name)
                        from app.pathshala_level_fees f join app.pathshala_levels l on l.id = f.level_id
                        join app.pathshala_tracks tr on tr.id = l.track_id
                       where f.term_id = t.id), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('level_id', l.id, 'level', l.name, 'track_id', l.track_id)
                                          order by tr.name, l.sort_order, l.name)
                           from app.pathshala_levels l join app.pathshala_tracks tr on tr.id = l.track_id
                          where l.active and exists (select 1 from app.pathshala_classes c where c.term_id = t.id and c.level_id = l.id)
                            and not exists (select 1 from app.pathshala_level_fees f where f.term_id = t.id and f.level_id = l.id)), '[]'::jsonb))
    from app.pathshala_terms t where t.id = p_term
$$;

-- The term's rules as the screens and the member app read them (§2.17 "term"), plus what the Fees screen needs.
create or replace function app._pathshala_term_json(p_term uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; d app.legal_documents;
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then return null; end if;
  select * into d from app.legal_documents
   where center_id = t.center_id and kind = 'pathshala_waiver' and published_at is not null and published_at <= now()
   order by published_at desc limit 1;
  return jsonb_build_object(
    'id', t.id, 'name', t.name, 'starts_on', t.starts_on, 'ends_on', t.ends_on, 'status', t.status,
    'window', app.pathshala_registration_window(t.id),
    'payment_mode', t.payment_mode, 'hold_hours', t.hold_hours,
    'office_payment', jsonb_build_object('allowed', t.office_payment_allowed, 'hold_days', t.office_hold_days),
    'seat_rule', t.seat_rule,
    'withdrawal_credit_until', app.pathshala_withdrawal_deadline(t.id),
    'age_cutoff_on', app.pathshala_age_cutoff(t.id),
    'membership_required', t.membership_required,
    'waiver', case when d.id is null then null
                   else jsonb_build_object('document_id', d.id, 'title', d.title, 'version', d.version) end,
    'sibling_discount_pct', t.sibling_discount_pct,
    'family_cap_cents', case when t.fee_per_family_cap_cents > 0 then t.fee_per_family_cap_cents end,
    'first_class_on', app.pathshala_first_class_day(t.id),
    'fees_locked_at', t.fees_locked_at, 'campaign_id', t.campaign_id, 'fund_id', t.fund_id);
end $$;

-- Keys: payment_mode, hold_hours, office_payment_allowed, office_hold_days, seat_rule, sibling_discount_pct,
-- fee_per_family_cap_cents (null: no cap), registration_opens_at, registration_closes_at, late_registration_closes_at,
-- late_fee_cents, withdrawal_credit_until, age_cutoff_on (null: the default), membership_required, fund_id
-- (giving.manage). A key left out keeps its value. After registration opens these are locked rules: the treasurer,
-- with a reason.
create or replace function app.set_pathshala_term_rules(p_term uuid, p_rules jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; n app.pathshala_terms; v_bad text; v_reason text; v_problem text; v_n bigint; v_fund uuid;
begin
  select * into t from app.pathshala_terms where id = p_term for update;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  v_reason := app._pathshala_assert_fee_editor(t, p_reason, 'fee rules');
  if p_rules is null or jsonb_typeof(p_rules) <> 'object' then raise exception 'Send the rules to change.' using errcode = '22023'; end if;
  select k into v_bad from jsonb_object_keys(p_rules) k
   where k not in ('payment_mode', 'hold_hours', 'office_payment_allowed', 'office_hold_days', 'seat_rule', 'sibling_discount_pct',
                   'fee_per_family_cap_cents', 'registration_opens_at', 'registration_closes_at', 'late_registration_closes_at',
                   'late_fee_cents', 'withdrawal_credit_until', 'age_cutoff_on', 'membership_required', 'fund_id') limit 1;
  if v_bad is not null then raise exception 'A term has no rule called "%".', v_bad using errcode = '22023'; end if;
  n := t;
  if p_rules ? 'payment_mode' then
    n.payment_mode := lower(btrim(coalesce(p_rules ->> 'payment_mode', '')));
    if n.payment_mode not in ('pledge', 'pay_now') then
      raise exception 'The payment mode is Pledge (pay later) or Pay now (pay while registering).' using errcode = '22023';
    end if;
    if n.payment_mode = 'pay_now' and t.payment_mode <> 'pay_now' then
      v_problem := app._pathshala_pay_now_problem(t.center_id);
      if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
    end if;
  end if;
  if p_rules ? 'seat_rule' then
    n.seat_rule := lower(btrim(coalesce(p_rules ->> 'seat_rule', '')));
    if n.seat_rule not in ('automatic', 'office') then
      raise exception 'Seats are given automatically, or the office confirms every registration.' using errcode = '22023';
    end if;
  end if;
  if n.seat_rule = 'office' and n.payment_mode <> 'pledge' then
    raise exception 'The office step works only with Pledge: in a pay-now term the seat is decided when the family registers.' using errcode = '22023';
  end if;
  if p_rules ? 'hold_hours' then
    v_n := app._pathshala_int(p_rules, 'hold_hours', 'The hold');
    if v_n is null or v_n not between 1 and 168 then raise exception 'A seat is held for 1 to 168 hours (7 days) while the family pays.' using errcode = '22023'; end if;
    n.hold_hours := v_n;
  end if;
  if p_rules ? 'office_payment_allowed' then
    n.office_payment_allowed := coalesce(app._pathshala_bool(p_rules, 'office_payment_allowed', 'Pay at the office'), false);
  end if;
  if p_rules ? 'office_hold_days' then
    v_n := app._pathshala_int(p_rules, 'office_hold_days', 'The office hold');
    if v_n is null or v_n not between 1 and 21 then raise exception 'A seat waiting for payment at the office is held 1 to 21 days.' using errcode = '22023'; end if;
    n.office_hold_days := v_n;
  end if;
  if p_rules ? 'sibling_discount_pct' then
    v_n := app._pathshala_int(p_rules, 'sibling_discount_pct', 'The sibling discount');
    if v_n is null or v_n not between 0 and 100 then raise exception 'The sibling discount is 0 to 100 percent.' using errcode = '22023'; end if;
    n.sibling_discount_pct := v_n;
  end if;
  if p_rules ? 'fee_per_family_cap_cents' then
    v_n := app._pathshala_int(p_rules, 'fee_per_family_cap_cents', 'The family cap');
    if v_n is not null and (v_n < 50 or v_n > 100000000) then
      raise exception 'A family cap is at least $0.50 (at most $1,000,000); leave it empty for no cap.' using errcode = '22023';
    end if;
    n.fee_per_family_cap_cents := v_n;
  end if;
  if p_rules ? 'late_fee_cents' then
    v_n := coalesce(app._pathshala_int(p_rules, 'late_fee_cents', 'The late fee'), 0);
    if v_n < 0 or v_n between 1 and 49 or v_n > 100000000 then
      raise exception 'A late fee is $0 or at least $0.50.' using errcode = '22023';
    end if;
    n.late_fee_cents := v_n;
  end if;
  if p_rules ? 'registration_opens_at' then
    n.registration_opens_at := app._pathshala_ts(p_rules, 'registration_opens_at', 'When registration opens');
  end if;
  if p_rules ? 'registration_closes_at' then
    n.registration_closes_at := app._pathshala_ts(p_rules, 'registration_closes_at', 'When registration closes');
  end if;
  if n.registration_opens_at is not null and n.registration_closes_at is not null and n.registration_closes_at <= n.registration_opens_at then
    raise exception 'Registration must close after it opens.' using errcode = '22023';
  end if;
  if p_rules ? 'late_registration_closes_at' then
    n.late_registration_closes_at := app._pathshala_ts(p_rules, 'late_registration_closes_at', 'The end of the late window');
  end if;
  if n.late_registration_closes_at is not null then
    if n.registration_closes_at is null then
      raise exception 'Set when registration closes (on the term) before adding a late window.' using errcode = '22023';
    end if;
    if n.late_registration_closes_at <= n.registration_closes_at then
      raise exception 'The late window must end after registration closes.' using errcode = '22023';
    end if;
  end if;
  if p_rules ? 'membership_required' then
    n.membership_required := coalesce(app._pathshala_bool(p_rules, 'membership_required', 'Membership required'), n.membership_required);
  end if;
  if p_rules ? 'withdrawal_credit_until' then
    n.withdrawal_credit_until := app._pathshala_date(p_rules, 'withdrawal_credit_until', 'The withdrawal deadline');
    if n.withdrawal_credit_until is not null and n.withdrawal_credit_until not between t.starts_on - 90 and t.ends_on then
      raise exception 'The withdrawal deadline must fall before the term ends (%).', to_char(t.ends_on, 'FMMon FMDD, YYYY') using errcode = '22023';
    end if;
  end if;
  if p_rules ? 'age_cutoff_on' then
    n.age_cutoff_on := app._pathshala_date(p_rules, 'age_cutoff_on', 'The age cut-off date');
    if n.age_cutoff_on is not null and n.age_cutoff_on not between t.starts_on - 366 and t.ends_on then
      raise exception 'The age cut-off date must be within a year before the term starts, or during the term.' using errcode = '22023';
    end if;
  end if;
  if p_rules ? 'fund_id' then
    if not app.has_permission(t.center_id, 'giving.manage') then
      raise exception 'Choosing the fund for Pathshala fees needs giving.manage (the treasurer).' using errcode = '42501';
    end if;
    v_fund := app._pathshala_uuid(p_rules, 'fund_id', 'The fund');
    -- Every fee pledge carries the term's fund (0591): once registration has opened it can change, never be emptied.
    if v_fund is null and t.fees_locked_at is not null then
      raise exception 'The fund for the Pathshala fees cannot be cleared once registration has opened. Choose another fund instead.'
        using errcode = '22023';
    end if;
    if v_fund is not null and not exists (select 1 from app.funds f where f.id = v_fund and f.center_id = t.center_id and f.active) then
      raise exception 'Choose one of this community''s active funds.' using errcode = '22023';
    end if;
    n.fund_id := v_fund;
  end if;
  perform app.set_audit_context(coalesce(v_reason, 'Changed the Pathshala fee rules of ' || t.name));
  update app.pathshala_terms
     set payment_mode = n.payment_mode, hold_hours = n.hold_hours, office_payment_allowed = n.office_payment_allowed,
         office_hold_days = n.office_hold_days, seat_rule = n.seat_rule, sibling_discount_pct = n.sibling_discount_pct,
         fee_per_family_cap_cents = n.fee_per_family_cap_cents, late_registration_closes_at = n.late_registration_closes_at,
         late_fee_cents = n.late_fee_cents, withdrawal_credit_until = n.withdrawal_credit_until, age_cutoff_on = n.age_cutoff_on,
         registration_opens_at = n.registration_opens_at, registration_closes_at = n.registration_closes_at,
         membership_required = n.membership_required, fund_id = n.fund_id
   where id = t.id;
  if t.campaign_id is not null and n.fund_id is distinct from t.fund_id and n.fund_id is not null then
    update app.campaigns set fund_id = n.fund_id where id = t.campaign_id;
  end if;
  return app._pathshala_term_json(t.id);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Opening registration (§2.2, §2.11)
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function app.open_pathshala_registration(p_term uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; v_missing text; v_problem text; v_fund uuid; v_campaign uuid; v_warn jsonb; v_name text;
begin
  select * into t from app.pathshala_terms where id = p_term for update;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not app.has_permission(t.center_id, 'pathshala.manage') then
    raise exception 'Opening registration needs pathshala.manage (the Pathshala principal).' using errcode = '42501';
  end if;
  if t.status = 'closed' then raise exception '% is closed, so registration cannot open.', t.name using errcode = '22023'; end if;
  if t.fees_locked_at is not null then
    return jsonb_build_object('term_id', t.id, 'status', t.status, 'already_open', true, 'fees_locked_at', t.fees_locked_at,
                              'campaign_id', t.campaign_id, 'fund_id', t.fund_id, 'payment_mode', t.payment_mode, 'warnings', '[]'::jsonb);
  end if;
  -- Every offered level (an active level with a class this term) needs its fee.
  select string_agg(l.name, ', ' order by tr.name, l.sort_order, l.name) into v_missing
    from app.pathshala_levels l join app.pathshala_tracks tr on tr.id = l.track_id
   where l.center_id = t.center_id and l.active
     and exists (select 1 from app.pathshala_classes c where c.term_id = t.id and c.level_id = l.id)
     and not exists (select 1 from app.pathshala_level_fees f where f.term_id = t.id and f.level_id = l.id);
  if v_missing is not null then
    raise exception 'Set the fee for % before opening registration.', regexp_replace(v_missing, ', ([^,]+)$', ' and \1')
      using errcode = '22023';
  end if;
  if t.payment_mode = 'pay_now' then
    v_problem := app._pathshala_pay_now_problem(t.center_id);
    if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  end if;
  -- The money side: the closed campaign "Pathshala fees <term>" linked to the Pathshala fund (Giving on only; with
  -- Giving off registration still works and every quote is kept "not billed").
  if app.module_enabled(t.center_id, 'giving') then
    v_fund := coalesce(t.fund_id,
      (select f.id from app.funds f where f.center_id = t.center_id and f.active and (f.key = 'pathshala' or f.name ~* '^\s*pathshala')
        order by (f.key = 'pathshala') desc, f.name limit 1));
    if v_fund is null then
      -- A treasurer with giving.manage but not pathshala.view cannot read a draft term, so cannot open its Fees screen:
      -- the way out is a fund called Pathshala added in Setup › Lists (found by name above), or a principal who also
      -- manages Giving choosing one here. Read access to draft terms is not widened.
      raise exception 'There is no fund for the Pathshala fees yet. Ask the treasurer to add a fund called Pathshala in Setup › Lists, or choose a fund on this Fees screen if you also manage Giving; then open registration.'
        using errcode = '22023';
    end if;
    v_name := left('Pathshala fees ' || t.name, 200);
    v_campaign := coalesce(t.campaign_id,
      (select c.id from app.campaigns c where c.center_id = t.center_id and c.kind = 'pathshala' and c.name = v_name
        order by c.created_at limit 1));
    if v_campaign is null then
      perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'Opened Pathshala registration for ' || t.name));
      insert into app.campaigns (center_id, fund_id, name, kind, description, starts_on, ends_on, status, created_by)
      values (t.center_id, v_fund, v_name, 'pathshala', 'Pathshala fees for ' || t.name || ' (one pledge per learner and track).',
              t.starts_on, t.ends_on, 'closed', auth.uid())
      returning id into v_campaign;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('level_id', l.id, 'level', l.name,
                                               'sentence', l.name || ' has no age band, so the app cannot suggest it by age.')
                            order by tr.name, l.sort_order), '[]'::jsonb) into v_warn
    from app.pathshala_levels l join app.pathshala_tracks tr on tr.id = l.track_id
   where l.center_id = t.center_id and l.active and l.min_age is null and l.max_age is null
     and exists (select 1 from app.pathshala_classes c where c.term_id = t.id and c.level_id = l.id);
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason),
    'Opened Pathshala registration for ' || t.name || ' (' || case t.payment_mode when 'pay_now' then 'pay now' else 'pledge mode' end
    || '; fees and rules locked)'));
  update app.pathshala_terms
     set fees_locked_at = now(), fees_locked_by = auth.uid(),
         age_cutoff_on = coalesce(age_cutoff_on, starts_on),
         withdrawal_credit_until = coalesce(withdrawal_credit_until, app.pathshala_first_class_day(id) + 14),
         campaign_id = coalesce(v_campaign, campaign_id), fund_id = coalesce(v_fund, fund_id),
         status = case when status = 'draft' then 'registration' else status end
   where id = t.id
  returning * into t;
  return jsonb_build_object('term_id', t.id, 'status', t.status, 'already_open', false, 'fees_locked_at', t.fees_locked_at,
                            'campaign_id', t.campaign_id, 'fund_id', t.fund_id, 'payment_mode', t.payment_mode, 'warnings', v_warn);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Seats (§2.5). 0590 counts placed and active learners; 0591 adds the seats held for payment.
-- ═════════════════════════════════════════════════════════════════════════════
-- seats: the sum of the capacities of the level's classes this term (null: a class has no limit, so no limit);
-- taken: placed and active learners in those classes; held: seats held for payment (0591); free: what is left (null: no
-- limit); waitlist: learners waiting for the level; waitlist_on: a class of the level has "Waitlist when full".
create or replace function app.pathshala_level_seats(p_term uuid, p_level uuid)
returns table (classes integer, seats integer, taken integer, held integer, free integer, waitlist integer, waitlist_on boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_unlimited boolean;
begin
  select count(*)::int, case when count(*) filter (where c.capacity is null) > 0 then null else coalesce(sum(c.capacity), 0)::int end,
         coalesce(bool_or(c.waitlist_enabled), false)
    into classes, seats, waitlist_on
    from app.pathshala_classes c where c.term_id = p_term and c.level_id = p_level;
  select count(*)::int into taken from app.pathshala_enrollments e join app.pathshala_classes c on c.id = e.class_id
   where c.term_id = p_term and c.level_id = p_level and e.status in ('placed', 'active');
  held := 0;
  v_unlimited := classes > 0 and seats is null;
  free := case when classes = 0 then 0 when v_unlimited then null else greatest(seats - taken - held, 0) end;
  select count(*)::int into waitlist from app.pathshala_enrollments e left join app.pathshala_classes c on c.id = e.class_id
   where e.term_id = p_term and e.status = 'waitlisted' and coalesce(c.level_id, e.requested_level_id) = p_level;
  return next;
end $$;

-- open (a free seat, or no limit), waitlist (full, and a class takes a waitlist) or full.
create or replace function app.pathshala_seat_state(p_free integer, p_classes integer, p_waitlist_on boolean) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when coalesce(p_classes, 0) > 0 and (p_free is null or p_free > 0) then 'open'
              when coalesce(p_waitlist_on, false) and coalesce(p_classes, 0) > 0 then 'waitlist'
              else 'full' end
$$;

-- Per offered level: members see the counts (no names); staff the same.
create or replace function app.pathshala_seats(p_term uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms;
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  if not (app.has_permission(t.center_id, 'pathshala.view') or app.has_permission(t.center_id, 'pathshala.manage')
          or (app.is_member_of(t.center_id) and t.status <> 'draft')) then
    raise exception 'Only members of this community can see the seats of its Pathshala classes.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('level_id', l.id, 'level', l.name, 'track_id', l.track_id, 'track', tr.name,
                                        'fee_cents', f.fee_cents, 'classes', s.classes, 'seats', s.seats, 'taken', s.taken,
                                        'held', s.held, 'free', s.free, 'waitlist', s.waitlist, 'waitlist_on', s.waitlist_on,
                                        'state', app.pathshala_seat_state(s.free, s.classes, s.waitlist_on))
                     order by tr.name, l.sort_order, l.name)
      from app.pathshala_levels l
      join app.pathshala_tracks tr on tr.id = l.track_id
      left join app.pathshala_level_fees f on f.term_id = t.id and f.level_id = l.id
      cross join lateral app.pathshala_level_seats(t.id, l.id) s
     where l.center_id = t.center_id and l.active and s.classes > 0), '[]'::jsonb);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The pricing rule: ONE function (§2.4)
-- ═════════════════════════════════════════════════════════════════════════════
-- The household's lines already registered this term that a new quote builds on: the children's ranks, what their lines
-- count toward the cap (after discount, before the late fee and assistance), and who already paid a late fee. 0591
-- adds the children waiting to be added to the family (pending registrations).
create or replace function app._pathshala_existing_lines(p_term uuid, p_household uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'rank_max', coalesce((select max(f.family_rank) from app.pathshala_enrollment_fees f join app.pathshala_enrollments en on en.id = f.enrollment_id
                           where f.term_id = p_term and f.household_id = p_household and f.learner_kind = 'child'
                             and f.status <> 'cancelled' and en.status <> 'withdrawn'), 0),
    'running', coalesce((select sum(f.base_fee_cents - f.sibling_discount_cents - f.cap_reduction_cents)
                           from app.pathshala_enrollment_fees f join app.pathshala_enrollments en on en.id = f.enrollment_id
                          where f.term_id = p_term and f.household_id = p_household and f.learner_kind = 'child' and f.priced
                            and f.status <> 'cancelled' and en.status <> 'withdrawn'), 0),
    'ranks', coalesce((select jsonb_object_agg(x.person::text, x.rank)
                         from (select en.student_person_id as person, min(f.family_rank) as rank
                                 from app.pathshala_enrollment_fees f join app.pathshala_enrollments en on en.id = f.enrollment_id
                                where f.term_id = p_term and f.household_id = p_household and f.learner_kind = 'child'
                                  and f.status <> 'cancelled' and en.status <> 'withdrawn'
                                group by en.student_person_id) x), '{}'::jsonb),
    'late_paid', coalesce((select jsonb_agg(distinct en.student_person_id)
                             from app.pathshala_enrollment_fees f join app.pathshala_enrollments en on en.id = f.enrollment_id
                            where f.term_id = p_term and f.late_fee_cents > 0 and f.status <> 'cancelled' and en.status <> 'withdrawn'
                              and en.household_id = p_household), '[]'::jsonb))
$$;

-- p_lines: [{person_id | new_child: {first_name, last_name, date_of_birth, relationship}, track_id, level_id | null}]
-- (pathshala_fee_example also passes hypothetical learners: {learner, name, age | date_of_birth, learner_kind, track_id,
-- level_id}). Already registered children of the household this term (not withdrawn, not cancelled) count first: they
-- keep their rank, their lines are never re-priced and count toward the cap. Returns {lines[], children_total_cents,
-- adults_total_cents, total_cents, late, rule_snapshot}; each line {index, person_id, track_id, level_id, learner_kind,
-- family_rank, age_on_cutoff, base_fee_cents, sibling_discount_cents, cap_reduction_cents, late_fee_cents,
-- assistance_cents, total_cents, priced}. A chosen level without a fee is refused, never guessed. Reads only (no
-- temporary tables: a read-only transaction can call it).
-- Hypothetical lines ("Try a family") price exactly as a registration does: lines with the same `learner` (trimmed, any
-- case) are ONE learner (one child for the sibling order and the cap, one late fee: P10), and each line carries `refusal`,
-- null or the sentence a registration would refuse it with (app._pathshala_plan); a refused line is not priced (every
-- amount 0, out of the totals and the sibling order).
create or replace function app._pathshala_price(p_term uuid, p_household uuid, p_lines jsonb, p_late boolean, p_hypothetical boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; v_cut date; v_pct int; v_cap bigint; v_late_fee bigint; e jsonb; i int := 0; r record;
        v_rank_next int := 0; v_running bigint := 0; v_take bigint; v_disc bigint; v_red bigint; v_dob date; v_kind text;
        v_person uuid; v_level uuid; v_fee integer; l app.pathshala_levels; v_rows jsonb := '[]'::jsonb; v_key text;
        v_children bigint := 0; v_adults bigint := 0; v_late_done text[] := '{}'; v_rel text; v_ranks jsonb := '{}'::jsonb;
        v_calc jsonb := '{}'::jsonb; v_existing jsonb; v_out jsonb := '[]'::jsonb; x jsonb; v_rank int; v_age bigint;
        v_base bigint; v_late bigint; v_total bigint; v_track uuid;
        -- "Try a family" only: who each named learner is, each line's refusal, the tracks each learner already has
        v_learner text; v_name text; v_people jsonb := '{}'::jsonb; v_refusal text; v_says boolean; v_band text;
        v_age_on int; v_seen text[] := '{}';
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  v_cut := app.pathshala_age_cutoff(t.id);
  v_pct := least(greatest(coalesce(t.sibling_discount_pct, 0), 0), 100);
  -- A cap of $0 or less (an old row) is no cap: it would make every child free (review C11).
  v_cap := case when t.fee_per_family_cap_cents > 0 then t.fee_per_family_cap_cents end;
  v_late_fee := case when p_late then greatest(coalesce(t.late_fee_cents, 0), 0) else 0 end;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'Send the learners as a list.' using errcode = '22023'; end if;

  for e in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    if jsonb_typeof(e) <> 'object' then raise exception 'Each learner is a person and a track.' using errcode = '22023'; end if;
    v_person := app._pathshala_uuid(e, 'person_id', 'The learner');
    v_level := app._pathshala_uuid(e, 'level_id', 'The level');
    v_track := app._pathshala_uuid(e, 'track_id', 'The track');
    v_dob := null; v_kind := null; v_refusal := null; v_name := null;
    if v_person is not null then
      select p.date_of_birth, coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) into v_dob, v_name
        from app.people p where p.id = v_person and p.center_id = t.center_id;
      if not found then raise exception 'That learner was not found in this community.' using errcode = '22023'; end if;
      v_kind := case when app.pathshala_counts_as_child(v_person, v_cut) then 'child' else 'adult' end;
      v_key := v_person::text;
    elsif jsonb_typeof(e -> 'new_child') = 'object' then
      v_dob := app._pathshala_date(e -> 'new_child', 'date_of_birth', 'The date of birth');
      v_rel := lower(coalesce(nullif(btrim(e -> 'new_child' ->> 'relationship'), ''), 'child'));
      v_kind := case when v_dob is not null then case when v_dob > (v_cut - interval '18 years')::date then 'child' else 'adult' end
                     when v_rel in ('child', 'grandchild', 'son', 'daughter') then 'child' else 'adult' end;
      v_key := 'new:' || i;
    elsif p_hypothetical then
      v_learner := null;
      if e ? 'learner' and jsonb_typeof(e -> 'learner') <> 'null' then
        v_learner := case when jsonb_typeof(e -> 'learner') = 'string' then btrim(e ->> 'learner') end;
        if v_learner is null or char_length(v_learner) not between 1 and 80 then
          raise exception 'A learner''s name is 1 to 80 characters.' using errcode = '22023';
        end if;
      end if;
      v_dob := app._pathshala_date(e, 'date_of_birth', 'The date of birth');
      v_age := app._pathshala_int(e, 'age', 'The age');
      if v_dob is null and v_age is not null then
        if v_age not between 0 and 120 then raise exception 'An age is 0 to 120.' using errcode = '22023'; end if;
        v_dob := (v_cut - make_interval(years => v_age::int) - interval '1 day')::date;
      end if;
      v_kind := lower(coalesce(nullif(btrim(e ->> 'learner_kind'), ''),
                               case when v_dob is not null and v_dob <= (v_cut - interval '18 years')::date then 'adult' else 'child' end));
      if v_kind not in ('child', 'adult') then raise exception 'A learner is a child or an adult.' using errcode = '22023'; end if;
      v_name := coalesce(v_learner, nullif(btrim(e ->> 'name'), ''), 'Learner ' || i);
      if v_learner is null then
        v_key := 'example:' || i;
      else
        -- One learner in several lines (P10): what a later line leaves out comes from the learner's first line, and what it
        -- says must agree with it.
        v_key := 'learner:' || lower(v_learner);
        if v_people ? v_key then
          v_says := nullif(btrim(e ->> 'date_of_birth'), '') is not null or nullif(btrim(e ->> 'age'), '') is not null
                    or nullif(btrim(e ->> 'learner_kind'), '') is not null;
          if (v_dob is not null and (v_people -> v_key ->> 'dob') is not null and (v_people -> v_key ->> 'dob')::date <> v_dob)
             or (v_says and (v_people -> v_key ->> 'kind') <> v_kind) then
            raise exception '% is listed with two different ages.', v_people -> v_key ->> 'name' using errcode = '22023';
          end if;
          v_dob := (v_people -> v_key ->> 'dob')::date;
          v_kind := v_people -> v_key ->> 'kind';
          v_name := v_people -> v_key ->> 'name';
        else
          v_people := v_people || jsonb_build_object(v_key, jsonb_build_object('dob', v_dob, 'kind', v_kind, 'name', v_learner));
        end if;
      end if;
    else
      raise exception 'Choose who is joining (a member of the household, or a new child).' using errcode = '22023';
    end if;
    v_fee := 0;
    if v_level is not null then
      select * into l from app.pathshala_levels where id = v_level and center_id = t.center_id;
      if l.id is null then raise exception 'That level is not one of this community''s levels.' using errcode = '22023'; end if;
      select f.fee_cents into v_fee from app.pathshala_level_fees f where f.term_id = t.id and f.level_id = l.id;
      if not found then
        if not p_hypothetical then
          raise exception '% has no fee for % yet, so it cannot be chosen.', l.name, t.name using errcode = '22023';
        end if;
        v_refusal := format('%s has no fee for %s yet, so it cannot be chosen.', l.name, t.name);
        v_fee := 0;
      end if;
    end if;
    if p_hypothetical then
      -- The sentence a registration would refuse this line with (app._pathshala_plan), the first that applies. Seats are
      -- not looked at: a hypothetical family takes none.
      if v_track is not null and not exists (select 1 from app.pathshala_tracks tr where tr.id = v_track and tr.center_id = t.center_id) then
        raise exception 'That track is not one of this community''s tracks.' using errcode = '22023';
      end if;
      if v_level is not null then
        if v_refusal is null and v_track is not null and l.track_id <> v_track then
          v_refusal := format('That level is not in the %s track.', (select tr.name from app.pathshala_tracks tr where tr.id = v_track));
        end if;
        v_track := coalesce(v_track, l.track_id);
        if v_refusal is null and (not l.active or not exists (select 1 from app.pathshala_classes c where c.term_id = t.id and c.level_id = l.id)) then
          v_refusal := format('%s is not offered in %s.', l.name, t.name);
        end if;
        if v_refusal is null then
          v_band := app.pathshala_level_band(l.min_age, l.max_age);
          v_age_on := app.pathshala_age_on(v_dob, v_cut);
          if v_band = 'adult' and v_kind = 'child' then
            v_refusal := format('%s is for adults, and %s is %s.', l.name, v_name, coalesce(v_age_on::text, 'a child'));
          elsif v_band = 'children' and v_kind = 'adult' then
            v_refusal := format('%s is a children''s class, and %s is an adult.', l.name, v_name);
          end if;
        end if;
      elsif v_track is null then
        v_refusal := format('Choose a track (Jainism, Gujarati, Hindi …) for %s.', v_name);
      elsif t.payment_mode = 'pay_now' then
        v_refusal := format('Choose a level for %s: in %s the fee is paid when you register. Not sure? Keep the suggested level: the teacher can move %s in the first weeks.',
                            v_name, t.name, v_name);
      end if;
      -- One enrollment per learner per track (P10), among the lines that are not refused.
      if v_refusal is null then
        if (v_key || ':' || v_track::text) = any (v_seen) then
          v_refusal := format('%s is listed twice for %s.', v_name, (select tr.name from app.pathshala_tracks tr where tr.id = v_track));
        else
          v_seen := v_seen || (v_key || ':' || v_track::text);
        end if;
      end if;
    end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'idx', i, 'person_id', v_person, 'key', v_key, 'track_id', v_track,
      'level_id', v_level, 'kind', v_kind, 'dob', v_dob, 'age', app.pathshala_age_on(v_dob, v_cut),
      'base', case when v_refusal is null then coalesce(v_fee, 0) else 0 end,
      'priced', v_level is not null and v_refusal is null,
      'refused', v_refusal is not null, 'refusal', v_refusal));
  end loop;

  -- Children already registered this term keep their rank and count toward the cap first.
  if p_household is not null and not p_hypothetical then
    v_existing := app._pathshala_existing_lines(t.id, p_household);
    v_rank_next := coalesce((v_existing ->> 'rank_max')::int, 0);
    v_running := coalesce((v_existing ->> 'running')::bigint, 0);
    v_ranks := coalesce(v_existing -> 'ranks', '{}'::jsonb);
  else
    v_existing := jsonb_build_object('late_paid', '[]'::jsonb);
  end if;

  -- New children: by their highest level fee, then oldest first (no birth date last), then the order given (P2). A
  -- refused line ("Try a family") does not count.
  for r in
    select x2 ->> 'key' as k
      from jsonb_array_elements(v_rows) x2
     where x2 ->> 'kind' = 'child' and not (x2 ->> 'refused')::boolean and not (v_ranks ? coalesce(x2 ->> 'person_id', ''))
     group by x2 ->> 'key'
     order by max((x2 ->> 'base')::bigint) desc, min((x2 ->> 'dob')::date) asc nulls last, min((x2 ->> 'idx')::int)
  loop
    v_rank_next := v_rank_next + 1;
    v_calc := v_calc || jsonb_build_object('rank:' || r.k, v_rank_next);
  end loop;

  -- The sibling discount and the cap: children's lines in rank order (within a child, the dearer line first).
  for r in
    select (x2 ->> 'idx')::int as idx, (x2 ->> 'base')::bigint as base, (x2 ->> 'priced')::boolean as priced,
           coalesce((v_ranks ->> (x2 ->> 'person_id'))::int, (v_calc ->> ('rank:' || (x2 ->> 'key')))::int) as rank
      from jsonb_array_elements(v_rows) x2
     where x2 ->> 'kind' = 'child' and not (x2 ->> 'refused')::boolean
     order by 4, 2 desc, 1
  loop
    v_disc := case when r.rank > 1 and r.priced then round(r.base * v_pct / 100.0)::bigint else 0 end;
    v_take := r.base - v_disc;
    v_red := 0;
    if r.priced and v_cap is not null then
      if v_running >= v_cap then v_red := v_take;
      elsif v_running + v_take > v_cap then v_red := v_running + v_take - v_cap;
      end if;
    end if;
    if r.priced then v_running := v_running + v_take - v_red; end if;
    v_calc := v_calc || jsonb_build_object('line:' || r.idx, jsonb_build_object('rank', r.rank, 'disc', v_disc, 'red', v_red));
  end loop;

  -- The late fee: once per learner (their first priced line), adults included, outside the discount and the cap; not
  -- again for a learner whose earlier registration this term already carries one.
  for x in select x2 from jsonb_array_elements(v_rows) x2 order by (x2 ->> 'idx')::int loop
    v_base := (x ->> 'base')::bigint;
    v_disc := coalesce((v_calc -> ('line:' || (x ->> 'idx')) ->> 'disc')::bigint, 0);
    v_red := coalesce((v_calc -> ('line:' || (x ->> 'idx')) ->> 'red')::bigint, 0);
    v_rank := case when x ->> 'kind' = 'child' then (v_calc -> ('line:' || (x ->> 'idx')) ->> 'rank')::int end;
    v_late := 0;
    if v_late_fee > 0 and (x ->> 'priced')::boolean and not ((x ->> 'key') = any (v_late_done))
       and not (coalesce(v_existing -> 'late_paid', '[]'::jsonb) ? coalesce(x ->> 'person_id', '')) then
      v_late := v_late_fee;
      v_late_done := v_late_done || (x ->> 'key');
    end if;
    v_total := v_base - v_disc - v_red + v_late;
    if x ->> 'kind' = 'child' then v_children := v_children + v_total; else v_adults := v_adults + v_total; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'index', (x ->> 'idx')::int, 'person_id', x -> 'person_id', 'track_id', x -> 'track_id', 'level_id', x -> 'level_id',
      'learner_kind', x ->> 'kind', 'family_rank', v_rank, 'age_on_cutoff', x -> 'age',
      'base_fee_cents', v_base, 'sibling_discount_cents', v_disc, 'cap_reduction_cents', v_red,
      'late_fee_cents', v_late, 'assistance_cents', 0, 'total_cents', v_total, 'priced', (x ->> 'priced')::boolean)
      || case when p_hypothetical then jsonb_build_object('refusal', x -> 'refusal') else '{}'::jsonb end);
  end loop;

  return jsonb_build_object(
    'lines', v_out, 'children_total_cents', v_children, 'adults_total_cents', v_adults, 'total_cents', v_children + v_adults,
    'late', coalesce(p_late, false),
    'rule_snapshot', jsonb_build_object('sibling_discount_pct', v_pct, 'family_cap_cents', v_cap, 'late_fee_cents', t.late_fee_cents,
                                        'late', coalesce(p_late, false), 'age_cutoff_on', v_cut, 'quoted_at', now()));
end $$;

-- The quote a family (an adult of the household) or Pathshala staff sees. The late fee applies when registration has
-- closed (the late window for families; the office after it).
create or replace function app.pathshala_quote(p_term uuid, p_household uuid, p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; h app.households; e jsonb; v_person uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  select * into h from app.households where id = p_household;
  if h.id is null or h.center_id <> t.center_id then raise exception 'That family was not found in this community.' using errcode = 'P0002'; end if;
  if not (app.pathshala_adult_of_household(t.center_id, p_household)
          or app.has_permission(t.center_id, 'pathshala.view') or app.has_permission(t.center_id, 'pathshala.manage')) then
    raise exception 'Only an adult of the family can see what Pathshala costs for it.' using errcode = '42501';
  end if;
  -- A family's quote prices its own current members only, as the preview and the registration do (app._pathshala_plan):
  -- it never answers with another person's age on the cut-off or whether they count as a child.
  if jsonb_typeof(p_lines) = 'array' then
    for e in select * from jsonb_array_elements(p_lines) loop
      continue when jsonb_typeof(e) <> 'object';
      v_person := app._pathshala_uuid(e, 'person_id', 'The learner');
      if v_person is not null and not exists (
           select 1 from app.people p join app.household_members hm on hm.person_id = p.id
            where p.id = v_person and not coalesce(p.is_deceased, false) and hm.household_id = h.id and hm.left_at is null) then
        raise exception 'That learner is not a current member of the % (%).', h.display_name, coalesce(h.household_number, 'no number')
          using errcode = '22023';
      end if;
    end loop;
  end if;
  return app._pathshala_price(t.id, p_household, p_lines, app.pathshala_is_late(t.id)) || jsonb_build_object('term_id', t.id, 'household_id', p_household);
end $$;

-- "Try a family" (the Fees screen): hypothetical lines [{learner, name, age | date_of_birth, learner_kind, level_id,
-- track_id}]; or {"lines": [...], "late": true} to see the late window. Nobody's real registrations count. It prices as a
-- registration does: lines with the same `learner` (1–80 characters, trimmed, any case) are one learner (one child for
-- the sibling order and the family cap, one late fee: P10; without `learner` each line is its own learner), and each
-- line has `refusal`: null, or the sentence a registration would refuse it with (then priced false, every amount 0, out
-- of the totals).
create or replace function app.pathshala_fee_example(p_term uuid, p_lines jsonb) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; v_lines jsonb; v_late boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  if not (app.has_permission(t.center_id, 'pathshala.view') or app.has_permission(t.center_id, 'pathshala.manage')
          or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'Trying a family on the Fees screen needs pathshala.view.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) = 'object' then
    v_lines := p_lines -> 'lines';
    v_late := coalesce(app._pathshala_bool(p_lines, 'late', 'Late'), false);
  else
    v_lines := p_lines;
    v_late := app.pathshala_is_late(t.id);
  end if;
  return app._pathshala_price(t.id, null, v_lines, v_late, true) || jsonb_build_object('term_id', t.id);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- What a family may register for (§2.17) and the preview
-- ═════════════════════════════════════════════════════════════════════════════
-- The household's membership for P6: active (a current yearly or life membership), applying (an application in
-- progress) or none.
create or replace function app.pathshala_household_membership(p_household uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case when app.household_active_tier(p_household) in ('yearly', 'life') then 'active'
              when exists (select 1 from app.membership_applications a where a.household_id = p_household
                             and a.status in ('draft', 'awaiting_reference', 'reference_declined', 'awaiting_center', 'awaiting_ec')) then 'applying'
              else 'none' end
$$;

-- Must this household wait for its membership before a seat or a bill (P6)? Only when the term asks for membership and
-- the Membership module is on (with it off no membership can be granted, so nobody would ever be let in).
create or replace function app.pathshala_membership_hold_applies(p_term uuid, p_household uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select t.membership_required and app.module_enabled(t.center_id, 'membership')
                          and app.pathshala_household_membership(p_household) <> 'active'
                     from app.pathshala_terms t where t.id = p_term), false)
$$;

-- The community's current Pathshala waiver (the latest published version), if any.
create or replace function app.pathshala_current_waiver(p_center uuid) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select d.id from app.legal_documents d
   where d.center_id = p_center and d.kind = 'pathshala_waiver' and d.published_at is not null and d.published_at <= now()
   order by d.published_at desc limit 1
$$;

-- Has this person agreed to that waiver (and, when it asks for it, within the last year)?
create or replace function app.pathshala_waiver_consent(p_person uuid, p_document uuid) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select x.id from app.consents x join app.legal_documents d on d.id = x.legal_document_id
   where x.person_id = p_person and x.legal_document_id = p_document and x.granted
     and (not d.requires_yearly_resign or x.recorded_at > now() - interval '1 year')
   order by x.recorded_at desc limit 1
$$;

-- Is the level offered in this term: active, a class this term and a fee?
create or replace function app.pathshala_level_offered(p_term uuid, p_level uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.pathshala_levels l
                  where l.id = p_level and l.active
                    and exists (select 1 from app.pathshala_classes c where c.term_id = p_term and c.level_id = l.id)
                    and exists (select 1 from app.pathshala_level_fees f where f.term_id = p_term and f.level_id = l.id))
$$;

-- The suggested level per track for one learner (P11): last term's teacher recommendation, else the level after last
-- term's, else the level whose age band fits. Offered levels only; at most one per track.
create or replace function app.pathshala_suggestions(p_term uuid, p_person uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; v_age int; v_child boolean; v_out jsonb := '[]'::jsonb; tr record; v_level uuid; v_reason text;
        v_dob date;
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null or p_person is null then return '[]'::jsonb; end if;
  select date_of_birth into v_dob from app.people where id = p_person;
  v_age := app.pathshala_age_on(v_dob, app.pathshala_age_cutoff(t.id));
  v_child := app.pathshala_counts_as_child(p_person, app.pathshala_age_cutoff(t.id));
  for tr in select * from app.pathshala_tracks where center_id = t.center_id order by name loop
    v_level := null; v_reason := null;
    -- 1. The teacher's recommendation on the newest published report of an earlier term.
    select r.recommended_next_level_id into v_level
      from app.pathshala_progress_reports r
      join app.pathshala_enrollments en on en.id = r.enrollment_id
      join app.pathshala_terms pt on pt.id = en.term_id
      join app.pathshala_levels rl on rl.id = r.recommended_next_level_id
     where en.student_person_id = p_person and pt.center_id = t.center_id and pt.starts_on < t.starts_on
       and r.published_at is not null and rl.track_id = tr.id and app.pathshala_level_offered(t.id, rl.id)
     order by pt.starts_on desc, r.published_at desc limit 1;
    if v_level is not null then v_reason := 'teacher'; end if;
    -- 2. The level after the one of last term's class in this track.
    if v_level is null then
      select nx.id into v_level
        from app.pathshala_enrollments en
        join app.pathshala_terms pt on pt.id = en.term_id
        join app.pathshala_classes c on c.id = en.class_id
        join app.pathshala_levels cl on cl.id = c.level_id
        join lateral (select l2.id from app.pathshala_levels l2
                       where l2.track_id = cl.track_id and l2.sort_order > cl.sort_order and app.pathshala_level_offered(t.id, l2.id)
                       order by l2.sort_order, l2.name limit 1) nx on true
       where en.student_person_id = p_person and pt.center_id = t.center_id and pt.starts_on < t.starts_on
         and en.status in ('placed', 'active', 'completed') and cl.track_id = tr.id
       order by pt.starts_on desc limit 1;
      if v_level is not null then v_reason := 'previous'; end if;
    end if;
    -- 3. The age band (the learner's kind of level first).
    if v_level is null and v_age is not null then
      select l.id into v_level from app.pathshala_levels l
       where l.track_id = tr.id and app.pathshala_level_offered(t.id, l.id)
         and (l.min_age is not null or l.max_age is not null)
         and (l.min_age is null or v_age >= l.min_age) and (l.max_age is null or v_age <= l.max_age)
         and app.pathshala_level_band(l.min_age, l.max_age) in (case when v_child then 'children' else 'adult' end, 'any')
       order by (app.pathshala_level_band(l.min_age, l.max_age) = case when v_child then 'children' else 'adult' end) desc, l.sort_order
       limit 1;
      if v_level is not null then v_reason := 'age'; end if;
    end if;
    if v_level is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('track_id', tr.id, 'level_id', v_level, 'reason', v_reason));
    end if;
  end loop;
  return v_out;
end $$;

-- Who may act for this household in Pathshala registration: an adult of it (the family) or pathshala.manage (the office).
-- Returns 'family' or 'office'; raises otherwise.
create or replace function app._pathshala_registrant(p_center uuid, p_household uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if app.pathshala_adult_of_household(p_center, p_household) then return 'family'; end if;
  if app.has_permission(p_center, 'pathshala.manage') then return 'office'; end if;
  if app.in_my_household(p_center, p_household) then
    raise exception 'Ask a parent or guardian in your family to register you.' using errcode = '42501';
  end if;
  raise exception 'Only an adult of the family can register its learners.' using errcode = '42501';
end $$;

-- Why the term cannot take registrations now from this channel (null: it can).
create or replace function app._pathshala_cannot_register(p_term uuid, p_channel text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; w jsonb; v_tz text;
begin
  select * into t from app.pathshala_terms where id = p_term;
  select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = t.center_id;
  w := app.pathshala_registration_window(t.id);
  if t.status = 'closed' then return t.name || ' is closed.'; end if;
  if t.status = 'draft' or t.fees_locked_at is null then return 'Registration for ' || t.name || ' is not open yet.'; end if;
  if p_channel = 'family' then
    if w ->> 'state' = 'not_yet' then
      return 'Registration for ' || t.name || ' opens on ' || to_char(t.registration_opens_at at time zone v_tz, 'FMMon FMDD') || '.';
    end if;
    if w ->> 'state' = 'closed' then
      return 'Registration for ' || t.name || ' closed on '
             || to_char(coalesce(t.late_registration_closes_at, t.registration_closes_at) at time zone v_tz, 'FMMon FMDD')
             || '. Ask the Pathshala office.';
    end if;
  end if;
  if t.payment_mode = 'pay_now' and not app.module_enabled(t.center_id, 'giving') then
    return t.name || ' takes the fee when you register, and Pledges & donations is switched off, so registration cannot be completed. Ask the Pathshala office.';
  end if;
  if t.payment_mode = 'pay_now' and not app.pathshala_online_payments_ready(t.center_id) then
    return 'Online payment is not available right now, so registration cannot be completed. Try again later or ask the Pathshala office.';
  end if;
  return null;
end $$;

-- Validates a submission and works out each line's outcome and price, writing nothing (§2.17). Used by the preview and
-- (0591) by the registration itself. p_learners: [{person_id, track_id, level_id | null, note, assistance_requested}] or
-- [{new_child: {first_name, last_name, date_of_birth, relationship}, track_id, level_id, note}].
-- Outcomes: seat, waitlist, membership_hold, office, pending_child, and waiver_hold (another adult learner must agree to
-- the waiver in their own app first, P14; not in §2.17's list).
create or replace function app._pathshala_plan(p_term uuid, p_household uuid, p_learners jsonb, p_channel text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; h app.households; v_problem text; e jsonb; i int := 0; v_person uuid; v_track uuid; v_level uuid;
        l app.pathshala_levels; tr app.pathshala_tracks; v_name text; v_kind text; v_age int; v_cut date; v_band text;
        v_outcome text; v_free int; v_seats jsonb := '{}'::jsonb; s record; q jsonb; v_lines jsonb := '[]'::jsonb; v_line jsonb;
        v_seen text[] := '{}'; v_me uuid; v_waiver uuid; v_hold boolean; v_dob date; v_existing record; v_pending jsonb := '[]'::jsonb;
        v_reuse uuid; v_tz text;
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  select * into h from app.households where id = p_household;
  if h.id is null or h.center_id <> t.center_id then raise exception 'That family was not found in this community.' using errcode = 'P0002'; end if;
  select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = t.center_id;
  v_problem := app._pathshala_cannot_register(t.id, p_channel);
  if v_problem is not null then raise exception '%', v_problem using errcode = '22023'; end if;
  if p_learners is null or jsonb_typeof(p_learners) <> 'array' or jsonb_array_length(p_learners) = 0 then
    raise exception 'Choose who is joining.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_learners) > 12 then raise exception 'Register at most 12 learners at a time.' using errcode = '22023'; end if;
  v_cut := app.pathshala_age_cutoff(t.id);
  v_me := app.my_person_id(t.center_id);
  v_waiver := app.pathshala_current_waiver(t.center_id);
  v_hold := app.pathshala_membership_hold_applies(t.id, h.id);

  q := app._pathshala_price(t.id, h.id, p_learners, app.pathshala_is_late(t.id));

  for e in select * from jsonb_array_elements(p_learners) loop
    i := i + 1;
    v_person := app._pathshala_uuid(e, 'person_id', 'The learner');
    v_track := app._pathshala_uuid(e, 'track_id', 'The track');
    v_level := app._pathshala_uuid(e, 'level_id', 'The level');
    v_reuse := null;
    if v_person is not null then
      select coalesce(nullif(btrim(p.preferred_name), ''), p.first_name), p.date_of_birth into v_name, v_dob
        from app.people p
       where p.id = v_person and not coalesce(p.is_deceased, false)
         and exists (select 1 from app.household_members hm where hm.household_id = h.id and hm.person_id = p.id and hm.left_at is null);
      if v_name is null then
        raise exception 'That learner is not a current member of the % (%).', h.display_name, coalesce(h.household_number, 'no number')
          using errcode = '22023';
      end if;
    else
      v_name := nullif(btrim(e -> 'new_child' ->> 'first_name'), '');
      if v_name is null or nullif(btrim(e -> 'new_child' ->> 'last_name'), '') is null then
        raise exception 'Give the new child''s first and last name.' using errcode = '22023';
      end if;
      v_dob := app._pathshala_date(e -> 'new_child', 'date_of_birth', 'The date of birth');
      if v_dob is not null and v_dob > (now() at time zone v_tz)::date then
        raise exception 'The date of birth of % cannot be in the future.', v_name using errcode = '22023';
      end if;
    end if;
    if v_track is null then
      raise exception 'Choose a track (Jainism, Gujarati, Hindi …) for %.', v_name using errcode = '22023';
    end if;
    select * into tr from app.pathshala_tracks where id = v_track and center_id = t.center_id;
    if tr.id is null then raise exception 'That track is not one of this community''s tracks.' using errcode = '22023'; end if;
    if (coalesce(v_person::text, 'new:' || i) || ':' || v_track::text) = any (v_seen) then
      raise exception '% is listed twice for %.', v_name, tr.name using errcode = '22023';
    end if;
    v_seen := v_seen || (coalesce(v_person::text, 'new:' || i) || ':' || v_track::text);
    v_kind := q -> 'lines' -> (i - 1) ->> 'learner_kind';
    v_age := app.pathshala_age_on(v_dob, v_cut);

    -- Already registered in this track this term?
    if v_person is not null then
      select en.id, en.status, to_jsonb(en) ->> 'hold_reason' as hold_reason into v_existing
        from app.pathshala_enrollments en
       where en.term_id = t.id and en.student_person_id = v_person
         and coalesce((to_jsonb(en) ->> 'track_id')::uuid,
                      (select l2.track_id from app.pathshala_classes c2 join app.pathshala_levels l2 on l2.id = c2.level_id where c2.id = en.class_id),
                      (select l3.track_id from app.pathshala_levels l3 where l3.id = en.requested_level_id)) = v_track
       order by en.registered_at desc limit 1;
      if v_existing.id is not null then
        if v_existing.status in ('withdrawn') then
          v_reuse := v_existing.id;
        elsif v_existing.hold_reason = 'waiver' and v_person = v_me then
          v_reuse := v_existing.id;   -- the adult learner agrees in their own app: their waiting registration goes ahead
        else
          raise exception '% is already registered for % in % (%).', v_name, tr.name, t.name,
            case when v_existing.hold_reason = 'membership' then 'waiting for membership'
                 when v_existing.hold_reason in ('payment', 'office_payment') then 'seat held for payment'
                 when v_existing.hold_reason = 'waiver' then 'waiting for the waiver'
                 when v_existing.status = 'waitlisted' then 'on the waitlist'
                 when v_existing.status = 'requested' then 'waiting for the office'
                 else v_existing.status end
            using errcode = '22023';
        end if;
      end if;
    end if;

    -- The level: of this track, offered, the right kind of level for the learner (P24).
    v_band := null;
    if v_level is not null then
      select * into l from app.pathshala_levels where id = v_level and center_id = t.center_id;
      if l.id is null or l.track_id <> v_track then
        raise exception 'That level is not in the % track.', tr.name using errcode = '22023';
      end if;
      if not l.active or not exists (select 1 from app.pathshala_classes c where c.term_id = t.id and c.level_id = l.id) then
        raise exception '% is not offered in %.', l.name, t.name using errcode = '22023';
      end if;
      v_band := app.pathshala_level_band(l.min_age, l.max_age);
      if v_band = 'adult' and v_kind = 'child' then
        raise exception '% is for adults, and % is %.', l.name, v_name,
          case when v_age is not null then v_age::text else 'a child' end using errcode = '22023';
      end if;
      if v_band = 'children' and v_kind = 'adult' then
        raise exception '% is a children''s class, and % is an adult.', l.name, v_name using errcode = '22023';
      end if;
    elsif t.payment_mode = 'pay_now' then
      raise exception 'Choose a level for %: in % the fee is paid when you register. Not sure? Keep the suggested level: the teacher can move % in the first weeks.',
        v_name, t.name, v_name using errcode = '22023';
    end if;

    -- The outcome.
    if v_person is null then
      v_outcome := 'pending_child';
    elsif v_hold then
      v_outcome := 'membership_hold';
    elsif p_channel = 'family' and v_kind = 'adult' and v_person is distinct from v_me and v_waiver is not null
          and app.pathshala_waiver_consent(v_person, v_waiver) is null then
      v_outcome := 'waiver_hold';
    elsif v_level is null or t.seat_rule = 'office' then
      v_outcome := 'office';
    elsif v_kind = 'child' and v_band <> 'adult' and v_age is not null
          and ((l.min_age is not null and v_age < l.min_age) or (l.max_age is not null and v_age > l.max_age)) then
      v_outcome := 'office';
    else
      if not (v_seats ? v_level::text) then
        select * into s from app.pathshala_level_seats(t.id, v_level);
        v_seats := v_seats || jsonb_build_object(v_level::text, jsonb_build_object('free', s.free, 'classes', s.classes, 'waitlist_on', s.waitlist_on));
      end if;
      v_free := (v_seats -> v_level::text ->> 'free')::int;
      if (v_seats -> v_level::text -> 'free') = 'null'::jsonb then
        v_outcome := 'seat';
      elsif v_free > 0 then
        v_outcome := 'seat';
        v_seats := jsonb_set(v_seats, array[v_level::text, 'free'], to_jsonb(v_free - 1));
      elsif (v_seats -> v_level::text ->> 'waitlist_on')::boolean then
        v_outcome := 'waitlist';
      else
        raise exception '% is full and has no waitlist. Ask the Pathshala office.', l.name using errcode = '22023';
      end if;
    end if;

    v_line := (q -> 'lines' -> (i - 1)) - 'index' - 'priced'
              || jsonb_build_object('outcome', v_outcome, 'first_name', v_name, 'track', tr.name, 'level', l.name,
                                    'priced', (q -> 'lines' -> (i - 1) ->> 'priced')::boolean,
                                    'reuse_enrollment_id', v_reuse,
                                    'note', nullif(btrim(e ->> 'note'), ''),
                                    'assistance_requested', coalesce(app._pathshala_bool(e, 'assistance_requested', 'Fee assistance'), false));
    if v_level is null then v_line := v_line || jsonb_build_object('level', null); end if;
    if v_person is null then
      v_line := v_line || jsonb_build_object('new_child', e -> 'new_child');
      v_pending := v_pending || jsonb_build_array(jsonb_build_object('first_name', v_name, 'last_name', btrim(e -> 'new_child' ->> 'last_name'),
                                                                     'track_id', v_track, 'level_id', v_level));
    end if;
    v_lines := v_lines || jsonb_build_array(v_line);
  end loop;

  return jsonb_build_object('term_id', t.id, 'household_id', h.id, 'channel', p_channel, 'payment_mode', t.payment_mode,
                            'lines', v_lines, 'children_total_cents', q -> 'children_total_cents', 'adults_total_cents', q -> 'adults_total_cents',
                            'total_cents', q -> 'total_cents', 'late', q -> 'late', 'rule_snapshot', q -> 'rule_snapshot',
                            'pending', v_pending);
end $$;

-- The label a fee payment carries (the line on the provider's page): "Pathshala fee 2026-27 · Riya, Dev".
create or replace function app.pathshala_fee_label(p_term_name text, p_names text[]) returns text
language sql immutable set search_path = app, public, extensions as $$
  select left('Pathshala fee ' || coalesce(p_term_name, '') ||
              case when cardinality(coalesce(p_names, '{}')) > 0 then ' · ' || array_to_string(p_names, ', ') else '' end, 200)
$$;

-- The preview (§2.17): the lines, each line's outcome and the totals; in a pay-now term what would be paid now. Writes
-- nothing; refuses exactly what the registration would refuse.
create or replace function app.preview_pathshala_registration(p_term uuid, p_household uuid, p_learners jsonb) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; v_channel text; v jsonb; v_lines jsonb; v_pay jsonb := null; v_due bigint; v_names text[]; v_tz text;
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  perform app.assert_module_enabled(t.center_id, 'pathshala');
  v_channel := app._pathshala_registrant(t.center_id, p_household);
  v := app._pathshala_plan(t.id, p_household, p_learners, v_channel);
  select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = t.center_id;
  select coalesce(jsonb_agg((x - 'reuse_enrollment_id' - 'note' - 'new_child' - 'assistance_requested') order by o), '[]'::jsonb)
    into v_lines from jsonb_array_elements(v -> 'lines') with ordinality as a(x, o);
  select coalesce(sum((x ->> 'total_cents')::bigint) filter (where x ->> 'outcome' = 'seat' and not coalesce((x ->> 'assistance_requested')::boolean, false)), 0)
    into v_due from jsonb_array_elements(v -> 'lines') with ordinality as a(x, o);
  select coalesce(array_agg(n.first_name order by n.o), '{}') into v_names
    from (select distinct on (coalesce(x ->> 'person_id', 'new:' || o)) x ->> 'first_name' as first_name, o
            from jsonb_array_elements(v -> 'lines') with ordinality as a(x, o)
           where x ->> 'outcome' = 'seat'
           order by coalesce(x ->> 'person_id', 'new:' || o), o) n;
  if t.payment_mode = 'pay_now' then
    v_pay := jsonb_build_object('amount_cents', v_due, 'pledge_ids', '[]'::jsonb,
                                'for_label', app.pathshala_fee_label(t.name, v_names),
                                'hold_until', app.pathshala_iso(now() + make_interval(hours => t.hold_hours), v_tz),
                                'office_payment_allowed', t.office_payment_allowed);
  end if;
  return jsonb_build_object('registration_id', null, 'lines', v_lines,
                            'children_total_cents', v -> 'children_total_cents', 'adults_total_cents', v -> 'adults_total_cents',
                            'total_cents', v -> 'total_cents', 'due_now_cents', v_due, 'pay', v_pay, 'pending', v -> 'pending',
                            'late', v -> 'late');
end $$;

-- Everything the member app's registration flow needs (§2.17).
create or replace function app.pathshala_registration_options(p_term uuid, p_household uuid default null) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms; h app.households; v_center uuid; v_me uuid; v_staff boolean; v_member boolean; v_adult boolean;
        v_cut date; v_tracks jsonb; v_learners jsonb; v_households jsonb; v_cannot text; v_tz text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_term is null then raise exception 'Choose the term.' using errcode = '22023'; end if;
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  v_center := t.center_id;
  perform app.assert_module_enabled(v_center, 'pathshala');
  select coalesce(nullif(c.time_zone, ''), 'America/Chicago') into v_tz from app.centers c where c.id = v_center;
  v_me := app.my_person_id(v_center);
  v_staff := app.has_permission(v_center, 'pathshala.manage');
  if t.status = 'draft' and not v_staff then raise exception 'That term was not found.' using errcode = 'P0002'; end if;
  v_adult := v_me is not null and app.gyan_i_am_adult(v_center);
  -- The household: the one asked for, else the caller's own (primary first).
  if p_household is null then
    select hm.household_id into p_household from app.household_members hm join app.households hh on hh.id = hm.household_id
     where hm.person_id = v_me and hm.left_at is null and hh.center_id = v_center and hh.merged_into_id is null
     order by hm.is_primary desc, hm.joined_at nulls last, hm.household_id limit 1;
  end if;
  select * into h from app.households where id = p_household;
  if h.id is null or h.center_id <> v_center then raise exception 'That family was not found in this community.' using errcode = 'P0002'; end if;
  v_member := app.in_my_household(v_center, h.id);
  if not (v_member or v_staff) then raise exception 'Only an adult of the family can register its learners.' using errcode = '42501'; end if;
  v_cut := app.pathshala_age_cutoff(t.id);

  select coalesce(jsonb_agg(jsonb_build_object('id', hh.id, 'name', hh.display_name, 'number', hh.household_number)
                            order by hm.is_primary desc, hh.display_name), '[]'::jsonb)
    into v_households
    from app.household_members hm join app.households hh on hh.id = hm.household_id
   where v_adult and hm.person_id = v_me and hm.left_at is null and hh.center_id = v_center and hh.merged_into_id is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', tr.id, 'key', tr.key, 'name', tr.name,
           'levels', (select coalesce(jsonb_agg(jsonb_build_object(
                               'id', l.id, 'name', l.name, 'key', l.key, 'min_age', l.min_age, 'max_age', l.max_age,
                               'band', app.pathshala_level_band(l.min_age, l.max_age), 'fee_cents', f.fee_cents,
                               'seats', app.pathshala_seat_state(s.free, s.classes, s.waitlist_on)) order by l.sort_order, l.name), '[]'::jsonb)
                        from app.pathshala_levels l
                        join app.pathshala_level_fees f on f.term_id = t.id and f.level_id = l.id
                        cross join lateral app.pathshala_level_seats(t.id, l.id) s
                       where l.track_id = tr.id and l.active and s.classes > 0)) order by tr.name), '[]'::jsonb)
    into v_tracks
    from app.pathshala_tracks tr where tr.center_id = v_center;
  -- Only tracks with something to choose.
  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) into v_tracks
    from jsonb_array_elements(v_tracks) x where jsonb_array_length(x -> 'levels') > 0;

  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', p.id, 'first_name', coalesce(nullif(btrim(p.preferred_name), ''), p.first_name),
           'is_me', p.id = v_me,
           'age_on_cutoff', app.pathshala_age_on(p.date_of_birth, v_cut),
           'counts_as_child', app.pathshala_counts_as_child(p.id, v_cut),
           'needs_birth_date', p.date_of_birth is null,
           'enrollments', (select coalesce(jsonb_agg(jsonb_build_object(
                                     'enrollment_id', en.id,
                                     'track_id', coalesce((to_jsonb(en) ->> 'track_id')::uuid, cl.track_id, rl.track_id),
                                     'level_id', coalesce(c.level_id, en.requested_level_id),
                                     'status', en.status, 'hold_reason', to_jsonb(en) ->> 'hold_reason',
                                     'hold_expires_at', app.pathshala_iso((to_jsonb(en) ->> 'hold_expires_at')::timestamptz, v_tz))
                                     order by en.registered_at), '[]'::jsonb)
                             from app.pathshala_enrollments en
                             left join app.pathshala_classes c on c.id = en.class_id
                             left join app.pathshala_levels cl on cl.id = c.level_id
                             left join app.pathshala_levels rl on rl.id = en.requested_level_id
                            where en.term_id = t.id and en.student_person_id = p.id),
           'suggested', app.pathshala_suggestions(t.id, p.id))
           order by app.pathshala_counts_as_child(p.id, v_cut) desc,
                    case when app.pathshala_counts_as_child(p.id, v_cut) then p.date_of_birth end asc nulls last,
                    (p.id = v_me) desc, p.first_name), '[]'::jsonb)
    into v_learners
    from app.household_members hm join app.people p on p.id = hm.person_id
   where hm.household_id = h.id and hm.left_at is null and not coalesce(p.is_deceased, false);

  if not (v_adult and v_member) and not v_staff then
    v_cannot := 'Ask a parent or guardian in your family to register you.';
  else
    v_cannot := app._pathshala_cannot_register(t.id, case when v_adult and v_member then 'family' else 'office' end);
  end if;
  if v_cannot is null and jsonb_array_length(v_tracks) = 0 then
    v_cannot := 'No classes are open for registration in ' || t.name || ' yet.';
  end if;

  return jsonb_build_object(
    'term', app._pathshala_term_json(t.id),
    'household', jsonb_build_object('id', h.id, 'name', h.display_name, 'number', h.household_number,
                                    'membership', app.pathshala_household_membership(h.id)),
    'households', v_households,
    'learners', v_learners,
    'tracks', v_tracks,
    'can_register', v_cannot is null,
    'cannot_reason', v_cannot);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- Online payments for Pathshala fees: the checkout context 'pathshala' (finding F17)
-- ═════════════════════════════════════════════════════════════════════════════
alter table app.payment_checkouts drop constraint if exists payment_checkouts_context_check;
alter table app.payment_checkouts add constraint payment_checkouts_context_check
  check (context in ('rsvp','rsvp_later','pledges','opportunity','labh','store','other','portal','processor_test','pathshala'));

-- 0211's body (the latest) with 'pathshala' added to the contexts a member or the office may start.
create or replace function app.create_checkout(p_center uuid, p_household uuid, p_amount_cents bigint, p_pledge_ids uuid[],
                                               p_processor text, p_context text, p_for_label text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; cp app.center_payment_processors; ic app.integration_connections; v_id uuid; v_mode text; v_forced boolean;
        v_staff boolean; v_bad int; v_pledges uuid[] := coalesce(p_pledge_ids, '{}');
begin
  if auth.uid() is null then raise exception 'Sign in to pay.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.' using errcode = '22023'; end if;
  if not exists (select 1 from app.households where id = p_household and center_id = p_center) then
    raise exception 'That family was not found in this community.' using errcode = '22023';
  end if;
  v_staff := app.has_permission(p_center, 'giving.manage');
  if not (app.adult_of_household(p_center, p_household) or v_staff) then
    raise exception 'Only an adult of the family can pay for it.' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents < 50 then raise exception 'The amount must be at least $0.50.' using errcode = '22023'; end if;
  if p_amount_cents > 100000000 then raise exception 'Online payments are limited to $1,000,000.' using errcode = '22023'; end if;
  if coalesce(p_context, '') not in ('rsvp','rsvp_later','pledges','opportunity','labh','store','other','portal','pathshala') then
    raise exception 'Unknown checkout context "%".', p_context using errcode = '22023';
  end if;
  if nullif(btrim(p_for_label), '') is null then raise exception 'Say what the payment is for.' using errcode = '22023'; end if;
  select count(*) into v_bad from unnest(v_pledges) x
   where not exists (select 1 from app.pledges pl where pl.id = x and pl.center_id = p_center and pl.household_id = p_household
                        and pl.status in ('open','partially_paid'));
  if v_bad > 0 then raise exception 'One of the pledges is not an open pledge of this family.' using errcode = '22023'; end if;
  if coalesce((c.rules #>> '{payments,offline_only}')::boolean, false) then
    raise exception '% takes offline payments only.', coalesce(c.short_name, c.name) using errcode = '22023';
  end if;

  select * into cp from app.center_payment_processors
   where center_id = p_center and status in ('test','live') and (p_processor is null or processor = p_processor)
   order by is_default desc, (status = 'live') desc, processor limit 1;
  if cp.center_id is null then
    raise exception 'Online payment is not set up for % yet.', coalesce(c.short_name, c.name) using errcode = '22023';
  end if;
  v_forced := c.environment = 'sandbox' or app.entitlement(p_center, 'payments.mode') = '"test"'::jsonb;
  if cp.status = 'test' and not v_forced then
    raise exception 'Online payment for % is still in test mode, so it cannot take real payments yet.', coalesce(c.short_name, c.name)
      using errcode = '22023';
  end if;
  select * into ic from app.integration_connections where id = cp.connection_id;
  if ic.id is null or ic.status <> 'connected' then
    raise exception '% is not connected right now.', initcap(cp.processor) using errcode = '22023';
  end if;
  v_mode := app.payment_api_mode(p_center, cp.processor);
  insert into app.payment_checkouts (center_id, household_id, person_id, processor, mode, context, amount_cents, currency,
                                     pledge_ids, for_label, created_by)
  values (p_center, p_household, app.my_person_id(p_center), cp.processor, v_mode, p_context, p_amount_cents, lower(coalesce(c.currency, 'usd')),
          v_pledges, left(btrim(p_for_label), 200), auth.uid())
  returning id into v_id;
  return jsonb_build_object('checkout_id', v_id, 'processor', cp.processor, 'mode', v_mode, 'amount_cents', p_amount_cents,
                            'currency', lower(coalesce(c.currency, 'usd')), 'account_id', ic.external_account_id,
                            'payee_email', case when ic.settings->>'connect_method' = 'email' then ic.settings->>'paypal_email' end,
                            'statement_descriptor', cp.statement_descriptor, 'methods', to_jsonb(cp.methods),
                            'center_name', c.name, 'for_label', left(btrim(p_for_label), 200));
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- The import's allow-list (app.import_entities): Pathshala terms take dates, windows and the membership rule only
-- ═════════════════════════════════════════════════════════════════════════════
-- Generated from src/lib/import/registry.ts (tests/import-registry.test.ts compares the two), re-seeding the whole list as
-- 0423 and 0490 did. The only change: Pathshala terms no longer take status, fee_per_child_cents, fee_per_family_cap_cents
-- or sibling_discount_pct, so app.import_stage_rows refuses them (Row 2: status cannot be imported into "Pathshala
-- terms".); fees, discounts and opening registration are done on each term's Fees and rules screen. Behind it the term
-- guard (pathshala_terms_guard) refuses any writer a status out of Draft and a change to a locked rule.
-- BEGIN import_entities seed (generated from src/lib/import/registry.ts)
insert into app.import_entities (key, label, tier, sort, target_table, write_perms, module_key, columns, extras, natural_key, money_columns, has_center) values
  ('zones', 'Zones and ZIP codes', 'setup', 30, 'zones', array['settings.manage'], 'people',
   array['name','zip_codes'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('inboxes', 'Inboxes', 'setup', 31, 'inboxes', array['settings.manage'], 'comms',
   array['key','name','response_target_hours'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('bank_accounts', 'Bank accounts', 'setup', 32, 'bank_accounts', array['accounting.manage'], 'giving',
   array['active','institution','last4','name','statement_format'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('funds', 'Funds', 'setup', 33, 'funds', array['giving.manage'], 'giving',
   array['active','key','name','qbo_class_id','restricted'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('membership_types', 'Membership types', 'setup', 34, 'membership_types', array['settings.manage'], 'membership',
   array['active','ec_approval_required','fee_cents','includes_spouse','key','name','period_months','reference_required','tier','voting_wait_days'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('store_categories', 'Store categories', 'setup', 35, 'store_categories', array['store.manage'], 'store',
   array['name','sort_order'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('calendar_layers', 'Calendar layers', 'setup', 36, 'calendar_layers', array['content.manage'], 'calendar',
   array['color','default_on','key','kind','name','source_url'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('pathshala_tracks', 'Pathshala tracks', 'setup', 37, 'pathshala_tracks', array['pathshala.manage'], 'pathshala',
   array['key','name'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('pathshala_terms', 'Pathshala terms', 'setup', 38, 'pathshala_terms', array['pathshala.manage'], 'pathshala',
   array['ends_on','membership_required','name','registration_closes_at','registration_opens_at','starts_on'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('practices', 'Practices (My Jain Way)', 'setup', 39, 'practices', array['content.manage'], 'jain_way',
   array['active','category','default_minutes','description','key','name','points','sort_order'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('gyan_goals', 'Gyan Path goals', 'setup', 40, 'gyan_goals', array['content.manage'], 'gyan_path',
   array['description','key','name','recommended','sort_order'],
   '{}'::text[], array['key'], '{}'::text[], true),
  ('campaigns', 'Campaigns', 'setup', 50, 'campaigns', array['giving.manage'], 'giving',
   array['description','ends_on','fund_id','goal_cents','kind','name','starts_on','status'],
   '{}'::text[], array['name'], array['goal_cents'], true),
  ('event_templates', 'Event templates', 'setup', 51, 'event_templates', array['events.manage'], 'events',
   array['description','name'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('event_template_items', 'Event template checklist items', 'setup', 52, 'event_template_items', array['events.manage'], 'events',
   array['name','offset_days','phase','priority','sort_order','template_id'],
   '{}'::text[], array['template_id','name'], '{}'::text[], true),
  ('volunteer_groups', 'Volunteer groups', 'setup', 53, 'volunteer_groups', array['volunteers.manage'], 'volunteers',
   array['name','requires_background_check','requires_waiver_kind'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('pathshala_levels', 'Pathshala levels', 'setup', 54, 'pathshala_levels', array['pathshala.manage'], 'pathshala',
   array['key','max_age','min_age','name','sort_order','track_id'],
   '{}'::text[], array['track_id','key'], '{}'::text[], true),
  ('gyan_levels', 'Gyan Path levels', 'setup', 55, 'gyan_levels', array['content.manage'], 'gyan_path',
   array['chapter','goal_id','key','name','points','requires_teacher_signoff','sort_order'],
   '{}'::text[], array['goal_id','key'], '{}'::text[], false),
  ('gyan_steps', 'Gyan Path steps', 'setup', 60, 'gyan_steps', array['content.manage'], 'gyan_path',
   array['kind','level_id','points','sort_order','title'],
   '{}'::text[], array['level_id','title'], '{}'::text[], false),
  ('opportunities', 'Opportunities and sponsorships', 'setup', 70, 'opportunities', array['giving.manage'], 'giving',
   array['amount_cents','campaign_id','description','kind','min_amount_cents','name','quantity_available','sort_order','status'],
   '{}'::text[], array['campaign_id','name'], array['amount_cents'], true),
  ('labh_options', 'Labh options', 'setup', 71, 'labh_options', array['giving.manage'], 'giving',
   array['active','amount_cents','campaign_id','fund_id','name','sort_order'],
   '{}'::text[], array['name'], array['amount_cents'], true),
  ('pickup_windows', 'Store pickup windows', 'setup', 72, 'pickup_windows', array['store.manage'], 'store',
   array['capacity','ends_at','location','order_cutoff_at','starts_at'],
   '{}'::text[], array['starts_at'], '{}'::text[], true),
  ('pathshala_classes', 'Pathshala classes', 'setup', 73, 'pathshala_classes', array['pathshala.manage'], 'pathshala',
   array['capacity','ends_time','level_id','meets_on','name','room','starts_time','term_id'],
   '{}'::text[], array['term_id','name'], '{}'::text[], true),
  ('whatsapp_groups', 'WhatsApp groups', 'setup', 74, 'whatsapp_groups', array['comms.send'], 'comms',
   array['active','audience','description','name','zone_id'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('households', 'Households', 'records', 100, 'households', array['people.manage'], 'people',
   array['address_line1','address_line2','city','directory_opt_in','display_name','household_number','notes','physical_mail_opt_in','postal_code','state_region','zone_id'],
   array['crm_id','legacy_id'], '{}'::text[], '{}'::text[], true),
  ('people', 'People', 'records', 101, 'people', array['people.manage'], 'people',
   array['date_of_birth','deceased_on','email','employer','first_name','gender','is_deceased','language','last_name','member_number','phone_e164','preferred_name','profession'],
   array['crm_id','email_opt_in','email_opt_in_date','email_opt_in_source','full_name','household_id','is_primary','legacy_id','other_emails','relationship'], '{}'::text[], '{}'::text[], true),
  ('household_members', 'Household members and relationships', 'records', 110, 'household_members', array['people.manage'], 'people',
   array['household_id','is_primary','joined_at','left_at','person_id','role'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('external_ids', 'Identifiers', 'records', 111, 'external_ids', array['people.manage','giving.manage'], 'people',
   array['household_id','kind','label','person_id','system','value'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('channel_optins', 'Consents, opt-ins and opt-outs', 'records', 112, 'channel_optins', array['comms.send'], 'comms',
   array['address','channel','opted_in','person_id','recorded_at','source'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('special_days', 'Special days', 'records', 120, 'special_days', array['people.manage'], 'people',
   array['calendar_date','household_id','kind','label','person_id','tithi','tithi_month'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('memberships', 'Memberships (current and past)', 'records', 121, 'memberships', array['people.manage'], 'membership',
   array['crm_external_id','ends_on','household_id','membership_type_id','notes','person_id','starts_on','status'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('pathshala_enrollments', 'Pathshala enrollments', 'records', 122, 'pathshala_enrollments', array['pathshala.manage'], 'pathshala',
   array['class_id','household_id','notes','status','student_person_id','term_id'],
   '{}'::text[], array['term_id','student_person_id'], '{}'::text[], true),
  ('pathshala_teachers', 'Pathshala teachers', 'records', 123, 'pathshala_teachers', array['pathshala.manage'], 'pathshala',
   array['class_id','person_id','role'],
   '{}'::text[], array['class_id','person_id'], '{}'::text[], true),
  ('volunteer_interests', 'Volunteer interests', 'records', 124, 'volunteer_interests', array['volunteers.manage'], 'volunteers',
   array['group_id','person_id','status'],
   '{}'::text[], array['person_id','group_id'], '{}'::text[], true),
  ('background_checks', 'Background checks', 'records', 125, 'background_checks', array['safety.manage'], 'volunteers',
   array['cleared_on','expires_on','person_id','provider','status'],
   '{}'::text[], '{}'::text[], '{}'::text[], true),
  ('store_items', 'Store items and opening stock', 'records', 130, 'store_items', array['store.manage'], 'store',
   array['category_id','description','low_stock_threshold','name','pack_size','price_cents','qbo_item_id','sku','status','taxable','track_inventory'],
   array['opening_stock'], array['sku'], array['price_cents'], true),
  ('pledges', 'Pledges', 'history', 200, 'pledges', array['giving.manage'], 'giving',
   array['amount_cents','anonymous','campaign_id','closed_at','crm_external_id','dedication','due_on','fund_id','household_id','pledge_number','pledged_at','pledged_by_person_id','source','status','write_off_reason','written_off_by_name'],
   array['paid_so_far'], '{}'::text[], array['amount_cents','paid_so_far'], true),
  ('payments', 'Payments (history)', 'history', 210, 'payments', array['giving.manage'], 'giving',
   array['amount_cents','check_number','crm_external_id','household_id','memo','method','payer_person_id','provider_ref','receipt_number','received_on','status'],
   array['allocate_to','allocation_cents'], '{}'::text[], array['amount_cents'], true),
  ('payment_allocations', 'Payment allocations', 'history', 220, 'payment_allocations', array['giving.manage'], 'giving',
   array['amount_cents','payment_id','pledge_id'],
   '{}'::text[], array['payment_id','pledge_id'], array['amount_cents'], true),
  ('recurring_gifts', 'Recurring gifts', 'history', 230, 'recurring_gifts', array['giving.manage'], 'giving',
   array['amount_cents','campaign_id','frequency','fund_id','household_id','method','next_charge_on','person_id','starts_on'],
   array['legacy_id'], '{}'::text[], array['amount_cents'], true),
  ('bolis', 'Past bolis', 'history', 240, 'bolis', array['bolis.manage'], 'bolis',
   array['campaign_id','closes_at','event_id','kind','name'],
   '{}'::text[], array['name'], '{}'::text[], true),
  ('boli_entries', 'Boli results', 'history', 241, 'boli_entries', array['bolis.manage'], 'bolis',
   array['amount_cents','boli_id','display_name','entered_at','household_id','person_id'],
   array['legacy_id'], '{}'::text[], array['amount_cents'], true),
  ('events', 'Past events', 'history', 242, 'events', array['events.manage'], 'events',
   array['description','ends_at','name','program_year','starts_at','venue'],
   array['legacy_id'], '{}'::text[], '{}'::text[], true),
  ('attendees', 'Event attendance', 'history', 243, 'attendees', array['events.manage'], 'events',
   array['checked_in_at','event_id','person_id'],
   array['household_id'], '{}'::text[], '{}'::text[], true),
  ('pathshala_attendance', 'Pathshala attendance', 'history', 244, 'pathshala_attendance', array['pathshala.manage'], 'pathshala',
   array['note','status'],
   array['class_id','held_on','student_person_id'], '{}'::text[], '{}'::text[], true)
on conflict (key) do update set label = excluded.label, tier = excluded.tier, sort = excluded.sort, target_table = excluded.target_table,
  write_perms = excluded.write_perms, module_key = excluded.module_key, columns = excluded.columns, extras = excluded.extras,
  natural_key = excluded.natural_key, money_columns = excluded.money_columns, has_center = excluded.has_center;
-- END import_entities seed

-- ═════════════════════════════════════════════════════════════════════════════
-- Comments
-- ═════════════════════════════════════════════════════════════════════════════
comment on function app.save_pathshala_level(uuid, jsonb, text) is
  'pathshala.manage: add (no "id") or change a level. Keys: id, track_id, key (letters, digits, - and _; made from the name when left out), name (1–80), sort_order, min_age and max_age (0–120 whole years on the term''s age cut-off; the minimum not above the maximum; null clears), active (false retires: not offered, history kept). A used level cannot move to another track; deleting it is refused (retire it). Returns the level with its band (adult: minimum 18 or more; children: maximum under 18; any).';
comment on function app.set_pathshala_level_fees(uuid, jsonb, text) is
  'p_fees: [{level_id, fee_cents}]: 0 is Free, otherwise at least 50 (the smallest online payment), at most 100000000; null removes a fee (refused after opening for a level with a class). The principal (pathshala.manage) while the term''s fees are not locked; after app.open_pathshala_registration only giving.manage with a reason, for new registrations only (P9). Returns {term_id, locked, fees[], missing[] (offered levels without a fee)}.';
comment on function app.set_pathshala_term_rules(uuid, jsonb, text) is
  'The same callers as the fees. Keys: payment_mode (pledge | pay_now: refused with app.pathshala_pay_now_ready''s sentence), hold_hours (1–168), office_payment_allowed, office_hold_days (1–21), seat_rule (automatic | office: pledge mode only), sibling_discount_pct (0–100), fee_per_family_cap_cents (null: no cap), registration_opens_at, registration_closes_at (after it opens), late_registration_closes_at (after registration_closes_at), late_fee_cents, withdrawal_credit_until, age_cutoff_on, membership_required, fund_id (giving.manage; once registration has opened it can change but not be emptied: "The fund for the Pathshala fees cannot be cleared once registration has opened. Choose another fund instead."). Returns the term as app.pathshala_registration_options shows it.';
comment on function app.open_pathshala_registration(uuid, text) is
  'pathshala.manage: refuses while an offered level (active, with a class this term) has no fee ("Set the fee for Gujarati 3 and Hindi 1 before opening registration.") and, for pay now, while it is not ready; with Pledges & donations on it creates or reuses the closed campaign "Pathshala fees <term>" (kind pathshala) linked to the term''s fund, else the Pathshala fund (key pathshala, or a fund named Pathshala; none: "There is no fund for the Pathshala fees yet. Ask the treasurer to add a fund called Pathshala in Setup › Lists, or choose a fund on this Fees screen if you also manage Giving; then open registration."); fixes the age cut-off and withdrawal deadline, locks the fees and rules, and moves a draft to registration. Idempotent. Returns {term_id, status, already_open, fees_locked_at, campaign_id, fund_id, payment_mode, warnings[] (offered levels with no age band)}.';
comment on function app.pathshala_quote(uuid, uuid, jsonb) is
  'The one pricing rule (§2.4) for an adult of the household or Pathshala staff: p_lines [{person_id | new_child, track_id, level_id}] → {lines[{index, person_id, track_id, level_id, learner_kind, family_rank (children only), age_on_cutoff, base_fee_cents, sibling_discount_cents, cap_reduction_cents, late_fee_cents, assistance_cents, total_cents, priced}], children_total_cents, adults_total_cents, total_cents, late, rule_snapshot}. Writes nothing.';
comment on function app.pathshala_fee_example(uuid, jsonb) is
  '"Try a family" on the Fees screen (pathshala.view): hypothetical lines [{learner (optional, 1–80 characters), name, age | date_of_birth, learner_kind, track_id, level_id}], or {"lines": [...], "late": true}; nobody''s registrations count. Prices as a registration does: lines with the same learner (trimmed, any case) are ONE learner (one child for the sibling order and the family cap, one late fee, P10); without learner each line is its own learner. Same shape as app.pathshala_quote, and each line has refusal: null, or the plain sentence a registration would refuse that line with (a level without a fee, not offered, of another track, an adult class for a child or a children''s level for an adult, no track, no level in a pay-now term, the same learner twice in a track); a refused line has priced false and every amount 0, and is left out of the totals and the sibling order.';
comment on function app.pathshala_registration_options(uuid, uuid) is
  'The member app''s registration flow (§2.17): {term, household {id, name, number, membership: active | applying | none}, households[] (where the caller is an adult), learners[{person_id, first_name, is_me, age_on_cutoff, counts_as_child, needs_birth_date, enrollments[], suggested[{track_id, level_id, reason: teacher | previous | age}]}], tracks[{id, key, name, levels[{id, name, key, min_age, max_age, band, fee_cents, seats: open | waitlist | full}]}], can_register, cannot_reason}. A household member (a child sees can_register false with the reason) or pathshala.manage.';
comment on function app.preview_pathshala_registration(uuid, uuid, jsonb) is
  'The §2.17 registration shape without writing anything: {registration_id: null, lines[... outcome: seat | waitlist | membership_hold | office | pending_child | waiver_hold], children_total_cents, adults_total_cents, total_cents, due_now_cents, pay (pay-now terms: {amount_cents, pledge_ids: [], for_label, hold_until, office_payment_allowed}), pending[], late}. Refuses what the registration would refuse.';
comment on function app.pathshala_seats(uuid) is
  'Per offered level: {level_id, level, track_id, track, fee_cents, classes, seats (null: no limit), taken, held, free (null: no limit), waitlist, waitlist_on, state: open | waitlist | full}. Counts only; members (term out of Draft) and Pathshala staff.';
comment on function app.pathshala_pay_now_ready(uuid) is
  'null when a term may choose Pay now, else why not: Pledges & donations off, no card or PayPal payments taking money, or (until 0595) "Pay at registration waits for fee receipts (P13)."';
comment on function app.pathshala_counts_as_child(uuid, date) is 'Under 18 on the date (the term''s age cut-off); no birth date: app.person_is_minor''s household rule.';
comment on function app.pathshala_adult_of_household(uuid, uuid) is 'The caller is in the household and an adult by app.gyan_i_am_adult (a child with no birth date is not an adult).';

-- ═════════════════════════════════════════════════════════════════════════════
-- Grants
-- ═════════════════════════════════════════════════════════════════════════════
-- The RPCs: signed-in users (each one checks who may), and service_role for scripts.
revoke execute on function
  app.save_pathshala_level(uuid, jsonb, text), app.set_pathshala_level_fees(uuid, jsonb, text),
  app.set_pathshala_term_rules(uuid, jsonb, text), app.open_pathshala_registration(uuid, text),
  app.pathshala_quote(uuid, uuid, jsonb), app.pathshala_fee_example(uuid, jsonb), app.pathshala_registration_options(uuid, uuid),
  app.preview_pathshala_registration(uuid, uuid, jsonb), app.pathshala_seats(uuid), app.pathshala_pay_now_ready(uuid)
  from public, anon;
grant execute on function
  app.save_pathshala_level(uuid, jsonb, text), app.set_pathshala_level_fees(uuid, jsonb, text),
  app.set_pathshala_term_rules(uuid, jsonb, text), app.open_pathshala_registration(uuid, text),
  app.pathshala_quote(uuid, uuid, jsonb), app.pathshala_fee_example(uuid, jsonb), app.pathshala_registration_options(uuid, uuid),
  app.preview_pathshala_registration(uuid, uuid, jsonb), app.pathshala_seats(uuid), app.pathshala_pay_now_ready(uuid)
  to authenticated, service_role;
-- The helper the row level security policies call (it answers only about the caller).
revoke execute on function app.pathshala_adult_of_household(uuid, uuid) from public, anon;
grant execute on function app.pathshala_adult_of_household(uuid, uuid) to authenticated, service_role;
-- Pure formatting: harmless.
revoke execute on function app.pathshala_money(bigint), app.pathshala_iso(timestamptz, text), app.pathshala_age_on(date, date),
  app.pathshala_level_band(integer, integer), app.pathshala_seat_state(integer, integer, boolean), app.pathshala_fee_label(text, text[])
  from public, anon;
grant execute on function app.pathshala_money(bigint), app.pathshala_iso(timestamptz, text), app.pathshala_age_on(date, date),
  app.pathshala_level_band(integer, integer), app.pathshala_seat_state(integer, integer, boolean), app.pathshala_fee_label(text, text[])
  to authenticated, service_role;
-- Internal: only the functions above call these, as their definer. Several are security definer and would answer for any
-- id they are given (a person's name or child flag, a household's membership, a term's waiver, seat counts).
revoke execute on function
  app.pathshala_first_name(uuid), app.pathshala_counts_as_child(uuid, date), app._pathshala_uuid(jsonb, text, text),
  app._pathshala_int(jsonb, text, text), app._pathshala_bool(jsonb, text, text), app._pathshala_date(jsonb, text, text),
  app._pathshala_ts(jsonb, text, text), app.pathshala_levels_delete_guard(), app.pathshala_level_used(uuid),
  app._pathshala_level_json(uuid), app.pathshala_first_class_day(uuid, uuid), app.pathshala_age_cutoff(uuid),
  app.pathshala_withdrawal_deadline(uuid), app.pathshala_registration_window(uuid), app.pathshala_is_late(uuid),
  app.pathshala_terms_guard(), app._pathshala_assert_fee_editor(app.pathshala_terms, text, text),
  app.pathshala_online_payments_ready(uuid), app._pathshala_pay_now_problem(uuid), app._pathshala_fees_json(uuid),
  app._pathshala_term_json(uuid), app.pathshala_level_seats(uuid, uuid), app._pathshala_price(uuid, uuid, jsonb, boolean, boolean),
  app._pathshala_existing_lines(uuid, uuid),
  app.pathshala_household_membership(uuid), app.pathshala_membership_hold_applies(uuid, uuid), app.pathshala_current_waiver(uuid),
  app.pathshala_waiver_consent(uuid, uuid), app.pathshala_level_offered(uuid, uuid), app.pathshala_suggestions(uuid, uuid),
  app._pathshala_registrant(uuid, uuid), app._pathshala_cannot_register(uuid, text), app._pathshala_plan(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function
  app.pathshala_first_name(uuid), app.pathshala_counts_as_child(uuid, date), app._pathshala_uuid(jsonb, text, text),
  app._pathshala_int(jsonb, text, text), app._pathshala_bool(jsonb, text, text), app._pathshala_date(jsonb, text, text),
  app._pathshala_ts(jsonb, text, text), app.pathshala_level_used(uuid),
  app._pathshala_level_json(uuid), app.pathshala_first_class_day(uuid, uuid), app.pathshala_age_cutoff(uuid),
  app.pathshala_withdrawal_deadline(uuid), app.pathshala_registration_window(uuid), app.pathshala_is_late(uuid),
  app.pathshala_online_payments_ready(uuid), app._pathshala_pay_now_problem(uuid), app._pathshala_fees_json(uuid),
  app._pathshala_term_json(uuid), app.pathshala_level_seats(uuid, uuid), app._pathshala_price(uuid, uuid, jsonb, boolean, boolean),
  app._pathshala_existing_lines(uuid, uuid),
  app.pathshala_household_membership(uuid), app.pathshala_membership_hold_applies(uuid, uuid), app.pathshala_current_waiver(uuid),
  app.pathshala_waiver_consent(uuid, uuid), app.pathshala_level_offered(uuid, uuid), app.pathshala_suggestions(uuid, uuid),
  app._pathshala_plan(uuid, uuid, jsonb, text)
  to service_role;
