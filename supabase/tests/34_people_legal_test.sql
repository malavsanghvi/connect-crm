-- 0420–0423 (stream e-people-legal): the deceased flag end to end; #15 a non-member unsubscribe
-- blocks newsletters only; #19/#20 legal texts as versions and the member app's legal step.
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
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  perform set_config('request.jwt.claim.sub', p_user, false);
end $$;
create or replace function pg_temp.no_user() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  perform set_config('request.jwt.claim.sub', '', false);
end $$;
grant connect_worker to postgres;

\set c '''34000000-0000-4000-8000-0000000000c1'''
\set admin '''34000000-0000-4000-8000-0000000000a1'''
\set member '''34000000-0000-4000-8000-0000000000a2'''
\set platform '''34000000-0000-4000-8000-0000000000a3'''
\set newbie '''34000000-0000-4000-8000-0000000000a4'''
\set hh '''34000000-0000-4000-8000-0000000000d1'''
\set hh2 '''34000000-0000-4000-8000-0000000000d2'''
\set ramesh '''34000000-0000-4000-8000-0000000000e1'''
\set leela '''34000000-0000-4000-8000-0000000000e2'''
\set kavya '''34000000-0000-4000-8000-0000000000e3'''
\set mina '''34000000-0000-4000-8000-0000000000e4'''
\set nita '''34000000-0000-4000-8000-0000000000e5'''

insert into auth.users (id, email) values
  (:admin, 'pl.admin@example.com'), (:member, 'mina@example.com'), (:platform, 'pl.platform@example.com'), (:newbie, 'nita@example.com');
insert into app.accounts (user_id, is_platform_admin) values (:platform, true);
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'pltest', 'People Legal Test Center', 'PLT', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:c, :admin, 'center_admin', 'center');
insert into app.households (id, center_id, display_name) values (:hh, :c, 'Shah family'), (:hh2, :c, 'Member household');
insert into app.people (id, center_id, first_name, last_name, email, phone_e164, date_of_birth, is_verified) values
  (:ramesh, :c, 'Ramesh', 'Shah', 'ramesh@example.com', '+17135550301', '1950-03-01', true),
  (:leela,  :c, 'Leela',  'Shah', 'leela@example.com',  '+17135550302', '1954-06-01', true),
  (:kavya,  :c, 'Kavya',  'Shah', null, null, current_date - 3000, true),
  (:mina,   :c, 'Mina',   'Member', 'mina@example.com', null, '1980-01-01', true),
  (:nita,   :c, 'Nita',   'New', 'nita@example.com', null, '1990-01-01', false);
insert into app.person_emails (center_id, person_id, email, label, verified) values (:c, :leela, 'shah.family@example.com', 'other', true);
insert into app.person_emails (center_id, person_id, email, label, verified) values (:c, :ramesh, 'shah.family@example.com', 'other', true);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:hh, :ramesh, :c, 'primary', true), (:hh, :leela, :c, 'spouse', false), (:hh, :kavya, :c, 'child', false),
  (:hh2, :mina, :c, 'primary', true), (:hh2, :nita, :c, 'spouse', false);
insert into app.center_users (center_id, user_id, person_id) values (:c, :member, :mina), (:c, :newbie, :nita);
insert into app.membership_types (id, center_id, key, name, tier) values ('34000000-0000-4000-8000-0000000000b1', :c, 'life', 'Life', 'life');
insert into app.memberships (id, center_id, household_id, person_id, membership_type_id, tier, status, starts_on) values
  ('34000000-0000-4000-8000-0000000000f1', :c, :hh, :ramesh, '34000000-0000-4000-8000-0000000000b1', 'life', 'active', '2001-01-01');
