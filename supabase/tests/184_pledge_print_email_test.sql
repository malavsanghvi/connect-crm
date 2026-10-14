-- 0790-0793: print and email a pledge (owner request 2026-10-14).
--   A. The pledge confirmation is ON by default: every community has its row (made with the community, and by the backfill, which keeps
--      an email a person switched off), a recorded pledge queues one compose job, and not for history (over 30 days, imported, a fee,
--      the import tool), a demo community, or an upload that chose not to email; the standard wording says the PDF is attached.
--   B. Who gets it: the household's PRIMARY member, never the spouse; when there is nobody (no address, a child as primary member, no
--      primary member) nothing is sent and the reason is in the log and in the pledge's History; the treasurer's approval still gates
--      the automatic email (and says so).
--   C. Queueing: once per pledge whatever the address, the PDF named in the message by id only, the outcome in the pledge's History.
--   D. The PDF's facts: the portal's read (giving.view or giving.manage, another community's pledge is "not found") and the background
--      service's read (only for a pledge the message names); no child's name, birth date or email in it.
--   E. Emailing by hand: giving.manage, the address checked, once per confirmation key, the job carries ids only, History says who,
--      the typed address is the only recipient and a household adult at that address is greeted by name, not held back by the
--      automatic email's approval, at most 40 an hour, what happened is readable (waiting, sent, failed, not sent).
--   F. A sandbox reaches only verified test recipients, by hand and automatically.
--   G. A bulk upload: emails by default (once per pledge), "do not email" records why on each pledge, history rows are not emailed, a
--      replay queues nothing, and the status of each pledge is readable (pending, no email, declined, history, waiting, sent, failed).
--   H. Grants, the table's privacy and the activity catalog.
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
create or replace function pg_temp.audits(p_pledge uuid, p_action text) returns bigint language sql as $$
  select count(*) from app.audit_log where record_table = 'pledges' and record_id = p_pledge::text and action = p_action
$$;
-- Emails by hand, many at a time, to reach the hourly limit.
create or replace function pg_temp.fill(p_user uuid, p_center uuid, p_pledge uuid, p_n integer) returns void language plpgsql as $$
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  for i in 1 .. p_n loop
    perform app.send_pledge_email(p_center, p_pledge, 'bulk' || i || '@example.org', 'key-184-bulk-' || i);
  end loop;
  reset role;
exception when others then
  reset role;
  raise;
end $$;

\set jc '''18400000-0000-4000-8000-0000000000c1'''
\set sb '''18400000-0000-4000-8000-0000000000c2'''
\set dm '''18400000-0000-4000-8000-0000000000c3'''
\set oc '''18400000-0000-4000-8000-0000000000c4'''
\set bk1 '''18400000-0000-4000-8000-0000000000c5'''
\set bk2 '''18400000-0000-4000-8000-0000000000c6'''
\set bk3 '''18400000-0000-4000-8000-0000000000c7'''
\set treas '''18400000-0000-4000-8000-000000000001'''
\set exec '''18400000-0000-4000-8000-000000000002'''
\set vol '''18400000-0000-4000-8000-000000000003'''
\set octreas '''18400000-0000-4000-8000-000000000004'''
\set sbtreas '''18400000-0000-4000-8000-000000000005'''
\set h1 '''18400000-0000-4000-8000-0000000000a1'''
\set h2 '''18400000-0000-4000-8000-0000000000a2'''
\set h3 '''18400000-0000-4000-8000-0000000000a3'''
\set h4 '''18400000-0000-4000-8000-0000000000a4'''
\set hd '''18400000-0000-4000-8000-0000000000a5'''
\set hs '''18400000-0000-4000-8000-0000000000a6'''
\set ho '''18400000-0000-4000-8000-0000000000a7'''
\set mira '''18400000-0000-4000-8000-0000000000b1'''
\set kiran '''18400000-0000-4000-8000-0000000000b2'''
\set ravi '''18400000-0000-4000-8000-0000000000b3'''
\set asha '''18400000-0000-4000-8000-0000000000b4'''
\set tween '''18400000-0000-4000-8000-0000000000b5'''
\set dena '''18400000-0000-4000-8000-0000000000b6'''
\set sam '''18400000-0000-4000-8000-0000000000b7'''
\set otto '''18400000-0000-4000-8000-0000000000b8'''
\set uma '''18400000-0000-4000-8000-0000000000b9'''
\set p1 '''18400000-0000-4000-8000-000000000201'''
\set p2 '''18400000-0000-4000-8000-000000000202'''
\set p3 '''18400000-0000-4000-8000-000000000203'''
\set p4 '''18400000-0000-4000-8000-000000000204'''
\set p5 '''18400000-0000-4000-8000-000000000205'''
\set p6 '''18400000-0000-4000-8000-000000000206'''
\set p7 '''18400000-0000-4000-8000-000000000207'''
\set p8 '''18400000-0000-4000-8000-000000000208'''
\set p9 '''18400000-0000-4000-8000-000000000209'''
\set p10 '''18400000-0000-4000-8000-000000000210'''
\set p11 '''18400000-0000-4000-8000-000000000211'''
\set p12 '''18400000-0000-4000-8000-000000000212'''
\set p13 '''18400000-0000-4000-8000-000000000213'''
\set p14 '''18400000-0000-4000-8000-000000000214'''
\set p15 '''18400000-0000-4000-8000-000000000215'''
\set pay1 '''18400000-0000-4000-8000-000000000301'''

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:treas, 'treasurer184@temple.test'), (:exec, 'committee184@temple.test'), (:vol, 'volunteer184@temple.test'),
  (:octreas, 'treasurer184@other.test'), (:sbtreas, 'treasurer184@sandbox.test');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:jc, 'jc184', 'Temple 184', 'T184', 'TX', 'active', 'America/Chicago'),
  (:oc, 'oc184', 'Other Temple 184', 'O184', 'TX', 'active', 'America/Chicago'),
  (:bk1, 'bk1184', 'Backfill one 184', 'B1', 'TX', 'active', 'America/Chicago'),
  (:bk2, 'bk2184', 'Backfill two 184', 'B2', 'TX', 'active', 'America/Chicago'),
  (:bk3, 'bk3184', 'Backfill three 184', 'B3', 'TX', 'active', 'America/Chicago');
