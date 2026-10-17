-- 0897 (DonorDelight slice 9, "How would you like to be thanked?" in the member app, docs/DONORDELIGHT.md section 9): a member's own three choices, nothing else.
--   A. The organization decides whether to ask: off until a care manager turns it on; only care.manage changes that.
--   B. A member of the household sees and sets ONLY thanks, recognition and the way to reach them; the rest of the care profile (do-not-ask, rest) is untouched;
--      partial updates keep the rest; plain-English refusals; no child, no stranger, no one from another community, no platform admin who is not a member.
--   C. W2: a member reads none of the organization's care data and cannot call its functions; the answer holds nothing else.
--   D. DonorDelight off: nothing is asked. The audit records who and which columns, never the words.
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

\set c1 '''89700000-0000-4000-8000-0000000000c1'''
\set c2 '''89700000-0000-4000-8000-0000000000c2'''
\set owner '''89700000-0000-4000-8000-000000000001'''
\set plat '''89700000-0000-4000-8000-000000000002'''
\set lead '''89700000-0000-4000-8000-000000000003'''
\set rel '''89700000-0000-4000-8000-000000000004'''
\set ma '''89700000-0000-4000-8000-000000000005'''
\set mb '''89700000-0000-4000-8000-000000000006'''
\set kid '''89700000-0000-4000-8000-000000000007'''
\set stranger '''89700000-0000-4000-8000-000000000008'''
\set outsider '''89700000-0000-4000-8000-000000000009'''
\set h1 '''89700000-0000-4000-8000-0000000000b1'''
\set h2 '''89700000-0000-4000-8000-0000000000b2'''
\set h3 '''89700000-0000-4000-8000-0000000000b3'''
\set pa '''89700000-0000-4000-8000-0000000000a1'''
\set pb '''89700000-0000-4000-8000-0000000000a2'''
\set pk '''89700000-0000-4000-8000-0000000000a3'''
\set ps '''89700000-0000-4000-8000-0000000000a4'''
\set po '''89700000-0000-4000-8000-0000000000a5'''

insert into auth.users (id, email) values
  (:owner, 'owner897@c1.test'), (:plat, 'plat897@weaver.test'), (:lead, 'lead897@c1.test'), (:rel, 'rel897@c1.test'), (:ma, 'ma897@c1.test'), (:mb, 'mb897@c1.test'),
  (:kid, 'kid897@c1.test'), (:stranger, 'stranger897@c1.test'), (:outsider, 'outsider897@c2.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true) on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'mem897a', 'Grace Church 897', 'G897', 'TX', 'active', 'America/Chicago', 'church', 'sandbox'),
  (:c2, 'mem897b', 'Harbor Food Bank 897', 'H897', 'TX', 'active', 'America/Chicago', 'nonprofit_secular', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 897'), (:c2, 'care', true, 'Test 897');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 897: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 897'), (:c1, :rel, 'relationship_owner', 'center', 'Test 897');
insert into app.households (id, center_id, display_name) values (:h1, :c1, 'Alder897, Ana'), (:h2, :c1, 'Birch897, Bo'), (:h3, :c2, 'Cedar897, Cy');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pa, :c1, 'Ana', 'Alder897', date '1980-01-01'), (:pb, :c1, 'Abe', 'Alder897', date '1979-01-01'),
  (:pk, :c1, 'Kit', 'Alder897', ((now() at time zone 'America/Chicago')::date - interval '9 years')::date),
  (:ps, :c1, 'Bo', 'Birch897', date '1975-02-02'), (:po, :c2, 'Cy', 'Cedar897', date '1976-03-03');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :pa, :c1, 'primary', true), (:h1, :pb, :c1, 'spouse', false), (:h1, :pk, :c1, 'child', false), (:h2, :ps, :c1, 'primary', true), (:h3, :po, :c2, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c1, :ma, :pa), (:c1, :mb, :pb), (:c1, :kid, :pk), (:c1, :stranger, :ps), (:c2, :outsider, :po);
-- The organization's own profile for the Alder household: do not ask, resting until a day in the future, a language and a first thanks.
insert into app.care_profiles (household_id, center_id, thanks, do_not_ask, rest_until) values (:h1, :c1, 'call', true, (now() at time zone 'America/Chicago')::date + 30);

