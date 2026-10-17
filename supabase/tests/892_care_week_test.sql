-- 0892 (DonorDelight slice 5, "Your 5 this week", docs/DONORDELIGHT.md sections 5.8 and 13): households enter playbooks, steps become tasks for the owner.
--   A. Who is in which trigger (first gift, new household, at risk, cooling, steady, lapsed, pledge due, monthly giver, gave-but-no-part), by the engagement
--      signs' own arithmetic; adults only; nothing before a playbook is installed.
--   B. The week: the owner's households only, overdue before due, at most 5 shown with the true total; a household that asked for no thanks gets no
--      thank-you task; open thank-yous are tasks; a manager hears about households that need an owner.
--   C. One tap: the step records its touch (no ask) and is done; a second tap, a stranger and a stopped sign are refused; setting aside needs a reason.
--   D. A sign-based run stops when the sign stops (the household gave again).
--   E. Who may read; every read is logged without names; counts for Today.
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
-- Does this person's week (private rows, called as the database owner) hold a task titled so for that household?
create or replace function pg_temp.has_task(p_user uuid, p_household uuid, p_title text) returns boolean language sql security definer as $$
  select exists (select 1 from app._care_week_rows('89200000-0000-4000-8000-0000000000c1', p_user) t where t.household_id = p_household and t.title = p_title)
$$;
create or replace function pg_temp.sync() returns void language sql as $$
  delete from app.care_sync_state where center_id = '89200000-0000-4000-8000-0000000000c1';
  select app._care_runs_sync('89200000-0000-4000-8000-0000000000c1');
$$;

\set c1 '''89200000-0000-4000-8000-0000000000c1'''
\set owner '''89200000-0000-4000-8000-000000000001'''
\set plat '''89200000-0000-4000-8000-000000000002'''
\set lead '''89200000-0000-4000-8000-000000000003'''
\set rel '''89200000-0000-4000-8000-000000000004'''
\set rel2 '''89200000-0000-4000-8000-000000000005'''
\set clerk '''89200000-0000-4000-8000-000000000006'''
\set hf '''89200000-0000-4000-8000-0000000000b1'''
\set hn '''89200000-0000-4000-8000-0000000000b2'''
\set hr '''89200000-0000-4000-8000-0000000000b3'''
\set hc '''89200000-0000-4000-8000-0000000000b4'''
\set hs '''89200000-0000-4000-8000-0000000000b5'''
\set hl '''89200000-0000-4000-8000-0000000000b6'''
\set hp '''89200000-0000-4000-8000-0000000000b7'''
\set hm '''89200000-0000-4000-8000-0000000000b8'''
\set hz '''89200000-0000-4000-8000-0000000000b9'''
\set pf '''89200000-0000-4000-8000-0000000000a1'''
\set pn '''89200000-0000-4000-8000-0000000000a2'''
\set pr '''89200000-0000-4000-8000-0000000000a3'''
\set pc '''89200000-0000-4000-8000-0000000000a4'''
\set ps '''89200000-0000-4000-8000-0000000000a5'''
\set pl '''89200000-0000-4000-8000-0000000000a6'''
\set pp '''89200000-0000-4000-8000-0000000000a7'''
\set pm '''89200000-0000-4000-8000-0000000000a8'''
\set pz '''89200000-0000-4000-8000-0000000000a9'''
\set pk '''89200000-0000-4000-8000-0000000000aa'''

