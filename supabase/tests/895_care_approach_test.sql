-- 0895 (DonorDelight slice 7, who to approach, docs/DONORDELIGHT.md section 5.10): a ranked list with reasons, HELD behind the touch balance.
--   A. Off until a care manager turns it on; only care.manage changes the settings; plain-English refusals.
--   B. Ready, held (pledge, thank-you, rest, touch balance, quiet period) and not shown (do-not-ask), each with its reasons; never given = not a candidate.
--   C. The score is additive and its weights are the organization's to change; the touch balance and the rest days are editable.
--   D. Ranges from the household's own gifts, only with amounts access, only with three or more gifts; a fund narrows the list.
--   E. Who sees which: care.view every household, care.own only theirs, nobody else (platform admins included); every read is logged without names; no child.
--   F. Quiet periods (a yearly one may cross the new year).
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
-- The households of a list, in order.
create or replace function pg_temp.ids(j jsonb, p_key text) returns uuid[] language sql as $$
  select coalesce(array_agg((e -> 'household' ->> 'id')::uuid order by ord), '{}') from jsonb_array_elements(j -> p_key) with ordinality t(e, ord)
$$;
create or replace function pg_temp.row(j jsonb, p_household uuid) returns jsonb language sql as $$
  select e from (select e from jsonb_array_elements(j -> 'ready') e union all select e from jsonb_array_elements(j -> 'held') e) x where e -> 'household' ->> 'id' = p_household::text
$$;
create or replace function pg_temp.hold(p_row jsonb, p_code text) returns jsonb language sql as $$
  select h from jsonb_array_elements(p_row -> 'holds') h where h ->> 'code' = p_code
$$;

\set c1 '''89500000-0000-4000-8000-0000000000c1'''
\set owner '''89500000-0000-4000-8000-000000000001'''
\set plat '''89500000-0000-4000-8000-000000000002'''
\set lead '''89500000-0000-4000-8000-000000000003'''
\set leadg '''89500000-0000-4000-8000-000000000007'''
\set rel '''89500000-0000-4000-8000-000000000004'''
\set clerk '''89500000-0000-4000-8000-000000000005'''
\set ha '''89500000-0000-4000-8000-0000000000b1'''
\set hb '''89500000-0000-4000-8000-0000000000b2'''
\set hc '''89500000-0000-4000-8000-0000000000b3'''
\set hd '''89500000-0000-4000-8000-0000000000b4'''
\set he '''89500000-0000-4000-8000-0000000000b5'''
\set hf '''89500000-0000-4000-8000-0000000000b6'''
\set hg '''89500000-0000-4000-8000-0000000000b7'''
\set pa '''89500000-0000-4000-8000-0000000000a1'''
\set pb '''89500000-0000-4000-8000-0000000000a2'''
\set pc '''89500000-0000-4000-8000-0000000000a3'''
\set pd '''89500000-0000-4000-8000-0000000000a4'''
\set pe '''89500000-0000-4000-8000-0000000000a5'''
\set pf '''89500000-0000-4000-8000-0000000000a6'''
\set pg '''89500000-0000-4000-8000-0000000000a7'''
\set pk '''89500000-0000-4000-8000-0000000000a8'''
\set fund '''89500000-0000-4000-8000-0000000000f1'''
\set pledge '''89500000-0000-4000-8000-0000000000e1'''
\set pledge2 '''89500000-0000-4000-8000-0000000000e2'''

insert into auth.users (id, email) values
  (:owner, 'owner895@c1.test'), (:plat, 'plat895@weaver.test'), (:lead, 'lead895@c1.test'), (:leadg, 'leadg895@c1.test'), (:rel, 'rel895@c1.test'), (:clerk, 'clerk895@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true) on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'appr895', 'Grace Church 895', 'G895', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 895');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('people_viewer_895', 'center', 'People viewer 895', 'center', 'Test 895', '["people.view"]'),
  ('giving_viewer_895', 'center', 'Giving viewer 895', 'center', 'Test 895', '["giving.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 895: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 895'), (:c1, :leadg, 'care_lead', 'center', 'Test 895'), (:c1, :leadg, 'giving_viewer_895', 'center', 'Test 895'),
  (:c1, :rel, 'relationship_owner', 'center', 'Test 895'), (:c1, :clerk, 'people_viewer_895', 'center', 'Test 895');
