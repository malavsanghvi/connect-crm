-- 0896 (DonorDelight slice 8, Niva and the care plan, docs/DONORDELIGHT.md sections 8 and 9): the organization's own tick for Niva, and the yearly care plan.
--   A. The tick: off by default; only a care manager changes it; iWeaver is reported with it; nobody else reads it.
--   B. The care plan: save a draft (validated, never an ask), read it back in date order, approve it, an edit returns it to draft; other communities untouched.
--   C. The context a draft is made from: the mission, the community's own calendar, the fiscal year, the quiet periods and COUNTS of households per group, never a household.
--   D. Who sees which; every read of the context is logged without names; the audit never holds the words.
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

\set c1 '''89600000-0000-4000-8000-0000000000c1'''
\set c2 '''89600000-0000-4000-8000-0000000000c2'''
\set owner '''89600000-0000-4000-8000-000000000001'''
\set plat '''89600000-0000-4000-8000-000000000002'''
\set lead '''89600000-0000-4000-8000-000000000003'''
\set rel '''89600000-0000-4000-8000-000000000004'''
\set clerk '''89600000-0000-4000-8000-000000000005'''
\set lead2 '''89600000-0000-4000-8000-000000000006'''
\set ha '''89600000-0000-4000-8000-0000000000b1'''
\set hb '''89600000-0000-4000-8000-0000000000b2'''
\set pa '''89600000-0000-4000-8000-0000000000a1'''
\set pb '''89600000-0000-4000-8000-0000000000a2'''
\set layer '''89600000-0000-4000-8000-0000000000a9'''

