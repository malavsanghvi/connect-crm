-- 0724: app.staff_update_membership and app.staff_assign_membership (People redesign, the person slide-over's Memberships section).
--   A. The functions: security definer with the extensions search path; EXECUTE for signed-in people only; the activity allowlist
--   B. Who may call them: people.manage ALONE, people.approve ALONE, people.view, a member, the other community's coordinator, anon, the
--      service key and the worker are all refused (and nothing is written); both permissions together are allowed
--   C. Editing: a reason is required; the dates are checked; ONLY starts_on, ends_on and notes change (tier, status, type, household,
--      holder, fee and pledge stay); the audit log carries who, why, before and after; the status rules; the overlap rule; module off
--   D. Assigning: holder, type, family and date rules; refused when the family already has a live membership; ACTIVE AT ONCE for yearly
--      AND life (even a type that needs the Executive Committee), with no application; the fee pledge made exactly as the approval
--      path makes it, only when asked, only with a fee and only with Pledges & donations on; an expired membership is marked lapsed
--   E. Afterwards: the tier change still works, the Pathshala trigger still fires, a community that is not faith-based works the same
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
begin perform set_config('t146.' || p_name, p_j::text, true); end $$;
create or replace function pg_temp.got(p_name text) returns jsonb language sql stable as $$ select current_setting('t146.' || p_name)::jsonb $$;
-- "Today" in a community's own time zone: the date the functions use.
create or replace function pg_temp.today(p_tz text) returns date language sql stable as $$ select (now() at time zone p_tz)::date $$;
-- The i-th generic family and its adult.
create or replace function pg_temp.hh(n int) returns uuid language sql immutable as $$ select ('14600000-0000-4000-8000-0000000004' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.pp(n int) returns uuid language sql immutable as $$ select ('14600000-0000-4000-8000-0000000005' || lpad(n::text, 2, '0'))::uuid $$;
-- The two calls, as the statement a test hands to assert_raises.
create or replace function pg_temp.assign_sql(h uuid, p uuid, t uuid, s date, e date, r text, fee boolean) returns text language sql as $$
  select format('select app.staff_assign_membership(%L, %L, %L, %L, %L, %L, %L)', h, p, t, s, e, r, fee)
$$;
create or replace function pg_temp.update_sql(m uuid, s date, e date, n text, r text) returns text language sql as $$
  select format('select app.staff_update_membership(%L, %L, %L, %L, %L)', m, s, e, n, r)
$$;
create or replace function pg_temp.run(stmt text) returns void language plpgsql as $$ begin execute stmt; end $$;
-- Run a statement as someone (a user id) or as a database role (anon, service_role, connect_worker), expecting a refusal.
create or replace function pg_temp.refused_as(p_who text, stmt text, expect text, label text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_out();
  if p_who in ('anon', 'service_role', 'connect_worker') then
    perform set_config('request.jwt.claims', jsonb_build_object('role', p_who)::text, true);
    perform set_config('role', p_who, true);
  else
    perform pg_temp.sign_in(p_who::uuid);
  end if;
  perform pg_temp.assert_raises(stmt, expect, label);
  perform pg_temp.sign_out();
end $$;

\set ca '''14600000-0000-4000-8000-0000000000c1'''
\set cb '''14600000-0000-4000-8000-0000000000c2'''
\set cc '''14600000-0000-4000-8000-0000000000c3'''
\set u_both '''14600000-0000-4000-8000-0000000000a1'''
\set u_manage '''14600000-0000-4000-8000-0000000000a2'''
\set u_approve '''14600000-0000-4000-8000-0000000000a3'''
\set u_view '''14600000-0000-4000-8000-0000000000a4'''
\set u_member '''14600000-0000-4000-8000-0000000000a5'''
\set u_bothb '''14600000-0000-4000-8000-0000000000a6'''
\set u_c '''14600000-0000-4000-8000-0000000000a7'''
\set u_owner '''14600000-0000-4000-8000-0000000000a8'''
\set h_hassan '''14600000-0000-4000-8000-0000000000e1'''
\set h_li '''14600000-0000-4000-8000-0000000000e2'''
\set h_arab '''14600000-0000-4000-8000-0000000000e3'''
\set h_merged '''14600000-0000-4000-8000-0000000000e4'''
\set h_exp '''14600000-0000-4000-8000-0000000000e5'''
\set h_edit '''14600000-0000-4000-8000-0000000000e6'''
\set h_over '''14600000-0000-4000-8000-0000000000e7'''
\set h_b '''14600000-0000-4000-8000-0000000000e8'''
\set h_c '''14600000-0000-4000-8000-0000000000e9'''
\set p_samira '''14600000-0000-4000-8000-0000000000d1'''
\set p_karim '''14600000-0000-4000-8000-0000000000d2'''
\set p_layla '''14600000-0000-4000-8000-0000000000d3'''
\set p_zane '''14600000-0000-4000-8000-0000000000d4'''
\set p_omar '''14600000-0000-4000-8000-0000000000d5'''
\set p_ming '''14600000-0000-4000-8000-0000000000d6'''
\set p_leila '''14600000-0000-4000-8000-0000000000d7'''
\set p_jose '''14600000-0000-4000-8000-0000000000d8'''
\set p_priya '''14600000-0000-4000-8000-0000000000d9'''
\set p_bea '''14600000-0000-4000-8000-0000000000da'''
\set p_cho '''14600000-0000-4000-8000-0000000000db'''
\set p_over '''14600000-0000-4000-8000-0000000000dc'''
\set t_comm '''14600000-0000-4000-8000-0000000000f1'''
\set t_year '''14600000-0000-4000-8000-0000000000f2'''
\set t_life '''14600000-0000-4000-8000-0000000000f3'''
\set t_old '''14600000-0000-4000-8000-0000000000f4'''
\set t_free '''14600000-0000-4000-8000-0000000000f5'''
\set t_b '''14600000-0000-4000-8000-0000000000f6'''
\set t_c '''14600000-0000-4000-8000-0000000000f7'''
\set m_live3 '''14600000-0000-4000-8000-0000000000b1'''
\set m_exp5 '''14600000-0000-4000-8000-0000000000b2'''
\set m_end6 '''14600000-0000-4000-8000-0000000000b3'''
\set m_act6 '''14600000-0000-4000-8000-0000000000b4'''
\set m_over_a '''14600000-0000-4000-8000-0000000000b5'''
\set m_over_b '''14600000-0000-4000-8000-0000000000b6'''
\set m_b '''14600000-0000-4000-8000-0000000000b7'''
\set pl6 '''14600000-0000-4000-8000-0000000000b9'''

-- ── Fixtures: a neighbourhood association, a second community, and a chess club that is not faith-based ──────────────────────
insert into auth.users (id, email) values
  (:u_both, 'both146@example.com'), (:u_manage, 'manage146@example.com'), (:u_approve, 'approve146@example.com'),
  (:u_view, 'view146@example.com'), (:u_member, 'member146@example.com'), (:u_bothb, 'bothb146@example.com'), (:u_c, 'c146@example.com'),
  (:u_owner, 'owner146@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:ca, 'riv146', 'Riverside Neighbourhood Association', 'RIV', 'TX', 'active', 'America/Chicago'),
  (:cb, 'oth146', 'Other Club 146', 'OC1', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, environment, category_key) values
  (:cc, 'harbour146', 'Harbour Chess Club', 'HCC', 'CA', 'onboarding', 'Pacific/Auckland', 'sandbox', 'nonprofit_secular');
-- A role that holds people.approve and nothing else (the seeded roles pair it with people.manage).
insert into app.roles (key, tier, name, permissions) values ('approver_only146', 'center', 'Approver only 146', '["people.approve"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:ca, :u_both, 'membership_coordinator', 'center', 'test 146'),   -- people.view + people.manage + people.approve
  (:ca, :u_manage, 'treasurer', 'center', 'test 146'),              -- people.manage, NOT people.approve
  (:ca, :u_approve, 'approver_only146', 'center', 'test 146'),      -- people.approve, NOT people.manage
  (:ca, :u_view, 'privacy_officer', 'center', 'test 146'),          -- people.view only
  (:cb, :u_bothb, 'membership_coordinator', 'center', 'test 146'),  -- both, but in the OTHER community
  (:cc, :u_c, 'membership_coordinator', 'center', 'test 146'),
  (:ca, :u_owner, 'center_admin', 'center', 'test 146');        -- the earliest center_admin becomes the owner (0151), who holds every permission (0400)
insert into app.membership_types (id, center_id, key, tier, name, fee_cents, period_months, ec_approval_required, active) values
  (:t_comm, :ca, 'friend146', 'community', 'Friend', 0, null, false, true),
  (:t_year, :ca, 'annual146', 'yearly', 'Annual member', 5000, 12, false, true),
  (:t_life, :ca, 'lifetime146', 'life', 'Lifetime member', 50000, null, true, true),   -- needs the Executive Committee when it comes from an application
  (:t_old, :ca, 'retired146', 'yearly', 'Retired plan', 1000, 12, false, false),
  (:t_free, :ca, 'student146', 'yearly', 'Student', 0, 12, false, true),
  (:t_b, :cb, 'annual146', 'yearly', 'Annual member', 7000, 12, false, true),
  (:t_c, :cc, 'club146', 'yearly', 'Club member', 2500, 12, false, true);

insert into app.households (id, center_id, display_name) values
  (:h_hassan, :ca, 'Hassan household'), (:h_li, :ca, '李 household'), (:h_arab, :ca, 'الحسن household'), (:h_merged, :ca, 'Merged household'),
  (:h_exp, :ca, 'Garcia household'), (:h_edit, :ca, 'Okafor household'), (:h_over, :ca, 'Overlap household'), (:h_b, :cb, 'Brandt household'),
  (:h_c, :cc, 'Cho household');
update app.households set merged_into_id = :h_hassan where id = :h_merged;
insert into app.households (id, center_id, display_name) select pg_temp.hh(n), :ca, 'Fixture ' || n || ' household' from generate_series(1, 12) n;
insert into app.people (id, center_id, first_name, last_name, date_of_birth, is_deceased, deceased_on) values
  (:p_samira, :ca, 'Samira', 'Hassan', date '1980-02-02', false, null),
  (:p_karim, :ca, 'Karim', 'Hassan', date '1978-03-03', false, null),
  (:p_layla, :ca, 'Layla', 'Hassan', (current_date - interval '9 years')::date, false, null),
  (:p_zane, :ca, 'Zane', 'Hassan', null, false, null),            -- a child with no birth date on file
  (:p_omar, :ca, 'Omar', 'Hassan', date '1950-01-01', true, current_date - 100),
  (:p_ming, :ca, '明', '李', date '1975-04-04', false, null),
  (:p_leila, :ca, 'ليلى', 'الحسن', date '1978-09-09', false, null),
  (:p_jose, :ca, 'José', 'Garcia', date '1970-02-02', false, null),
  (:p_priya, :ca, 'Priya', 'Okafor', date '1985-05-05', false, null),
  (:p_over, :ca, 'Olu', 'Overlap', date '1985-05-06', false, null),
  (:p_bea, :cb, 'Bea', 'Brandt', date '1985-05-05', false, null),
  (:p_cho, :cc, 'Mina', 'Cho', date '1990-06-06', false, null);
insert into app.people (id, center_id, first_name, last_name, date_of_birth) select pg_temp.pp(n), :ca, 'Adult' || n, 'Fixture146', date '1980-01-01' from generate_series(1, 12) n;
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h_hassan, :p_samira, :ca, 'primary', true), (:h_hassan, :p_karim, :ca, 'spouse', false), (:h_hassan, :p_layla, :ca, 'child', false),
  (:h_hassan, :p_zane, :ca, 'child', false), (:h_hassan, :p_omar, :ca, 'parent', false),
  (:h_li, :p_ming, :ca, 'primary', true), (:h_arab, :p_leila, :ca, 'primary', true), (:h_exp, :p_jose, :ca, 'primary', true),
  (:h_edit, :p_priya, :ca, 'primary', true), (:h_over, :p_over, :ca, 'primary', true), (:h_b, :p_bea, :cb, 'primary', true), (:h_c, :p_cho, :cc, 'primary', true);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) select pg_temp.hh(n), pg_temp.pp(n), :ca, 'primary', true from generate_series(1, 12) n;
insert into app.center_users (center_id, user_id, person_id) values (:ca, :u_member, :p_karim);

select pg_temp.today('America/Chicago') as today_a \gset
select pg_temp.today('Pacific/Auckland') as today_c \gset

-- Memberships that already exist: a live yearly one (h_arab), one that is active in status but past its end date (h_exp), a family with
-- an ended community membership, a live yearly membership with a fee pledge (h_edit), and two active ones in a row (h_over).
insert into app.memberships (id, center_id, household_id, person_id, membership_type_id, tier, status, starts_on, ends_on, notes) values
  (:m_live3, :ca, :h_arab, :p_leila, :t_year, 'yearly', 'active', :'today_a'::date - 100, :'today_a'::date + 265, null),
  (:m_exp5, :ca, :h_exp, :p_jose, :t_year, 'yearly', 'active', :'today_a'::date - 800, :'today_a'::date - 400, 'Joined at the fair'),
  (:m_end6, :ca, :h_edit, :p_priya, :t_comm, 'community', 'ended', :'today_a'::date - 900, :'today_a'::date - 200, null),
  (:m_act6, :ca, :h_edit, :p_priya, :t_year, 'yearly', 'active', :'today_a'::date - 200, :'today_a'::date + 165, 'Imported from the old list'),
  (:m_over_a, :ca, :h_over, :p_over, :t_year, 'yearly', 'active', :'today_a'::date - 400, :'today_a'::date - 35, null),
  (:m_over_b, :ca, :h_over, :p_over, :t_year, 'yearly', 'active', :'today_a'::date - 30, :'today_a'::date + 335, null),
  (:m_b, :cb, :h_b, :p_bea, :t_b, 'yearly', 'active', :'today_a'::date - 10, :'today_a'::date + 355, null);
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, status, due_on, created_by)
  values (:pl6, :ca, :h_edit, :p_priya, 'membership_fee', :m_act6, 5000, 'open', :'today_a'::date + 30, :u_both);
update app.memberships set fee_pledge_id = :pl6 where id = :m_act6;

select pg_temp.assert(app.module_enabled(:ca, 'membership') and app.module_enabled(:ca, 'giving') and app.module_enabled(:cc, 'membership') and app.module_enabled(:cc, 'giving'),
                      'fixtures · Membership and Pledges & donations are on in the communities used');

-- ── A. The functions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) = 2 and bool_and(p.prosecdef) and bool_and(p.proconfig::text like '%search_path=app, public, extensions%')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('staff_update_membership', 'staff_assign_membership')),
                      'A · both are security definer and pin the search path with extensions');
