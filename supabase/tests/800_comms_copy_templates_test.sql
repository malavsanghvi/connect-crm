-- 0800: copy a communication as a new draft, and a community's saved templates.
--   A. The shape: the working_draft status, the table (words only, never an audience or a statistic), RLS, audit, module, functions
--   B. Copy as a new draft: what a copy carries (subject, message with its merge fields, translations, channels, audience, segment) and drops
--      (schedule, sent time, counts, approvals, the recipients), "Copy of <name>", every channel, the source untouched
--   C. Who may copy: comms.send in the community only; another community's communication is "not found"; alerts are not copied
--   D. Saved templates: save (default name, unique name, words only), read (comms.send only, own community only), no direct writes
--   E. Start from a template (a working draft with no audience), rename, delete, and what deleting leaves alone
--   F. Communications switched off
-- The whole test is one transaction that is rolled back at the end, so nothing it creates is seen by the tests that run after it.
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
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end $$;

\set a '''e8000000-0000-4000-8000-0000000000c1'''
\set b '''e8000000-0000-4000-8000-0000000000c2'''
\set u_officer '''e8000000-0000-4000-8000-0000000000a1'''
\set u_viewer '''e8000000-0000-4000-8000-0000000000a2'''
\set u_member '''e8000000-0000-4000-8000-0000000000a3'''
\set u_officer_b '''e8000000-0000-4000-8000-0000000000a4'''
\set u_first '''e8000000-0000-4000-8000-0000000000a5'''
\set u_second '''e8000000-0000-4000-8000-0000000000a6'''
\set seg '''e8000000-0000-4000-8000-000000000051'''
\set sent '''e8000000-0000-4000-8000-000000000101'''
\set draft '''e8000000-0000-4000-8000-000000000102'''
\set sched '''e8000000-0000-4000-8000-000000000103'''
\set wa '''e8000000-0000-4000-8000-000000000104'''
\set alert '''e8000000-0000-4000-8000-000000000105'''
\set other_b '''e8000000-0000-4000-8000-000000000106'''
\set missing '''e8000000-0000-4000-8000-0000000000ff'''

begin;

