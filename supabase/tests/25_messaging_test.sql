-- 0220–0224 (stream o-messaging): the messaging API (enqueue_message), sandbox
-- recipients, suppressions, opt-outs, quiet hours, codes kept out of stored rows,
-- the worker's functions, webhooks, STOP/START/HELP, settings RPCs and their
-- permissions, recipient verification, push devices, branded sign-in context and
-- readiness checks 4 and 5.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text, state text default null) returns void
language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 or (state is not null and sqlstate <> state) then
    raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.jwt.claim.sub', p_user, true);
end $$;

grant connect_worker to postgres;

\set prod '''25000000-0000-4000-8000-0000000000c1'''
\set sbx '''25000000-0000-4000-8000-0000000000c2'''
-- Users: a1 platform admin, a2 admin of prod (settings.manage + integrations.manage),
-- a3 admin of the sandbox, a4 a member of prod with no staff role, a5 its communications officer.
insert into auth.users (id, email, phone, phone_confirmed_at) values
  ('25000000-0000-4000-8000-0000000000a1', 'msg.platform@example.com', null, null),
  ('25000000-0000-4000-8000-0000000000a2', 'msg.admin@example.com', '17135550190', now()),
  ('25000000-0000-4000-8000-0000000000a3', 'msg.sandbox@example.com', null, null),
  ('25000000-0000-4000-8000-0000000000a4', 'msg.member@example.com', null, null),
  ('25000000-0000-4000-8000-0000000000a5', 'msg.comms@example.com', null, null);
insert into app.accounts (user_id, is_platform_admin) values ('25000000-0000-4000-8000-0000000000a1', true);
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:prod, 'msgtest', 'Messaging Test Center', 'MTC', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:sbx, 'msgtest-sandbox', 'Messaging Test Center (sandbox)', 'MTC', 'TX', 'active', 'sandbox');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:prod, '25000000-0000-4000-8000-0000000000a2', 'center_admin', 'center'),
  (:sbx,  '25000000-0000-4000-8000-0000000000a3', 'center_admin', 'center'),
  (:prod, '25000000-0000-4000-8000-0000000000a5', 'communications_officer', 'center');
insert into app.people (id, center_id, first_name, last_name, email, phone_e164) values
  ('25000000-0000-4000-8000-0000000000d1', :prod, 'Mina', 'Member', 'msg.member@example.com', '+17135550191');
insert into app.center_users (center_id, user_id, person_id) values
  (:prod, '25000000-0000-4000-8000-0000000000a4', '25000000-0000-4000-8000-0000000000d1');

-- ── enqueue_message is not an API ───────────────────────────────────────────
begin;
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a2');
set local role authenticated;
select pg_temp.assert_raises($$select app.enqueue_message('25000000-0000-4000-8000-0000000000c1', 'email', 'x@example.com', 'test_message', '{}', 'test')$$,
  'permission denied', 'a signed-in user cannot call enqueue_message directly');
rollback;

-- ── Production: queued, job, code kept out of the row ────────────────────────
select app.enqueue_message(:prod, 'email', 'Someone@Example.com', 'paypal_email_code', '{"code":"482913","minutes":15}', 'verification_code') as m1 \gset
select pg_temp.assert((select status = 'queued' and to_address = 'someone@example.com' and purpose = 'verification_code' and not sandbox
                         from app.messages where id = :'m1'), 'a production email is queued to the normalised address');
select pg_temp.assert((select body not like '%482913%' and body like '%••••••%' and payload::text not like '%482913%'
                         from app.messages where id = :'m1'), 'the code is not in the stored body or payload');
select pg_temp.assert(not exists (select 1 from app.audit_log where record_table = 'messages' and record_id = :'m1' and (after::text like '%482913%')),
  'the code is not in the audit log');
select pg_temp.assert((select kind = 'messaging.send' and center_id = :prod from app.jobs where id = (select job_id from app.messages where id = :'m1')),
  'a messaging.send job is queued for it');
select pg_temp.assert_raises($$select app.enqueue_message('25000000-0000-4000-8000-0000000000c1', 'email', 'x@example.com', 'no_such_template', '{}', 'notification')$$,
  'There is no email template called', 'an unknown template is refused in plain English');
