-- 0491: relationship options — a per-center picklist for "Add a family member" /
-- "Relationship" (was free text). Seeded automatically on every new center with
-- a typical set; a settings.manage admin may add or remove (real delete, no FK
-- references it); any member of the center can read the list.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c '''39000000-0000-4000-8000-0000000000c1'''
\set admin '''39000000-0000-4000-8000-000000000001'''
\set member '''39000000-0000-4000-8000-000000000002'''
\set outsider '''39000000-0000-4000-8000-000000000003'''
insert into auth.users (id, email) values
  (:admin, 'admin39@example.com'), (:member, 'member39@example.com'), (:outsider, 'outsider39@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:c, 'orbit39', 'Orbit Test Community', 'OTC', 'TX', 'active', 'production');
insert into app.role_grants (center_id, user_id, role_key) values (:c, :admin, 'center_admin');
insert into app.households (id, center_id, display_name) values ('39000000-0000-4000-8000-0000000000a1', :c, 'Test household');
insert into app.people (id, center_id, first_name, last_name) values ('39000000-0000-4000-8000-0000000000a2', :c, 'Mem', 'Ber');
insert into app.household_members (household_id, person_id, center_id, role) values
  ('39000000-0000-4000-8000-0000000000a1', '39000000-0000-4000-8000-0000000000a2', :c, 'primary');
insert into app.center_users (center_id, user_id, person_id) values (:c, :member, '39000000-0000-4000-8000-0000000000a2');

select pg_temp.assert((select count(*) from app.relationship_options where center_id = :c) = 9,
  'a new center is seeded with the typical set (9 options)');
select pg_temp.assert((select bool_and(name is not null) from app.relationship_options where center_id = :c),
  'every seeded option has a name');

-- ── Member reads, cannot write ───────────────────────────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert((select count(*) from app.relationship_options where center_id = :c) = 9, 'a member reads the list');
select pg_temp.assert((select count(*) from (select * from app.relationship_options(:c::uuid)) r) = 9,
  'the app.relationship_options(center) function returns the same list');
select pg_temp.assert_raises(format($$insert into app.relationship_options (center_id, name) values (%L, 'Cousin')$$, :c),
  'row-level security', 'a member cannot add an option');
commit;

-- ── Someone from another center reads nothing ────────────────────────────────
begin;
select pg_temp.sign_in(:outsider);
select pg_temp.assert((select count(*) from app.relationship_options where center_id = :c) = 0,
  'someone who is not a member of the center reads nothing');
commit;

-- ── Admin adds and removes (add/remove only) ─────────────────────────────────
begin;
select pg_temp.sign_in(:admin);
insert into app.relationship_options (center_id, name, sort) values (:c, 'Cousin', 10);
select pg_temp.assert((select count(*) from app.relationship_options where center_id = :c and name = 'Cousin') = 1,
  'an admin adds a new option');
select pg_temp.assert_raises(format($$insert into app.relationship_options (center_id, name) values (%L, 'Spouse')$$, :c),
  'duplicate key', 'the same name cannot be added twice');
delete from app.relationship_options where center_id = :c and name = 'Cousin';
select pg_temp.assert((select count(*) from app.relationship_options where center_id = :c and name = 'Cousin') = 0,
  'an admin removes an option (a real delete — nothing references it)');
commit;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'relationship_options' and action like 'relationship_options.%') >= 2,
  'the additions and removal are audited');
