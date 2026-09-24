-- Prototype-parity schema (0021–0025): RPC behaviour and RLS.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
\set jsh '''00000000-0000-4000-8000-000000000001'''
-- Users from earlier files: 01 Priya (adult, Shah), 02 Dev (14, Shah), 03 treasurer, 04 teacher (class A),
-- 05 Kiran Mehta, 06 check-in volunteer, 09 principal, 11 center admin.
insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000021', 'religious@example.com');
insert into app.people (id, center_id, first_name, last_name) values ('30000000-0000-4000-8000-000000000041', :jsh, 'Rekha', 'Religious');
insert into app.center_users (center_id, user_id, person_id) values (:jsh, '10000000-0000-4000-8000-000000000021', '30000000-0000-4000-8000-000000000041');
insert into app.role_grants (center_id, user_id, role_key) values (:jsh, '10000000-0000-4000-8000-000000000021', 'religious_coordinator');

-- =================================================================== 1. default_time
select pg_temp.assert((select default_time from app.practices where center_id is null and key = 'samayik') = '18:00'
                      and (select default_time from app.practices where center_id is null and key = 'navkarsi') is null,
                      'shared practices carry their prototype time of day (Navkarsi stays sun-relative)');

-- =================================================================== 2. unlog_practice
-- Priya logged navkar_waking (5) + darshan (10) today and completed the day (+20) in 01.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select * from app.unlog_practice('30000000-0000-4000-8000-000000000001', (select id from app.practices where key = 'darshan')) \gset u_
select pg_temp.assert(:u_points_reversed = 30 and not :'u_day_complete'::boolean and :u_streak_days = 0,
                      'unlogging reverses the practice points and the day-complete bonus, and steps the streak back');
select pg_temp.assert((select sum(points) from app.points_ledger where person_id = '30000000-0000-4000-8000-000000000001') = 5,
                      'the points ledger nets to what is still logged');
select pg_temp.assert((select points_reversed from app.unlog_practice('30000000-0000-4000-8000-000000000001',
                        (select id from app.practices where key = 'darshan'))) = 0, 'unlogging twice reverses nothing');
select pg_temp.assert((select day_complete from app.log_practice(:jsh, (select id from app.practices where key = 'darshan'))),
                      'logging it again completes the day again');
select pg_temp.assert((select sum(points) from app.points_ledger where person_id = '30000000-0000-4000-8000-000000000001') = 35
                      and (select current_days from app.streaks where person_id = '30000000-0000-4000-8000-000000000001') = 1,
                      're-logging re-awards the points and the streak');
do $$ begin
  perform app.unlog_practice('30000000-0000-4000-8000-000000000005', (select id from app.practices where key = 'darshan'));
  raise exception 'FAIL: unlogged another family''s practice';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: unlog_practice is limited to people the caller can act for';
end $$;
commit;

-- =================================================================== 3. Gyan Path fields
select pg_temp.assert((select tint || mark || recommended::text from app.gyan_goals where center_id is null and key = 'samayik') = '#1B2C5CStrue',
                      'Gyan Path goals carry tint, mark and the recommended flag');
select pg_temp.assert((select l.chapter from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id
                        where g.center_id is null and g.key = 'samayik' and l.sort_order = 5) = 'Chapter 2 · Sutras of Samayik',
                      'Gyan Path levels carry their chapter');
do $$ begin
  update app.people set gyan_daily_minutes = 7 where id = '30000000-0000-4000-8000-000000000001';
  raise exception 'FAIL: 7 daily minutes accepted';
exception when check_violation then raise notice 'PASS: daily learning minutes are 5, 10 or 15';
end $$;
update app.people set gyan_daily_minutes = 10 where id = '30000000-0000-4000-8000-000000000001';

-- =================================================================== 4. saathi_feed
-- Dev completes his day; Anya selected a practice 5 days ago and has not logged; Rahul finishes a goal.
insert into app.practice_selections (center_id, person_id, practice_id, selected_at)
  select :jsh, '30000000-0000-4000-8000-000000000003', id, now() - interval '10 days' from app.practices where key = 'navkar_waking';
insert into app.practice_logs (center_id, person_id, practice_id, logged_on)
  select :jsh, '30000000-0000-4000-8000-000000000003', id, current_date from app.practices where key = 'navkar_waking';
insert into app.practice_selections (center_id, person_id, practice_id, selected_at)
  select :jsh, '30000000-0000-4000-8000-000000000004', id, now() - interval '5 days' from app.practices where key = 'darshan';
