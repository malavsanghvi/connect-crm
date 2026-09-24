-- Onboarding · o-qbo-match (0240–0243): QuickBooks customers and history,
-- deterministic + AI match suggestions, the treasury's decisions, the
-- family-level rule (primary member) and bringing history in as money history
-- that never posts to QuickBooks.
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
-- Users: 03 Tara (treasurer: accounting.manage, giving.manage, people.manage), 01 Priya (member),
-- 11 Ada (center admin: settings.manage).
grant connect_worker to postgres;
create temp table ctx (k text primary key, v text);
grant all on ctx to public;

-- ── Structure ────────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) = 3 from app.module_tables where table_name in ('qbo_customers','qbo_transactions','qbo_customer_matches')
                         and module_key = 'accounting'), 'the three tables belong to the Accounting module');
select pg_temp.assert((select count(*) = 3 from pg_policy p join pg_class c on c.oid = p.polrelid
                        where c.relname in ('qbo_customers','qbo_transactions','qbo_customer_matches') and p.polname = 'module_switch' and not p.polpermissive),
  'each has the restrictive module_switch policy');
select pg_temp.assert(not has_table_privilege('authenticated', 'app.qbo_customer_matches', 'INSERT')
                      and not has_table_privilege('authenticated', 'app.qbo_customers', 'UPDATE'),
  'nobody writes the copies or the matches directly');

-- ── Fixtures (test data) ─────────────────────────────────────────────────────
insert into app.households (id, center_id, display_name, city, postal_code, address_line1) values
  ('e2700000-0000-4000-8000-000000000001', :jsh, 'Kothari family', 'Katy', '77494', '12 Lotus Ln'),
  ('e2700000-0000-4000-8000-000000000002', :jsh, 'Desai family', 'Sugar Land', '77479', null),
  ('e2700000-0000-4000-8000-000000000003', :jsh, 'Parikh household', 'Houston', '77063', null),
  ('e2700000-0000-4000-8000-000000000004', :jsh, 'Nikhil & Asha Parikh Household', 'Houston', '77077', null),
  ('e2700000-0000-4000-8000-000000000005', :jsh, 'Joshi family', 'Pearland', '77584', null);