insert into app.eligibility_snapshots (center_id, person_id, can_vote, reasons) values (:c, :ramesh, true, '["Life member"]');
insert into app.funds (id, center_id, key, name) values ('34000000-0000-4000-8000-0000000000b2', :c, 'general', 'General');
insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, received_on, is_historical)
values (:c, :hh, :ramesh, 50000, 'check', 'settled', '2024-05-01', true);
-- A message queued to Ramesh before anyone knew.
select app.enqueue_message(:c, 'email', 'ramesh@example.com', 'test_message', jsonb_build_object('person_id', :ramesh), 'notification') as m_before \gset
select pg_temp.assert((select status = 'queued' from app.messages where id = :'m_before'), 'setup: a message to Ramesh is queued');

-- ══ Deceased ═════════════════════════════════════════════════════════════════
begin;
select pg_temp.as_user(:member);
select pg_temp.assert_raises($$select app.mark_person_deceased('34000000-0000-4000-8000-0000000000e1', current_date - 3, null, 'told by family')$$,
  'needs the people.manage permission', 'a member without people.manage cannot mark someone deceased');
rollback;

select pg_temp.as_user(:admin);
select pg_temp.assert_raises($$select app.mark_person_deceased('34000000-0000-4000-8000-0000000000e1', current_date - 3, null, '  ')$$,
  'Give a reason', 'a reason is required');
select pg_temp.assert_raises($$select app.mark_person_deceased('34000000-0000-4000-8000-0000000000e1', current_date + 5, null, 'x')$$,
  'cannot be in the future', 'a future date is refused');
select pg_temp.assert_raises($$select app.mark_person_deceased('34000000-0000-4000-8000-0000000000e1', '1940-01-01', null, 'x')$$,
  'before', 'a date before the date of birth is refused');

select app.mark_person_deceased(:ramesh, current_date - 3, 'Passed peacefully at home.', 'His daughter called the office') as mark \gset
select pg_temp.assert((select is_deceased and deceased_on = current_date - 3 and deceased_note = 'Passed peacefully at home.'
                              and deceased_recorded_by = :admin and deceased_recorded_at is not null from app.people where id = :ramesh),
  'the person is marked with the date, note, who and when');
select pg_temp.assert((:'mark'::jsonb->'needs_new_primary'->0->>'household_id')::uuid = :hh::uuid
                      and (:'mark'::jsonb->'needs_new_primary'->0->>'living_members')::int = 2,
  'the result asks for a new primary for the Shah family (two living members)');
select pg_temp.assert((select status = 'ended' and ends_on = current_date - 3 and notes like '%passed away%'
                         from app.memberships where id = '34000000-0000-4000-8000-0000000000f1'),
  'the membership he held ends on the date of death');
select pg_temp.assert((select status = 'suppressed' and failure_reason like '%deceased%' from app.messages where id = :'m_before'),
  'the message already queued to him is suppressed');
select pg_temp.assert((select not can_vote and reasons = '["Deceased"]' from app.eligibility_snapshots where person_id = :ramesh order by computed_at desc limit 1),
  'he is no longer eligible to vote');
select pg_temp.assert(exists (select 1 from app.person_deceased_events where person_id = :ramesh and action = 'marked' and reason = 'His daughter called the office'),
  'the mark is recorded with its reason');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'people' and record_id = :ramesh
                                and reason = 'His daughter called the office' and after->>'is_deceased' = 'true'),
  'the audit log has the change with the reason');
select pg_temp.assert((select count(*) from app.payments where payer_person_id = :ramesh) = 1, 'his giving history is intact (still the payer)');
select pg_temp.assert(not exists (select 1 from app.directory where person_id = :ramesh), 'he is not in the directory view');
select pg_temp.assert_raises($$select app.mark_person_deceased('34000000-0000-4000-8000-0000000000e1', current_date - 3, null, 'again')$$,
  'already recorded as deceased', 'marking twice is refused');

