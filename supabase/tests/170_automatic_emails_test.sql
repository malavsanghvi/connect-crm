-- 0770: automatic emails with mail merge.
--   A. Receipts and registration confirmations are off until switched on (a payment and a registration queue nothing); the pledge
--      confirmation is on by default (0790: every community has its row, switched on), so a pledge queues its confirmation; the
--      standard wording is there.
--   B. Who may read, switch and word each email; another community refused; no 2FA step anywhere.
--   C. Receipts need the treasurer's current approval; saving receipt wording asks for it again (the evidence), a community
--      without its own wording keeps exactly the evidence it had.
--   D. The triggers: one compose job per payment that went through; none for imported history, CRM imports, a transaction
--      marked as an upload; uploaded donations only through the hook and only with "uploaded donations too" on.
--   E. The background service: adults only (a child payer's name hidden, a child never a recipient), the lead person else the
--      household's adults with an email, once per record and address, the reason written when nothing is sent, the switch
--      read again at send time, purpose and topic per email.
--   F. Pledges (system-made ones left out) and registrations (past events, guests).
--   G. Wording: unknown placeholders refused, a new version per save; a test to yourself; the log.
--   H. A sandbox reaches only verified test recipients; a non-faith community works the same way.
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
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.jobs(p_ref uuid) returns bigint language sql as $$
  select count(*) from app.jobs where kind = 'messaging.compose' and payload->>'ref_id' = p_ref::text
$$;

\set jc '''17000000-0000-4000-8000-0000000000c1'''
\set np '''17000000-0000-4000-8000-0000000000c2'''
\set sb '''17000000-0000-4000-8000-0000000000c3'''
\set treas '''17000000-0000-4000-8000-000000000001'''
\set admin '''17000000-0000-4000-8000-000000000002'''
\set exec '''17000000-0000-4000-8000-000000000003'''
\set vol '''17000000-0000-4000-8000-000000000004'''
\set nptreas '''17000000-0000-4000-8000-000000000005'''
\set sbtreas '''17000000-0000-4000-8000-000000000006'''
\set owner '''17000000-0000-4000-8000-000000000007'''
\set cofficer '''17000000-0000-4000-8000-000000000008'''
\set evlead '''17000000-0000-4000-8000-000000000009'''
\set h5 '''17000000-0000-4000-8000-0000000000a5'''
\set ann '''17000000-0000-4000-8000-0000000000c5'''
\set dee '''17000000-0000-4000-8000-0000000000c6'''
\set dan '''17000000-0000-4000-8000-0000000000c7'''
\set mo '''17000000-0000-4000-8000-0000000000c8'''
\set h1 '''17000000-0000-4000-8000-0000000000a1'''
\set h2 '''17000000-0000-4000-8000-0000000000a2'''
\set hn '''17000000-0000-4000-8000-0000000000a3'''
\set hs '''17000000-0000-4000-8000-0000000000a4'''
\set mira '''17000000-0000-4000-8000-0000000000b1'''
\set kiran '''17000000-0000-4000-8000-0000000000b2'''
\set ravi '''17000000-0000-4000-8000-0000000000b3'''
\set asha '''17000000-0000-4000-8000-0000000000b4'''
\set pat '''17000000-0000-4000-8000-0000000000b5'''
\set sam '''17000000-0000-4000-8000-0000000000b6'''
\set ev1 '''17000000-0000-4000-8000-0000000000e1'''
\set ev2 '''17000000-0000-4000-8000-0000000000e2'''

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:treas, 'treasurer170@temple.test'), (:admin, 'admin170@temple.test'), (:exec, 'committee170@temple.test'),
  (:vol, 'volunteer170@temple.test'), (:nptreas, 'treasurer170@nonprofit.test'), (:sbtreas, 'treasurer170@sandbox.test'),
  (:owner, 'owner170@temple.test'), (:cofficer, 'comms170@temple.test'), (:evlead, 'events170@temple.test');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:jc, 'jc170', 'Temple 170', 'T170', 'TX', 'active', 'America/Chicago');
-- A live non-faith community: its category is switched on for this test only (the transaction is rolled back).
update app.organization_categories set active = true where key = 'chamber_of_commerce';
insert into app.centers (id, slug, name, category_key, status, time_zone, currency, country, environment) values
  (:np, 'np170', 'Chamber 170', 'chamber_of_commerce', 'active', 'Asia/Kolkata', 'INR', 'IN', 'production');
insert into app.centers (id, slug, name, environment, category_key, status) values
  (:sb, 'sb170-sandbox', 'Sandbox 170', 'sandbox', 'nonprofit_secular', 'onboarding');