insert into app.centers (id, slug, name, environment, category_key, status) values
  (:sb, 'sb184-sandbox', 'Sandbox 184', 'sandbox', 'nonprofit_secular', 'onboarding');
insert into app.centers (id, slug, name, status, rules) values
  (:dm, 'dm184', 'Demo 184', 'active', jsonb_build_object('demo', true));
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:jc, :treas, 'treasurer', 'test 184'), (:jc, :exec, 'executive_committee', 'test 184'), (:jc, :vol, 'finance_volunteer', 'test 184'),
  (:oc, :octreas, 'treasurer', 'test 184'), (:sb, :sbtreas, 'treasurer', 'test 184');
update app.centers set branding = jsonb_build_object('logo_path', :jc || '/brand/logo-1.png', 'colors', jsonb_build_object('primary', '#123456', 'accent', '#C9731C'))
 where id = :jc;
insert into app.org_profiles (center_id, legal_name, ein, public_email, public_phone, languages)
values (:jc, 'Temple 184 Inc.', '12-3456789', 'office184@temple.test', '+17135550184', array['en'])
on conflict (center_id) do update set legal_name = excluded.legal_name, ein = excluded.ein, public_email = excluded.public_email,
  public_phone = excluded.public_phone, languages = excluded.languages;
-- The community's own pledge-confirmation signer and note (in what the treasurer approves below).
insert into app.receipt_templates (center_id, kind, signed_by, personal_note) values (:jc, 'pledge_confirmation', 'The Treasurer 184', 'Thank you 184');
insert into app.households (id, center_id, display_name, address_line1, city, state_region, postal_code) values
  (:h1, :jc, 'Member184, Mira & Kiran', '12 Oak St', 'Houston', 'TX', '77002'),
  (:h2, :jc, 'Second184, Ravi & Asha', null, null, null, null),
  (:h3, :jc, 'Third184 household', null, null, null, null),
  (:h4, :jc, 'Fourth184 household', null, null, null, null),
  (:hd, :dm, 'Demo184 household', null, null, null, null),
  (:hs, :sb, 'Sandbox184 household', null, null, null, null),
  (:ho, :oc, 'Other184 household', null, null, null, null);
select household_number as hn1 from app.households where id = :h1 \gset
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:mira, :jc, 'Mira', 'Member184', date '1980-01-01', 'Mira184@Temple.test'),
  (:kiran, :jc, 'Kiran', 'Member184', (current_date - interval '10 years')::date, 'kiran184@temple.test'),
  (:ravi, :jc, 'Ravi', 'Second184', date '1975-03-03', null),
  (:asha, :jc, 'Asha', 'Second184', date '1977-04-04', 'asha184@temple.test'),
  (:tween, :jc, 'Tween', 'Third184', (current_date - interval '12 years')::date, 'tween184@temple.test'),
  (:dena, :jc, 'Dena', 'Fourth184', date '1970-01-01', 'dena184@temple.test'),
  (:sam, :sb, 'Sam', 'Sandbox184', date '1972-02-02', 'sam184@sandbox.test'),
  (:otto, :oc, 'Otto', 'Other184', date '1970-02-02', 'otto184@other.test'),
  (:uma, :dm, 'Uma', 'Demo184', date '1970-02-02', 'uma184@demo.weaverams.org');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :mira, :jc, 'primary', true), (:h1, :kiran, :jc, 'child', false),
  (:h2, :ravi, :jc, 'primary', true), (:h2, :asha, :jc, 'spouse', false),
  (:h3, :tween, :jc, 'primary', true),
  (:h4, :dena, :jc, 'spouse', false),
  (:hs, :sam, :sb, 'primary', true), (:ho, :otto, :oc, 'primary', true), (:hd, :uma, :dm, 'primary', true);

-- ══ A. On by default ═════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) = 6 and bool_and(enabled) from app.email_automations
                          where trigger_key = 'pledge_recorded' and center_id in (:jc, :sb, :oc, :bk1, :bk2, :bk3)),
  'A · every community made has its pledge confirmation row, switched on (the receipt and registration emails have none until a person switches them on)');
select pg_temp.assert(not exists (select 1 from app.email_automations where center_id = :dm),
  'A · a community made as a demo community has no row (nothing is ever sent from it, and its reset restores the rows it was made with)');
update app.centers set rules = rules || jsonb_build_object('demo', true) where id = :bk3;
select pg_temp.assert(not exists (select 1 from app.email_automations where center_id = :bk3),
  'A · and one flagged a demo community afterwards (app.create_demo_community makes a sandbox first) gives its row back');
select pg_temp.assert(not exists (select 1 from app.email_automations where center_id = :jc and trigger_key in ('payment_receipt', 'registration_confirmed')),
  'A · and only that one: the other two emails have no row, so they are off as before');

insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, source) values
  (:p1, :jc, :h1, :mira, 10000, 'general');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, paid_cents, source, status) values
  (:p2, :jc, :h1, :mira, 8000, 8000, 'general', 'paid');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, source) values
  (:p3, :jc, :h1, :mira, 5000, 'pathshala_fee');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, source, crm_external_id) values
  (:p4, :jc, :h1, :mira, 7000, 'general', 'CRM-184-1');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, amount_cents, source, pledged_at) values
  (:p5, :jc, :h1, :mira, 6100, 'general', now() - interval '40 days'),
  (:p6, :jc, :h1, :mira, 10000, 'general', now() - interval '5 days');
insert into app.pledges (id, center_id, household_id, amount_cents, source) values
  (:p7, :dm, :hd, 9000, 'general'),
  (:p8, :sb, :hs, 9100, 'general');