insert into app.gyan_goals (id, center_id, key, name) values ('f9000000-0000-4000-8000-000000000001', :jsh, 'mini', 'Learn Jai Jinendra');
insert into app.gyan_levels (id, goal_id, key, name) values ('f9000000-0000-4000-8000-000000000002', 'f9000000-0000-4000-8000-000000000001', '1', 'Greeting');
insert into app.gyan_steps (id, level_id, kind, title) values ('f9000000-0000-4000-8000-000000000003', 'f9000000-0000-4000-8000-000000000002', 'read', 'Say it');
insert into app.gyan_progress (center_id, person_id, step_id, stars, completed_at)
  values (:jsh, '30000000-0000-4000-8000-000000000002', 'f9000000-0000-4000-8000-000000000003', 3, now() - interval '1 hour');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select app.send_anumodana(:jsh, '30000000-0000-4000-8000-000000000003');
select pg_temp.assert((select string_agg(kind || ':' || person_name, ',' order by kind) from app.saathi_feed('20000000-0000-4000-8000-000000000001'))
                      = 'behind:Anya,daily_goal_met:Dev,goal_completed:Rahul',
                      'Saathi shows the family''s completed goals, met days and who is behind (not the caller)');
select pg_temp.assert((select anumodana_count = 1 and i_sent from app.saathi_feed('20000000-0000-4000-8000-000000000001') where kind = 'daily_goal_met'),
                      'Saathi counts anumodanas and marks the ones the caller sent');
commit;
insert into app.saathi_settings (center_id, person_id, opted_in) values (:jsh, '30000000-0000-4000-8000-000000000002', false);
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert(not exists (select 1 from app.saathi_feed('20000000-0000-4000-8000-000000000001') where kind = 'goal_completed'),
                      'people who turned Saathi off are left out');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';  -- Kiran Mehta