-- No messages of any channel.
select app.enqueue_message(:c, 'email', 'ramesh@example.com', 'test_message', '{}', 'notification') as m1 \gset
select app.enqueue_message(:c, 'sms', '+17135550301', 'test_message', '{}', 'notification') as m2 \gset
select app.enqueue_message(:c, 'email', 'leela@example.com', 'test_message', jsonb_build_object('person_id', :ramesh), 'receipt') as m3 \gset
select app.enqueue_message(:c, 'email', 'shah.family@example.com', 'test_message', '{}', 'notification') as m4 \gset
select pg_temp.assert((select bool_and(status = 'suppressed' and failure_reason like 'Not sent: Ramesh Shah is recorded as deceased%' and job_id is null)
                         from app.messages where id in (:'m1', :'m2', :'m3')),
  'email, text, and anything naming him are suppressed at enqueue, with no job');
select pg_temp.assert((select status = 'queued' from app.messages where id = :'m4'), 'a family address shared with a living member still goes');
insert into app.messages (center_id, person_id, channel, template_key, body) values (:c, :ramesh, 'push', 'x', 'Hello') returning id as m5 \gset
select pg_temp.assert((select status = 'suppressed' from app.messages where id = :'m5'), 'a message row written any other way is suppressed too');

-- Pickers and activity refused in the database.
insert into app.events (id, center_id, name, starts_at) values ('34000000-0000-4000-8000-000000000e01', :c, 'Paryushan', now() + interval '3 days');
select pg_temp.assert_raises($$insert into app.attendees (center_id, event_id, person_id, display_name) values ('34000000-0000-4000-8000-0000000000c1', '34000000-0000-4000-8000-000000000e01', '34000000-0000-4000-8000-0000000000e1', 'Ramesh')$$,
  'recorded as deceased, so cannot be added to an event', 'he cannot be added to an event');
select pg_temp.assert_raises($$insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on) values ('34000000-0000-4000-8000-0000000000c1', '34000000-0000-4000-8000-0000000000d1', '34000000-0000-4000-8000-0000000000e1', '34000000-0000-4000-8000-0000000000b1', 'life', 'active', current_date)$$,
  'cannot be given a membership', 'he cannot be given a new membership');
select pg_temp.assert_raises($$insert into app.center_users (center_id, user_id, person_id) values ('34000000-0000-4000-8000-0000000000c1', '34000000-0000-4000-8000-0000000000a3', '34000000-0000-4000-8000-0000000000e1')$$,
  'linked to an app login', 'a login cannot be linked to him');
begin;
select set_config('app.client_app', 'import', true);
insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on) values (:c, :hh, :ramesh, '34000000-0000-4000-8000-0000000000b1', 'life', 'active', '1990-01-01');
select pg_temp.assert(true, 'an import may still bring in history that names him');
rollback;

-- A new primary for the household.
select pg_temp.assert_raises($$select app.set_household_primary('34000000-0000-4000-8000-0000000000d1', '34000000-0000-4000-8000-0000000000e1', 'x')$$,
  'recorded as deceased cannot be the primary', 'the deceased cannot be chosen');
select pg_temp.assert_raises($$select app.set_household_primary('34000000-0000-4000-8000-0000000000d1', '34000000-0000-4000-8000-0000000000e3', 'x')$$,
  'under 18', 'a child cannot be chosen');
select pg_temp.assert_raises($$select app.set_household_primary('34000000-0000-4000-8000-0000000000d1', '34000000-0000-4000-8000-0000000000e4', 'x')$$,
  'not a current member', 'someone from another household cannot be chosen');
begin;
select pg_temp.as_user(:member);
select pg_temp.assert_raises($$select app.set_household_primary('34000000-0000-4000-8000-0000000000d1', '34000000-0000-4000-8000-0000000000e2', 'x')$$,
  'people.manage', 'a member cannot choose the primary');
rollback;
select pg_temp.as_user(:admin);
select app.set_household_primary(:hh, :leela, 'Ramesh passed away; Leela is now the primary member');
select pg_temp.assert((select is_primary from app.household_members where household_id = :hh and person_id = :leela)
                      and (select not is_primary from app.household_members where household_id = :hh and person_id = :ramesh),
  'Leela is the primary member now; Ramesh stays in the household as a member');
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'household_members' and reason = 'Ramesh passed away; Leela is now the primary member'),
  'the change of primary is audited with the reason');