select set_config('app.pledge_email', 'off', true);
insert into app.pledges (id, center_id, household_id, amount_cents, source) values (:p9, :jc, :h1, 4100, 'general');
select set_config('app.pledge_email', '', true);
select set_config('app.client_app', 'import', true);
insert into app.pledges (id, center_id, household_id, amount_cents, source) values (:p10, :jc, :h1, 4200, 'general');
select set_config('app.client_app', '', true);
select pg_temp.assert(pg_temp.jobs(:p1) = 1 and pg_temp.jobs(:p6) = 1 and pg_temp.jobs(:p8) = 1,
  'A · a pledge recorded now, one dated five days ago, and one in a sandbox each queue exactly one compose job');
select pg_temp.assert(pg_temp.jobs(:p2) + pg_temp.jobs(:p3) + pg_temp.jobs(:p4) + pg_temp.jobs(:p5) + pg_temp.jobs(:p7) + pg_temp.jobs(:p9) + pg_temp.jobs(:p10) = 0,
  'A · none for a pledge already paid, a fee, an imported pledge, one dated 40 days ago (history), a demo community (it has no row), an upload that chose not to email, or the import tool');
select pg_temp.assert((select body from app.message_templates where center_id is null and key = 'pledge_recorded' and channel = 'email' and language = 'en'
                        order by version desc limit 1) like '%attached as a PDF%'
                      and (select count(*) from app.message_templates where center_id is null and key = 'pledge_recorded' and channel = 'email' and language = 'en') = 2,
  'A · the standard pledge wording (version 2) says the PDF is attached; version 1 is untouched');

-- A demo community that has a row (the Email menu item makes one on demand) still queues nothing for a new pledge.
insert into app.email_automations (center_id, kind, trigger_key, template_key, enabled) values (:dm, 'trigger', 'pledge_recorded', 'pledge_recorded', true);
insert into app.pledges (id, center_id, household_id, amount_cents, source) values ('18400000-0000-4000-8000-000000000217', :dm, :hd, 9200, 'general');
select pg_temp.assert(pg_temp.jobs('18400000-0000-4000-8000-000000000217') = 0, 'A · a demo community queues nothing even with the row switched on');
delete from app.email_automations where center_id = :dm;

-- The backfill keeps what a person switched off and switches on what no person ever decided (the statement of 0790, run on two rows).
update app.email_automations set enabled = false where center_id = :bk1 and trigger_key = 'pledge_recorded';
delete from app.email_automations where center_id = :bk2 and trigger_key = 'pledge_recorded';
insert into app.email_automations (center_id, kind, trigger_key, template_key, enabled) values (:bk2, 'trigger', 'pledge_recorded', 'pledge_recorded', false);
update app.email_automations a
   set enabled = true
 where a.kind = 'trigger' and a.trigger_key = 'pledge_recorded' and not a.enabled
   and not exists (select 1 from app.audit_log l
                    where l.record_table = 'email_automations' and l.record_id = a.id::text and l.action = 'email_automations.update'
                      and l.before->>'enabled' = 'true' and l.after->>'enabled' = 'false');
select pg_temp.assert(not (select enabled from app.email_automations where center_id = :bk1 and trigger_key = 'pledge_recorded')
                      and (select enabled from app.email_automations where center_id = :bk2 and trigger_key = 'pledge_recorded'),
  'A · the backfill leaves an email a person switched off alone, and switches on a row that only saving wording had made');

set role authenticated;
select pg_temp.claims(:exec);
select pg_temp.assert((select count(*) = 3 and bool_and((e->>'enabled')::boolean = (e->>'key' = 'pledge_recorded'))
                         from jsonb_array_elements(app.email_automations_state(:jc, 18)->'emails') e),
  'A · Settings › Automatic emails shows the pledge confirmation on and the other two off');
reset role;

-- ══ B. Who gets it: the primary member ═══════════════════════════════════════
select id as auto from app.email_automations where center_id = :jc and trigger_key = 'pledge_recorded' \gset
select id as auto_sb from app.email_automations where center_id = :sb and trigger_key = 'pledge_recorded' \gset
select jsonb_object_agg(n, 'v-' || n)::text as vars from unnest(app._email_placeholders('pledge_recorded')) n \gset
insert into app.pledges (id, center_id, household_id, amount_cents, source) values
  (:p11, :jc, :h2, 11000, 'general'), (:p12, :jc, :h3, 12000, 'general'), (:p13, :jc, :h4, 13000, 'general');
set role connect_worker;
select app.worker_email_facts(:'auto', :p1, 18) as f_noappr \gset
reset role;
select pg_temp.assert(:'f_noappr'::jsonb->>'skip' like 'Not sent: The treasurer has not approved%'
                      and (select reason_code = 'not_approved' and to_address = '' and outcome = 'skipped' from app.email_automation_sends
                            where ref_id = :p1 and period = ''),
  'B · until the treasurer approves the receipt templates the automatic email waits, says so, and the log has the reason code');
select pg_temp.assert(pg_temp.audits(:p1, 'pledge.email_not_sent') = 1,
  'B · and the pledge''s History has the entry');
set role authenticated;
select pg_temp.claims(:treas);
select app.approve_statement_templates(:jc, 'Approved in test 184');
reset role;
set role connect_worker;
select app.worker_email_facts(:'auto', :p6, 18) as f6 \gset
select app.worker_email_facts(:'auto', :p11, 18) as f11 \gset
select app.worker_email_facts(:'auto', :p12, 18) as f12 \gset
select app.worker_email_facts(:'auto', :p13, 18) as f13 \gset
reset role;
select pg_temp.assert(:'f6'::jsonb->>'skip' is null
                      and :'f6'::jsonb->'recipients' = jsonb_build_array(jsonb_build_object('person_id', :mira, 'address', 'mira184@temple.test',
                            'first_name', 'Mira', 'name', 'Mira Member184', 'language', 'en'))
                      and :'f6'::jsonb #> '{household,minor_first_names}' = '["Kiran"]',
  'B · the pledge email goes to the primary member (her address in lower case), with the child''s first name to keep out');
