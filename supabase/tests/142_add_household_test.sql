-- 0721: app.family_name_key, app.household_possible_matches and app.add_household (People redesign slice 6, "Add a family").
--   A. Who may ask: people.manage in THAT community only (nobody signed in, no role, and an administrator of another community are refused)
--   B. The possible matches: mobile, email (also an extra email), name (accents, case, spacing, other scripts), last name only; strongest
--      first; at most 8 with the full count; never a merged household, never another community's family
--   C. Nothing is created until the caller says "none of these"; the answer carries the households and reasons, never a name
--   D. A new family: a household (number issued), its first adult as the primary member, no child, no membership, audited with a reason
--   E. Refusals in plain words; the functions are security definer with the extensions search path, closed to anon
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.sign_out() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create or replace function pg_temp.keep(p_name text, p_j jsonb) returns void language plpgsql as $$
begin perform set_config('t142.' || p_name, p_j::text, true); end $$;
create or replace function pg_temp.got(p_name text) returns jsonb language sql stable as $$ select current_setting('t142.' || p_name)::jsonb $$;

\set ca '''14200000-0000-4000-8000-0000000000c1'''
\set cb '''14200000-0000-4000-8000-0000000000c2'''
\set u_admin '''14200000-0000-4000-8000-0000000000a1'''
\set u_none '''14200000-0000-4000-8000-0000000000a2'''
\set u_other '''14200000-0000-4000-8000-0000000000a3'''
\set h1 '''14200000-0000-4000-8000-0000000000e1'''
\set h2 '''14200000-0000-4000-8000-0000000000e2'''
\set h3 '''14200000-0000-4000-8000-0000000000e3'''
\set h4 '''14200000-0000-4000-8000-0000000000e4'''
\set h5 '''14200000-0000-4000-8000-0000000000e5'''
\set hb '''14200000-0000-4000-8000-0000000000e6'''
\set p1 '''14200000-0000-4000-8000-0000000000d1'''
\set p2 '''14200000-0000-4000-8000-0000000000d2'''
\set p3 '''14200000-0000-4000-8000-0000000000d3'''
\set p4 '''14200000-0000-4000-8000-0000000000d4'''
\set p5 '''14200000-0000-4000-8000-0000000000d5'''
\set p6 '''14200000-0000-4000-8000-0000000000d6'''
\set p7 '''14200000-0000-4000-8000-0000000000d7'''
\set pb '''14200000-0000-4000-8000-0000000000d8'''

-- ── Fixtures: a neighbourhood association and a second community ──────────────────
insert into auth.users (id, email) values (:u_admin, 'admin142@example.com'), (:u_none, 'none142@example.com'), (:u_other, 'other142@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:ca, 'riv142', 'Riverside Neighbourhood Association', 'RIV', 'TX', 'active', 'America/Chicago'),
  (:cb, 'oth142', 'Other Club 142', 'OC1', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:ca, :u_admin, 'center_admin', 'center'), (:cb, :u_other, 'center_admin', 'center');

insert into app.households (id, center_id, display_name) values
  (:h1, :ca, 'Keep142, Anika'), (:h2, :ca, '李, 明'), (:h3, :ca, 'الحسن, ليلى'), (:h4, :ca, 'Garcia142, José'), (:h5, :ca, 'Old, Keep142'), (:hb, :cb, 'Keep142, Bea');
update app.households set merged_into_id = :h1 where id = :h5;
insert into app.people (id, center_id, first_name, last_name, email, phone_e164, date_of_birth) values
  (:p1, :ca, 'Anika', 'Keep142', 'Anika142@Example.org', '+15125550142', '1980-01-01'),
  (:p2, :ca, 'Ravi', 'Keep142', null, null, '1979-01-01'),
  (:p3, :ca, 'Zoya', 'Keep142', null, null, (current_date - interval '9 years')::date),
  (:p4, :ca, '明', '李', null, null, '1975-04-04'),
  (:p5, :ca, 'ليلى', 'الحسن', null, null, '1978-09-09'),
  (:p6, :ca, 'José', 'Garcia142', null, null, '1970-02-02'),
  (:p7, :ca, 'Old', 'Keep142', null, '+15125550142', '1950-01-01'),
  (:pb, :cb, 'Bea', 'Keep142', null, '+15125550142', '1985-05-05');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p1, :ca, 'primary', true), (:h1, :p2, :ca, 'spouse', false), (:h1, :p3, :ca, 'child', false),
  (:h2, :p4, :ca, 'primary', true), (:h3, :p5, :ca, 'primary', true), (:h4, :p6, :ca, 'primary', true),
  (:h5, :p7, :ca, 'primary', true), (:hb, :pb, :cb, 'primary', true);