-- Undo.
select pg_temp.assert_raises($$select app.undo_person_deceased('34000000-0000-4000-8000-0000000000e1', '')$$, 'Give a reason', 'undo needs a reason');
select app.undo_person_deceased(:ramesh, 'Wrong Ramesh — it was his cousin') as undo \gset
select pg_temp.assert((select not is_deceased and deceased_on is null and deceased_note is null and deceased_recorded_by is null from app.people where id = :ramesh),
  'undo clears the flag and its details');
select pg_temp.assert((:'undo'::jsonb->>'restored_memberships')::int = 1
                      and (select status = 'active' and ends_on is null from app.memberships where id = '34000000-0000-4000-8000-0000000000f1'),
  'undo restores the membership the mark ended');
select pg_temp.assert((select can_vote from app.eligibility_snapshots where person_id = :ramesh order by computed_at desc limit 1),
  'undo restores his voting eligibility as it was');
select pg_temp.assert(exists (select 1 from app.person_deceased_events where person_id = :ramesh and action = 'undone' and reason = 'Wrong Ramesh — it was his cousin'),
  'the undo is recorded with its reason');
select app.enqueue_message(:c, 'email', 'ramesh@example.com', 'test_message', '{}', 'notification') as m6 \gset
select pg_temp.assert((select status = 'queued' from app.messages where id = :'m6'), 'after the undo, messages reach him again');

-- Import: a date of death alone marks the person.
insert into app.people (center_id, first_name, last_name, deceased_on) values (:c, 'Old', 'Record', '2019-02-02') returning id as imported \gset
select pg_temp.assert((select is_deceased and deceased_recorded_at is not null from app.people where id = :'imported'),
  'an imported date of death marks the person deceased');
select pg_temp.assert((select 'deceased_on' = any (columns) from app.import_entities where key = 'people'), 'the import engine accepts a date-of-death column');
select pg_temp.assert(exists (select 1 from app.demo_packs, jsonb_array_elements(app.demo_pack_steps('community')) s where s->>'key' = 'remembrance'),
  'the demo pack has a remembrance step');

-- ══ #15: a non-member unsubscribe blocks newsletters only ═════════════════════
select app.enqueue_message(:c, 'email', 'friend@example.org', 'test_message', '{}', 'campaign') as nl \gset
select pg_temp.no_user();
begin;
set local role connect_worker;
select app.worker_unsubscribe(:'nl') as unsub \gset
reset role;
commit;
select pg_temp.assert((select count(*) = 1 from app.message_suppressions where address = 'friend@example.org' and scope = 'newsletters'
                        and reason = 'unsubscribe' and lifted_at is null),
  'an unsubscribe from an address with no member on file is a newsletters-only suppression');
select app.enqueue_message(:c, 'email', 'friend@example.org', 'test_message', '{}', 'campaign') as nl2 \gset
select app.enqueue_message(:c, 'email', 'friend@example.org', 'test_message', '{}', 'notification') as nl3 \gset
select app.enqueue_message(:c, 'email', 'friend@example.org', 'test_message', '{}', 'receipt') as rc \gset
select pg_temp.assert((select bool_and(status = 'suppressed' and failure_reason like '%unsubscribed from newsletters%') from app.messages where id in (:'nl2', :'nl3')),
  'newsletters and announcements to it are not sent');
select pg_temp.assert((select status = 'queued' and job_id is not null from app.messages where id = :'rc'), 'a receipt to it still goes');
select pg_temp.assert((app.message_suppression_for(:c, 'email', 'friend@example.org')).id is null,
  'it is not a full suppression');
insert into app.message_suppressions (center_id, channel, address, reason) values (:c, 'email', 'friend@example.org', 'bounce');
select pg_temp.assert((app.message_suppression_for(:c, 'email', 'friend@example.org')).reason = 'bounce',
  'a later bounce still suppresses everything to it');