do $$ begin
  perform * from app.saathi_feed('20000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: saw another family''s Saathi feed';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: the Saathi feed is limited to the caller''s family circle';
end $$;
commit;

-- =================================================================== 5. my_practice_standing
-- 11 more people log darshan_puja practices this month: 3 score 20, 8 score 10. Priya scores 10.
insert into app.people (id, center_id, first_name, last_name)
  select ('39000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid, :jsh, 'Sadhak' || i, 'Test' from generate_series(1, 11) i;
insert into app.practice_logs (center_id, person_id, practice_id, logged_on)
  select :jsh, ('39000000-0000-4000-8000-0000000000' || lpad(i::text, 2, '0'))::uuid,
         (select id from app.practices where center_id is null and key = case when i <= 3 then 'ashtaprakari' else 'darshan' end), current_date
    from generate_series(1, 11) i;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert((select top_percent || '/' || practices_count || '/' || done_today
                         from app.my_practice_standing('30000000-0000-4000-8000-000000000001') where category = 'darshan_puja') = '34/1/1',
                      'standing: rank 4 of 12 in the category is top 34%, with practices chosen and done today');
select pg_temp.assert((select top_percent from app.my_practice_standing('30000000-0000-4000-8000-000000000001') where category = 'mantra_jaap') is null,
                      'standing is suppressed when fewer than 10 people are in the category');
select pg_temp.assert((select count(*) from app.my_practice_standing('30000000-0000-4000-8000-000000000003')) = 1,
                      'a parent can see their child''s standing');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';
do $$ begin
  perform * from app.my_practice_standing('30000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: saw another person''s standing';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: practice standing is private';
end $$;
commit;

-- =================================================================== 6. opportunity kinds and availability
insert into app.campaigns (id, center_id, name, kind, status, goal_cents) values
  ('f9000000-0000-4000-8000-000000000010', :jsh, 'Diwali 2026', 'event', 'published', null),
  ('f9000000-0000-4000-8000-000000000011', :jsh, 'Swamivatsalya', 'sponsorship', 'published', 100000);
insert into app.opportunities (id, center_id, campaign_id, name, kind, options, status) values
  ('f9000000-0000-4000-8000-000000000012', :jsh, 'f9000000-0000-4000-8000-000000000010', 'Diwali pujans', 'multi',
   '[{"key":"aarti","label":"Pehli aarti","amount_cents":25100,"fixed":true},{"key":"divo","label":"Mangal divo","amount_cents":15100,"fixed":true}]', 'open'),
  ('f9000000-0000-4000-8000-000000000013', :jsh, 'f9000000-0000-4000-8000-000000000011', 'Swamivatsalya sponsorship', 'tier',
   '[{"key":"gold","label":"Gold","amount_cents":25000},{"key":"silver","label":"Silver","amount_cents":10000}]', 'open');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
insert into app.pledges (center_id, household_id, source, amount_cents, opportunity_id, opportunity_option, campaign_id) values
  (:jsh, '20000000-0000-4000-8000-000000000001', 'pujan', 25100, 'f9000000-0000-4000-8000-000000000012', 'aarti', 'f9000000-0000-4000-8000-000000000010'),
  (:jsh, '20000000-0000-4000-8000-000000000001', 'sponsorship', 25000, 'f9000000-0000-4000-8000-000000000013', 'gold', 'f9000000-0000-4000-8000-000000000011');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';  -- Kiran Mehta
insert into app.pledges (center_id, household_id, source, amount_cents, opportunity_id, opportunity_option, campaign_id) values
  (:jsh, '20000000-0000-4000-8000-000000000002', 'sponsorship', 25000, 'f9000000-0000-4000-8000-000000000013', 'gold', 'f9000000-0000-4000-8000-000000000011');
do $$ begin
  insert into app.pledges (center_id, household_id, source, amount_cents, opportunity_id, opportunity_option)
    values ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'pujan', 25100, 'f9000000-0000-4000-8000-000000000012', 'aarti');
  raise exception 'FAIL: a taken pujan was pledged twice';
exception when check_violation then raise notice 'PASS: a multi option (pujan) is taken by one family';
end $$;
do $$ begin
  insert into app.pledges (center_id, household_id, source, amount_cents, opportunity_id, opportunity_option)
    values ('00000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002', 'pujan', 100, 'f9000000-0000-4000-8000-000000000012', 'nope');
  raise exception 'FAIL: unknown option accepted';
exception when check_violation then raise notice 'PASS: the chosen option must be offered on the opportunity';
end $$;
select pg_temp.assert((select string_agg(option_key || ':' || taken || ':' || taken_count || ':' || slots_taken || '/' || slots_total || ':' || goal_percent, ',')
                         from app.opportunity_availability('f9000000-0000-4000-8000-000000000012')) = 'aarti:true:1:1/2:50,divo:false:0:1/2:50',
                      'multi availability: per-item taken, 1 of 2 pujans, 50%');
select pg_temp.assert((select string_agg(option_key || ':' || taken || ':' || taken_count || ':' || goal_percent, ',')
                         from app.opportunity_availability('f9000000-0000-4000-8000-000000000013')) = 'gold:false:2:50,silver:false:0:50',
                      'tier availability: tiers are never used up; goal % follows the campaign goal');
commit;

-- =================================================================== 7. commit_labh
update app.labh_options set campaign_id = 'f9000000-0000-4000-8000-000000000010' where name = 'Jeevdaya donation';
insert into app.special_days (id, center_id, household_id, person_id, kind, label, calendar_date) values
  ('f9000000-0000-4000-8000-000000000020', :jsh, '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000004',
   'birthday', 'Anya''s birthday', (current_date + 20) - interval '9 years');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';  -- Mehta: another family
select pg_temp.assert((select count(*) from app.labh_options) = 6, 'members of the center read the labh menu');
do $$ begin
  perform app.commit_labh('f9000000-0000-4000-8000-000000000020', array(select id from app.labh_options limit 1), null, false);
  raise exception 'FAIL: took a labh on another family''s special day';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only the family''s adults can take a labh on their special day';
end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';  -- Dev, 14
do $$ begin
  perform app.commit_labh('f9000000-0000-4000-8000-000000000020', array(select id from app.labh_options limit 1), null, false);
  raise exception 'FAIL: child took a labh';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: children cannot take a labh';
end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select app.commit_labh('f9000000-0000-4000-8000-000000000020',
  array[(select id from app.labh_options where name = 'Jeevdaya donation'), (select id from app.labh_options where name = 'Ashtaprakari puja')],
  'In honour of Anya', true) as labh_numbers \gset
select pg_temp.assert(cardinality(:'labh_numbers'::text[]) = 2, 'commit_labh returns one pledge number per chosen labh');
select pg_temp.assert((select string_agg(source || ':' || amount_cents || ':' || coalesce(campaign_id::text, '-') || ':' || dedication, ',' order by amount_cents)
                         from app.pledges where source_ref_id = 'f9000000-0000-4000-8000-000000000020')
                      = 'labh:5100:f9000000-0000-4000-8000-000000000010:In honour of Anya,labh:10800:-:In honour of Anya',
                      'labh pledges carry the option amount, campaign and dedication, linked to the special day');
select pg_temp.assert((select count(*) from app.recurring_gifts where special_day_id = 'f9000000-0000-4000-8000-000000000020'
                         and frequency = 'yearly' and status = 'pending_payment_method' and provider_ref is null
                         and starts_on = (current_date + 20 + interval '1 year')::date) = 2,
                      'repeat yearly creates yearly gifts from next year, waiting for a payment method');
commit;

-- =================================================================== 8. create_recurring_gift
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select app.create_recurring_gift('20000000-0000-4000-8000-000000000001', (select id from app.funds where key = 'general' and center_id = :jsh),
  null, 5100, 'monthly', current_date + 3, 'count', 12, null, null) as rg \gset
select pg_temp.assert((select status || ':' || end_kind || ':' || end_count || ':' || (next_charge_on = current_date + 3) from app.recurring_gifts where id = :'rg')
                      = 'pending_payment_method:count:12:true', 'a new recurring gift waits for a payment method with its end rule');
do $$ begin
  perform app.create_recurring_gift('20000000-0000-4000-8000-000000000001', null, null, 5100, 'monthly', current_date, 'until_date', null, null, null);
  raise exception 'FAIL: until_date without a date accepted';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: the end rule is validated';
end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';
do $$ begin
  perform app.create_recurring_gift('20000000-0000-4000-8000-000000000001', null, null, 5100, 'monthly', current_date, 'until_stopped', null, null, null);
  raise exception 'FAIL: child created a recurring gift';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: only adults set up recurring gifts';
end $$;
commit;

-- =================================================================== 9. receipt_templates
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';  -- treasurer (giving.manage)
insert into app.receipt_templates (center_id, kind, signed_by, personal_note)
  values (:jsh, 'donation_receipt', 'Treasurer, on behalf of the Executive Committee', 'Thank you for your generosity.');
select pg_temp.assert((select updated_by from app.receipt_templates where kind = 'donation_receipt') = '10000000-0000-4000-8000-000000000003',
                      'the treasurer saves the receipt template; updated_by is stamped');
commit;
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'receipt_templates'), 'receipt template changes are audited');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*) from app.receipt_templates) = 0, 'members do not see receipt templates');
do $$ begin
  insert into app.receipt_templates (center_id, kind, signed_by) values ('00000000-0000-4000-8000-000000000001', 'pledge_confirmation', 'me');
  raise exception 'FAIL: member edited a receipt template';