select pg_temp.assert(has_function_privilege('authenticated', 'app.staff_update_membership(uuid, date, date, text, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.staff_assign_membership(uuid, uuid, uuid, date, date, text, boolean)', 'execute'),
                      'A · signed-in people may call them (they are checked inside)');
select pg_temp.assert(not has_function_privilege('anon', 'app.staff_update_membership(uuid, date, date, text, text)', 'execute')
                      and not has_function_privilege('anon', 'app.staff_assign_membership(uuid, uuid, uuid, date, date, text, boolean)', 'execute')
                      and not has_function_privilege('service_role', 'app.staff_update_membership(uuid, date, date, text, text)', 'execute')
                      and not has_function_privilege('service_role', 'app.staff_assign_membership(uuid, uuid, uuid, date, date, text, boolean)', 'execute')
                      and not has_function_privilege('connect_worker', 'app.staff_update_membership(uuid, date, date, text, text)', 'execute')
                      and not has_function_privilege('connect_worker', 'app.staff_assign_membership(uuid, uuid, uuid, date, date, text, boolean)', 'execute'),
                      'A · the public key, the service key and the worker have no EXECUTE on either');
select pg_temp.assert((select count(*) = 2 from app.activity_catalog c where c.key in ('people.edit_membership', 'people.assign_membership') and c.surface = 'portal' and c.kind = 'action' and c.entity_kind = 'household' and c.label !~ '[._]'),
                      'A · the two screen actions are in the activity allowlist, with plain labels');

