-- 0897 · DonorDelight slice 9: "How would you like to be thanked?" in the member app (docs/DONORDELIGHT.md sections 3 and 9; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   A member (an adult of a household) can tell the organization how their household would like to be thanked and recognised, and how to reach them.
--   They see and change ONLY that: three choices. They never see notes, signs, owners, touches, lists or anything else the organization keeps (W2: only the roles the
--   organization chooses see care data, and a member is not one of them). Their choices are written into the household's care profile (0761), where the
--   organization's care roles see them as they see any profile, and the audit records who changed which columns, never more.
--   The organization decides whether to ask: the question is OFF until a care manager turns it on (app.care_member_settings), and it needs DonorDelight on.
--   Members under 18 are never asked; a platform admin who is not a member of the community has no household and is told nothing.
--   app.care_member_settings        per community: ask members yes or no (default NO). Written only by app.save_care_member_settings (care.manage).
--   app.care_member_settings_get    care.own and up
--   app.member_care_preferences(center)        the signed-in member's own three choices and whether the question is available
--   app.save_member_care_preferences(center, prefs)   {thanks?, recognition?, channel?}: a key left out keeps its value, null clears it
set client_min_messages = warning;

create table if not exists app.care_member_settings (
  center_id  uuid primary key references app.centers(id) on delete cascade,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table app.care_member_settings is
  'DonorDelight (0897): whether the member app asks members how they would like to be thanked (default no). Written only by app.save_care_member_settings (care.manage).';
drop trigger if exists audit_care_member_settings on app.care_member_settings;
create trigger audit_care_member_settings after insert or update or delete on app.care_member_settings
  for each row execute function app.audit_private_row('care', 'center_id');
insert into app.module_tables (table_name, module_key) values ('care_member_settings', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;
alter table app.care_member_settings enable row level security;
drop policy if exists care_member_settings_read on app.care_member_settings;
create policy care_member_settings_read on app.care_member_settings for select to authenticated using (app.care_can(center_id, 'own'));
drop policy if exists module_switch on app.care_member_settings;
create policy module_switch on app.care_member_settings as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_member_settings from public, anon, authenticated;
grant select on app.care_member_settings to authenticated;
grant all on app.care_member_settings to service_role;

create or replace function app.care_member_settings_get(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  return jsonb_build_object('enabled', coalesce((select s.enabled from app.care_member_settings s where s.center_id = p_center), false), 'can_manage', app.care_can(p_center, 'manage'));
end $$;

create or replace function app.save_care_member_settings(p_center uuid, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  if p_enabled is null then raise exception 'Say whether members are asked how they would like to be thanked.' using errcode = '22023'; end if;
  perform app.set_audit_context(case when p_enabled then 'Members are asked how they would like to be thanked' else 'Members are no longer asked how they would like to be thanked' end);
  insert into app.care_member_settings (center_id, enabled, updated_by) values (p_center, p_enabled, auth.uid())
  on conflict (center_id) do update set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  return app.care_member_settings_get(p_center);
end $$;

-- The household of the signed-in member in this community (an adult who has not left), or null. Never a platform admin as such.
create or replace function app._care_my_household(p_center uuid) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select hm.household_id
    from app.household_members hm
    join app.center_users cu on cu.person_id = hm.person_id and cu.center_id = hm.center_id
   where cu.user_id = auth.uid() and cu.center_id = p_center and hm.left_at is null
     and not app.person_is_minor(hm.person_id)
   order by hm.is_primary desc, hm.joined_at nulls last, hm.household_id
   limit 1
$$;
revoke execute on function app._care_my_household(uuid) from public, anon, authenticated;

create or replace function app.member_care_preferences(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_h uuid; cp app.care_profiles;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  v_h := app._care_my_household(p_center);
  if v_h is null or not app._org_private_module_on(p_center, 'care')
     or not coalesce((select s.enabled from app.care_member_settings s where s.center_id = p_center), false) then
    return jsonb_build_object('available', false);
  end if;
  select * into cp from app.care_profiles where household_id = v_h;
  return jsonb_build_object('available', true, 'thanks', cp.thanks, 'recognition', cp.recognition, 'channel', cp.channel);
end $$;

create or replace function app.save_member_care_preferences(p_center uuid, p_prefs jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_h uuid; k text; cp app.care_profiles; v_thanks text; v_recog text; v_channel text;
  v_allowed constant text[] := array['thanks', 'recognition', 'channel'];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  v_h := app._care_my_household(p_center);
  if v_h is null or not app._org_private_module_on(p_center, 'care')
     or not coalesce((select s.enabled from app.care_member_settings s where s.center_id = p_center), false) then
    raise exception 'Your organization is not asking this yet.' using errcode = 'insufficient_privilege';
  end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then raise exception 'Nothing to save: choose how you would like to be thanked.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_prefs) loop
    if not (k = any (v_allowed)) then raise exception 'You can choose how you would like to be thanked, recognised and reached; nothing else here (not "%").', k using errcode = '22023'; end if;
  end loop;
  select * into cp from app.care_profiles where household_id = v_h;
  v_thanks := case when p_prefs ? 'thanks' then nullif(btrim(coalesce(p_prefs->>'thanks', '')), '') else cp.thanks end;
  v_recog := case when p_prefs ? 'recognition' then nullif(btrim(coalesce(p_prefs->>'recognition', '')), '') else cp.recognition end;
  v_channel := case when p_prefs ? 'channel' then nullif(btrim(coalesce(p_prefs->>'channel', '')), '') else cp.channel end;
  if v_thanks is not null and v_thanks not in ('in_person', 'call', 'card', 'message', 'none') then
    raise exception 'Choose how you would like to be thanked: in person, a call, a card, a message, or no thanks.' using errcode = '23514';
  end if;
  if v_recog is not null and v_recog not in ('public', 'private_only', 'anonymous') then
    raise exception 'Choose how you would like to be recognised: by name, privately, or anonymously.' using errcode = '23514';
  end if;
  if v_channel is not null and v_channel not in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post') then
    raise exception 'Choose how to reach you: in person, phone, text, email, WhatsApp or post.' using errcode = '23514';
  end if;
  perform app.set_audit_context('Member chose how to be thanked');
  insert into app.care_profiles (household_id, center_id, thanks, recognition, channel, updated_by)
  values (v_h, p_center, v_thanks, v_recog, v_channel, auth.uid())
  on conflict (household_id) do update
    set thanks = excluded.thanks, recognition = excluded.recognition, channel = excluded.channel, updated_by = auth.uid(), updated_at = now();
  return app.member_care_preferences(p_center);
end $$;

revoke execute on function app.care_member_settings_get(uuid), app.save_care_member_settings(uuid, boolean), app.member_care_preferences(uuid),
  app.save_member_care_preferences(uuid, jsonb) from public, anon;
grant execute on function app.care_member_settings_get(uuid), app.save_care_member_settings(uuid, boolean), app.member_care_preferences(uuid),
  app.save_member_care_preferences(uuid, jsonb) to authenticated, service_role;
