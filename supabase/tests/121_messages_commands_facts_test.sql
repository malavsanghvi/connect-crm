-- 0661 and the database rules the Messages commands lean on (B90 phase 4, Messages). Nothing here is new behaviour: these assertions
-- hold the facts the commands assume, so a later change to a rule cannot silently turn a command into something it was not meant to be.
--   A. 0661 registers the eleven new Messages commands in the activity allowlist, each tied to its command; messages.draft_reminder
--      (0625) is still there.
--   B. A message to all members needs two different approvers, enforced by the database (the two_person_comms trigger and
--      app.approve_as_second): the first approver cannot schedule it alone and cannot give the second approval; a different person can.
--      A message to a smaller audience is not held up by it. (The commands never give a second approval for Niva.)
--   C. The inbox: a person with comms.inbox reads and answers every inbox; a zone lead only their zone's; nobody else sees a conversation.
--   D. Staff can read the message queue but cannot write it (0599), so no command can invent a sent message.
-- Everything runs as the signed-in person (row-level security) and in one transaction that is not committed.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- Run a statement as the signed-in person and say whether it failed with this SQLSTATE.
create or replace function pg_temp.fails_with(p_sql text, p_state text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_state;
end $$;
-- Run a statement as the signed-in person and say whether it worked.
create or replace function pg_temp.works(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice 'works(): % -> % %', p_sql, sqlstate, sqlerrm;
  return false;
end $$;

\set c '''12100000-0000-4000-8000-0000000000c1'''
\set u_a '''12100000-0000-4000-8000-0000000000a1'''
\set u_b '''12100000-0000-4000-8000-0000000000a2'''
\set u_zone '''12100000-0000-4000-8000-0000000000a3'''
\set u_none '''12100000-0000-4000-8000-0000000000a4'''
\set z1 '''12100000-0000-4000-8000-0000000000b1'''
\set z2 '''12100000-0000-4000-8000-0000000000b2'''
\set ib_all '''12100000-0000-4000-8000-0000000000e1'''
\set ib_z1 '''12100000-0000-4000-8000-0000000000e2'''
\set ib_z2 '''12100000-0000-4000-8000-0000000000e3'''
\set th_all '''12100000-0000-4000-8000-0000000000f1'''
\set th_z1 '''12100000-0000-4000-8000-0000000000f2'''
\set th_z2 '''12100000-0000-4000-8000-0000000000f3'''
\set cp_all '''12100000-0000-4000-8000-000000000a01'''
\set cp_small '''12100000-0000-4000-8000-000000000a02'''
\set ms '''12100000-0000-4000-8000-000000000b01'''

-- ── A. The allowlist (0661) ───────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) = 11 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action' and c.key = 'assistant.' || replace(c.commandable_key, '.', '_')
                          and c.commandable_key in ('messages.inbox_triage', 'messages.campaigns', 'messages.audience_preview', 'messages.why_not_delivered',
                                                    'messages.draft_reply', 'messages.schedule_campaign', 'messages.approve_campaign', 'messages.set_campaign_status',
                                                    'messages.reply_to_thread', 'messages.set_thread', 'messages.handle_whatsapp_request')),
                      'A1 all eleven are registered under assistant.<area>_<verb> with the command as commandable_key');
select pg_temp.assert((select count(*) = 1 from app.activity_catalog where key = 'assistant.messages_draft_reminder' and commandable_key = 'messages.draft_reminder'), 'A2 the reminder draft of 0625 is still registered');
select pg_temp.assert((select bool_and(char_length(label) between 6 and 120 and label !~ '[._]') from app.activity_catalog where commandable_key like 'messages.%'), 'A3 every label is a plain phrase');

-- ── Fixtures ─────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values (:u_a, 'a121@example.com'), (:u_b, 'b121@example.com'), (:u_zone, 'zone121@example.com'), (:u_none, 'none121@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values (:c, 'mf121', 'Messages Facts Center', 'MFC', 'TX', 'active', 'America/Chicago');
insert into app.zones (id, center_id, name) values (:z1, :c, 'North'), (:z2, :c, 'South');
-- Two approvers, a zone lead for the North zone, and a person with no role.
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:c, :u_a, 'communications_officer', 'center'), (:c, :u_b, 'communications_officer', 'center');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values (:c, :u_zone, 'zone_lead', 'zone', :z1);
insert into app.inboxes (id, center_id, key, name, zone_id) values (:ib_all, :c, 'events', 'Events', null), (:ib_z1, :c, 'zone_north', 'North zone', :z1), (:ib_z2, :c, 'zone_south', 'South zone', :z2);
insert into app.threads (id, center_id, inbox_id, from_guest_contact, subject) values
  (:th_all, :c, :ib_all, 'g1@example.com', 'Events question'), (:th_z1, :c, :ib_z1, 'g2@example.com', 'North question'), (:th_z2, :c, :ib_z2, 'g3@example.com', 'South question');
insert into app.messages (id, center_id, channel, to_address, subject, body, status) values (:ms, :c, 'email', 'someone@example.com', 'Hello', 'Hello', 'queued');