insert into app.people (id, center_id, first_name, last_name, email, phone_e164, date_of_birth) values
  ('e2700000-0000-4000-8000-000000000101', :jsh, 'Ketan', 'Kothari', 'ketan@kothari.test', '+17135559001', '1975-01-01'),
  ('e2700000-0000-4000-8000-000000000102', :jsh, 'Rupa', 'Kothari', 'rupa.k@gmail.test', null, '1977-01-01'),
  ('e2700000-0000-4000-8000-000000000103', :jsh, 'Amit', 'Desai', 'amit@desai.test', '+17135559002', '1980-01-01'),
  ('e2700000-0000-4000-8000-000000000104', :jsh, 'Nisha', 'Parikh', 'nisha@parikh.test', null, '1982-01-01'),
  ('e2700000-0000-4000-8000-000000000105', :jsh, 'Nikhil', 'Parikh', 'nikhil@parikh.test', null, '1979-01-01'),
  ('e2700000-0000-4000-8000-000000000106', :jsh, 'Mohan', 'Joshi', null, null, '1960-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('e2700000-0000-4000-8000-000000000001', 'e2700000-0000-4000-8000-000000000101', :jsh, 'primary', true),
  ('e2700000-0000-4000-8000-000000000001', 'e2700000-0000-4000-8000-000000000102', :jsh, 'spouse', false),
  ('e2700000-0000-4000-8000-000000000002', 'e2700000-0000-4000-8000-000000000103', :jsh, 'primary', true),
  ('e2700000-0000-4000-8000-000000000003', 'e2700000-0000-4000-8000-000000000104', :jsh, 'primary', true),
  ('e2700000-0000-4000-8000-000000000004', 'e2700000-0000-4000-8000-000000000105', :jsh, 'primary', true),
  ('e2700000-0000-4000-8000-000000000005', 'e2700000-0000-4000-8000-000000000106', :jsh, 'other', false);
-- Joshi's QuickBooks ID is already on file (identifiers screen).
insert into app.external_ids (center_id, household_id, kind, system, value, label, source) values
  (:jsh, 'e2700000-0000-4000-8000-000000000005', 'accounting', 'quickbooks', '506', 'QuickBooks customer', 'import');
update app.funds set qbo_class_id = 'T27-CL1' where center_id = :jsh and key = 'construction';

-- QuickBooks connects: its customers are pulled right away.
insert into app.integration_connections (center_id, provider, status, external_account_id, display_name, settings)
values (:jsh, 'quickbooks_online', 'connected', '9130355', 'Test company', '{"mode":"test"}')
on conflict (center_id, provider) do update set status = 'disconnected';
update app.integration_connections set status = 'connected', external_account_id = '9130355', settings = settings || '{"mode":"test"}'
 where center_id = :jsh and provider = 'quickbooks_online';
select pg_temp.assert(exists (select 1 from app.jobs where center_id = :jsh and kind = 'qbo.pull_customers_history' and status = 'queued'),
  'connecting QuickBooks queues the customer + history pull');

-- ── The worker pulls (as connect_worker) ─────────────────────────────────────
begin;
set local role connect_worker;
select pg_temp.assert((app.qbo_worker_match_connection(:jsh))->>'realm_id' = '9130355' and (app.qbo_worker_match_connection(:jsh))->>'mode' = 'test'
                      and ((app.qbo_worker_match_connection(:jsh))->>'history_years')::int = 7,
  'the worker reads the realm, the mode and the 7-year history window');
select pg_temp.assert(app.qbo_worker_store_customers(:jsh, $$[
  {"qbo_id":"501","display_name":"Kothari Family","emails":["Ketan@Kothari.test"],"phones":[],"address":{"city":"Katy","zip":"77494"},"open_balance_cents":40000},
  {"qbo_id":"502","display_name":"Amit Desai","given_name":"Amit","family_name":"Desai","phones":["+17135559002"],"address":{"city":"Sugar Land","zip":"77479"}},
  {"qbo_id":"503","display_name":"Parikh Family","address":{}},
  {"qbo_id":"504","display_name":"Acme Temple Supplies","company_name":"Acme Temple Supplies"},
  {"qbo_id":"505","display_name":"Kothari Family:Rupa","parent_qbo_id":"501","is_sub_customer":true},
  {"qbo_id":"506","display_name":"Joshi Family"},
  {"qbo_id":"507","display_name":"Sanjay Mehra","given_name":"Sanjay","family_name":"Mehra","emails":["sanjay@mehra.test"],"address":{"line1":"4 Elm St","city":"Houston","zip":"77002"}},
  {"qbo_id":"599","display_name":"Old inactive donor","active":false}
]$$::jsonb) = 8, 'eight customers are copied');
select pg_temp.assert(app.qbo_worker_store_customers(:jsh, $$[{"qbo_id":"501","display_name":"Kothari Family","emails":["Ketan@Kothari.test"],"phones":[],"address":{"city":"Katy","zip":"77494"},"open_balance_cents":40000}]$$::jsonb) = 0,
  'storing an unchanged customer again changes nothing (no audit noise)');
select pg_temp.assert(app.qbo_worker_store_transactions(:jsh, $$[
  {"qbo_type":"Invoice","qbo_id":"9001","customer_qbo_id":"501","txn_date":"2024-03-01","doc_number":"INV-9001","total_cents":100000,"open_balance_cents":40000,
   "lines":[{"amount_cents":100000,"class_id":"T27-CL1","class_name":"Construction"}],"raw":{"DueDate":"2024-12-31"}},
  {"qbo_type":"Payment","qbo_id":"9101","customer_qbo_id":"501","txn_date":"2024-04-01","total_cents":60000,"payment_method":"Check","reference_number":"1201",
   "linked":[{"type":"Invoice","id":"9001","amount_cents":60000}]},
  {"qbo_type":"Invoice","qbo_id":"9002","customer_qbo_id":"501","txn_date":"2023-05-01","doc_number":"INV-9002","total_cents":50000,"open_balance_cents":0},
  {"qbo_type":"Payment","qbo_id":"9102","customer_qbo_id":"501","txn_date":"2023-06-01","total_cents":50000,"payment_method":"Zelle",
   "linked":[{"type":"Invoice","id":"9002","amount_cents":50000}]},
  {"qbo_type":"SalesReceipt","qbo_id":"9201","customer_qbo_id":"501","txn_date":"2022-10-24","doc_number":"1001","total_cents":25100,"payment_method":"Check","reference_number":"887",
   "lines":[{"amount_cents":25100,"class_id":"T27-UNMAPPED","class_name":"Jeevdaya"}]},
  {"qbo_type":"CreditMemo","qbo_id":"9301","customer_qbo_id":"501","txn_date":"2024-06-01","total_cents":5000},
  {"qbo_type":"Invoice","qbo_id":"9003","customer_qbo_id":"501","txn_date":"2024-07-01","doc_number":"INV-9003","total_cents":30000,"open_balance_cents":0},
  {"qbo_type":"SalesReceipt","qbo_id":"9202","customer_qbo_id":"502","txn_date":"2025-01-15","total_cents":10000,"payment_method":"Visa"},
  {"qbo_type":"SalesReceipt","qbo_id":"9203","customer_qbo_id":"506","txn_date":"2025-02-15","total_cents":7500,"payment_method":"Cash"}
]$$::jsonb) = 9, 'their history is copied');
insert into ctx select 'pull', (app.qbo_worker_finish_pull(:jsh, '{"customers":8}'))::text;
commit;
select pg_temp.assert(((select v from ctx where k = 'pull')::jsonb->>'suggestions')::int >= 4, 'the pull ends with suggestions');

-- ── Suggestions ──────────────────────────────────────────────────────────────
select pg_temp.assert((select household_id = 'e2700000-0000-4000-8000-000000000001' and person_id is null and method = 'email'
                              and confidence >= 0.95 and evidence->'signals' @> '[{"kind":"email"}]' and evidence->'cc'->>'primary' = 'Ketan Kothari'
                         from app.qbo_customer_matches where qbo_customer_id = '501' and status = 'suggested' order by confidence desc limit 1),
  'exact email → the Kothari household, family-level (no person), with the evidence side by side');
select pg_temp.assert((select household_id = 'e2700000-0000-4000-8000-000000000002' and person_id = 'e2700000-0000-4000-8000-000000000103'
                              and method = 'phone' and evidence->'signals' @> '[{"kind":"name_address"}]'
                         from app.qbo_customer_matches where qbo_customer_id = '502' and status = 'suggested' order by confidence desc limit 1),
  'phone (plus name and ZIP) → Amit Desai, person-level');
select pg_temp.assert((select count(*) = 2 and max(confidence) - min(confidence) <= 0.1 and bool_and(method = 'household_name')
                         from app.qbo_customer_matches where qbo_customer_id = '503' and status = 'suggested'),
  '"Parikh Family" matches two households by name, too close to call');
select pg_temp.assert((select method = 'crm_id' and confidence = 0.99 and household_id = 'e2700000-0000-4000-8000-000000000005'
                         from app.qbo_customer_matches where qbo_customer_id = '506' and status = 'suggested' order by confidence desc limit 1),
  'a QuickBooks ID already on file → 0.99');
select pg_temp.assert(not exists (select 1 from app.qbo_customer_matches where qbo_customer_id in ('504','599')),
  'no candidate for a company, none for an inactive customer: both stay unmapped');
select pg_temp.assert(not exists (select 1 from app.qbo_customer_matches where status = 'approved'), 'nothing is ever approved automatically');

-- ── The AI remainder (worker) ────────────────────────────────────────────────
begin;
set local role connect_worker;
insert into ctx select 'ai_in', app.qbo_worker_ai_input(:jsh, 50)::text;
select pg_temp.assert(app.qbo_worker_store_ai(:jsh, '[{"qbo_id":"503","household_id":"e2700000-0000-4000-8000-000000000003","confidence":0.97,"reason":"Same surname, no first name"},
                                                      {"qbo_id":"503","household_id":"not-a-uuid","confidence":0.9}]'::jsonb,
                                                'claude-opus-5', array['503','504']) = 1,
  'the model''s proposal is stored; one pointing at nothing is ignored');
