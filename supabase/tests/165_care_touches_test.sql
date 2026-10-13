-- 0762-0763 (WeCare slice 2, docs/WECARE.md sections 3 and 5.1-5.3): the touch log and the Care card.
--   A. Recording touches: the one-tap presets, ask or no ask, a care moment is never an ask, adults only, never in the
--      future, the household's readers only; removing one from the log (the author or a manager), never deleting it.
--   B. The touches Weaver already knows, read live from their own tables: messages sent and opened (never their subject),
--      receipts (the amount only with care_amounts_can), statements, event check-ins and volunteer shifts; nothing about
--      anyone under 18; receipts sent by message are not counted twice; paging; a switched-off module's source goes.
--   C. The Care card: the household without its children, the People fields read where they live and only with
--      people.view through the organization, the latest touch and the counts; no amounts.
--   D. Platform admins and anyone else get nothing; every read is logged without names.
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
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- The sources of a touch log, in order.
create or replace function pg_temp.sources(j jsonb) returns text[] language sql as $$
  select coalesce(array_agg(e->>'source' order by i), '{}') from jsonb_array_elements(j->'rows') with ordinality as x(e, i)
$$;

\set c1 '''16500000-0000-4000-8000-0000000000c1'''
\set owner '''16500000-0000-4000-8000-000000000001'''
\set plat '''16500000-0000-4000-8000-000000000002'''
\set lead '''16500000-0000-4000-8000-000000000003'''
\set fin '''16500000-0000-4000-8000-000000000004'''
\set rel '''16500000-0000-4000-8000-000000000005'''
\set relb '''16500000-0000-4000-8000-000000000006'''
\set viewer '''16500000-0000-4000-8000-000000000007'''
\set h1 '''16500000-0000-4000-8000-0000000000b1'''
\set h2 '''16500000-0000-4000-8000-0000000000b2'''
\set pa '''16500000-0000-4000-8000-0000000000a1'''
\set pb '''16500000-0000-4000-8000-0000000000a2'''
\set pk '''16500000-0000-4000-8000-0000000000a3'''
\set pc '''16500000-0000-4000-8000-0000000000a4'''
\set ev '''16500000-0000-4000-8000-0000000000e1'''
\set rs '''16500000-0000-4000-8000-0000000000e2'''
\set sh1 '''16500000-0000-4000-8000-0000000000e3'''
\set sh2 '''16500000-0000-4000-8000-0000000000e4'''
\set pay '''16500000-0000-4000-8000-0000000000f1'''
\set pay2 '''16500000-0000-4000-8000-0000000000f2'''
\set pay3 '''16500000-0000-4000-8000-0000000000f3'''
\set pay4 '''16500000-0000-4000-8000-0000000000f4'''
\set pay5 '''16500000-0000-4000-8000-0000000000f5'''
\set pf '''16500000-0000-4000-8000-0000000000a5'''
\set pn '''16500000-0000-4000-8000-0000000000a6'''
\set cc1 '''16500000-0000-4000-8000-0000000000d1'''
\set cc2 '''16500000-0000-4000-8000-0000000000d2'''

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner165@c1.test'), (:plat, 'plat165@weaver.test'), (:lead, 'lead165@c1.test'), (:fin, 'fin165@c1.test'),
  (:rel, 'rel165@c1.test'), (:relb, 'relb165@c1.test'), (:viewer, 'viewer165@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
-- A church (a faith kind: WeCare is "Member care" there).
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'care165', 'Grace Church 165', 'G165', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 165: WeCare');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('care_viewer_165', 'center', 'Care viewer 165', 'center', 'Test 165', '["care.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 165: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 165'),
  (:c1, :fin, 'care_lead', 'center', 'Test 165'), (:c1, :fin, 'treasurer', 'center', 'Test 165: giving.view and people.view'),
  (:c1, :rel, 'relationship_owner', 'center', 'Test 165'), (:c1, :relb, 'relationship_owner', 'center', 'Test 165'),
  (:c1, :viewer, 'care_viewer_165', 'center', 'Test 165');
insert into app.households (id, center_id, display_name, physical_mail_opt_in) values
  (:h1, :c1, 'Mensah165, Ama', true), (:h2, :c1, 'Lee165, Jo', true);
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pa, :c1, 'Ama', 'Mensah165', date '1981-01-01'), (:pb, :c1, 'Kofi', 'Mensah165', date '1978-02-02'),
  (:pk, :c1, 'Esi', 'Mensah165', (current_date - interval '8 years')::date), (:pc, :c1, 'Jo', 'Lee165', date '1970-03-03'),
  (:pf, :c1, 'Fia', 'Mensah165', date '1999-09-09'), (:pn, :c1, 'Nana', 'Mensah165', null);
-- Fia left this household ten days ago and lives with the Lees now; Nana is a child with no birth date on file (a child in
-- a household and primary or spouse in none: app.person_is_minor counts her as under 18, 0587).
insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at, left_at) values
  (:h1, :pa, :c1, 'primary', true, null, null), (:h1, :pb, :c1, 'spouse', false, null, null), (:h1, :pk, :c1, 'child', false, null, null),
  (:h1, :pn, :c1, 'child', false, null, null), (:h1, :pf, :c1, 'other', false, current_date - 700, current_date - 10),
  (:h2, :pc, :c1, 'primary', true, null, null), (:h2, :pf, :c1, 'other', false, current_date - 9, null);