insert into app.person_emails (center_id, person_id, email) values (:ca, :p6, 'jose.alt142@example.org');
-- Ten families that share one last name.
do $$
declare i int; v_h uuid; v_p uuid;
begin
  for i in 1..10 loop
    insert into app.households (center_id, display_name) values ('14200000-0000-4000-8000-0000000000c1', 'Crowd142, N' || i) returning id into v_h;
    insert into app.people (center_id, first_name, last_name, date_of_birth) values ('14200000-0000-4000-8000-0000000000c1', 'N' || i, 'Crowd142', '1980-01-01') returning id into v_p;
    insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (v_h, v_p, '14200000-0000-4000-8000-0000000000c1', 'primary', true);
  end loop;
end $$;
select count(*) as n_hh_before from app.households where center_id = :ca \gset
select count(*) as n_people_before from app.people where center_id = :ca \gset

-- ── E (first). The name key ──────────────────────────────────────────────────────────
select pg_temp.assert(app.family_name_key('  José   GARCÍA ') = 'jose garcia' and app.family_name_key('JOSE garcia') = 'jose garcia',
                      'E · the name key ignores case, accents and spacing');
select pg_temp.assert(app.family_name_key('李') = '李' and app.family_name_key('الحسن') = 'الحسن' and app.family_name_key('   ') is null and app.family_name_key(null) is null,
                      'E · the name key keeps other scripts as they are, and an empty name is nothing');

-- ── A. Who may ask ─────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_none);
select pg_temp.assert_raises($q$select app.add_household('14200000-0000-4000-8000-0000000000c1', 'Nia', 'Okafor142')$q$, 'needs the people.manage permission', 'A · a person with no role cannot add a family');
select pg_temp.assert_raises($q$select app.household_possible_matches('14200000-0000-4000-8000-0000000000c1', 'Nia', 'Okafor142')$q$, 'needs the people.manage permission', 'A · a person with no role cannot look for matches');
select pg_temp.sign_in(:u_other);
select pg_temp.assert_raises($q$select app.add_household('14200000-0000-4000-8000-0000000000c1', 'Nia', 'Okafor142')$q$, 'needs the people.manage permission', 'A · an administrator of another community cannot add a family here');
select pg_temp.assert_raises($q$select app.household_possible_matches('14200000-0000-4000-8000-0000000000c1', 'Anika', 'Keep142', '+15125550142')$q$, 'needs the people.manage permission', 'A · nor look at the families here');
select pg_temp.sign_out();
select pg_temp.assert_raises($q$select app.add_household('14200000-0000-4000-8000-0000000000c1', 'Nia', 'Okafor142')$q$, 'needs the people.manage permission', 'A · nobody signed in: refused');

-- ── B. The possible matches ────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_admin);
select pg_temp.keep('mobile', app.household_possible_matches(:ca, 'Someone', 'Else142', '+15125550142'));
select pg_temp.assert(jsonb_array_length(pg_temp.got('mobile')->'matches') = 1 and pg_temp.got('mobile')->'matches'->0->>'household_id' = :h1
                      and pg_temp.got('mobile')->'matches'->0->'reasons' = '["mobile"]'::jsonb and (pg_temp.got('mobile')->>'total')::int = 1,
                      'B · the same mobile finds the family, and not the merged household or the other community''s family with the same number');
select pg_temp.keep('email', app.household_possible_matches(:ca, 'Someone', 'Else142', null, 'ANIKA142@example.org'));
select pg_temp.assert(pg_temp.got('email')->'matches'->0->>'household_id' = :h1 and pg_temp.got('email')->'matches'->0->'reasons' = '["email"]'::jsonb,
                      'B · the same email finds the family, whatever the case');
select pg_temp.keep('email2', app.household_possible_matches(:ca, 'Someone', 'Else142', null, 'jose.alt142@example.org'));
select pg_temp.assert(pg_temp.got('email2')->'matches'->0->>'household_id' = :h4 and pg_temp.got('email2')->'matches'->0->'reasons' = '["email"]'::jsonb,
                      'B · an extra email of a person counts too');
select pg_temp.keep('name', app.household_possible_matches(:ca, 'Anika', '  keep142 '));
select pg_temp.assert(jsonb_array_length(pg_temp.got('name')->'matches') = 1 and pg_temp.got('name')->'matches'->0->>'household_id' = :h1 and pg_temp.got('name')->'matches'->0->'reasons' = '["name"]'::jsonb,
                      'B · the same first and last name finds the family, ignoring case and spacing');
