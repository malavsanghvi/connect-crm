-- Onboarding · o-import (0190–0193): the import engine, custom fields,
-- historical payments that never post to QuickBooks, the data-quality view and
-- the readiness check.
\set ON_ERROR_STOP 1
\set jsh '''00000000-0000-4000-8000-000000000001'''
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
-- Users: 03 Tara (treasurer: people.manage, giving.manage), 11 Ada (center admin: settings.manage,
-- people.manage, no giving.manage), 01 Priya (member).
create temp table ctx (k text primary key, v text);
grant all on ctx to public;

-- ── Catalog ──────────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.import_entities) >= 40, 'the import tool knows every uploaded data type of Appendix A');
select pg_temp.assert(not exists (select 1 from app.import_entities where target_table in ('qbo_account_mappings','ledger_postings')),
  'QuickBooks lists are never uploaded');
select pg_temp.assert((select bool_and(column_name is not null) from unnest(app.custom_field_entities()) t
                        left join information_schema.columns c on c.table_schema = 'app' and c.table_name = t and c.column_name = 'custom'),
  'every importable table has a custom jsonb column');
select pg_temp.assert(exists (select 1 from app.readiness_checks where key = 'records_imported' and check_fn = 'app.check_records_imported'::regproc),
  'the readiness check is registered');

-- ── Permissions ──────────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated"}';
select pg_temp.assert_raises($$select app.import_create_run('00000000-0000-4000-8000-000000000001', 'pledges', 'Neon export', 'pledges.csv')$$,
  'giving.manage', 'a center admin without giving.manage cannot import pledges');
commit;
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select pg_temp.assert_raises($$select app.import_create_run('00000000-0000-4000-8000-000000000001', 'people', 'Neon export', 'people.csv')$$,
  'people.manage', 'a member cannot import people');
select pg_temp.assert_raises($$select app.data_quality('00000000-0000-4000-8000-000000000001')$$, 'people.view', 'a member cannot see the data-quality view');
commit;

-- ── Households, then people (Tara) ──────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into ctx select 'hh_run', (app.import_create_run(:jsh, 'households', 'Neon export', 'households.csv', 'fp-h', 100, '{"crm_system":"neon"}'))->>'id';
select pg_temp.assert(app.import_stage_rows((select v::uuid from ctx where k = 'hh_run'), $$[
  {"row_no":2,"source_key":"0901","raw":{"Household ID":"0901"},"data":{"display_name":"Kapadia family","city":"Katy"},"extra":{"legacy_id":"0901","crm_id":"N-901"}},
  {"row_no":3,"source_key":"0902","raw":{"Household ID":"0902"},"data":{"display_name":"Mehta family","city":"Sugar Land"},"extra":{"legacy_id":"0902"}},
  {"row_no":4,"source_key":"0212","raw":{"Household ID":"0212"},"data":{"display_name":"Shah family","city":"Bellaire"},"extra":{"legacy_id":"212"}}
]$$::jsonb) = 3, 'households are staged');
select pg_temp.assert((select (p->>'create')::int = 1 and (p->>'needs_decision')::int = 1 and (p->>'update')::int = 1
                         from app.import_preview((select v::uuid from ctx where k = 'hh_run')) p),
  'preview: a new household is created, the same-name Mehta household needs a decision, household 212 (stored as 0212) is an update');
select pg_temp.assert((select match->>'by' = 'household_id' from app.import_rows where run_id = (select v::uuid from ctx where k = 'hh_run') and row_no = 4),
  'household IDs match ignoring leading zeros, never by name');
select pg_temp.assert((app.import_commit_batch((select v::uuid from ctx where k = 'hh_run'), 50))->>'status' = 'committed', 'the households import runs');
commit;
select pg_temp.assert((select count(*) = 1 from app.merge_candidates m join app.import_rows x on x.target_id = m.left_id::text
                        where x.run_id = (select v::uuid from ctx where k = 'hh_run') and x.row_no = 3 and m.kind = 'household'
                          and m.right_id = '20000000-0000-4000-8000-000000000002'),
  'the name-only look-alike household went to merge review, not merged');