select pg_temp.assert(:'f11'::jsonb->>'skip' = 'Not sent: The primary member (Ravi Second184) has no email address on file.'
                      and :'f11'::jsonb->'recipients' = '[]'::jsonb
                      and (select reason_code = 'no_email' from app.email_automation_sends where ref_id = :p11 and period = ''),
  'B · a primary member with no address: nothing is sent, not even to the spouse who has one, and the reason is logged with its code');
select pg_temp.assert(pg_temp.audits(:p11, 'pledge.email_not_sent') = 1
                      and (select after->>'why' from app.audit_log where record_id = :p11 and action = 'pledge.email_not_sent') like '%has no email address%',
  'B · the pledge''s History says why nothing was sent');
select pg_temp.assert(:'f12'::jsonb->>'skip' like 'Not sent: The primary member (Tween Third184) is under age%'
                      and :'f13'::jsonb->>'skip' = 'Not sent: This household has no primary member on file, so there is nobody to email.',
  'B · a child as primary member, and a household with no primary member: nothing is sent, and the sentence says which');

-- ══ C. Queueing ══════════════════════════════════════════════════════════════
set role connect_worker;
select app.worker_email_enqueue(:'auto', :p6, '', :h1, :mira, 'mira184@temple.test', :'vars'::jsonb) as q1 \gset
select app.worker_email_enqueue(:'auto', :p6, '', :h1, null, 'other184@temple.test', :'vars'::jsonb) as q2 \gset
reset role;
select pg_temp.assert(:'q1'::jsonb->>'outcome' = 'queued' and :'q2'::jsonb->>'outcome' = 'duplicate',
  'C · queued once; the same pledge to a second address is a duplicate (once per pledge, whatever the address)');
select pg_temp.assert((select count(*) = 1 from app.messages where payload->>'ref_id' = :p6),
  'C · and only one message exists');
select pg_temp.assert((select m.payload->'attachments' = jsonb_build_array(jsonb_build_object('kind', 'pledge_pdf', 'pledge_id', :p6::text))
                              and m.payload->>'automation_id' = :'auto' and m.purpose = 'receipt' and m.template_key = 'pledge_recorded'
                              and m.subject = 'Your pledge v-pledge_number to v-center_name' and m.to_address = 'mira184@temple.test'
                         from app.messages m where m.id = (:'q1'::jsonb->>'message_id')::uuid),
  'C · the message names the pledge''s PDF by id only (no bytes, no name), goes as a receipt, to the primary member, with the community''s wording');
select pg_temp.assert(pg_temp.audits(:p6, 'pledge.email_queued') = 1
                      and (select after->>'to' = 'mira184@temple.test' and after->>'how' like 'Sent automatically%'
                             from app.audit_log where record_id = :p6 and action = 'pledge.email_queued'),
  'C · the pledge''s History says it was queued, to which address, and that it was automatic');
select (:'q1'::jsonb->>'message_id') as msg6 \gset

-- ══ D. The PDF's facts ═══════════════════════════════════════════════════════
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, receipt_number)
values (:pay1, :jc, :h1, :mira, 4000, 'zelle', 'captured', 'offline', 'R-184-0001');
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents) values (:jc, :pay1, :p6, 4000);
set role authenticated;
select pg_temp.claims(:treas);
select app.pledge_document(:jc, :p6, 18) as doc \gset
select pg_temp.claims(:exec);
select app.pledge_document(:jc, :p6, 18) as doc_exec \gset
reset role;
select pg_temp.assert(:'doc'::jsonb #>> '{center,name}' = 'Temple 184' and :'doc'::jsonb #>> '{center,branding,primary}' = '#123456'
                      and :'doc'::jsonb #>> '{center,branding,logo_path}' like '%/brand/logo-1.png'
                      and :'doc'::jsonb #>> '{organization,legal_name}' = 'Temple 184 Inc.' and :'doc'::jsonb #>> '{organization,ein}' = '12-3456789'
                      and :'doc'::jsonb #>> '{pledge,amount_cents}' = '10000' and :'doc'::jsonb #>> '{pledge,status}' in ('open', 'partially_paid')
                      and :'doc'::jsonb #>> '{pledge,pledged_at}' = ((now() - interval '5 days') at time zone 'America/Chicago')::date::text
                      and :'doc'::jsonb #>> '{household,number}' = :'hn1' and :'doc'::jsonb #>> '{household,primary_member}' = 'Mira Member184'
                      and :'doc'::jsonb #>> '{household,address,line1}' = '12 Oak St' and :'doc'::jsonb #>> '{household,address,city}' = 'Houston'
                      and :'doc'::jsonb #>> '{wording,signed_by}' = 'The Treasurer 184' and :'doc'::jsonb #>> '{wording,personal_note}' = 'Thank you 184',
  'D · the PDF facts: the community''s brand and profile, the pledge, the household as its card shows it, the primary member and address, the signer and note');
select pg_temp.assert(jsonb_array_length(:'doc'::jsonb->'payments') = 1 and :'doc'::jsonb #>> '{payments,0,receipt_number}' = 'R-184-0001'
                      and :'doc'::jsonb #>> '{payments,0,amount_cents}' = '4000' and :'doc'::jsonb #>> '{payments,0,method}' = 'zelle',
  'D · the payments applied to the pledge: date, method, receipt number and what was applied');
select pg_temp.assert(:'doc'::jsonb #> '{household,minor_first_names}' = '["Kiran"]'
                      and :'doc'::text not like '%mira184%' and :'doc'::text not like '%kiran184%' and :'doc'::text not like '%1980%'
                      and :'doc'::text not like '%date_of_birth%',
  'D · the children''s first names are listed so the writer keeps them out; no email address or birth date is in the document');