-- The first center admin becomes the owner (0151), who holds every permission; the second is an ordinary center admin.
insert into app.role_grants (center_id, user_id, role_key, reason) values (:jc, :owner, 'center_admin', 'test 170');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:jc, :treas, 'treasurer', 'test 170'), (:jc, :admin, 'center_admin', 'test 170'), (:jc, :exec, 'executive_committee', 'test 170'),
  (:jc, :vol, 'finance_volunteer', 'test 170'), (:np, :nptreas, 'treasurer', 'test 170'), (:sb, :sbtreas, 'treasurer', 'test 170'),
  (:jc, :cofficer, 'communications_officer', 'test 170'), (:jc, :evlead, 'event_lead', 'test 170');
insert into app.households (id, center_id, display_name) values
  (:h1, :jc, 'Member170, Mira & Kiran'), (:h2, :jc, 'Second170, Ravi & Asha'), (:hn, :np, 'Nonprofit170, Pat'), (:hs, :sb, 'Sandbox170, Sam');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:mira, :jc, 'Mira', 'Member170', date '1980-01-01', 'Mira170@Temple.test'),
  (:kiran, :jc, 'Kiran', 'Member170', (current_date - interval '10 years')::date, 'kiran170@temple.test'),
  (:ravi, :jc, 'Ravi', 'Second170', date '1975-03-03', null),
  (:asha, :jc, 'Asha', 'Second170', date '1977-04-04', 'asha170@temple.test'),
  (:pat, :np, 'Pat', 'Nonprofit170', date '1970-02-02', 'pat170@nonprofit.test'),
  (:sam, :sb, 'Sam', 'Sandbox170', date '1972-02-02', 'sam170@sandbox.test');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :mira, :jc, 'primary', true), (:h1, :kiran, :jc, 'child', false),
  (:h2, :ravi, :jc, 'primary', true), (:h2, :asha, :jc, 'spouse', false),
  (:hn, :pat, :np, 'primary', true), (:hs, :sam, :sb, 'primary', true);
insert into app.events (id, center_id, name, venue, starts_at, status) values
  (:ev1, :jc, 'Autumn Gathering 170', 'Main Hall', now() + interval '7 days', 'published'),
  (:ev2, :jc, 'Past Gathering 170', 'Main Hall', now() - interval '2 days', 'published');

-- ══ A. Off until switched on ═════════════════════════════════════════════════
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000101', :jc, :h1, :mira, 2500, 'check', 'captured', 'offline', 'R-170-0101');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, source)
values ('17000000-0000-4000-8000-000000000201', :jc, :h1, :mira, 10000, 'general');
insert into app.rsvps (id, center_id, event_id, household_id, submitted_by_person_id, status, source)
values ('17000000-0000-4000-8000-000000000301', :jc, :ev1, :h1, :mira, 'rsvpd', 'app');
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000101') + pg_temp.jobs('17000000-0000-4000-8000-000000000301') = 0
                      and pg_temp.jobs('17000000-0000-4000-8000-000000000201') = 1
                      and (select array_agg(trigger_key::text) = array['pledge_recorded'] and bool_and(enabled)
                             from app.email_automations where center_id = :jc),
  'A · a payment and a registration queue no email while their switch is off; a pledge queues its confirmation, which is on by default (the community''s own row, made when the community was)');
select pg_temp.assert((select count(distinct key) from app.message_templates where center_id is null and channel = 'email' and language = 'en'
                         and key in ('payment_receipt', 'pledge_recorded', 'registration_confirmed')) = 3
                      and (select body from app.message_templates where center_id is null and key = 'pledge_recorded' and channel = 'email'
                            and language = 'en' order by version desc limit 1) like '%attached as a PDF%'
                      and (select body from app.message_templates where center_id is null and key = 'payment_receipt' and channel = 'email')
                          like '%{{payment_amount}}%'
                      and (select max(version) from app.message_templates where center_id is null and key = 'receipt' and channel = 'email') = 1,
  'A · the standard wording of the three emails is on file under their own keys; the older "receipt" template is untouched');

set role authenticated;
select pg_temp.claims(:exec);
select pg_temp.assert((select count(*) = 3 and bool_and((e->>'enabled')::boolean = (e->>'key' = 'pledge_recorded'))
                         from jsonb_array_elements(app.email_automations_state(:jc, 18)->'emails') e),
  'A · Settings › Automatic emails lists the three emails: receipts and registrations off, the pledge confirmation on by default');

-- ══ B. Who may do what ═══════════════════════════════════════════════════════
select pg_temp.assert((select (e->>'can_view')::boolean and not (e->>'can_edit')::boolean
                         from jsonb_array_elements(app.email_automations_state(:jc, 18)->'emails') e where e->>'key' = 'payment_receipt'),
  'B · a committee member who reads Giving sees the receipt email but cannot change it');
select pg_temp.assert_raises(format($$select app.set_email_automation(%L, 'payment_receipt', true)$$, :jc), 'needs giving.manage',
  'B · and cannot switch it');
select pg_temp.assert_raises(format($$select app.save_email_automation_wording(%L, 'payment_receipt', 'en', 'Hi', 'Body')$$, :jc), 'needs giving.manage',
  'B · or word it');
