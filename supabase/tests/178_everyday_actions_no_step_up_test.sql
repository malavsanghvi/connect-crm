-- 0778: no fresh 2FA code for everyday role actions; admin actions keep it (owner rule 2026-10-13).
--   A. The catalogue: the five step-up triggers and their four functions are gone; the nine redefined functions never ask for a
--      code, and no function asks for one under the ten actions' names; the admin step-ups are still wired.
--   B. In a secular non-profit (staff 2FA required, every staff member has an authenticator app, the last code is 10 minutes
--      old): a write-off asked for and completed, a refund asked for, a flagged refund's two approvals, the month locked and
--      unlocked, a person and a household merged, a list export recorded and two Giving exports in a row all go through.
--   C. The wrong role is still refused, and the two-person rule still holds for write-offs and refunds.
--   D. Admin actions still demand a fresh code: granting a role, switching staff 2FA off.
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
-- A statement refused with SQLSTATE CCSTP ("This needs a fresh 2FA check.").
create or replace function pg_temp.assert_code_needed(stmt text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no fresh code was asked for)', label;
exception
  when sqlstate 'CCSTP' then raise notice 'PASS: %', label;
  when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm;
end $$;
-- A statement that changes exactly one row (and is never refused for a missing code).
create or replace function pg_temp.assert_one_row(stmt text, label text) returns void language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: % (% rows changed)', label, n; end if;
  raise notice 'PASS: %', label;
exception
  when sqlstate 'CCSTP' then raise exception 'FAIL: % (a fresh code was asked for)', label;
end $$;
-- A write the caller may not make: refused outright (42501) or no row changed.
create or replace function pg_temp.assert_refused(stmt text, label text) returns void language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: % (% rows changed)', label, n; end if;
  raise notice 'PASS: % (no row changed)', label;
exception
  when sqlstate '42501' then raise notice 'PASS: % (refused)', label;
  when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
    raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm;
end $$;
-- Sign in as a user. p_code_age: seconds since the last 2FA code (null: no code in this session).
create or replace function pg_temp.claims(p_user uuid, p_code_age int default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_code_age is not null then 'aal2' else 'aal1' end,
    'amr', case when p_code_age is not null
                then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_code_age))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal"}', true);
end $$;

\set c '''17800000-0000-4000-8000-0000000000c1'''
\set tr1 '''17800000-0000-4000-8000-000000000001'''
\set tr2 '''17800000-0000-4000-8000-000000000002'''
\set adm '''17800000-0000-4000-8000-000000000003'''
\set ed '''17800000-0000-4000-8000-000000000004'''
\set mem '''17800000-0000-4000-8000-000000000005'''
\set h1 '''17800000-0000-4000-8000-0000000000a1'''
\set h2 '''17800000-0000-4000-8000-0000000000a2'''
\set p1 '''17800000-0000-4000-8000-0000000000b1'''
\set p2 '''17800000-0000-4000-8000-0000000000b2'''
\set pl '''17800000-0000-4000-8000-0000000000d1'''
\set pay '''17800000-0000-4000-8000-0000000000e1'''
\set pay2 '''17800000-0000-4000-8000-0000000000e2'''
\set rf '''17800000-0000-4000-8000-0000000000f1'''

-- ══ Fixtures: a secular non-profit, two treasurers, an administrator, a content editor, a member ═══════════════
insert into auth.users (id, email) values
  (:tr1, 'treasurer178@foodbank.test'), (:tr2, 'treasurer2-178@foodbank.test'), (:adm, 'admin178@foodbank.test'),
  (:ed, 'editor178@foodbank.test'), (:mem, 'member178@foodbank.test');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('17800000-0000-4000-8000-0000000009f1', :tr1, 'phone', 'totp', 'verified'),
  ('17800000-0000-4000-8000-0000000009f2', :tr2, 'phone', 'totp', 'verified'),
  ('17800000-0000-4000-8000-0000000009f3', :adm, 'phone', 'totp', 'verified'),
  ('17800000-0000-4000-8000-0000000009f4', :ed, 'phone', 'totp', 'verified');
insert into app.centers (id, slug, name, environment, category_key, status)
values (:c, 'foodbank178-sandbox', 'Riverside Food Bank 178', 'sandbox', 'nonprofit_secular', 'onboarding');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:c, :tr1, 'treasurer', 'test 178'), (:c, :tr2, 'treasurer', 'test 178'), (:c, :adm, 'center_admin', 'test 178'),
  (:c, :ed, 'content_editor', 'test 178');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Member178, Alex'), (:h2, :c, 'Member178, Alex (copy)');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p1, :c, 'Alex', 'Member178', date '1980-01-01'), (:p2, :c, 'Alex', 'Member178', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p1, :c, 'primary', true), (:h2, :p2, :c, 'primary', true);
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at)
values (:pl, :c, :h1, 'general', 6000, now() - interval '30 days');
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, provider_ref, received_on) values
  (:pay, :c, :h1, 4000, 'check', 'captured', 'offline', null, current_date - 3),
  (:pay2, :c, :h1, 10000, 'card', 'captured', 'stripe', 'pi_178_one', current_date - 3);
