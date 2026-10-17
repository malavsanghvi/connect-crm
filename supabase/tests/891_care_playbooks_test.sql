-- 0891 (DonorDelight slice 5, playbooks, docs/DONORDELIGHT.md sections 5.6 and 13): the playbooks of a community and the starters per kind of organization.
--   A. The starters are data: both audiences have the same set, every step is a plain touch (no ask), every trigger and kind is one the rules know.
--   B. Installing them: care.manage only, the audience follows the kind of organization (faith or civic), idempotent, in the community's own copy.
--   C. Reading: the playbooks with their steps in order; care.own reads; people.view alone and platform admins read nothing.
--   D. Saving: create, change, a removed step is archived (never deleted), plain-English refusals, other communities untouched.
--   E. Pausing; audited without the words.
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

\set c1 '''89100000-0000-4000-8000-0000000000c1'''
\set c2 '''89100000-0000-4000-8000-0000000000c2'''
\set owner '''89100000-0000-4000-8000-000000000001'''
\set plat '''89100000-0000-4000-8000-000000000002'''
\set lead '''89100000-0000-4000-8000-000000000003'''
\set rel '''89100000-0000-4000-8000-000000000004'''
\set clerk '''89100000-0000-4000-8000-000000000005'''
\set lead2 '''89100000-0000-4000-8000-000000000006'''

