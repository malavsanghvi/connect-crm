-- 0722 (People redesign, slice 8): a person's own saved People views and pinned families, app.people_saved.
--   A. The table, its privileges, its place in the module list and the activity allowlist, and that it is not row-audited
--   B. A person reads and writes their own rows (a view, a pin), in order
--   C. Nobody else reads or changes them: another person in the same community, an audit reader, a platform admin, anon,
--      the service key; nobody writes as someone else, in another community, or without access to the People area
--   D. A pin points at a family the writer can see in that community, once per family
--   E. Shapes and limits: the name (length counted in characters, one line, one per name), the list, the filters, the caps
--   F. A person whose role ended can still clear their own rows; a deleted family takes its pins with it
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
-- Runs a statement that must fail with a message containing `expect`.
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
-- Sign in as a user (claims and role) for the statements that follow; as_none() signs out again.
create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;

\set a143 '''14300000-0000-4000-8000-0000000000a1'''
\set b143 '''14300000-0000-4000-8000-0000000000b1'''
\set sam143 '''14300000-0000-4000-8000-000000000001'''
\set bea143 '''14300000-0000-4000-8000-000000000002'''
\set tara143 '''14300000-0000-4000-8000-000000000003'''
\set mia143 '''14300000-0000-4000-8000-000000000004'''
\set vic143 '''14300000-0000-4000-8000-000000000005'''
\set pat143 '''14300000-0000-4000-8000-000000000006'''
\set bo143 '''14300000-0000-4000-8000-000000000007'''
\set cap143 '''14300000-0000-4000-8000-000000000008'''
\set ha1 '''14300000-0000-4000-8000-0000000002a1'''
\set ha2 '''14300000-0000-4000-8000-0000000002a2'''
\set hb1 '''14300000-0000-4000-8000-0000000002b1'''

select pg_temp.as_none();
insert into auth.users (id, email) values
  (:sam143, 'sam143@views.test'), (:bea143, 'bea143@views.test'), (:tara143, 'tara143@views.test'), (:mia143, 'mia143@views.test'),
  (:vic143, 'vic143@views.test'), (:pat143, 'pat143@views.test'), (:bo143, 'bo143@views.test'), (:cap143, 'cap143@views.test');
insert into app.accounts (user_id, is_platform_admin) values (:pat143, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;

-- Two communities: A is a neighbourhood association with people from several cultures; B is somewhere else.
insert into app.centers (id, slug, name, short_name, state_region, status, rules) values
  (:a143, 'views143a', 'Riverside Neighbours 143', 'RN143', 'TX', 'active', '{}'::jsonb),
  (:b143, 'views143b', 'Harbour Club 143', 'HC143', 'CA', 'active', '{}'::jsonb);
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  ('14300000-0000-4000-8000-000000000101', :a143, 'Sam', 'Okafor', date '1975-03-01'),
  ('14300000-0000-4000-8000-000000000102', :a143, 'Beatriz', 'Fernández', date '1980-04-02'),
  ('14300000-0000-4000-8000-000000000103', :a143, 'Tara', 'Nakamura', date '1982-05-03'),
  ('14300000-0000-4000-8000-000000000104', :a143, 'Mia', 'Haddad', date '1990-06-04'),
  ('14300000-0000-4000-8000-000000000105', :a143, 'Víctor', 'Ivanov', date '1985-07-05'),
  ('14300000-0000-4000-8000-000000000106', :a143, 'Pat', 'Platform', date '1979-08-06'),
  ('14300000-0000-4000-8000-000000000107', :b143, 'Bo', 'Brandt', date '1988-09-07'),
  ('14300000-0000-4000-8000-000000000108', :a143, 'Capucine', 'Dubois', date '1983-10-08');
insert into app.center_users (center_id, user_id, person_id) values
  (:a143, :sam143, '14300000-0000-4000-8000-000000000101'), (:a143, :bea143, '14300000-0000-4000-8000-000000000102'),
  (:a143, :tara143, '14300000-0000-4000-8000-000000000103'), (:a143, :mia143, '14300000-0000-4000-8000-000000000104'),
  (:a143, :vic143, '14300000-0000-4000-8000-000000000105'), (:a143, :pat143, '14300000-0000-4000-8000-000000000106'),
  (:b143, :bo143, '14300000-0000-4000-8000-000000000107'), (:a143, :cap143, '14300000-0000-4000-8000-000000000108');
-- Sam and Beatriz are membership coordinators (people.view and people.manage), Tara is a treasurer (people.view and audit.view),
-- Mia has no role at all (a member), Víctor is a board viewer (no people access), Bo coordinates community B, Capucine coordinates A.
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:a143, :sam143, 'membership_coordinator', 'center', 'test 143'), (:a143, :bea143, 'membership_coordinator', 'center', 'test 143'),
  (:a143, :tara143, 'treasurer', 'center', 'test 143'), (:a143, :vic143, 'executive_viewer', 'center', 'test 143'),
  (:b143, :bo143, 'membership_coordinator', 'center', 'test 143'), (:a143, :cap143, 'membership_coordinator', 'center', 'test 143');