insert into auth.users (id, email) values
  (:owner, 'owner892@c1.test'), (:plat, 'plat892@weaver.test'), (:lead, 'lead892@c1.test'), (:rel, 'rel892@c1.test'), (:rel2, 'rel2892@c1.test'), (:clerk, 'clerk892@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'week892', 'Grace Church 892', 'G892', 'TX', 'active', 'America/Chicago', 'church', 'sandbox');
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 892: DonorDelight');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('people_viewer_892', 'center', 'People viewer 892', 'center', 'Test 892', '["people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 892: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 892'), (:c1, :rel, 'relationship_owner', 'center', 'Test 892'), (:c1, :rel2, 'relationship_owner', 'center', 'Test 892'),
  (:c1, :clerk, 'people_viewer_892', 'center', 'Test 892');
insert into app.households (id, center_id, display_name, created_at) values
  (:hf, :c1, 'Fern892, Fay', now() - interval '800 days'), (:hn, :c1, 'Newman892, Nia', now() - interval '5 days'), (:hr, :c1, 'Reed892, Rae', now() - interval '800 days'),
  (:hc, :c1, 'Cole892, Cy', now() - interval '800 days'), (:hs, :c1, 'Stone892, Sol', now() - interval '800 days'), (:hl, :c1, 'Lane892, Lou', now() - interval '800 days'),
  (:hp, :c1, 'Park892, Pat', now() - interval '800 days'), (:hm, :c1, 'Moss892, Mo', now() - interval '800 days'), (:hz, :c1, 'Zane892, Zed', now() - interval '800 days');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pf, :c1, 'Fay', 'Fern892', date '1980-01-01'), (:pn, :c1, 'Nia', 'Newman892', date '1981-01-01'), (:pr, :c1, 'Rae', 'Reed892', date '1982-01-01'),
  (:pc, :c1, 'Cy', 'Cole892', date '1983-01-01'), (:ps, :c1, 'Sol', 'Stone892', date '1984-01-01'), (:pl, :c1, 'Lou', 'Lane892', date '1985-01-01'),
  (:pp, :c1, 'Pat', 'Park892', date '1986-01-01'), (:pm, :c1, 'Mo', 'Moss892', date '1987-01-01'), (:pz, :c1, 'Zed', 'Zane892', date '1988-01-01'),
  (:pk, :c1, 'Kit', 'Fern892', ((now() at time zone 'America/Chicago')::date - interval '8 years')::date);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:hf, :pf, :c1, 'primary', true), (:hf, :pk, :c1, 'child', false), (:hn, :pn, :c1, 'primary', true), (:hr, :pr, :c1, 'primary', true), (:hc, :pc, :c1, 'primary', true),
  (:hs, :ps, :c1, 'primary', true), (:hl, :pl, :c1, 'primary', true), (:hp, :pp, :c1, 'primary', true), (:hm, :pm, :c1, 'primary', true), (:hz, :pz, :c1, 'primary', true);
insert into app.care_owners (household_id, center_id, owner_user_id, assigned_by) values
  (:hf, :c1, :rel, :lead), (:hn, :c1, :rel, :lead), (:hr, :c1, :rel, :lead), (:hc, :c1, :rel2, :lead), (:hs, :c1, :rel, :lead),
  (:hp, :c1, :rel, :lead), (:hm, :c1, :rel, :lead), (:hz, :c1, :rel, :lead);
insert into app.care_profiles (household_id, center_id, thanks) values (:hz, :c1, 'none');

create or replace function pg_temp.gift(p_h uuid, p_person uuid, p_days int, p_n int) returns void language sql as $$
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, received_on, created_at, receipt_number)
  values ('89200000-0000-4000-8000-0000000000c1', p_h, p_person, 10000 + p_n, 'check', 'captured', 'offline', (now() at time zone 'America/Chicago')::date - p_days, now() - make_interval(days => p_days), 'R-892-' || p_n)