-- Two communities. In A: a communications officer (comms.send), someone who can only read communications (comms.view), and a plain
-- member. In B: a communications officer.
insert into auth.users (id, email) values
  (:u_officer, 'officer800@example.com'), (:u_viewer, 'viewer800@example.com'), (:u_member, 'member800@example.com'),
  (:u_officer_b, 'officerb800@example.com'), (:u_first, 'first800@example.com'), (:u_second, 'second800@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:a, 'copytpl800a', 'Copy Templates Center A', 'CTA', 'TX', 'active', 'America/Chicago'),
  (:b, 'copytpl800b', 'Copy Templates Center B', 'CTB', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values
  (:a, :u_officer, 'communications_officer', 'center'),
  (:a, :u_viewer, 'executive_viewer', 'center'),
  (:b, :u_officer_b, 'communications_officer', 'center');

-- Communications in A. A sent one with results, approvals, a saved segment and a recipient; a draft with no name; a scheduled text; a draft
-- WhatsApp; an alert. One in B.
insert into app.saved_segments (id, center_id, name, definition) values (:seg, :a, 'North families', '{"zone_ids": []}');
insert into app.comms_campaigns (id, center_id, kind, name, title, body_md, translations, channels, audience, saved_segment_id,
                                 scheduled_at, sent_at, status, requires_second_approver, approved_by, second_approver, recipients_count, opened_count, created_by) values
  (:sent, :a, 'newsletter', 'September news', 'News for {{recipient_first_name}}', E'Dear {{recipient_first_name}},\n\nSee you at the picnic.',
   '{"es": {"title": "Noticias {{recipient_first_name}}", "body_md": "Hola {{recipient_first_name}}"}}', '{email,push}', '{"all_members": true}', :seg,
   now() - interval '20 days', now() - interval '20 days', 'sent', true, :u_first, :u_second, 300, 120, :u_officer);
insert into app.comms_campaigns (id, center_id, kind, name, title, body_md, channels, audience, status, created_by) values
  (:draft, :a, 'newsletter', null, 'Picnic on Saturday', 'Bring a dish to share.', '{email}', '{"zone_ids": ["e8000000-0000-4000-8000-000000000071"]}', 'draft', :u_officer);
insert into app.comms_campaigns (id, center_id, kind, name, title, body_md, channels, audience, scheduled_at, status, approved_by, created_by) values
  (:sched, :a, 'newsletter', 'Garba text', 'Garba tonight', 'Garba starts at 7.', '{sms}', '{"zone_ids": ["e8000000-0000-4000-8000-000000000071"]}', now() + interval '2 days', 'scheduled', :u_first, :u_officer),
  (:wa, :a, 'announcement', 'Lunch reminder', 'Lunch at noon', 'Hi {{recipient_first_name}}, lunch is at noon.', '{whatsapp}', '{"zone_ids": ["e8000000-0000-4000-8000-000000000071"]}', null, 'draft', null, :u_officer),
  (:alert, :a, 'alert', 'Road closed', 'Road closed', 'Use the side gate.', '{push}', '{"all_members": true}', null, 'draft', null, :u_officer);
insert into app.comms_campaigns (id, center_id, kind, name, title, body_md, channels, audience, status, created_by) values
  (:other_b, :b, 'newsletter', 'B only', 'Only in B', 'Hello from B.', '{email}', '{"all_members": true}', 'draft', :u_officer_b);
insert into app.messages (center_id, campaign_id, channel, to_address, body, status) values (:a, :sent, 'email', 'someone800@example.com', 'Dear Someone', 'sent');

-- ══ A. The shape ══════════════════════════════════════════════════════════════
select pg_temp.assert_raises($$insert into app.comms_campaigns (center_id, kind, title, status) values ('e8000000-0000-4000-8000-0000000000c1', 'newsletter', 'x', 'bogus')$$,
  'check', 'a status that is not one of the known ones is still refused');
select pg_temp.assert((select count(*) = 1 from app.comms_campaigns where id = :sent and status = 'sent'), 'the existing statuses are untouched');
select pg_temp.assert(not exists (select 1 from information_schema.columns
                                   where table_schema = 'app' and table_name = 'comms_templates'
                                     and column_name in ('audience', 'saved_segment_id', 'status', 'recipients_count', 'opened_count', 'sent_at', 'scheduled_at', 'approved_by', 'second_approver')),
  'a template has no audience, schedule, state, approval or statistic column: it is the words only');
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.comms_templates'::regclass)
                      and exists (select 1 from pg_policy where polrelid = 'app.comms_templates'::regclass and polname = 'comms_templates_read' and polcmd = 'r')
                      and not exists (select 1 from pg_policy where polrelid = 'app.comms_templates'::regclass and polpermissive and polcmd <> 'r'),
  'row level security is on and the only permissive policy reads');
select pg_temp.assert(exists (select 1 from pg_policy where polrelid = 'app.comms_templates'::regclass and polname = 'module_switch' and not polpermissive)
                      and (select module_key from app.module_tables where table_name = 'comms_templates') = 'comms',
  'the table belongs to the Communications module and has its restrictive module switch');
select pg_temp.assert(exists (select 1 from pg_trigger t where t.tgrelid = 'app.comms_templates'::regclass and t.tgname = 'audit_comms_templates'
                                and t.tgfoid = 'app.audit_row'::regproc and not t.tgisinternal),
  'every change to a template is audited');
select pg_temp.assert(not has_table_privilege('authenticated', 'app.comms_templates', 'insert')
                      and not has_table_privilege('authenticated', 'app.comms_templates', 'update')
                      and not has_table_privilege('authenticated', 'app.comms_templates', 'delete')
                      and has_table_privilege('authenticated', 'app.comms_templates', 'select')
                      and not has_table_privilege('anon', 'app.comms_templates', 'select')
                      and has_table_privilege('service_role', 'app.comms_templates', 'insert'),
  'signed-in people can only read the table; nobody anonymous reads it; the service role keeps full access');
select pg_temp.assert((select count(*) = 5 and bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                              and bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('copy_campaign_as_draft', 'save_campaign_as_template', 'create_campaign_from_template', 'rename_comms_template', 'delete_comms_template')),
  'the five functions are security definer with the pinned search path (digest() is in extensions), signed-in people may call them and anonymous visitors may not');
select pg_temp.assert(exists (select 1 from app.activity_catalog where key = 'screen:/comms/templates' and kind = 'screen' and surface = 'portal'),
  'the templates screen is in the activity allowlist');

-- ══ B. Copy as a new draft ════════════════════════════════════════════════════
select pg_temp.claims(:u_officer);
set local role authenticated;
select app.copy_campaign_as_draft(:a, :sent) as cp1 \gset
select app.copy_campaign_as_draft(:a, :sent, '  Spring version  ') as cp2 \gset
select app.copy_campaign_as_draft(:a, :draft) as cp3 \gset
select app.copy_campaign_as_draft(:a, :sched) as cp4 \gset
select app.copy_campaign_as_draft(:a, :wa) as cp5 \gset
reset role;

select pg_temp.assert((select c.status = 'working_draft' and c.name = 'Copy of September news' and c.kind = s.kind and c.center_id = :a and c.created_by = :u_officer
                              and c.title = s.title and c.body_md = s.body_md and c.translations = s.translations and c.channels = s.channels
                              and c.audience = s.audience and c.saved_segment_id = s.saved_segment_id
                         from app.comms_campaigns c, app.comms_campaigns s where c.id = :'cp1' and s.id = :sent),
  'a copy is a NEW working draft named "Copy of <name>" with the same kind, subject, message, translations, channels, audience and saved segment');
select pg_temp.assert((select position('{{recipient_first_name}}' in c.title) > 0 and position('{{recipient_first_name}}' in c.body_md) > 0
                              and c.translations->'es'->>'body_md' = 'Hola {{recipient_first_name}}'
                         from app.comms_campaigns c where c.id = :'cp1'),
  'merge fields such as the person''s first name stay in the subject, the message and the translations exactly as written');
select pg_temp.assert((select c.scheduled_at is null and c.sent_at is null and c.recipients_count is null and c.opened_count is null
                              and c.approved_by is null and c.second_approver is null and c.id <> :sent
                         from app.comms_campaigns c where c.id = :'cp1'),
  'a copy carries no schedule, no sent time, no recipient or open counts and no approvals');
select pg_temp.assert((select count(*) = 0 from app.messages where campaign_id = :'cp1')
                      and (select count(*) = 1 from app.messages where campaign_id = :sent),
  'a copy has no recipients (nothing is queued for it) and the original keeps its own');
select pg_temp.assert((select status = 'sent' and recipients_count = 300 and opened_count = 120 and approved_by = :u_first and second_approver = :u_second and name = 'September news'
                         from app.comms_campaigns where id = :sent),
  'the original is exactly as it was: still sent, with its counts and approvals');
select pg_temp.assert((select requires_second_approver from app.comms_campaigns where id = :'cp1'),
  'a copy to all members still needs two approvers: the flag is worked out again from the audience');
select pg_temp.assert((select name = 'Spring version' from app.comms_campaigns where id = :'cp2'),
  'a name given for the copy is used, trimmed');
select pg_temp.assert((select name = 'Copy of Picnic on Saturday' and status = 'working_draft' and channels = '{email}' and not requires_second_approver
                              and audience = '{"zone_ids": ["e8000000-0000-4000-8000-000000000071"]}'::jsonb
                         from app.comms_campaigns where id = :'cp3'),
  'a draft with no name is copied as "Copy of <subject>", and a smaller audience does not need two approvers');
select pg_temp.assert((select status = 'working_draft' and channels = '{sms}' and scheduled_at is null and approved_by is null from app.comms_campaigns where id = :'cp4'),
  'a scheduled text is copied as a draft text: no schedule, no approval');
select pg_temp.assert((select status = 'working_draft' and channels = '{whatsapp}' and kind = 'announcement' and position('{{recipient_first_name}}' in body_md) > 0
                         from app.comms_campaigns where id = :'cp5'),
  'a WhatsApp communication is copied as a draft in the same channel, with its kind and merge fields');
select pg_temp.assert((select count(*) = 5 from app.comms_campaigns where id in (:'cp1', :'cp2', :'cp3', :'cp4', :'cp5') and status = 'working_draft'),
  'every copy is a working draft: none is waiting for approval, scheduled or sent');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'comms_campaigns.insert' and record_id = :'cp1' and center_id = :a and module = 'comms'
                                and actor_user_id = :u_officer),
  'a copy is audited: who made it, in which community');