-- A member's unsubscribe is unchanged: a per-person opt-out.
select app.enqueue_message(:c, 'email', 'mina@example.com', 'test_message', jsonb_build_object('person_id', :mina), 'campaign') as mm \gset
begin;
set local role connect_worker;
select app.worker_unsubscribe(:'mm');
reset role;
commit;
select pg_temp.assert(exists (select 1 from app.channel_optins where person_id = :mina and not opted_in and source = 'unsubscribe_link')
                      and not exists (select 1 from app.message_suppressions where address = 'mina@example.com'),
  'a member''s unsubscribe stays a per-person opt-out');

-- ══ #19: platform agreements are drafts published as new versions ═════════════
select pg_temp.as_user(:admin);
select pg_temp.assert_raises($$select app.save_platform_document(null, 'dpa', 'DPA', 'Text', '2026-10', 'counsel')$$,
  'Only the Community Connect team', 'an organization admin cannot edit platform agreements');
select pg_temp.as_user(:platform);
update app.legal_documents set published_at = now() - interval '2 days' where center_id is null and kind = 'dpa' and version = '2026-09-draft';
select pg_temp.as_user(:admin);
insert into app.center_owners (center_id, user_id) values (:c, :admin) on conflict (center_id) do update set user_id = excluded.user_id;
select app.accept_org_agreement(:c, (select id from app.legal_documents where center_id is null and kind = 'dpa' and version = '2026-09-draft'));
select pg_temp.assert((select accepted from app.org_agreement_status(:c) where kind = 'dpa'), 'setup: the owner accepted the DPA');
select pg_temp.as_user(:platform);
select pg_temp.assert_raises($$update app.legal_documents set body_md = 'changed' where center_id is null and kind = 'dpa' and version = '2026-09-draft'$$,
  'cannot be changed', 'a published agreement text is frozen');
select pg_temp.assert_raises($$select app.save_platform_document((select id from app.legal_documents where center_id is null and kind = 'dpa' and version = '2026-09-draft'), null, 'DPA', 'x', '2026-09-draft', 'counsel')$$,
  'is published and cannot be changed', 'save_platform_document refuses to edit a published version');
select app.save_platform_document(null, 'dpa', 'Data processing agreement', 'Counsel''s first text.', '2026-10', 'Counsel''s October text') as dpa2 \gset
select pg_temp.assert_raises($$select app.save_platform_document(null, 'dpa', 'DPA', 'x', '2026-11', 'counsel')$$,
  'already a draft', 'only one draft per agreement at a time');
select app.save_platform_document(:'dpa2', null, 'Data processing agreement', 'Counsel''s final text.', '2026-10', 'Counsel''s edit');
select pg_temp.assert((select body_md = 'Counsel''s final text.' and published_at is null and updated_by = :platform from app.legal_documents where id = :'dpa2'),
  'a draft can be edited');
select app.publish_platform_document(:'dpa2');
select pg_temp.assert((select published_by = :platform from app.legal_documents where id = :'dpa2'), 'publishing records who published');
select pg_temp.as_user(:admin);
select pg_temp.assert((select not accepted and version = '2026-10' and accepted_version = '2026-09-draft' from app.org_agreement_status(:c) where kind = 'dpa'),
  'the new version asks the owner again; the earlier acceptance keeps its version');
select app.accept_org_agreement(:c, :'dpa2');
select pg_temp.assert((select count(*) = 2 from app.org_agreements where center_id = :c and kind = 'dpa'), 'both acceptances are kept, one per version');