$$;
-- Fern: a first gift 10 days ago. Reed (at risk): two gifts 400 and 500 days ago. Cole (cooling): one in the last year, three the year before.
-- Stone (steady): two and two. Lane (lapsed): one 700 days ago. Park: a gift 400 days ago, a pledge falling due in 5 days. Moss: a monthly gift. Zane: first gift 3 days ago.
select pg_temp.gift(:hf, :pf, 10, 1),
       pg_temp.gift(:hr, :pr, 400, 2), pg_temp.gift(:hr, :pr, 500, 3),
       pg_temp.gift(:hc, :pc, 30, 4), pg_temp.gift(:hc, :pc, 400, 5), pg_temp.gift(:hc, :pc, 450, 6), pg_temp.gift(:hc, :pc, 600, 7),
       pg_temp.gift(:hs, :ps, 20, 8), pg_temp.gift(:hs, :ps, 100, 9), pg_temp.gift(:hs, :ps, 400, 10), pg_temp.gift(:hs, :ps, 500, 11),
       pg_temp.gift(:hl, :pl, 700, 12), pg_temp.gift(:hp, :pp, 400, 13), pg_temp.gift(:hm, :pm, 60, 14), pg_temp.gift(:hm, :pm, 420, 15), pg_temp.gift(:hz, :pz, 3, 16);
insert into app.pledges (center_id, household_id, pledged_by_person_id, source, amount_cents, due_on, pledged_at)
  values (:c1, :hp, :pp, 'general', 50000, (now() at time zone 'America/Chicago')::date + 5, now() - interval '30 days');
insert into app.recurring_gifts (center_id, household_id, amount_cents, frequency, status, starts_on, next_charge_on, end_kind)
  values (:c1, :hm, 2000, 'monthly', 'active', (now() at time zone 'America/Chicago')::date - 60, (now() at time zone 'America/Chicago')::date + 10, 'until_stopped');
select pg_temp.assert(app.module_enabled(:c1, 'care') and app.module_enabled(:c1, 'giving') and app._care_history_months(:c1) >= 20, 'Fixtures · DonorDelight and Giving are on, with about two years of history');

-- ══ A. Who is in which trigger ═══════════════════════════════════════════════
create temp table trig on commit drop as select * from app._care_trigger_rows(:c1);
select pg_temp.assert(exists (select 1 from trig where trigger_key = 'first_gift' and household_id = :hf) and exists (select 1 from trig where trigger_key = 'first_gift' and household_id = :hz)
                      and not exists (select 1 from trig where trigger_key = 'first_gift' and household_id in (:hr, :hc, :hs)),
  'A · a first gift: the household whose only gift is recent (not those who gave before)');
select pg_temp.assert(exists (select 1 from trig where trigger_key = 'new_household' and household_id = :hn) and not exists (select 1 from trig where trigger_key = 'new_household' and household_id = :hf),
  'A · a new household is one added in the last year, on the day it was added');
select pg_temp.assert((select array_agg(household_id::text order by household_id::text) from trig where trigger_key = 'at_risk') = array[:hr, :hp]
                      and (select array_agg(household_id::text order by household_id::text) from trig where trigger_key = 'cooling') = array[:hc]
                      and (select array_agg(household_id::text order by household_id::text) from trig where trigger_key = 'lapsed') = array[:hl],
  'A · at risk, cooling and lapsed are exactly the engagement signs (Reed and Park gave only the year before, Cole gave less, Lane is lapsed)');
select pg_temp.assert(exists (select 1 from trig where trigger_key = 'steady' and household_id = :hs) and not exists (select 1 from trig where trigger_key = 'steady' and household_id in (:hr, :hc, :hl)),
  'A · steady giving is as many gifts as the year before, and not already cooling, at risk or lapsed');
select pg_temp.assert(exists (select 1 from trig where trigger_key = 'pledge_due' and household_id = :hp and event_on = (now() at time zone 'America/Chicago')::date + 5)
                      and exists (select 1 from trig where trigger_key = 'monthly_giver' and household_id = :hm),
  'A · a pledge with a balance falling due, and an active monthly gift');
select pg_temp.assert(exists (select 1 from trig where trigger_key = 'giver_no_part' and household_id = :hf) and not exists (select 1 from trig where trigger_key = 'volunteer_no_gift'),
  'A · someone who gave but never took part is flagged; nobody has volunteered here');