select pg_temp.assert((select city = 'Bellaire' from app.households where id = '20000000-0000-4000-8000-000000000001'),
  'the matched household was updated');
select pg_temp.assert(exists (select 1 from app.external_ids x join app.import_rows r on r.target_id = x.household_id::text
                               where r.run_id = (select v::uuid from ctx where k = 'hh_run') and r.row_no = 2 and x.kind = 'org_household' and x.value = '0901')
                  and exists (select 1 from app.external_ids x where x.kind = 'crm' and x.system = 'neon' and x.value = 'N-901' and x.person_id is null),
  'the legacy household ID and the CRM ID are kept as identifiers, exactly as given');
select pg_temp.assert((select count(*) > 0 and bool_and(reason = format('Import #%s · households.csv', (select run_number from app.import_runs where id = (select v::uuid from ctx where k = 'hh_run'))))
                              and bool_and(client_app = 'import') and bool_and(correlation_id = (select request_id from app.import_runs where id = (select v::uuid from ctx where k = 'hh_run')))
                         from app.audit_log where correlation_id = (select request_id from app.import_runs where id = (select v::uuid from ctx where k = 'hh_run'))
                           and action not like 'import_%'),
  'every write of the run is audited with "Import #n · file", client app import and the run''s request id');

-- A custom field kept from an extra column; people with a duplicate by email and a name-only look-alike.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into ctx select 'p_run', (app.import_create_run(:jsh, 'people', 'Neon export', 'people.csv', 'fp-p', 100, '{"crm_system":"neon"}'))->>'id';
select pg_temp.assert((select (f->0->>'key') = 'senior_status'
                         from app.import_define_fields((select v::uuid from ctx where k = 'p_run'), '[{"label":"Senior status","type":"boolean"}]') f),
  'an unmapped column becomes the custom field "Senior status"');
select pg_temp.assert(app.import_stage_rows((select v::uuid from ctx where k = 'p_run'), $$[
  {"row_no":2,"source_key":"7001","data":{"first_name":"Neel","last_name":"Kapadia","email":"neel@example.com","date_of_birth":"1950-02-03"},
   "extra":{"legacy_id":"7001","household_id":{"$ref":"household","value":"0901","by":"legacy"},"relationship":"primary","is_primary":true,
            "email_optin":{"opted_in":true,"date":"2024-03-01","source":"Website form"}},"custom":{"senior_status":true}},
  {"row_no":3,"source_key":"7002","data":{"first_name":"Dev","last_name":"Shah","email":"dev.shah@example.com","phone_e164":"+17135550199"},
   "extra":{"legacy_id":"7002","email_optin":{"opted_in":false,"date":null,"source":"import"}},"custom":{"senior_status":false}},
  {"row_no":4,"source_key":"7003","data":{"first_name":"Rahul","last_name":"Shah"},"extra":{"legacy_id":"7003","household_id":{"$ref":"household","value":"0901","by":"legacy"}}},
  {"row_no":5,"source_key":"7004","data":{"first_name":"Nina","last_name":"Kapadia","email":"NEEL@example.com"},"extra":{"legacy_id":"7004"}},
  {"row_no":6,"source_key":"7005","data":{"first_name":"Ghost","last_name":"Row"},"extra":{"household_id":{"$ref":"household","value":"9999","by":"legacy"}}}
]$$::jsonb) = 5, 'people are staged');
select pg_temp.assert((select (p->>'create')::int = 1 and (p->>'update')::int = 2 and (p->>'needs_decision')::int = 1 and (p->>'error')::int = 1
                         from app.import_preview((select v::uuid from ctx where k = 'p_run')) p),
  'preview: Neel is new, Dev matches by email, Nina repeats Neel''s email in the file, Rahul Shah is a name-only look-alike, the row with an unknown household errors');