exception when insufficient_privilege then raise notice 'PASS: only giving.manage edits receipt templates';
end $$;
commit;

-- =================================================================== 10. public dashboard visibility
begin;
set local role anon;
select pg_temp.assert((app.public_kpis('jsh')->'metrics') = '{}'::jsonb and not (app.public_kpis('jsh') ? 'attendance_by_month'),
                      'nothing is public until someone publishes it (default members-only)');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';  -- treasurer: no settings.manage
do $$ begin
  insert into app.public_kpi_settings (center_id, kpi_key, visibility) values ('00000000-0000-4000-8000-000000000001', 'samayik', 'public');
  raise exception 'FAIL: treasurer published a KPI';
exception when insufficient_privilege then raise notice 'PASS: only settings.manage publishes KPIs';
end $$;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';  -- center admin
insert into app.public_kpi_settings (center_id, kpi_key, visibility) values
  (:jsh, 'community_people', 'public'), (:jsh, 'families_by_zone', 'public');
select pg_temp.assert((select count(*) from app.public_kpi_catalog(:jsh)) = 19
                      and (select visibility from app.public_kpi_catalog(:jsh) where kpi_key = 'community_people') = 'public'
                      and (select visibility from app.public_kpi_catalog(:jsh) where kpi_key = 'samayik') = 'members',
                      'the KPI catalog lists every key with its current visibility');
