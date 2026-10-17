-- 0892 · DonorDelight slice 5, part 2: "Your 5 this week" (docs/DONORDELIGHT.md sections 5.6, 5.8, 7 and 13; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Households enter playbooks (0891) when something is true of them, and each playbook step then becomes a task for the household's
--   relationship owner (or backup): the week's list holds 3 to 5 of them, each with why, a ready draft and one tap to say it is done.
--   app.care_runs         a household's time in one playbook: the day it started (anchor_on), active, done or stopped. Opened by app._care_runs_sync,
--                         at most once a day per community (and when a playbook changes): no trigger on payments or households, the money path is untouched.
--   app.care_task_marks   a step done (the touch it recorded) or set aside with a reason; one per run and step; kept, never deleted.
--   app._care_trigger_rows   who is in which trigger right now, from the records Weaver already holds: first_gift (first gift ever, no earlier history),
--       new_household, steady, cooling, at_risk, lapsed (the SAME arithmetic as app.care_health_facts and src/lib/care/health.ts: lapsed = nothing for 18
--       months; at risk = gave the year before and not in the last 12; cooling = fewer gifts or none for six months; steady = as many as before; none of
--       these before about a year of records), volunteer_no_gift, giver_no_part, pledge_due (a pledge with a balance falls due; fees only if the thank-you
--       rules count them), monthly_giver (an active monthly recurring gift). Adults only: a child's attendance, shift or gift never counts.
--   app._care_week_rows(center, user)   the tasks for one person: their households only; open thank-yous first (an overdue one, then the steps overdue, then those
--       due), then what falls due in the next 7 days; a step more than 21 days overdue is not offered again; a household that asked for no thanks gets no
--       thank-you task. A household whose sign stops applying (it gave again) stops its playbook, so no one calls to say "we miss you" after a gift.
--   app.care_week(center)               the caller's week: up to 5 tasks, the total, how many are overdue, and (for a manager) the households that need an owner
--   app.care_week_counts(center)        two numbers for Today (tasks, overdue), no names
--   app.complete_care_task(run, step, channel?, note?)   one tap: records the touch (no ask) for the step and marks it done
--   app.skip_care_task(run, step, reason)                set it aside with a reason (kept)
--   WHO SEES WHICH. Tasks come only from households the person owns or backs up (care.own and up); no amount is read; no one under 18 is named; every read is
--   logged (who, when, how many, never names); a platform admin and a non-holder get "You don't have access to this area".
set client_min_messages = warning;

-- ── Runs and marks ────────────────────────────────────────────────────────────
create table if not exists app.care_runs (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  household_id   uuid not null references app.households(id) on delete no action,
  playbook_id    uuid not null references app.care_playbooks(id) on delete no action,
  anchor_on      date not null,
  status         text not null default 'active' check (status in ('active', 'done', 'stopped')),
  stopped_reason text check (stopped_reason is null or char_length(stopped_reason) <= 200),
  created_at     timestamptz not null default now(),
  ended_at       timestamptz,
  unique (household_id, playbook_id, anchor_on)
);
create index if not exists care_runs_center_idx on app.care_runs (center_id, status);
create index if not exists care_runs_household_idx on app.care_runs (household_id, status);
comment on table app.care_runs is
  'DonorDelight (0892): a household''s time in one playbook (the day it started, active, done or stopped). Opened and closed only by app._care_runs_sync; read with app.care_household_can. Never deleted: a household with a run cannot be deleted (it is merged instead).';

create table if not exists app.care_task_marks (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  household_id uuid not null references app.households(id) on delete no action,
  run_id       uuid not null references app.care_runs(id) on delete no action,
  step_id      uuid not null references app.care_playbook_steps(id) on delete no action,
  status       text not null check (status in ('done', 'skipped')),
  touch_id     uuid references app.care_touches(id) on delete no action,
  note         text check (note is null or char_length(btrim(note)) between 1 and 500),
  by_user_id   uuid references auth.users(id) on delete set null,
  marked_at    timestamptz not null default now(),
  unique (run_id, step_id),
  constraint care_task_marks_done_has_touch check (status <> 'done' or touch_id is not null),
  constraint care_task_marks_skipped_has_reason check (status <> 'skipped' or note is not null)
);
create index if not exists care_task_marks_household_idx on app.care_task_marks (household_id);
comment on table app.care_task_marks is
  'DonorDelight (0892): a playbook step done (with the touch it recorded) or set aside with a reason. One per run and step. Written only by app.complete_care_task / app.skip_care_task.';

create table if not exists app.care_sync_state (
  center_id uuid primary key references app.centers(id) on delete cascade,
  synced_on date not null,
  synced_at timestamptz not null default now()
);
comment on table app.care_sync_state is 'DonorDelight (0892): the day playbook runs were last opened for a community (bookkeeping; no care data).';

drop trigger if exists audit_care_runs on app.care_runs;
create trigger audit_care_runs after insert or update or delete on app.care_runs
  for each row execute function app.audit_private_row('care');
drop trigger if exists audit_care_sync_state on app.care_sync_state;
create trigger audit_care_sync_state after insert or update or delete on app.care_sync_state
  for each row execute function app.audit_private_row('care', 'center_id');
drop trigger if exists audit_care_task_marks on app.care_task_marks;
create trigger audit_care_task_marks after insert or update or delete on app.care_task_marks
  for each row execute function app.audit_private_row('care');
insert into app.module_tables (table_name, module_key) values ('care_runs', 'care'), ('care_task_marks', 'care'), ('care_sync_state', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.care_runs enable row level security;
alter table app.care_task_marks enable row level security;
alter table app.care_sync_state enable row level security;
drop policy if exists care_runs_read on app.care_runs;
create policy care_runs_read on app.care_runs for select to authenticated
  using (center_id = any ((select app.care_view_centers())::uuid[]) or household_id = any ((select app.care_my_households())::uuid[]));
drop policy if exists care_task_marks_read on app.care_task_marks;
create policy care_task_marks_read on app.care_task_marks for select to authenticated
  using (center_id = any ((select app.care_view_centers())::uuid[]) or household_id = any ((select app.care_my_households())::uuid[]));
drop policy if exists module_switch on app.care_runs;
create policy module_switch on app.care_runs as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
drop policy if exists module_switch on app.care_task_marks;
create policy module_switch on app.care_task_marks as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
drop policy if exists module_switch on app.care_sync_state;
create policy module_switch on app.care_sync_state as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_runs, app.care_task_marks, app.care_sync_state from public, anon, authenticated;
grant select on app.care_runs, app.care_task_marks to authenticated;
grant all on app.care_runs, app.care_task_marks, app.care_sync_state to service_role;

-- Care records never disappear with a household: a household with a run, a mark or a touch cannot be deleted (0760's rule, extended).
-- (on delete no action on the foreign keys above already refuses it; the portal says so in words through the existing guard.)

-- ── Who is in which trigger right now ─────────────────────────────────────────
-- (trigger_key, household, event_on): event_on is the day it happened for first_gift (the first gift), new_household (the day it was added) and
-- pledge_due (the earliest due day); today for the sign-based triggers. The sync applies each playbook's own window. Private: no caller reads it.
create or replace function app._care_trigger_rows(p_center uuid) returns table (trigger_key text, household_id uuid, event_on date)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_today date; v_tz text; v_giving boolean; v_events boolean; v_vol boolean; v_hist integer; v_fees boolean;
begin
  v_today := app._care_today(p_center);
  v_tz := coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'America/Chicago');
  v_giving := app.module_enabled(p_center, 'giving');
  v_events := app._care_source_on(p_center, 'attendees');
  v_vol := app._care_source_on(p_center, 'volunteer_assignments');
  v_hist := app._care_history_months(p_center);
  v_fees := coalesce((select s.count_fees from app.care_settings s where s.center_id = p_center), false);
  return query
  with hh as (
    select h.id as hid, (h.created_at at time zone v_tz)::date as created_on
      from app.households h where h.center_id = p_center and h.merged_into_id is null
  ),
  gifts as (
    select g.household_id as hid,
           count(*) filter (where g.received_on > v_today - 365 and g.received_on <= v_today) as g12,
           count(*) filter (where g.received_on > v_today - 730 and g.received_on <= v_today - 365) as gprev,
           min(g.received_on) as first_on, max(g.received_on) filter (where g.received_on <= v_today) as last_on
      from app._care_gifts(p_center) g
     where v_giving
     group by g.household_id
  ),
  adults as (
    select hm.household_id as hid, hm.person_id, coalesce(hm.joined_at, '-infinity'::date) as from_day, coalesce(hm.left_at, 'infinity'::date) as to_day
      from app.household_members hm join hh on hh.hid = hm.household_id
     where not app.person_is_minor(hm.person_id)
  ),
  part as (
    select a.hid, (a2.checked_in_at at time zone v_tz)::date as day, false as is_vol
      from app.attendees a2 join adults a on a.person_id = a2.person_id
     where v_events and a2.center_id = p_center and a2.checked_in_at is not null and not a2.is_child_under_12
       and (a2.checked_in_at at time zone v_tz)::date between a.from_day and a.to_day
    union all
    select a.hid, (coalesce(vs.starts_at, va.created_at) at time zone v_tz)::date, true
      from app.volunteer_assignments va
      join adults a on a.person_id = va.person_id
      join app.volunteer_shifts vs on vs.id = va.shift_id
     where v_vol and va.center_id = p_center
       and (va.status = 'completed' or (va.status = 'confirmed' and coalesce(vs.ends_at, vs.starts_at) < now()))
       and (coalesce(vs.starts_at, va.created_at) at time zone v_tz)::date between a.from_day and a.to_day
  ),
  ps as (
    select p.hid, count(*) filter (where p.day > v_today - 365 and p.day <= v_today) as p12,
           count(*) filter (where p.is_vol and p.day > v_today - 365 and p.day <= v_today) as v12,
           max(p.day) filter (where p.day <= v_today) as last_part
      from part p group by p.hid
  ),
  f as (
    select hh.hid, hh.created_on, coalesce(g.g12, 0) as g12, coalesce(g.gprev, 0) as gprev, g.first_on, g.last_on,
           coalesce(ps.p12, 0) as p12, coalesce(ps.v12, 0) as v12, greatest(g.last_on, ps.last_part) as last_any
      from hh left join gifts g on g.hid = hh.hid left join ps on ps.hid = hh.hid
  ),
  c as (
    select f.*, (f.last_any is not null and v_today - f.last_any > 548) as lapsed,
           (v_giving and f.last_any is not null and v_today - f.last_any <= 548 and f.gprev > 0 and f.g12 = 0) as at_risk
      from f
  ),
  d as (
    select c.*, (v_giving and c.last_any is not null and not c.lapsed and not c.at_risk and c.g12 > 0
                 and (c.g12 < c.gprev or v_today - c.last_on > 183)) as cooling
      from c
  )
  select 'first_gift'::text, d.hid, d.first_on from d
   where v_giving and d.first_on > v_today - 365 and d.first_on <= v_today
     and not exists (select 1 from app.payments p where p.household_id = d.hid and (p.is_historical or p.is_opening_balance))
  union all select 'new_household', d.hid, d.created_on from d where d.created_on > v_today - 365
  union all select 'steady', d.hid, v_today from d
   where v_hist >= 11 and v_giving and d.last_any is not null and not d.lapsed and not d.at_risk and not d.cooling and d.g12 > 0 and d.g12 >= d.gprev
  union all select 'cooling', d.hid, v_today from d where v_hist >= 11 and d.cooling
  union all select 'at_risk', d.hid, v_today from d where v_hist >= 11 and d.at_risk
  union all select 'lapsed', d.hid, v_today from d where v_hist >= 11 and d.lapsed
  union all select 'volunteer_no_gift', d.hid, v_today from d where v_giving and v_vol and d.v12 >= 2 and d.g12 + d.gprev = 0
  union all select 'giver_no_part', d.hid, v_today from d where v_giving and (v_events or v_vol) and d.g12 >= 1 and d.p12 = 0
  union all
  select 'pledge_due', pl.household_id, min(pl.due_on)
    from app.pledges pl join hh on hh.hid = pl.household_id
   where v_giving and pl.center_id = p_center and pl.status in ('open', 'partially_paid') and pl.paid_cents < pl.amount_cents
     and pl.due_on is not null and pl.due_on >= v_today
     and (v_fees or pl.source::text not in ('membership_fee', 'pathshala_fee', 'store'))
   group by pl.household_id
  union all
  select 'monthly_giver', r.household_id, v_today
    from app.recurring_gifts r join hh on hh.hid = r.household_id
   where v_giving and r.center_id = p_center and r.status = 'active' and r.frequency = 'monthly'
   group by r.household_id;
end $$;
revoke execute on function app._care_trigger_rows(uuid) from public, anon, authenticated;

-- ── Opening and closing runs ──────────────────────────────────────────────────
-- Idempotent; runs at most once a day per community unless a playbook or a step changed since. Nothing before DonorDelight is on.
create or replace function app._care_runs_sync(p_center uuid, p_force boolean default false) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_today date; st app.care_sync_state; pb app.care_playbooks; v_n integer := 0; v_new integer;
begin
  if not app._org_private_module_on(p_center, 'care') then return 0; end if;
  v_today := app._care_today(p_center);
  -- One sync at a time per community; whoever waits then finds it done and returns.
  perform pg_advisory_xact_lock(hashtextextended('care_runs_sync:' || p_center::text, 0));
  select * into st from app.care_sync_state where center_id = p_center;
  if not coalesce(p_force, false) and st.center_id is not null and st.synced_on = v_today
     and not exists (select 1 from app.care_playbooks x where x.center_id = p_center and x.updated_at > st.synced_at)
     and not exists (select 1 from app.care_playbook_steps x where x.center_id = p_center and x.updated_at > st.synced_at) then
    return 0;
  end if;
  create temp table if not exists _care_trig (trigger_key text, household_id uuid, event_on date) on commit drop;
  truncate _care_trig;
  insert into _care_trig select * from app._care_trigger_rows(p_center);

  for pb in select * from app.care_playbooks x where x.center_id = p_center and x.enabled order by x.sort, x.id loop
    insert into app.care_runs (center_id, household_id, playbook_id, anchor_on)
    select p_center, t.household_id, pb.id, case when pb.trigger_key in ('first_gift', 'new_household') then t.event_on else v_today end
      from _care_trig t
     where t.trigger_key = pb.trigger_key
       and (pb.trigger_key not in ('first_gift', 'new_household') or t.event_on >= v_today - pb.window_days)
       and (pb.trigger_key <> 'pledge_due' or t.event_on <= v_today + pb.window_days)
       and not exists (select 1 from app.care_runs r
                        where r.household_id = t.household_id and r.playbook_id = pb.id and r.created_at > now() - make_interval(days => pb.cooldown_days))
    on conflict (household_id, playbook_id, anchor_on) do nothing;
    get diagnostics v_new = row_count;
    v_n := v_n + v_new;
    -- A sign-based playbook stops when the sign stops applying (the household gave again, took part, paid): nobody calls to say "we miss you" after a gift.
    if pb.trigger_key not in ('first_gift', 'new_household') then
      update app.care_runs r set status = 'stopped', stopped_reason = 'It no longer applies to this household.', ended_at = now()
       where r.center_id = p_center and r.playbook_id = pb.id and r.status = 'active'
         and not exists (select 1 from _care_trig t
                          where t.trigger_key = pb.trigger_key and t.household_id = r.household_id
                            and (pb.trigger_key <> 'pledge_due' or t.event_on <= v_today + pb.window_days));
    end if;
  end loop;

  -- A run with nothing left to do (every step done, set aside, archived or more than 21 days overdue) is finished.
  update app.care_runs r set status = 'done', ended_at = now()
   where r.center_id = p_center and r.status = 'active'
     and not exists (select 1 from app.care_playbook_steps s
                      where s.playbook_id = r.playbook_id and s.archived_at is null and r.anchor_on + s.after_days >= v_today - 21
                        and not exists (select 1 from app.care_task_marks m where m.run_id = r.id and m.step_id = s.id));

  insert into app.care_sync_state (center_id, synced_on, synced_at) values (p_center, v_today, now())
  on conflict (center_id) do update set synced_on = excluded.synced_on, synced_at = excluded.synced_at;
  return v_n;
end $$;
revoke execute on function app._care_runs_sync(uuid, boolean) from public, anon, authenticated;

-- ── One person's tasks ────────────────────────────────────────────────────────
-- Private: the readers below check access first. rank: 0 an overdue thank-you, 1 a step overdue, 2 a thank-you due, 3 a step due in the next 7 days.
drop function if exists app._care_week_rows(uuid, uuid);
create or replace function app._care_week_rows(p_center uuid, p_user uuid)
returns table (task_kind text, run_id uuid, step_id uuid, thank_id uuid, household_id uuid, due_on date, overdue boolean, rank integer,
               title text, why text, touch_kind text, channel text, draft text, personal boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_today date; v_giving boolean; v_thanks boolean;
begin
  if p_user is null or not app._care_holder(p_center, p_user) then return; end if;
  v_today := app._care_today(p_center);
  v_giving := app.module_enabled(p_center, 'giving');
  v_thanks := v_giving and exists (select 1 from app.care_settings s where s.center_id = p_center);
  return query
  with mine as (
    select o.household_id as hid from app.care_owners o
     where o.center_id = p_center and (o.owner_user_id = p_user or o.backup_user_id = p_user)
  ),
  steps as (
    select 'step'::text as task_kind, r.id as run_id, s.id as step_id, null::uuid as thank_id, r.household_id as household_id,
           (r.anchor_on + s.after_days) as due_on, (r.anchor_on + s.after_days) < v_today as overdue,
           case when (r.anchor_on + s.after_days) < v_today then 1 else 3 end as rank,
           s.title, s.why, s.kind as touch_kind, coalesce(s.channel, cp.channel, 'phone') as channel, s.draft, false as personal
      from app.care_runs r
      join app.care_playbooks pb on pb.id = r.playbook_id and pb.enabled
      join app.care_playbook_steps s on s.playbook_id = pb.id and s.archived_at is null
      left join app.care_profiles cp on cp.household_id = r.household_id
     where r.center_id = p_center and r.status = 'active' and r.household_id in (select hid from mine)
       and r.anchor_on + s.after_days <= v_today + 6 and r.anchor_on + s.after_days >= v_today - 21
       and not exists (select 1 from app.care_task_marks m where m.run_id = r.id and m.step_id = s.id)
       and (s.kind <> 'thank_you' or cp.thanks is distinct from 'none')
  ),
  thanks as (
    select 'thank'::text, null::uuid, null::uuid, t.id, p.household_id, t.due_on, t.due_on < v_today,
           case when t.due_on < v_today then 0 else 2 end,
           'Thank them for their gift'::text,
           ('Their gift of ' || to_char(t.gift_on, 'FMMonth FMDD') || ' has not been thanked yet'
              || case when t.needs_personal then ', and it needs a personal thank-you (a call, a visit or a card)' else '' end || '.')::text,
           'thank_you'::text,
           coalesce(case cp.thanks when 'call' then 'phone' when 'card' then 'post' when 'in_person' then 'in_person' when 'message' then coalesce(cp.channel, 'text') end,
                    cp.channel, 'phone')::text,
           case when t.needs_personal
                then 'Hello {{name}}, this is {{me}} from {{org}}. I wanted to thank you personally for your gift. It means a great deal to us.'
                else 'Dear {{name}}, thank you for your gift to {{org}}. We are grateful. {{me}}' end,
           t.needs_personal
      from app.care_thanks t
      join app.payments p on p.id = t.payment_id
      left join app._care_thanked(p_center) th on th.thank_id = t.id
      left join app.care_profiles cp on cp.household_id = p.household_id
     where v_thanks and t.center_id = p_center and t.set_aside_at is null and th.thanked_at is null
       and p.household_id in (select hid from mine) and cp.thanks is distinct from 'none'
  )
  select * from steps union all select * from thanks;
end $$;
revoke execute on function app._care_week_rows(uuid, uuid) from public, anon, authenticated;

-- The first name to use for a household: the adult to reach first (the care profile), else its primary adult. Adults only.
create or replace function app._care_contact_first_name(p_household uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name)
    from app.people pe
   where pe.id = coalesce((select cp.contact_person_id from app.care_profiles cp where cp.household_id = p_household),
                          (select a.person_id from app._care_adults(p_household) a limit 1))
     and not app.person_is_minor(pe.id)
$$;
revoke execute on function app._care_contact_first_name(uuid) from public, anon, authenticated;

-- ── The caller's week ─────────────────────────────────────────────────────────
create or replace function app.care_week(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_today date; v_rows jsonb; v_total integer; v_overdue integer; v_needs integer := 0; v_me text; v_org text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  perform app._care_thanks_sync(p_center);
  perform app._care_runs_sync(p_center);
  v_today := app._care_today(p_center);
  select coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) into v_me
    from app.center_users cu join app.people p on p.id = cu.person_id where cu.center_id = p_center and cu.user_id = auth.uid() limit 1;
  select coalesce(nullif(btrim(c.short_name), ''), c.name) into v_org from app.centers c where c.id = p_center;

  with t as (select * from app._care_week_rows(p_center, auth.uid())),
  ranked as (select t.*, row_number() over (order by t.rank, t.due_on, t.household_id, t.step_id, t.thank_id) as rn from t),
  shown as (select * from ranked r where r.rn <= 5)
  select (select count(*) from t), (select count(*) filter (where t.overdue) from t),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'kind', s.task_kind, 'run_id', s.run_id, 'step_id', s.step_id, 'thank_id', s.thank_id,
                   'household', app._care_household_head(s.household_id), 'contact', app._care_contact_first_name(s.household_id),
                   'due_on', s.due_on, 'overdue', s.overdue, 'title', s.title, 'why', s.why, 'touch_kind', s.touch_kind,
                   'channel', s.channel, 'draft', s.draft, 'personal', s.personal) order by s.rn), '[]'::jsonb) from shown s)
    into v_total, v_overdue, v_rows;

  -- A manager also hears about households whose playbook has a task due but nobody to do it.
  if app.care_can(p_center, 'view') then
    select count(distinct r.household_id) into v_needs
      from app.care_runs r join app.care_playbooks pb on pb.id = r.playbook_id and pb.enabled
      join app.care_playbook_steps s on s.playbook_id = pb.id and s.archived_at is null
      left join app.care_owners o on o.household_id = r.household_id
     where r.center_id = p_center and r.status = 'active'
       and r.anchor_on + s.after_days <= v_today + 6 and r.anchor_on + s.after_days >= v_today - 21
       and not exists (select 1 from app.care_task_marks m where m.run_id = r.id and m.step_id = s.id)
       and (o.owner_user_id is null or not app._care_holder(p_center, o.owner_user_id))
       and (o.backup_user_id is null or not app._care_holder(p_center, o.backup_user_id));
  end if;

  perform app.log_private_read(p_center, 'care', 'week', jsonb_array_length(v_rows));
  return jsonb_build_object('state', 'ok', 'today', v_today, 'total', v_total, 'overdue', v_overdue, 'tasks', v_rows, 'needs_owner', v_needs,
                            'me', v_me, 'org', v_org, 'label', app._module_label(p_center, 'care'),
                            'playbooks', (select count(*) from app.care_playbooks x where x.center_id = p_center and x.enabled));