-- ── B. The two-approver rule ─────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_a);
insert into app.comms_campaigns (id, center_id, kind, title, audience, requires_second_approver, status, created_by)
  values (:cp_all, :c, 'newsletter', 'To everyone', '{"all_members": true}', true, 'draft', :u_a),
         (:cp_small, :c, 'newsletter', 'To the North zone', jsonb_build_object('zone_ids', jsonb_build_array(:z1::text)), false, 'draft', :u_a);
-- The first approval of a message to all members moves it to "waiting for a second approver" and nothing more.
select pg_temp.assert(pg_temp.works(format('update app.comms_campaigns set approved_by = %L, status = %L where id = %L', :u_a, 'pending_approval', :cp_all)), 'B1 the first approval is recorded');
select pg_temp.assert(pg_temp.fails_with(format('update app.comms_campaigns set status = %L, scheduled_at = now() where id = %L', 'scheduled', :cp_all), '23514'),
                      'B2 one approver cannot schedule a message to all members');
select pg_temp.assert(pg_temp.fails_with(format('select app.approve_as_second(%L, %L)', 'comms_campaigns', :cp_all), 'P0001'), 'B3 the first approver cannot give the second approval');
reset role;
select pg_temp.sign_in(:u_b);
select pg_temp.assert(pg_temp.works(format('select app.approve_as_second(%L, %L)', 'comms_campaigns', :cp_all)), 'B4 a different person gives the second approval');
select pg_temp.assert(pg_temp.works(format('update app.comms_campaigns set status = %L, scheduled_at = now() where id = %L', 'scheduled', :cp_all)), 'B5 then it can be scheduled');
reset role;
select pg_temp.assert((select status = 'scheduled' and approved_by = :u_a and second_approver = :u_b from app.comms_campaigns where id = :cp_all), 'B6 two different people are on record');
select pg_temp.sign_in(:u_a);
select pg_temp.assert(pg_temp.works(format('update app.comms_campaigns set approved_by = %L, status = %L, scheduled_at = now() where id = %L', :u_a, 'scheduled', :cp_small)), 'B7 a message to one zone is approved and scheduled by one person');
select pg_temp.assert(pg_temp.works(format('update app.comms_campaigns set status = %L where id = %L', 'cancelled', :cp_small)), 'B8 a scheduled message can be cancelled');
reset role;
select pg_temp.sign_in(:u_none);
select pg_temp.assert(pg_temp.fails_with(format('select app.approve_as_second(%L, %L)', 'comms_campaigns', :cp_all), 'P0001'), 'B9 a person with no role cannot approve');
reset role;

-- ── C. The inbox ─────────────────────────────────────────────────────────────────────────
select pg_temp.sign_in(:u_a);
select pg_temp.assert((select count(*) = 3 from app.threads where center_id = :c), 'C1 a person with comms.inbox sees every conversation');
select pg_temp.assert(pg_temp.works(format('insert into app.thread_messages (center_id, thread_id, author_user, from_role, body) values (%L, %L, %L, true, %L)', :c, :th_all, :u_a, 'Thank you for writing.')), 'C2 and answers one from the inbox');
select pg_temp.assert(pg_temp.works(format('update app.threads set status = %L, first_response_at = now() where id = %L', 'waiting', :th_all)), 'C3 and moves it on');
reset role;
select pg_temp.sign_in(:u_zone);
select pg_temp.assert((select count(*) = 1 and bool_and(id = :th_z1) from app.threads where center_id = :c), 'C4 a zone lead sees only their zone''s conversation');
select pg_temp.assert(pg_temp.works(format('insert into app.thread_messages (center_id, thread_id, author_user, from_role, body) values (%L, %L, %L, true, %L)', :c, :th_z1, :u_zone, 'Hello from the North zone.')), 'C5 and answers it');
select pg_temp.assert(pg_temp.fails_with(format('insert into app.thread_messages (center_id, thread_id, author_user, from_role, body) values (%L, %L, %L, true, %L)', :c, :th_z2, :u_zone, 'Not mine.'), '42501'), 'C6 but not another zone''s');
reset role;
select pg_temp.sign_in(:u_none);
select pg_temp.assert((select count(*) = 0 from app.threads where center_id = :c), 'C7 a person with no role sees no conversation');
reset role;

-- ── D. The message queue is read-only for staff (0599) ───────────────────────────────────
select pg_temp.sign_in(:u_a);
select pg_temp.assert((select count(*) = 1 from app.messages where id = :ms), 'D1 staff with comms.send read the queue');
select pg_temp.assert(pg_temp.fails_with(format('insert into app.messages (center_id, channel, to_address, body, status) values (%L, %L, %L, %L, %L)', :c, 'email', 'x@example.com', 'Made up', 'sent'), '42501'),
                      'D2 but cannot write a message into it');
select pg_temp.assert(pg_temp.fails_with(format('update app.messages set status = %L where id = %L', 'sent', :ms), '42501'), 'D3 or change one');
reset role;

rollback;