-- A refund made in the Stripe dashboard, waiting for two approvals.
insert into app.payment_refunds (id, center_id, payment_id, source, provider, amount_cents, refunded_on, provider_ref, status)
values (:rf, :c, :pay2, 'provider_dashboard', 'stripe', 2500, current_date - 1, 're_178_one', 'flagged');

-- ══ A. The catalogue ═════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(not exists (select 1 from pg_trigger where not tgisinternal
                                    and tgname in ('pledges_step_up', 'payments_step_up', 'accounting_periods_step_up',
                                                   'people_step_up_merge', 'households_step_up_merge')),
  'A · the write-off, refund, month-lock and merge step-up triggers are gone');
select pg_temp.assert(to_regprocedure('app.step_up_pledges()') is null and to_regprocedure('app.step_up_payments()') is null
                      and to_regprocedure('app.step_up_accounting_periods()') is null and to_regprocedure('app.step_up_merge()') is null,
  'A · and so are their four functions');
select pg_temp.assert((select count(distinct proname) from pg_proc where pronamespace = 'app'::regnamespace
                         and proname in ('request_provider_refund', 'approve_flagged_refund', 'record_manual_paypal_refund', 'record_export',
                                         'giving_export_check', 'import_undo', 'approve_qbo_mapping', 'approve_qbo_test_post', '_qbo_apply_basis')) = 9
                      and not exists (select 1 from pg_proc where pronamespace = 'app'::regnamespace
                         and proname in ('request_provider_refund', 'approve_flagged_refund', 'record_manual_paypal_refund', 'record_export',
                                         'giving_export_check', 'import_undo', 'approve_qbo_mapping', 'approve_qbo_test_post', '_qbo_apply_basis')
                         and prosrc ~* '(step_up|CCSTP)'),
  'A · refunds (three routes), exports, the Giving export check, undoing an import and the three QuickBooks approvals never ask for a code');
select pg_temp.assert(not exists (select 1 from pg_proc where pronamespace = 'app'::regnamespace
                         and prosrc ~ 'step_up\(''(giving\.refund|giving\.write_off|accounting\.month_lock|people\.merge|import\.undo|qbo\.approve_mapping|qbo\.approve_test_post|qbo\.change_basis|export\.)'),
  'A · no function asks for a fresh code under the ten everyday actions'' names');
select pg_temp.assert((select count(*) from pg_trigger where not tgisinternal
                         and tgname in ('role_grants_step_up', 'center_modules_step_up', 'centers_step_up_security')) = 3
                      and exists (select 1 from pg_proc where pronamespace = 'app'::regnamespace and proname = 'transfer_ownership' and prosrc ~ 'assert_step_up')
                      and exists (select 1 from pg_proc where pronamespace = 'app'::regnamespace and proname = 'reset_staff_2fa' and prosrc ~ 'assert_step_up')
                      and exists (select 1 from pg_proc where pronamespace = 'app'::regnamespace and prosrc ~ 'assert_step_up\(''payments\.payee''\)')
                      and exists (select 1 from pg_proc where pronamespace = 'app'::regnamespace and prosrc ~ 'assert_step_up\(''payments\.connect''\)')
                      and exists (select 1 from pg_proc where pronamespace = 'app'::regnamespace and prosrc ~ 'assert_step_up\(''qbo\.connect''\)'),
  'A · the admin step-ups stay: role grants, module switches, the staff 2FA rule, ownership, 2FA reset, payees, payment and QuickBooks connections');

-- ══ B + C. Everyday actions with a code from 10 minutes ago ═══════════════════════════════════════════════════
select pg_temp.claims(:tr1, 600);
select pg_temp.assert(not app.has_recent_step_up(5) and app.has_verified_totp(:tr1) and app.require_2fa_for_staff(:c),
  'B · the setting: the treasurer has an authenticator app, the last code is 10 minutes old, the community requires staff 2FA');
set role authenticated;

-- 1. Write-offs: asked for and completed by two different treasurers.
select pg_temp.assert_one_row(format($$update app.pledges set written_off_by = %L where id = %L$$, :tr1, :pl),
  'B · 1 · a treasurer asks for a write-off without a fresh code');
select pg_temp.assert_raises(format($$update app.pledges set status = 'written_off', written_off_second_approver = %L where id = %L$$, :tr1, :pl),
  'two different approvers', 'C · 1 · the same treasurer cannot also complete it (two-person rule)');
select pg_temp.claims(:ed, 600);
select pg_temp.assert_refused(format($$update app.pledges set written_off_by = %L where id = %L$$, :ed, :pl),
  'C · 1 · a content editor cannot ask for a write-off');
select pg_temp.claims(:tr2, 600);
select pg_temp.assert_one_row(format($$update app.pledges set status = 'written_off', written_off_second_approver = %L where id = %L$$, :tr2, :pl),
  'B · 1 · a second treasurer completes it without a fresh code');