select pg_temp.assert(not exists (select 1 from trig where household_id = :hn and trigger_key <> 'new_household'), 'A · a household with no gifts and no activity is only new');
select pg_temp.assert(not exists (select 1 from app.care_runs where center_id = :c1) and (select count(*) from app._care_week_rows(:c1, :rel)) = 0,
  'A · before a playbook is installed there are no runs and no tasks');

-- ══ B. The week ══════════════════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:lead);
select app.install_care_starters(:c1) as n \gset
reset role;
select pg_temp.sync();
select pg_temp.assert(pg_temp.has_task(:rel, :hf, 'Share what the gift is doing') and not pg_temp.has_task(:rel, :hf, 'Invite them to see the work first-hand'),
  'B · a first gift 10 days ago: the 14-day step falls this week; the 45-day step waits');
select pg_temp.assert(pg_temp.has_task(:rel, :hn, 'Welcome them') and pg_temp.has_task(:rel, :hn, 'Introduce them to someone'),
  'B · a new household: the welcome (5 days overdue) and the introduction (due in 2 days)');
select pg_temp.assert(pg_temp.has_task(:rel, :hr, 'Call to reconnect') and pg_temp.has_task(:rel, :hs, 'Call just to say thank you') and pg_temp.has_task(:rel, :hp, 'Send a friendly reminder')
                      and pg_temp.has_task(:rel, :hm, 'Thank them for their steady gift'),
  'B · at risk, steady, a pledge falling due and a monthly giver each get their first step today');
select pg_temp.assert(not pg_temp.has_task(:rel, :hc, 'Call to say you have missed them') and pg_temp.has_task(:rel2, :hc, 'Call to say you have missed them'),
  'B · a task goes to the household''s own owner, not to another');
select pg_temp.assert(not exists (select 1 from app._care_week_rows(:c1, :rel) t where t.household_id = :hl),
  'B · an unowned household is nobody''s task');
select pg_temp.assert(not exists (select 1 from app._care_week_rows(:c1, :rel) t where t.household_id = :hz and t.touch_kind = 'thank_you')
                      and exists (select 1 from app._care_week_rows(:c1, :rel) t where t.household_id = :hz and t.title = 'Ask how they would like to be involved')
                      and exists (select 1 from app._care_week_rows(:c1, :rel) t where t.household_id = :hs and t.touch_kind = 'thank_you'),
  'B · a household that asked for no thanks gets no thank-you task but its other steps (a household with no profile gets them all)');
select pg_temp.assert(not exists (select 1 from app._care_week_rows(:c1, :lead)) and not exists (select 1 from app._care_week_rows(:c1, :clerk)) and not exists (select 1 from app._care_week_rows(:c1, :plat)),
  'B · a person who owns no household has no tasks; neither do people.view or a platform admin');
set role authenticated;
select pg_temp.claims(:rel);
select app.care_week(:c1) as w \gset
select pg_temp.assert((:'w'::jsonb ->> 'total')::int > 5 and jsonb_array_length(:'w'::jsonb -> 'tasks') = 5 and (:'w'::jsonb ->> 'overdue')::int >= 2,
  'B · at most five tasks are shown and the total is the true total');
select pg_temp.assert((:'w'::jsonb -> 'tasks' -> 0 ->> 'overdue')::boolean and (:'w'::jsonb -> 'tasks' -> 1 ->> 'overdue')::boolean
                      and (:'w'::jsonb -> 'tasks' -> 0 ->> 'due_on')::date <= (:'w'::jsonb -> 'tasks' -> 1 ->> 'due_on')::date,
  'B · what is overdue comes first, the oldest first');
select pg_temp.assert((:'w'::jsonb -> 'tasks' -> 0 -> 'household' ->> 'id') is not null and (:'w'::jsonb -> 'tasks' -> 0 ->> 'draft') like '%{{%',
  'B · each task names its household by its card and carries a draft with its placeholders');