insert into auth.users (id, email) values
  (:owner, 'owner896@c1.test'), (:plat, 'plat896@weaver.test'), (:lead, 'lead896@c1.test'), (:rel, 'rel896@c1.test'), (:clerk, 'clerk896@c1.test'), (:lead2, 'lead2896@c2.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true) on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'plan896a', 'Grace Church 896', 'G896', 'TX', 'active', 'America/Chicago', 'church', 'sandbox'),
  (:c2, 'plan896b', 'Harbor Food Bank 896', 'H896', 'TX', 'active', 'America/Chicago', 'nonprofit_secular', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 896'), (:c2, 'care', true, 'Test 896');
insert into app.roles (key, tier, name, default_scope, description, permissions) values ('people_viewer_896', 'center', 'People viewer 896', 'center', 'Test 896', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 896: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 896'), (:c1, :rel, 'relationship_owner', 'center', 'Test 896'), (:c1, :clerk, 'people_viewer_896', 'center', 'Test 896'),
  (:c2, :lead2, 'care_lead', 'center', 'Test 896');
insert into app.org_profiles (center_id, mission, fiscal_year_start_month) values (:c1, 'To welcome every neighbour and to be good stewards of what we are given.', 7)
  on conflict (center_id) do update set mission = excluded.mission, fiscal_year_start_month = excluded.fiscal_year_start_month;
insert into app.households (id, center_id, display_name, created_at) values (:ha, :c1, 'Alder896, Ana', now() - interval '2000 days'), (:hb, :c1, 'Birch896, Bo', now() - interval '3 days');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:pa, :c1, 'Ana', 'Alder896', date '1980-01-01'), (:pb, :c1, 'Bo', 'Birch896', date '1981-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:ha, :pa, :c1, 'primary', true), (:hb, :pb, :c1, 'primary', true);
insert into app.care_owners (household_id, center_id, owner_user_id, assigned_by) values (:ha, :c1, :rel, :lead);
insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at, receipt_number) values
  (:c1, :ha, :pa, 10000, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 400, now() - interval '400 days', 'R-896-1'),
  (:c1, :ha, :pa, 10000, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - 30, now() - interval '30 days', 'R-896-2');
insert into app.calendar_layers (id, center_id, key, name, kind) values (:layer, :c1, 'obs896', 'Observances 896', 'events');
insert into app.calendar_entries (center_id, layer_id, title, starts_on, ends_on, all_day) values
  (:c1, :layer, 'Harvest supper 896', date '2027-10-10', date '2027-10-10', true), (:c1, :layer, 'Founders day 896', date '2027-03-04', date '2027-03-04', true),
  (:c1, :layer, 'Another year 896', date '2028-03-04', date '2028-03-04', true);
insert into app.care_quiet_periods (center_id, name, starts_on, ends_on, yearly) values (:c1, 'A season of rest 896', date '2027-12-20', date '2028-01-05', true);

-- ══ A. The tick ══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:rel);
select pg_temp.assert(not (app.care_niva_get(:c1) ->> 'enabled')::boolean and not (app.care_niva_get(:c1) ->> 'can_manage')::boolean, 'A · Niva may not help with relationship care until the organization ticks it');
select pg_temp.assert((app.care_niva_get(:c1) ->> 'ai') is not null, 'A · and the answer says whether iWeaver is on');
select pg_temp.assert_raises($$select app.save_care_niva('89600000-0000-4000-8000-0000000000c1', true)$$, 'don''t have access', 'A · a relationship owner cannot tick it');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.care_niva_get('89600000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'A · people.view alone reads nothing');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.care_niva_get('89600000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'A · nor a platform admin');
select pg_temp.assert_raises($$select app.save_care_niva('89600000-0000-4000-8000-0000000000c1', true)$$, 'don''t have access', 'A · nor can one tick it');
select pg_temp.claims(:lead);
select pg_temp.assert_raises($$select app.save_care_niva('89600000-0000-4000-8000-0000000000c1', null)$$, 'say whether niva', 'A · the tick is yes or no');
select app.save_care_niva(:c1, true) as t1 \gset
select pg_temp.assert((:'t1'::jsonb ->> 'enabled')::boolean and (:'t1'::jsonb ->> 'enabled_at') is not null, 'A · a care manager ticks it, and when is recorded');
select app.save_care_niva(:c1, false) is not null as off \gset
select pg_temp.assert(not (app.care_niva_get(:c1) ->> 'enabled')::boolean and (app.care_niva_get(:c1) ->> 'enabled_at') is null, 'A · and takes it away');

-- ══ B. The care plan ═════════════════════════════════════════════════════════
select pg_temp.assert((app.care_plan_get(:c1, 2027) ->> 'status') = 'none' and not (app.care_plan_get(:c1, 2027) ->> 'exists')::boolean, 'B · there is no plan until one is drafted');
select app.save_care_plan(:c1, 2027, jsonb_build_object('summary', 'Thank before we ever ask.', 'items', jsonb_build_array(
  jsonb_build_object('on', '2027-10-05', 'title', 'Greet households before the harvest supper', 'group', 'all', 'kind', 'greeting', 'note', 'A short call.'),
  jsonb_build_object('on', '2027-03-01', 'title', 'Call the steady givers, no ask', 'group', 'steady', 'kind', 'thank_you')))) as p1 \gset
select pg_temp.assert((:'p1'::jsonb ->> 'status') = 'draft' and jsonb_array_length(:'p1'::jsonb -> 'items') = 2 and (:'p1'::jsonb -> 'items' -> 0 ->> 'on') = '2027-03-01'
                      and (:'p1'::jsonb -> 'items' -> 0 ->> 'id') ~ '^[a-z0-9]{6,36}$' and (:'p1'::jsonb ->> 'summary') = 'Thank before we ever ask.',
  'B · a plan is saved as a draft, its moments come back in date order, each with an identifier');
select pg_temp.assert_raises($$select app.save_care_plan('89600000-0000-4000-8000-0000000000c1', 2027, '{"items":[{"on":"2028-01-02","title":"x","group":"all","kind":"greeting"}]}'::jsonb)$$, 'choose a day in 2027', 'B · a moment is in the plan''s own year');
select pg_temp.assert_raises($$select app.save_care_plan('89600000-0000-4000-8000-0000000000c1', 2027, '{"items":[{"on":"2027-01-02","title":"Please give generously","group":"all","kind":"greeting"}]}'::jsonb)$$, 'never paired with an ask', 'B · a moment that asks for money is refused');
select pg_temp.assert_raises($$select app.save_care_plan('89600000-0000-4000-8000-0000000000c1', 2027, '{"summary":"Would you consider donating $100?","items":[]}'::jsonb)$$, 'never paired with an ask', 'B · and so is a summary that asks');
select pg_temp.assert_raises($$select app.save_care_plan('89600000-0000-4000-8000-0000000000c1', 2027, '{"items":[{"on":"2027-01-02","title":"x","group":"rich","kind":"greeting"}]}'::jsonb)$$, 'which households', 'B · a group is one of the known groups');
select pg_temp.assert_raises($$select app.save_care_plan('89600000-0000-4000-8000-0000000000c1', 2027, '{"items":[{"on":"2027-01-02","title":"x","group":"all","kind":"care_moment"}]}'::jsonb)$$, 'what the touch is', 'B · a care moment is never planned');
select pg_temp.assert_raises($$select app.save_care_plan('89600000-0000-4000-8000-0000000000c1', 2027, '{"items":[{"on":"2027-01-02","title":"x","group":"all","kind":"greeting","is_ask":true}]}'::jsonb)$$, 'no field "is_ask"', 'B · a moment has no field for an ask');
select pg_temp.assert_raises(format($$select app.save_care_plan(%L, 2027, %L::jsonb)$$, '89600000-0000-4000-8000-0000000000c1', (select jsonb_build_object('items', jsonb_agg(jsonb_build_object('on', '2027-01-02', 'title', 'm' || g, 'group', 'all', 'kind', 'greeting')))::text from generate_series(1, 61) g)),
  'at most 60', 'B · at most sixty moments');
select pg_temp.claims(:rel);
select pg_temp.assert_raises($$select app.save_care_plan('89600000-0000-4000-8000-0000000000c1', 2027, '{"items":[]}'::jsonb)$$, 'don''t have access', 'B · a relationship owner reads the plan but cannot change it');
select pg_temp.assert(jsonb_array_length(app.care_plan_get(:c1, 2027) -> 'items') = 2 and not (app.care_plan_get(:c1, 2027) ->> 'can_manage')::boolean, 'B · ... and does read it');
select pg_temp.claims(:lead);
select app.approve_care_plan(:c1, 2027) as ap \gset
select pg_temp.assert((:'ap'::jsonb ->> 'status') = 'approved' and (:'ap'::jsonb ->> 'approved_at') is not null, 'B · a care manager approves it');
select app.save_care_plan(:c1, 2027, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', (:'ap'::jsonb -> 'items' -> 0 ->> 'id'), 'on', '2027-03-02', 'title', 'Call the steady givers, no ask', 'group', 'steady', 'kind', 'thank_you')))) as p2 \gset
select pg_temp.assert((:'p2'::jsonb ->> 'status') = 'draft' and (:'p2'::jsonb ->> 'approved_at') is null and (:'p2'::jsonb -> 'items' -> 0 ->> 'id') = (:'ap'::jsonb -> 'items' -> 0 ->> 'id'),
  'B · an edit returns an approved plan to draft until it is approved again, and keeps the moment''s identifier');
select pg_temp.assert_raises($$select app.approve_care_plan('89600000-0000-4000-8000-0000000000c1', 2030)$$, 'no plan for 2030', 'B · there is nothing to approve before a plan is drafted');
select app.save_care_plan(:c1, 2029, '{"items":[]}'::jsonb) is not null as empty \gset
select pg_temp.assert_raises($$select app.approve_care_plan('89600000-0000-4000-8000-0000000000c1', 2029)$$, 'no moments', 'B · a plan with no moments cannot be approved');
select pg_temp.assert((app.care_plan_get(:c1, 2027) -> 'years') = '[2027, 2029]'::jsonb, 'B · the years that have a plan are listed');
select pg_temp.claims(:lead2);
select pg_temp.assert((app.care_plan_get(:c2, 2027) ->> 'status') = 'none', 'B · another community has no plan of ours');
select pg_temp.assert_raises($$select app.approve_care_plan('89600000-0000-4000-8000-0000000000c1', 2027)$$, 'don''t have access', 'B · and cannot approve ours');

-- ══ C. The context a draft is made from ══════════════════════════════════════
select pg_temp.claims(:lead);
select app.care_plan_context(:c1, 2027) as cx \gset
select pg_temp.assert((:'cx'::jsonb ->> 'mission') like 'To welcome every neighbour%' and (:'cx'::jsonb ->> 'fiscal_year_start_month')::int = 7 and (:'cx'::jsonb ->> 'audience') = 'faith',
  'C · the mission, the fiscal year and the kind of organization');
select pg_temp.assert(jsonb_array_length(:'cx'::jsonb -> 'calendar') = 2 and (:'cx'::jsonb -> 'calendar' -> 0 ->> 'title') = 'Founders day 896', 'C · the community''s own calendar for that year only, in date order');
select pg_temp.assert((:'cx'::jsonb -> 'quiet_periods' -> 0 ->> 'name') = 'A season of rest 896' and (:'cx'::jsonb -> 'quiet_periods' -> 0 ->> 'yearly')::boolean, 'C · the quiet periods');
select pg_temp.assert((:'cx'::jsonb -> 'groups' ->> 'new_household')::int = 1 and (:'cx'::jsonb -> 'groups' ->> 'giver_no_part')::int = 1 and jsonb_typeof(:'cx'::jsonb -> 'groups') = 'object',
  'C · how many households are in each group: counts only');
select pg_temp.assert(:'cx'::text !~* '(Alder|Birch|Ana|Bo896|R-896)', 'C · never a household, a name or a receipt');
select pg_temp.claims(:rel);
select pg_temp.assert(app.care_plan_context(:c1, 2027) -> 'groups' = '{}'::jsonb, 'C · a relationship owner gets no counts of households they do not own');

-- ══ D. Who sees which; logged; audited ═══════════════════════════════════════
select pg_temp.claims(:clerk);
select pg_temp.assert_raises($$select app.care_plan_context('89600000-0000-4000-8000-0000000000c1', 2027)$$, 'don''t have access', 'D · people.view alone reads no context');
select pg_temp.claims(:plat);
select pg_temp.assert_raises($$select app.care_plan_get('89600000-0000-4000-8000-0000000000c1', 2027)$$, 'don''t have access', 'D · nor a platform admin the plan');
select pg_temp.assert(not exists (select 1 from app.care_plans) and not exists (select 1 from app.care_niva_settings), 'D · nor the rows');
reset role;
select pg_temp.assert((select count(*) from app.audit_log where action = 'care.read' and (after ->> 'what') = 'plan_context') >= 2
                      and not exists (select 1 from app.audit_log where action = 'care.read' and after::text ~ '896')
                      and not exists (select 1 from app.audit_log where record_table = 'care_plans' and (after::text ~* 'steady givers' or after::text ~* 'harvest' or after::text ~* 'stewards'))
                      and (select count(*) from app.audit_log where record_table in ('care_plans', 'care_niva_settings') and module = 'care') >= 5,
  'D · every read of the context is logged without names, and the audit of the plan and the tick holds columns, never words');
rollback;
