-- 0561: address suggestions — ZIP / city / state combinations shared by at least two of the community's
-- households (never one household alone), plus the zones' ZIP codes; members of the community only.
\set ON_ERROR_STOP 1
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- One line per suggestion: "zip|city|state|households|zone or homes", in the order returned.
create or replace function pg_temp.lines(p_center uuid) returns text language sql as $$
  select string_agg(concat_ws('|', s.postal_code, coalesce(s.city, '-'), coalesce(s.state_region, '-'), s.households,
                              case when s.from_zone then 'zone' else 'homes' end), ', ')
    from app.address_suggestions(p_center) s
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c1 '''50000000-0000-4000-8000-0000000000c1'''
\set c2 '''50000000-0000-4000-8000-0000000000c2'''
\set member '''50000000-0000-4000-8000-000000000001'''
\set outsider '''50000000-0000-4000-8000-000000000002'''
\set staff '''50000000-0000-4000-8000-000000000003'''
\set p_member '''50000000-0000-4000-8000-0000000000a1'''
\set p_out '''50000000-0000-4000-8000-0000000000a2'''

insert into auth.users (id, email) values
  (:member, 'member50@example.com'), (:outsider, 'outsider50@example.com'), (:staff, 'staff50@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:c1, 'orbit50', 'Orbit 50 Community', 'O50', 'TX', 'active', 'production'),
  (:c2, 'orbit50b', 'Other 50 Community', 'O50B', 'NY', 'active', 'production');
insert into app.zones (center_id, name, zip_codes) values
  (:c1, 'North 50', array['77479', '77478-1234', ' 77479 ', 'bad']),
  (:c1, 'West 50', array['77494']),
  (:c2, 'Other 50', array['10001']);
insert into app.households (id, center_id, display_name, postal_code, city, state_region) values
  -- the member's own household, no address yet
  ('50000000-0000-4000-8000-000000000b00', :c1, 'Member household 50', null, null, null),
  -- the same place written three ways: one suggestion, two households
  ('50000000-0000-4000-8000-000000000b01', :c1, 'Shah household 50', '77479', 'sugar land ', 'tx'),
  ('50000000-0000-4000-8000-000000000b02', :c1, 'Mehta household 50', '77479-0001', 'Sugar  Land', ' TX'),
  -- one household only (its merged duplicate below must not make it two)
  ('50000000-0000-4000-8000-000000000b03', :c1, 'Doshi household 50', '77478', 'Sugar Land', 'TX'),
  -- three households
  ('50000000-0000-4000-8000-000000000b05', :c1, 'Patel household 50', '77494', 'KATY', 'tx'),
  ('50000000-0000-4000-8000-000000000b06', :c1, 'Jain household 50', '77494', ' Katy', 'Tx'),
  ('50000000-0000-4000-8000-000000000b07', :c1, 'Vora household 50', '77494 1234', 'katy', 'TX'),
  -- not a ZIP, a 4-digit ZIP, no city, no state: none of these count
  ('50000000-0000-4000-8000-000000000b08', :c1, 'Bad zip household 50a', 'abcde', 'Houston', 'TX'),
  ('50000000-0000-4000-8000-000000000b09', :c1, 'Bad zip household 50b', 'abcde', 'Houston', 'TX'),
  ('50000000-0000-4000-8000-000000000b10', :c1, 'Short zip household 50a', '7700', 'Houston', 'TX'),
  ('50000000-0000-4000-8000-000000000b11', :c1, 'Short zip household 50b', '7700', 'Houston', 'TX'),
  ('50000000-0000-4000-8000-000000000b12', :c1, 'No city household 50a', '77001', null, 'TX'),
  ('50000000-0000-4000-8000-000000000b13', :c1, 'No city household 50b', '77001', '  ', 'TX'),
  ('50000000-0000-4000-8000-000000000b14', :c1, 'No state household 50a', '77002', 'Houston', null),
  ('50000000-0000-4000-8000-000000000b15', :c1, 'No state household 50b', '77002', 'Houston', ''),
  -- another community
  ('50000000-0000-4000-8000-000000000b20', :c2, 'Other household 50a', '10001', 'New York', 'NY'),
  ('50000000-0000-4000-8000-000000000b21', :c2, 'Other household 50b', '10001', 'new york', 'ny');
insert into app.households (id, center_id, display_name, postal_code, city, state_region, merged_into_id) values
  ('50000000-0000-4000-8000-000000000b04', :c1, 'Doshi household 50 (duplicate)', '77478', 'Sugar Land', 'TX', '50000000-0000-4000-8000-000000000b03');
insert into app.people (id, center_id, first_name, last_name) values
  (:p_member, :c1, 'Asha', 'Shah'), (:p_out, :c2, 'Out', 'Sider');
insert into app.household_members (household_id, person_id, center_id, role) values
  ('50000000-0000-4000-8000-000000000b00', :p_member, :c1, 'primary'), ('50000000-0000-4000-8000-000000000b20', :p_out, :c2, 'primary');
insert into app.center_users (center_id, user_id, person_id) values (:c1, :member, :p_member), (:c2, :outsider, :p_out);
insert into app.role_grants (center_id, user_id, role_key) values (:c1, :staff, 'membership_coordinator');

-- ── Access ───────────────────────────────────────────────────────────────────
select pg_temp.assert(has_function_privilege('authenticated', 'app.address_suggestions(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.address_suggestions(uuid)', 'execute'),
  'signed-in users can ask; anonymous callers cannot');
select pg_temp.assert((select p.prosecdef and exists (select 1 from unnest(p.proconfig) as g(setting) where g.setting ~ '^search_path=app, *public, *extensions$')
                         and position('assert_module_enabled' in p.prosrc) = 0
                         from pg_proc p where p.oid = 'app.address_suggestions(uuid)'::regprocedure),
  'security definer with the hosted search path; core, so no module check');
select pg_temp.assert((select array_agg(a order by n) from unnest((select proargnames from pg_proc where oid = 'app.address_suggestions(uuid)'::regprocedure)) with ordinality as x(a, n))
                        = array['p_center', 'postal_code', 'city', 'state_region', 'households', 'from_zone'],
  'it returns postal_code, city, state_region, households and from_zone');

-- ── A member gets the community's suggestions ───────────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert(pg_temp.lines(:c1) = '77478|-|-|0|zone, 77479|-|-|0|zone, 77494|-|-|0|zone, 77479|Sugar Land|TX|2|homes, 77494|Katy|TX|3|homes',
  'zone ZIPs first, then each normalized ZIP / city / state at least two households share');
