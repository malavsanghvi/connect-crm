-- 0599: staff with comms.send can no longer write app.messages directly (BACKLOG B49 item 3).
-- Before, messages_staff_write ("for all", comms.send) let a signed-in staff member insert, change or delete queue rows
-- through the API: a row with no job (never sent), any address, no template, no suppression or quiet-hours check. Now
-- messages are written only by the sending functions (security definer) and the service role. Staff still read the
-- queue of their own community (and no other), members still read their own in-app messages, the portal's sending
-- screens (send_test_message, send_recipient_verification) still work, and the background service still records results.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

grant connect_worker to postgres;

\set a '''84000000-0000-4000-8000-0000000000c1'''
\set b '''84000000-0000-4000-8000-0000000000c2'''
\set u_staff '''84000000-0000-4000-8000-0000000000a1'''
\set u_staff_b '''84000000-0000-4000-8000-0000000000a2'''
\set u_member '''84000000-0000-4000-8000-0000000000a3'''
\set u_admin '''84000000-0000-4000-8000-0000000000a4'''

-- Two communities. In A: a communications officer (comms.send), a settings admin, and a plain member. In B: a
-- communications officer.
insert into auth.users (id, email) values
  (:u_staff, 'staff84@example.com'), (:u_staff_b, 'staffb84@example.com'), (:u_member, 'member84@example.com'), (:u_admin, 'admin84@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:a, 'staffwrite84a', 'Staff Write Center A', 'SWA', 'TX', 'active', 'America/Chicago'),
  (:b, 'staffwrite84b', 'Staff Write Center B', 'SWB', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:a, :u_staff, 'communications_officer', 'center'), (:b, :u_staff_b, 'communications_officer', 'center'), (:a, :u_admin, 'center_admin', 'center');
-- One message in each community, written the way the database writes them.
select app.enqueue_message(:a, 'email', 'someone84a@example.com', 'test_message', '{}'::jsonb, 'notification') as ma \gset
select app.enqueue_message(:b, 'email', 'someone84b@example.com', 'test_message', '{}'::jsonb, 'notification') as mb \gset

-- ── The rule ─────────────────────────────────────────────────────────────────────
select pg_temp.assert(not exists (select 1 from pg_policy where polrelid = 'app.messages'::regclass and polname = 'messages_staff_write'),
  'the policy that let staff write the queue is gone');
select pg_temp.assert(not exists (select 1 from pg_policy where polrelid = 'app.messages'::regclass and polpermissive and polcmd in ('a', 'w', 'd', '*')),
  'no permissive policy lets any signed-in role insert, change or delete a message');
select pg_temp.assert(exists (select 1 from pg_policy where polrelid = 'app.messages'::regclass and polname = 'messages_staff_read')
                      and exists (select 1 from pg_policy where polrelid = 'app.messages'::regclass and polname = 'messages_own')
                      and exists (select 1 from pg_policy where polrelid = 'app.messages'::regclass and polname = 'messages_platform_read'),
  'the read policies stay: staff, a member''s own in-app messages, the platform team''s');
select pg_temp.assert(not has_table_privilege('authenticated', 'app.messages', 'insert')
                      and not has_table_privilege('authenticated', 'app.messages', 'update')
                      and not has_table_privilege('authenticated', 'app.messages', 'delete')
                      and has_table_privilege('authenticated', 'app.messages', 'select')
                      and not has_table_privilege('anon', 'app.messages', 'insert')
                      and has_table_privilege('service_role', 'app.messages', 'insert'),
  'signed-in roles can only read the table; the service role keeps full access');

-- ── Staff with comms.send ────────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:u_staff);
select pg_temp.assert((select count(*) from app.messages where id = :'ma') = 1 and (select count(*) from app.messages where id = :'mb') = 0,
  'a communications officer still reads the queue of their own community, and no other');
select pg_temp.assert_raises($$insert into app.messages (center_id, channel, to_address, subject, body, status)
  values ('84000000-0000-4000-8000-0000000000c1', 'email', 'anyone@example.com', 'Hi', 'Written by hand', 'queued')$$,
  'permission denied', 'inserting a message row directly is refused', '42501');
select pg_temp.assert_raises($$update app.messages set body = 'changed', to_address = 'else@example.com' where id = '$$ || :'ma' || $$'$$,
  'permission denied', 'changing a queued message is refused', '42501');
select pg_temp.assert_raises($$delete from app.messages where id = '$$ || :'ma' || $$'$$,
  'permission denied', 'deleting a message is refused', '42501');
commit;
select pg_temp.assert((select body is not null and to_address = 'someone84a@example.com' and status = 'queued' from app.messages where id = :'ma'),
  'and the message is as the database wrote it');

-- The sending screens still work: they go through functions that check consent, quiet hours and the audit context.
begin;
select pg_temp.sign_in(:u_staff);
select app.send_test_message(:a, 'email', 'test84@example.com') as sent \gset
commit;
select pg_temp.assert((select m.status = 'queued' and m.purpose = 'test' and m.to_address = 'test84@example.com' and m.created_by = :u_staff and m.job_id is not null
                              and j.kind = 'messaging.test_send' and j.status = 'queued'
                         from app.messages m join app.jobs j on j.id = m.job_id where m.id = :'sent'),
  'a test message from Settings is queued through send_test_message, with its job and the person who asked');
begin;
select pg_temp.sign_in(:u_staff);
select pg_temp.assert(app.send_test_message(:a, 'push') is not null, 'a test push to the officer''s own phone works too');
commit;

-- ── Another community''s staff, a settings admin and a member ────────────────────────
begin;
select pg_temp.sign_in(:u_staff_b);
select pg_temp.assert((select count(*) from app.messages where id in (:'ma', :'mb')) = 1, 'the other community''s officer reads only their own queue');
select pg_temp.assert_raises($$update app.messages set body = 'changed' where id = '$$ || :'ma' || $$'$$,
  'permission denied', 'and cannot change another community''s messages either', '42501');
commit;
begin;
select pg_temp.sign_in(:u_admin);
select pg_temp.assert_raises($$insert into app.messages (center_id, channel, to_address, body) values ('84000000-0000-4000-8000-0000000000c1', 'email', 'x@example.com', 'Hi')$$,
  'permission denied', 'a center admin cannot write the queue by hand either', '42501');
commit;
begin;
select pg_temp.sign_in(:u_member);
select pg_temp.assert((select count(*) from app.messages) = 0, 'a member sees no queue rows');
select pg_temp.assert_raises($$insert into app.messages (center_id, channel, to_address, body) values ('84000000-0000-4000-8000-0000000000c1', 'email', 'x@example.com', 'Hi')$$,
  'permission denied', 'and cannot write one', '42501');
commit;

-- ── The database''s own writers are unaffected ──────────────────────────────────────
begin;
set local role connect_worker;
select app.worker_message_result(:'ma', 'sent', 'resend', 're_84', null, null);
reset role;
commit;
select pg_temp.assert((select status = 'sent' and provider_ref = 're_84' from app.messages where id = :'ma'),
  'the background service still records the result of a send');
select app.enqueue_message(:a, 'email', 'another84@example.com', 'test_message', '{}'::jsonb, 'notification') as m3 \gset
select pg_temp.assert((select status = 'queued' and job_id is not null from app.messages where id = :'m3'),
  'and the sending function still queues a message with its job');