select pg_temp.assert((select match->>'by' = 'email' from app.import_rows where run_id = (select v::uuid from ctx where k = 'p_run') and row_no = 3),
  'the duplicate by email is matched on email');
select pg_temp.assert((select problems->0->>'message' like 'No household has the ID "9999"%' from app.import_rows where run_id = (select v::uuid from ctx where k = 'p_run') and row_no = 6),
  'an unknown household ID is a plain error on its row');
select app.import_commit_batch((select v::uuid from ctx where k = 'p_run'), 2);
select pg_temp.assert((select status = 'committing' from app.import_runs where id = (select v::uuid from ctx where k = 'p_run')), 'the import runs in batches');
select pg_temp.assert((app.import_commit_batch((select v::uuid from ctx where k = 'p_run'), 50))->>'status' = 'committed', 'the last batch finishes the run');
commit;
select pg_temp.assert((select array_agg(status order by row_no) from app.import_rows where run_id = (select v::uuid from ctx where k = 'p_run'))
                       = array['created','updated','created','updated','failed'],
  'rows: created, updated by email, look-alike created (for merge review), same-file email repeat updated, error failed');
select pg_temp.assert((select custom = '{"senior_status": true}'::jsonb from app.people where email = 'neel@example.com'),
  '"Senior status" is kept on the person as a custom field');
select pg_temp.assert((select phone_e164 = '+17135550199' and custom ->> 'senior_status' = 'false' from app.people where id = '30000000-0000-4000-8000-000000000003'),
  'the matched person was updated');
select pg_temp.assert(exists (select 1 from app.merge_candidates m join app.import_rows x on x.target_id = m.left_id::text
                               where x.run_id = (select v::uuid from ctx where k = 'p_run') and x.row_no = 4 and m.kind = 'person' and m.status = 'open'),
  'the name-only look-alike person went to merge review');
select pg_temp.assert((select count(*) = 1 from app.channel_optins o join app.people p on p.id = o.person_id
                        where p.email = 'neel@example.com' and o.opted_in and o.source = 'Website form'),
  'an explicit email opt-in with date and source is kept');
select pg_temp.assert(exists (select 1 from app.channel_optins where person_id = '30000000-0000-4000-8000-000000000003' and not opted_in),
  'an opt-out is always imported');
select pg_temp.assert(exists (select 1 from app.household_members hm join app.people p on p.id = hm.person_id
                               where p.email = 'neel@example.com' and hm.role = 'primary' and hm.is_primary),
  'the person is linked to their household with the relationship given');

-- The custom field's rules hold outside the import too.
select pg_temp.assert_raises($$update app.people set custom = '{"senior_status": "maybe"}' where id = '30000000-0000-4000-8000-000000000003'$$,
  'takes yes or no', 'a value of the wrong type is refused');
select pg_temp.assert_raises($$update app.people set custom = '{"no_such_field": 1}' where id = '30000000-0000-4000-8000-000000000003'$$,
  'no custom field', 'an undefined custom field is refused');
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated"}';
select app.update_custom_field((select id from app.custom_field_definitions where center_id = :jsh and entity = 'people' and key = 'senior_status'),
                               p_sensitivity => 'member_self');
select pg_temp.assert((app.set_custom_value('people', '30000000-0000-4000-8000-000000000001', 'senior_status', 'true'))->>'senior_status' = 'true',
  'staff set a custom value in place (through RLS)');
commit;
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}';
select pg_temp.assert((select count(*) = 1 and bool_and(label = 'Senior status' and value = 'true'::jsonb)
                         from app.person_custom_fields('00000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001')),
  'the member sees their own member_self custom field');
select pg_temp.assert_raises($$select app.set_custom_value('people', '30000000-0000-4000-8000-000000000003', 'senior_status', 'true')$$,
  'only staff', 'a member cannot change custom details, not even on their own family''s profile');
commit;