select pg_temp.assert(not exists (select 1 from app.address_suggestions(:c1) where not from_zone and postal_code = '77478'),
  'a combination only one household uses is never suggested, and a merged duplicate does not make it two');
select pg_temp.assert(not exists (select 1 from app.address_suggestions(:c1) where city = 'Houston' or postal_code in ('7700', '77001', '77002')),
  'a household counts only with a 5-digit ZIP (ZIP+4 allowed), a city and a state');
select pg_temp.assert(not exists (select 1 from app.address_suggestions(:c1) where postal_code = '10001' or state_region = 'NY'),
  'another community''s households and zones are not suggested');
select pg_temp.assert((select count(*) from app.address_suggestions(:c1) where from_zone and postal_code = '77479') = 1,
  'a zone ZIP written twice is suggested once, and one that is not a ZIP is dropped');
select pg_temp.assert_raises(format('select * from app.address_suggestions(%L)', :c2), 'Only members of this community',
  'a member cannot see another community''s suggestions');
commit;

begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert(pg_temp.lines(:c2) = '10001|-|-|0|zone, 10001|New York|NY|2|homes', 'each community sees its own');
select pg_temp.assert_raises(format('select * from app.address_suggestions(%L)', :c1), 'Only members of this community',
  'a member of another community gets nothing');
select pg_temp.assert_raises($$select * from app.address_suggestions('50000000-0000-4000-8000-0000000000ff')$$, 'community was not found',
  'an unknown community is refused');
commit;

begin;
select pg_temp.sign_in(:staff);
select pg_temp.assert_raises(format('select * from app.address_suggestions(%L)', :c1), 'Only members of this community',
  'staff who are not members of the community get nothing (they work from the households themselves)');
commit;

-- One more household on the single combination makes it a suggestion.
insert into app.households (center_id, display_name, postal_code, city, state_region)
  values (:c1, 'Second Doshi household 50', '77478-9999', 'sugar land', 'TX');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert((select households from app.address_suggestions(:c1) where not from_zone and postal_code = '77478' and city = 'Sugar Land' and state_region = 'TX') = 2,
  'once a second household uses it, the combination is suggested');
commit;