select pg_temp.claims(:vol);
select pg_temp.assert_raises(format($$select app.email_automations_state(%L, 18)$$, :jc), 'don''t have access',
  'B · a finance volunteer (no giving.view) has no access to the page');
select pg_temp.claims(:nptreas);
select pg_temp.assert_raises(format($$select app.email_automations_state(%L, 18)$$, :jc), 'don''t have access',
  'B · a treasurer of another community has no access');
select pg_temp.assert_raises(format($$select app.set_email_automation(%L, 'payment_receipt', true)$$, :jc), 'needs giving.manage',
  'B · and cannot switch this community''s receipts');
select pg_temp.claims(:admin);
select pg_temp.assert_raises(format($$select app.set_email_automation(%L, 'payment_receipt', true)$$, :jc), 'needs giving.manage',
  'B · a center admin (giving.view, not giving.manage) cannot switch receipts');
select app.set_email_automation(:jc, 'registration_confirmed', true);
select pg_temp.assert((select (e->>'enabled')::boolean from jsonb_array_elements(app.email_automations_state(:jc, 18)->'emails') e
                         where e->>'key' = 'registration_confirmed'),
  'B · a center admin (events.manage) switches the registration email on with a sign-in session only: no 2FA step');
select pg_temp.assert_raises(format($$select app.set_email_automation(%L, 'registration_confirmed', true, true)$$, :jc), 'only receipts',
  'B · the uploaded-donations choice belongs to receipts only');

-- ══ C. The treasurer's approval ══════════════════════════════════════════════
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.set_email_automation(%L, 'payment_receipt', true)$$, :jc), 'treasurer''s approval',
  'C · receipts cannot be switched on before the treasurer approves the receipt templates');
select app.approve_statement_templates(:jc, 'Approved in test 170');
select app.set_email_automation(:jc, 'payment_receipt', true);
select app.set_email_automation(:jc, 'pledge_recorded', true);
select pg_temp.assert((select count(*) filter (where (e->>'enabled')::boolean) = 3
                                 and bool_and(e->'options' = '{}'::jsonb or e->>'key' <> 'payment_receipt')
                            from jsonb_array_elements(app.email_automations_state(:jc, 18)->'emails') e),
  'C · after the approval the treasurer switches receipts and pledge confirmations on; uploaded donations stay off');
reset role;
select pg_temp.assert(app.statement_templates_evidence(:np) ? 'templates' and not (app.statement_templates_evidence(:np) ? 'emails')
                      and not (app.statement_templates_evidence(:jc) ? 'emails'),
  'C · a community without its own email wording has the same evidence as before (no "emails"), so its approval stays current');
select pg_temp.assert((select count(*) from app.audit_log where center_id = :jc and action like 'email_automations.%') >= 3,
  'C · each switch is in the audit log');

-- ══ D. The triggers ═════════════════════════════════════════════════════════
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000102', :jc, :h1, :mira, 5000, 'check', 'captured', 'offline', 'R-170-0102');
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000102') = 1,
  'D · a payment recorded while receipts are on queues one compose job');
update app.payments set status = 'settled' where id = '17000000-0000-4000-8000-000000000102';
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000102') = 1,
  'D · settling it later queues nothing more');
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000103', :jc, :h1, :mira, 7000, 'card', 'authorized', 'stripe', 'R-170-0103');
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000103') = 0, 'D · an authorized card payment is not receipted yet');
update app.payments set status = 'captured' where id = '17000000-0000-4000-8000-000000000103';
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000103') = 1, 'D · it is when it goes through');
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number, is_historical)
values ('17000000-0000-4000-8000-000000000104', :jc, :h1, :mira, 900, 'check', 'settled', 'import', 'R-170-0104', true);
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number, crm_external_id)
values ('17000000-0000-4000-8000-000000000105', :jc, :h1, :mira, 900, 'check', 'settled', 'import', 'R-170-0105', 'CRM-170-1');
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000104') + pg_temp.jobs('17000000-0000-4000-8000-000000000105') = 0,
  'D · imported history and CRM imports get no receipt email');
savepoint import_tool;
-- The import tool (0192, 0413) marks its writes; a pledge it brings in has no CRM id and may be open.
select set_config('app.client_app', 'import', true);
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000113', :jc, :h1, :mira, 1300, 'check', 'settled', 'offline', 'R-170-0113');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, source)
values ('17000000-0000-4000-8000-000000000211', :jc, :h1, :mira, 8000, 'general');
insert into app.rsvps (id, center_id, event_id, household_id, submitted_by_person_id, status, source)
values ('17000000-0000-4000-8000-000000000311', :jc, :ev1, :h1, :mira, 'rsvpd', 'app');
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000113') + pg_temp.jobs('17000000-0000-4000-8000-000000000211')
                      + pg_temp.jobs('17000000-0000-4000-8000-000000000311') = 0,
  'D · what the import tool writes (a payment, an open pledge, a registration) gets no automatic email');