insert into app.households (id, center_id, display_name, created_at) values
  (:ha, :c1, 'Alder895, Ana', now() - interval '2000 days'), (:hb, :c1, 'Birch895, Bo', now() - interval '2000 days'), (:hc, :c1, 'Cedar895, Cy', now() - interval '2000 days'),
  (:hd, :c1, 'Dogwood895, Di', now() - interval '2000 days'), (:he, :c1, 'Elm895, Ed', now() - interval '2000 days'), (:hf, :c1, 'Fir895, Fay', now() - interval '2000 days'),
  (:hg, :c1, 'Gum895, Gil', now() - interval '2000 days');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pa, :c1, 'Ana', 'Alder895', date '1980-01-01'), (:pb, :c1, 'Bo', 'Birch895', date '1981-01-01'), (:pc, :c1, 'Cy', 'Cedar895', date '1982-01-01'),
  (:pd, :c1, 'Di', 'Dogwood895', date '1983-01-01'), (:pe, :c1, 'Ed', 'Elm895', date '1984-01-01'), (:pf, :c1, 'Fay', 'Fir895', date '1985-01-01'),
  (:pg, :c1, 'Gil', 'Gum895', date '1986-01-01'), (:pk, :c1, 'Kit', 'Alder895', ((now() at time zone 'America/Chicago')::date - interval '9 years')::date);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:ha, :pa, :c1, 'primary', true), (:ha, :pk, :c1, 'child', false), (:hb, :pb, :c1, 'primary', true), (:hc, :pc, :c1, 'primary', true), (:hd, :pd, :c1, 'primary', true),
  (:he, :pe, :c1, 'primary', true), (:hf, :pf, :c1, 'primary', true), (:hg, :pg, :c1, 'primary', true);
insert into app.care_owners (household_id, center_id, owner_user_id, assigned_by) values (:ha, :c1, :rel, :lead), (:hb, :c1, :rel, :lead);
insert into app.care_profiles (household_id, center_id, do_not_ask) values (:hd, :c1, true);

create or replace function pg_temp.gift(p_h uuid, p_person uuid, p_days int, p_n int, p_cents int default null) returns uuid language sql as $$
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at, receipt_number)
  values ('89500000-0000-4000-8000-0000000000c1', p_h, p_person, coalesce(p_cents, 10000 + p_n), 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - p_days, now() - make_interval(days => p_days), 'R-895-' || p_n)
  returning id
$$;
create or replace function pg_temp.touch(p_h uuid, p_days int, p_ask boolean, p_outcome text default 'done') returns void language sql as $$
  insert into app.care_touches (center_id, household_id, kind, channel, outcome, is_ask, touched_at, by_user_id)
  values ('89500000-0000-4000-8000-0000000000c1', p_h, case when p_ask then 'other' else 'check_in' end, 'phone', p_outcome, p_ask, now() - make_interval(days => p_days), '89500000-0000-4000-8000-000000000003')
$$;
-- Alder: gave in four of the last five years (30, 400, 800, 1200 days ago); a child's gift never counts; three no-ask touches; took part. READY.
-- Birch: gave 3 times; asked 90 days ago, then two no-ask touches: HELD by the touch balance (2 of 3). Cedar: asked 20 days ago, three no-ask touches since: HELD by rest.
-- Dogwood: do-not-ask: not shown. Elm: a pledge 70 days overdue: HELD (pledge). Fir: never gave: not a candidate. Gum: gave 10 days ago: the thank-you rules put it on hold later.
select pg_temp.gift(:ha, :pa, 30, 1, 10000), pg_temp.gift(:ha, :pa, 400, 2, 12000), pg_temp.gift(:ha, :pa, 800, 3, 15000), pg_temp.gift(:ha, :pa, 1200, 4, 20000),
       pg_temp.gift(:ha, :pk, 5, 5, 99900),
       pg_temp.gift(:hb, :pb, 50, 6, 5000), pg_temp.gift(:hb, :pb, 300, 7, 5000), pg_temp.gift(:hb, :pb, 600, 8, 5000),
       pg_temp.gift(:hc, :pc, 100, 9, 8000), pg_temp.gift(:hd, :pd, 100, 10, 8000), pg_temp.gift(:he, :pe, 200, 11, 6000), pg_temp.gift(:hg, :pg, 10, 12, 7000);