insert into app.care_owners (household_id, center_id, owner_user_id, assigned_by) values (:h1, :c1, :rel, :lead);
-- People fields, where they live.
update app.people set interests = array['gardening'], expertise_tags = array['law'], best_call_time = 'evening', language = 'es'
 where id = :pa;
update app.people set interests = array['football'] where id = :pk;
insert into app.dietary_options (center_id, key, label) values (:c1, 'vegan', 'Vegan')
  on conflict (center_id, key) do update set label = excluded.label;
insert into app.person_profile_details (person_id, center_id, anniversary, dietary) values
  (:pa, :c1, date '2005-06-01', array['vegan']);
insert into app.special_days (center_id, household_id, person_id, kind, label, calendar_date) values
  (:c1, :h1, :pa, 'birthday', null, date '1981-01-01'), (:c1, :h1, :pk, 'birthday', null, (current_date - interval '8 years')::date),
  (:c1, :h1, null, 'anniversary', 'Wedding', date '2005-06-01');
insert into app.consents (center_id, person_id, kind, granted, source) values
  (:c1, :pa, 'marketing_email', true, 'app'), (:c1, :pb, 'sms', false, 'app');
-- What Weaver already knows.
-- Campaigns: a newsletter (counts) and a class update (a learning programme: never counts).
insert into app.comms_campaigns (id, center_id, kind, title, status) values
  (:cc1, :c1, 'newsletter', 'Spring newsletter 165', 'sent'), (:cc2, :c1, 'pathshala_update', 'Class news 165', 'sent');
insert into app.messages (center_id, campaign_id, purpose, person_id, channel, to_address, subject, body, status, scheduled_at, sent_at, opened_at, topic_key, template_key) values
  -- count: the newsletter to Ama (its subject is never shown), a campaign text on an events topic to Kofi (opened)
  (:c1, :cc1, 'campaign', :pa, 'email', 'ama@example.org', 'Your pledge of $500', 'Body', 'sent', now() - interval '2 days', now() - interval '2 days', null, null, null),
  (:c1, null, 'campaign', :pb, 'sms', '+15550100', 'Reminder', 'Body', 'delivered', now() - interval '1 day', now() - interval '1 day', now() - interval '20 hours', 'events', null),
  -- never: to a child, a receipt, a push, not sent yet, a learning programme, account and security, a learning topic,
  -- a child with no birth date
  (:c1, :cc1, 'campaign', :pk, 'email', 'esi@example.org', 'For Esi', 'Body', 'sent', now() - interval '2 days', now() - interval '2 days', null, null, null),
  (:c1, null, 'receipt', :pa, 'email', 'ama@example.org', 'Your receipt', 'Body', 'sent', now() - interval '3 days', now() - interval '3 days', null, 'giving', 'receipt'),
  (:c1, :cc1, 'campaign', :pa, 'push', null, 'App notice', 'Body', 'sent', now() - interval '4 days', now() - interval '4 days', null, null, null),
  (:c1, :cc1, 'campaign', :pa, 'email', 'ama@example.org', 'Not yet', 'Body', 'queued', now() + interval '1 day', null, null, null, null),
  (:c1, :cc2, 'campaign', :pa, 'email', 'ama@example.org', 'Class news', 'Body', 'sent', now() - interval '2 days', now() - interval '2 days', null, null, null),
  (:c1, null, 'notification', :pa, 'email', 'ama@example.org', 'Your sign-in code', 'Body', 'sent', now() - interval '2 days', now() - interval '2 days', null, 'account', null),
  (:c1, null, 'campaign', :pa, 'email', 'ama@example.org', 'Class reminder', 'Body', 'sent', now() - interval '2 days', now() - interval '2 days', null, 'pathshala', null),
  (:c1, :cc1, 'campaign', :pn, 'email', 'nana@example.org', 'For Nana', 'Body', 'sent', now() - interval '2 days', now() - interval '2 days', null, null, null),
  -- Fia: while she lived here (counts here), and after she left (counts for the Lees, not here)
  (:c1, :cc1, 'campaign', :pf, 'email', 'fia@example.org', 'Winter newsletter', 'Body', 'sent', now() - interval '20 days', now() - interval '20 days', null, null, null),
  (:c1, :cc1, 'campaign', :pf, 'email', 'fia@example.org', 'Spring newsletter', 'Body', 'sent', now() - interval '2 days', now() - interval '2 days', null, null, null);