commit;
select pg_temp.assert((select v::jsonb @> '[{"qbo_id":"503"}]' and v::jsonb @> '[{"qbo_id":"504","candidates":[]}]' from ctx where k = 'ai_in'),
  'the ambiguous and the unmatched customers go to the AI');
select pg_temp.assert((select position('@' in v) = 0 and position('9559' in v) = 0 and position('100000' in v) = 0 from ctx where k = 'ai_in'),
  'no full email, phone or amount leaves the database — email domains only');
select pg_temp.assert((select v::jsonb @> '[{"qbo_id":"503","candidates":[{"member_first_names":["Nisha"],"email_domains":["parikh.test"]}]}]' from ctx where k = 'ai_in'),
  'the model sees household names, first names and email domains');
select pg_temp.assert((select confidence = 0.85 and method = 'ai' from app.qbo_customer_matches
                        where qbo_customer_id = '503' and household_id = 'e2700000-0000-4000-8000-000000000003' and status = 'suggested'),
  'an AI proposal is capped at 0.85 and marked as AI');

-- ── Permissions ──────────────────────────────────────────────────────────────
insert into ctx select 'm501', id::text from app.qbo_customer_matches where qbo_customer_id = '501' and status = 'suggested' order by confidence desc limit 1;
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000001','role','authenticated')::text, true);
select pg_temp.assert((select count(*) from app.qbo_customers) = 0 and (select count(*) from app.qbo_customer_matches) = 0,
  'a member sees no QuickBooks customers or matches');