-- ══ C. Who may copy ═══════════════════════════════════════════════════════════
select pg_temp.claims(:u_viewer);
set local role authenticated;
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', :a, :sent), 'comms.send',
  'someone who can only read communications (comms.view) cannot copy one', '42501');
select pg_temp.assert((select count(*) = 5 from app.comms_campaigns where center_id = :a and status <> 'working_draft'),
  'and still reads the communications of their community (the permission to copy is a different one)');
reset role;
select pg_temp.claims(:u_member);
set local role authenticated;
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', :a, :sent), 'comms.send', 'a member cannot copy a communication', '42501');
reset role;
select pg_temp.claims(:u_officer_b);
set local role authenticated;
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', :b, :sent), 'not found',
  'another community''s officer, working in their own community, cannot copy a communication of A: it is not found', 'P0002');
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', :a, :sent), 'comms.send',
  'and naming community A does not help: they have no rights there, whether or not the communication exists', '42501');
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', :a, :missing), 'comms.send',
  'a communication that does not exist gives the same answer as one that does (nothing leaks)', '42501');
reset role;
select pg_temp.claims(:u_officer);
set local role authenticated;
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', :a, :other_b), 'not found',
  'the officer of A cannot copy a communication of community B', 'P0002');
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', :a, :missing), 'not found', 'a communication that does not exist is not found', 'P0002');
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', :a, :alert), 'cannot be copied', 'an alert is not copied here', '22023');
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', null::uuid, :sent), 'choose the community', 'no community: refused', '22023');
reset role;
select pg_temp.assert((select count(*) = 5 from app.comms_campaigns where status = 'working_draft'), 'none of the refused copies left a draft behind');