-- ── B. Who may call them ──────────────────────────────────────────────────────────────────────────────────────────────────────
select count(*) as n_mem_a from app.memberships where center_id = :ca \gset
select count(*) as n_mem_b from app.memberships where center_id = :cb \gset
select count(*) as n_pl_a from app.pledges where center_id = :ca \gset
select to_jsonb(m) as snap_act6 from app.memberships m where m.id = :m_act6 \gset
select to_jsonb(m) as snap_b from app.memberships m where m.id = :m_b \gset

-- B1. Editing a membership.
select pg_temp.refused_as(:u_manage::text, pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', 'Corrected'), 'needs the people.approve and people.manage', 'B · people.manage alone cannot edit a membership');
select pg_temp.refused_as(:u_approve::text, pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', 'Corrected'), 'needs the people.approve and people.manage', 'B · people.approve alone cannot edit a membership');
select pg_temp.refused_as(:u_view::text, pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', 'Corrected'), 'needs the people.approve and people.manage', 'B · people.view cannot edit a membership');
select pg_temp.refused_as(:u_member::text, pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', 'Corrected'), 'needs the people.approve and people.manage', 'B · a member of the family cannot edit its membership');
select pg_temp.refused_as(:u_bothb::text, pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', 'Corrected'), 'needs the people.approve and people.manage', 'B · the other community''s coordinator cannot edit this community''s membership');
select pg_temp.refused_as(:u_both::text, pg_temp.update_sql(:m_b, :'today_a'::date - 9, :'today_a'::date + 355, 'x', 'Corrected'), 'needs the people.approve and people.manage', 'B · nor can this community''s coordinator edit the other community''s membership');
select pg_temp.refused_as('anon', pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', 'Corrected'), 'permission denied', 'B · the public key cannot edit a membership');
select pg_temp.refused_as('service_role', pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', 'Corrected'), 'permission denied', 'B · the service key cannot edit a membership');
select pg_temp.refused_as('connect_worker', pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', 'Corrected'), 'permission denied', 'B · the worker cannot edit a membership');
-- B2. Assigning one.
select pg_temp.refused_as(:u_manage::text, pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, 'Paid at the desk', true), 'needs the people.approve and people.manage', 'B · people.manage alone cannot assign a membership');
select pg_temp.refused_as(:u_approve::text, pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, 'Paid at the desk', true), 'needs the people.approve and people.manage', 'B · people.approve alone cannot assign a membership');
select pg_temp.refused_as(:u_view::text, pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, 'Paid at the desk', true), 'needs the people.approve and people.manage', 'B · people.view cannot assign a membership');
select pg_temp.refused_as(:u_member::text, pg_temp.assign_sql(:h_hassan, :p_samira, :t_life, null, null, 'Paid at the desk', true), 'needs the people.approve and people.manage', 'B · a member cannot assign their own family a Life membership');
select pg_temp.refused_as(:u_bothb::text, pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, 'Paid at the desk', true), 'needs the people.approve and people.manage', 'B · the other community''s coordinator cannot assign here');
select pg_temp.refused_as(:u_both::text, pg_temp.assign_sql(:h_b, :p_bea, :t_b, null, null, 'Paid at the desk', true), 'needs the people.approve and people.manage', 'B · nor can this community''s coordinator assign to the other community''s family');
select pg_temp.refused_as('anon', pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, 'Paid at the desk', true), 'permission denied', 'B · the public key cannot assign a membership');
select pg_temp.refused_as('service_role', pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, 'Paid at the desk', true), 'permission denied', 'B · the service key cannot assign a membership');
select pg_temp.refused_as('connect_worker', pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, 'Paid at the desk', true), 'permission denied', 'B · the worker cannot assign a membership');
select pg_temp.assert((select count(*) from app.memberships where center_id = :ca) = :n_mem_a and (select count(*) from app.memberships where center_id = :cb) = :n_mem_b
                      and (select count(*) from app.pledges where center_id = :ca) = :n_pl_a
                      and (select to_jsonb(m) from app.memberships m where m.id = :m_act6) = :'snap_act6'::jsonb and (select to_jsonb(m) from app.memberships m where m.id = :m_b) = :'snap_b'::jsonb,
                      'B · every refused call left the memberships and pledges exactly as they were');

-- ── C. Editing ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_both);
-- C1. A reason is required, and the dates are checked. Each refusal changes nothing.
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', '   '), 'Say why', 'C · a blank reason is refused');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', null), 'Say why', 'C · no reason is refused');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, 'x', repeat('r', 501)), 'reason is too long', 'C · a reason of 501 characters is refused');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, null, :'today_a'::date + 165, 'x', 'Corrected'), 'Choose the date the membership starts', 'C · a start date is required');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date - 191, 'x', 'Corrected'), 'cannot be before the start date', 'C · the end date cannot be before the start date');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date - 190, date '2300-01-01', 'x', 'Corrected'), 'between the years 1900 and 2200', 'C · an end date in the year 2300 is refused');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date - 190, :'today_a'::date + 165, repeat('n', 1001), 'Corrected'), 'note is too long', 'C · a note of 1001 characters is refused');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date - 200, :'today_a'::date + 165, ' Imported from the old list ', 'Corrected'), 'Nothing was changed', 'C · the same dates and the same note are refused as no change');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date + 1, :'today_a'::date + 165, 'Imported from the old list', 'Corrected'), 'cannot start in the future', 'C · an active membership cannot start in the future');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date - 200, :'today_a'::date - 1, 'Imported from the old list', 'Corrected'), 'end date in the past', 'C · an active membership is not ended by an end date in the past');
select pg_temp.assert_raises(pg_temp.update_sql(:m_act6, :'today_a'::date - 200, null, 'Imported from the old list', 'Corrected'), 'needs an end date', 'C · a yearly membership cannot lose its end date (that would make it a lifetime one)');
select pg_temp.assert_raises(pg_temp.update_sql(:m_end6, :'today_a'::date - 900, null, null, 'Corrected'), 'keeps an end date', 'C · an ended membership keeps an end date');
select pg_temp.assert_raises(pg_temp.update_sql(:m_end6, :'today_a'::date - 900, :'today_a'::date + 5, null, 'Corrected'), 'cannot end in the future', 'C · an ended membership cannot end in the future');
select pg_temp.assert_raises(pg_temp.update_sql('14600000-0000-4000-8000-0000000000ff', :'today_a'::date - 190, :'today_a'::date + 165, 'x', 'Corrected'), 'was not found', 'C · a membership that does not exist is not found');
select pg_temp.sign_out();
select pg_temp.assert((select to_jsonb(m) from app.memberships m where m.id = :m_act6) = :'snap_act6'::jsonb, 'C · every refused edit left the membership as it was');