select pg_temp.assert_raises($$select app.approve_qbo_matches(array[(select v::uuid from ctx where k = 'm501')], 'x')$$,
  'accounting.manage', 'a member cannot approve a match');
select pg_temp.assert_raises($$select app.qbo_suggest_matches('00000000-0000-4000-8000-000000000001')$$, 'accounting.manage',
  'a member cannot run matching');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
select pg_temp.assert_raises($$select app.qbo_worker_bring_in('00000000-0000-4000-8000-000000000001', '501')$$, 'permission denied',
  'the treasurer cannot call the worker''s functions');
select pg_temp.assert_raises($$select app.approve_qbo_matches(array(select id from app.qbo_customer_matches where qbo_customer_id = '501' limit 1), '  ')$$,
  'reason', 'approving needs a reason');
commit;

-- ── Approve (Tara) ───────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
select set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/accounting/qbo/matching"}', true);
insert into ctx select 'approve', app.approve_qbo_matches(array(
    select distinct on (qbo_customer_id) id from app.qbo_customer_matches
     where qbo_customer_id in ('501','502','506') and status = 'suggested' order by qbo_customer_id, confidence desc), 'Checked against the QuickBooks ledger')::text;
commit;
select pg_temp.assert((select (v::jsonb->>'approved')::int = 3 and (v::jsonb->>'bring_in_queued')::int = 3 from ctx where k = 'approve'),
  'three matches approved; three history bring-ins queued');
select pg_temp.assert((select count(*) = 3 from app.jobs where center_id = :jsh and kind = 'qbo.bring_in_history' and status = 'queued'),
  'the bring-in jobs are in the queue');