insert into app.payments (id, center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, receipt_number, receipt_sent_at) values
  (:pay, :c1, :h1, :pa, 5000, 'check', 'captured', 'offline', current_date - 3, 'R-165', now() - interval '3 days'),
  -- never: a failed payment, a payment whose payer is a child, a refunded one, one still clearing
  (:pay2, :c1, :h1, :pa, 7000, 'check', 'failed', 'offline', current_date - 4, 'R-166', now() - interval '4 days'),
  (:pay3, :c1, :h1, :pk, 300, 'check', 'captured', 'offline', current_date - 4, 'R-167', now() - interval '4 days'),
  (:pay4, :c1, :h1, :pa, 900, 'check', 'refunded', 'offline', current_date - 4, 'R-168', now() - interval '4 days'),
  (:pay5, :c1, :h1, :pa, 800, 'check', 'pending_clearing', 'offline', current_date - 4, 'R-169', now() - interval '4 days');
insert into app.statements (center_id, household_id, kind, tax_year, generated_at) values (:c1, :h1, 'tax_year', 2025, now() - interval '6 days');
insert into app.events (id, center_id, name, starts_at, ends_at, status) values
  (:ev, :c1, 'Harvest supper 165', now() - interval '5 days', now() - interval '5 days' + interval '3 hours', 'published');
insert into app.rsvps (id, center_id, event_id, household_id, status) values (:rs, :c1, :ev, :h1, 'rsvpd');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, status, checked_in_at) values
  (:c1, :ev, :rs, :pa, 'Ama Mensah165', false, 'confirmed', now() - interval '5 days'),
  (:c1, :ev, :rs, :pk, 'Esi Mensah165', true, 'confirmed', now() - interval '5 days'),
  (:c1, :ev, :rs, :pb, 'Kofi Mensah165', false, 'rsvpd', null);
insert into app.volunteer_shifts (id, center_id, event_id, station, starts_at, ends_at) values
  (:sh1, :c1, :ev, 'kitchen', now() - interval '5 days', now() - interval '5 days' + interval '2 hours'),
  (:sh2, :c1, :ev, 'entry', now() + interval '5 days', now() + interval '5 days' + interval '2 hours');
insert into app.volunteer_assignments (center_id, shift_id, person_id, status) values
  (:c1, :sh1, :pb, 'completed'), (:c1, :sh1, :pk, 'completed'), (:c1, :sh2, :pa, 'confirmed');
select pg_temp.assert(app.module_enabled(:c1, 'care') and app.module_enabled(:c1, 'comms') and app.module_enabled(:c1, 'giving')
                      and app.module_enabled(:c1, 'events') and app.module_enabled(:c1, 'volunteers')
                      and app._care_source_on(:c1, 'statements') and app._module_label(:c1, 'care') = 'Member care',
  'Fixtures · WeCare, Communications, Giving, Statements, Events and Volunteers are on; WeCare is Member care for a faith kind');

-- ══ A. Recording touches ═════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:rel);
select app.log_care_touch(:h1, '{"kind":"check_in","channel":"phone","outcome":"no_answer"}') as t1 \gset
select app.log_care_touch(:h1, jsonb_build_object('kind', 'thank_you', 'channel', 'post', 'person_id', :pa)) as t2 \gset
select app.log_care_touch(:h1, jsonb_build_object('kind', 'other', 'channel', 'in_person', 'is_ask', true,
                                                  'note', 'Asked about the roof appeal', 'touched_at', (now() - interval '10 days')::text)) as t3 \gset