select pg_temp.touch(:ha, 20, false), pg_temp.touch(:ha, 40, false), pg_temp.touch(:ha, 60, false), pg_temp.touch(:hb, 90, true), pg_temp.touch(:hb, 50, false), pg_temp.touch(:hb, 30, false),
       pg_temp.touch(:hc, 20, true), pg_temp.touch(:hc, 15, false), pg_temp.touch(:hc, 10, false), pg_temp.touch(:hc, 5, false), pg_temp.touch(:he, 30, false), pg_temp.touch(:he, 20, false), pg_temp.touch(:he, 10, false),
       pg_temp.touch(:hg, 8, false), pg_temp.touch(:hg, 6, false), pg_temp.touch(:hg, 4, false);
insert into app.events (id, center_id, name, starts_at, ends_at, status) values ('89500000-0000-4000-8000-0000000000d1', :c1, 'Supper 895', now() - interval '10 days', now() - interval '10 days' + interval '3 hours', 'published');
insert into app.rsvps (id, center_id, event_id, household_id, status) values ('89500000-0000-4000-8000-0000000000d2', :c1, '89500000-0000-4000-8000-0000000000d1', :ha, 'rsvpd');
insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, status, checked_in_at)
  values (:c1, '89500000-0000-4000-8000-0000000000d1', '89500000-0000-4000-8000-0000000000d2', :pa, 'Ana Alder895', false, 'confirmed', now() - interval '10 days');
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, due_on, pledged_at)
  values (:pledge, :c1, :he, :pe, 'general', 50000, (now() at time zone 'America/Chicago')::date - 70, now() - interval '120 days');
select pg_temp.assert(app.module_enabled(:c1, 'care') and app.module_enabled(:c1, 'giving'), 'Fixtures · DonorDelight and Giving are on');

-- ══ A. Off until a care manager turns it on ══════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert((app.care_approach(:c1) ->> 'state') = 'off' and jsonb_array_length(coalesce(app.care_approach(:c1) -> 'ready', '[]'::jsonb)) = 0, 'A · the list is off until a care manager turns it on');
select pg_temp.assert(not (app.care_approach_settings_get(:c1) ->> 'enabled')::boolean and (app.care_approach_settings_get(:c1) ->> 'touch_balance')::int = 3
                      and (app.care_approach_settings_get(:c1) ->> 'rest_days')::int = 60 and (app.care_approach_settings_get(:c1) -> 'weights' ->> 'recent_12')::int = 15, 'A · the defaults: balance 3, rest 60 days, the weights of the plan');
select pg_temp.claims(:rel);
select pg_temp.assert_raises($$select app.save_care_approach_settings('89500000-0000-4000-8000-0000000000c1', '{"enabled":true}'::jsonb)$$, 'don''t have access', 'A · a relationship owner cannot turn it on');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.care_approach_settings_get('89500000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'A · people.view alone reads nothing');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.care_approach('89500000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'A · nor a platform admin');
select pg_temp.assert_raises($$select app.save_care_approach_settings('89500000-0000-4000-8000-0000000000c1', '{"enabled":true}'::jsonb)$$, 'don''t have access', 'A · nor can one turn it on');
select pg_temp.claims(:lead);
select pg_temp.assert_raises($$select app.save_care_approach_settings('89500000-0000-4000-8000-0000000000c1', '{"touch_balance":0}'::jsonb)$$, '1 to 10', 'A · the touch balance is 1 to 10');
select pg_temp.assert_raises($$select app.save_care_approach_settings('89500000-0000-4000-8000-0000000000c1', '{"rest_days":400}'::jsonb)$$, '0 to 365', 'A · the rest is 0 to 365 days');
select pg_temp.assert_raises($$select app.save_care_approach_settings('89500000-0000-4000-8000-0000000000c1', '{"weights":{"wealth":50}}'::jsonb)$$, 'no signal "wealth"', 'A · there is no wealth signal to weight');
select pg_temp.assert_raises($$select app.save_care_approach_settings('89500000-0000-4000-8000-0000000000c1', '{"weights":{"took_part":51}}'::jsonb)$$, '0 to 50 points', 'A · a weight is 0 to 50');
select pg_temp.assert_raises($$select app.save_care_approach_settings('89500000-0000-4000-8000-0000000000c1', '{"color":"red"}'::jsonb)$$, 'no field "color"', 'A · an unknown setting is refused');
select app.save_care_approach_settings(:c1, '{"enabled":true}'::jsonb) is not null as on1 \gset
select pg_temp.assert((app.care_approach_settings_get(:c1) ->> 'enabled')::boolean and (app.care_approach_settings_get(:c1) ->> 'enabled_at') is not null, 'A · a care manager turns it on, and when is recorded');