select pg_temp.assert((select module = 'accounting' and client_app = 'portal' and client_screen = '/accounting/qbo/matching'
                              and reason = 'Checked against the QuickBooks ledger' and actor_user_id = '10000000-0000-4000-8000-000000000003'
                         from app.audit_log where action = 'qbo_customer_matches.update' and after->>'status' = 'approved' order by id desc limit 1),
  'the approval is audited: module accounting, portal, screen, reason, who');
select pg_temp.assert(exists (select 1 from app.external_ids where kind = 'accounting' and system = 'quickbooks' and value = '501'
                                and household_id = 'e2700000-0000-4000-8000-000000000001' and person_id is null and valid_to is null),
  'the QuickBooks customer ID is now an identifier of the household');
select pg_temp.assert(app.qbo_customer_for('e2700000-0000-4000-8000-000000000002', 'e2700000-0000-4000-8000-000000000103') = '502'
                      and app.qbo_customer_for('e2700000-0000-4000-8000-000000000001', 'e2700000-0000-4000-8000-000000000102') = '501',
  'qbo_customer_for: the person''s own customer, else the family-level one');

-- The sub-customer now points at its parent's household.
select app.qbo_refresh_suggestions(:jsh, null);
select pg_temp.assert((select method = 'sub_customer' and household_id = 'e2700000-0000-4000-8000-000000000001'
                         from app.qbo_customer_matches where qbo_customer_id = '505' and status = 'suggested' order by confidence desc limit 1),
  'a sub-customer of an approved customer → the parent''s household');

-- ── Bring history in (worker) ────────────────────────────────────────────────
begin;
set local role connect_worker;
insert into ctx select 'b501', app.qbo_worker_bring_in(:jsh, '501')::text;
insert into ctx select 'b506', app.qbo_worker_bring_in(:jsh, '506')::text;
insert into ctx select 'b502', app.qbo_worker_bring_in(:jsh, '502')::text;
commit;
select pg_temp.assert((select (v::jsonb->>'brought_in')::int = 5 and (v::jsonb->>'needs_review')::int = 2 from ctx where k = 'b501'),
  'Kothari: two invoices, two payments and a sales receipt brought in; two wait for review');
select pg_temp.assert((select amount_cents = 100000 and paid_cents = 60000 and status = 'partially_paid' and fund_id = (select id from app.funds where center_id = :jsh and key = 'construction')
                              and household_id = 'e2700000-0000-4000-8000-000000000001' and pledged_by_person_id = 'e2700000-0000-4000-8000-000000000101'
                              and due_on = '2024-12-31'
                         from app.pledges where crm_external_id = 'qbo:Invoice:9001'),
  'open invoice → open pledge with its $400 balance, on the family''s PRIMARY member, fund from the class');
select pg_temp.assert((select status = 'paid' and paid_cents = 50000 from app.pledges where crm_external_id = 'qbo:Invoice:9002'),
  'a paid invoice → a paid pledge with its payment allocated');
select pg_temp.assert((select bool_and(is_historical and provider = 'quickbooks' and payer_person_id = 'e2700000-0000-4000-8000-000000000101' and status = 'settled')
                              and count(*) = 3
                         from app.payments where crm_external_id in ('qbo:Payment:9101','qbo:Payment:9102','qbo:SalesReceipt:9201')),
  'payments and sales receipts → historical payments from the primary member');
select pg_temp.assert((select method = 'check' and check_number = '887' and memo like '%sales receipt #1001%Fund: General%' from app.payments where crm_external_id = 'qbo:SalesReceipt:9201'),
  'the method, check number and fund are kept');
select pg_temp.assert((select memo ilike '%Fund: %construction%' from app.payments where crm_external_id = 'qbo:Payment:9101'),
  'a payment takes the fund of the invoice it paid');