select pg_temp.assert_raises($$select app.enqueue_message('25000000-0000-4000-8000-0000000000c1', 'email', 'x@example.com', 'receipt', '{"name":"A"}', 'receipt')$$,
  'needs a value for', 'a missing template value is refused, not sent blank');
select pg_temp.assert_raises($$select app.enqueue_message('25000000-0000-4000-8000-0000000000c1', 'sms', '12', 'test_message', '{}', 'test')$$,
  'is not a mobile number', 'a bad phone number is refused');

-- Platform-level message (Community Connect's own sender).
select app.enqueue_message(null, 'email', 'new.org@example.org', 'sandbox_code',
  '{"name":"Asha","code":"CC-SBX-7K4M-Q2PD","email":"new.org@example.org","expires_on":"October 8","link":"https://example.test/start"}', 'sandbox_code') as mp \gset
select pg_temp.assert((select center_id is null and status = 'queued' and body not like '%7K4M%' from app.messages where id = :'mp'),
  'a platform-level email (center NULL) is queued, its code masked');

-- ── Sandbox: verified test recipients only, with the banner ─────────────────
select pg_temp.assert_raises($$select app.enqueue_message('25000000-0000-4000-8000-0000000000c2', 'email', 'member@example.com', 'test_message', '{}', 'notification')$$,
  'Sandboxes can send only to verified test recipients', 'a sandbox cannot email an address that is not a test recipient', 'CCENT');
insert into app.sandbox_test_recipients (center_id, channel, address, verified_at) values (:sbx, 'email', 'tester@example.com', now());
select app.enqueue_message(:sbx, 'email', 'tester@example.com', 'test_message', '{}', 'notification') as ms \gset
select pg_temp.assert((select sandbox and subject like '[Sandbox · test data]%' from app.messages where id = :'ms'),
  'a sandbox email to a verified test recipient goes, with the Sandbox subject prefix');
insert into app.sandbox_test_recipients (center_id, channel, address, verified_at) values (:sbx, 'sms', '+17135550100', now());
select app.enqueue_message(:sbx, 'sms', '(713) 555-0100', 'test_message', '{}', 'test') as ms2 \gset
select pg_temp.assert((select body like 'Sandbox · test data:%' and segments >= 1 from app.messages where id = :'ms2'),
  'a sandbox text starts with "Sandbox · test data:" and has a segment count');

-- ── Suppressions and opt-outs ────────────────────────────────────────────────
insert into app.message_suppressions (center_id, channel, address, reason) values (:prod, 'email', 'bounced@example.com', 'bounce');
select app.enqueue_message(:prod, 'email', 'bounced@example.com', 'test_message', '{}', 'notification') as msup \gset
select pg_temp.assert((select status = 'suppressed' and failure_reason like '%bounced%' and job_id is null from app.messages where id = :'msup'),
  'a suppressed address gets a suppressed row and no job');
insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source)
values (:prod, '25000000-0000-4000-8000-0000000000d1', 'email', 'msg.member@example.com', false, 'admin');
select app.enqueue_message(:prod, 'email', 'msg.member@example.com', 'test_message', '{}', 'campaign') as mopt \gset
select pg_temp.assert((select status = 'suppressed' and failure_reason like '%opted out%' from app.messages where id = :'mopt'),
  'an opted-out member gets no campaign');
select app.enqueue_message(:prod, 'email', 'msg.member@example.com', 'receipt',
  '{"name":"Mina","amount":"$10.00","fund":"General","date":"Sep 24","receipt_number":"R-1","tax_note":""}', 'receipt') as mrec \gset
select pg_temp.assert((select status = 'queued' from app.messages where id = :'mrec'), 'an opted-out member still gets a receipt');

-- ── Quiet hours ──────────────────────────────────────────────────────────────
update app.centers set rules = jsonb_set(coalesce(rules, '{}'), '{notifications}',
  jsonb_build_object('quiet_start_hour', extract(hour from now() at time zone 'America/Chicago')::int,
                     'quiet_end_hour', (extract(hour from now() at time zone 'America/Chicago')::int + 2) % 24))
 where id = :prod;
