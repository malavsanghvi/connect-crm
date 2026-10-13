-- 0771: scheduled emails.
--   A. Who may write, switch on and pause (comms.send / comms.approve, each with giving.view or giving.manage); no 2FA step.
--   B. What is refused: a placeholder the audience does not have, a list in the subject, a day every month does not have.
--   C. The dry run: households, adults (never a child), who would not get it and why.
--   D. When: the next run on the community's clock (weekly, monthly, yearly, daily; across a daylight-saving change).
--   E. A run: due, batches, once per household and adult, the log, done and the next run; purpose and topic of the emails.
--   F. A change to an active schedule needs approval again; pause; Communications off stops it.
--   G. Givers since the last run; a non-faith community.
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
-- p_code_age: seconds since a 2FA code (only the module switch in F uses one; nothing in 0771 asks for it).
create or replace function pg_temp.claims(p_user uuid, p_code_age int default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_code_age is not null then 'aal2' else 'aal1' end,
    'amr', case when p_code_age is not null
                then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - p_code_age))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '', true);
end $$;

\set jc '''17100000-0000-4000-8000-0000000000c1'''
\set np '''17100000-0000-4000-8000-0000000000c2'''
\set owner '''17100000-0000-4000-8000-000000000001'''
\set admin '''17100000-0000-4000-8000-000000000002'''
\set writer '''17100000-0000-4000-8000-000000000003'''
\set comms '''17100000-0000-4000-8000-000000000004'''
\set treas '''17100000-0000-4000-8000-000000000005'''
\set npadmin '''17100000-0000-4000-8000-000000000006'''
\set h1 '''17100000-0000-4000-8000-0000000000a1'''
\set h2 '''17100000-0000-4000-8000-0000000000a2'''
\set h3 '''17100000-0000-4000-8000-0000000000a3'''
\set h4 '''17100000-0000-4000-8000-0000000000a4'''
\set hn '''17100000-0000-4000-8000-0000000000a5'''
\set mira '''17100000-0000-4000-8000-0000000000b1'''
\set kiran '''17100000-0000-4000-8000-0000000000b2'''
\set ravi '''17100000-0000-4000-8000-0000000000b3'''
\set asha '''17100000-0000-4000-8000-0000000000b4'''
\set noel '''17100000-0000-4000-8000-0000000000b5'''
\set ira '''17100000-0000-4000-8000-0000000000b6'''
\set pat '''17100000-0000-4000-8000-0000000000b7'''

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner171@temple.test'), (:admin, 'admin171@temple.test'), (:writer, 'writer171@temple.test'),
  (:comms, 'comms171@temple.test'), (:treas, 'treasurer171@temple.test'), (:npadmin, 'admin171@chamber.test');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('17100000-0000-4000-8000-0000000000f1', :owner, 'phone', 'totp', 'verified');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:jc, 'jc171', 'Temple 171', 'T171', 'TX', 'active', 'America/Chicago');
update app.organization_categories set active = true where key = 'chamber_of_commerce';
insert into app.centers (id, slug, name, category_key, status, time_zone, currency, country, environment) values
  (:np, 'np171', 'Chamber 171', 'chamber_of_commerce', 'active', 'Europe/Madrid', 'EUR', 'ES', 'production');
-- A role that writes scheduled emails but cannot switch them on.
insert into app.roles (key, tier, name, permissions) values ('comms_writer171', 'center', 'Comms writer 171', '["comms.send", "giving.view"]');
-- The first center admin becomes the owner (0151); the second is an ordinary one (comms.send, comms.approve, giving.view).
insert into app.role_grants (center_id, user_id, role_key, reason) values (:jc, :owner, 'center_admin', 'test 171');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:jc, :admin, 'center_admin', 'test 171'), (:jc, :writer, 'comms_writer171', 'test 171'),
  (:jc, :comms, 'communications_officer', 'test 171'), (:jc, :treas, 'treasurer', 'test 171'),
  (:np, :npadmin, 'center_admin', 'test 171');
