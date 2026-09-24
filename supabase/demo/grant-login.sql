-- supabase/demo/grant-login.sql — LOCAL DEMO ONLY.
-- Links a sign-in email to a demo person and grants roles, so you can use the
-- consoles and the member app as that person.
--
-- 1. Create the login first: Supabase Studio (http://127.0.0.1:54323) ›
--    Authentication › Add user › your email (or sign in once in the mobile app).
-- 2. Run:
--    psql postgresql://postgres:postgres@127.0.0.1:54322/postgres \
--      -v email="you@example.com" -v member="JSH-90009" -v roles="center_admin,treasurer,executive_committee,pathshala_principal,communications_officer,religious_coordinator,store_lead" \
--      -f supabase/demo/grant-login.sql
--
--    member = JSH-90009 Demo Admin (staff) · JSH-90001 Priya Shah (member app as a parent)
--             JSH-90010 Tejal Teacher (use roles="teacher" for the teacher view of Jainism 3)
\set ON_ERROR_STOP 1
begin;
select set_config('demo.email', :'email', true), set_config('demo.member', :'member', true), set_config('demo.roles', :'roles', true);

do $$
declare c uuid := '00000000-0000-4000-8000-000000000001';
  v_user uuid; v_person uuid; r text; v_scope uuid;
  v_email text := current_setting('demo.email'); v_member text := current_setting('demo.member');
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'No login for %. Create it first in Studio › Authentication › Add user.', v_email;
  end if;
  select id into v_person from app.people where center_id = c and member_number = v_member;
  if v_person is null then raise exception 'No demo person %. Load supabase/demo/demo.sql first.', v_member; end if;

  update app.people set email = v_email where id = v_person;
  insert into app.accounts (user_id) values (v_user) on conflict do nothing;
  delete from app.center_users where center_id = c and (user_id = v_user or person_id = v_person);
  insert into app.center_users (center_id, user_id, person_id) values (c, v_user, v_person);

  foreach r in array string_to_array(nullif(current_setting('demo.roles'), ''), ',') loop
    r := trim(r);
    continue when r = '';
    -- teacher: scoped to Jainism 3; check-in / event lead: scoped to the Tapasvi Bahuman
    v_scope := case r when 'teacher' then 'd0000000-0000-4000-8000-000000000302'::uuid
                      when 'checkin_volunteer' then 'd0000000-0000-4000-8000-000000000401'::uuid
                      when 'event_lead' then 'd0000000-0000-4000-8000-000000000401'::uuid
                      when 'boli_recorder' then 'd0000000-0000-4000-8000-000000000401'::uuid end;
    insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id, reason)
    values (c, v_user, r,
            (case when r = 'teacher' then 'class' when r in ('checkin_volunteer','event_lead','boli_recorder') then 'event' else 'center' end)::app.scope_kind,
            v_scope, 'local demo');
  end loop;
  raise notice 'Linked % to % with roles: %', v_email, v_member, coalesce(nullif(current_setting('demo.roles'), ''), '(none — member only)');
end $$;
commit;