select pg_temp.assert((select kind = 'check_in' and channel = 'phone' and outcome = 'no_answer' and not is_ask and by_user_id = :rel
                         from app.care_touches where id = :'t1')
                      and (select outcome = 'done' and person_id = :pa from app.care_touches where id = :'t2')
                      and (select is_ask and touched_at < now() - interval '9 days' from app.care_touches where id = :'t3'),
  'A · the owner records one-tap touches ("Called, no answer", "Card sent") and an ask from ten days ago');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, '{"kind":"care_moment","channel":"phone","is_ask":true}')$$, :h1),
  'never an ask', 'A · a care moment is never an ask');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, jsonb_build_object('kind', 'greeting', 'channel', 'phone', 'person_id', %L::text))$$, :h1, :pk),
  'under 18', 'A · a touch is never with a child');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, jsonb_build_object('kind', 'greeting', 'channel', 'phone', 'person_id', %L::text))$$, :h1, :pc),
  'not in this household', 'A · nor with someone of another household');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, jsonb_build_object('kind', 'greeting', 'channel', 'phone', 'person_id', %L::text))$$, :h1, :pf),
  'not in this household now', 'A · nor with someone who has left the household');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, jsonb_build_object('kind', 'greeting', 'channel', 'phone', 'person_id', %L::text))$$, :h1, :pn),
  'under 18', 'A · nor with a child who has no birth date on file (a child in the household, primary or spouse in none)');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, jsonb_build_object('contact_person_id', %L::text))$$, :h1, :pf),
  'not in this household now', 'A · a former member cannot be the one to reach first');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, jsonb_build_object('contact_person_id', %L::text))$$, :h1, :pn),
  'under 18', 'A · nor can a child with no birth date');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, jsonb_build_object('kind', 'greeting', 'channel', 'phone', 'touched_at', (now() + interval '2 days')::text))$$, :h1),
  'cannot be in the future', 'A · nor in the future');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, '{"kind":"ask","channel":"phone"}')$$, :h1),
  'Say what the touch was', 'A · the kind is one of the list (an ask is a yes or no, not a kind)');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, '{"kind":"greeting","channel":"pigeon"}')$$, :h1),
  'Say how', 'A · so is the channel');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, jsonb_build_object('kind', 'greeting', 'channel', 'phone', 'note', repeat('x', 1001)))$$, :h1),
  'at most 1,000', 'A · a note is short');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, '{"kind":"greeting","channel":"phone","amount":5}')$$, :h1),
  'has no field "amount"', 'A · nothing else can be stored');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, '{"kind":"greeting","channel":"phone"}')$$, :h2),
  'You don''t have access to this area', 'A · not for a household the owner does not own');
select pg_temp.claims(:relb);
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, '{"kind":"greeting","channel":"phone"}')$$, :h1),
  'You don''t have access to this area', 'A · nor for another relationship owner');
select pg_temp.claims(:viewer);
select app.log_care_touch(:h2, '{"kind":"welcome","channel":"in_person"}') as t4 \gset
select pg_temp.assert(:'t4' is not null, 'A · a care.view holder records touches for any household');
select pg_temp.assert_raises(format($$select app.void_care_touch(%L)$$, :'t1'),
  'Only the person who recorded a touch', 'A · but cannot remove someone else''s');
select pg_temp.claims(:lead);
select app.void_care_touch(:'t1', 'Recorded twice');
select pg_temp.assert((select voided_at is not null and void_reason = 'Recorded twice' from app.care_touches where id = :'t1'),
  'A · a manager removes it from the log; the row stays');
select pg_temp.assert_raises($$delete from app.care_touches$$, 'permission denied', 'A · nobody deletes touches through the API');
select pg_temp.assert_raises($$update app.care_touches set note = 'x'$$, 'permission denied', 'A · or changes them directly');