-- C2. The edit: start, end and note change; nothing else does.
select pg_temp.sign_in(:u_both);
select pg_temp.run(pg_temp.update_sql(:m_act6, :'today_a'::date - 210, :'today_a'::date + 200, '  Start date taken from the signed form  ', 'Corrected from the paper form'));
select pg_temp.sign_out();
select pg_temp.assert((select m.starts_on = :'today_a'::date - 210 and m.ends_on = :'today_a'::date + 200 and m.notes = 'Start date taken from the signed form' from app.memberships m where m.id = :m_act6),
                      'C · the start date, the end date and the note changed (the note trimmed)');
select pg_temp.assert((select (to_jsonb(m) - 'starts_on' - 'ends_on' - 'notes' - 'updated_at') = (:'snap_act6'::jsonb - 'starts_on' - 'ends_on' - 'notes' - 'updated_at') from app.memberships m where m.id = :m_act6),
                      'C · nothing else on the membership changed: not the tier, status, type, household, holder, granted_by, fee or pledge');
select pg_temp.assert((select m.fee_pledge_id = :pl6 and m.tier = 'yearly' and m.status = 'active' and m.membership_type_id = :t_year and m.household_id = :h_edit and m.person_id = :p_priya from app.memberships m where m.id = :m_act6)
                      and (select p.amount_cents = 5000 and p.status = 'open' and p.due_on = :'today_a'::date + 30 from app.pledges p where p.id = :pl6),
                      'C · the fee pledge is still linked and untouched');
select pg_temp.assert((select a.actor_user_id = :u_both and a.reason = 'Corrected from the paper form' and (a.before->>'ends_on')::date = :'today_a'::date + 165 and (a.after->>'ends_on')::date = :'today_a'::date + 200
                              and (a.after->>'notes') = 'Start date taken from the signed form' and (a.before->>'notes') = 'Imported from the old list'
                         from app.audit_log a where a.record_table = 'memberships' and a.record_id = :m_act6 and a.action = 'memberships.update' order by a.id desc limit 1),
                      'C · the audit log has who, why, and the old and new values');