commit;
select pg_temp.assert(exists (select 1 from app.audit_log where record_table = 'public_kpi_settings'), 'publishing a KPI is audited');
begin;
set local role anon;
select app.public_kpis('jsh') as anon_kpis \gset
select pg_temp.assert((select array_agg(k order by k) from jsonb_object_keys((:'anon_kpis'::jsonb)->'metrics') k) = '{community_people}'
                      and (:'anon_kpis'::jsonb) ? 'families_by_zone' and not ((:'anon_kpis'::jsonb) ? 'attendance_by_month')
                      and (:'anon_kpis'::jsonb)->>'audience' = 'public',
                      'anonymous visitors get only the published KPIs');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
select app.public_kpis('jsh', date_trunc('year', current_date)::date, current_date, null) as member_kpis \gset
select pg_temp.assert(((:'member_kpis'::jsonb)->'metrics') ? 'samayik' and jsonb_array_length((:'member_kpis'::jsonb)->'attendance_by_month') = 12
                      and ((:'member_kpis'::jsonb)->'deltas') ? 'attendance' and ((:'member_kpis'::jsonb)->'previous') ? 'from',
                      'members see every KPI, 12 monthly attendance buckets and deltas vs the previous period');
select pg_temp.assert((select bool_and((x->>'value') is null or (x->>'value')::int >= 10) from jsonb_array_elements((:'member_kpis'::jsonb)->'attendance_by_month') x)
                      and ((:'member_kpis'::jsonb)->'metrics'->>'samayik') is null,
                      'counts under 10 stay suppressed');
commit;

-- =================================================================== 11. bolis
update app.bolis set status = 'open' where id = '80000000-0000-4000-8000-000000000001';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000021';  -- religious coordinator (bolis.manage)
select app.close_boli('80000000-0000-4000-8000-000000000001', 'Closed at the end of the program') as boli_pledge \gset
select pg_temp.assert((select closed_reason || ':' || status from app.bolis where id = '80000000-0000-4000-8000-000000000001')
                      = 'Closed at the end of the program:closed', 'close_boli stores the reason');