select pg_temp.assert(not exists (select 1 from jsonb_path_query(:'w'::jsonb, '$.**') v where jsonb_typeof(v) = 'string' and v #>> '{}' ~* 'Kit|R-892'),
  'B · no child''s name and no receipt number appears');
select pg_temp.assert((:'w'::jsonb ->> 'needs_owner')::int = 0 and (:'w'::jsonb ->> 'me') is null, 'B · an owner is not told about unowned households; the answer carries no invented name');
select pg_temp.claims(:lead);
select pg_temp.assert((app.care_week(:c1) ->> 'needs_owner')::int >= 1 and (app.care_week(:c1) ->> 'total')::int = 0, 'B · a manager hears that a household needs an owner (Lane)');
select pg_temp.claims(:rel);
select pg_temp.assert((app.care_week_counts(:c1) ->> 'tasks')::int = (:'w'::jsonb ->> 'total')::int, 'B · the counts for Today equal the total');

-- The thank-you tracker's open steps are tasks too.
select pg_temp.claims(:owner);
select app.save_care_settings(:c1, '{}'::jsonb, true) is not null as saved \gset
select pg_temp.claims(:rel);
select app.care_week(:c1) as w2 \gset
select pg_temp.assert((:'w2'::jsonb -> 'tasks' -> 0 ->> 'kind') = 'thank' and (:'w2'::jsonb -> 'tasks' -> 0 ->> 'overdue')::boolean and (:'w2'::jsonb -> 'tasks' -> 0 ->> 'why') like 'Their gift of%',
  'B · with the thank-you rules saved, an unthanked gift comes first as a thank-you task');
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'w2'::jsonb -> 'tasks') t where t -> 'household' ->> 'id' = :hz and t ->> 'kind' = 'thank'),
  'B · ... but never for a household that asked for no thanks');

-- ══ C. One tap ═══════════════════════════════════════════════════════════════
select r.id as run_hf, s.id as step_hf from app.care_runs r join app.care_playbooks p on p.id = r.playbook_id join app.care_playbook_steps s on s.playbook_id = p.id
 where r.household_id = :hf and p.trigger_key = 'first_gift' and s.after_days = 14 \gset
select app.complete_care_task(:'run_hf', :'step_hf') ->> 'touch_id' as touch \gset
select pg_temp.assert((select kind || '/' || channel || '/' || outcome || '/' || is_ask::text from app.care_touches where id = :'touch') = 'update/email/done/false'
                      and (select household_id from app.care_touches where id = :'touch') = :hf and (select by_user_id from app.care_touches where id = :'touch') = :rel,
  'C · one tap records the step''s touch (an update by email, done, no ask) as the person who tapped');
select pg_temp.assert((select status from app.care_task_marks where run_id = :'run_hf' and step_id = :'step_hf') = 'done' and not pg_temp.has_task(:rel, :hf, 'Share what the gift is doing'),
  'C · the task is marked done and leaves the week');
select pg_temp.assert_raises(format($$select app.complete_care_task(%L, %L)$$, :'run_hf', :'step_hf'), 'already done', 'C · a second tap is refused');
select pg_temp.assert_raises(format($$select app.skip_care_task(%L, %L, 'x')$$, :'run_hf', :'step_hf'), 'already done', 'C · and so is setting it aside afterwards');
select r.id as run_hn, s.id as step_hn from app.care_runs r join app.care_playbooks p on p.id = r.playbook_id join app.care_playbook_steps s on s.playbook_id = p.id
 where r.household_id = :hn and p.trigger_key = 'new_household' and s.after_days = 7 \gset
select pg_temp.assert_raises(format($$select app.skip_care_task(%L, %L, '   ')$$, :'run_hn', :'step_hn'), 'say why', 'C · setting a task aside needs a reason');
select app.skip_care_task(:'run_hn', :'step_hn', 'They moved away.');
select pg_temp.assert((select note from app.care_task_marks where run_id = :'run_hn' and step_id = :'step_hn') = 'They moved away.' and not pg_temp.has_task(:rel, :hn, 'Introduce them to someone'),
  'C · set aside with its reason, which is kept');