insert into auth.users (id, email) values
  (:owner, 'owner891@c1.test'), (:plat, 'plat891@weaver.test'), (:lead, 'lead891@c1.test'), (:rel, 'rel891@c1.test'), (:clerk, 'clerk891@c1.test'), (:lead2, 'lead2891@c2.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'pb891a', 'Grace Church 891', 'G891', 'TX', 'active', 'America/Chicago', 'church', 'sandbox'),
  (:c2, 'pb891b', 'Harbor Food Bank 891', 'H891', 'TX', 'active', 'America/Chicago', 'nonprofit_secular', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values
  (:c1, 'care', true, 'Test 891: DonorDelight'), (:c2, 'care', true, 'Test 891: DonorDelight');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('people_viewer_891', 'center', 'People viewer 891', 'center', 'Test 891', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 891: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 891'), (:c1, :rel, 'relationship_owner', 'center', 'Test 891'), (:c1, :clerk, 'people_viewer_891', 'center', 'Test 891'),
  (:c2, :lead2, 'care_lead', 'center', 'Test 891');

-- ══ A. The starters are data ═════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app.care_starters where audience = 'faith') = (select count(*) from app.care_starters where audience = 'civic')
                      and (select count(*) from app.care_starters where audience = 'faith') >= 9,
  'A · both kinds of organization have the same starter playbooks (at least nine)');
select pg_temp.assert(not exists (select 1 from app.care_starters st where st.trigger_key not in ('first_gift', 'new_household', 'steady', 'cooling', 'at_risk', 'lapsed', 'volunteer_no_gift', 'giver_no_part', 'pledge_due', 'monthly_giver')),
  'A · every starter''s trigger is one the rules know');
select pg_temp.assert(not exists (select 1 from app.care_starters st, jsonb_array_elements(st.steps) e
                                   where e->>'kind' not in ('thank_you', 'check_in', 'greeting', 'welcome', 'update', 'invitation', 'other')
                                      or coalesce(e->>'channel', 'phone') not in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post', 'video', 'other')
                                      or (e->>'after_days')::int not between 0 and 365 or char_length(e->>'draft') > 1500 or char_length(e->>'why') > 300 or char_length(e->>'title') > 120),
  'A · every starter step is a plain touch with a kind, a channel and a day the rules accept');
select pg_temp.assert(not exists (select 1 from app.care_starters st, jsonb_array_elements(st.steps) e where e ? 'is_ask'),
  'A · no step has an ask: asks are their own touches, after the touch balance');
select pg_temp.assert((select count(*) from app.care_starters where trigger_key = 'pledge_due') = 2
                      and not exists (select 1 from app.care_starters st, jsonb_array_elements(st.steps) e
                                       where st.trigger_key = 'pledge_due' and e->>'draft' ~* '(please give|donate|consider giving|increase your)'),
  'A · the pledge reminder reminds and never asks for more');
select pg_temp.assert(not exists (select 1 from app.care_starters st where st.steps::text ~* '(temple|church|mosque|gurdwara|synagogue|jsh|jain|hindu|christian|muslim|swaminarayan)'),
  'A · no starter names a community or a religion');

-- ══ B. Installing ════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:rel);
select pg_temp.assert_raises($$select app.install_care_starters('89100000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · a relationship owner (care.own) cannot install');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.install_care_starters('89100000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · people.view alone cannot');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.install_care_starters('89100000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · a platform admin cannot');
select pg_temp.assert_raises($$select app.care_playbooks_list('89100000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · nor read the playbooks');
select pg_temp.claims(:lead);
select pg_temp.assert((app.care_playbooks_list(:c1) ->> 'audience') = 'faith' and (app.care_playbooks_list(:c1) ->> 'starters_missing')::int >= 9
                      and jsonb_array_length(app.care_playbooks_list(:c1) -> 'playbooks') = 0, 'B · a church starts with none, and the list says how many starters wait');
select app.install_care_starters(:c1) as n1 \gset
select pg_temp.assert(:n1::int >= 9 and app.install_care_starters(:c1) = 0, 'B · installing copies the starters once; installing again copies none');
select pg_temp.assert((app.care_playbooks_list(:c1) ->> 'starters_missing')::int = 0 and (app.care_playbooks_list(:c1) ->> 'can_manage')::boolean
                      and exists (select 1 from jsonb_array_elements(app.care_playbooks_list(:c1) -> 'playbooks') p where p ->> 'name' = 'Welcome a new family'),
  'B · a church gets the faith wording ("a new family")');
select pg_temp.claims(:lead2);
select app.install_care_starters(:c2) as n2 \gset
select pg_temp.assert(:n2::int = :n1::int and exists (select 1 from jsonb_array_elements(app.care_playbooks_list(:c2) -> 'playbooks') p where p ->> 'name' = 'Welcome a new supporter')
                      and not exists (select 1 from jsonb_array_elements(app.care_playbooks_list(:c2) -> 'playbooks') p where p ->> 'name' = 'Welcome a new family'),
  'B · a food bank gets the civic wording ("a new supporter"), the same set');
select pg_temp.assert_raises($$select app.install_care_starters('89100000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · a manager of one community cannot install into another');

-- ══ C. Reading ═══════════════════════════════════════════════════════════════
select pg_temp.claims(:rel);
select app.care_playbooks_list(:c1) as l \gset
select pg_temp.assert(jsonb_array_length(:'l'::jsonb -> 'playbooks') = :n1::int and not (:'l'::jsonb ->> 'can_manage')::boolean, 'C · a relationship owner reads the playbooks but cannot change them');
select pg_temp.assert((select jsonb_array_length(p -> 'steps') from jsonb_array_elements(:'l'::jsonb -> 'playbooks') p where p ->> 'key' = 'first_gift') = 3
                      and (select (p -> 'steps' -> 0 ->> 'after_days')::int from jsonb_array_elements(:'l'::jsonb -> 'playbooks') p where p ->> 'key' = 'first_gift') = 0
                      and (select (p -> 'steps' -> 2 ->> 'after_days')::int from jsonb_array_elements(:'l'::jsonb -> 'playbooks') p where p ->> 'key' = 'first_gift') = 45,
  'C · the steps come in order, with their day');
select pg_temp.assert(not exists (select 1 from app.care_playbooks where center_id = :c2), 'C · row security: a church''s manager sees none of the food bank''s playbooks');
select pg_temp.claims(:clerk);
select pg_temp.assert(not exists (select 1 from app.care_playbooks), 'C · people.view alone reads no playbook row either');
select pg_temp.claims(:plat);
select pg_temp.assert(not exists (select 1 from app.care_playbooks) and not exists (select 1 from app.care_playbook_steps), 'C · a platform admin reads no playbook row');

-- ══ D. Saving ════════════════════════════════════════════════════════════════
select pg_temp.claims(:lead);
select app.save_care_playbook(:c1, jsonb_build_object('name', 'Annual visit', 'summary', 'Visit our oldest friends once a year.', 'trigger_key', 'steady', 'window_days', 30, 'cooldown_days', 365,
  'steps', jsonb_build_array(jsonb_build_object('after_days', 0, 'title', 'Visit', 'why', 'They like company.', 'kind', 'check_in', 'channel', 'in_person', 'draft', 'Hello {{name}}, may {{me}} visit?'),
                             jsonb_build_object('after_days', 10, 'title', 'Write after the visit', 'why', 'A note keeps it warm.', 'kind', 'update')))) as pid \gset
select pg_temp.assert((select count(*) from app.care_playbook_steps where playbook_id = :'pid' and archived_at is null) = 2 and (select key from app.care_playbooks where id = :'pid') like 'p\_annual\_visit\_%',
  'D · a new playbook is saved with its steps in order');
select (p -> 'steps' -> 1 ->> 'id')::uuid as step2, (p -> 'steps' -> 0 ->> 'id')::uuid as step1
  from jsonb_array_elements(app.care_playbooks_list(:c1) -> 'playbooks') p where p ->> 'id' = :'pid' \gset
select app.save_care_playbook(:c1, jsonb_build_object('id', :'pid', 'name', 'Annual visit (edited)',
  'steps', jsonb_build_array(jsonb_build_object('id', :'step1', 'after_days', 3, 'title', 'Visit soon', 'why', 'They like company.', 'kind', 'check_in', 'channel', 'in_person')))) is not null as saved \gset
select pg_temp.assert((select name from app.care_playbooks where id = :'pid') = 'Annual visit (edited)' and (select trigger_key from app.care_playbooks where id = :'pid') = 'steady'
                      and (select window_days from app.care_playbooks where id = :'pid') = 30,
  'D · a change keeps what it did not mention (the trigger and the window)');
select pg_temp.assert((select after_days from app.care_playbook_steps where id = :'step1') = 3 and (select archived_at is not null from app.care_playbook_steps where id = :'step2')
                      and (select count(*) from app.care_playbook_steps where playbook_id = :'pid') = 2,
  'D · a step left out is archived, never deleted');
select pg_temp.assert(jsonb_array_length((select p -> 'steps' from jsonb_array_elements(app.care_playbooks_list(:c1) -> 'playbooks') p where p ->> 'id' = :'pid')) = 1, 'D · the list shows only the live steps');
select pg_temp.claims(:rel);
select pg_temp.assert_raises(format($$select app.save_care_playbook(%L, '{"name":"x"}'::jsonb)$$, '89100000-0000-4000-8000-0000000000c1'), 'don''t have access', 'D · a relationship owner cannot save');
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format($$select app.save_care_playbook(%L, %L::jsonb)$$, '89100000-0000-4000-8000-0000000000c1', '{"name":"x","trigger_key":"nope","steps":[{"after_days":0,"title":"a","why":"b","kind":"check_in"}]}'),
  'who the playbook is for', 'D · an unknown trigger is refused in words');
select pg_temp.assert_raises(format($$select app.save_care_playbook(%L, %L::jsonb)$$, '89100000-0000-4000-8000-0000000000c1', '{"name":"x","trigger_key":"steady","steps":[]}'),
  '1 to 12 steps', 'D · a playbook needs at least one step');
select pg_temp.assert_raises(format($$select app.save_care_playbook(%L, %L::jsonb)$$, '89100000-0000-4000-8000-0000000000c1', '{"name":"x","trigger_key":"steady","steps":[{"after_days":0,"title":"a","why":"b","kind":"care_moment"}]}'),
  'say what the touch is', 'D · a care moment is not a playbook step (it is never planned)');
select pg_temp.assert_raises(format($$select app.save_care_playbook(%L, %L::jsonb)$$, '89100000-0000-4000-8000-0000000000c1', '{"name":"x","trigger_key":"steady","steps":[{"after_days":0,"title":"a","why":"b","kind":"check_in","is_ask":true}]}'),
  'no field "is_ask"', 'D · a step cannot carry an ask');
select pg_temp.assert_raises(format($$select app.save_care_playbook(%L, %L::jsonb)$$, '89100000-0000-4000-8000-0000000000c1', '{"name":"x","trigger_key":"steady","steps":[{"after_days":400,"title":"a","why":"b","kind":"check_in"}]}'),
  'how many days', 'D · a step falls within a year');
select pg_temp.assert_raises(format($$select app.save_care_playbook(%L, %L::jsonb)$$, '89100000-0000-4000-8000-0000000000c1', '{"name":"","trigger_key":"steady","steps":[{"after_days":0,"title":"a","why":"b","kind":"check_in"}]}'),
  'give the playbook a name', 'D · a playbook has a name');
select pg_temp.assert_raises(format($$select app.save_care_playbook(%L, %L::jsonb)$$, '89100000-0000-4000-8000-0000000000c1', '{"name":"x","trigger_key":"steady","color":"red","steps":[{"after_days":0,"title":"a","why":"b","kind":"check_in"}]}'),
  'no field "color"', 'D · an unknown field is refused, not ignored');
select pg_temp.claims(:lead2);
select pg_temp.assert_raises(format($$select app.save_care_playbook(%L, jsonb_build_object('id', %L, 'name', 'Hijack', 'steps', '[{"after_days":0,"title":"a","why":"b","kind":"check_in"}]'::jsonb))$$, '89100000-0000-4000-8000-0000000000c2', :'pid'),
  'not found', 'D · another community''s playbook id is not found');

-- ══ E. Pausing; audited without the words ════════════════════════════════════
select pg_temp.claims(:lead);
select app.set_care_playbook_enabled(:'pid', false);
select pg_temp.assert(not (select enabled from app.care_playbooks where id = :'pid'), 'E · a playbook can be paused');
select pg_temp.claims(:rel);
select pg_temp.assert_raises(format($$select app.set_care_playbook_enabled(%L, true)$$, :'pid'), 'don''t have access', 'E · only a manager can resume it');
reset role;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'care_playbooks' and module = 'care') >= 3
                      and not exists (select 1 from app.audit_log where record_table in ('care_playbooks', 'care_playbook_steps') and (after::text ~* 'Annual visit' or after::text ~* 'Hello'))
                      and not exists (select 1 from app.audit_log where record_table in ('care_playbooks', 'care_playbook_steps') and module is distinct from 'care'),
  'E · every change is audited under DonorDelight, with the columns and never the words');
rollback;