-- ══ B. Ready, held, not shown ════════════════════════════════════════════════
select app.care_approach(:c1) as l \gset
select pg_temp.assert((:'l'::jsonb ->> 'state') = 'ok' and pg_temp.ids(:'l'::jsonb, 'ready') = array[:ha, :hg]::uuid[], 'B · Alder and Gum are ready (best score first): enough no-ask touches, not resting, nothing held');
select pg_temp.assert(pg_temp.ids(:'l'::jsonb, 'held') @> array[:hb, :hc, :he]::uuid[] and cardinality(pg_temp.ids(:'l'::jsonb, 'held')) = 3, 'B · Birch, Cedar and Elm are held, each with its reason');
select pg_temp.assert((pg_temp.hold(pg_temp.row(:'l'::jsonb, :hb), 'balance') ->> 'have')::int = 2 and (pg_temp.hold(pg_temp.row(:'l'::jsonb, :hb), 'balance') ->> 'need')::int = 3
                      and jsonb_array_length(pg_temp.row(:'l'::jsonb, :hb) -> 'holds') = 1,
  'B · Birch asked 90 days ago and has had 2 of 3 no-ask touches since: held by the touch balance, and only by that');
select pg_temp.assert((pg_temp.hold(pg_temp.row(:'l'::jsonb, :hc), 'rest') ->> 'until')::date = (now() at time zone 'America/Chicago')::date - 20 + 60
                      and pg_temp.hold(pg_temp.row(:'l'::jsonb, :hc), 'balance') is null,
  'B · Cedar asked 20 days ago: it rests until 60 days after that ask, and the touch balance is met');
select pg_temp.assert((pg_temp.hold(pg_temp.row(:'l'::jsonb, :he), 'pledge') ->> 'days')::int = 70 and pg_temp.hold(pg_temp.row(:'l'::jsonb, :he), 'balance') is null,
  'B · Elm is 70 days behind on a pledge: remind first, do not ask');
select pg_temp.assert((:'l'::jsonb ->> 'not_shown')::int = 1 and not exists (select 1 from jsonb_array_elements(:'l'::jsonb -> 'ready') e where e -> 'household' ->> 'id' = :'hd')
                      and (:'l'::jsonb::text !~ 'Dogwood'), 'B · a household that asked not to be asked is counted and never named or explained');
select pg_temp.assert(not (:'l'::jsonb::text ~ 'Fir895') and (:'l'::jsonb ->> 'ready_total')::int = 2 and (:'l'::jsonb ->> 'held_total')::int = 3, 'B · a household that never gave is not a candidate: seven households, two ready, three held, one not shown, one not a candidate');
select pg_temp.assert((:'l'::jsonb::text !~ 'Kit'), 'B · no child is named');
select pg_temp.assert((pg_temp.row(:'l'::jsonb, :ha) -> 'signals' -> 0 ->> 'n')::int = 4 and (pg_temp.row(:'l'::jsonb, :ha) ->> 'score')::int = 8 * 4 + 15 + 8 + 0
                      and (pg_temp.row(:'l'::jsonb, :ha) -> 'signals' -> 2 ->> 'points')::int = 8,
  'B · Alder''s score is the sum of its signals: four years (32), a gift within 12 months (15), took part (8); a child''s gift does not count as a year');
select pg_temp.assert((pg_temp.row(:'l'::jsonb, :ha) ->> 'no_ask_since')::int = 3 and (pg_temp.row(:'l'::jsonb, :ha) ->> 'last_ask_on') is null, 'B · never asked: the no-ask touches of the last 12 months count');

-- ══ C. The touch balance, the rest and the weights are the organization''s ═══
select app.save_care_approach_settings(:c1, '{"touch_balance":2,"rest_days":0}'::jsonb) is not null as s1 \gset
select app.care_approach(:c1) as l2 \gset
select pg_temp.assert(pg_temp.ids(:'l2'::jsonb, 'ready') @> array[:ha, :hb, :hc, :hg]::uuid[] and cardinality(pg_temp.ids(:'l2'::jsonb, 'ready')) = 4,
  'C · with a balance of 2 and no rest, Birch and Cedar are ready too; Elm is still held by its pledge');