-- A searchable custom field is a segment filter; one nobody marked searchable is not.
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated"}';
select pg_temp.assert(app.segment_recipient_count(:jsh, '{"custom_fields":[{"entity":"people","key":"senior_status","value":true}]}') = 0,
  'a custom field that is not searchable is not a segment');
select app.update_custom_field((select id from app.custom_field_definitions where center_id = :jsh and entity = 'people' and key = 'senior_status'),
                               p_searchable => true);
select pg_temp.assert(app.segment_recipient_count(:jsh, '{"custom_fields":[{"entity":"people","key":"senior_status","value":true}]}') >= 1,
  'households with a member whose Senior status is yes form a segment (opted-in adults only)');
commit;

-- ── Membership types (Ada) and memberships (Tara) ─────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated"}';
insert into ctx select 'mt_run', (app.import_create_run(:jsh, 'membership_types', 'csv', 'types.csv'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'mt_run'),
  '[{"row_no":2,"source_key":"senior_life","data":{"key":"senior_life","name":"Senior life","tier":"life","fee_cents":150000}}]');
select app.import_preview((select v::uuid from ctx where k = 'mt_run'));
select app.import_commit_batch((select v::uuid from ctx where k = 'mt_run'));
commit;
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into ctx select 'm_run', (app.import_create_run(:jsh, 'memberships', 'csv', 'memberships.csv'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'm_run'),
  $$[{"row_no":2,"source_key":"M-1","data":{"crm_external_id":"M-1","household_id":{"$ref":"household","value":"0901"},
      "membership_type_id":{"$ref":"lookup","table":"membership_types","by":"key_or_name","value":"Senior life"},"status":"active","starts_on":"2010-01-01"}}]$$);
select app.import_preview((select v::uuid from ctx where k = 'm_run'));
select app.import_commit_batch((select v::uuid from ctx where k = 'm_run'));
commit;
select pg_temp.assert((select tier = 'life' and status = 'active' from app.memberships where crm_external_id = 'M-1'),
  'a membership takes its tier from its type (looked up by name)');

-- ── QuickBooks go-live date; pledges; historical payments with allocations ──
insert into app.integration_connections (center_id, provider, status, settings)
values (:jsh, 'quickbooks_online', 'connected', '{"go_live_date":"2026-01-01"}')
on conflict (center_id, provider) do update set settings = app.integration_connections.settings || '{"go_live_date":"2026-01-01"}';
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into ctx select 'pl_run', (app.import_create_run(:jsh, 'pledges', 'csv', 'pledges.csv'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'pl_run'), $$[
  {"row_no":2,"source_key":"PL-1","data":{"crm_external_id":"PL-1","household_id":{"$ref":"household","value":"0901"},"amount_cents":500000,
   "fund_id":{"$ref":"lookup","table":"funds","by":"key","value":"general"},"pledged_at":"2019-08-30T00:00:00.000Z"},"extra":{"paid_so_far":200000}},
  {"row_no":3,"source_key":"PL-2","data":{"crm_external_id":"PL-2","household_id":{"$ref":"household","value":"0901"},"amount_cents":100000},"extra":{"paid_so_far":0}}
]$$);
select app.import_preview((select v::uuid from ctx where k = 'pl_run'));
select app.import_commit_batch((select v::uuid from ctx where k = 'pl_run'));
insert into ctx select 'pay_run', (app.import_create_run(:jsh, 'payments', 'csv', 'payments.csv'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'pay_run'), $$[
  {"row_no":2,"source_key":"R-1","data":{"crm_external_id":"R-1","household_id":{"$ref":"household","value":"0901"},"amount_cents":150000,
   "method":"check","received_on":"2019-09-02","check_number":"0044"},"extra":{"allocate_to":{"$ref":"pledge","value":"PL-1"}}},
  {"row_no":3,"source_key":"R-2","data":{"crm_external_id":"R-2","household_id":{"$ref":"household","value":"0901"},"amount_cents":50000,
   "method":"zelle","received_on":"2020-01-15"},"extra":{"allocate_to":{"$ref":"pledge","value":"PL-1"}}},
  {"row_no":4,"source_key":"R-3","data":{"crm_external_id":"R-3","household_id":{"$ref":"household","value":"0901"},"amount_cents":25000,
   "method":"cash","received_on":"2026-02-01"}}
]$$);
select app.import_preview((select v::uuid from ctx where k = 'pay_run'));
select pg_temp.assert((app.import_commit_batch((select v::uuid from ctx where k = 'pay_run')))->>'status' = 'committed', 'the payments import runs');
commit;
select pg_temp.assert((select bool_and(is_historical) and count(*) = 3 from app.payments where crm_external_id in ('R-1','R-2','R-3')),
  'imported payments are marked as history');