select app.enqueue_message(:prod, 'sms', '+17135550191', 'test_message', '{}', 'notification') as mq \gset
select pg_temp.assert((select scheduled_at > now() + interval '30 minutes' from app.messages where id = :'mq')
                      and (select run_after > now() + interval '30 minutes' from app.jobs where id = (select job_id from app.messages where id = :'mq')),
  'a notification text in quiet hours waits until they end');
select app.enqueue_message(:prod, 'sms', '+17135550191', 'sign_in_code', '{"code":"123456","minutes":10}', 'verification_code') as mq2 \gset
select pg_temp.assert((select scheduled_at <= now() from app.messages where id = :'mq2'), 'a code is not held by quiet hours');
update app.centers set rules = rules - 'notifications' where id = :prod;

-- ── The worker ───────────────────────────────────────────────────────────────
begin;
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a2');
set local role authenticated;
select pg_temp.assert_raises($$select app.worker_message_to_send('00000000-0000-4000-8000-000000000000')$$,
  'permission denied', 'a signed-in user cannot call the worker''s functions');
rollback;
begin;
set local role connect_worker;
select pg_temp.assert((select (app.worker_message_to_send(:'m1')->>'body') like '%482913%'), 'the worker gets the real code at send time');
select app.worker_message_result(:'m1', 'sent', 'resend', 're_123', null, null);
select pg_temp.assert((select app.worker_message_to_send(:'m1')->>'skip') like '%already sent%', 'a sent message is not sent twice');
reset role;
select pg_temp.assert((select decrypted_secret = '{}' from vault.decrypted_secrets where id = (select (payload->>'secret_ref')::uuid from app.messages where id = :'m1')),
  'the code is wiped from the vault once sent');
select pg_temp.assert((select status = 'sent' and provider_ref = 're_123' from app.messages where id = :'m1'), 'the result is recorded');
commit;

-- Bounce webhook → message bounced + suppression; idempotent ingestion.
begin;
set local role connect_worker;
select pg_temp.assert((app.ingest_messaging_webhook('resend', 'evt_1', 'email.bounced', null, '{"type":"email.bounced"}')->>'duplicate')::boolean = false,
  'a webhook event is ingested once');
select pg_temp.assert((app.ingest_messaging_webhook('resend', 'evt_1', 'email.bounced', null, '{"type":"email.bounced"}')->>'duplicate')::boolean,
  'the same event again is a duplicate');
select app.worker_record_email_event('resend', 're_123', 'bounced', 'someone@example.com', 'Mailbox does not exist');
reset role;
select pg_temp.assert((select count(*) = 1 from app.jobs where kind = 'messaging.webhook.email' and payload->>'event_id' =
                         (select id::text from app.webhook_events where provider = 'resend' and event_id = 'evt_1')), 'one webhook job was queued');
select pg_temp.assert((select status = 'bounced' from app.messages where id = :'m1'), 'the bounce marks the message');
select pg_temp.assert(exists (select 1 from app.message_suppressions where center_id = :prod and address = 'someone@example.com' and reason = 'bounce' and lifted_at is null),
  'the bounce suppresses the address');
commit;

-- STOP / START / HELP.
insert into app.integration_connections (center_id, provider, status, settings)
values (:prod, 'twilio', 'connected', '{"from_number":"+18325550100"}');
begin;
set local role connect_worker;
select app.worker_record_inbound_sms('+17135550191', '+18325550100', ' stop ', 'SM1') as stop \gset
reset role;
select pg_temp.assert((:'stop'::jsonb->>'keyword') = 'stop' and (:'stop'::jsonb->>'center_id')::uuid = :prod, 'STOP is recognised for the center that owns the number');
select pg_temp.assert(exists (select 1 from app.message_suppressions where center_id = :prod and channel = 'sms' and address = '+17135550191' and reason = 'stop' and lifted_at is null),
  'STOP suppresses the number');
select pg_temp.assert(exists (select 1 from app.channel_optins where person_id = '25000000-0000-4000-8000-0000000000d1' and channel = 'sms' and not opted_in and source = 'keyword'),
  'STOP records the member''s opt-out');
select pg_temp.assert((select body like 'MTC: You are unsubscribed%' and status = 'queued' from app.messages where id = (:'stop'::jsonb->>'reply_message_id')::uuid),
  'STOP queues the confirmation reply');