select pg_temp.assert(:'doc_exec'::jsonb #>> '{pledge,amount_cents}' = '10000', 'D · a committee member with giving.view reads it too');
set role authenticated;
select pg_temp.claims(:vol);
select pg_temp.assert_raises(format($$select app.pledge_document(%L, %L, 18)$$, :jc, :p6), 'don''t have access', 'D · a finance volunteer (no giving.view) cannot');
select pg_temp.claims(:octreas);
select pg_temp.assert_raises(format($$select app.pledge_document(%L, %L, 18)$$, :oc, :p6), 'was not found', 'D · another community''s treasurer asking in their own community: not found');
select pg_temp.assert_raises(format($$select app.pledge_document(%L, %L, 18)$$, :jc, :p6), 'don''t have access', 'D · and in this community: no access');
select pg_temp.assert_raises(format($$select app.pledge_document(%L, %L, 18)$$, :jc, '18400000-0000-4000-8000-0000000009ff'), 'was not found', 'D · a pledge that does not exist: not found');
select pg_temp.assert_raises(format($$select app.worker_pledge_document(%L, %L, 18)$$, :'msg6', :p6), 'Only the background service', 'D · only the background service reads for a message');
reset role;
set role connect_worker;
select app.worker_pledge_document(:'msg6', :p6, 18) as wdoc \gset
select app.worker_pledge_document(:'msg6', :p1, 18) as wdoc_other \gset
select app.worker_pledge_document('18400000-0000-4000-8000-0000000009ff', :p6, 18) as wdoc_nomsg \gset
reset role;
select pg_temp.assert(:'wdoc'::jsonb #>> '{pledge,number}' is not distinct from :'doc'::jsonb #>> '{pledge,number}' and :'wdoc'::jsonb #>> '{pledge,amount_cents}' = '10000'
                      and :'wdoc_other' = '' and :'wdoc_nomsg' = '',
  'D · the background service gets the pledge the message names, nothing for another pledge or a message that does not exist');

-- ══ E. Emailing by hand ══════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:treas);
select (app.send_pledge_email(:jc, :p6, '  Typed.Person@Example.ORG ', 'key-184-0001'))->>'request_id' as req1 \gset
select (app.send_pledge_email(:jc, :p6, 'Typed.Person@Example.ORG', 'key-184-0001')) as again \gset
select (app.send_pledge_email(:jc, :p6, 'mira184@temple.test', 'key-184-0002'))->>'request_id' as req2 \gset
select app.pledge_email_recipient(:jc, :p6, 18) as sheet \gset
reset role;
select pg_temp.assert((select to_address = 'typed.person@example.org' and status = 'requested' and requested_by = :treas and household_id = :h1
                         from app.pledge_emails where id = :'req1'::uuid),
  'E · the request records who, which pledge, which address (trimmed, lower case) and when');
select pg_temp.assert(:'again'::jsonb->>'request_id' = :'req1' and (:'again'::jsonb->>'replayed')::boolean
                      and (select count(*) from app.pledge_emails where idempotency_key = 'key-184-0001') = 1
                      and (select count(*) from app.jobs where kind = 'messaging.compose' and payload->>'request_id' = :'req1') = 1,
  'E · clicking twice (the same confirmation key) is one request and one job');
select pg_temp.assert((select payload::text not like '%@%' and payload->>'automation_id' = :'auto' and payload->>'ref_id' = :p6
                         from app.jobs where kind = 'messaging.compose' and payload->>'request_id' = :'req1'),
  'E · the job carries ids only: no address anywhere in it');
select pg_temp.assert(pg_temp.audits(:p6, 'pledge.email_requested') = 2
                      and (select actor_user_id = :treas and after->>'to' = 'typed.person@example.org' and after->>'how' = 'Emailed from the pledge menu'
                             from app.audit_log where record_id = :p6 and action = 'pledge.email_requested' and after->>'to' = 'typed.person@example.org'),
  'E · the pledge''s History says who emailed which address');
select pg_temp.assert(:'sheet'::jsonb #>> '{primary,email}' = 'mira184@temple.test' and :'sheet'::jsonb #>> '{primary,name}' = 'Mira Member184'
                      and :'sheet'::jsonb #>> '{primary,problem}' is null and jsonb_array_length(:'sheet'::jsonb->'earlier') >= 2,
  'E · the Email sheet opens with the primary member and her address, and what was sent before');
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'someone@example.org', 'key-184-0001')$$, :jc, :p6), 'already used for a different email',
  'E · the same key for a different address is refused');
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'a@b', 'key-184-bad01')$$, :jc, :p6), 'is not one email address', 'E · an address with no dot in its domain is refused');
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'a@b.co, c@d.co', 'key-184-bad02')$$, :jc, :p6), 'is not one email address', 'E · two addresses are refused');
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'no at sign.org', 'key-184-bad03')$$, :jc, :p6), 'is not one email address', 'E · so is text without an @');
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, '   ', 'key-184-bad04')$$, :jc, :p6), 'Type the email address', 'E · an empty box asks for an address');
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'a@b.co', 'short')$$, :jc, :p6), 'confirmation key', 'E · a short confirmation key is refused');
reset role;
insert into app.pledges (id, center_id, household_id, amount_cents, source, status) values (:p14, :jc, :h1, 14000, 'general', 'cancelled');
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'a@b.co', 'key-184-bad05')$$, :jc, :p14), 'deleted (cancelled)', 'E · a deleted pledge has nothing to send');
select pg_temp.claims(:exec);
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'a@b.co', 'key-184-bad06')$$, :jc, :p6), 'it needs giving.manage', 'E · a committee member (giving.view only) cannot email a pledge');
select pg_temp.assert_raises(format($$select app.pledge_email_recipient(%L, %L, 18)$$, :jc, :p6), 'don''t have access', 'E · nor open the sheet');
select pg_temp.claims(:vol);
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'a@b.co', 'key-184-bad07')$$, :jc, :p6), 'it needs giving.manage', 'E · nor a finance volunteer');
select pg_temp.claims(:octreas);
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'a@b.co', 'key-184-bad08')$$, :oc, :p6), 'was not found', 'E · another community''s treasurer cannot reach this community''s pledge');
reset role;

