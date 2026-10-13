-- 0768: a Weaver team account accepting an invitation is never linked to a member's record.
--   A. An invitation with no person named, accepted by a platform-admin account whose email a member record also has: the
--      account gets a new record of its own; the member stays unlinked.
--   B. The same invitation accepted by anyone else still links them to the member found by email (unchanged).
--   C. An invitation that names a person (made before 0757 refused making one) is refused to a platform-admin account.
--   D. A platform-admin account already linked in the community keeps its link.
--   E. An owner invitation for a new sandbox accepted by a platform-admin account still makes the owner (no member to link).
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60)))::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- An invitation row as invite_staff writes it (rows A to E are written directly: C's could no longer be made through it).
create or replace function pg_temp.invite(p_id uuid, p_center uuid, p_email text, p_by uuid, p_token text, p_person uuid default null,
                                          p_owner boolean default false) returns void language sql as $$
  insert into app.staff_invitations (id, center_id, email, person_id, role_keys, invited_by, token_hash, expires_at, makes_owner)
  values (p_id, p_center, p_email, p_person, case when p_owner then array['center_admin'] else array['teacher'] end, p_by,
          app.invitation_token_hash(p_token), now() + interval '7 days', p_owner)
$$;

\set c '''16700000-0000-4000-8000-0000000000c1'''
\set sb '''16700000-0000-4000-8000-0000000000c2'''
\set owner '''16700000-0000-4000-8000-000000000001'''
\set pa '''16700000-0000-4000-8000-000000000002'''
\set pa2 '''16700000-0000-4000-8000-000000000003'''
\set staff '''16700000-0000-4000-8000-000000000004'''
\set h '''16700000-0000-4000-8000-0000000000b1'''
\set pm '''16700000-0000-4000-8000-0000000000a1'''
\set ps '''16700000-0000-4000-8000-0000000000a2'''
\set po '''16700000-0000-4000-8000-0000000000a3'''

insert into auth.users (id, email) values
  (:owner, 'owner167@c.test'), (:pa, 'pa167@weaver.test'), (:pa2, 'pa2167@weaver.test'), (:staff, 'staff167@c.test');
insert into app.accounts (user_id, is_platform_admin) values (:pa, true), (:pa2, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'iv167', 'Invite Temple 167', 'I167', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, environment, status) values (:sb, 'iv167b-sandbox', 'New Sandbox 167', 'sandbox', 'onboarding');
insert into app.center_owners (center_id, user_id) values (:c, :owner);
insert into app.households (id, center_id, display_name) values (:h, :c, 'Member167 household');
-- Member records whose emails are a Weaver account's (an import, say) and a staff member's.
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:pm, :c, 'Pat', 'Member167', date '1980-01-01', 'pa167@weaver.test'),
  (:ps, :c, 'Sid', 'Staff167', date '1981-01-01', 'staff167@c.test'),
  (:po, :c, 'Ola', 'Other167', date '1982-01-01', null);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h, :pm, :c, 'primary', true), (:h, :ps, :c, 'spouse', false), (:h, :po, :c, 'other', false);
select pg_temp.invite('16700000-0000-4000-8000-0000000000e1', :c, 'pa167@weaver.test', :owner, 'tok167-weaver-no-person-aaaa');
select pg_temp.invite('16700000-0000-4000-8000-0000000000e2', :c, 'staff167@c.test', :owner, 'tok167-staff-no-person-aaaaa');
select pg_temp.invite('16700000-0000-4000-8000-0000000000e3', :c, 'pa2167@weaver.test', :owner, 'tok167-weaver-names-ola-aaa', :po);
select pg_temp.invite('16700000-0000-4000-8000-0000000000e4', :c, 'pa167@weaver.test', :owner, 'tok167-weaver-second-aaaaaa');
select pg_temp.invite('16700000-0000-4000-8000-0000000000e5', :sb, 'pa2167@weaver.test', :pa, 'tok167-sandbox-owner-aaaaaa', null, true);

-- ══ A. No person named, accepted by a Weaver account ═════════════════════════
set role authenticated;
select pg_temp.claims(:pa);
select (app.accept_invitation('tok167-weaver-no-person-aaaa'))->>'person_id' as pa_person \gset
reset role;
select pg_temp.assert(:'pa_person' <> :pm
                      and not exists (select 1 from app.center_users where center_id = :c and person_id = :pm)
                      and (select person_id from app.center_users where center_id = :c and user_id = :pa) = :'pa_person'
                      and (select email::text from app.people where id = :'pa_person') = 'pa167@weaver.test',
  'A · a Weaver account accepting an invitation is not linked to the member found by its email; it gets a record of its own');

-- ══ B. Anyone else: unchanged ════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:staff);
select (app.accept_invitation('tok167-staff-no-person-aaaaa'))->>'person_id' as staff_person \gset
reset role;
select pg_temp.assert(:'staff_person' = :ps and (select person_id from app.center_users where center_id = :c and user_id = :staff) = :ps,
  'B · anyone else is linked to the one member found by email, as before');

-- ══ C. An invitation that names a person ═════════════════════════════════════
set role authenticated;
select pg_temp.claims(:pa2);
select pg_temp.assert_raises($$select app.accept_invitation('tok167-weaver-names-ola-aaa')$$,
  'a Weaver team account cannot accept it', 'C · an invitation naming a member is refused to a Weaver account');
reset role;
select pg_temp.assert(not exists (select 1 from app.center_users where center_id = :c and (person_id = :po or user_id = :pa2))
                      and (select accepted_at is null from app.staff_invitations where id = '16700000-0000-4000-8000-0000000000e3'),
  'C · nothing was linked and the invitation is still open');

-- ══ D. Already linked ════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:pa);
select (app.accept_invitation('tok167-weaver-second-aaaaaa'))->>'person_id' as pa_again \gset
reset role;
select pg_temp.assert(:'pa_again' = :'pa_person' and (select count(*) from app.center_users where center_id = :c and user_id = :pa) = 1,
  'D · a Weaver account already linked in the community keeps its own record');

-- ══ E. The founder flow: an owner invitation for a new sandbox ═══════════════
set role authenticated;
select pg_temp.claims(:pa2);
select (app.accept_invitation('tok167-sandbox-owner-aaaaaa'))->>'owner' as made_owner \gset
reset role;
select pg_temp.assert(:'made_owner'::boolean and (select user_id from app.center_owners where center_id = :sb) = :pa2
                      and exists (select 1 from app.center_users where center_id = :sb and user_id = :pa2),
  'E · an owner invitation for a new sandbox still makes the owner, with a record of their own');

select pg_temp.no_claims();
rollback;
\echo 'PASS: invite weaver accounts tests'