-- ══ D. Saved templates ════════════════════════════════════════════════════════
select pg_temp.claims(:u_officer);
set local role authenticated;
select app.save_campaign_as_template(:a, :sent) as t1 \gset
select app.save_campaign_as_template(:a, :draft) as t2 \gset
select app.save_campaign_as_template(:a, :wa, 'Lunch reminder (WhatsApp)') as t3 \gset
reset role;

select pg_temp.assert((select t.name = 'September news' and t.title = c.title and t.body_md = c.body_md and t.translations = c.translations and t.channels = c.channels
                              and t.center_id = :a and t.created_by = :u_officer and t.updated_by = :u_officer
                         from app.comms_templates t, app.comms_campaigns c where t.id = :'t1' and c.id = :sent),
  'saving a template keeps the subject, message, translations and channels, named after the communication, and records who made it');
select pg_temp.assert((select name = 'Picnic on Saturday' and channels = '{email}' from app.comms_templates where id = :'t2'),
  'a communication with no name is saved under its subject');
select pg_temp.assert((select name = 'Lunch reminder (WhatsApp)' and channels = '{whatsapp}' and position('{{recipient_first_name}}' in body_md) > 0
                         from app.comms_templates where id = :'t3'),
  'a name given for the template is used; a WhatsApp template keeps its merge fields (it is only a starting point for the words)');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'comms_templates.insert' and record_id = :'t1' and center_id = :a and module = 'comms' and actor_user_id = :u_officer),
  'saving a template is audited');

select pg_temp.claims(:u_officer);
set local role authenticated;
select pg_temp.assert_raises(format('select app.save_campaign_as_template(%L, %L)', :a, :sent), 'already exists', 'the same name twice is refused', '23505');
select pg_temp.assert_raises(format('select app.save_campaign_as_template(%L, %L, %L)', :a, :draft, '  SEPTEMBER news '), 'already exists',
  'capitals and spaces at the ends do not make a different name', '23505');
select pg_temp.assert_raises(format('select app.save_campaign_as_template(%L, %L)', :a, :alert), 'cannot be saved', 'an alert is not saved as a template', '22023');
select pg_temp.assert_raises(format('select app.save_campaign_as_template(%L, %L)', :a, :other_b), 'not found', 'the officer of A cannot save a communication of B as a template', 'P0002');
select app.save_campaign_as_template(:a, :sched, repeat('x', 150)) as t4 \gset
reset role;
select pg_temp.assert((select char_length(name) = 120 from app.comms_templates where id = :'t4'), 'a very long name is cut to 120 characters');