-- The service writes it for that one address; a household adult at that address is greeted by name.
set role connect_worker;
select app.worker_pledge_email_request(:'req1'::uuid, 18) as r1 \gset
select app.worker_pledge_email_request(:'req2'::uuid, 18) as r2 \gset
reset role;
select pg_temp.assert(:'r1'::jsonb->>'skip' is null and :'r1'::jsonb->'recipients' = jsonb_build_array(jsonb_build_object('person_id', null,
                        'address', 'typed.person@example.org', 'first_name', null, 'name', null, 'language', null))
                      and :'r1'::jsonb #>> '{automation,key}' = 'pledge_recorded' and :'r1'::jsonb #>> '{pledge,number}' is not distinct from :'doc'::jsonb #>> '{pledge,number}',
  'E · the typed address is the only recipient of a request (nobody is guessed)');
select pg_temp.assert(:'r2'::jsonb #>> '{recipients,0,person_id}' = :mira and :'r2'::jsonb #>> '{recipients,0,first_name}' = 'Mira'
                      and jsonb_array_length(:'r2'::jsonb->'recipients') = 1,
  'E · an address that belongs to an adult of the household greets that person by name');
set role connect_worker;
select app.worker_email_enqueue(:'auto', :p6, 'manual:' || :'req1', :h1, null, 'typed.person@example.org', :'vars'::jsonb) as qm1 \gset
select app.worker_email_enqueue(:'auto', :p6, 'manual:' || :'req2', :h1, :mira, 'mira184@temple.test', :'vars'::jsonb) as qm2 \gset
reset role;
select pg_temp.assert(:'qm1'::jsonb->>'outcome' = 'queued' and :'qm2'::jsonb->>'outcome' = 'queued'
                      and (select count(*) = 3 from app.messages where payload->>'ref_id' = :p6),
  'E · by hand the same pledge can go again, each time as its own message (the automatic one is not a duplicate of it)');
select pg_temp.assert((select status = 'queued' and message_id = (:'qm1'::jsonb->>'message_id')::uuid and reason is null from app.pledge_emails where id = :'req1'::uuid)
                      and (select m.payload->'attachments' = jsonb_build_array(jsonb_build_object('kind', 'pledge_pdf', 'pledge_id', :p6::text)) and m.to_address = 'typed.person@example.org'
                             from app.messages m where m.id = (:'qm1'::jsonb->>'message_id')::uuid),
  'E · the request knows its message, and the message carries the PDF');
set role authenticated;
select pg_temp.claims(:treas);
select app.pledge_email_request_status(:jc, :'req1'::uuid) as st1 \gset
reset role;
set role connect_worker;
select app.worker_message_result((:'qm1'::jsonb->>'message_id')::uuid, 'sent', 'resend', 're_184_1', null, null);
select app.worker_message_result((:'qm2'::jsonb->>'message_id')::uuid, 'failed', 'resend', null, 'Resend could not send the email (HTTP 422: the recipient was rejected)', null);
reset role;
set role authenticated;
select pg_temp.claims(:treas);
select app.pledge_email_request_status(:jc, :'req1'::uuid) as st1b \gset
select app.pledge_email_request_status(:jc, :'req2'::uuid) as st2 \gset
select pg_temp.claims(:exec);
select pg_temp.assert_raises(format($$select app.pledge_email_request_status(%L, %L)$$, :jc, :'req1'), 'don''t have access', 'E · a committee member cannot read a request''s status');
reset role;
select pg_temp.assert(:'st1'::jsonb->>'status' = 'waiting' and :'st1b'::jsonb->>'status' = 'sent' and :'st1b'::jsonb->>'to' = 'typed.person@example.org'
                      and :'st2'::jsonb->>'status' = 'failed' and :'st2'::jsonb->>'reason' like 'Resend could not send%',
  'E · what happened is readable: waiting while queued, sent, or failed with the provider''s reason');

-- Not held back by the automatic email's approval (a person writes to a family on purpose), the automatic email still is.
set role authenticated;
select pg_temp.claims(:treas);
select app.save_email_automation_wording(:jc, 'pledge_recorded', 'en', 'Pledge {{pledge_number}} from {{center_name}}', 'Dear {{recipient_first_name}}, thank you. {{pledge_amount}}') as w \gset
select (app.send_pledge_email(:jc, :p6, 'late@example.org', 'key-184-0003'))->>'request_id' as req3 \gset
reset role;
insert into app.pledges (id, center_id, household_id, amount_cents, source) values (:p15, :jc, :h1, 15000, 'general');
set role connect_worker;
select app.worker_email_facts(:'auto', :p15, 18) as f15 \gset
select app.worker_pledge_email_request(:'req3'::uuid, 18) as r3 \gset
reset role;
select pg_temp.assert(not (app.check_statement_templates_approved(:jc)->>'ok')::boolean
                      and :'f15'::jsonb->>'skip' like 'Not sent: The templates changed after%'
                      and (select reason_code = 'not_approved' from app.email_automation_sends where ref_id = :p15 and period = ''),
  'E · after the community saves its own pledge wording the automatic email waits for the treasurer''s new approval, and says so');
select pg_temp.assert(:'r3'::jsonb->>'skip' is null and :'r3'::jsonb #>> '{recipients,0,address}' = 'late@example.org',
  'E · and an email sent by hand goes anyway');

-- The hourly limit: 40 for one person.
select count(*) as n_sent from app.pledge_emails where requested_by = :treas \gset
select pg_temp.fill(:treas, :jc, :p6, 40 - :n_sent);
set role authenticated;
select pg_temp.claims(:treas);
select pg_temp.assert_raises(format($$select app.send_pledge_email(%L, %L, 'onemore@example.org', 'key-184-limit')$$, :jc, :p6), 'emailed 40 pledges in the last hour',
  'E · the 41st email in an hour is refused, with a plain sentence');
reset role;