-- A note alone, then clearing it.
select pg_temp.sign_in(:u_both);
select pg_temp.run(pg_temp.update_sql(:m_act6, :'today_a'::date - 210, :'today_a'::date + 200, 'Paid by cheque 4417', 'Added the cheque number'));
select pg_temp.run(pg_temp.update_sql(:m_act6, :'today_a'::date - 210, :'today_a'::date + 200, '   ', 'Cleared a note added by mistake'));
select pg_temp.sign_out();
select pg_temp.assert((select m.notes is null from app.memberships m where m.id = :m_act6) and (select count(*) = 3 from app.audit_log a where a.record_table = 'memberships' and a.record_id = :m_act6 and a.action = 'memberships.update' and a.actor_user_id = :u_both),
                      'C · a blank note clears it; each edit has its own audit row');
-- An end date of today keeps it live through today (the same way a tier change ends the old one), and the status is not touched.
select pg_temp.sign_in(:u_both);
select pg_temp.run(pg_temp.update_sql(:m_act6, :'today_a'::date - 210, :'today_a'::date, null, 'The family asked to stop today'));
select pg_temp.sign_out();
select pg_temp.assert((select m.status = 'active' and m.ends_on = :'today_a'::date from app.memberships m where m.id = :m_act6), 'C · an end date of today is allowed and the status stays active');
select pg_temp.sign_in(:u_both);
select pg_temp.run(pg_temp.update_sql(:m_act6, :'today_a'::date - 210, :'today_a'::date + 365, null, 'The family renewed at the desk'));
-- An ended membership: its dates can be corrected, and it stays ended.
select pg_temp.run(pg_temp.update_sql(:m_end6, :'today_a'::date - 900, :'today_a'::date - 210, 'Ended when they moved', 'Correcting the end date'));
select pg_temp.sign_out();
select pg_temp.assert((select m.status = 'ended' and m.ends_on = :'today_a'::date - 210 and m.notes = 'Ended when they moved' from app.memberships m where m.id = :m_end6), 'C · an ended membership''s end date can be corrected, and it stays ended');

-- C3. An active membership may not overlap another active one of the family; a shared boundary day is fine.
select pg_temp.sign_in(:u_both);
select pg_temp.assert_raises(pg_temp.update_sql(:m_over_b, :'today_a'::date - 100, :'today_a'::date + 335, null, 'Backdating'), 'overlaps those dates', 'C · it cannot start before another active membership of the family ends');
select pg_temp.run(pg_temp.update_sql(:m_over_b, :'today_a'::date - 35, :'today_a'::date + 335, null, 'Starts the day the old one ended'));
-- A membership past its end date but still marked active can have its note corrected (only the changed value is checked).
select pg_temp.run(pg_temp.update_sql(:m_over_a, :'today_a'::date - 400, :'today_a'::date - 35, 'Lapsed in the spring', 'Adding context'));
select pg_temp.sign_out();
select pg_temp.assert((select m.starts_on = :'today_a'::date - 35 from app.memberships m where m.id = :m_over_b) and (select m.notes = 'Lapsed in the spring' and m.status = 'active' from app.memberships m where m.id = :m_over_a),
                      'C · sharing one boundary day is allowed; an expired membership''s note can be corrected');

-- C3b. The community's owner (its earliest center_admin, 0151) holds every permission (0400), so passes the same gate.
select pg_temp.assert(exists (select 1 from app.center_owners o where o.center_id = :ca and o.user_id = :u_owner), 'C · fixture: the community''s first center_admin is its owner');
select pg_temp.assert(not exists (select 1 from app.center_owners o where o.center_id = :ca and o.user_id in (:u_both, :u_manage, :u_approve, :u_view)), 'C · fixture: none of the other staff users is the owner');
select pg_temp.sign_in(:u_owner);
select pg_temp.run(pg_temp.update_sql(:m_over_b, :'today_a'::date - 35, :'today_a'::date + 335, 'Checked by the owner', 'Owner check'));
select pg_temp.sign_out();
select pg_temp.assert((select m.notes = 'Checked by the owner' from app.memberships m where m.id = :m_over_b), 'C · the community''s owner (who holds every permission) may edit a membership too');

-- C4. The Membership module off.
insert into app.center_modules (center_id, module_key, enabled, reason) values (:ca, 'membership', false, 'test 146')
  on conflict (center_id, module_key) do update set enabled = false;
select pg_temp.refused_as(:u_both::text, pg_temp.update_sql(:m_act6, :'today_a'::date - 211, :'today_a'::date + 365, null, 'Corrected'), 'switched off', 'C · with the Membership module off, editing is refused');
select pg_temp.refused_as(:u_both::text, pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, 'Paid at the desk', false), 'switched off', 'D · with the Membership module off, assigning is refused');
delete from app.center_modules where center_id = :ca and module_key = 'membership';