insert into app.households (id, center_id, display_name) values
  (:ha1, :a143, 'Okafor household'), (:ha2, :a143, 'Fernández household'), (:hb1, :b143, 'Brandt household');
-- Forty more families in A, so one person can reach the pin cap.
insert into app.households (id, center_id, display_name)
  select ('14300000-0000-4000-8000-0000000003' || lpad(to_hex(g), 2, '0'))::uuid, :a143, 'Cap family ' || g from generate_series(1, 41) g;

-- ══ A. The table, its privileges, its place in the module list and the allowlist ═══════════════════════════════════════════
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.people_saved'::regclass),
  'A · app.people_saved has row level security on');
select pg_temp.assert(has_table_privilege('authenticated', 'app.people_saved', 'select') and has_table_privilege('authenticated', 'app.people_saved', 'insert')
                      and has_table_privilege('authenticated', 'app.people_saved', 'update') and has_table_privilege('authenticated', 'app.people_saved', 'delete'),
  'A · signed-in people can select, insert, update and delete (the policies narrow it to their own rows)');
select pg_temp.assert(not has_table_privilege('anon', 'app.people_saved', 'select') and not has_table_privilege('anon', 'app.people_saved', 'insert')
                      and not has_table_privilege('service_role', 'app.people_saved', 'select') and not has_table_privilege('service_role', 'app.people_saved', 'insert')
                      and not has_table_privilege('service_role', 'app.people_saved', 'update') and not has_table_privilege('service_role', 'app.people_saved', 'delete')
                      and not has_table_privilege('connect_worker', 'app.people_saved', 'select'),
  'A · the public key, the service key and the worker have no privilege on it at all');
select pg_temp.assert((select module_key from app.module_tables where table_name = 'people_saved') = 'people',
  'A · it belongs to the People module (core) in the module list');
select pg_temp.assert(not exists (select 1 from pg_trigger t where t.tgrelid = 'app.people_saved'::regclass and t.tgname = 'audit_people_saved'),
  'A · it is not row-audited (one person''s list names and pins are not for audit readers)');
select pg_temp.assert((select count(*) = 6 and bool_and(c.kind = 'action' and c.surface = 'portal' and c.label !~ '[._]') from app.activity_catalog c
                        where c.key in ('people.save_view', 'people.rename_view', 'people.delete_view', 'people.pin_family', 'people.unpin_family', 'people.export_list')),
  'A · the six actions are portal actions in the activity allowlist, with plain labels');
select pg_temp.assert((select count(*) = 2 from app.activity_catalog c where c.key in ('people.pin_family', 'people.unpin_family') and c.entity_kind = 'household'),
  'A · pinning and unpinning are about a household');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.people_saved_limits()', 'execute') and not has_function_privilege('service_role', 'app.people_saved_limits()', 'execute'),
  'A · the limits trigger function is not callable by anyone but the database');