select pg_temp.assert((pg_temp.ids(:'l2'::jsonb, 'ready'))[1] = :ha::uuid and (pg_temp.ids(:'l2'::jsonb, 'ready'))[2] = :hb::uuid, 'C · and the best score comes first (Alder 55, Birch 31)');
select app.save_care_approach_settings(:c1, '{"touch_balance":3,"rest_days":60,"weights":{"recent_12":20,"took_part":0}}'::jsonb) is not null as s2 \gset
select pg_temp.assert((pg_temp.row(app.care_approach(:c1), :ha) ->> 'score')::int = 32 + 20 and (app.care_approach_settings_get(:c1) -> 'weights' ->> 'recent_24')::int = 10,
  'C · the weights are changed one by one and the others keep their defaults: Alder is now 32 + 20 + 0');
select app.save_care_approach_settings(:c1, '{"weights":{"recent_12":15,"took_part":8}}'::jsonb) is not null as s3 \gset

-- ══ D. Ranges from the household''s own gifts ════════════════════════════════
select pg_temp.assert((pg_temp.row(app.care_approach(:c1), :ha) -> 'range') = 'null'::jsonb and not (app.care_approach(:c1) ->> 'amounts')::boolean, 'D · without amounts access there is no range, only that it is hidden');
select pg_temp.claims(:leadg);
select app.care_approach(:c1) as lg \gset
select pg_temp.assert((pg_temp.row(:'lg'::jsonb, :ha) -> 'range' ->> 'low')::int = 13500 and (pg_temp.row(:'lg'::jsonb, :ha) -> 'range' ->> 'high')::int = 20000 and (pg_temp.row(:'lg'::jsonb, :ha) -> 'range' ->> 'n')::int = 4,
  'D · with giving.view the range is the median and the highest of the household''s own gifts (13,500 to 20,000 cents)');
select pg_temp.assert(pg_temp.row(:'lg'::jsonb, :hb) is null or (pg_temp.row(:'lg'::jsonb, :hb) -> 'range') = 'null'::jsonb, 'D · a household in the held list shows no range');
reset role;
insert into app.funds (id, center_id, key, name, active) values (:fund, :c1, 'roof895', 'Roof fund 895', true);
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, fund_id, pledged_at)
  values (:pledge2, :c1, :ha, :pa, 'general', 12000, :fund, now() - interval '500 days');
insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents)
  select :c1, p.id, :pledge2, 12000 from app.payments p where p.receipt_number = 'R-895-2';
set role authenticated;
select pg_temp.claims(:leadg);
select app.care_approach(:c1, :fund) as lf \gset
select pg_temp.assert((:'lf'::jsonb ->> 'ready_total')::int + (:'lf'::jsonb ->> 'held_total')::int = 1 and (pg_temp.row(:'lf'::jsonb, :ha) -> 'signals' -> 0 ->> 'n')::int = 1
                      and jsonb_array_length(:'lf'::jsonb -> 'funds') = 1,
  'D · with the Roof fund chosen only the household that gave to it is listed, scored from its gifts to that fund');
select pg_temp.assert_raises(format($$select app.care_approach(%L, %L)$$, '89500000-0000-4000-8000-0000000000c1', '89500000-0000-4000-8000-0000000000ff'), 'not found', 'D · a fund that is not this community''s is not found');