-- ── D. Assigning ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
select count(*) as n_mem_a2 from app.memberships where center_id = :ca \gset
select count(*) as n_pl_a2 from app.pledges where center_id = :ca \gset
select count(*) as n_app_a2 from app.membership_applications where center_id = :ca \gset
select pg_temp.sign_in(:u_both);
-- D1. Refusals, in words. Each changes nothing.
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, '  ', true), 'Say why', 'D · a blank reason is refused');
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, null, true), 'Say why', 'D · no reason is refused');
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, null, repeat('r', 501), true), 'reason is too long', 'D · a reason of 501 characters is refused');
select pg_temp.assert_raises(pg_temp.assign_sql('14600000-0000-4000-8000-0000000000ff', null, :t_year, null, null, 'Paid at the desk', true), 'household was not found', 'D · a family that does not exist is not found');
select pg_temp.assert_raises(pg_temp.assign_sql(:h_merged, null, :t_year, null, null, 'Paid at the desk', true), 'merged into another household', 'D · a merged family is refused');
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), '14600000-0000-4000-8000-0000000000fe', null, null, 'Paid at the desk', true), 'type was not found', 'D · a membership type that does not exist is refused');
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_old, null, null, 'Paid at the desk', true), 'not offered any more', 'D · a type that is switched off is refused');
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_b, null, null, 'Paid at the desk', true), 'type was not found', 'D · another community''s type is refused');
select pg_temp.assert_raises(pg_temp.assign_sql(:h_hassan, :p_layla, :t_year, null, null, 'Paid at the desk', true), 'child cannot be the holder', 'D · a child is never the holder');
select pg_temp.assert_raises(pg_temp.assign_sql(:h_hassan, :p_zane, :t_year, null, null, 'Paid at the desk', true), 'child cannot be the holder', 'D · nor a child with no birth date on file');
select pg_temp.assert_raises(pg_temp.assign_sql(:h_hassan, :p_omar, :t_year, null, null, 'Paid at the desk', true), 'deceased cannot hold', 'D · nor a person recorded as deceased');
select pg_temp.assert_raises(pg_temp.assign_sql(:h_hassan, :p_ming, :t_year, null, null, 'Paid at the desk', true), 'current member of this household', 'D · the holder must be in the family: an adult of another family is refused');
select pg_temp.assert_raises(pg_temp.assign_sql(:h_hassan, :p_bea, :t_year, null, null, 'Paid at the desk', true), 'current member of this household', 'D · so is a person of another community');
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, :'today_a'::date + 1, null, 'Paid at the desk', true), 'cannot start in the future', 'D · it is active at once, so it cannot start in the future');
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, :'today_a'::date, :'today_a'::date - 1, 'Paid at the desk', true), 'cannot be before the start date', 'D · the end date cannot be before the start date');
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, :'today_a'::date - 90, :'today_a'::date - 30, 'Paid at the desk', true), 'already passed', 'D · an end date that has passed is refused');
select pg_temp.assert_raises(pg_temp.assign_sql(pg_temp.hh(1), pg_temp.pp(1), :t_year, null, date '2300-01-01', 'Paid at the desk', true), 'between the years 1900 and 2200', 'D · an end date in the year 2300 is refused');
select pg_temp.assert_raises(pg_temp.assign_sql(:h_arab, :p_leila, :t_life, null, null, 'Paid at the desk', true), 'already has an active Yearly membership', 'D · a family that already has a live membership is refused, with the way to change it');
select pg_temp.assert_raises(pg_temp.assign_sql(:h_arab, :p_leila, :t_life, null, null, 'Paid at the desk', true), 'use Change tier', 'D · and the sentence points to Change tier');
select pg_temp.sign_out();
select pg_temp.assert((select count(*) from app.memberships where center_id = :ca) = :n_mem_a2 and (select count(*) from app.pledges where center_id = :ca) = :n_pl_a2,
                      'D · every refused assignment created no membership and no pledge');

-- D2. A yearly membership with its fee, for a family whose name is not in the Latin alphabet; start and end left to the type.
select pg_temp.sign_in(:u_both);
select app.staff_assign_membership(:h_li, :p_ming, :t_year, null, null, '  Paid at the office desk  ', true) as m_li \gset
select pg_temp.sign_out();
select pg_temp.assert((select m.status = 'active' and m.tier = 'yearly' and m.membership_type_id = :t_year and m.person_id = :p_ming and m.center_id = :ca and m.household_id = :h_li
                              and m.starts_on = :'today_a'::date and m.ends_on = (:'today_a'::date + interval '12 months')::date and m.granted_by = :u_both
                              and m.notes = 'Assigned by staff'
                         from app.memberships m where m.id = :'m_li'),
                      'D · a yearly membership is active at once, for the holder, starting today and ending after the type''s 12 months, granted by the caller');
select pg_temp.assert((select p.amount_cents = 5000 and p.status = 'open' and p.source = 'membership_fee' and p.source_ref_id = :'m_li'::uuid and p.household_id = :h_li and p.center_id = :ca
                              and p.pledged_by_person_id = :p_ming and p.due_on = current_date + 30 and p.created_by = :u_both and p.paid_cents = 0 and p.pledge_number is not null
                              and p.campaign_id is null and p.opportunity_id is null and p.fund_id is null
                         from app.memberships m join app.pledges p on p.id = m.fee_pledge_id where m.id = :'m_li'),
                      'D · the fee is ONE open membership_fee pledge, as the approval path makes it: the type''s 5000 cents, due in 30 days, linked both ways');
select pg_temp.assert((select count(*) = 1 from app.pledges p where p.source_ref_id = :'m_li'::uuid), 'D · exactly one pledge');
select pg_temp.assert((select a.actor_user_id = :u_both and a.reason = 'Paid at the office desk' from app.audit_log a where a.record_table = 'memberships' and a.record_id = :'m_li' and a.action = 'memberships.insert'),
                      'D · the new membership is in the audit log with the caller and the reason');
select pg_temp.assert((select a.actor_user_id = :u_both and a.reason = 'Paid at the office desk' from app.audit_log a
                        where a.record_table = 'pledges' and a.record_id = (select fee_pledge_id::text from app.memberships where id = :'m_li') and a.action = 'pledges.insert'),
                      'D · and so is the pledge');
select pg_temp.assert((select count(*) = 0 from app.membership_applications where household_id = :h_li), 'D · no application exists: staff assignment is not an application');

-- D3. A Life membership: ACTIVE AT ONCE, with no Executive Committee step, even though the type needs it for an application.
select pg_temp.assert((select ec_approval_required from app.membership_types where id = :t_life), 'D · (the Life type here does need the Executive Committee for an application)');
select pg_temp.sign_in(:u_both);
select app.staff_assign_membership(pg_temp.hh(1), pg_temp.pp(1), :t_life, null, null, 'Life fee paid by cheque 1031', true) as m_life \gset
select pg_temp.sign_out();
select pg_temp.assert((select m.status = 'active' and m.tier = 'life' and m.ends_on is null and m.starts_on = :'today_a'::date and m.person_id = pg_temp.pp(1) and m.granted_by = :u_both
                         from app.memberships m where m.id = :'m_life'),
                      'D · a Life membership is active at once, with no end date, and no Executive Committee step');
select pg_temp.assert((select p.amount_cents = 50000 and p.status = 'open' and p.source = 'membership_fee' and p.due_on = current_date + 30 and p.pledged_by_person_id = pg_temp.pp(1)
                         from app.memberships m join app.pledges p on p.id = m.fee_pledge_id where m.id = :'m_life'),
                      'D · its fee is an open pledge of 50000 cents');