rollback to savepoint import_tool;
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, paid_cents, source, status)
values ('17000000-0000-4000-8000-000000000212', :jc, :h1, :mira, 8000, 8000, 'general', 'paid');
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000212') = 0,
  'D · a pledge recorded as already paid is history, not a new promise: no confirmation');
savepoint upload;
select app.mark_donation_upload();
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000106', :jc, :h1, :mira, 1200, 'check', 'captured', 'offline', 'R-170-0106');
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000106') = 0,
  'D · a payment inserted in a transaction marked as a donation upload queues nothing by itself');
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert(app.email_receipts_for_uploaded(:jc, array['17000000-0000-4000-8000-000000000106']::uuid[]) @> '{"queued": 0}'
                      and app.email_receipts_for_uploaded(:jc, array['17000000-0000-4000-8000-000000000106']::uuid[])->>'reason' like '%uploaded donations are switched off%',
  'D · the upload hook queues nothing while "uploaded donations too" is off (the default)');
select app.set_email_automation(:jc, 'payment_receipt', true, true);
select pg_temp.assert(app.email_receipts_for_uploaded(:jc, array['17000000-0000-4000-8000-000000000106', '17000000-0000-4000-8000-000000000104',
                                                             '17000000-0000-4000-8000-0000000009ff', '17000000-0000-4000-8000-000000000102']::uuid[])
                        @> '{"queued": 1, "skipped": 3}',
  'D · with it on, the hook queues the uploaded payment only: not imported history, an unknown id, or a payment no upload made');
select pg_temp.claims(:exec);
select pg_temp.assert_raises(format($$select app.email_receipts_for_uploaded(%L, array[]::uuid[])$$, :jc), 'need giving.manage',
  'D · the hook needs giving.manage');
reset role;
select pg_temp.assert(exists (select 1 from app.email_upload_marks where payment_id = '17000000-0000-4000-8000-000000000106')
                      and not exists (select 1 from app.email_upload_marks where payment_id = '17000000-0000-4000-8000-000000000102'),
  'D · the upload''s payment is remembered for the hook; a payment recorded by hand is not');
update app.email_upload_marks set created_at = now() - interval '25 hours' where payment_id = '17000000-0000-4000-8000-000000000106';
delete from app.email_automation_sends where ref_id = '17000000-0000-4000-8000-000000000106';
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert(app.email_receipts_for_uploaded(:jc, array['17000000-0000-4000-8000-000000000106']::uuid[]) @> '{"queued": 0, "skipped": 1}',
  'D · after 24 hours the hook no longer sends receipts for that upload');
reset role;
rollback to savepoint upload;
select pg_temp.assert(coalesce(current_setting('app.donation_upload', true), '') <> 'on', 'D · the upload mark ends with its transaction');

-- ══ E. The background service ═══════════════════════════════════════════════
select id as auto_pay from app.email_automations where center_id = :jc and trigger_key = 'payment_receipt' \gset
select id as auto_pledge from app.email_automations where center_id = :jc and trigger_key = 'pledge_recorded' \gset
select id as auto_reg from app.email_automations where center_id = :jc and trigger_key = 'registration_confirmed' \gset
select jsonb_object_agg(n, 'v-' || n)::text as vars_pay from unnest(app._email_placeholders('payment_receipt')) n \gset
select jsonb_object_agg(n, 'v-' || n)::text as vars_pledge from unnest(app._email_placeholders('pledge_recorded')) n \gset
select jsonb_object_agg(n, 'v-' || n)::text as vars_reg from unnest(app._email_placeholders('registration_confirmed')) n \gset

-- A payment made by the child: her name is not on the receipt, and the email goes to the household's adult, never to her.
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number, receipt_name)
values ('17000000-0000-4000-8000-000000000107', :jc, :h1, :kiran, 300, 'cash', 'captured', 'offline', 'R-170-0107', 'Kiran Member170');
-- A payment by an adult with no email: the other adult gets it.
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000108', :jc, :h2, :ravi, 4000, 'check', 'captured', 'offline', 'R-170-0108');