-- ══ E. Who sees which; logged ════════════════════════════════════════════════
select pg_temp.claims(:rel);
select app.care_approach(:c1) as lr \gset
select pg_temp.assert(pg_temp.ids(:'lr'::jsonb, 'ready') = array[:ha]::uuid[] and pg_temp.ids(:'lr'::jsonb, 'held') = array[:hb]::uuid[] and not (:'lr'::jsonb ->> 'all')::boolean
                      and (:'lr'::jsonb ->> 'not_shown')::int = 0,
  'E · a relationship owner sees only the households they own (Alder ready, Birch held); no count of others');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.care_approach('89500000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'E · people.view alone sees nothing');
select pg_temp.assert_raises(format($$select app.care_approach_household(%L)$$, '89500000-0000-4000-8000-0000000000b1'), 'don''t have access', 'E · nor one household');
select pg_temp.claims(:lead);
select pg_temp.assert((app.care_approach_household(:ha) ->> 'state') = 'ready' and (app.care_approach_household(:hb) ->> 'state') = 'held' and (app.care_approach_household(:hd) ->> 'state') = 'excluded'
                      and (app.care_approach_household(:hf) ->> 'state') = 'no_history',
  'E · one household''s answer is ready, held, excluded or no history');
select pg_temp.claims(:rel);
select pg_temp.assert_raises(format($$select app.care_approach_household(%L)$$, '89500000-0000-4000-8000-0000000000b3'), 'don''t have access', 'E · a relationship owner cannot ask about another owner''s household');

-- ══ F. The thank-you comes first; quiet periods ══════════════════════════════
select pg_temp.claims(:owner);
select app.save_care_settings(:c1, '{}'::jsonb, true) is not null as saved \gset
select pg_temp.claims(:lead);
select app.care_approach(:c1) as l3 \gset
select pg_temp.assert(pg_temp.hold(pg_temp.row(:'l3'::jsonb, :hg), 'thank') is not null and pg_temp.hold(pg_temp.row(:'l3'::jsonb, :ha), 'thank') is not null,
  'F · once the thank-you rules are saved, a household with an unthanked gift is held: thank first');
select app.save_care_quiet_period(:c1, jsonb_build_object('name', 'Fast 895', 'starts_on', (now() at time zone 'America/Chicago')::date - 1, 'ends_on', (now() at time zone 'America/Chicago')::date + 9)) as qid \gset
select app.care_approach(:c1) as l4 \gset
select pg_temp.assert((:'l4'::jsonb ->> 'ready_total')::int = 0 and (pg_temp.hold(pg_temp.row(:'l4'::jsonb, :hc), 'quiet') ->> 'name') = 'Fast 895'
                      and (pg_temp.hold(pg_temp.row(:'l4'::jsonb, :hc), 'quiet') ->> 'until')::date = (now() at time zone 'America/Chicago')::date + 9,
  'F · inside a quiet period every household waits, and the hold names the period and the day it ends');
select app.save_care_quiet_period(:c1, jsonb_build_object('id', :'qid', 'archived', true)) is not null as arch \gset
select pg_temp.assert(pg_temp.hold(pg_temp.row(app.care_approach(:c1), :hc), 'quiet') is null and jsonb_array_length(app.care_approach_settings_get(:c1) -> 'quiet_periods') = 0, 'F · an archived quiet period holds nothing and is not listed');
select pg_temp.claims(:rel);
select pg_temp.assert_raises(format($$select app.save_care_quiet_period(%L, '{"name":"x","starts_on":"2027-01-01","ends_on":"2027-01-02"}'::jsonb)$$, '89500000-0000-4000-8000-0000000000c1'), 'don''t have access', 'F · only a manager sets a quiet period');
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format($$select app.save_care_quiet_period(%L, '{"name":"x","starts_on":"2027-01-05","ends_on":"2027-01-02"}'::jsonb)$$, '89500000-0000-4000-8000-0000000000c1'), 'cannot end before', 'F · it cannot end before it starts');
reset role;
select pg_temp.assert(app._care_quiet_covers(date '2026-12-25', date '2026-12-20', date '2027-01-05', true) = date '2027-01-05'
                      and app._care_quiet_covers(date '2027-01-02', date '2026-12-20', date '2027-01-05', true) = date '2027-01-05'
                      and app._care_quiet_covers(date '2027-01-10', date '2026-12-20', date '2027-01-05', true) is null
                      and app._care_quiet_covers(date '2027-06-01', date '2026-12-20', date '2027-01-05', true) is null
                      and app._care_quiet_covers(date '2030-03-10', date '2026-03-01', date '2026-04-05', true) = date '2030-04-05'
                      and app._care_quiet_covers(date '2027-03-10', date '2026-03-01', date '2026-04-05', false) is null,
  'F · a yearly quiet period repeats every year and may cross the new year; a one-off does not repeat');
select pg_temp.assert((select count(*) from app.audit_log where action = 'care.read' and (after ->> 'what') in ('approach', 'approach_household')) >= 6
                      and not exists (select 1 from app.audit_log where action = 'care.read' and after::text ~ '895')
                      and not exists (select 1 from app.audit_log where record_table in ('care_approach_settings', 'care_quiet_periods') and (after::text ~* 'Fast 895'))
                      and not exists (select 1 from app.audit_log where record_table in ('care_approach_settings', 'care_quiet_periods') and module is distinct from 'care'),
  'F · every read is logged without names, and the audit of the settings and quiet periods holds columns, never words');
rollback;