set local role connect_worker;
select pg_temp.assert((app.worker_message_to_send((:'stop'::jsonb->>'reply_message_id')::uuid)->>'skip') is null, 'the STOP confirmation itself may go');
select pg_temp.assert((app.worker_record_inbound_sms('+17135550191', '+18325550100', 'HELP', 'SM2')->>'keyword') = 'help', 'HELP is answered');
select app.worker_record_inbound_sms('+17135550191', '+18325550100', 'START', 'SM3');
reset role;
select pg_temp.assert(not exists (select 1 from app.message_suppressions where center_id = :prod and channel = 'sms' and address = '+17135550191' and lifted_at is null),
  'START lifts the STOP (the row is kept, lifted)');
commit;

-- ── Settings RPCs and their permissions ──────────────────────────────────────
begin;
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a4');
set local role authenticated;
select pg_temp.assert_raises($$select app.add_email_domain('25000000-0000-4000-8000-0000000000c1', 'mail.mtc.org', 'x')$$,
  'needs settings.manage or integrations.manage', 'a member cannot add a sending domain', '42501');
select pg_temp.assert((select count(*) = 0 from app.email_domains), 'a member sees no email domains');
select pg_temp.assert((select count(*) = 0 from app.message_suppressions), 'a member sees no suppressions');
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a5');
select pg_temp.assert_raises($$select app.add_email_domain('25000000-0000-4000-8000-0000000000c1', 'mail.mtc.org', 'x')$$,
  'needs settings.manage', 'the communications officer cannot add a domain either (no new permission keys)', '42501');
rollback;

begin;
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a2');
set local role authenticated;
select pg_temp.assert_raises($$select app.add_email_domain('25000000-0000-4000-8000-0000000000c1', 'mail.mtc.org', '')$$,
  'Give a reason', 'adding a domain needs a reason');
select pg_temp.assert_raises($$select app.add_email_domain('25000000-0000-4000-8000-0000000000c1', 'not a domain', 'x')$$,
  'is not a domain name', 'a bad domain is refused');
select app.add_email_domain(:prod, 'https://Mail.MTC.org.', 'Onboarding: our sending domain') as dom \gset
select pg_temp.assert((select domain = 'mail.mtc.org' and status = 'pending' and provider = 'resend' from app.email_domains where id = :'dom'),
  'the domain is stored normalised, pending, with the default service (Resend)');
select pg_temp.assert(exists (select 1 from app.jobs where kind = 'messaging.domain_verify' and payload->>'domain_id' = :'dom' and payload->>'action' = 'create'),
  'adding the domain queues its creation at the provider');
select pg_temp.assert((select status = 'connected' and settings->>'mode' = 'live' from app.integration_connections where center_id = :prod and provider = 'resend'),
  'the Resend connection exists in live mode (production)');
select pg_temp.assert_raises($$select app.save_email_sender('25000000-0000-4000-8000-0000000000c1', 'auth', 'MTC', 'codes@other.org', null, 'x')$$,
  'Send from an address on one of your sending domains', 'a sender must be on a sending domain');
select app.save_email_sender(:prod, 'auth', 'Messaging Test Center', 'codes@mail.mtc.org', 'office@mtc.org', 'Sign-in sender');
select pg_temp.assert((select not verified from app.email_senders where center_id = :prod and purpose = 'auth'), 'the sender is not verified while the domain is pending');
select app.save_email_footer(:prod, '123 Temple Rd, Houston TX 77001', null, 'CAN-SPAM footer');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'email_domains' and record_id = :'dom' and reason = 'Onboarding: our sending domain'),
  'the domain is audited with the reason');
select pg_temp.assert((select not (r.ok) from app.readiness(:prod) r where r.key = 'email_domain_verified'), 'readiness 4 fails while the domain is pending');
reset role;
set local role connect_worker;
select app.worker_email_domain_result(:'dom', 'dom_1', '[{"type":"TXT","name":"send.mail.mtc.org","value":"v=spf1 include:amazonses.com ~all"}]', 'verified', null);
reset role;
select pg_temp.assert((select verified from app.email_senders where center_id = :prod and purpose = 'auth'), 'the domain verifying verifies its senders');
select pg_temp.assert((select status = 'done' from app.center_setup_steps where center_id = :prod and step_key = 'svc.email'), 'Setup › Email is done');
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a2');
set local role authenticated;
select pg_temp.assert((select r.detail like '%Send a test email%' and not r.ok from app.readiness(:prod) r where r.key = 'email_domain_verified'),
  'readiness 4 then asks for a test email');