select pg_temp.assert(not exists (select 1 from app.ledger_postings l join app.payments p on p.id = l.source_id where p.crm_external_id in ('R-1','R-2','R-3')),
  'no historical payment was queued to QuickBooks');
select pg_temp.assert((select check_number = '0044' from app.payments where crm_external_id = 'R-1'), 'check numbers keep their leading zeros');
select pg_temp.assert((select paid_cents = 200000 and status = 'partially_paid' from app.pledges where crm_external_id = 'PL-1'),
  'allocations are imported as given and the pledge balance matches the old system to the cent');

-- A live offline payment still posts; one dated before the go-live date never does.
insert into app.payments (center_id, household_id, amount_cents, method, provider, received_on)
values (:jsh, '20000000-0000-4000-8000-000000000002', 1100, 'cash', 'offline', '2026-03-01'),
       (:jsh, '20000000-0000-4000-8000-000000000002', 1200, 'cash', 'offline', '2025-12-31');
select pg_temp.assert(exists (select 1 from app.ledger_postings l join app.payments p on p.id = l.source_id where p.amount_cents = 1100 and p.received_on = '2026-03-01'),
  'a live offline payment after the go-live date is still queued');
select pg_temp.assert(not exists (select 1 from app.ledger_postings l join app.payments p on p.id = l.source_id where p.amount_cents = 1200 and p.received_on = '2025-12-31'),
  'a payment received before the QuickBooks go-live date is never queued');
select pg_temp.assert_raises($$update app.payments set is_historical = false where crm_external_id = 'R-1'$$, 'already in the books',
  'an imported historical payment cannot be turned into a live one');

-- ── Reconcile, sign off ─────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
select pg_temp.assert((select (rec->>'ok')::boolean and rec->'money' @> '[{"column":"amount_cents","file_cents":225000,"db_cents":225000,"ok":true}]'
                              and rec->'money' @> '[{"column":"allocations","file_cents":200000,"db_cents":200000}]'
                              and jsonb_array_length(rec->'by_year') = 3
                         from app.import_reconcile((select v::uuid from ctx where k = 'pay_run')) rec),
  'payments reconcile: counts, total, allocations and totals per year match the file');
select pg_temp.assert((select (rec->>'ok')::boolean and rec->'money' @> '[{"column":"paid_so_far","file_cents":200000,"db_cents":200000}]'
                         from app.import_reconcile((select v::uuid from ctx where k = 'pl_run')) rec),
  'pledges reconcile: total pledged and paid so far match to the cent');
select app.import_sign_off((select v::uuid from ctx where k = 'pay_run'), null);
select pg_temp.assert((select status = 'reconciled' and signed_off_by = '10000000-0000-4000-8000-000000000003' from app.import_runs
                        where id = (select v::uuid from ctx where k = 'pay_run')), 'the treasurer signs the reconciliation off');
select app.import_reconcile((select v::uuid from ctx where k = 'p_run'));
select pg_temp.assert_raises($$select app.import_sign_off((select v::uuid from ctx where k = 'p_run'), '')$$, 'say why',
  'a run whose totals differ (a failed row) needs a note to sign off');
commit;