insert into app.households (id, center_id, display_name) values
  (:h1, :jc, 'Member171, Mira & Kiran'), (:h2, :jc, 'Second171, Ravi & Asha'), (:h3, :jc, 'NoEmail171, Noel'),
  (:h4, :jc, 'Other171, Ira'), (:hn, :np, 'Chamber171, Pat');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:mira, :jc, 'Mira', 'Member171', date '1980-01-01', 'mira171@temple.test'),
  (:kiran, :jc, 'Kiran', 'Member171', (current_date - interval '10 years')::date, 'kiran171@temple.test'),
  (:ravi, :jc, 'Ravi', 'Second171', date '1975-03-03', 'ravi171@temple.test'),
  (:asha, :jc, 'Asha', 'Second171', date '1977-04-04', 'asha171@temple.test'),
  (:noel, :jc, 'Noel', 'NoEmail171', date '1970-05-05', null),
  (:ira, :jc, 'Ira', 'Other171', date '1971-06-06', 'ira171@temple.test'),
  (:pat, :np, 'Pat', 'Chamber171', date '1970-02-02', 'pat171@chamber.test');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :mira, :jc, 'primary', true), (:h1, :kiran, :jc, 'child', false),
  (:h2, :ravi, :jc, 'primary', true), (:h2, :asha, :jc, 'spouse', false),
  (:h3, :noel, :jc, 'primary', true), (:h4, :ira, :jc, 'primary', true), (:hn, :pat, :np, 'primary', true);
-- Asha switched giving emails off in the app.
insert into app.notification_preferences (center_id, person_id, topic_key, channel, enabled) values (:jc, :asha, 'giving', 'email', false);
select (now() at time zone 'America/Chicago')::date as today \gset
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, paid_cents, source, due_on, crm_external_id) values
  ('17100000-0000-4000-8000-000000000201', :jc, :h1, :mira, 50000, 10000, 'general', :'today'::date + 3, null),
  ('17100000-0000-4000-8000-000000000202', :jc, :h1, :mira, 20000, 0, 'general', :'today'::date + 30, null),
  ('17100000-0000-4000-8000-000000000203', :jc, :h1, :mira, 30000, 0, 'general', :'today'::date - 10, null),
  ('17100000-0000-4000-8000-000000000204', :jc, :h2, :ravi, 15000, 0, 'labh', :'today'::date + 5, null),
  ('17100000-0000-4000-8000-000000000205', :jc, :h3, :noel, 9000, 0, 'general', :'today'::date + 2, null),
  ('17100000-0000-4000-8000-000000000206', :jc, :h4, :ira, 9000, 0, 'general', :'today'::date + 2, 'CRM-171'),
  ('17100000-0000-4000-8000-000000000207', :jc, :h4, :ira, 9000, 0, 'pathshala_fee', :'today'::date + 2, null),
  ('17100000-0000-4000-8000-000000000208', :jc, :h2, :ravi, 9000, 9000, 'general', :'today'::date + 1, null),
  ('17100000-0000-4000-8000-000000000209', :np, :hn, :pat, 70000, 0, 'general', :'today'::date + 4, null);
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number, received_on) values
  ('17100000-0000-4000-8000-000000000301', :jc, :h1, :mira, 2500, 'check', 'captured', 'offline', 'R-171-1', :'today'::date - 1),
  ('17100000-0000-4000-8000-000000000302', :jc, :h2, :ravi, 4000, 'check', 'captured', 'offline', 'R-171-2', :'today'::date - 40);


-- ══ A. Who may do what ═══════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:comms);
select pg_temp.assert_raises(format($$select app.save_email_schedule(%L, null, 'Reminder', 'pledges_due_soon', '{}', 'monthly', null, 1, null, 9, 'en', 'Due soon', 'Hi')$$, :jc),
  'needs comms.send, and giving.view', 'A · a communications officer who cannot read Giving cannot write one');
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.save_email_schedule(%L, null, 'Reminder', 'pledges_due_soon', '{}', 'monthly', null, 1, null, 9, 'en', 'Due soon', 'Hi')$$, :jc),
  'needs comms.send', 'A · a treasurer (no comms.send) cannot write one');