do $$ begin
  perform app.close_boli('80000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: closed a boli twice';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: a closed boli cannot be closed again (no second winner pledge)';
end $$;
commit;
select pg_temp.assert((select reason from app.audit_log where action = 'boli.close' order by id desc limit 1) = 'Closed at the end of the program',
                      'closing a boli is audited with its reason');
select pg_temp.assert((select source::text from app.pledges where id = :'boli_pledge') = 'boli', 'the winner still becomes a boli pledge');

-- =================================================================== 12–14. columns
select pg_temp.assert((select bool_and(gift_pack) from app.store_items) and (select bool_and(not hall_display) from app.bolis),
                      'store items can be gift-packed by default; bolis are off the hall screen by default');
update app.calendar_layers set owner_label = 'Religious coordinator' where key = 'tithi_smp';
update app.surveys set send_at = now() + interval '1 day', reminder_after_days = 3, template_key = 'event_feedback'
 where id = 'f6000000-0000-4000-8000-000000000003';
do $$ begin
  update app.surveys set reminder_after_days = 0 where id = 'f6000000-0000-4000-8000-000000000003';
  raise exception 'FAIL: zero-day reminder accepted';
exception when check_violation then raise notice 'PASS: survey reminders are at least a day later';
end $$;

-- =================================================================== 15. event live stats
select count(*) filter (where checked_in_at is not null) as exp_in from app.attendees where event_id = '50000000-0000-4000-8000-000000000001' \gset
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000006';  -- check-in volunteer for the event
select pg_temp.assert((select checked_in from app.event_live_stats('50000000-0000-4000-8000-000000000001')) = :exp_in and :exp_in > 0,
                      'event staff see live check-in numbers');
select pg_temp.assert(exists (select 1 from app.event_recent_checkins('50000000-0000-4000-8000-000000000001', 5) where household_label = 'Shah family'),
                      'recent check-ins list the household and lunch time');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
do $$ begin
  perform * from app.event_live_stats('50000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: a member saw live event stats';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: live event stats are for event staff';
end $$;
commit;

-- =================================================================== 16. segment_recipient_count
update app.households set zone_id = (select id from app.zones where center_id = :jsh and name = 'West')
 where id in ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002');
update app.people set email = 'kiran.mehta@example.com' where id = '30000000-0000-4000-8000-000000000005';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';  -- center admin (comms.send)
select pg_temp.assert(app.segment_recipient_count(:jsh, jsonb_build_object('zone_ids', jsonb_build_array((select id from app.zones where center_id = :jsh and name = 'West')))) = 0,
                      'without an explicit email opt-in nobody is counted (owner decision 0026)');
commit;
insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source)
  select :jsh, p.id, 'email', p.email, true, 'app'
    from app.people p join app.household_members hm on hm.person_id = p.id and hm.left_at is null
   where hm.household_id in ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002')
     and coalesce(p.email::text, '') <> '';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';
select pg_temp.assert(app.segment_recipient_count(:jsh, jsonb_build_object('zone_ids', jsonb_build_array((select id from app.zones where center_id = :jsh and name = 'West')))) = 2,
                      'recipient preview counts households with an adult who opted in to email');
commit;
insert into app.channel_optins (center_id, person_id, channel, address, opted_in, source)
  values (:jsh, '30000000-0000-4000-8000-000000000005', 'email', 'kiran.mehta@example.com', false, 'keyword');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000011';
select pg_temp.assert(app.segment_recipient_count(:jsh, jsonb_build_object('zone_ids', jsonb_build_array((select id from app.zones where center_id = :jsh and name = 'West')))) = 1,
                      'unsubscribed households are excluded');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
do $$ begin
  perform app.segment_recipient_count('00000000-0000-4000-8000-000000000001', '{"all_members":true}');
  raise exception 'FAIL: a member previewed recipients';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: recipient preview is for comms.send holders';
end $$;
commit;

-- =================================================================== 17. pathshala_term_stats
insert into app.pathshala_teachers (center_id, class_id, person_id) values (:jsh, '40000000-0000-4000-8000-00000000000a', '30000000-0000-4000-8000-000000000007');
insert into app.gyan_signoffs (center_id, person_id, level_id)
  select :jsh, '30000000-0000-4000-8000-000000000003', l.id from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id
   where g.center_id is null and g.key = 'navkar' and l.key = '9';
select count(*) as exp_students from app.pathshala_enrollments where term_id = '40000000-0000-4000-8000-000000000001' and status in ('placed','active') \gset
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000009';  -- principal
select pg_temp.assert((select students = :exp_students and teachers = 1 and background_checks_expiring = 1 and signoffs_waiting >= 1
                         from app.pathshala_term_stats('40000000-0000-4000-8000-000000000001')),
                      'term stats: students, teachers, a teacher without a current check, waiting sign-offs');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000004';  -- teacher: no pathshala.view
do $$ begin
  perform * from app.pathshala_term_stats('40000000-0000-4000-8000-000000000001');
  raise exception 'FAIL: a teacher saw term stats';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: term stats are for Pathshala staff';
end $$;
commit;

-- =================================================================== 18. people_list and directory_listing
update app.people set is_verified = true, expertise_opt_in = true, expertise_tags = '{medicine}', expertise_headline = 'Pediatrician'
 where id = '30000000-0000-4000-8000-000000000001';
update app.people set expertise_opt_in = true where id = '30000000-0000-4000-8000-000000000002';   -- Rahul: not verified
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';  -- treasurer (people.view)
select pg_temp.assert((select date_of_birth is null and is_minor and age = 14 and relationship = 'child' and household_label = 'Shah family'
                         from app.people_list(:jsh, 'Dev Shah') where first_name = 'Dev'),
                      'people list masks a minor''s date of birth but shows age, household and relationship');
select pg_temp.assert((select date_of_birth = '1985-03-14' and on_app from app.people_list(:jsh, 'priya') where first_name = 'Priya'),
                      'adults show their date of birth; on_app reflects a linked login');
select pg_temp.assert((select total_count from app.people_list(:jsh, null, 2, 0) limit 1) > 2
                      and (select count(*) from app.people_list(:jsh, null, 2, 0)) = 2, 'people list pages with a total count');
select pg_temp.assert((select count(*) from app.directory_listing(:jsh) where name in ('Priya Shah', 'Rahul Shah')) = 2,
                      'staff see every directory opt-in, verified or not');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000005';  -- Kiran: a member
select pg_temp.assert((select string_agg(name, ',') from app.directory_listing(:jsh) where name in ('Priya Shah', 'Rahul Shah')) = 'Priya Shah'
                      and (select expertise_headline from app.directory_listing(:jsh) where name = 'Priya Shah') = 'Pediatrician',
                      'members see verified opt-ins with their expertise');
do $$ begin
  perform * from app.people_list('00000000-0000-4000-8000-000000000001', null, 10, 0);
  raise exception 'FAIL: a member listed people';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: the people list is for people.view holders';
end $$;
commit;

\echo 'PASS: parity schema tests'