-- 2. Refunds: a request on the payment, and a dashboard refund's two approvals.
select pg_temp.claims(:tr1, 600);
select pg_temp.assert_one_row(format($$update app.payments set refund_approved_by = %L, refund_requested_cents = 1000, refund_reason = 'Gave twice by mistake' where id = %L$$, :tr1, :pay),
  'B · 2 · a treasurer asks for a refund without a fresh code');
select pg_temp.assert_raises(format($$update app.payments set refund_second_approver = %L, refunded_cents = 1000 where id = %L$$, :tr1, :pay),
  'two different approvers', 'C · 2 · the same treasurer cannot also record it (two-person rule)');
select pg_temp.assert(app.approve_flagged_refund(:rf, 'Donor asked by phone; confirmed with the office')->>'stage' = 'first',
  'B · 2 · a treasurer gives a dashboard refund its first approval without a fresh code');
select pg_temp.assert_raises(format($$select app.approve_flagged_refund(%L, 'me again')$$, :rf), 'different person',
  'C · 2 · the same treasurer cannot give the second approval (two-person rule)');
select pg_temp.claims(:ed, 600);
select pg_temp.assert_raises(format($$select app.approve_flagged_refund(%L, 'ok')$$, :rf), 'giving.approve',
  'C · 2 · a content editor cannot approve a refund');
select pg_temp.claims(:tr2, 600);
select pg_temp.assert(app.approve_flagged_refund(:rf, 'Checked the Stripe dashboard')->>'stage' = 'applied',
  'B · 2 · a second treasurer gives the second approval without a fresh code, and the refund is recorded');

-- 3. The month lock and unlock.
select pg_temp.claims(:tr1, 600);
insert into app.accounting_periods (center_id, period_month, status) values (:c, '2019-01-01', 'closed');
select pg_temp.assert(true, 'B · 3 · a treasurer locks a month without a fresh code');
select pg_temp.assert_one_row(format($$update app.accounting_periods set status = 'open' where center_id = %L and period_month = '2019-01-01'$$, :c),
  'B · 3 · and unlocks it without a fresh code');
select pg_temp.claims(:ed, 600);
select pg_temp.assert_refused(format($$insert into app.accounting_periods (center_id, period_month, status) values (%L, '2019-02-01', 'closed')$$, :c),
  'C · 3 · a content editor cannot lock a month');

-- 4. Merges.
select pg_temp.claims(:adm, 600);
select pg_temp.assert_one_row(format($$update app.people set merged_into_id = %L where id = %L$$, :p1, :p2),
  'B · 4 · an administrator merges a person without a fresh code');
select pg_temp.assert_one_row(format($$update app.households set merged_into_id = %L where id = %L$$, :h1, :h2),
  'B · 4 · and a household');

-- 5 + 6. List exports (People, households, event feedback: app.record_export).
select pg_temp.claims(:tr1, 600);
select app.record_export(:c, 'people_list', '{"rows": 2}');
select pg_temp.assert(true, 'B · 5 · staff record a list export without a fresh code');
select pg_temp.claims(:mem, 600);
select pg_temp.assert_raises(format($$select app.record_export(%L, 'people_list', '{"rows": 2}')$$, :c), 'staff',
  'C · 5 · someone who is not staff cannot export');

-- 7. Giving exports: no authenticator check, no fresh code, no new code per file; data.export still needed.
select pg_temp.claims(:tr1, 600);
select app.giving_export_check(:c, 'payments');
select app.record_giving_export(:c, 'payments', '{"rows": 2}');
select app.record_giving_export(:c, 'pledges', '{"rows": 1}');
select pg_temp.assert(true, 'B · 7 · a treasurer exports two Giving lists in a row with a 10-minute-old code');
select pg_temp.claims(:tr1);
select app.giving_export_check(:c, 'payments');
select pg_temp.assert(true, 'B · 7 · and with no code in this session at all');
select pg_temp.claims(:ed, 600);
select pg_temp.assert_raises(format($$select app.giving_export_check(%L, 'payments')$$, :c), 'data-export permission',
  'C · 7 · a content editor cannot export a Giving list (no data.export)');

-- ══ D. Admin actions still demand a fresh code ════════════════════════════════════════════════════════════════
select pg_temp.claims(:adm, 600);
select pg_temp.assert_code_needed(format($$insert into app.role_grants (center_id, user_id, role_key) values (%L, %L, 'content_editor')$$, :c, :mem),
  'D · granting a role still needs a fresh code');
select pg_temp.assert_code_needed(format($$update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"security": {"require_2fa_for_staff": false}}'::jsonb where id = %L$$, :c),
  'D · switching staff 2FA off still needs a fresh code');
select pg_temp.assert_code_needed($$select app.assert_step_up('roles.grant')$$,
  'D · app.assert_step_up itself is unchanged');

-- ══ The audit still records every export ══════════════════════════════════════════════════════════════════════
reset role;
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c and actor_user_id = :tr1 and action = 'export.people_list' and after->>'rows' = '2') = 1
                      and (select count(*) from app.audit_log where center_id = :c and actor_user_id = :tr1
                             and action in ('export.giving_payments', 'export.giving_pledges') and record_table = 'giving_export') = 2,
  'B · every export is still in the audit log, under the person who made it');

rollback;
