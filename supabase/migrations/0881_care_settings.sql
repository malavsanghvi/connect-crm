-- 0881 · DonorDelight slice 3, part 1: the thank-you rules of the community (docs/DONORDELIGHT.md section 12; W2, W8; the plan the owner
-- told us to build on 2026-10-16).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.care_settings   one row per community: how fast a gift is thanked, which gifts need a personal thank-you, and the day thank-yous
--                       begin. Nothing is thanked before the rules are first saved.
--       thank_window_days     a gift should be thanked within this many days (default 2; 1 to 30)
--       first_gift_personal   a household's first gift ever needs a personal thank-you (a call, a visit, a card or a video), not only
--                             the receipt (default yes)
--       personal_from_cents   from this donation amount a gift needs a personal thank-you; empty means no amount does. Integer cents.
--       count_fees            memberships, school and class fees and store sales are not donations; yes would thank them too (default no)
--       thanks_from           the first day a gift opens a thank-you step: the day the rules are first saved, or 30 days earlier when
--                             the person saving them asked to include the last 30 days
--   app.care_settings_get(center)                       the rules, or the defaults with saved = false
--   app.save_care_settings(center, settings, last_30)   write them. Whoever manages DonorDelight, or Weaver support while the owner's
--                                                       support grant names the care.settings area (0758, W8): settings only, never
--                                                       the records. last_30 counts only the first time.
--   Every change is audited with app.audit_private_row (0758: who, when, which columns, never the values). Reading the rules is not
--   a read of a care record, so it is not logged as one.
set client_min_messages = warning;

create table if not exists app.care_settings (
  center_id           uuid primary key references app.centers(id) on delete cascade,
  thank_window_days   integer not null default 2 check (thank_window_days between 1 and 30),
  first_gift_personal boolean not null default true,
  personal_from_cents bigint check (personal_from_cents is null or personal_from_cents between 1 and 100000000000),
  count_fees          boolean not null default false,
  thanks_from         date not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id) on delete set null
);
comment on table app.care_settings is
  'DonorDelight (0881): the community''s thank-you rules (window, personal thank-yous, fees, the first day). Written only by app.save_care_settings (care.manage, or support with the care.settings area). Read through app.care_settings_get.';

drop trigger if exists audit_care_settings on app.care_settings;
create trigger audit_care_settings after insert or update or delete on app.care_settings
  for each row execute function app.audit_private_row('care', 'center_id');
insert into app.module_tables (table_name, module_key) values ('care_settings', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.care_settings enable row level security;
drop policy if exists care_settings_read on app.care_settings;
create policy care_settings_read on app.care_settings for select to authenticated
  using (center_id = any ((select app.care_view_centers())::uuid[]) or app.care_settings_can(center_id));
drop policy if exists module_switch on app.care_settings;
create policy module_switch on app.care_settings as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_settings from public, anon, authenticated;
grant select on app.care_settings to authenticated;
grant all on app.care_settings to service_role;

-- The rules, or the defaults. Anyone who holds a care key, or support with the care.settings area.
create or replace function app.care_settings_get(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_settings;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if not (app.care_can(p_center, 'own') or app.care_settings_can(p_center)) then perform app._care_refuse(p_center); end if;
  select * into s from app.care_settings where center_id = p_center;
  return jsonb_build_object(
    'saved', s.center_id is not null,
    'thank_window_days', coalesce(s.thank_window_days, 2),
    'first_gift_personal', coalesce(s.first_gift_personal, true),
    'personal_from_cents', s.personal_from_cents,
    'count_fees', coalesce(s.count_fees, false),
    'thanks_from', s.thanks_from,
    'today', app._care_today(p_center),
    'can_manage', app.care_settings_can(p_center));
end $$;

-- p_settings: {thank_window_days?, first_gift_personal?, personal_from_cents?, count_fees?}; a key that is left out keeps its value
-- (or the default the first time); personal_from_cents may be null (no amount needs one). p_last_30: the first save only.
create or replace function app.save_care_settings(p_center uuid, p_settings jsonb, p_last_30 boolean default false) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_settings; k text; v_window integer; v_first boolean; v_from_cents bigint; v_fees boolean; v_today date; v_start date;
  v_allowed constant text[] := array['thank_window_days', 'first_gift_personal', 'personal_from_cents', 'count_fees'];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if not app.care_settings_can(p_center) then perform app._care_refuse(p_center); end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'Nothing to save: send the thank-you rules.' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_settings) loop
    if not (k = any (v_allowed)) then raise exception 'The thank-you rules have no field "%".', k using errcode = '22023'; end if;
  end loop;
  select * into s from app.care_settings where center_id = p_center for update;

  v_window := coalesce(case when p_settings ? 'thank_window_days' then nullif(p_settings->>'thank_window_days', '')::integer end, s.thank_window_days, 2);
  if v_window < 1 or v_window > 30 then raise exception 'Thank a gift within 1 to 30 days.' using errcode = '23514'; end if;
  if p_settings ? 'first_gift_personal' and jsonb_typeof(p_settings->'first_gift_personal') <> 'boolean' then
    raise exception 'A first gift needs a personal thank-you is yes or no.' using errcode = '22023';
  end if;
  v_first := coalesce((p_settings->>'first_gift_personal')::boolean, s.first_gift_personal, true);
  if p_settings ? 'count_fees' and jsonb_typeof(p_settings->'count_fees') <> 'boolean' then
    raise exception 'Thank memberships and fees too is yes or no.' using errcode = '22023';
  end if;
  v_fees := coalesce((p_settings->>'count_fees')::boolean, s.count_fees, false);
  if p_settings ? 'personal_from_cents' then
    if jsonb_typeof(p_settings->'personal_from_cents') = 'null' then v_from_cents := null;
    elsif jsonb_typeof(p_settings->'personal_from_cents') = 'number' and (p_settings->>'personal_from_cents') ~ '^[0-9]+$' then
      v_from_cents := (p_settings->>'personal_from_cents')::bigint;
    else raise exception 'The amount from which a gift needs a personal thank-you is a whole number of cents, or empty.' using errcode = '22023';
    end if;
    if v_from_cents is not null and (v_from_cents < 1 or v_from_cents > 100000000000) then
      raise exception 'The amount from which a gift needs a personal thank-you must be more than zero.' using errcode = '23514';
    end if;
  else
    v_from_cents := s.personal_from_cents;
  end if;

  v_today := app._care_today(p_center);
  if s.center_id is not null and coalesce(p_last_30, false) then
    raise exception 'Including the last 30 days applies only when the rules are first saved.' using errcode = '22023';
  end if;
  v_start := coalesce(s.thanks_from, case when coalesce(p_last_30, false) then v_today - 30 else v_today end);

  perform app.set_audit_context('Care thank-you rules saved');
  insert into app.care_settings (center_id, thank_window_days, first_gift_personal, personal_from_cents, count_fees, thanks_from, updated_by)
  values (p_center, v_window, v_first, v_from_cents, v_fees, v_start, auth.uid())
  on conflict (center_id) do update
    set thank_window_days = excluded.thank_window_days, first_gift_personal = excluded.first_gift_personal,
        personal_from_cents = excluded.personal_from_cents, count_fees = excluded.count_fees,
        updated_at = now(), updated_by = auth.uid();
  return app.care_settings_get(p_center);
end $$;

revoke execute on function app.care_settings_get(uuid), app.save_care_settings(uuid, jsonb, boolean) from public, anon;
grant execute on function app.care_settings_get(uuid), app.save_care_settings(uuid, jsonb, boolean) to authenticated, service_role;