select app.send_test_message(:prod, 'email') as mt \gset
reset role;
select pg_temp.assert((select to_address = 'msg.admin@example.com' and purpose = 'test' from app.messages where id = :'mt'), 'a test goes to your own sign-in email');
select pg_temp.assert((select kind = 'messaging.test_send' from app.jobs where id = (select job_id from app.messages where id = :'mt')), 'as a messaging.test_send job');
set local role connect_worker;
select app.worker_message_result(:'mt', 'sent', 'resend', 're_t1', null, null);
reset role;
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a2');
set local role authenticated;
select pg_temp.assert((select r.ok from app.readiness(:prod) r where r.key = 'email_domain_verified'), 'readiness 4 passes after a delivered test');
select pg_temp.assert((select last_test_status = 'sent' from app.messaging_settings where center_id = :prod), 'the last test result is shown');
commit;

-- Texting registration and readiness 5.
begin;
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a2');
set local role authenticated;
select pg_temp.assert((select not r.ok and r.detail like 'No texting registration yet%' from app.readiness(:prod) r where r.key = 'texting_registered'),
  'readiness 5 fails with no registration');
select pg_temp.assert_raises($$select app.save_texting_registration('25000000-0000-4000-8000-0000000000c1', '10dlc', '{"legal_name":"MTC"}', true, 'x')$$,
  'Before submitting, add a 9-digit EIN', 'submitting names what is missing');
select app.save_texting_registration(:prod, '10dlc', '{"legal_name":"Messaging Test Center","ein":"12-3456789","use_case":"Codes and reminders",
  "samples":["MTC: your code is 123456","MTC: Paryushan starts Sunday"],"opt_in":"Members agree in the app"}', true, 'Register 10DLC') as reg \gset
select pg_temp.assert((select status = 'submitted' and submitted_at is not null from app.texting_registrations where id = :'reg'), 'the registration is submitted');
select pg_temp.assert((select r.detail like '%waiting for the carriers%' from app.readiness(:prod) r where r.key = 'texting_registered'), 'readiness 5 says it is waiting');
select pg_temp.assert_raises($$select app.set_messaging_review_status('texting', (select id from app.texting_registrations limit 1), 'approved', 'x', '{}')$$,
  'Only the Community Connect team', 'the organization cannot approve its own registration');
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a1');
select app.set_messaging_review_status('texting', :'reg', 'approved', 'Carriers approved the campaign', '{"from_number":"+18325550100","brand_id":"BN1","campaign_id":"CM1"}');
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a2');
select pg_temp.assert((select r.ok from app.readiness(:prod) r where r.key = 'texting_registered'), 'readiness 5 passes once approved');
rollback;
begin;
update app.centers set rules = coalesce(rules, '{}') || jsonb_build_object('security', coalesce(rules->'security', '{}') || '{"phone_sign_in": false}') where id = :prod;
select pg_temp.assert((select (r->>'ok')::boolean and r->>'detail' like 'Phone sign-in is switched off%' from app.check_texting_registered(:prod) r),
  'readiness 5 passes when phone sign-in is off');
rollback;

-- WhatsApp: pending Meta; module switch.
begin;
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a2');
set local role authenticated;
select app.save_whatsapp_account(:prod, null, null, 'Messaging Test Center', '+1 832 555 0101', 'Start WhatsApp') as wa \gset
select pg_temp.assert((select status = 'pending_meta' from app.whatsapp_accounts where id = :'wa'), 'a WhatsApp account starts pending Meta');
select app.submit_whatsapp_template(:prod, 'Event Reminder', 'en', 'utility', 'Reminder: {{1}} starts at {{2}}.', 'First template') as wt \gset
select pg_temp.assert((select name = 'event_reminder' and status = 'pending_meta' from app.whatsapp_template_submissions where id = :'wt'),
  'a template is recorded as pending Meta approval');