select pg_temp.assert((select cc_status = 'brought_in' and cc_detail like '%"Jeevdaya" is not linked to a fund%' from app.qbo_transactions where qbo_id = '9201'),
  'an unmapped class goes to the general fund, with a note');
select pg_temp.assert((select a.amount_cents = 60000 from app.payment_allocations a join app.payments p on p.id = a.payment_id
                         join app.pledges pl on pl.id = a.pledge_id where p.crm_external_id = 'qbo:Payment:9101' and pl.crm_external_id = 'qbo:Invoice:9001'),
  'the payment is allocated to the invoice exactly as QuickBooks applied it');
select pg_temp.assert((select cc_status = 'needs_review' and cc_detail like 'Refunds from QuickBooks need an owner decision%' from app.qbo_transactions where qbo_id = '9301'),
  'a credit memo waits: refunds from QuickBooks need an owner decision');
select pg_temp.assert((select cc_status = 'needs_review' and cc_detail like '%$300.00 paid on invoice INV-9003%$0.00%' from app.qbo_transactions where qbo_id = '9003'),
  'a paid invoice whose payments were not pulled waits instead of showing a wrong balance');
select pg_temp.assert(not exists (select 1 from app.ledger_postings l join app.payments p on p.id = l.source_id where p.provider = 'quickbooks'),
  'none of it is queued for posting to QuickBooks');
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
select pg_temp.assert((select open_pledge_cents = 40000 and last_gift_on = '2024-04-01' from app.household_card('e2700000-0000-4000-8000-000000000001')),
  'the household''s giving summary shows the open $400 and the last gift');
select pg_temp.assert((select count(*) = 3 and sum(amount_cents) = 135100 from app.payments where household_id = 'e2700000-0000-4000-8000-000000000001'),
  'the treasurer sees the brought-in payments on the household');
commit;
select pg_temp.assert((select payer_person_id = 'e2700000-0000-4000-8000-000000000103' from app.payments where crm_external_id = 'qbo:SalesReceipt:9202'),
  'a person-level match records that person as payer');
select pg_temp.assert((select v::jsonb->>'status' = 'needs_primary' from ctx where k = 'b506')
                      and (select cc_status = 'needs_review' and cc_detail like 'Choose the primary member of Joshi family%' from app.qbo_transactions where qbo_id = '9203'),
  'a family without a primary member: the match stays approved, the history waits with "Choose the primary member"');
select pg_temp.assert((select count(*) from app.audit_log where action = 'payments.insert' and module = 'giving' and client_app = 'job'
                         and reason like 'QuickBooks history · Kothari Family → Kothari family · match approved by Tara Treasurer: Checked against%') = 3,
  'every record brought in is audited with the match it came from');

-- Idempotent: running it again adds nothing.
begin;
set local role connect_worker;
insert into ctx select 'b501b', app.qbo_worker_bring_in(:jsh, '501')::text;
commit;
select pg_temp.assert((select (v::jsonb->>'brought_in')::int = 0 from ctx where k = 'b501b')
                      and (select count(*) from app.payments where crm_external_id like 'qbo:%:9%') = 4,
  'running the bring-in again duplicates nothing');

-- Choose the primary member, try again.
update app.household_members set is_primary = true where person_id = 'e2700000-0000-4000-8000-000000000106';
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
select pg_temp.assert(app.qbo_retry_bring_in(:jsh, '506') = 1, 'Try again queues the waiting customer');
commit;
begin;
set local role connect_worker;
select app.qbo_worker_bring_in(:jsh, '506');
commit;
select pg_temp.assert((select payer_person_id = 'e2700000-0000-4000-8000-000000000106' from app.payments where crm_external_id = 'qbo:SalesReceipt:9203'),
  'once a primary member is chosen, the family-level history comes in on them');