select pg_temp.claims(:writer);
select app.save_email_schedule(:jc, null, 'Pledges due this week', 'pledges_due_soon', '{"days": 7}', 'weekly', 1, null, null, 9, 'en',
                               'Your pledges due soon, {{recipient_first_name}}', E'Dear {{recipient_first_name}},\n\n{{pledges_list}}\n\nTotal {{pledges_balance}}, first due {{next_due_date}}.') as s1 \gset
select (:'s1'::jsonb->>'id') as sid \gset
select pg_temp.assert(:'s1'::jsonb->>'status' = 'draft'
                      and (select status = 'draft' and not enabled and next_run_at is null and template_key like 'schedule\_%'
                             from app.email_automations where id = :'sid'),
  'A · someone with comms.send and giving.view writes one; it starts as a draft that sends nothing');
select pg_temp.assert_raises(format($$select app.approve_email_schedule(%L, %L)$$, :jc, :'sid'), 'needs comms.approve',
  'A · and cannot switch it on (comms.approve)');

-- ══ B. What is refused ═══════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select app.save_email_schedule(%L, null, 'X', 'pledges_due_soon', '{}', 'monthly', null, 1, null, 9, 'en', 'Due', 'Hi {{payment_amount}}')$$, :jc),
  'uses {{payment_amount}}', 'B · a placeholder this audience does not have is refused');
select pg_temp.assert_raises(format($$select app.save_email_schedule(%L, null, 'X', 'pledges_due_soon', '{}', 'monthly', null, 1, null, 9, 'en', 'Due: {{pledges_list}}', 'Hi')$$, :jc),
  'is a list', 'B · a list in the subject line is refused');
select pg_temp.assert_raises(format($$select app.save_email_schedule(%L, null, 'X', 'pledges_due_soon', '{}', 'monthly', null, 31, null, 9, 'en', 'Due', 'Hi')$$, :jc),
  'from 1 to 28', 'B · day 31 is refused (not every month has it)');
select pg_temp.assert_raises(format($$select app.save_email_schedule(%L, null, 'X', 'pledges_due_soon', '{"days": 0}', 'monthly', null, 1, null, 9, 'en', 'Due', 'Hi')$$, :jc),
  'between 1 and 60', 'B · 0 days before the due date is refused');
select pg_temp.assert_raises(format($$select app.save_email_schedule(%L, null, 'X', 'everyone', '{}', 'monthly', null, 1, null, 9, 'en', 'Due', 'Hi')$$, :jc),
  'Choose who', 'B · an audience that does not exist is refused (there is no "everyone")');

-- ══ C. The dry run ═══════════════════════════════════════════════════════════
select app.email_schedule_preview(:jc, 'pledges_due_soon', '{"days": 7}', 'weekly', 18) as pv \gset
select pg_temp.assert((:'pv'::jsonb->>'households')::int = 3 and (:'pv'::jsonb->>'adults')::int = 3 and (:'pv'::jsonb->>'would_send')::int = 2
                      and :'pv'::jsonb->'skipped' = '{"no_email": 1, "switched_off": 1, "unsubscribed": 0}'::jsonb,
  'C · due in 7 days: three households (an imported pledge, a fee, one paid off and one due later are left out), three adults (never the child), two would get it: one household has no email address, one adult switched giving emails off');
select pg_temp.assert(:'pv'::jsonb #> '{sample,household,minor_first_names}' = '["Kiran"]'
                      and not (:'pv'::jsonb #> '{sample,recipients,0}' ? 'address')
                      and jsonb_array_length(:'pv'::jsonb->'sample_households') = 2,
  'C · the preview''s household keeps the child''s first name out and shows no address; two households for the cards');
select pg_temp.assert((app.email_schedule_preview(:jc, 'pledges_past_due', '{}', 'monthly', 18)->>'households')::int = 1
                      and (app.email_schedule_preview(:jc, 'pledges_past_due', format('{"since": "%s"}', :'today'::date + 1)::jsonb, 'monthly', 18)->>'households')::int = 0,
  'C · past due: one household; "made on or after" a later date leaves it out');
select pg_temp.assert((app.email_schedule_preview(:jc, 'pledges_due_soon', '{"days": 7, "include_imported": true}', 'weekly', 18)->>'households')::int = 4,
  'C · ticking "include imported" brings the imported pledge in');
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.email_schedule_preview(%L, 'pledges_due_soon', '{}', 'weekly', 18)$$, :jc), 'don''t have access',
  'C · the dry run needs a Communications permission too');