select pg_temp.assert((select count(*) = 0 from app.membership_applications where household_id = pg_temp.hh(1)), 'D · a Life membership came without any application');
select pg_temp.assert(app.household_active_tier(pg_temp.hh(1)) = 'life', 'D · the family reads as a Life member straight away');

-- E1. The tier change still works afterwards (it ends the Life membership and starts the new tier).
select pg_temp.sign_in(:u_both);
select app.change_household_tier(pg_temp.hh(1), 'yearly', 'Moved to the annual plan') as m_moved \gset
select pg_temp.sign_out();
select pg_temp.assert((select string_agg(m.tier::text || ':' || m.status::text, ',' order by m.tier::text) from app.memberships m where m.household_id = pg_temp.hh(1)) = 'life:ended,yearly:active',
                      'E · the existing tier change still works on a family that was assigned a membership');

-- D4. The fee is recorded only when asked for.
select pg_temp.sign_in(:u_both);
select app.staff_assign_membership(pg_temp.hh(2), pg_temp.pp(2), :t_year, null, null, 'Member since last year, no fee now', false) as m_nofee \gset
select app.staff_assign_membership(pg_temp.hh(3), pg_temp.pp(3), :t_year, null, null, 'Fee waived by the board', null) as m_nullfee \gset
select app.staff_assign_membership(pg_temp.hh(10), pg_temp.pp(10), :t_year, null, null, 'Hardship, complimentary membership', false) as m_hard \gset
select pg_temp.sign_out();
select pg_temp.assert((select m.status = 'active' and m.fee_pledge_id is null and m.notes = 'Assigned by staff' from app.memberships m where m.id = :'m_nofee')
                      and (select m.status = 'active' and m.fee_pledge_id is null and m.notes = 'Assigned by staff' from app.memberships m where m.id = :'m_nullfee')
                      and (select count(*) = 0 from app.pledges p where p.household_id in (pg_temp.hh(2), pg_temp.hh(3))),
                      'D · without the fee box (false or not given) NO pledge is created and the note says nothing about a fee');

-- D5. A type with no fee: nothing to record, and it does not fail.
select pg_temp.sign_in(:u_both);
select app.staff_assign_membership(pg_temp.hh(4), pg_temp.pp(4), :t_free, null, null, 'Student rate', true) as m_free \gset
select pg_temp.sign_out();
select pg_temp.assert((select m.status = 'active' and m.fee_pledge_id is null and m.notes = 'Assigned by staff' from app.memberships m where m.id = :'m_free')
                      and (select count(*) = 0 from app.pledges p where p.household_id = pg_temp.hh(4)),
                      'D · asked to record a fee on a type that has none: the membership is made, no pledge, no failure');

-- D6. No holder named: the pledge is made in the name of the family's primary adult.
select pg_temp.sign_in(:u_both);
select app.staff_assign_membership(pg_temp.hh(5), null, :t_year, null, null, 'Assigned from the old paper register', true) as m_nohold \gset
select pg_temp.sign_out();
select pg_temp.assert((select m.person_id is null and m.fee_pledge_id is not null and p.pledged_by_person_id = pg_temp.pp(5) and p.amount_cents = 5000
                         from app.memberships m join app.pledges p on p.id = m.fee_pledge_id where m.id = :'m_nohold'),
                      'D · with no holder the membership has none and the pledge names the primary adult');

-- D7. Dates given by the caller are kept: backdated start, explicit end.
select pg_temp.sign_in(:u_both);
select app.staff_assign_membership(pg_temp.hh(6), pg_temp.pp(6), :t_year, :'today_a'::date - 30, :'today_a'::date + 60, 'Joined a month ago, short first term', false) as m_dates \gset
select pg_temp.sign_out();
select pg_temp.assert((select m.starts_on = :'today_a'::date - 30 and m.ends_on = :'today_a'::date + 60 from app.memberships m where m.id = :'m_dates'), 'D · a backdated start and an explicit end date are kept');

-- D8. A membership that is active in status but past its end date does not block a new one; it is marked lapsed with its own end date.
select pg_temp.sign_in(:u_both);
select app.staff_assign_membership(:h_exp, :p_jose, :t_year, null, null, 'Renewed at the fair', true) as m_renew \gset
select pg_temp.sign_out();
select pg_temp.assert((select m.status = 'lapsed' and m.ends_on = :'today_a'::date - 400 and m.notes = 'Joined at the fair' from app.memberships m where m.id = :m_exp5)
                      and (select m.status = 'active' and m.starts_on = :'today_a'::date from app.memberships m where m.id = :'m_renew')
                      and (select count(*) = 1 from app.memberships m where m.household_id = :h_exp and m.status = 'active'),
                      'D · the expired one is marked lapsed (its own end date kept) and the family has exactly one active membership');
select pg_temp.assert((select a.reason = 'Renewed at the fair' and a.actor_user_id = :u_both from app.audit_log a where a.record_table = 'memberships' and a.record_id = :m_exp5 and a.action = 'memberships.update' order by a.id desc limit 1),
                      'D · marking it lapsed is in the audit log with the same reason');

-- D9. A second assignment to a family that was just given one is refused.
select pg_temp.sign_in(:u_both);
select pg_temp.assert_raises(pg_temp.assign_sql(:h_li, :p_ming, :t_life, null, null, 'Another try', true), 'already has an active Yearly membership', 'D · a second assignment to the same family is refused');
select pg_temp.sign_out();

-- D10. Pledges & donations switched off: the membership is made, no pledge, and the note says why.
insert into app.center_modules (center_id, module_key, enabled, reason) values (:ca, 'giving', false, 'test 146')
  on conflict (center_id, module_key) do update set enabled = false;
select pg_temp.sign_in(:u_both);
select app.staff_assign_membership(pg_temp.hh(7), pg_temp.pp(7), :t_year, null, null, 'Office desk', true) as m_nogiving \gset
select app.staff_assign_membership(pg_temp.hh(8), pg_temp.pp(8), :t_year, null, null, 'Office desk', false) as m_nogiving2 \gset
select pg_temp.sign_out();
delete from app.center_modules where center_id = :ca and module_key = 'giving';
select pg_temp.assert((select m.status = 'active' and m.fee_pledge_id is null and m.notes = 'Assigned by staff · fee of 50.00 not recorded: Pledges & donations is switched off' from app.memberships m where m.id = :'m_nogiving')
                      and (select count(*) = 0 from app.pledges p where p.household_id = pg_temp.hh(7)),
                      'D · with Pledges & donations off: the membership is made, no pledge, and the note says the fee was not recorded');