-- ══ B. A person reads and writes their own rows ═══════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:sam143);
insert into app.people_saved (center_id, user_id, kind, name, list_view, params, sort, position)
  values (:a143, :sam143, 'view', 'Adults with no email', 'people', '{"noemail": "1", "band": "adults"}', null, 0);
insert into app.people_saved (center_id, user_id, kind, name, list_view, params, sort, position)
  values (:a143, :sam143, 'view', 'Ending soon, by area', 'households', '{"ending": "60"}', 'area', 1);
insert into app.people_saved (center_id, user_id, kind, household_id, position) values (:a143, :sam143, 'pin', :ha1, 0);
insert into app.people_saved (center_id, user_id, kind, household_id, position) values (:a143, :sam143, 'pin', :ha2, 1);
select pg_temp.assert((select count(*) = 4 from app.people_saved), 'B · Sam sees the four rows he made');
select pg_temp.assert((select array_agg(name order by position) from app.people_saved where kind = 'view') = array['Adults with no email', 'Ending soon, by area']
                      and (select params ->> 'noemail' from app.people_saved where name = 'Adults with no email') = '1'
                      and (select sort from app.people_saved where name = 'Ending soon, by area') = 'area',
  'B · a view keeps its name, its list, its filters and its sort, and its position orders it');
update app.people_saved set name = 'Adults with no email address' where name = 'Adults with no email';
select pg_temp.assert((select count(*) = 1 from app.people_saved where name = 'Adults with no email address'), 'B · Sam renames a view');
update app.people_saved set position = 5 where kind = 'pin' and household_id = :ha1;
select pg_temp.assert((select position = 5 from app.people_saved where kind = 'pin' and household_id = :ha1), 'B · Sam reorders a pin');
select pg_temp.assert((select updated_at >= created_at from app.people_saved where name = 'Adults with no email address'), 'B · updated_at is kept');
delete from app.people_saved where kind = 'pin' and household_id = :ha2;
select pg_temp.assert((select count(*) = 3 from app.people_saved), 'B · Sam unpins a family');
select pg_temp.as_none();

-- ══ C. Nobody else reads or changes them ═══════════════════════════════════════════════════════════════════════════════════════
-- Another person in the same community, with the same role.
select pg_temp.as_user(:bea143);
select pg_temp.assert((select count(*) = 0 from app.people_saved), 'C · Beatriz, a coordinator in the same community, sees none of Sam''s rows');
update app.people_saved set name = 'Hijacked' where true;
delete from app.people_saved where true;
select pg_temp.as_none();
select pg_temp.assert((select count(*) = 3 and bool_and(name is distinct from 'Hijacked') filter (where kind = 'view') from app.people_saved),
  'C · Beatriz can neither rename nor delete Sam''s rows (they are not even visible to her statements)');
select pg_temp.as_user(:bea143);
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000001', 'view', 'As Sam', 'people', '{"noemail": "1"}')$$,
  'row-level security', 'C · Beatriz cannot write a row in Sam''s name');
select pg_temp.as_none();
-- An audit reader (Tara: treasurer, audit.view and people.view), a platform admin, a member with no role.
select pg_temp.as_user(:tara143);
select pg_temp.assert((select count(*) = 0 from app.people_saved), 'C · an audit reader sees none of Sam''s rows in the table');
select pg_temp.assert((select count(*) = 0 from app.audit_log where record_table = 'people_saved'), 'C · and none in the audit log (the table is not row-audited)');
select pg_temp.as_none();
select pg_temp.as_user(:pat143);
select pg_temp.assert((select count(*) = 0 from app.people_saved), 'C · a platform admin sees none of Sam''s rows either');
select pg_temp.as_none();
select pg_temp.as_user(:mia143);
select pg_temp.assert((select count(*) = 0 from app.people_saved), 'C · a member with no role sees none');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000004', 'view', 'Mine', 'people', '{"noemail": "1"}')$$,
  'row-level security', 'C · a member with no access to the People area cannot save a view');