-- ══ D. When ══════════════════════════════════════════════════════════════════
reset role;
select pg_temp.assert(app._email_schedule_next('weekly', 1, null, null, 9, 'America/Chicago', '2026-10-13 12:00-05') = '2026-10-19 14:00+00'
                      and app._email_schedule_next('daily', null, null, null, 9, 'America/Chicago', '2026-10-13 12:00-05') = '2026-10-14 14:00+00'
                      and app._email_schedule_next('daily', null, null, null, 9, 'America/Chicago', '2026-10-13 08:00-05') = '2026-10-13 14:00+00'
                      and app._email_schedule_next('monthly', null, 1, null, 9, 'America/Chicago', '2026-10-13 12:00-05') = '2026-11-01 15:00+00'
                      and app._email_schedule_next('yearly', null, 15, 1, 9, 'America/Chicago', '2026-10-13 12:00-05') = '2027-01-15 15:00+00'
                      and app._email_schedule_next('monthly', null, 1, null, 9, 'Asia/Kolkata', '2026-10-13 12:00+00') = '2026-11-01 03:30+00',
  'D · the next run: Monday 9:00, tomorrow 9:00, later today 9:00, the 1st at 9:00 after the clocks change, January 15, and in another time zone');

-- ══ E. A run ═════════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:admin);
select app.approve_email_schedule(:jc, :'sid') as ap \gset
select pg_temp.assert(:'ap'::jsonb->>'status' = 'active' and (:'ap'::jsonb->>'next_run_at')::timestamptz > now()
                      and ((:'ap'::jsonb->>'next_run_at')::timestamptz at time zone 'America/Chicago')::time = '09:00'
                      and extract(dow from (:'ap'::jsonb->>'next_run_at')::timestamptz at time zone 'America/Chicago') = 1,
  'E · a center admin (comms.approve) switches it on with a sign-in session only: the next run is a Monday at 9:00 on the community''s clock');
reset role;
-- Its time has come.
update app.email_automations set next_run_at = now() - interval '1 minute' where id = :'sid';
select to_char((now() - interval '1 minute') at time zone 'America/Chicago', 'YYYY-MM-DD') as period \gset
set role connect_worker;
select app.worker_email_schedules_due(20) as due \gset
select app.worker_email_schedule_batch(:'sid', :'period', 18, 100) as b1 \gset
reset role;
select pg_temp.assert(:'due'::jsonb @> jsonb_build_array(jsonb_build_object('automation_id', :'sid', 'period', :'period', 'audience', 'pledges_due_soon'))
                      and (select run_period = :'period' from app.email_automations where id = :'sid'),
  'E · the run is due: its period is the run''s date on the community''s clock');
select pg_temp.assert(jsonb_array_length(:'b1'::jsonb->'households') = 2 and not (:'b1'::jsonb->>'more')::boolean
                      and (select count(*) from app.email_automation_sends where automation_id = :'sid' and ref_id = :h3 and outcome = 'skipped'
                             and reason like '%no adult of the household has an email%') = 1
                      and (select bool_and(h->'household'->>'id' <> :h3) from jsonb_array_elements(:'b1'::jsonb->'households') h),
  'E · the batch: two households with adults to write to; the one without an email address is logged once and not handed out');