end $$;

-- Two numbers for Today and Home (no names, not logged).
create or replace function app.care_week_counts(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_total integer; v_overdue integer;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  perform app._care_thanks_sync(p_center);
  perform app._care_runs_sync(p_center);
  select count(*), count(*) filter (where t.overdue) into v_total, v_overdue from app._care_week_rows(p_center, auth.uid()) t;
  return jsonb_build_object('state', 'ok', 'tasks', v_total, 'overdue', v_overdue);
end $$;

-- ── Done and set aside ────────────────────────────────────────────────────────
create or replace function app._care_task_for(p_run uuid, p_step uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.care_runs;
begin
  select * into r from app.care_runs x where x.id = p_run for update;
  if r.id is null then raise exception 'That task was not found.' using errcode = 'P0002'; end if;
  perform app._care_household_or_raise(r.household_id);
  if not exists (select 1 from app.care_playbook_steps x where x.id = p_step and x.playbook_id = r.playbook_id) then
    raise exception 'That task was not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from app.care_task_marks m where m.run_id = r.id and m.step_id = p_step) then
    raise exception 'That task is already done or set aside.' using errcode = '23505';
  end if;
end $$;
revoke execute on function app._care_task_for(uuid, uuid) from public, anon, authenticated;

create or replace function app.complete_care_task(p_run uuid, p_step uuid, p_channel text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.care_runs; s app.care_playbook_steps; v_touch uuid; v_channel text; v_note text;
begin
  perform app._care_task_for(p_run, p_step);
  select * into r from app.care_runs x where x.id = p_run;
  select * into s from app.care_playbook_steps x where x.id = p_step;
  v_channel := coalesce(nullif(btrim(coalesce(p_channel, '')), ''), s.channel, (select cp.channel from app.care_profiles cp where cp.household_id = r.household_id), 'phone');
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'A touch note is at most 1,000 characters.' using errcode = '23514'; end if;
  perform app.set_audit_context('Care task done');
  -- The touch is recorded by the same rules as any touch (no ask: a playbook step never asks).
  v_touch := app.log_care_touch(r.household_id, jsonb_strip_nulls(jsonb_build_object('kind', s.kind, 'channel', v_channel, 'outcome', 'done', 'is_ask', false, 'note', v_note)));
  insert into app.care_task_marks (center_id, household_id, run_id, step_id, status, touch_id, by_user_id)
  values (r.center_id, r.household_id, r.id, s.id, 'done', v_touch, auth.uid());
  return jsonb_build_object('touch_id', v_touch);
end $$;

create or replace function app.skip_care_task(p_run uuid, p_step uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.care_runs; s app.care_playbook_steps; v_reason text;
begin
  perform app._care_task_for(p_run, p_step);
  select * into r from app.care_runs x where x.id = p_run;
  select * into s from app.care_playbook_steps x where x.id = p_step;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'Say why this task is set aside. The reason is kept.' using errcode = '23514'; end if;
  if char_length(v_reason) > 500 then raise exception 'The reason is at most 500 characters.' using errcode = '23514'; end if;
  perform app.set_audit_context('Care task set aside');
  insert into app.care_task_marks (center_id, household_id, run_id, step_id, status, note, by_user_id)
  values (r.center_id, r.household_id, r.id, s.id, 'skipped', v_reason, auth.uid());
end $$;

revoke execute on function app.care_week(uuid), app.care_week_counts(uuid), app.complete_care_task(uuid, uuid, text, text),
  app.skip_care_task(uuid, uuid, text) from public, anon;
grant execute on function app.care_week(uuid), app.care_week_counts(uuid), app.complete_care_task(uuid, uuid, text, text),
  app.skip_care_task(uuid, uuid, text) to authenticated, service_role;