set role connect_worker;
select app.worker_email_facts(:'auto_pay', '17000000-0000-4000-8000-000000000102', 18) as f102 \gset
select app.worker_email_facts(:'auto_pay', '17000000-0000-4000-8000-000000000107', 18) as f107 \gset
select app.worker_email_facts(:'auto_pay', '17000000-0000-4000-8000-000000000108', 18) as f108 \gset
select app.worker_email_enqueue(:'auto_pay', '17000000-0000-4000-8000-000000000102', '', :h1, :mira, 'mira170@temple.test', :'vars_pay'::jsonb) as q1 \gset
select app.worker_email_enqueue(:'auto_pay', '17000000-0000-4000-8000-000000000102', '', :h1, :mira, 'MIRA170@temple.test', :'vars_pay'::jsonb) as q2 \gset
select app.worker_email_enqueue(:'auto_pay', '17000000-0000-4000-8000-000000000108', '', :h2, :asha, 'asha170@temple.test', '{"center_name": "only one"}') as q3 \gset
reset role;
select pg_temp.assert(:'f102'::jsonb->>'skip' is null
                      and :'f102'::jsonb->'recipients' = jsonb_build_array(jsonb_build_object('person_id', :mira, 'address', 'mira170@temple.test',
                            'first_name', 'Mira', 'name', 'Mira Member170', 'language', 'en'))
                      and :'f102'::jsonb #>> '{payment,amount_cents}' = '5000' and :'f102'::jsonb #>> '{payment,receipt_number}' = 'R-170-0102'
                      and :'f102'::jsonb #> '{household,minor_first_names}' = '["Kiran"]'
                      and :'f102'::jsonb #>> '{center,currency}' = 'USD' and :'f102'::jsonb #>> '{center,time_zone}' = 'America/Chicago',
  'E · the facts: the adult who paid (her address in lower case), the amount in cents, the receipt number, the child''s first name to keep out, the community''s currency and time zone');
select pg_temp.assert(:'f107'::jsonb #>> '{payment,receipt_name}' is null
                      and (select array_agg(r->>'address') from jsonb_array_elements(:'f107'::jsonb->'recipients') r) = array['mira170@temple.test'],
  'E · a child who paid: no name on the receipt, and the email goes to the household''s adult only, never to the child''s address');
select pg_temp.assert((select array_agg(r->>'address') from jsonb_array_elements(:'f108'::jsonb->'recipients') r) = array['asha170@temple.test'],
  'E · an adult payer with no email: the household''s other adult gets it');
select pg_temp.assert(:'q1'::jsonb->>'outcome' = 'queued' and :'q2'::jsonb->>'outcome' = 'duplicate',
  'E · queued once; the same record and address again (any case) is a duplicate');
select pg_temp.assert((select count(*) = 1 and bool_and(m.purpose = 'receipt' and m.template_key = 'payment_receipt' and m.status = 'queued'
                                                        and m.subject = 'Receipt v-payment_receipt_number from v-center_name'
                                                        and m.person_id = :mira and m.topic_key is null and m.created_by is null)
                         from app.messages m where m.to_address = 'mira170@temple.test' and m.template_key = 'payment_receipt'),
  'E · one message: purpose receipt (no unsubscribe link, the receipts sender), the wording filled with the values, tied to the person');
select pg_temp.assert(:'q3'::jsonb->>'outcome' = 'skipped' and :'q3'::jsonb->>'reason' like 'Not sent:%needs a value%'
                      and exists (select 1 from app.email_automation_sends s where s.ref_id = '17000000-0000-4000-8000-000000000108'
                                    and s.outcome = 'skipped' and s.to_address = 'asha170@temple.test'),
  'E · values the wording needs but were not given: not sent, and the reason is in the log');

-- A household whose other adults died, moved out or were merged into another record: only the adult still there gets it.
insert into app.households (id, center_id, display_name) values (:h5, :jc, 'Fifth170 household');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email, is_deceased) values
  (:ann, :jc, 'Ann', 'Fifth170', date '1960-01-01', 'ann170@temple.test', false),
  (:dee, :jc, 'Dee', 'Fifth170', date '1958-01-01', 'dee170@temple.test', true),
  (:dan, :jc, 'Dan', 'Fifth170', date '1959-01-01', 'dan170@temple.test', false);
-- Mo's record was merged into Ann's (written as the merge leaves it).
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email, merged_into_id) values
  (:mo, :jc, 'Mo', 'Fifth170', date '1961-01-01', 'mo170@temple.test', :ann);
insert into app.household_members (household_id, person_id, center_id, role, is_primary, left_at) values
  (:h5, :ann, :jc, 'spouse', false, null), (:h5, :dee, :jc, 'primary', true, null),
  (:h5, :dan, :jc, 'parent', false, current_date - 30), (:h5, :mo, :jc, 'parent', false, null);
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000114', :jc, :h5, :dee, 6000, 'check', 'captured', 'offline', 'R-170-0114');
set role connect_worker;
select app.worker_email_facts(:'auto_pay', '17000000-0000-4000-8000-000000000114', 18) as f114 \gset
reset role;
select pg_temp.assert((select array_agg(r->>'address') from jsonb_array_elements(:'f114'::jsonb->'recipients') r) = array['ann170@temple.test'],
  'E · a payment in the name of someone who has died goes to the household''s living adult; nobody who moved out or was merged gets it');