-- ══ A. The organization decides whether to ask ═══════════════════════════════
set role authenticated;
select pg_temp.claims(:ma);
select pg_temp.assert((app.member_care_preferences(:c1) ->> 'available')::boolean = false, 'A · until the organization turns it on, the question is not available');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '{"thanks":"card"}'::jsonb)$$, 'not asking this yet', 'A · and nothing can be saved');
select pg_temp.claims(:rel);
select pg_temp.assert_raises($$select app.save_care_member_settings('89700000-0000-4000-8000-0000000000c1', true)$$, 'don''t have access', 'A · a relationship owner cannot turn it on');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.save_care_member_settings('89700000-0000-4000-8000-0000000000c1', true)$$, 'don''t have access', 'A · nor a platform admin');
select pg_temp.claims(:ma);
select pg_temp.assert_raises($$select app.care_member_settings_get('89700000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'A · a member reads none of the organization''s settings');
select pg_temp.claims(:lead);
select pg_temp.assert_raises($$select app.save_care_member_settings('89700000-0000-4000-8000-0000000000c1', null)$$, 'say whether members', 'A · yes or no');
select app.save_care_member_settings(:c1, true) as on1 \gset
select pg_temp.assert((:'on1'::jsonb ->> 'enabled')::boolean and (app.care_member_settings_get(:c1) ->> 'can_manage')::boolean, 'A · a care manager turns it on');

-- ══ B. A member's own three choices ══════════════════════════════════════════
select pg_temp.claims(:ma);
select pg_temp.assert((app.member_care_preferences(:c1) ->> 'available')::boolean and (app.member_care_preferences(:c1) ->> 'thanks') = 'call', 'B · the member sees what the household already says (a call)');
select app.save_member_care_preferences(:c1, '{"thanks":"card","recognition":"private_only","channel":"post"}'::jsonb) as s1 \gset
select pg_temp.assert((:'s1'::jsonb ->> 'thanks') = 'card' and (:'s1'::jsonb ->> 'recognition') = 'private_only' and (:'s1'::jsonb ->> 'channel') = 'post', 'B · the member chooses how to be thanked, recognised and reached');
select pg_temp.assert((select array_agg(k order by k) from jsonb_object_keys(:'s1'::jsonb) k) = array['available', 'channel', 'recognition', 'thanks'], 'B · the answer holds those three and nothing else');
reset role;
select pg_temp.assert((select do_not_ask and rest_until is not null and updated_by = '89700000-0000-4000-8000-000000000005' from app.care_profiles where household_id = :h1),
  'B · the rest of the household''s profile (do not ask, the rest-until day) is untouched, and who changed it is recorded');
set role authenticated;
select pg_temp.claims(:mb);
select pg_temp.assert((app.member_care_preferences(:c1) ->> 'thanks') = 'card', 'B · the other adult of the household sees the same choices');
select app.save_member_care_preferences(:c1, '{"recognition":null}'::jsonb) as s2 \gset
select pg_temp.assert((:'s2'::jsonb ->> 'thanks') = 'card' and (:'s2'::jsonb -> 'recognition') = 'null'::jsonb and (:'s2'::jsonb ->> 'channel') = 'post', 'B · a key left out keeps its value, and null clears one');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '{"do_not_ask":false}'::jsonb)$$, 'nothing else here', 'B · a member cannot change do-not-ask, the rest or anything else');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '{"thanks":"gold"}'::jsonb)$$, 'how you would like to be thanked', 'B · only the known ways to be thanked');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '{"recognition":"famous"}'::jsonb)$$, 'recognised', 'B · and recognised');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '{"channel":"pigeon"}'::jsonb)$$, 'reach you', 'B · and reached');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '[]'::jsonb)$$, 'nothing to save', 'B · a list is not a choice');
select pg_temp.claims(:kid);
select pg_temp.assert((app.member_care_preferences(:c1) ->> 'available')::boolean = false, 'B · a child is never asked');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '{"thanks":"none"}'::jsonb)$$, 'not asking', 'B · and cannot save');
select pg_temp.claims(:stranger);
select app.save_member_care_preferences(:c1, '{"thanks":"in_person"}'::jsonb) as s3 \gset
select pg_temp.assert((:'s3'::jsonb ->> 'thanks') = 'in_person' and (app.member_care_preferences(:c1) ->> 'channel') is null, 'B · another household in the community has its own choices, which start empty');
select pg_temp.claims(:ma);
select pg_temp.assert((app.member_care_preferences(:c1) ->> 'thanks') = 'card', 'B · and they do not touch ours');
select pg_temp.claims(:outsider);
select pg_temp.assert((app.member_care_preferences(:c1) ->> 'available')::boolean = false, 'B · a member of another community is told nothing about this one');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '{"thanks":"card"}'::jsonb)$$, 'not asking', 'B · and cannot save into it');
select pg_temp.assert((app.member_care_preferences(:c2) ->> 'available')::boolean = false, 'B · their own community has not turned it on');
select pg_temp.claims(:plat);
select pg_temp.assert((app.member_care_preferences(:c1) ->> 'available')::boolean = false, 'B · a platform admin who is not a member has no household and is told nothing');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '{"thanks":"card"}'::jsonb)$$, 'not asking', 'B · and cannot save');

-- ══ C. W2: a member reads none of the organization's care data ═══════════════
select pg_temp.claims(:ma);
select pg_temp.assert(not exists (select 1 from app.care_profiles) and not exists (select 1 from app.care_notes) and not exists (select 1 from app.care_owners)
                      and not exists (select 1 from app.care_touches) and not exists (select 1 from app.care_thanks) and not exists (select 1 from app.care_runs),
  'C · a member reads no care row, not even their own household''s profile directly');
select pg_temp.assert_raises(format($$select app.care_household_card(%L)$$, '89700000-0000-4000-8000-0000000000b1'), 'don''t have access', 'C · and cannot call the care card');
select pg_temp.assert_raises($$select app.care_week('89700000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'C · nor any other care function');
select pg_temp.assert_raises($$select app.care_gestures_list('89700000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'C · including the library');

-- ══ D. DonorDelight off; audited ═════════════════════════════════════════════
reset role;
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', false, 'Test 897: care off')
  on conflict (center_id, module_key) do update set granted = false;
set role authenticated;
select pg_temp.claims(:ma);
select pg_temp.assert((app.member_care_preferences(:c1) ->> 'available')::boolean = false, 'D · with DonorDelight off nothing is asked');
select pg_temp.assert_raises($$select app.save_member_care_preferences('89700000-0000-4000-8000-0000000000c1', '{"thanks":"card"}'::jsonb)$$, 'not asking', 'D · and nothing is saved');
reset role;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'care_profiles' and module = 'care' and actor_user_id = '89700000-0000-4000-8000-000000000005') >= 1
                      and not exists (select 1 from app.audit_log where record_table = 'care_profiles' and (after::text ~* 'private_only' or after::text ~* '"card"') and (after::text !~ '\*\*\*'))
                      and not exists (select 1 from app.audit_log where record_table = 'care_member_settings' and module is distinct from 'care'),
  'D · the member''s change is audited under DonorDelight with who and which columns, never the words');
rollback;
