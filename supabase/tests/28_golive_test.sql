-- 0300–0302 (onboarding Wave D, stream o-golive): all 13 readiness checks registered in the
-- plan's order and honest; checks 8 and 12 with approval records; check 6 in a sandbox;
-- check 10 needs a reconciled import; the Setup checklist's routes, computed statuses and
-- "live" steps; numbering and storage for the admin.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;
create or replace function pg_temp.check(p_key text, p_center uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute format('select %s($1)', (select check_fn from app.readiness_checks where key = p_key)) into v using p_center;
  return v;
end $$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set treasurer '''10000000-0000-4000-8000-000000000003'''
\set admin '''10000000-0000-4000-8000-000000000011'''
\set member '''10000000-0000-4000-8000-000000000001'''

-- ── The registry ─────────────────────────────────────────────────────────────
select pg_temp.assert((select string_agg(key, ',' order by sort) from app.readiness_checks where sort <= 13) =
  'nonprofit_verified,agreements_accepted,owner_and_second_admin_2fa,email_domain_verified,texting_registered,payments_live,'
  || 'quickbooks_ready,statement_templates_approved,setup_data_complete,records_imported_reconciled,member_legal_documents_published,'
  || 'niva_evaluated,staff_trained_pilot_done',
  'all 13 plan checks are registered, at their plan numbers 1–13');
select pg_temp.assert((select sort from app.readiness_checks where key = 'background_service') = 14, 'the background-service check follows as 14');
select pg_temp.assert((select bool_and(check_fn::text = 'app.check_' || case key when 'records_imported_reconciled' then 'records_imported' else key end)
                         from app.readiness_checks),
  'every check points at app.check_<key> (the renamed originals are not registered)');
select pg_temp.assert((select module_key is null from app.module_tables where table_name = 'golive_approvals')
                      and exists (select 1 from pg_trigger where tgname = 'audit_golive_approvals')
                      and (select relrowsecurity from pg_class where oid = 'app.golive_approvals'::regclass),
  'golive_approvals: module_tables row, audit trigger, RLS on');

-- ── Check 8: the treasurer approves the receipt and statement templates ─────
select pg_temp.assert(not (pg_temp.check('statement_templates_approved', :jsh)->>'ok')::boolean
                      and pg_temp.check('statement_templates_approved', :jsh)->>'detail' like '%treasurer has not approved%later release%',
  'check 8 fails until the treasurer approves, and says the full version comes later');
begin;
select pg_temp.claims(:admin);
set local role authenticated;
select pg_temp.assert_raises($$select app.approve_statement_templates('00000000-0000-4000-8000-000000000001', 'looks fine')$$,
  'Only the treasurer', 'a center admin (not the treasurer) cannot approve the templates');
reset role;
select pg_temp.claims(:member);
set local role authenticated;
select pg_temp.assert_raises($$select app.approve_statement_templates('00000000-0000-4000-8000-000000000001', null)$$,
  'Only the treasurer', 'a member cannot approve the templates');
select pg_temp.assert_raises($$select app.golive_approval_status('00000000-0000-4000-8000-000000000001')$$,
  'don''t have access', 'a member cannot read the approvals');
reset role;
select pg_temp.claims(:treasurer);
set local role authenticated;
select pg_temp.assert((app.golive_approval_status(:jsh)->>'is_treasurer')::boolean, 'the treasurer is recognised');
select pg_temp.assert(app.approve_statement_templates(:jsh, 'Reviewed with the accountant')->>'state' = 'current', 'the treasurer approves');
select pg_temp.assert_raises($$insert into app.golive_approvals (center_id, key, approved_by, approver_role, evidence_hash)
  values ('00000000-0000-4000-8000-000000000001', 'niva_content', '10000000-0000-4000-8000-000000000003', 'x', 'x')$$,
  'permission denied', 'approvals cannot be written directly, only through the RPC');
commit;
select pg_temp.assert((select approved_by::text = '10000000-0000-4000-8000-000000000003' and approver_role = 'Treasurer'
                              and note = 'Reviewed with the accountant' and jsonb_array_length(evidence->'templates') = 3
                         from app.golive_approvals where center_id = :jsh and key = 'statement_templates'),
  'the approval records who, the role, the note and the three templates as they were');
select pg_temp.assert((pg_temp.check('statement_templates_approved', :jsh)->>'ok')::boolean
                      and pg_temp.check('statement_templates_approved', :jsh)->>'detail' like 'Approved by the treasurer%later release.',
  'check 8 passes, naming the treasurer, and still says the full version comes later');
select pg_temp.assert((select count(*) from app.audit_log where action = 'golive_approvals.insert' and center_id = :jsh
                         and actor_user_id = '10000000-0000-4000-8000-000000000003' and reason = 'Reviewed with the accountant') = 1,
  'audit: the approval with the treasurer''s note as the reason');
select pg_temp.assert((select status from app.center_setup_steps where center_id = :jsh and step_key = 'tpl.statements') = 'done',
  'Setup step tpl.statements is done');
insert into app.receipt_templates (center_id, kind, signed_by) values (:jsh, 'year_end_statement', 'Someone else, Treasurer')
on conflict (center_id, kind) do update set signed_by = excluded.signed_by;
select pg_temp.assert(not (pg_temp.check('statement_templates_approved', :jsh)->>'ok')::boolean
                      and pg_temp.check('statement_templates_approved', :jsh)->>'detail' like 'The templates changed after%',
  'changing a template after the approval makes check 8 fail again ("changed since approved") — never a stale pass');
update app.center_modules set enabled = false where center_id = :jsh and module_key = 'giving';
insert into app.center_modules (center_id, module_key, enabled) select :jsh, 'giving', false
 where not exists (select 1 from app.center_modules where center_id = :jsh and module_key = 'giving');
select pg_temp.assert((pg_temp.check('statement_templates_approved', :jsh)->>'ok')::boolean, 'with Giving off, check 8 passes (no receipts issued)');
update app.center_modules set enabled = true where center_id = :jsh and module_key = 'giving';

-- ── Check 12: Niva off, or an admin approves its sources ────────────────────
insert into app.center_modules (center_id, module_key, enabled) values (:jsh, 'niva', true)
on conflict (center_id, module_key) do update set enabled = true;
select pg_temp.assert(not (pg_temp.check('niva_evaluated', :jsh)->>'ok')::boolean
                      and pg_temp.check('niva_evaluated', :jsh)->>'detail' like '%not approved its knowledge sources%later release.',
  'check 12 fails while Niva is on and nothing is approved; it says the full evaluation comes later');
begin;
select pg_temp.claims(:admin);
set local role authenticated;
select pg_temp.assert_raises($$select app.approve_niva_content('00000000-0000-4000-8000-000000000001', null)$$,
  'no published knowledge source', 'nothing to approve without a published source');
reset role;
insert into app.content_items (id, center_id, kind, slug, title, body_md, status)
values ('28000000-0000-4000-8000-00000000c001', :jsh, 'niva_source', 'calendar-28', 'Calendar and timings', 'What Niva may answer from.', 'published');
select pg_temp.claims(:treasurer);
set local role authenticated;
select pg_temp.assert_raises($$select app.approve_niva_content('00000000-0000-4000-8000-000000000001', null)$$,
  'needs an administrator', 'the treasurer (no settings.manage) cannot approve Niva');
reset role;
select pg_temp.claims(:admin);
set local role authenticated;
select pg_temp.assert(app.approve_niva_content(:jsh, 'Sources read end to end')->>'state' = 'current', 'an administrator approves Niva''s sources');
commit;
select pg_temp.assert((pg_temp.check('niva_evaluated', :jsh)->>'ok')::boolean, 'check 12 passes after the approval');
update app.content_items set body_md = 'Changed text.', version = version + 1, updated_at = now() where id = '28000000-0000-4000-8000-00000000c001';
select pg_temp.assert(not (pg_temp.check('niva_evaluated', :jsh)->>'ok')::boolean, 'editing a source afterwards makes check 12 fail again');
update app.center_modules set enabled = false where center_id = :jsh and module_key = 'niva';
select pg_temp.assert((pg_temp.check('niva_evaluated', :jsh)->>'ok')::boolean
                      and pg_temp.check('niva_evaluated', :jsh)->>'detail' like 'Niva is switched off%',
  'with Niva switched off, check 12 passes and says why');
begin;
select pg_temp.claims(:admin);
set local role authenticated;
select pg_temp.assert_raises($$select app.approve_niva_content('00000000-0000-4000-8000-000000000001', null)$$,
  'switched off', 'approving Niva while the module is off is refused');
commit;
update app.center_modules set enabled = true where center_id = :jsh and module_key = 'niva';

-- ── A fresh sandbox: checks 6 and 10, and the checklist ─────────────────────
\set sbx '''28000000-0000-4000-8000-0000000000c1'''
\set owner '''28000000-0000-4000-8000-0000000000b1'''
insert into auth.users (id, email) values (:owner, 'owner28@templeexample.test');
insert into app.accounts (user_id) values (:owner);
insert into app.centers (id, slug, name, short_name, environment, status) values (:sbx, 'golive28-sandbox', 'Golive Temple 28', 'GT', 'sandbox', 'onboarding');
insert into app.households (id, center_id, display_name) values ('28000000-0000-4000-8000-0000000000d1', :sbx, 'Owner household');
insert into app.people (id, center_id, first_name, last_name, email) values ('28000000-0000-4000-8000-0000000000e1', :sbx, 'Olga', 'Owner', 'owner28@templeexample.test');
insert into app.household_members (household_id, person_id, center_id, role, is_primary)
values ('28000000-0000-4000-8000-0000000000d1', '28000000-0000-4000-8000-0000000000e1', :sbx, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:sbx, :owner, '28000000-0000-4000-8000-0000000000e1');
insert into app.role_grants (center_id, user_id, role_key, reason) values (:sbx, :owner, 'center_admin', 'test 28 owner');
insert into app.center_owners (center_id, user_id) values (:sbx, :owner) on conflict do nothing;

-- Check 6 in a sandbox: test mode is the most a sandbox can do, and the check says so.
select pg_temp.assert(not (pg_temp.check('payments_live', :sbx)->>'ok')::boolean
                      and pg_temp.check('payments_live', :sbx)->>'detail' like 'No default online processor%test mode%',
  'check 6 (sandbox): no processor → fails, asking for test mode or offline only');
insert into app.center_payment_processors (center_id, processor, is_default, status) values (:sbx, 'stripe', true, 'test');
select pg_temp.assert(pg_temp.check('payments_live', :sbx)->>'detail' like '%run the $1 test%', 'check 6 (sandbox): connected, no test yet → fails');
insert into app.payment_processor_tests (center_id, processor, mode, charge_ref, refund_ref, ok, detail)
values (:sbx, 'stripe', 'test', 'pi_test_28', 're_test_28', false, 'card declined');
select pg_temp.assert(not (pg_temp.check('payments_live', :sbx)->>'ok')::boolean and pg_temp.check('payments_live', :sbx)->>'detail' like '%failed: card declined',
  'check 6 (sandbox): a failed test → fails with the reason');
insert into app.payment_processor_tests (center_id, processor, mode, charge_ref, refund_ref, ok, ran_at)
values (:sbx, 'stripe', 'test', 'pi_test_28b', 're_test_28b', true, now() + interval '1 second');
select pg_temp.assert((pg_temp.check('payments_live', :sbx)->>'ok')::boolean
                      and pg_temp.check('payments_live', :sbx)->>'detail' like 'Sandbox: Stripe passed the TEST-mode $1 charge pi_test_28b%live mode is connected%in production after promotion.',
  'check 6 (sandbox): a passing TEST-mode $1 test passes, and says in words that live mode comes after promotion');
select pg_temp.assert((pg_temp.check('payments_live', :jsh)->>'detail') not like 'Sandbox:%', 'check 6 in production is the live-mode check, unchanged');

-- Check 10: a household on its own is not "imported and reconciled" (the check asks as a staff member).
select set_config('request.jwt.claims', jsonb_build_object('sub', :owner, 'role', 'authenticated')::text, false);
select pg_temp.assert(not (pg_temp.check('records_imported_reconciled', :sbx)->>'ok')::boolean
                      and pg_temp.check('records_imported_reconciled', :sbx)->>'detail' like 'No household or people import has been reconciled%',
  'check 10: the redeemer''s own household (100% coverage) no longer passes without a reconciled import');
insert into app.import_runs (center_id, entity, tier, source, status, signed_off_by, signed_off_at, file_name)
values (:sbx, 'households', 'records', 'csv', 'reconciled', :owner, now(), 'households.csv');
select pg_temp.assert((pg_temp.check('records_imported_reconciled', :sbx)->>'ok')::boolean
                      and pg_temp.check('records_imported_reconciled', :sbx)->>'detail' like '%Last sign-off: import #%',
  'check 10 passes once a household import is reconciled and signed off');
select set_config('request.jwt.claims', '', false);

-- The checklist, as the owner.
begin;
select pg_temp.claims(:owner);
set local role authenticated;
create temp table cl28 on commit drop as select * from app.setup_checklist(:sbx);
select pg_temp.assert((select count(*) from cl28 where route in ('/imports', '/setup/health-check') or (route is null and step_key <> 'golive.readiness')) = 0,
  'no step links to a screen that does not exist, and every step has a screen');
select pg_temp.assert((select route from cl28 where step_key = 'rec.people') = '/settings/import'
                      and (select route from cl28 where step_key = 'test.pilot') = '/setup/go-live'
                      and (select route from cl28 where step_key = 'svc.storage') = '/settings/storage'
                      and (select route from cl28 where step_key = 'data.numbering') = '/settings/numbering',
  'records and history → Data import; training/pilot/health check → Go-live; storage and numbering → their screens');
select pg_temp.assert((select status from cl28 where step_key = 'org.agreements') = 'not_started'
                      and (select status from cl28 where step_key = 'org.team') = 'not_started'
                      and (select status from cl28 where step_key = 'rec.people') = 'done'
                      and (select status from cl28 where step_key = 'svc.payments') = 'done',
  'computed from real data: no agreements, no second admin; the reconciled import; the passing Stripe test');
select pg_temp.assert((select status from cl28 where step_key = 'tpl.statements') = 'not_started'
                      and (select detail from cl28 where step_key = 'tpl.statements') like '%treasurer%',
  'tpl.statements waits for the treasurer''s approval');
commit;

-- A stored "done" never outlives the data on a live step.
insert into app.center_setup_steps (center_id, step_key, status) values (:sbx, 'org.agreements', 'done');
begin;
select pg_temp.claims(:owner);
set local role authenticated;
select pg_temp.assert((select status from app.setup_checklist(:sbx) where step_key = 'org.agreements') = 'not_started',
  'a live step: a stored "done" does not show while the agreements are not accepted');
commit;
-- …while a manual step keeps what the person chose.
insert into app.center_setup_steps (center_id, step_key, status) values (:sbx, 'svc.other', 'done');
begin;
select pg_temp.claims(:owner);
set local role authenticated;
select pg_temp.assert((select status from app.setup_checklist(:sbx) where step_key = 'svc.other') = 'done', 'a manual step keeps the status a person set');
commit;

-- ── Numbering ────────────────────────────────────────────────────────────────
begin;
select pg_temp.claims(:owner);
set local role authenticated;
select pg_temp.assert((select count(*) from jsonb_array_elements(app.numbering_overview(:sbx))) = 6
                      and (select e->>'prefix' from jsonb_array_elements(app.numbering_overview(:sbx)) e where e->>'kind' = 'household') = 'GT-H-',
  'the numbering overview lists the six kinds with the default prefix from the short name');
select pg_temp.assert((app.save_numbering(:sbx, '[{"kind":"member","prefix":"gt-","next_value":"50001"}]', 'Adopt our register numbers')->>'changed')::int = 1,
  'the owner sets the member prefix and first number');
select pg_temp.assert_raises($$select app.save_numbering('28000000-0000-4000-8000-0000000000c1', '[{"kind":"member","prefix":"GT-","next_value":"100"}]')$$,
  'cannot go back', 'the next number never goes back (no number is issued twice)');
select pg_temp.assert_raises($$select app.save_numbering('28000000-0000-4000-8000-0000000000c1', '[{"kind":"member","prefix":"G T!","next_value":"60000"}]')$$,
  'capital letters, digits and dashes', 'a prefix with spaces or symbols is refused');
reset role;
select pg_temp.claims(:member);
set local role authenticated;
select pg_temp.assert_raises($$select app.save_numbering('28000000-0000-4000-8000-0000000000c1', '[]')$$, 'settings.manage', 'someone else cannot change the numbering');
commit;
select pg_temp.assert((select prefix || next_value from app.number_sequences where center_id = :sbx and kind = 'member') = 'GT-50001',
  'the sequence is saved (prefix upper-cased)');
select pg_temp.assert(app.next_number(:sbx, 'member') = 'GT-50001' and app.next_number(:sbx, 'member') = 'GT-50002', 'the next member numbers follow it');
select pg_temp.assert((select status from app.center_setup_steps where center_id = :sbx and step_key = 'data.numbering') = 'done'
                      and exists (select 1 from app.audit_log where center_id = :sbx and action in ('number_sequences.insert','number_sequences.update') and reason = 'Adopt our register numbers'),
  'the numbering step is done, and the change is audited with the reason');

-- ── Storage ──────────────────────────────────────────────────────────────────
begin;
select pg_temp.claims(:owner);
set local role authenticated;
select pg_temp.assert(case when (app.center_storage_overview(:sbx)->>'available')::boolean
                           then jsonb_array_length(app.center_storage_overview(:sbx)->'areas') = 9
                                and (select (a->>'retention_days')::int from jsonb_array_elements(app.center_storage_overview(:sbx)->'areas') a where a->>'bucket' = 'imports') = 90
                           else true end
                      and app.center_storage_overview(:sbx)->'limit_bytes' = '2147483648'::jsonb,
  'the storage overview lists the nine areas with their retention, and the sandbox''s 2 GB limit');
reset role;
select pg_temp.claims(:member);
set local role authenticated;
select pg_temp.assert_raises($$select app.center_storage_overview('28000000-0000-4000-8000-0000000000c1')$$, 'settings.manage', 'someone else cannot read it');
commit;

-- ── Readiness as a whole still reports every check ───────────────────────────
begin;
select pg_temp.claims(:owner);
set local role authenticated;
select pg_temp.assert((select count(*) from app.readiness(:sbx)) = 14 and (select count(*) from app.readiness(:sbx) where detail like 'The check could not run%') = 0,
  'readiness runs all 14 registered checks for the sandbox without an error');
commit;