-- Nobody with an email: the reason is written once.
update app.people set email = null where id = :asha;
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000109', :jc, :h2, :ravi, 4100, 'check', 'captured', 'offline', 'R-170-0109');
set role connect_worker;
select app.worker_email_facts(:'auto_pay', '17000000-0000-4000-8000-000000000109', 18) as f109 \gset
select app.worker_email_facts(:'auto_pay', '17000000-0000-4000-8000-000000000109', 18) as f109b \gset
reset role;
select pg_temp.assert(:'f109'::jsonb->>'skip' = 'Not sent: no adult of the household has an email address on file.'
                      and (select count(*) from app.email_automation_sends where ref_id = '17000000-0000-4000-8000-000000000109'
                             and outcome = 'skipped' and to_address = '') = 1,
  'E · no adult with an email: not sent, the reason written once');

-- Switched off after the job was queued: read again when the service runs.
set role authenticated;
select pg_temp.claims(:treas);
select app.set_email_automation(:jc, 'payment_receipt', false);
reset role;
set role connect_worker;
select app.worker_email_facts(:'auto_pay', '17000000-0000-4000-8000-000000000103', 18) as f103 \gset
reset role;
select pg_temp.assert(:'f103'::jsonb->>'skip' = 'Not sent: the email was switched off before it went.',
  'E · an email switched off before the service ran is not sent, and says so');
select pg_temp.assert_raises($$select app.worker_email_facts('17000000-0000-4000-8000-000000000000', '17000000-0000-4000-8000-000000000000', 18)$$,
  'Only the background service', 'E · only the background service reads the facts');
set role authenticated;
select pg_temp.claims(:treas);
select app.set_email_automation(:jc, 'payment_receipt', true);
reset role;

-- ══ F. Pledges and registrations ═════════════════════════════════════════════
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, paid_cents, source, due_on)
values ('17000000-0000-4000-8000-000000000202', :jc, :h1, :mira, 50000, 10000, 'general', current_date + 30),
       ('17000000-0000-4000-8000-000000000203', :jc, :h1, :mira, 5000, 0, 'pathshala_fee', null),
       ('17000000-0000-4000-8000-000000000204', :jc, :h1, :mira, 6000, 0, 'recurring', null);
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, source, crm_external_id)
values ('17000000-0000-4000-8000-000000000205', :jc, :h1, :mira, 7000, 'general', 'CRM-170-P');
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000202') = 1
                      and pg_temp.jobs('17000000-0000-4000-8000-000000000203') + pg_temp.jobs('17000000-0000-4000-8000-000000000204')
                          + pg_temp.jobs('17000000-0000-4000-8000-000000000205') = 0,
  'F · a pledge queues its confirmation; a fee, a recurring cycle and an imported pledge do not');
insert into app.rsvps (id, center_id, event_id, household_id, submitted_by_person_id, status, source)
values ('17000000-0000-4000-8000-000000000302', :jc, :ev1, :h1, :mira, 'rsvpd', 'app'),
       ('17000000-0000-4000-8000-000000000303', :jc, :ev2, :h1, :mira, 'rsvpd', 'admin'),
       ('17000000-0000-4000-8000-000000000304', :jc, :ev1, :h1, :mira, 'rsvpd', 'import');
insert into app.rsvps (id, center_id, event_id, guest_name, guest_email, status, source)
values ('17000000-0000-4000-8000-000000000305', :jc, :ev1, 'Gita Guest170', 'gita170@guest.test', 'rsvpd', 'admin');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name) values
  (:jc, :ev1, '17000000-0000-4000-8000-000000000302', :mira, 'Mira Member170'),
  (:jc, :ev1, '17000000-0000-4000-8000-000000000302', :kiran, 'Kiran Member170');
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000302') = 1 and pg_temp.jobs('17000000-0000-4000-8000-000000000305') = 1
                      and pg_temp.jobs('17000000-0000-4000-8000-000000000304') = 0,
  'F · a registration and a guest registration queue their confirmation; an imported one does not');
update app.rsvps set status = 'confirmed' where id = '17000000-0000-4000-8000-000000000302';
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000302') = 1, 'F · confirming it later queues nothing more');

set role connect_worker;
select app.worker_email_facts(:'auto_pledge', '17000000-0000-4000-8000-000000000202', 18) as f202 \gset
select app.worker_email_facts(:'auto_reg', '17000000-0000-4000-8000-000000000302', 18) as f302 \gset
select app.worker_email_facts(:'auto_reg', '17000000-0000-4000-8000-000000000303', 18) as f303 \gset
select app.worker_email_facts(:'auto_reg', '17000000-0000-4000-8000-000000000305', 18) as f305 \gset
select app.worker_email_enqueue(:'auto_reg', '17000000-0000-4000-8000-000000000302', '', :h1, :mira, 'mira170@temple.test', :'vars_reg'::jsonb) as q4 \gset
select app.worker_email_enqueue(:'auto_pledge', '17000000-0000-4000-8000-000000000202', '', :h1, :mira, 'mira170@temple.test', :'vars_pledge'::jsonb) as q5 \gset
reset role;
select pg_temp.assert(:'f202'::jsonb #>> '{pledge,amount_cents}' = '50000' and :'f202'::jsonb #>> '{pledge,paid_cents}' = '10000'
                      and :'f202'::jsonb #>> '{pledge,due_on}' = (current_date + 30)::text and :'f202'::jsonb->>'skip' is null,
  'F · pledge facts: amount, paid, due date');