select pg_temp.keep('last', app.household_possible_matches(:ca, 'Zed', 'Keep142'));
select pg_temp.assert(jsonb_array_length(pg_temp.got('last')->'matches') = 1 and pg_temp.got('last')->'matches'->0->>'household_id' = :h1 and pg_temp.got('last')->'matches'->0->'reasons' = '["last_name"]'::jsonb,
                      'B · the same last name alone is a weaker match');
select pg_temp.keep('all', app.household_possible_matches(:ca, 'Anika', 'Keep142', '+15125550142', 'anika142@example.org'));
select pg_temp.assert(pg_temp.got('all')->'matches'->0->'reasons' = '["mobile","email","name"]'::jsonb and (pg_temp.got('all')->'matches'->0->>'strength')::int >= 11,
                      'B · mobile, email and name together are the strongest');
select pg_temp.keep('accent', app.household_possible_matches(:ca, 'Jose', 'GARCIA142'));
select pg_temp.assert(pg_temp.got('accent')->'matches'->0->>'household_id' = :h4 and pg_temp.got('accent')->'matches'->0->'reasons' = '["name"]'::jsonb,
                      'B · José Garcia is found as Jose GARCIA');
select pg_temp.keep('han', app.household_possible_matches(:ca, '明', '李'));
select pg_temp.keep('arabic', app.household_possible_matches(:ca, 'ليلى', 'الحسن'));
select pg_temp.assert(pg_temp.got('han')->'matches'->0->>'household_id' = :h2 and pg_temp.got('han')->'matches'->0->'reasons' = '["name"]'::jsonb
                      and pg_temp.got('arabic')->'matches'->0->>'household_id' = :h3 and pg_temp.got('arabic')->'matches'->0->'reasons' = '["name"]'::jsonb,
                      'B · names in Chinese and Arabic are found');
select pg_temp.keep('crowd', app.household_possible_matches(:ca, 'Zed', 'Crowd142'));
select pg_temp.assert(jsonb_array_length(pg_temp.got('crowd')->'matches') = 8 and (pg_temp.got('crowd')->>'total')::int = 10,
                      'B · at most 8 are returned, with the full count');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(pg_temp.got('mobile')->'matches') m where m->>'household_id' in (:h5, :hb))
                      and (select count(*) from (select distinct m->>'household_id' from jsonb_array_elements(pg_temp.got('crowd')->'matches') m) d) = 8,
                      'B · each family appears once');
select pg_temp.assert(pg_temp.got('mobile')::text !~* '(Anika|Ravi|Zoya|Keep142)', 'B · the answer holds ids and reasons, never a name');
select pg_temp.assert(jsonb_array_length(app.household_possible_matches(:ca, 'Nobody', 'Unmatched142', '+15125550888', 'nobody142@example.org')->'matches') = 0
                      and jsonb_array_length(app.household_possible_matches(:ca, '', '', null, null)->'matches') = 0,
                      'B · nothing alike, nothing to match');
select pg_temp.sign_in(:u_other);
select pg_temp.keep('other', app.household_possible_matches(:cb, 'Someone', 'Else142', '+15125550142'));
select pg_temp.assert(jsonb_array_length(pg_temp.got('other')->'matches') = 1 and pg_temp.got('other')->'matches'->0->>'household_id' = :hb,
                      'B · the other community sees only its own family');

-- ── C. Nothing is created until the caller says "none of these" ──────────────────────
select pg_temp.sign_in(:u_admin);
select pg_temp.keep('held', app.add_household(:ca, 'Someone', 'Else142', '+15125550142', null, '1 Elm St'));
select pg_temp.assert(not (pg_temp.got('held')->>'created')::boolean and pg_temp.got('held')->'matches'->0->>'household_id' = :h1 and (pg_temp.got('held')->>'total')::int = 1,
                      'C · with a match, nothing is created and the match comes back');
select pg_temp.sign_out();
select pg_temp.assert((select count(*) from app.households where center_id = :ca) = :n_hh_before and (select count(*) from app.people where center_id = :ca) = :n_people_before,
                      'C · no household and no person was created');

-- ── D. A new family ──────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_admin);
select pg_temp.keep('new', app.add_household(:ca, '  Nia ', 'Okafor142', '+15125550999', 'Nia142@Example.org', ' 12 River Road '));
select pg_temp.assert((pg_temp.got('new')->>'created')::boolean and pg_temp.got('new')->>'household_number' is not null and pg_temp.got('new')->>'household_id' is not null and pg_temp.got('new')->>'person_id' is not null,
                      'D · with no match the family is added and its number comes back');