-- ══ B. The touches Weaver already knows ══════════════════════════════════════
-- Every key of a household's log, page by page with the (at, key) cursor.
create or replace function pg_temp.all_keys(p_h uuid, p_size int) returns text[] language plpgsql as $$
declare v jsonb; v_at timestamptz; v_key text; v_keys text[] := '{}'; v_guard int := 0;
begin
  loop
    v := app.care_household_touches(p_h, v_at, v_key, p_size);
    v_keys := v_keys || array(select x.e->>'key' from jsonb_array_elements(v->'rows') with ordinality as x(e, i) order by x.i);
    exit when not (v->>'more')::boolean or v_guard > 50;
    v_at := (v->'rows'->-1->>'at')::timestamptz;
    v_key := v->'rows'->-1->>'key';
    v_guard := v_guard + 1;
  end loop;
  return v_keys;
end $$;
-- How many rows of a log come from this source.
create or replace function pg_temp.n(j jsonb, src text) returns int language sql as $$
  select count(*)::int from jsonb_array_elements(j->'rows') e where e->>'source' = src
$$;
select app.care_household_touches(:h1) as log1 \gset
select pg_temp.assert(jsonb_array_length((:'log1'::jsonb)->'rows') = 9 and (pg_temp.sources(:'log1'::jsonb))[1] = 'manual'
                      and pg_temp.n(:'log1'::jsonb, 'manual') = 2 and pg_temp.n(:'log1'::jsonb, 'message') = 3
                      and pg_temp.n(:'log1'::jsonb, 'receipt') = 1 and pg_temp.n(:'log1'::jsonb, 'statement') = 1
                      and pg_temp.n(:'log1'::jsonb, 'check_in') = 1 and pg_temp.n(:'log1'::jsonb, 'volunteer') = 1
                      and not ((:'log1'::jsonb)->>'more')::boolean,
  'B · two recorded touches, three community messages, a receipt, a statement, a check-in and a shift; the removed touch is gone');
select pg_temp.assert(position('Esi' in (:'log1'::jsonb)::text) = 0 and position('Nana' in (:'log1'::jsonb)::text) = 0
                      and position('pledge of' in (:'log1'::jsonb)::text) = 0 and position('$500' in (:'log1'::jsonb)::text) = 0
                      and position('Class news' in (:'log1'::jsonb)::text) = 0 and position('R-166' in (:'log1'::jsonb)::text) = 0
                      and position('R-167' in (:'log1'::jsonb)::text) = 0 and position('R-168' in (:'log1'::jsonb)::text) = 0
                      and position('R-169' in (:'log1'::jsonb)::text) = 0,
  'B · never a child (with or without a birth date), a subject, a learning programme, account or receipt message, a failed, refunded or still-clearing payment, or a child''s payment');
select pg_temp.assert((select e->>'label' = 'Spring newsletter 165' and e->>'outcome' = 'sent'
                         from jsonb_array_elements((:'log1'::jsonb)->'rows') e where e->>'source' = 'message' and e->>'person_name' = 'Ama Mensah165')
                      and (select ((e->>'opened')::boolean) and e->>'outcome' = 'opened'
                                  and e->>'label' = (select name from app.notification_topics where key = 'events')
                             from jsonb_array_elements((:'log1'::jsonb)->'rows') e where e->>'source' = 'message' and e->>'channel' = 'sms')
                      and (select count(*) = 1 and bool_and(e->>'label' = 'Spring newsletter 165')
                             from jsonb_array_elements((:'log1'::jsonb)->'rows') e where e->>'source' = 'message' and e->>'person_name' = 'Fia Mensah165')
                      and (select e->>'label' = 'Harvest supper 165' and e->>'person_name' = 'Ama Mensah165'
                             from jsonb_array_elements((:'log1'::jsonb)->'rows') e where e->>'source' = 'check_in')
                      and (select e->>'label' = 'Harvest supper 165 · kitchen' and e->>'person_name' = 'Kofi Mensah165'
                             from jsonb_array_elements((:'log1'::jsonb)->'rows') e where e->>'source' = 'volunteer')
                      and (select e->>'label' = 'Year-end statement 2025'
                             from jsonb_array_elements((:'log1'::jsonb)->'rows') e where e->>'source' = 'statement'),
  'B · each known touch says what it was: the campaign or topic, opened or not, the event, the shift, the statement; Fia only while she lived here');
select app.care_household_touches(:h2) as logh2 \gset
select pg_temp.assert(pg_temp.n(:'logh2'::jsonb, 'message') = 1
                      and (select e->>'person_name' = 'Fia Mensah165' and (e->>'at')::timestamptz > now() - interval '3 days'
                             from jsonb_array_elements((:'logh2'::jsonb)->'rows') e where e->>'source' = 'message'),
  'B · after she moved, Fia''s messages belong to her new household, and her old ones stay with the old one');