select pg_temp.assert(:'f302'::jsonb #>> '{registration,count}' = '2' and :'f302'::jsonb #>> '{event,name}' = 'Autumn Gathering 170'
                      and (select array_agg(r->>'address') from jsonb_array_elements(:'f302'::jsonb->'recipients') r) = array['mira170@temple.test'],
  'F · registration facts: the event, how many are registered (a number, no attendee names), the adult who registered');
select pg_temp.assert(:'f303'::jsonb->>'skip' = 'Not sent: the event had already started.',
  'F · a registration for an event that already started is not confirmed');
select pg_temp.assert((select array_agg(r->>'address') from jsonb_array_elements(:'f305'::jsonb->'recipients') r) = array['gita170@guest.test']
                      and :'f305'::jsonb->'household' is null,
  'F · a guest''s confirmation goes to the email the guest gave');
select pg_temp.assert(:'q4'::jsonb->>'outcome' = 'queued' and :'q5'::jsonb->>'outcome' = 'queued'
                      and (select purpose = 'notification' and topic_key = 'events' from app.messages where id = (:'q4'::jsonb->>'message_id')::uuid)
                      and (select purpose = 'receipt' and topic_key is null from app.messages where id = (:'q5'::jsonb->>'message_id')::uuid),
  'F · a registration goes as an events notification (the member''s switch, the unsubscribe link); a pledge as a receipt');

-- ══ G. Wording, the test, the log ═════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.save_email_automation_wording(%L, 'payment_receipt', 'en', 'Receipt {{pledge_amount}}', 'Hi {{nickname}}')$$, :jc),
  'uses {{nickname}}, {{pledge_amount}}', 'G · a placeholder this email does not have is refused, naming each one');
select pg_temp.assert_raises(format($$select app.save_email_automation_wording(%L, 'payment_receipt', 'en', '', 'Body')$$, :jc),
  'subject', 'G · a subject is needed');
select app.save_email_automation_wording(:jc, 'payment_receipt', 'en', 'Thank you, {{recipient_first_name}}',
         E'We received {{ payment_amount }}.\n\n{{receipt_signed_by}}') as w1 \gset
select app.save_email_automation_wording(:jc, 'payment_receipt', 'en', 'Thank you, {{recipient_first_name}}',
         E'We received {{ payment_amount }}.\n\n{{receipt_signed_by}}') as w2 \gset
select app.save_email_automation_wording(:jc, 'payment_receipt', 'es', 'Gracias, {{recipient_first_name}}', 'Recibimos {{payment_amount}}.') as w3 \gset
select pg_temp.assert(:'w1'::jsonb @> '{"version": 1, "unchanged": false}' and :'w2'::jsonb @> '{"version": 1, "unchanged": true}'
                      and :'w3'::jsonb @> '{"version": 1, "language": "es"}',
  'G · the community''s wording is saved as a version per language; the same text again is not a new version');
reset role;
select pg_temp.assert(app.statement_templates_evidence(:jc) ? 'emails'
                      and not (app.check_statement_templates_approved(:jc)->>'ok')::boolean,
  'G · new receipt wording is in what the treasurer approves, so the approval is "changed" until the treasurer approves again');
set role connect_worker;
select app.worker_email_facts(:'auto_pay', '17000000-0000-4000-8000-000000000108', 18) as f108b \gset
reset role;
select pg_temp.assert(:'f108b'::jsonb->>'skip' like 'Not sent: The templates changed after%',
  'G · and receipts wait for it: the reason is written');
set role authenticated;
select pg_temp.claims(:treas);
select app.approve_statement_templates(:jc, 'New wording approved in test 170') as appr \gset
select pg_temp.assert(:'appr'::jsonb->>'state' = 'current', 'G · the treasurer approves the new wording');
select app.send_email_automation_test(:jc, 'payment_receipt', 'en', :'vars_pay'::jsonb || '{"payment_amount": "$9.99", "evil": "x"}') as test_msg \gset
select pg_temp.assert(jsonb_array_length(app.email_automation_log(:jc, 'payment_receipt', 10)) >= 2
                      and (select bool_or(e->>'outcome' = 'skipped' and e->>'reason' like '%no adult%')
                             from jsonb_array_elements(app.email_automation_log(:jc, 'payment_receipt', 10)) e),
  'G · the log lists what was queued and what was not, with the reason');
select pg_temp.claims(:admin);
select pg_temp.assert_raises(format($$select app.send_email_automation_test(%L, 'payment_receipt', 'en', '{}')$$, :jc), 'needs giving.manage',
  'G · a test of the receipt needs giving.manage');