-- ── Remap, unmap, create a household ────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
insert into ctx select 'remap', app.map_qbo_customer(:jsh, '502', 'e2700000-0000-4000-8000-000000000001', null, 'Amit''s gifts were for his sister''s family')::text;
select pg_temp.assert_raises($$select app.unmap_qbo_customer('00000000-0000-4000-8000-000000000001', '501', 'wrong')$$,
  'owner decision', 'undoing a mapping whose history is on the household is blocked (deleting data is an owner decision)');
select pg_temp.assert_raises($$select app.create_household_from_qbo('00000000-0000-4000-8000-000000000001', '504', 'new donor')$$,
  'no first and last name', 'a company cannot become a person');
insert into ctx select 'new_hh', app.create_household_from_qbo(:jsh, '507', 'New donor found in QuickBooks')::text;
commit;
select pg_temp.assert((select (v::jsonb->>'remapped')::boolean and (v::jsonb->>'records_moved')::int = 1 from ctx where k = 'remap')
                      and (select household_id = 'e2700000-0000-4000-8000-000000000001' and payer_person_id = 'e2700000-0000-4000-8000-000000000101'
                             from app.payments where crm_external_id = 'qbo:SalesReceipt:9202'),
  'remapping moves the records brought in to the new household and its primary member');
select pg_temp.assert((select count(*) = 1 from app.qbo_customer_matches where qbo_customer_id = '502' and status = 'rejected' and reason like 'Remapped: %')
                      and exists (select 1 from app.external_ids where value = '502' and kind = 'accounting' and valid_to is not null
                                    and person_id = 'e2700000-0000-4000-8000-000000000103'),
  'the old match is kept as rejected, and the old identifier is closed, not deleted');
select pg_temp.assert((select h.display_name = 'Mehra family' and p.first_name = 'Sanjay' and p.email = 'sanjay@mehra.test' and hm.is_primary
                              and m.status = 'approved' and m.method = 'manual' and m.person_id is null
                         from app.households h join app.household_members hm on hm.household_id = h.id join app.people p on p.id = hm.person_id
                         join app.qbo_customer_matches m on m.household_id = h.id and m.qbo_customer_id = '507'
                        where h.id = (select v::uuid from ctx where k = 'new_hh')),
  'a household and its primary person are created from the QuickBooks customer, and mapped');
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
select app.unmap_qbo_customer(:jsh, '507', 'Created by mistake');
commit;
select pg_temp.assert((select status = 'rejected' and reason = 'Unmapped: Created by mistake' from app.qbo_customer_matches where qbo_customer_id = '507' and method = 'manual'),
  'a mapping that brought nothing in can be undone');
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
select pg_temp.assert((select (o->>'customers')::int = 7 and (o->>'approved')::int = 3 and (o->>'not_mapped')::int = 4
                              and (o->>'open_unmapped_cents')::int = 0 and (o->>'open_mapped_cents')::int = 40000
                              and (o->'transactions'->>'brought_in')::int = 7
                         from (select app.qbo_match_overview(:jsh) o) x),
  'the overview counts customers, approvals, the not-mapped list and open balances');
commit;

-- ── Module switch ────────────────────────────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000011','role','authenticated','aal','aal2','amr',json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text, true);
select app.set_module_enabled(:jsh, 'accounting', false, 'qbo match test');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000003','role','authenticated')::text, true);
select pg_temp.assert((select count(*) from app.qbo_customers) = 0, 'Accounting switched off: the copies are hidden');
select pg_temp.assert_raises($$select app.qbo_suggest_matches('00000000-0000-4000-8000-000000000001')$$, 'switched off',
  'Accounting switched off: matching refuses');
commit;
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','10000000-0000-4000-8000-000000000011','role','authenticated','aal','aal2','amr',json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text, true);
select app.set_module_enabled(:jsh, 'accounting', true, 'qbo match test done');
commit;

-- Clean up the queued jobs so later tests start from an empty queue.
update app.jobs set status = 'cancelled' where center_id = :jsh and kind like 'qbo.%' and status in ('queued','running');