select pg_temp.assert((select e->'amount_cents' = 'null'::jsonb and e->>'label' = 'Receipt R-165'
                         from jsonb_array_elements((:'log1'::jsonb)->'rows') e where e->>'source' = 'receipt')
                      and not ((:'log1'::jsonb)->>'amounts')::boolean,
  'B · a care lead without a giving role sees the receipt, never its amount');
select pg_temp.assert((select bool_and((e->>'can_remove')::boolean = (e->>'source' = 'manual'))
                         from jsonb_array_elements((:'log1'::jsonb)->'rows') e),
  'B · only recorded touches can be removed, and a manager may remove them');
select pg_temp.assert(pg_temp.all_keys(:h1, 2) = (select array_agg(x.e->>'key' order by x.i) from jsonb_array_elements((:'log1'::jsonb)->'rows') with ordinality as x(e, i))
                      and cardinality(pg_temp.all_keys(:h1, 1)) = 9
                      and (select count(distinct k) from unnest(pg_temp.all_keys(:h1, 2)) k) = 9,
  'B · page by page, the log returns every row once, in order (two rows share a time)');
select pg_temp.claims(:fin);
select app.care_household_touches(:h1) as log2 \gset
select pg_temp.assert((select (e->>'amount_cents')::bigint = 5000
                         from jsonb_array_elements((:'log2'::jsonb)->'rows') e where e->>'source' = 'receipt')
                      and ((:'log2'::jsonb)->>'amounts')::boolean,
  'B · with a giving role as well, the amount shows (care_amounts_can)');
select app.care_household_touches(:h1, null, null, 3) as page1 \gset
select app.care_household_touches(:h1, ((:'page1'::jsonb)->'rows'->2->>'at')::timestamptz, (:'page1'::jsonb)->'rows'->2->>'key', 3) as page2 \gset
select pg_temp.assert(jsonb_array_length((:'page1'::jsonb)->'rows') = 3 and ((:'page1'::jsonb)->>'more')::boolean
                      and jsonb_array_length((:'page2'::jsonb)->'rows') = 3
                      and ((:'page2'::jsonb)->'rows'->0->>'at')::timestamptz <= ((:'page1'::jsonb)->'rows'->2->>'at')::timestamptz,
  'B · the log pages back in time');
select pg_temp.claims(:rel);
select app.care_household_touches(:h1) as log3 \gset
select pg_temp.assert(jsonb_array_length((:'log3'::jsonb)->'rows') = 9
                      and (select bool_and((e->>'can_remove')::boolean = (e->>'source' = 'manual' and e->>'id' in (:'t2', :'t3')))
                             from jsonb_array_elements((:'log3'::jsonb)->'rows') e),
  'B · the owner sees the same log and may remove the touches they recorded');
reset role;
select pg_temp.no_claims();
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c1, 'comms', false, 'Test 165: no messages')
  on conflict (center_id, module_key) do update set enabled = false;
set role authenticated;
select pg_temp.claims(:lead);
select app.care_household_touches(:h1) as log4 \gset
select pg_temp.assert(not ('message' = any (pg_temp.sources(:'log4'::jsonb))) and jsonb_array_length((:'log4'::jsonb)->'rows') = 6,
  'B · with Communications switched off, its messages leave the log');
reset role;
select pg_temp.no_claims();
delete from app.center_modules where center_id = :c1 and module_key = 'comms';

-- ══ C. The Care card ═════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select app.care_household_card(:h1) as card1 \gset
select pg_temp.assert((:'card1'::jsonb)->'people' = 'null'::jsonb and (:'card1'::jsonb)->'special_days' = 'null'::jsonb
                      and not ((:'card1'::jsonb)->'access'->>'people')::boolean
                      and (:'card1'::jsonb)->'access'->>'level' = 'manage' and (:'card1'::jsonb)->>'label' = 'Member care',
  'C · without people.view, the card leaves out the People fields (they keep their own visibility)');
select pg_temp.assert((:'card1'::jsonb)->'household'->>'primary_member' = 'Ama Mensah165'
                      and jsonb_array_length((:'card1'::jsonb)->'household'->'adults') = 2
                      and position('Esi' in (:'card1'::jsonb)::text) = 0,
  'C · the household shows its adults, never its child');