-- Reading: comms.send in the community only.
select pg_temp.claims(:u_officer);
set local role authenticated;
select pg_temp.assert((select count(*) = 4 from app.comms_templates), 'the officer reads the four templates of their community');
reset role;
select pg_temp.claims(:u_viewer);
set local role authenticated;
select pg_temp.assert((select count(*) = 0 from app.comms_templates), 'someone with only comms.view reads none: reading templates follows the permission that writes a communication');
select pg_temp.assert_raises(format('select app.save_campaign_as_template(%L, %L)', :a, :draft), 'comms.send', 'and cannot save one', '42501');
reset role;
select pg_temp.claims(:u_member);
set local role authenticated;
select pg_temp.assert((select count(*) = 0 from app.comms_templates), 'a member reads none');
reset role;
select pg_temp.claims(:u_officer_b);
set local role authenticated;
select pg_temp.assert((select count(*) = 0 from app.comms_templates), 'the other community''s officer reads none of A''s templates');
select pg_temp.assert_raises(format('select app.save_campaign_as_template(%L, %L, %L)', :a, :sent, 'Taken'), 'comms.send', 'and cannot save into A', '42501');
select app.save_campaign_as_template(:b, :other_b) as tb \gset
select pg_temp.assert((select count(*) = 1 and bool_and(center_id = :b) from app.comms_templates), 'they read their own community''s template and only that');
reset role;

-- Nobody writes the table by hand.
select pg_temp.claims(:u_officer);
set local role authenticated;
select pg_temp.assert_raises(format('insert into app.comms_templates (center_id, name, channels) values (%L, %L, %L)', :a, 'By hand', '{email}'), 'permission denied', 'a template cannot be inserted directly', '42501');
select pg_temp.assert_raises(format('update app.comms_templates set name = %L where id = %L', 'Renamed by hand', :'t1'), 'permission denied', 'nor changed directly', '42501');
select pg_temp.assert_raises(format('delete from app.comms_templates where id = %L', :'t1'), 'permission denied', 'nor deleted directly', '42501');
reset role;

-- ══ E. Start from a template, rename, delete ══════════════════════════════════
select pg_temp.claims(:u_officer);
set local role authenticated;
select app.create_campaign_from_template(:a, :'t1') as w1 \gset
select app.create_campaign_from_template(:a, :'t3', 'Lunch reminder, week 2') as w2 \gset
reset role;
select pg_temp.assert((select c.status = 'working_draft' and c.kind = 'newsletter' and c.name = 'September news' and c.title = t.title and c.body_md = t.body_md
                              and c.translations = t.translations and c.channels = t.channels and c.center_id = :a and c.created_by = :u_officer
                         from app.comms_campaigns c, app.comms_templates t where c.id = :'w1' and t.id = :'t1'),
  'starting from a template makes a working draft with the template''s subject, message, translations and channels');
select pg_temp.assert((select audience = '{}'::jsonb and not requires_second_approver and scheduled_at is null and sent_at is null and approved_by is null
                              and second_approver is null and recipients_count is null and opened_count is null
                         from app.comms_campaigns where id = :'w1'),
  'and with no audience (the person chooses who it goes to), no schedule and no approvals');
select pg_temp.assert((select name = 'Lunch reminder, week 2' and channels = '{whatsapp}' from app.comms_campaigns where id = :'w2'),
  'a name can be given for the new draft');

select pg_temp.claims(:u_officer);
set local role authenticated;
select pg_temp.assert_raises(format('select app.create_campaign_from_template(%L, %L)', :a, :'tb'), 'not found', 'a template of another community is not found', 'P0002');
reset role;
select pg_temp.claims(:u_viewer);
set local role authenticated;
select pg_temp.assert_raises(format('select app.create_campaign_from_template(%L, %L)', :a, :'t1'), 'comms.send', 'someone who can only read communications cannot start from a template', '42501');
select pg_temp.assert_raises(format('select app.rename_comms_template(%L, %L, %L)', :a, :'t1', 'Nope'), 'comms.send', 'nor rename one', '42501');
select pg_temp.assert_raises(format('select app.delete_comms_template(%L, %L)', :a, :'t1'), 'comms.send', 'nor delete one', '42501');
reset role;
select pg_temp.assert((select name = 'September news' from app.comms_templates where id = :'t1'), 'and the template is as it was');

