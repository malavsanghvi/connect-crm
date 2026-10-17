-- 0896 · DonorDelight slice 8: Niva and the care plan from the mission (docs/DONORDELIGHT.md sections 5.9, 8 and 9; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Niva (the organization's agent) may help with relationship care, ONLY through the existing command layer (src/lib/commands/catalog/care), with the asking person's own
--   rights (W2 applies to Niva exactly as to a screen), and ONLY when three things are true: iWeaver (module `ai`) is on, DonorDelight (module `care`) is on, and the
--   organization has ticked it for itself. The tick is this file's table:
--   app.care_niva_settings      per community: Niva may help with relationship care yes or no (default NO). Written only by app.save_care_niva (care.manage).
--   app.care_niva_get(center)   care.own and up: the tick, and whether iWeaver is on, so a command can say which of the three is missing
--   What Niva never gets: an amount, a free-text note, the reason a household is not to be asked, anyone under 18, more than ten households in an answer. It drafts; a person sends.
--
--   The care plan from the mission: a yearly calendar of relationship moments, saying which group of households gets which touch and when, drafted from the organization's
--   mission, its own calendar, its fiscal year and its quiet periods, edited and APPROVED by a care manager. Nothing in the plan runs by itself: it is a calendar for the team to follow,
--   and an edit to an approved plan returns it to draft until it is approved again. No step of a plan asks for money (the same words check as a gesture, 0894).
--   app.care_plans              one plan per community and year: status draft or approved, a summary, the moments (jsonb, at most 60)
--   app.care_plan_get(center, year)       care.own and up
--   app.care_plan_context(center, year)   care.own and up: what a draft is made from: the mission, the community's own calendar for the year, the fiscal year, the quiet periods, and
--                                         HOW MANY households are in each group (a count, never a household); logged
--   app.save_care_plan(center, year, plan)  care.manage: save the draft (an approved plan becomes a draft again)
--   app.approve_care_plan(center, year)     care.manage: approve it (at least one moment)
--   Audit: app.audit_private_row (0758): who, when, which columns, never the words.
set client_min_messages = warning;

create table if not exists app.care_niva_settings (
  center_id  uuid primary key references app.centers(id) on delete cascade,
  enabled    boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table app.care_niva_settings is
  'DonorDelight (0896): the organization''s own tick for Niva to help with relationship care (default off). iWeaver (module ai) and DonorDelight (module care) must be on as well. Written only by app.save_care_niva (care.manage).';

create table if not exists app.care_plans (
  id          uuid primary key default gen_random_uuid(),
  center_id   uuid not null references app.centers(id) on delete cascade,
  year        integer not null check (year between 2000 and 2100),
  status      text not null default 'draft' check (status in ('draft', 'approved')),
  summary     text check (summary is null or char_length(btrim(summary)) between 1 and 1000),
  items       jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 60),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  unique (center_id, year),
  constraint care_plans_approved_has_who check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);
comment on table app.care_plans is
  'DonorDelight (0896): the yearly care plan of a community (moments: a day, a title, a group of households, a kind of touch, a note). Draft until a care manager approves it; an edit returns it to draft. Nothing runs by itself. Written only by app.save_care_plan / app.approve_care_plan.';

drop trigger if exists audit_care_niva_settings on app.care_niva_settings;
create trigger audit_care_niva_settings after insert or update or delete on app.care_niva_settings
  for each row execute function app.audit_private_row('care', 'center_id');
drop trigger if exists audit_care_plans on app.care_plans;
create trigger audit_care_plans after insert or update or delete on app.care_plans
  for each row execute function app.audit_private_row('care');
insert into app.module_tables (table_name, module_key) values ('care_niva_settings', 'care'), ('care_plans', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.care_niva_settings enable row level security;
alter table app.care_plans enable row level security;
drop policy if exists care_niva_settings_read on app.care_niva_settings;
create policy care_niva_settings_read on app.care_niva_settings for select to authenticated using (app.care_can(center_id, 'own'));
drop policy if exists care_plans_read on app.care_plans;
create policy care_plans_read on app.care_plans for select to authenticated using (app.care_can(center_id, 'own'));
drop policy if exists module_switch on app.care_niva_settings;
create policy module_switch on app.care_niva_settings as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
drop policy if exists module_switch on app.care_plans;
create policy module_switch on app.care_plans as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_niva_settings, app.care_plans from public, anon, authenticated;
grant select on app.care_niva_settings, app.care_plans to authenticated;
grant all on app.care_niva_settings, app.care_plans to service_role;

-- ── The tick ──────────────────────────────────────────────────────────────────
create or replace function app.care_niva_get(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_niva_settings;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  select * into s from app.care_niva_settings where center_id = p_center;
  return jsonb_build_object('enabled', coalesce(s.enabled, false), 'ai', app.module_enabled(p_center, 'ai'), 'enabled_at', s.enabled_at,
                            'can_manage', app.care_can(p_center, 'manage'), 'label', app._module_label(p_center, 'care'));
end $$;

create or replace function app.save_care_niva(p_center uuid, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  if p_enabled is null then raise exception 'Say whether Niva may help with relationship care.' using errcode = '22023'; end if;
  perform app.set_audit_context(case when p_enabled then 'Niva may help with relationship care' else 'Niva may no longer help with relationship care' end);
  insert into app.care_niva_settings (center_id, enabled, enabled_at, enabled_by, updated_by)
  values (p_center, p_enabled, case when p_enabled then now() end, case when p_enabled then auth.uid() end, auth.uid())
  on conflict (center_id) do update
    set enabled = excluded.enabled,
        enabled_at = case when excluded.enabled and not app.care_niva_settings.enabled then now() when not excluded.enabled then null else app.care_niva_settings.enabled_at end,
        enabled_by = case when excluded.enabled and not app.care_niva_settings.enabled then auth.uid() when not excluded.enabled then null else app.care_niva_settings.enabled_by end,
        updated_at = now(), updated_by = auth.uid();
  return app.care_niva_get(p_center);
end $$;

-- ── The care plan ─────────────────────────────────────────────────────────────
create or replace function app.care_plan_get(p_center uuid, p_year integer) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.care_plans;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'Choose a year between 2000 and 2100.' using errcode = '23514'; end if;
  select * into p from app.care_plans where center_id = p_center and year = p_year;
  return jsonb_build_object(
    'year', p_year, 'exists', p.id is not null, 'status', coalesce(p.status, 'none'), 'summary', p.summary,
    'items', coalesce((select jsonb_agg(i order by i ->> 'on', i ->> 'id') from jsonb_array_elements(coalesce(p.items, '[]'::jsonb)) i), '[]'::jsonb),
    'approved_at', p.approved_at, 'updated_at', p.updated_at,
    'years', (select coalesce(jsonb_agg(x.year order by x.year), '[]'::jsonb) from app.care_plans x where x.center_id = p_center),
    'can_manage', app.care_can(p_center, 'manage'), 'label', app._module_label(p_center, 'care'), 'today', app._care_today(p_center));
end $$;

-- What a draft is made from. Counts only for the groups: never a household. The community's own calendar entries (titles and days) are the
-- organization's, not about a person.
create or replace function app.care_plan_context(p_center uuid, p_year integer) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_groups jsonb; v_cal jsonb; v_quiet jsonb; v_mission text; v_fy integer; v_aud text; v_playbooks jsonb; v_gestures integer; v_n integer;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'Choose a year between 2000 and 2100.' using errcode = '23514'; end if;
  select nullif(btrim(o.mission), ''), o.fiscal_year_start_month into v_mission, v_fy from app.org_profiles o where o.center_id = p_center;
  v_aud := app._care_audience(p_center);
  -- Households in each group now (the same triggers as the playbooks, 0892): only whoever may see every household gets the counts.
  if app.care_can(p_center, 'view') then
    select coalesce(jsonb_object_agg(t.trigger_key, t.n), '{}'::jsonb) into v_groups
      from (select r.trigger_key, count(*) as n from app._care_trigger_rows(p_center) r group by r.trigger_key) t;
  else
    v_groups := '{}'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('title', e.title, 'on', e.starts_on) order by e.starts_on, e.title), '[]'::jsonb) into v_cal
    from (select ce.title, ce.starts_on from app.calendar_entries ce
            left join app.calendar_layers l on l.id = ce.layer_id
           where ce.center_id = p_center and ce.starts_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
             and coalesce(l.kind, '') <> 'school_district' and char_length(btrim(ce.title)) between 1 and 120
           order by ce.starts_on, ce.title limit 40) e;
  select coalesce(jsonb_agg(jsonb_build_object('name', q.name, 'starts_on', q.starts_on, 'ends_on', q.ends_on, 'yearly', q.yearly) order by q.starts_on), '[]'::jsonb) into v_quiet
    from app.care_quiet_periods q where q.center_id = p_center and q.archived_at is null;
  select coalesce(jsonb_agg(p.name order by p.sort, p.name), '[]'::jsonb) into v_playbooks from app.care_playbooks p where p.center_id = p_center and p.enabled;
  select count(*) into v_gestures from app.care_gestures g where g.center_id = p_center and g.enabled;
  perform app.log_private_read(p_center, 'care', 'plan_context', 1);
  return jsonb_build_object('year', p_year, 'audience', v_aud, 'mission', v_mission, 'fiscal_year_start_month', coalesce(v_fy, 1), 'groups', v_groups, 'calendar', v_cal,
                            'quiet_periods', v_quiet, 'playbooks', v_playbooks, 'gestures', v_gestures, 'label', app._module_label(p_center, 'care'));
end $$;

-- p_plan: {summary?, items: [{id?, on, title, group, kind, note?}]}. An item's day must be in the plan's year. Saving makes the plan a draft.
create or replace function app.save_care_plan(p_center uuid, p_year integer, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.care_plans; k text; it jsonb; i integer := 0; v_summary text; v_items jsonb := '[]'::jsonb; v_on date; v_title text; v_group text; v_kind text; v_note text; v_id text;
  v_pkeys constant text[] := array['summary', 'items'];
  v_ikeys constant text[] := array['id', 'on', 'title', 'group', 'kind', 'note'];
  v_groups constant text[] := array['all', 'first_gift', 'new_household', 'steady', 'cooling', 'at_risk', 'lapsed', 'volunteer_no_gift', 'giver_no_part', 'pledge_due', 'monthly_giver'];
  v_kinds constant text[] := array['thank_you', 'check_in', 'greeting', 'welcome', 'update', 'invitation', 'other'];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then raise exception 'Choose a year between 2000 and 2100.' using errcode = '23514'; end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then raise exception 'Nothing to save: send the plan.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_plan) loop
    if not (k = any (v_pkeys)) then raise exception 'A care plan has no field "%".', k using errcode = '22023'; end if;
  end loop;
  v_summary := nullif(btrim(coalesce(p_plan->>'summary', '')), '');
  if v_summary is not null and char_length(v_summary) > 1000 then raise exception 'The summary is at most 1,000 characters.' using errcode = '23514'; end if;
  if jsonb_typeof(p_plan->'items') is distinct from 'array' then raise exception 'A care plan needs its moments (a list).' using errcode = '22023'; end if;
  if jsonb_array_length(p_plan->'items') > 60 then raise exception 'A care plan has at most 60 moments.' using errcode = '23514'; end if;
  if app._care_words_ask(v_summary) then raise exception 'A care plan is never paired with an ask. Take out the words that ask for a gift, a donation or a pledge; an ask is its own step, later.' using errcode = '23514'; end if;
  for it in select e from jsonb_array_elements(p_plan->'items') e loop
    i := i + 1;
    if jsonb_typeof(it) <> 'object' then raise exception 'Moment % was not understood.', i using errcode = '22023'; end if;
    for k in select jsonb_object_keys(it) loop
      if not (k = any (v_ikeys)) then raise exception 'A moment has no field "%". A care plan is never paired with an ask.', k using errcode = '22023'; end if;
    end loop;
    begin v_on := (it->>'on')::date; exception when others then v_on := null; end;
    if v_on is null or extract(year from v_on)::int <> p_year then raise exception 'Moment %: choose a day in %.', i, p_year using errcode = '23514'; end if;
    v_title := btrim(coalesce(it->>'title', ''));
    if char_length(v_title) < 1 or char_length(v_title) > 120 then raise exception 'Moment %: give it a title of up to 120 characters.', i using errcode = '23514'; end if;
    v_group := coalesce(nullif(btrim(coalesce(it->>'group', '')), ''), 'all');
    if not (v_group = any (v_groups)) then raise exception 'Moment %: say which households it is for: everyone, or one of the groups.', i using errcode = '23514'; end if;
    v_kind := btrim(coalesce(it->>'kind', ''));
    if not (v_kind = any (v_kinds)) then raise exception 'Moment %: say what the touch is: a thank-you, a check-in, a greeting, a welcome, an update, an invitation or something else.', i using errcode = '23514'; end if;
    v_note := nullif(btrim(coalesce(it->>'note', '')), '');
    if v_note is not null and char_length(v_note) > 400 then raise exception 'Moment %: the note is at most 400 characters.', i using errcode = '23514'; end if;
    if app._care_words_ask(v_title) or app._care_words_ask(v_note) then
      raise exception 'Moment %: a care plan is never paired with an ask. Take out the words that ask for a gift, a donation or a pledge; an ask is its own step, later.', i using errcode = '23514';
    end if;
    v_id := coalesce(nullif(btrim(coalesce(it->>'id', '')), ''), substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    if v_id !~ '^[a-z0-9]{6,36}$' then raise exception 'Moment %: its identifier is not valid.', i using errcode = '22023'; end if;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', v_id, 'on', v_on, 'title', v_title, 'group', v_group, 'kind', v_kind, 'note', v_note)));
  end loop;
  perform app.set_audit_context('Care plan saved');
  insert into app.care_plans (center_id, year, status, summary, items, created_by, updated_by)
  values (p_center, p_year, 'draft', v_summary, v_items, auth.uid(), auth.uid())
  on conflict (center_id, year) do update
    set status = 'draft', summary = excluded.summary, items = excluded.items, approved_by = null, approved_at = null, updated_at = now(), updated_by = auth.uid();
  return app.care_plan_get(p_center, p_year);
end $$;

create or replace function app.approve_care_plan(p_center uuid, p_year integer) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.care_plans;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  select * into p from app.care_plans where center_id = p_center and year = p_year for update;
  if p.id is null then raise exception 'There is no plan for % yet. Draft one first.', p_year using errcode = 'P0002'; end if;
  if jsonb_array_length(p.items) = 0 then raise exception 'A plan with no moments cannot be approved. Add the moments first.' using errcode = '23514'; end if;
  perform app.set_audit_context('Care plan approved');
  update app.care_plans set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now(), updated_by = auth.uid() where id = p.id;
  return app.care_plan_get(p_center, p_year);
end $$;

revoke execute on function app.care_niva_get(uuid), app.save_care_niva(uuid, boolean), app.care_plan_get(uuid, integer), app.care_plan_context(uuid, integer),
  app.save_care_plan(uuid, integer, jsonb), app.approve_care_plan(uuid, integer) from public, anon;
grant execute on function app.care_niva_get(uuid), app.save_care_niva(uuid, boolean), app.care_plan_get(uuid, integer), app.care_plan_context(uuid, integer),
  app.save_care_plan(uuid, integer, jsonb), app.approve_care_plan(uuid, integer) to authenticated, service_role;