reset role;
select pg_temp.assert((select m.to_address = 'treasurer170@temple.test' and m.purpose = 'test' and m.subject = 'Thank you, v-recipient_first_name'
                              and m.body like 'We received $9.99.%' and not (m.payload->'vars' ? 'evil')
                         from app.messages m where m.id = :'test_msg'::uuid),
  'G · the test goes to the caller''s own address with the saved wording and only this email''s placeholders');

-- The language: the community's own wording in the recipient's language, else the community's main language.
insert into app.org_profiles (center_id, languages) values (:jc, array['es', 'en'])
on conflict (center_id) do update set languages = excluded.languages;
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000110', :jc, :h1, :mira, 1500, 'check', 'captured', 'offline', 'R-170-0110');
update app.people set language = 'fr' where id = :mira;
set role connect_worker;
select app.worker_email_enqueue(:'auto_pay', '17000000-0000-4000-8000-000000000110', '', :h1, :mira, 'mira170@temple.test', :'vars_pay'::jsonb) as q6 \gset
reset role;
select pg_temp.assert((select subject = 'Gracias, v-recipient_first_name' from app.messages where id = (:'q6'::jsonb->>'message_id')::uuid),
  'G · a recipient whose language has no wording of the community''s own gets the community''s main language (Spanish here)');

-- ══ I. Nobody reads the tables directly ═════════════════════════════════════════
select pg_temp.assert(not has_table_privilege('authenticated', 'app.email_automation_sends', 'select')
                      and not has_table_privilege('authenticated', 'app.email_automations', 'select')
                      and not has_table_privilege('authenticated', 'app.email_upload_marks', 'select'),
  'I · signed-in people have no direct read of the switches, the sends or the upload marks');
set role authenticated;
select pg_temp.claims(:cofficer);
select pg_temp.assert_raises($$select count(*) from app.email_automation_sends$$, 'permission denied',
  'I · a communications officer cannot read the sends (households, addresses)');
select pg_temp.assert_raises($$select count(*) from app.email_automations$$, 'permission denied',
  'I · nor the switches');
select pg_temp.claims(:evlead);
select pg_temp.assert_raises($$select count(*) from app.email_automation_sends$$, 'permission denied',
  'I · nor can an event lead (events.view)');
select pg_temp.claims(:treas);
select pg_temp.assert(jsonb_array_length(app.email_automation_log(:jc, 'payment_receipt', 5)) > 0,
  'I · the treasurer reads the receipts'' log through its function');
reset role;

-- ══ H. A sandbox, and a non-faith community ══════════════════════════════════
set role authenticated;
select pg_temp.claims(:sbtreas);
select app.approve_statement_templates(:sb, 'Sandbox test 170');
select app.set_email_automation(:sb, 'payment_receipt', true);
reset role;
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000111', :sb, :hs, :sam, 1500, 'check', 'captured', 'offline', 'R-170-0111');
select id as auto_sb from app.email_automations where center_id = :sb and trigger_key = 'payment_receipt' \gset
set role connect_worker;
select app.worker_email_enqueue(:'auto_sb', '17000000-0000-4000-8000-000000000111', '', :hs, :sam, 'sam170@sandbox.test', :'vars_pay'::jsonb) as q7 \gset
reset role;
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000111') = 1
                      and :'q7'::jsonb->>'outcome' = 'skipped' and :'q7'::jsonb->>'reason' like '%only to verified test recipients%',
  'H · a sandbox queues the job, and the email to someone who is not a verified test recipient is not sent (and says why)');

set role authenticated;
select pg_temp.claims(:nptreas);
select app.approve_statement_templates(:np, 'Non-profit test 170');
select app.set_email_automation(:np, 'payment_receipt', true);
reset role;
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values ('17000000-0000-4000-8000-000000000112', :np, :hn, :pat, 12500050, 'ach', 'captured', 'offline', 'R-170-0112');
select id as auto_np from app.email_automations where center_id = :np and trigger_key = 'payment_receipt' \gset
set role connect_worker;
select app.worker_email_facts(:'auto_np', '17000000-0000-4000-8000-000000000112', 18) as f112 \gset
select app.worker_email_enqueue(:'auto_np', '17000000-0000-4000-8000-000000000112', '', :hn, :pat, 'pat170@nonprofit.test', :'vars_pay'::jsonb) as q8 \gset
reset role;
select pg_temp.assert(pg_temp.jobs('17000000-0000-4000-8000-000000000112') = 1 and :'f112'::jsonb #>> '{center,currency}' = 'INR'
                      and :'f112'::jsonb #>> '{center,country}' = 'IN' and :'q8'::jsonb->>'outcome' = 'queued',
  'H · a non-faith community (a chamber of commerce) in another country and currency sends its receipts the same way (the service writes rupees)');

rollback;
