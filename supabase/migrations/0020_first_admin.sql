-- 0020 — give a new community its first administrator.
-- Run once from the Supabase SQL editor (which runs as the database owner) after
-- that person has a login (signed in once, or added under Authentication › Users):
--   select app.bootstrap_first_admin('you@example.org', 'First', 'Last');
-- Refuses once the community has an active center_admin: from then on roles are
-- granted in the CRM under the two-person rule. Not callable from the apps.
create or replace function app.bootstrap_first_admin(
  p_email text, p_first text, p_last text,
  p_center_slug text default 'jsh',
  p_roles text[] default array['center_admin']
) returns text
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_user uuid; v_person uuid; v_household uuid; r text; v_number text;
begin
  select id into v_center from app.centers where slug = p_center_slug;
  if v_center is null then raise exception 'no community with slug %', p_center_slug; end if;
  if exists (select 1 from app.role_grants where center_id = v_center and role_key = 'center_admin' and status = 'active') then
    raise exception 'this community already has an administrator; grant roles in the CRM instead';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'no login for %: sign in once (or add the user under Authentication > Users) first', p_email;
  end if;

  select person_id into v_person from app.center_users where center_id = v_center and user_id = v_user;
  if v_person is null then
    insert into app.households (center_id, display_name)
      values (v_center, trim(p_first) || ' ' || trim(p_last) || ' household') returning id into v_household;
    insert into app.people (center_id, first_name, last_name, email)
      values (v_center, trim(p_first), trim(p_last), lower(trim(p_email))) returning id into v_person;
    insert into app.household_members (household_id, person_id, center_id, role, is_primary)
      values (v_household, v_person, v_center, 'primary', true);
    insert into app.accounts (user_id) values (v_user) on conflict do nothing;
    insert into app.center_users (center_id, user_id, person_id) values (v_center, v_user, v_person);
  end if;

  foreach r in array p_roles loop
    insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason)
      values (v_center, v_user, trim(r), 'center', 'first administrator (bootstrap)');
  end loop;
  select member_number into v_number from app.people where id = v_person;
  return format('%s %s (%s) is now %s', p_first, p_last, v_number, array_to_string(p_roles, ', '));
end $$;
revoke execute on function app.bootstrap_first_admin(text, text, text, text, text[]) from public, anon, authenticated;