-- ══ F. A sandbox ═════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:sbtreas);
select app.approve_statement_templates(:sb, 'Sandbox test 184');
select (app.send_pledge_email(:sb, :p8, 'someone@example.org', 'key-184-sb01'))->>'request_id' as reqs \gset
reset role;
set role connect_worker;
select app.worker_email_enqueue(:'auto_sb', :p8, 'manual:' || :'reqs', :hs, null, 'someone@example.org', :'vars'::jsonb) as qs \gset
select app.worker_email_enqueue(:'auto_sb', :p8, '', :hs, :sam, 'sam184@sandbox.test', :'vars'::jsonb) as qs2 \gset
reset role;
select pg_temp.assert(:'qs'::jsonb->>'outcome' = 'skipped' and :'qs'::jsonb->>'reason' like '%only to verified test recipients%'
                      and (select status = 'not_sent' and reason_code = 'sandbox' and message_id is null from app.pledge_emails where id = :'reqs'::uuid)
                      and :'qs2'::jsonb->>'outcome' = 'skipped'
                      and not exists (select 1 from app.messages where center_id = :sb and payload->>'ref_id' = :p8),
  'F · a sandbox sends only to verified test recipients, by hand and automatically; nothing is queued, the request says why, and the code is "sandbox"');
set role authenticated;
select pg_temp.claims(:sbtreas);
select app.pledge_email_request_status(:sb, :'reqs'::uuid) as sts \gset
reset role;
select pg_temp.assert(:'sts'::jsonb->>'status' = 'not_sent' and :'sts'::jsonb->>'reason' like '%verified test recipients%',
  'F · and the person who clicked can read it');