select pg_temp.as_none();
select pg_temp.as_user(:vic143);
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, household_id) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000005', 'pin', '14300000-0000-4000-8000-0000000002a1')$$,
  'row-level security', 'C · a board viewer without people.view or people.manage cannot pin a family');
select pg_temp.as_none();
-- The public key and the service key.
select pg_temp.as_none();
set local role anon;
select pg_temp.assert_raises($$select count(*) from app.people_saved$$, 'permission denied', 'C · the public key cannot read the table');
reset role;
set local role service_role;
select pg_temp.assert_raises($$select count(*) from app.people_saved$$, 'permission denied', 'C · the service key cannot read the table');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000001', 'view', 'Service', 'people', '{}')$$,
  'permission denied', 'C · the service key cannot write the table');
reset role;
-- Another community: Sam works in A only; Bo in B sees nothing of A's, and Sam cannot write into B.
select pg_temp.as_user(:bo143);
select pg_temp.assert((select count(*) = 0 from app.people_saved), 'C · a coordinator of another community sees none');
select pg_temp.as_none();
select pg_temp.as_user(:sam143);
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000b1', '14300000-0000-4000-8000-000000000001', 'view', 'Elsewhere', 'people', '{"noemail": "1"}')$$,
  'row-level security', 'C · Sam cannot save a view into a community he is not in');
-- He cannot hand a row to someone else, or move it to another community.
select pg_temp.assert_raises($$update app.people_saved set user_id = '14300000-0000-4000-8000-000000000002' where name = 'Ending soon, by area'$$,
  'cannot be moved', 'C · Sam cannot give his row to Beatriz');
select pg_temp.assert_raises($$update app.people_saved set list_view = 'people', params = '{"noemail": "1"}', center_id = '14300000-0000-4000-8000-0000000000b1' where name = 'Ending soon, by area'$$,
  'cannot be moved', 'C · nor move it to another community');
select pg_temp.assert_raises($$update app.people_saved set kind = 'pin' where name = 'Ending soon, by area'$$,
  'cannot be moved', 'C · a view cannot turn into a pin');

-- ══ D. A pin points at a family the writer can see, once ═════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, household_id) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000001', 'pin', '14300000-0000-4000-8000-0000000002b1')$$,
  'row-level security', 'D · Sam cannot pin a family of another community (and cannot learn that it exists)');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, household_id) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000001', 'pin', '14300000-0000-4000-8000-0000000009ff')$$,
  'row-level security', 'D · a family id that does not exist is refused the same way');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, household_id) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000001', 'pin', '14300000-0000-4000-8000-0000000002a1')$$,
  'duplicate', 'D · a family is pinned once');
select pg_temp.as_none();

-- ══ E. Shapes and limits ═══════════════════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:cap143);
-- A name is counted in characters, not bytes: 60 Japanese characters are allowed, 61 are not.
insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', repeat('名', 60), 'people', '{"noemail": "1"}');
select pg_temp.assert((select char_length(name) = 60 from app.people_saved where kind = 'view'), 'E · a name of 60 characters in a non-Latin script is allowed');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', repeat('名', 61), 'people', '{"noemail": "1"}')$$,
  'check', 'E · 61 characters are too many');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', '   ', 'people', '{"noemail": "1"}')$$,
  'check', 'E · a blank name is refused');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', ' padded', 'people', '{"noemail": "1"}')$$,
  'check', 'E · a name is stored trimmed (the portal trims it first)');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', E'two\nlines', 'people', '{"noemail": "1"}')$$,
  'check', 'E · a name is one line');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', lower(repeat('名', 60)), 'people', '{"noemail": "1"}')$$,
  'duplicate', 'E · the same name is not saved twice');
insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'Seniors with no mobile', 'people', '{"nomobile": "1", "band": "seniors"}');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'SENIORS WITH NO MOBILE', 'people', '{"nomobile": "1"}')$$,
  'duplicate', 'E · names differ by more than case to be two views');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'Bad list', 'reviews', '{"noemail": "1"}')$$,
  'check', 'E · a view opens one of the two lists');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'Array params', 'people', '[1]')$$,
  'check', 'E · the filters are an object');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'Huge params', 'people', jsonb_build_object('q', repeat('x', 2500)))$$,
  'check', 'E · the filters are small');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params, household_id) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'With a family', 'people', '{"noemail": "1"}', '14300000-0000-4000-8000-0000000002a1')$$,
  'check', 'E · a view has no family');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, household_id) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'pin', 'Named pin', '14300000-0000-4000-8000-0000000002a1')$$,
  'check', 'E · a pin has no name');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'pin')$$,
  'check', 'E · a pin names a family');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params, sort) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'Bad sort', 'people', '{"noemail": "1"}', 'name; drop')$$,
  'check', 'E · a sort is a short word');
-- The cap on views: 30. One is the Japanese name and one is "Seniors with no mobile"; 28 more fit, the next does not.
insert into app.people_saved (center_id, user_id, kind, name, list_view, params)
  select '14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'View ' || g, 'households', '{"ending": "30"}' from generate_series(1, 28) g;
select pg_temp.assert((select count(*) = 30 from app.people_saved where kind = 'view'), 'E · a person can keep 30 views');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'One too many', 'people', '{"noemail": "1"}')$$,
  'up to 30 saved views', 'E · the 31st view is refused in plain words');
-- The cap on pins: 40.
insert into app.people_saved (center_id, user_id, kind, household_id, position)
  select '14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'pin', h.id, row_number() over (order by h.display_name)
    from app.households h where h.display_name like 'Cap family %' and h.center_id = '14300000-0000-4000-8000-0000000000a1' order by h.display_name limit 40;
select pg_temp.assert((select count(*) = 40 from app.people_saved where kind = 'pin'), 'E · a person can pin 40 families');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, household_id) select '14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'pin', h.id from app.households h where h.id not in (select household_id from app.people_saved where kind = 'pin') and h.display_name like 'Cap family %' limit 1$$,
  'up to 40 families', 'E · the 41st pin is refused in plain words');
-- The caps are per person: Sam, with his own few rows, is not held back by Capucine's.
select pg_temp.as_none();
select pg_temp.as_user(:sam143);
insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values (:a143, :sam143, 'view', 'Adults with no email address', 'people', '{"noemail": "1"}')
  on conflict do nothing;
select pg_temp.assert((select count(*) = 3 from app.people_saved), 'E · the cap and the names are per person: Capucine''s rows do not touch Sam''s');
insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values (:a143, :sam143, 'view', 'View 1', 'households', '{"ending": "30"}');
select pg_temp.assert((select count(*) = 4 from app.people_saved), 'E · two people can use the same view name');
select pg_temp.as_none();

-- ══ F. A role that ended, and a family that is gone ═══════════════════════════════════════════════════════════════════════════════
delete from app.role_grants where user_id = :cap143;
select pg_temp.as_user(:cap143);
select pg_temp.assert((select count(*) = 70 from app.people_saved), 'F · Capucine still sees her own rows after her role ended');
delete from app.people_saved where kind = 'view';
select pg_temp.assert((select count(*) = 40 and bool_and(kind = 'pin') from app.people_saved), 'F · she can still clear her own views');
select pg_temp.assert_raises($$insert into app.people_saved (center_id, user_id, kind, name, list_view, params) values ('14300000-0000-4000-8000-0000000000a1', '14300000-0000-4000-8000-000000000008', 'view', 'After the role', 'people', '{"noemail": "1"}')$$,
  'row-level security', 'F · but cannot add one once she has no access to the People area');
select pg_temp.as_none();
delete from app.households where id in (select household_id from app.people_saved where user_id = :cap143 limit 5);
select pg_temp.assert((select count(*) = 35 from app.people_saved where user_id = :cap143), 'F · deleting a family takes its pins with it');

rollback;
