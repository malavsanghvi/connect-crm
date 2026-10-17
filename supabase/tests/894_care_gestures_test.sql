-- 0894 (DonorDelight slice 6, the gesture library, docs/DONORDELIGHT.md sections 5.7 and 14): things to do for a supporter, never paired with an ask.
--   A. The starters are data per kind of organization; none asks for money; the care moment is never offered on its own; nothing names a community or a religion.
--   B. Installing them (care.manage only, idempotent, the wording follows the kind of organization).
--   C. Reading: care.own reads; people.view alone and platform admins read nothing.
--   D. Saving: create and change; a gesture cannot carry an ask (a field for one, or words that ask); plain-English refusals; other communities untouched.
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

\set c1 '''89400000-0000-4000-8000-0000000000c1'''
\set c2 '''89400000-0000-4000-8000-0000000000c2'''
\set owner '''89400000-0000-4000-8000-000000000001'''
\set plat '''89400000-0000-4000-8000-000000000002'''
\set lead '''89400000-0000-4000-8000-000000000003'''
\set rel '''89400000-0000-4000-8000-000000000004'''
\set clerk '''89400000-0000-4000-8000-000000000005'''
\set lead2 '''89400000-0000-4000-8000-000000000006'''

insert into auth.users (id, email) values
  (:owner, 'owner894@c1.test'), (:plat, 'plat894@weaver.test'), (:lead, 'lead894@c1.test'), (:rel, 'rel894@c1.test'), (:clerk, 'clerk894@c1.test'), (:lead2, 'lead2894@c2.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true) on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'gest894a', 'Grace Church 894', 'G894', 'TX', 'active', 'America/Chicago', 'church', 'sandbox'),
  (:c2, 'gest894b', 'Harbor Food Bank 894', 'H894', 'TX', 'active', 'America/Chicago', 'nonprofit_secular', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 894'), (:c2, 'care', true, 'Test 894');
insert into app.roles (key, tier, name, default_scope, description, permissions) values ('people_viewer_894', 'center', 'People viewer 894', 'center', 'Test 894', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 894: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 894'), (:c1, :rel, 'relationship_owner', 'center', 'Test 894'), (:c1, :clerk, 'people_viewer_894', 'center', 'Test 894'),
  (:c2, :lead2, 'care_lead', 'center', 'Test 894');

-- ══ A. The starters ══════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app.care_gesture_starters where audience = 'faith') = (select count(*) from app.care_gesture_starters where audience = 'civic')
                      and (select count(*) from app.care_gesture_starters where audience = 'faith') >= 12,
  'A · both kinds of organization have the same starter gestures (at least twelve)');
select pg_temp.assert(not exists (select 1 from app.care_gesture_starters st where app._care_words_ask(st.name) or app._care_words_ask(st.description) or app._care_words_ask(st.draft)),
  'A · no starter gesture asks for money, in its name, its description or its draft');
select pg_temp.assert(not exists (select 1 from app.care_gesture_starters st where st.cost not in ('free', 'low') or st.effort not in ('quick', 'some', 'a_while') or st.who not in ('leader', 'staff', 'volunteer', 'anyone')),
  'A · every starter has a cost, an effort and a person to do it');
select pg_temp.assert(not exists (select 1 from app.care_gesture_starters where kind = 'care_moment' and suggest) and exists (select 1 from app.care_gesture_starters where kind = 'care_moment'),
  'A · the care moment is in the library and is never offered on its own');
select pg_temp.assert(exists (select 1 from app.care_gesture_starters where key = 'public_recognition' and suits_recognition = array['public']),
  'A · recognition suits only a household that chose to be named');
select pg_temp.assert(exists (select 1 from app.care_gesture_starters where key = 'ask_advice' and needs = array['expertise']) and exists (select 1 from app.care_gesture_starters where key = 'special_day_greeting' and needs = array['special_day']),
  'A · gestures that need a household''s own records say which (expertise, a special day)');
select pg_temp.assert(not exists (select 1 from app.care_gesture_starters st where to_jsonb(st)::text ~* '(temple|church|mosque|gurdwara|synagogue|jsh|jain|hindu|christian|muslim|swaminarayan)'),
  'A · no starter names a community or a religion');
select pg_temp.assert(app._care_words_ask('Please give generously') and app._care_words_ask('Would you consider donating to our appeal?') and app._care_words_ask('Make a gift today') and app._care_words_ask('Send $50')
                      and not app._care_words_ask('Thank you for your gift today. We are grateful.') and not app._care_words_ask('A photo of what their gift built') and not app._care_words_ask(null),
  'A · words that ask are recognised; a thank-you for a gift is not an ask');

-- ══ B. Installing ════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:rel);
select pg_temp.assert_raises($$select app.install_care_gestures('89400000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · a relationship owner cannot install');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.install_care_gestures('89400000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · people.view alone cannot');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.install_care_gestures('89400000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · a platform admin cannot');
select pg_temp.assert_raises($$select app.care_gestures_list('89400000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'B · nor read the library');
select pg_temp.claims(:lead);
select pg_temp.assert((app.care_gestures_list(:c1) ->> 'starters_missing')::int >= 12 and jsonb_array_length(app.care_gestures_list(:c1) -> 'gestures') = 0, 'B · a community starts with none, and the list says how many starters wait');
select app.install_care_gestures(:c1) as n1 \gset
select pg_temp.assert(:n1::int >= 12 and app.install_care_gestures(:c1) = 0 and (app.care_gestures_list(:c1) ->> 'starters_missing')::int = 0, 'B · installing copies the starters once; again copies none');
select pg_temp.assert(exists (select 1 from jsonb_array_elements(app.care_gestures_list(:c1) -> 'gestures') g where g ->> 'name' = 'Ask for their advice' and g ->> 'description' like '%a family who knows%'),
  'B · a church gets the faith wording ("a family")');
select pg_temp.claims(:lead2);
select app.install_care_gestures(:c2) as n2 \gset
select pg_temp.assert(:n2::int = :n1::int and exists (select 1 from jsonb_array_elements(app.care_gestures_list(:c2) -> 'gestures') g where g ->> 'description' like '%a supporter who knows%'),
  'B · a food bank gets the civic wording ("a supporter"), the same set');

-- ══ C. Reading ═══════════════════════════════════════════════════════════════
select pg_temp.claims(:rel);
select app.care_gestures_list(:c1) as l \gset
select pg_temp.assert(jsonb_array_length(:'l'::jsonb -> 'gestures') = :n1::int and not (:'l'::jsonb ->> 'can_manage')::boolean, 'C · a relationship owner reads the library but cannot change it');
select pg_temp.assert((select g -> 'suits_thanks' from jsonb_array_elements(:'l'::jsonb -> 'gestures') g where g ->> 'key' = 'handwritten_card') = '["card", "message"]'::jsonb
                      and (select (g ->> 'suggest')::boolean from jsonb_array_elements(:'l'::jsonb -> 'gestures') g where g ->> 'key' = 'care_moment') = false,
  'C · each gesture says which care profiles it suits, and whether it is offered on its own');
select pg_temp.assert(not exists (select 1 from app.care_gestures where center_id = :c2), 'C · row security: one community reads none of another''s gestures');
select pg_temp.claims(:clerk);
select pg_temp.assert(not exists (select 1 from app.care_gestures), 'C · people.view alone reads no gesture row');
select pg_temp.claims(:plat);
select pg_temp.assert(not exists (select 1 from app.care_gestures), 'C · a platform admin reads no gesture row');

-- ══ D. Saving ════════════════════════════════════════════════════════════════
select pg_temp.claims(:lead);
select app.save_care_gesture(:c1, jsonb_build_object('name', 'Bake them bread', 'description', 'Leave a loaf at the door with a note of thanks.', 'cost', 'low', 'effort', 'some', 'who', 'volunteer',
  'suits_thanks', jsonb_build_array('in_person', 'card'), 'kind', 'thank_you', 'channel', 'in_person', 'draft', 'Hello {{name}}, a loaf from {{org}}.')) as gid \gset
select pg_temp.assert((select name || '/' || cost || '/' || who || '/' || array_to_string(suits_thanks, ',') || '/' || suggest::text from app.care_gestures where id = :'gid') = 'Bake them bread/low/volunteer/in_person,card/true'
                      and (select key from app.care_gestures where id = :'gid') like 'g\_bake\_them\_bread\_%',
  'D · a new gesture is saved with its profile');
select app.save_care_gesture(:c1, jsonb_build_object('id', :'gid', 'name', 'Bake them bread (edited)', 'effort', 'a_while')) is not null as saved \gset
select pg_temp.assert((select name || '/' || effort || '/' || cost || '/' || array_to_string(suits_thanks, ',') from app.care_gestures where id = :'gid') = 'Bake them bread (edited)/a_while/low/in_person,card',
  'D · a change keeps what it did not mention');
select app.save_care_gesture(:c1, jsonb_build_object('name', 'Sit with them', 'description', 'Visit when the family has shared a loss and agreed.', 'cost', 'free', 'effort', 'some', 'who', 'leader', 'kind', 'care_moment', 'suggest', true)) as gid2 \gset
select pg_temp.assert(not (select suggest from app.care_gestures where id = :'gid2'), 'D · a care moment is never offered on its own, whatever is typed');
select pg_temp.claims(:rel);
select pg_temp.assert_raises(format($$select app.save_care_gesture(%L, '{"name":"x"}'::jsonb)$$, '89400000-0000-4000-8000-0000000000c1'), 'don''t have access', 'D · a relationship owner cannot save');
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format($$select app.save_care_gesture(%L, %L::jsonb)$$, '89400000-0000-4000-8000-0000000000c1', '{"name":"x","description":"y","cost":"free","effort":"quick","who":"anyone","kind":"other","is_ask":true}'),
  'never paired with an ask', 'D · a gesture has no field for an ask');
select pg_temp.assert_raises(format($$select app.save_care_gesture(%L, %L::jsonb)$$, '89400000-0000-4000-8000-0000000000c1', '{"name":"Call","description":"Call and say: please give generously this year.","cost":"free","effort":"quick","who":"anyone","kind":"thank_you"}'),
  'never paired with an ask', 'D · words that ask for a gift in the description are refused');
select pg_temp.assert_raises(format($$select app.save_care_gesture(%L, %L::jsonb)$$, '89400000-0000-4000-8000-0000000000c1', '{"name":"Card","description":"A card.","cost":"free","effort":"quick","who":"anyone","kind":"thank_you","draft":"Dear {{name}}, would you consider donating $100?"}'),
  'never paired with an ask', 'D · and in the draft');
select pg_temp.assert_raises(format($$select app.save_care_gesture(%L, %L::jsonb)$$, '89400000-0000-4000-8000-0000000000c1', '{"name":"Gala","description":"A gala.","cost":"high","effort":"quick","who":"anyone","kind":"other"}'),
  'free or low', 'D · a gesture costs nothing or very little');
select pg_temp.assert_raises(format($$select app.save_care_gesture(%L, %L::jsonb)$$, '89400000-0000-4000-8000-0000000000c1', '{"name":"x","description":"y","cost":"free","effort":"quick","who":"anyone","kind":"other","needs":["wealth"]}'),
  'needs', 'D · it can need only what the organization''s own records hold (no outside wealth screening)');
select pg_temp.assert_raises(format($$select app.save_care_gesture(%L, %L::jsonb)$$, '89400000-0000-4000-8000-0000000000c1', '{"name":"x","description":"y","cost":"free","effort":"quick","who":"nobody","kind":"other"}'),
  'who should do it', 'D · it names who should do it');
select pg_temp.assert_raises(format($$select app.save_care_gesture(%L, %L::jsonb)$$, '89400000-0000-4000-8000-0000000000c1', '{"name":"","description":"y","cost":"free","effort":"quick","who":"anyone","kind":"other"}'),
  'give the gesture a name', 'D · it has a name');
select pg_temp.claims(:lead2);
select pg_temp.assert_raises(format($$select app.save_care_gesture(%L, jsonb_build_object('id', %L, 'name', 'Hijack'))$$, '89400000-0000-4000-8000-0000000000c2', :'gid'), 'not found', 'D · another community''s gesture id is not found');

-- ══ E. Pausing; audited without the words ════════════════════════════════════
select pg_temp.claims(:lead);
select app.set_care_gesture_enabled(:'gid', false);
select pg_temp.assert(not (select enabled from app.care_gestures where id = :'gid'), 'E · a gesture can be paused');
select pg_temp.claims(:rel);
select pg_temp.assert_raises(format($$select app.set_care_gesture_enabled(%L, true)$$, :'gid'), 'don''t have access', 'E · only a manager can resume it');
reset role;
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'care_gestures' and module = 'care') >= 3
                      and not exists (select 1 from app.audit_log where record_table = 'care_gestures' and (after::text ~* 'Bake them bread' or after::text ~* 'loaf'))
                      and not exists (select 1 from app.audit_log where record_table = 'care_gestures' and module is distinct from 'care'),
  'E · every change is audited under DonorDelight, with the columns and never the words');
rollback;