select pg_temp.claims(:u_officer);
set local role authenticated;
select app.rename_comms_template(:a, :'t1', '  Monthly news  ');
select app.rename_comms_template(:a, :'t1', 'MONTHLY NEWS');
reset role;
select pg_temp.assert((select name = 'MONTHLY NEWS' and updated_by = :u_officer and created_by = :u_officer from app.comms_templates where id = :'t1'),
  'renaming keeps the name unique but lets a template change the capitals of its own name');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'comms_templates.update' and record_id = :'t1' and center_id = :a and before->>'name' = 'Monthly news' and after->>'name' = 'MONTHLY NEWS'),
  'a rename is audited with the old and the new name');
select pg_temp.claims(:u_officer);
set local role authenticated;
select pg_temp.assert_raises(format('select app.rename_comms_template(%L, %L, %L)', :a, :'t1', 'picnic on saturday'), 'already exists', 'renaming onto another template''s name is refused', '23505');
select pg_temp.assert_raises(format('select app.rename_comms_template(%L, %L, %L)', :a, :'t1', '   '), 'give the template a name', 'an empty name is refused', '22023');
select pg_temp.assert_raises(format('select app.rename_comms_template(%L, %L, %L)', :a, :'tb', 'Mine now'), 'not found', 'another community''s template cannot be renamed', 'P0002');
reset role;

-- Another community's officer cannot delete A's template, by either route.
select pg_temp.claims(:u_officer_b);
set local role authenticated;
select pg_temp.assert_raises(format('select app.delete_comms_template(%L, %L)', :b, :'t1'), 'not found', 'working in their own community, they do not find A''s template', 'P0002');
select pg_temp.assert_raises(format('select app.delete_comms_template(%L, %L)', :a, :'t1'), 'comms.send', 'and naming A gives no rights there', '42501');
reset role;
select pg_temp.assert((select count(*) = 1 from app.comms_templates where id = :'t1'), 'the template is still there');

select pg_temp.claims(:u_officer);
set local role authenticated;
select app.delete_comms_template(:a, :'t1');
select pg_temp.assert_raises(format('select app.delete_comms_template(%L, %L)', :a, :'t1'), 'not found', 'deleting it again says it is not found', 'P0002');
reset role;
select pg_temp.assert((select count(*) = 0 from app.comms_templates where id = :'t1') and (select count(*) = 3 from app.comms_templates where center_id = :a),
  'the template is gone and the others are untouched');
select pg_temp.assert(exists (select 1 from app.audit_log where action = 'comms_templates.delete' and record_id = :'t1' and center_id = :a and actor_user_id = :u_officer),
  'a deletion is audited');
select pg_temp.assert((select status = 'working_draft' and name = 'September news' from app.comms_campaigns where id = :'w1') and (select count(*) = 1 from app.comms_campaigns where id = :sent),
  'communications made from the template, and the one it was saved from, are not touched');

-- ══ F. Communications switched off ════════════════════════════════════════════
-- The switch is flipped by the platform (no one signed in): a signed-in staff write there would ask for a fresh 2FA check.
select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
insert into app.center_modules (center_id, module_key, enabled, reason) values (:a, 'comms', false, 'test 800');
select pg_temp.claims(:u_officer);
set local role authenticated;
select pg_temp.assert_raises(format('select app.copy_campaign_as_draft(%L, %L)', :a, :sent), 'switched off', 'with Communications off nothing can be copied', '42501');
select pg_temp.assert_raises(format('select app.save_campaign_as_template(%L, %L, %L)', :a, :draft, 'Off'), 'switched off', 'nor saved as a template', '42501');
select pg_temp.assert((select count(*) = 0 from app.comms_templates), 'and the templates are not read');
reset role;
select pg_temp.assert((select count(*) = 3 from app.comms_templates where center_id = :a), 'they are all still there for when it is switched on');

rollback;