select pg_temp.assert((select m.status = 'active' and m.fee_pledge_id is null and m.notes = 'Assigned by staff' from app.memberships m where m.id = :'m_nogiving2'),
                      'D · with Pledges & donations off and no fee asked for, the note says nothing about a fee');

-- ── E. A community that is not faith-based, in another time zone: the same rules ───────────────────────────────────────────────
select pg_temp.sign_in(:u_c);
select app.staff_assign_membership(:h_c, :p_cho, :t_c, null, null, 'Joined at the tournament', true) as m_club \gset
select pg_temp.sign_out();
select pg_temp.assert((select m.status = 'active' and m.starts_on = :'today_c'::date and m.ends_on = (:'today_c'::date + interval '12 months')::date and m.center_id = :cc and p.amount_cents = 2500
                              and p.source = 'membership_fee' and p.status = 'open'
                         from app.memberships m join app.pledges p on p.id = m.fee_pledge_id where m.id = :'m_club'),
                      'E · a chess club (not faith-based, its own time zone): active at once, starting on the club''s own today, with its 2500-cent fee pledge');
select pg_temp.sign_in(:u_c);
select pg_temp.run(pg_temp.update_sql(:'m_club'::uuid, :'today_c'::date - 3, (:'today_c'::date + interval '12 months')::date, 'Joined at the autumn tournament', 'Joined three days earlier'));
select pg_temp.sign_out();
select pg_temp.assert((select m.starts_on = :'today_c'::date - 3 and m.notes = 'Joined at the autumn tournament' from app.memberships m where m.id = :'m_club'), 'E · and it can be edited there');
select pg_temp.refused_as(:u_c::text, pg_temp.assign_sql(:h_hassan, :p_samira, :t_year, null, null, 'Wrong community', true), 'needs the people.approve and people.manage', 'E · the club''s coordinator has no rights in the other community');

-- E2. The Pathshala trigger still fires for these writes (it is attached to memberships and sees the insert and the ends_on update).
create or replace function app.pathshala_membership_trigger() returns trigger language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform set_config('t146.fired', coalesce(nullif(current_setting('t146.fired', true), ''), '') || new.id::text || ',', true);
  return null;
end $$;
select pg_temp.sign_in(:u_both);
select app.staff_assign_membership(pg_temp.hh(9), pg_temp.pp(9), :t_year, null, null, 'Checking the Pathshala trigger', false) as m_trig \gset
select pg_temp.run(pg_temp.update_sql(:m_act6, :'today_a'::date - 210, :'today_a'::date + 366, null, 'Checking the Pathshala trigger on an update'));
select pg_temp.sign_out();
select pg_temp.assert(position(:'m_trig' in current_setting('t146.fired')) > 0 and position(:m_act6::text in current_setting('t146.fired')) > 0,
                      'E · the Pathshala membership trigger fired for the assignment and for the end-date edit');

-- E3. The reason is AUDIT-ONLY. Members can read their own household's memberships row, notes included (memberships_mine, 0010), so
-- the staff member's reason (here even "Hardship, complimentary") is never copied into memberships.notes: the note is the neutral
-- 'Assigned by staff' (plus, only when Pledges & donations is off, the sentence about the community's own fee). The reason is in the
-- audit entry of the new membership, and the audit entry's own copy of the new row carries the neutral note too.
create or replace function pg_temp.audit_only(p_id uuid, p_reason text) returns text language plpgsql as $$
declare v_note text; v_ar text; v_an text; v_n int; v_out text := '';
begin
  select m.notes into v_note from app.memberships m where m.id = p_id;
  select count(*), min(a.reason), min(a.after->>'notes') into v_n, v_ar, v_an
    from app.audit_log a where a.record_table = 'memberships' and a.record_id = p_id::text and a.action = 'memberships.insert';
  if v_note is null or v_note not like 'Assigned by staff%' then v_out := v_out || format(' [note is %L]', v_note); end if;
  if position(p_reason in coalesce(v_note, '')) > 0 then v_out := v_out || ' [the reason is in the note]'; end if;
  if v_n <> 1 then v_out := v_out || format(' [%s audit insert rows]', v_n); end if;
  if v_ar is distinct from p_reason then v_out := v_out || format(' [audit reason is %L]', v_ar); end if;
  if position(p_reason in coalesce(v_an, '')) > 0 or v_an is null or v_an not like 'Assigned by staff%' then v_out := v_out || format(' [audit copy of the note is %L]', v_an); end if;
  return v_out;
end $$;
select pg_temp.assert(pg_temp.audit_only(v.id, v.reason) = '', 'E · the reason is audit-only for ' || v.reason || ': ' || pg_temp.audit_only(v.id, v.reason))
  from (values (:'m_li'::uuid, 'Paid at the office desk'), (:'m_life'::uuid, 'Life fee paid by cheque 1031'),
               (:'m_nofee'::uuid, 'Member since last year, no fee now'), (:'m_nullfee'::uuid, 'Fee waived by the board'),
               (:'m_hard'::uuid, 'Hardship, complimentary membership'), (:'m_free'::uuid, 'Student rate'),
               (:'m_nohold'::uuid, 'Assigned from the old paper register'), (:'m_dates'::uuid, 'Joined a month ago, short first term'),
               (:'m_renew'::uuid, 'Renewed at the fair'), (:'m_nogiving'::uuid, 'Office desk'), (:'m_nogiving2'::uuid, 'Office desk'),
               (:'m_club'::uuid, 'Joined at the tournament'), (:'m_trig'::uuid, 'Checking the Pathshala trigger')) as v(id, reason);
select pg_temp.assert((select m.notes = 'Assigned by staff' from app.memberships m where m.id = :'m_hard'),
                      'E · "Hardship, complimentary membership" is not in the note, which stays neutral');

rollback;
\echo 'PASS: staff memberships tests'