-- ── Re-running the same file is safe ────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
insert into ctx select 'pay_run2', (app.import_create_run(:jsh, 'payments', 'csv', 'payments.csv'))->>'id';
select app.import_stage_rows((select v::uuid from ctx where k = 'pay_run2'), (select jsonb_agg(jsonb_build_object('row_no', row_no, 'source_key', source_key,
  'data', data, 'extra', extra)) from app.import_rows where run_id = (select v::uuid from ctx where k = 'pay_run')));
select pg_temp.assert((select (p->>'create')::int = 0 from app.import_preview((select v::uuid from ctx where k = 'pay_run2')) p),
  'a re-run of the same file creates nothing');
select app.import_commit_batch((select v::uuid from ctx where k = 'pay_run2'));
select pg_temp.assert((select count(*) = 3 from app.payments where crm_external_id in ('R-1','R-2','R-3')), 'no payment was duplicated');
select pg_temp.assert((select previous_run_id = (select v::uuid from ctx where k = 'pay_run') from app.import_runs where id = (select v::uuid from ctx where k = 'pay_run2')),
  'a top-up run links to the previous run of the same source');
commit;

-- ── Data quality and readiness ──────────────────────────────────────────────
insert into app.people (id, center_id, first_name, last_name) values ('32200000-0000-4000-8000-000000000001', :jsh, 'Kiddo', 'NoDob');
insert into app.household_members (household_id, person_id, center_id, role)
values ('20000000-0000-4000-8000-000000000002', '32200000-0000-4000-8000-000000000001', :jsh, 'child');
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000011","role":"authenticated"}';
select pg_temp.assert((select dq ? 'coverage' and dq ? 'duplicates' and dq ? 'minors_without_birth_date' and dq ? 'without_consent'
                              and dq ? 'invalid_emails' and dq ? 'invalid_phones' and (dq->'minors_without_birth_date'->>'count')::int >= 1
                         from app.data_quality(:jsh) dq),
  'the data-quality view reports coverage, duplicates, minors without a birth date, missing consents and invalid contacts');
select pg_temp.assert((select not (c->>'ok')::boolean and c->>'detail' like '%not reconciled%' from app.check_records_imported(:jsh) c),
  'readiness: runs not yet signed off keep the check open');
commit;

-- ── Undo ────────────────────────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}';
select pg_temp.assert_raises($$select app.import_undo((select v::uuid from ctx where k = 'pl_run'), 'test')$$, 'undo the later imports first',
  'a run whose records are used by a later run cannot be undone before it');
select pg_temp.assert_raises($$select app.import_undo((select v::uuid from ctx where k = 'p_run'), '')$$, 'say why', 'undo needs a reason');
select app.import_undo((select v::uuid from ctx where k = 'pay_run2'), 'Duplicate top-up');
select app.import_undo((select v::uuid from ctx where k = 'pay_run'), 'Wrong file');
select pg_temp.assert(not exists (select 1 from app.payments where crm_external_id in ('R-1','R-2','R-3')), 'undo removes the payments it created');
select pg_temp.assert((select paid_cents = 200000 and status = 'partially_paid' from app.pledges where crm_external_id = 'PL-1'),
  'and their allocations: the pledge is back to the balance it had before the payments import');
select (app.import_undo((select v::uuid from ctx where k = 'p_run'), 'Test undo'))->>'restored';
commit;
select pg_temp.assert(not exists (select 1 from app.people where email = 'neel@example.com'), 'undo removes the people it created');
select pg_temp.assert((select phone_e164 is null and custom = '{}'::jsonb from app.people where id = '30000000-0000-4000-8000-000000000003'),
  'undo puts the updated person back from the audit log''s before-values');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'people.delete' and reason like 'Undo import #% · people.csv — Test undo'
                               and client_app = 'import'), 'the undo is audited with its reason');
select pg_temp.assert((select status = 'undone' from app.import_runs where id = (select v::uuid from ctx where k = 'p_run')), 'the run shows as undone');