reset role;
select r.id as run_hc, s.id as step_hc from app.care_runs r join app.care_playbooks p on p.id = r.playbook_id join app.care_playbook_steps s on s.playbook_id = p.id
 where r.household_id = :hc and p.trigger_key = 'cooling' and s.after_days = 0 \gset
set role authenticated;
select pg_temp.claims(:rel);
select pg_temp.assert_raises(format($$select app.complete_care_task(%L, %L)$$, :'run_hc', :'step_hc'), 'don''t have access', 'C · a relationship owner cannot tap a task of another owner''s household');
select pg_temp.assert_raises(format($$select app.complete_care_task(%L, %L)$$, :'run_hf', '89200000-0000-4000-8000-0000000000ff'), 'not found', 'C · a step that is not in the run is not found');
select pg_temp.claims(:clerk);
select pg_temp.assert_raises(format($$select app.complete_care_task(%L, %L)$$, :'run_hc', :'step_hc'), 'don''t have access', 'C · people.view alone cannot tap');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format($$select app.complete_care_task(%L, %L)$$, :'run_hc', :'step_hc'), 'don''t have access', 'C · nor a platform admin');
select pg_temp.assert_raises($$select app.care_week('89200000-0000-4000-8000-0000000000c1')$$, 'don''t have access', 'C · nor read a week');
select pg_temp.claims(:rel2);
select app.complete_care_task(:'run_hc', :'step_hc', 'text', 'Left a voicemail') ->> 'touch_id' as touch2 \gset
select pg_temp.assert((select channel || '/' || note from app.care_touches where id = :'touch2') = 'text/Left a voicemail', 'C · the owner who taps may choose the channel and add a note');

-- ══ D. A sign stops when it stops applying ═══════════════════════════════════
reset role;
select pg_temp.assert((select status from app.care_runs r join app.care_playbooks p on p.id = r.playbook_id where r.household_id = :hr and p.trigger_key = 'at_risk') = 'active', 'D · Reed''s at-risk run is active');
select pg_temp.gift(:hr, :pr, 1, 99);
select pg_temp.sync();
select pg_temp.assert((select status from app.care_runs r join app.care_playbooks p on p.id = r.playbook_id where r.household_id = :hr and p.trigger_key = 'at_risk') = 'stopped'
                      and not pg_temp.has_task(:rel, :hr, 'Call to reconnect'),
  'D · Reed gave again: the at-risk run stops, so nobody calls to say "we miss you"');
select pg_temp.assert((select status from app.care_runs r join app.care_playbooks p on p.id = r.playbook_id where r.household_id = :hf and p.trigger_key = 'first_gift') = 'active',
  'D · a first-gift run is not a sign: it keeps going');
update app.care_playbooks set cooldown_days = 30 where center_id = :c1 and trigger_key = 'at_risk';
select pg_temp.sync();
select pg_temp.assert((select count(*) from app.care_runs r join app.care_playbooks p on p.id = r.playbook_id where r.household_id = :hr and p.trigger_key = 'at_risk') = 1,
  'D · syncing again opens nothing twice');
update app.care_playbooks set enabled = false where center_id = :c1 and trigger_key = 'steady';
select pg_temp.assert(not pg_temp.has_task(:rel, :hs, 'Call just to say thank you'), 'D · a paused playbook offers no task');

-- ══ E. Reading is logged ═════════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app.audit_log where action = 'care.read' and (after ->> 'what') = 'week') >= 3
                      and not exists (select 1 from app.audit_log where action = 'care.read' and after::text ~ '892'),
  'E · every read of a week is logged (who, when, how many) and names no one');
select pg_temp.assert(not exists (select 1 from app.audit_log where record_table in ('care_task_marks', 'care_runs') and (after::text ~* 'voicemail' or after::text ~* 'moved away')),
  'E · the audit of a task never holds the words of a note or a reason');
rollback;