select pg_temp.keep('none', app.add_household(:ca, 'Anika', 'Keep142', '+15125550142', null, null, true));
select pg_temp.assert((pg_temp.got('none')->>'created')::boolean and pg_temp.got('none')->>'household_number' <> pg_temp.got('new')->>'household_number',
                      'D · "none of these" adds the family anyway, with its own number');
select pg_temp.sign_out();
select pg_temp.assert((select h.center_id = :ca and h.display_name = 'Okafor142, Nia' and h.address_line1 = '12 River Road' and h.merged_into_id is null and h.household_number is not null
                         from app.households h where h.id = (pg_temp.got('new')->>'household_id')::uuid),
                      'D · the household belongs to this community, with a name, a street and a number');
select pg_temp.assert((select p.center_id = :ca and p.first_name = 'Nia' and p.last_name = 'Okafor142' and p.email = 'nia142@example.org' and p.phone_e164 = '+15125550999' and p.date_of_birth is null
                         from app.people p where p.id = (pg_temp.got('new')->>'person_id')::uuid),
                      'D · the first adult has the name, the email in lower case and the mobile');
select pg_temp.assert((select count(*) = 1 and bool_and(m.role = 'primary' and m.is_primary and m.left_at is null and m.joined_at is not null and m.center_id = :ca)
                         from app.household_members m where m.household_id = (pg_temp.got('new')->>'household_id')::uuid and m.person_id = (pg_temp.got('new')->>'person_id')::uuid),
                      'D · they are the primary member, and the only one');
select pg_temp.assert((select count(*) from app.household_members where household_id in ((pg_temp.got('new')->>'household_id')::uuid, (pg_temp.got('none')->>'household_id')::uuid)) = 2
                      and (select count(*) from app.memberships where household_id in ((pg_temp.got('new')->>'household_id')::uuid, (pg_temp.got('none')->>'household_id')::uuid)) = 0,
                      'D · no child is created and no membership either');
select pg_temp.assert((select count(*) from app.households where center_id = :ca) = :n_hh_before + 2 and (select count(*) from app.people where center_id = :ca) = :n_people_before + 2,
                      'D · one household and one person per family');
select pg_temp.assert(exists (select 1 from app.audit_log a where a.record_table = 'households' and a.record_id = pg_temp.got('new')->>'household_id' and a.reason = 'Added a family')
                      and exists (select 1 from app.audit_log a where a.record_table = 'people' and a.record_id = pg_temp.got('new')->>'person_id' and a.reason = 'Added a family'),
                      'D · the new rows are in the audit log, with the reason "Added a family"');

-- ── E. Refusals, in words ────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_admin);
select pg_temp.assert_raises($q$select app.add_household('14200000-0000-4000-8000-0000000000c1', '  ', 'Okafor142')$q$, 'A first and last name are required', 'E · a name is required');
select pg_temp.assert_raises($q$select app.add_household('14200000-0000-4000-8000-0000000000c1', 'Nia', 'Okafor142', '5125550101')$q$, 'country code', 'E · a mobile number needs its country code');
select pg_temp.assert_raises($q$select app.add_household('14200000-0000-4000-8000-0000000000c1', 'Nia', 'Okafor142', null, 'not-an-email')$q$, 'does not look right', 'E · an email must look like one');
select pg_temp.assert_raises($q$select app.add_household('14200000-0000-4000-8000-0000000000c1', repeat('x', 201), 'Okafor142')$q$, 'too long', 'E · a name has a limit');
select pg_temp.sign_out();
select pg_temp.assert((select count(*) from app.households where center_id = :ca) = :n_hh_before + 2, 'E · a refused call creates nothing');
select pg_temp.assert((select count(*) = 2 and bool_and(p.prosecdef) and bool_and(p.proconfig::text like '%search_path=app, public, extensions%')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('household_possible_matches', 'add_household')),
                      'E · the two functions that read other families are security definer and pin the search path with extensions');
select pg_temp.assert(not has_function_privilege('anon', 'app.add_household(uuid, text, text, text, text, text, boolean)', 'execute')
                      and not has_function_privilege('anon', 'app.household_possible_matches(uuid, text, text, text, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.add_household(uuid, text, text, text, text, text, boolean)', 'execute'),
                      'E · closed to anon, open to signed-in people (who are then checked inside)');
select pg_temp.assert(exists (select 1 from app.activity_catalog c where c.key = 'assistant.people_add_household' and c.commandable_key = 'people.add_household' and c.surface = 'portal')
                      and exists (select 1 from app.activity_catalog c where c.key = 'people.add_household' and c.surface = 'portal'),
                      'E · the command and the screen button are in the activity allowlist');

rollback;
\echo 'PASS: add household tests'