select pg_temp.assert(((:'card1'::jsonb)->>'touches_12m')::int = 2 and ((:'card1'::jsonb)->>'asks_12m')::int = 1
                      and (:'card1'::jsonb)->'last_touch'->>'kind' = 'thank_you'
                      and (:'card1'::jsonb)->'owners'->'owner'->>'user_id' = :rel
                      and (:'card1'::jsonb)->'languages' = '["en"]'::jsonb,
  'C · the last touch, the touches and asks of the last 12 months, the owner, and English when the community chose no languages');
select pg_temp.claims(:fin);
select app.care_household_card(:h1) as card2 \gset
select pg_temp.assert(((:'card2'::jsonb)->'access'->>'people')::boolean and ((:'card2'::jsonb)->'access'->>'amounts')::boolean
                      and jsonb_array_length((:'card2'::jsonb)->'people') = 2
                      and position('Esi' in (:'card2'::jsonb)::text) = 0 and position('football' in (:'card2'::jsonb)::text) = 0
                      and position('Nana' in (:'card2'::jsonb)::text) = 0 and position('Fia' in (:'card2'::jsonb)::text) = 0
                      and not ((:'card2'::jsonb) ? 'amount_cents'),
  'C · with people.view, the adults'' People fields; never the child''s; the card itself holds no amount');
select pg_temp.assert((select e->'interests' = '["gardening"]'::jsonb and e->'expertise' = '["law"]'::jsonb
                         and e->>'best_call_time' = 'evening' and e->>'language' = 'es' and e->>'anniversary' = '2005-06-01'
                         and e->'dietary' = '["Vegan"]'::jsonb and (e->'agreed'->>'email')::boolean and (e->'agreed'->>'post')::boolean
                         from jsonb_array_elements((:'card2'::jsonb)->'people') e where e->>'person_id' = :pa)
                      and (select not (e->'agreed'->>'sms')::boolean and e->'agreed'->'email' = 'null'::jsonb
                             from jsonb_array_elements((:'card2'::jsonb)->'people') e where e->>'person_id' = :pb),
  'C · interests, expertise, call time, language, anniversary, dietary needs (by their label) and the channels agreed, read where they live');
select pg_temp.assert(jsonb_array_length((:'card2'::jsonb)->'special_days') = 2
                      and not exists (select 1 from jsonb_array_elements((:'card2'::jsonb)->'special_days') e where e->>'person_id' = :pk),
  'C · the special days of the household and its adults, never the child''s');
reset role;
select pg_temp.assert((select count(*) from app.care_profiles where household_id = :h1) = 0
                      and not exists (select 1 from information_schema.columns where table_schema = 'app'
                                       and table_name in ('care_profiles', 'care_owners', 'care_notes', 'care_touches')
                                       and column_name in ('interests', 'expertise_tags', 'best_call_time', 'anniversary', 'dietary', 'amount_cents')),
  'C · reading the card copied nothing, and no WeCare table has a People field or an amount');

-- ══ D. Nobody else; every read logged ════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format($$select app.care_household_touches(%L)$$, :h1),
  'You don''t have access to this area', 'D · a platform admin holding "*" gets no touch log');
select pg_temp.assert_raises(format($$select app.log_care_touch(%L, '{"kind":"greeting","channel":"phone"}')$$, :h1),
  'You don''t have access to this area', 'D · and records nothing');
select pg_temp.assert((select count(*) from app.care_touches) = 0, 'D · nor reads the touches table');
select pg_temp.claims(:relb);
select pg_temp.assert_raises(format($$select app.care_household_touches(%L)$$, :h1),
  'You don''t have access to this area', 'D · another relationship owner gets nothing of a household not theirs');
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select count(*) from app.audit_log l where l.center_id = :c1 and l.action = 'care.read'
                         and l.after->>'what' = 'touches') >= 6
                      and (select (l.after->>'rows')::int = 3 from app.audit_log l where l.center_id = :c1 and l.action = 'care.read'
                             and l.after->>'what' = 'touches' and l.actor_user_id = :fin order by l.id desc limit 1)
                      and not exists (select 1 from app.audit_log l where l.center_id = :c1 and l.module = 'care'
                                         and (l.after::text ilike '%Mensah165%' or l.after::text ilike '%roof appeal%')),
  'D · every log read is recorded with how many rows; no name and no note reaches the audit log');
rollback;
\echo 'PASS: WeCare touch log tests'