reset role;
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
insert into app.center_modules (center_id, module_key, enabled) values (:prod, 'comms', false);
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a2');
set local role authenticated;
select pg_temp.assert_raises($$select app.submit_whatsapp_template('25000000-0000-4000-8000-0000000000c1', 'other', 'en', 'utility', 'Hi', 'x')$$,
  'module is switched off', 'WhatsApp is refused while Communications is off');
select pg_temp.assert((select count(*) = 0 from app.whatsapp_accounts where center_id = :prod), 'and its rows are hidden');
rollback;

-- ── Recipient verification by code ──────────────────────────────────────────
begin;
insert into app.sandbox_test_recipients (id, center_id, channel, address) values ('25000000-0000-4000-8000-0000000000e1', :sbx, 'email', 'new.tester@example.com');
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a3');
set local role authenticated;
select app.send_recipient_verification('25000000-0000-4000-8000-0000000000e1') as vm \gset
reset role;
select pg_temp.assert((select status = 'queued' and purpose = 'verification_code' from app.messages where id = :'vm'),
  'the code goes to the not-yet-verified test recipient');
set local role connect_worker;
select substring(app.worker_message_to_send(:'vm')->>'body' from 'code is (\d{6})') as vcode \gset
reset role;
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a3');
set local role authenticated;
select pg_temp.assert(not app.confirm_recipient_verification('25000000-0000-4000-8000-0000000000e1', '000000') or :'vcode' = '000000', 'a wrong code is refused');
select pg_temp.assert(app.confirm_recipient_verification('25000000-0000-4000-8000-0000000000e1', :'vcode'), 'the right code verifies');
reset role;
select pg_temp.assert((select verified_at is not null from app.sandbox_test_recipients where id = '25000000-0000-4000-8000-0000000000e1'),
  'the recipient is verified (the sandbox admin could not set it by hand)');
rollback;

-- ── Push devices ─────────────────────────────────────────────────────────────
begin;
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a4');
set local role authenticated;
select pg_temp.assert_raises($$select app.register_push_device('25000000-0000-4000-8000-0000000000c1', 'not-a-token', 'ios')$$,
  'not an Expo push token', 'a bad token is refused');
select app.register_push_device(:prod, 'ExponentPushToken[abcdefghij1234]', 'ios');
reset role;
set local role connect_worker;
select pg_temp.assert(app.worker_push_result(null, array['ExponentPushToken[abcdefghij1234]'], 'DeviceNotRegistered') = 1, 'a dead token is marked');
reset role;
select pg_temp.assert((select invalid_at is not null from app.push_devices where token = 'ExponentPushToken[abcdefghij1234]'), 'and kept, not deleted');
select pg_temp.as_user('25000000-0000-4000-8000-0000000000a4');
set local role authenticated;
select app.register_push_device(:prod, 'ExponentPushToken[abcdefghij1234]', 'ios');
reset role;
select pg_temp.assert((select invalid_at is null from app.push_devices where token = 'ExponentPushToken[abcdefghij1234]'), 're-registering re-arms it');
rollback;

-- ── Branded sign-in context ──────────────────────────────────────────────────
begin;
set local role connect_worker;
select pg_temp.assert((select (app.worker_sign_in_context('25000000-0000-4000-8000-0000000000a4', 'msg.member@example.com', null)->'brand'->>'short_name') = 'MTC'),
  'a member of exactly one community gets its branding');
select pg_temp.assert((select app.worker_sign_in_context(null, 'nobody@example.com', null)->'brand') = 'null'::jsonb,
  'an unknown address gets Community Connect''s default');
select pg_temp.assert((select (app.worker_sign_in_context('25000000-0000-4000-8000-0000000000a2', 'msg.admin@example.com', null)->'email'->'sender'->>'from_address') = 'codes@mail.mtc.org'),
  'the verified sign-in sender is used');
select app.worker_record_hook_message(:prod, 'email', 'msg.admin@example.com', 'Your MTC sign-in code', 'sent', 'resend', 're_h1', null, false) as hm \gset
reset role;
select pg_temp.assert((select purpose = 'auth_code' and body not similar to '%[0-9]{6}%' from app.messages where id = :'hm'),
  'a hook-sent sign-in code is recorded without the code');
rollback;