select pg_temp.assert((select h #>> '{data,count}' = '1' and h #>> '{data,balance_cents}' = '40000'
                         and jsonb_array_length(h->'recipients') = 1 and h #>> '{recipients,0,address}' = 'mira171@temple.test'
                         from jsonb_array_elements(:'b1'::jsonb->'households') h where h #>> '{household,id}' = :h1),
  'E · a household''s data: its pledge due this week with what is left to pay, and its adult only');

select jsonb_object_agg(n, 'v-' || n) || '{"pledges_list": "P-1 · Building · $400.00\nP-2 · General · $10.00"}'::jsonb as vars
  from unnest(app._email_placeholders('schedule:pledges_due_soon')) n \gset
set role connect_worker;
select app.worker_email_enqueue(:'sid', :h1, :'period', :h1, :mira, 'mira171@temple.test', :'vars'::jsonb) as q1 \gset
select app.worker_email_enqueue(:'sid', :h1, :'period', :h1, :mira, 'mira171@temple.test', :'vars'::jsonb) as q2 \gset
select app.worker_email_enqueue(:'sid', :h2, :'period', :h2, :ravi, 'ravi171@temple.test', :'vars'::jsonb) as q3 \gset
select app.worker_email_enqueue(:'sid', :h2, :'period', :h2, :asha, 'asha171@temple.test', :'vars'::jsonb) as q4 \gset
select app.worker_email_schedule_batch(:'sid', :'period', 18, 100) as b2 \gset
select app.worker_email_schedule_done(:'sid', :'period') as done \gset
reset role;
select pg_temp.assert(:'q1'::jsonb->>'outcome' = 'queued' and :'q2'::jsonb->>'outcome' = 'duplicate' and :'q3'::jsonb->>'outcome' = 'queued',
  'E · each adult once per run: the same adult again is a duplicate');
select pg_temp.assert((select purpose = 'notification' and topic_key = 'giving' and person_id = :mira
                              and subject = 'Your pledges due soon, v-recipient_first_name'
                              and body like E'%P-1 · Building · $400.00\nP-2 · General · $10.00%'
                         from app.messages where id = (:'q1'::jsonb->>'message_id')::uuid),
  'E · the email: a "giving" notification (the member''s switch, opt-outs, the unsubscribe link) with the list one line per pledge');
select pg_temp.assert((select person_id = :asha and topic_key = 'giving' from app.messages where id = (:'q4'::jsonb->>'message_id')::uuid),
  'E · the adult who switched giving emails off is tied to the message, so the sender skips it at send time (0598)');
select pg_temp.assert(jsonb_array_length(:'b2'::jsonb->'households') = 0 and not (:'b2'::jsonb->>'more')::boolean,
  'E · a second batch of the same run hands out nobody again');
select pg_temp.assert((select run_period is null and next_run_at > now() and last_run->>'period' = :'period'
                              and (last_run->>'queued')::int = 3 and (last_run->>'skipped')::int = 1
                         from app.email_automations where id = :'sid'),
  'E · done: the run''s summary (3 queued, 1 household without an email) and the next run');
set role authenticated;
select pg_temp.claims(:writer);
select pg_temp.assert((select (s->'week'->>'queued')::int = 3 and s->>'status' = 'active'
                         from jsonb_array_elements(app.email_schedules_state(:jc, 18)->'schedules') s where s->>'id' = :'sid')
                      and jsonb_array_length(app.email_schedule_log(:jc, :'sid', 10)) = 4,
  'E · the screen shows the week''s count and the log lists each email and the household without an address');

-- ══ F. Changes, pause, modules ═══════════════════════════════════════════════
select app.save_email_schedule(:jc, :'sid', 'Pledges due this week', 'pledges_due_soon', '{"days": 7}', 'weekly', 1, null, null, 9, 'en',
                               'Your pledges due soon, {{recipient_first_name}}', E'Dear {{recipient_first_name}},\n\n{{pledges_list}}\n\nTotal {{pledges_balance}}, first due {{next_due_date}}.') as same \gset
select pg_temp.assert(:'same'::jsonb->>'unchanged' = 'true' and (select status = 'active' from app.email_automations where id = :'sid'),
  'F · saving it unchanged leaves it on');
select app.save_email_schedule(:jc, :'sid', 'Pledges due this week', 'pledges_due_soon', '{"days": 14}', 'weekly', 1, null, null, 9, 'en',
                               'Your pledges due soon, {{recipient_first_name}}', 'Dear {{recipient_first_name}}, {{pledges_list}}') as changed \gset
select pg_temp.assert(:'changed'::jsonb->>'was_active' = 'true'
                      and (select status = 'draft' and not enabled and next_run_at is null and approved_by is null
                             from app.email_automations where id = :'sid'),
  'F · changing an active one puts it back to draft: it goes again only when switched on again');
select pg_temp.claims(:admin);
select app.approve_email_schedule(:jc, :'sid');
select app.pause_email_schedule(:jc, :'sid') as paused \gset
select pg_temp.assert(:'paused'::jsonb->>'status' = 'paused'
                      and (select next_run_at is null and not enabled from app.email_automations where id = :'sid'),
  'F · paused: no next run');
select app.approve_email_schedule(:jc, :'sid');
savepoint comms_off;
select pg_temp.claims(:owner, 60);
select app.set_module_enabled(:jc, 'comms', false, 'Test 171: no Communications here');
select pg_temp.claims(:admin);
select pg_temp.assert_raises(format($$select app.email_schedule_preview(%L, 'pledges_due_soon', '{}', 'weekly', 18)$$, :jc), 'Communications module',
  'F · with Communications off the dry run says why');
select pg_temp.assert(app.email_schedules_state(:jc, 18)->>'modules_on' = 'false', 'F · and the screen says it is off');
reset role;
update app.email_automations set next_run_at = now() - interval '1 minute', run_period = null where id = :'sid';
set role connect_worker;
select app.worker_email_schedules_due(20) as due_off \gset
reset role;
select pg_temp.assert(not (:'due_off'::jsonb @> jsonb_build_array(jsonb_build_object('automation_id', :'sid')))
                      and (select run_period is null and next_run_at > now() and last_run ? 'skipped' from app.email_automations where id = :'sid'),
  'F · a run that comes while Communications is off does not go; it waits for its next time and says why');
rollback to savepoint comms_off;
select pg_temp.assert_raises($$select app.worker_email_schedules_due(1)$$, 'Only the background service', 'F · only the background service starts runs');

-- ══ G. Givers since the last run; a non-faith community ═══════════════════════
set role authenticated;
select pg_temp.claims(:admin);
select app.email_schedule_preview(:jc, 'gave_recently', '{}', 'daily', 18) as gv \gset
select pg_temp.assert((:'gv'::jsonb->>'households')::int = 1 and :'gv'::jsonb #>> '{sample,data,total_cents}' = '2500'
                      and :'gv'::jsonb #>> '{sample,data,period_start}' = (:'today'::date - 1)::text,
  'G · givers of the day before: one household and what it gave (the gift of 40 days ago is outside a daily window)');
select pg_temp.assert((app.email_schedule_preview(:jc, 'gave_recently', '{}', 'monthly', 18)->>'households')::int = 1
                      and (app.email_schedule_preview(:jc, 'gave_recently', '{}', 'yearly', 18)->>'households')::int = 2,
  'G · a monthly run looks back a month, a yearly run a year');
select pg_temp.claims(:npadmin);
select app.save_email_schedule(:np, null, 'Recordatorio', 'pledges_due_soon', '{}', 'monthly', null, 1, null, 10, 'es',
                               'Sus compromisos, {{recipient_first_name}}', 'Hola {{recipient_first_name}}: {{pledges_list}}') as nps \gset
select app.approve_email_schedule(:np, (:'nps'::jsonb->>'id')::uuid) as npa \gset
select pg_temp.assert((app.email_schedule_preview(:np, 'pledges_due_soon', '{}', 'monthly', 18)->>'would_send')::int = 1
                      and ((:'npa'::jsonb->>'next_run_at')::timestamptz at time zone 'Europe/Madrid')::time = '10:00'
                      and extract(day from (:'npa'::jsonb->>'next_run_at')::timestamptz at time zone 'Europe/Madrid') = 1,
  'G · a chamber of commerce in Spain writes its reminder in Spanish; it goes on the 1st at 10:00 Madrid time');
reset role;

rollback;