-- ══ #20: member legal documents and the member app's legal step ════════════════
select pg_temp.as_user(:admin);
insert into app.legal_documents (center_id, kind, version, title, body_md, published_at) values
  (:c, 'privacy', 'v1', 'Privacy policy', 'We keep your data safe.', now() - interval '1 day'),
  (:c, 'disclaimer', 'v1', 'Notices', 'Events are photographed.', now() - interval '1 day'),
  (:c, 'photo_release', 'v1', 'Photo consent', 'May we use photos of you?', now() - interval '1 day'),
  (:c, 'children_consent', 'v1', 'Children consent', 'May children appear in photos?', now() - interval '1 day'),
  (:c, 'volunteer_waiver', 'v1', 'Volunteer waiver', 'Sign before serving.', now() - interval '1 day');
select pg_temp.assert((select array_agg(member_step order by kind) from app.legal_documents where center_id = :c)
                      = array['consent','accept','consent','accept','none'],
  'each kind gets its member step (accept / consent / not asked)');
select pg_temp.as_user(:newbie);
select pg_temp.assert((select array_agg(kind order by kind) from app.member_legal_steps(:c)) = array['disclaimer','photo_release','privacy'],
  'a new member is asked for privacy, notices and photo consent (no children consent without a child; waivers are signed later)');
select pg_temp.assert((select bool_and(not answered) from app.member_legal_steps(:c)), 'nothing is answered yet');
select pg_temp.assert_raises(format($$select app.record_member_legal_answers(%L, %L)$$, :c,
    jsonb_build_array(jsonb_build_object('document_id', (select document_id from app.member_legal_steps(:c) where kind = 'privacy'), 'granted', false))),
  'To use the app, accept', 'a required document cannot be declined');
select app.record_member_legal_answers(:c, (select jsonb_agg(jsonb_build_object('document_id', document_id, 'granted', kind <> 'photo_release'))
                                              from app.member_legal_steps(:c)), '203.0.113.9', 'Expo test');
select pg_temp.assert((select bool_and(answered) from app.member_legal_steps(:c)), 'after answering, nothing is left to ask');
select pg_temp.assert((select count(*) = 3 and bool_and(given_by_user = :newbie and source = 'app' and ip = '203.0.113.9')
                         from app.consents where person_id = :nita and legal_document_id is not null),
  'each answer is recorded with the version, who, and the IP');
select pg_temp.assert((select not photo_opt_in from app.people where id = :nita), 'declining photo consent is kept on the profile');
-- A new privacy version is asked again; the old acceptance keeps pointing at v1.
select pg_temp.as_user(:admin);
select pg_temp.assert_raises($$update app.legal_documents set body_md = 'x' where center_id = '34000000-0000-4000-8000-0000000000c1' and kind = 'privacy'$$,
  'cannot be changed', 'a published member document is frozen');
insert into app.legal_documents (center_id, kind, version, title, body_md) values (:c, 'privacy', 'v2', 'Privacy policy', 'Updated.') returning id as p2 \gset
update app.legal_documents set body_md = 'Updated wording.' where id = :'p2';
update app.legal_documents set published_at = now() where id = :'p2';
select pg_temp.as_user(:newbie);
select pg_temp.assert((select not answered and version = 'v2' and answered_version = 'v1' from app.member_legal_steps(:c) where kind = 'privacy'),
  'a newly published version is asked again (previously accepted: v1)');
select pg_temp.assert((select count(*) = 1 from app.consents c join app.legal_documents d on d.id = c.legal_document_id
                        where c.person_id = :nita and d.kind = 'privacy' and d.version = 'v1'),
  'the earlier acceptance still records version v1');
-- Children consent is asked of a member whose household has a child.
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values ('34000000-0000-4000-8000-0000000000e6', :c, 'Tiny', 'New', current_date - 1000);
insert into app.household_members (household_id, person_id, center_id, role) values (:hh2, '34000000-0000-4000-8000-0000000000e6', :c, 'child');
select pg_temp.assert(exists (select 1 from app.member_legal_steps(:c) where kind = 'children_consent'), 'a parent is asked for children consent');
select pg_temp.no_user();
select pg_temp.assert_raises($$select * from app.member_legal_steps('34000000-0000-4000-8000-0000000000c1')$$, 'Sign in', 'signed out, there are no steps');