-- ══ G. A bulk upload ═════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:treas);
select app.approve_statement_templates(:jc, 'The new wording approved in test 184');
reset role;
create or replace function pg_temp.upload(p_user uuid, p_center uuid, p_key text, p_rows jsonb, p_emails boolean default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  if p_emails is null then
    r := app.record_pledge_upload(p_center, p_key, 'pledges.csv', repeat('b', 64), 'Pledge cards from the dinner', p_rows);
  else
    r := app.record_pledge_upload(p_center, p_key, 'pledges.csv', repeat('b', 64), 'Pledge cards from the dinner', p_rows, p_emails);
  end if;
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;
select pg_temp.upload(:treas, :jc, 'upl-184-0001', jsonb_build_array(
         jsonb_build_object('row', 1, 'household_id', :h1, 'amount_cents', 5001),
         jsonb_build_object('row', 2, 'household_id', :h2, 'amount_cents', 5002),
         jsonb_build_object('row', 3, 'household_id', :h1, 'amount_cents', 5003, 'pledged_on', (current_date - 45)::text))) as up1 \gset
select pg_temp.assert((:'up1'::jsonb->>'emails')::boolean and :'up1'::jsonb->>'count' = '3',
  'G · an upload without the choice emails by default, and says so in its result');
select pg_temp.assert((select count(*) = 1 from app.jobs where kind = 'messaging.compose' and payload->>'ref_id' = (:'up1'::jsonb #>> '{pledges,0,pledge_id}'))
                      and (select count(*) = 1 from app.jobs where kind = 'messaging.compose' and payload->>'ref_id' = (:'up1'::jsonb #>> '{pledges,1,pledge_id}'))
                      and (select count(*) = 0 from app.jobs where kind = 'messaging.compose' and payload->>'ref_id' = (:'up1'::jsonb #>> '{pledges,2,pledge_id}')),
  'G · each pledge of the upload queues one email job; the row dated 45 days ago is history and queues none');
select pg_temp.upload(:treas, :jc, 'upl-184-0001', jsonb_build_array(
         jsonb_build_object('row', 1, 'household_id', :h1, 'amount_cents', 5001),
         jsonb_build_object('row', 2, 'household_id', :h2, 'amount_cents', 5002),
         jsonb_build_object('row', 3, 'household_id', :h1, 'amount_cents', 5003, 'pledged_on', (current_date - 45)::text))) as up1b \gset
select pg_temp.assert((:'up1b'::jsonb->>'replayed')::boolean
                      and (select count(*) from app.jobs where kind = 'messaging.compose' and payload->>'ref_id' in
                             (select e->>'pledge_id' from jsonb_array_elements(:'up1'::jsonb->'pledges') e)) = 2,
  'G · recording the same upload again (the same key) queues nothing more');
select (:'up1'::jsonb #>> '{pledges,0,pledge_id}') as u1 \gset
select (:'up1'::jsonb #>> '{pledges,1,pledge_id}') as u2 \gset
select (:'up1'::jsonb #>> '{pledges,2,pledge_id}') as u3 \gset
set role authenticated;
select pg_temp.claims(:treas);
select app.pledge_email_status(:jc, array[:'u1', :'u2', :'u3']::uuid[], 18) as stat1 \gset
reset role;
select pg_temp.assert((select count(*) = 3 and bool_or(e->>'pledge_id' = :'u1' and e->>'state' = 'pending')
                          and bool_or(e->>'pledge_id' = :'u2' and e->>'state' = 'no_email' and e->>'reason' like 'Not sent: The primary member (Ravi Second184) has no email%')
                          and bool_or(e->>'pledge_id' = :'u3' and e->>'state' = 'history' and e->>'reason' like '%more than 30 days%')
                         from jsonb_array_elements(:'stat1'::jsonb) e),
  'G · the result says which pledges are waiting, which family has no email address (and why), and which are history');
-- The service gets to them.
set role connect_worker;
select app.worker_email_facts(:'auto', :'u2', 18) as fu2 \gset
select app.worker_email_enqueue(:'auto', :'u1', '', :h1, :mira, 'mira184@temple.test', :'vars'::jsonb) as qu1 \gset
reset role;
select pg_temp.assert(:'qu1'::jsonb->>'outcome' = 'queued'
                      and (select m.payload->'attachments'->0->>'pledge_id' = :'u1' from app.messages m where m.id = (:'qu1'::jsonb->>'message_id')::uuid),
  'G · an uploaded pledge''s email carries its own PDF');
set role authenticated;
select pg_temp.claims(:treas);
select app.pledge_email_status(:jc, array[:'u1', :'u2']::uuid[], 18) as stat2 \gset
reset role;
select pg_temp.assert((select bool_or(e->>'pledge_id' = :'u1' and e->>'state' = 'waiting') and bool_or(e->>'pledge_id' = :'u2' and e->>'state' = 'no_email')
                         from jsonb_array_elements(:'stat2'::jsonb) e),
  'G · once queued the email is "waiting" until the provider takes it');
set role connect_worker;
select app.worker_message_result((:'qu1'::jsonb->>'message_id')::uuid, 'sent', 'resend', 're_184_u1', null, null);
reset role;
set role authenticated;
select pg_temp.claims(:treas);
select app.pledge_email_status(:jc, array[:'u1']::uuid[], 18) as stat3 \gset
reset role;
select pg_temp.assert(:'stat3'::jsonb #>> '{0,state}' = 'sent', 'G · and "sent" once it was');

-- Unticked: nothing is queued, and each pledge says why.
select pg_temp.upload(:treas, :jc, 'upl-184-0002', jsonb_build_array(
         jsonb_build_object('row', 1, 'household_id', :h1, 'amount_cents', 6001),
         jsonb_build_object('row', 2, 'household_id', :h2, 'amount_cents', 6002)), false) as up2 \gset
select (:'up2'::jsonb #>> '{pledges,0,pledge_id}') as d1 \gset
select (:'up2'::jsonb #>> '{pledges,1,pledge_id}') as d2 \gset
select pg_temp.assert(not (:'up2'::jsonb->>'emails')::boolean
                      and pg_temp.jobs(:'d1'::uuid) + pg_temp.jobs(:'d2'::uuid) = 0
                      and (select count(*) = 2 and bool_and(reason_code = 'declined' and outcome = 'skipped') from app.email_automation_sends where ref_id in (:'d1'::uuid, :'d2'::uuid))
                      and pg_temp.audits(:'d1'::uuid, 'pledge.email_not_sent') = 1,
  'G · "Email each family" unticked: no email job is queued, each pledge has a log row with the reason code "declined", and its History says so');
select pg_temp.assert(coalesce(current_setting('app.pledge_email', true), '') <> 'off',
  'G · the choice ends with the upload''s transaction (it never switches the emails off for anything else)');
set role authenticated;
select pg_temp.claims(:treas);
select app.pledge_email_status(:jc, array[:'d1', :'d2']::uuid[], 18) as stat4 \gset
select pg_temp.claims(:vol);
select pg_temp.assert_raises(format($$select app.pledge_email_status(%L, array[%L]::uuid[], 18)$$, :jc, :'d1'), 'don''t have access', 'G · a finance volunteer cannot read the status');
reset role;
select pg_temp.assert((select bool_and(e->>'state' = 'declined') and count(*) = 2 from jsonb_array_elements(:'stat4'::jsonb) e),
  'G · and the status says "declined" for both');
-- The six-argument call of 0776 still works (the choice defaults to emailing).
select pg_temp.upload(:treas, :jc, 'upl-184-0003', jsonb_build_array(jsonb_build_object('row', 1, 'household_id', :h1, 'amount_cents', 7001))) as up3 \gset
select pg_temp.assert((:'up3'::jsonb->>'emails')::boolean and pg_temp.jobs((:'up3'::jsonb #>> '{pledges,0,pledge_id}')::uuid) = 1,
  'G · the old six-argument call still works and emails');

-- The automatic email switched off: the status says so, and nothing is queued.
set role authenticated;
select pg_temp.claims(:treas);
select app.set_email_automation(:jc, 'pledge_recorded', false);
reset role;
insert into app.pledges (id, center_id, household_id, amount_cents, source) values ('18400000-0000-4000-8000-000000000216', :jc, :h1, 16000, 'general');
set role authenticated;
select pg_temp.claims(:treas);
select app.pledge_email_status(:jc, array['18400000-0000-4000-8000-000000000216']::uuid[], 18) as stat5 \gset
reset role;
select pg_temp.assert(pg_temp.jobs('18400000-0000-4000-8000-000000000216') = 0 and :'stat5'::jsonb #>> '{0,state}' = 'switched_off'
                      and :'stat5'::jsonb #>> '{0,reason}' like '%switched off%Settings › Automatic emails%',
  'G · when the community switches the pledge email off, new pledges queue nothing and the status says it is switched off');

-- ══ H. Grants, privacy, catalog ══════════════════════════════════════════════
select pg_temp.assert(not has_table_privilege('authenticated', 'app.pledge_emails', 'select') and not has_table_privilege('anon', 'app.pledge_emails', 'select')
                      and (select relrowsecurity from pg_class where oid = 'app.pledge_emails'::regclass),
  'H · nobody reads the table of emails directly (the addresses): row level security on, no grant');
select pg_temp.assert(has_function_privilege('authenticated', 'app.send_pledge_email(uuid, uuid, text, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.pledge_document(uuid, uuid, integer)', 'execute')
                      and has_function_privilege('authenticated', 'app.pledge_email_status(uuid, uuid[], integer)', 'execute')
                      and not has_function_privilege('anon', 'app.send_pledge_email(uuid, uuid, text, text)', 'execute')
                      and not has_function_privilege('anon', 'app.pledge_document(uuid, uuid, integer)', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_pledge_document(uuid, uuid, integer)', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_pledge_email_request(uuid, integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_pledge_document(uuid, uuid, integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_pledge_email_request(uuid, integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app._pledge_document_core(uuid, integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app._pledge_primary_contact(uuid, integer)', 'execute')
                      and not has_function_privilege('authenticated', 'app._pledge_email_automation(uuid)', 'execute'),
  'H · the portal''s functions are for signed-in people, the service''s for the service only, the internal ones for nobody');
select pg_temp.assert(exists (select 1 from app.activity_catalog where key = 'giving.email_pledge'),
  'H · the Email action is in the activity catalog');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'pledge_emails' and action = 'pledge_emails.insert'),
  'H · each request of the emails table is audited as a row too');

rollback;
