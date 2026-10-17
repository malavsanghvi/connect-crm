-- 0893 · DonorDelight slice 5, part 3: the weekly reminder to relationship owners (docs/DONORDELIGHT.md sections 5.8 and 13; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Once a week each person who owns (or backs up) households is told how many care tasks wait for them, and nothing else: the message holds a NUMBER and
--   the name of the section, never a household, a name, a reason or a draft (an email is not a private place). It goes only through the existing
--   messaging path (app.enqueue_message: the sandbox's verified recipients, suppressions, unsubscribes, the deceased rule and the send-time re-check all
--   apply), and Weaver sends nothing else. Off until the community's care manager switches it on.
--   app.care_week_settings     per community: notify yes or no (default no), and the day of the week (0 Sunday to 6 Saturday; default Monday)
--   app.care_week_settings_get(center) / app.save_care_week_settings(center, notify, dow)   read: any care key; change: care.manage
--   app.care_week_log          one row per person and week: how many tasks, what happened (queued, refused with the reason, no email address), so a week is
--                              never told twice and a refusal is shown, never hidden
--   app.worker_care_week_sweep(limit)   the worker role only (job care.week_sweep, every hour): for each community that switched it on, from the chosen day
--                              at 08:00 local time (and for two days after, in case the service was down), tell each person with at least one task, once
--   Template care_week (email), platform default, editable per community in Communications. A person with no tasks is not told.
set client_min_messages = warning;

create table if not exists app.care_week_settings (
  center_id  uuid primary key references app.centers(id) on delete cascade,
  notify     boolean not null default false,
  notify_dow smallint not null default 1 check (notify_dow between 0 and 6),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table app.care_week_settings is
  'DonorDelight (0893): whether relationship owners get a weekly "N care tasks" message, and on which weekday. Written only by app.save_care_week_settings (care.manage).';

create table if not exists app.care_week_log (
  center_id  uuid not null references app.centers(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  tasks      integer not null check (tasks >= 0),
  outcome    text not null check (outcome in ('queued', 'refused', 'no_email')),
  reason     text check (reason is null or char_length(reason) <= 300),
  message_id uuid,
  created_at timestamptz not null default now(),
  primary key (center_id, user_id, week_start)
);
comment on table app.care_week_log is
  'DonorDelight (0893): who was told about their week and what happened (queued, refused with the reason, no email address). Written only by app.worker_care_week_sweep; the message never held a name.';

drop trigger if exists audit_care_week_settings on app.care_week_settings;
create trigger audit_care_week_settings after insert or update or delete on app.care_week_settings
  for each row execute function app.audit_private_row('care', 'center_id');
drop trigger if exists audit_care_week_log on app.care_week_log;
create trigger audit_care_week_log after insert or update or delete on app.care_week_log
  for each row execute function app.audit_private_row('care', 'center_id', 'user_id', 'week_start');
insert into app.module_tables (table_name, module_key) values ('care_week_settings', 'care'), ('care_week_log', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.care_week_settings enable row level security;
alter table app.care_week_log enable row level security;
drop policy if exists care_week_settings_read on app.care_week_settings;
create policy care_week_settings_read on app.care_week_settings for select to authenticated using (app.care_can(center_id, 'own'));
drop policy if exists care_week_log_read on app.care_week_log;
create policy care_week_log_read on app.care_week_log for select to authenticated using (center_id = any ((select app.care_view_centers())::uuid[]));
drop policy if exists module_switch on app.care_week_settings;
create policy module_switch on app.care_week_settings as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
drop policy if exists module_switch on app.care_week_log;
create policy module_switch on app.care_week_log as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_week_settings, app.care_week_log from public, anon, authenticated;
grant select on app.care_week_settings, app.care_week_log to authenticated;
grant all on app.care_week_settings, app.care_week_log to service_role;

create or replace function app.care_week_settings_get(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_week_settings;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  select * into s from app.care_week_settings where center_id = p_center;
  return jsonb_build_object('notify', coalesce(s.notify, false), 'notify_dow', coalesce(s.notify_dow, 1), 'can_manage', app.care_can(p_center, 'manage'));
end $$;

create or replace function app.save_care_week_settings(p_center uuid, p_notify boolean, p_dow integer) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  if p_notify is null then raise exception 'Say whether the weekly reminder is on or off.' using errcode = '22023'; end if;
  if p_dow is null or p_dow < 0 or p_dow > 6 then raise exception 'Choose the day of the week.' using errcode = '23514'; end if;
  perform app.set_audit_context('Care weekly reminder settings saved');
  insert into app.care_week_settings (center_id, notify, notify_dow, updated_by) values (p_center, p_notify, p_dow::smallint, auth.uid())
  on conflict (center_id) do update set notify = excluded.notify, notify_dow = excluded.notify_dow, updated_at = now(), updated_by = auth.uid();
  return app.care_week_settings_get(p_center);
end $$;

-- ── The template (a number, never a name) ─────────────────────────────────────
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('care_week', 'email', '{{label}}: {{count}} to do this week',
   E'Hello,\n\nYour week in {{label}} at {{center_name}}: {{count}} to do, {{overdue}} of them overdue. Open {{label}} in the portal to see them, each with a draft.\n\nThis message holds a number only: no names, no notes. Only the roles your organization chooses can see {{label}}.\n\nThe Weaver team')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ── The sweep (job care.week_sweep, every hour) ───────────────────────────────
create or replace function app.worker_care_week_sweep(p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c record; u record; v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000)); v_done integer := 0; v_queued integer := 0; v_refused integer := 0;
  v_noemail integer := 0; v_centers integer := 0; v_more boolean := false; v_local timestamp; v_since integer; v_week date; v_tasks integer; v_over integer;
  v_email text; v_id uuid; v_reason text; v_label text; v_name text; v_q integer; v_r integer; v_n integer;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  for c in select s.center_id, s.notify_dow, ce.time_zone, ce.name, coalesce(nullif(btrim(ce.short_name), ''), ce.name) as short_name
             from app.care_week_settings s join app.centers ce on ce.id = s.center_id
            where s.notify and ce.status = 'active' and app._org_private_module_on(s.center_id, 'care')
            order by s.center_id loop
    begin
      v_local := now() at time zone coalesce(nullif(c.time_zone, ''), 'America/Chicago');
    exception when others then continue;
    end;
    v_since := (extract(dow from v_local)::int - c.notify_dow + 7) % 7;
    if v_since > 2 or (v_since = 0 and extract(hour from v_local) < 8) then continue; end if;
    v_week := v_local::date - v_since;
    v_centers := v_centers + 1;
    v_q := 0; v_r := 0; v_n := 0;
    perform app._care_thanks_sync(c.center_id);
    perform app._care_runs_sync(c.center_id);
    v_label := app._module_label(c.center_id, 'care');
    for u in select distinct x.uid
               from (select o.user_id as uid from app.center_owners o where o.center_id = c.center_id
                     union select g.user_id from app.role_grants g where g.center_id = c.center_id and g.status = 'active') x
              where app._care_holder(c.center_id, x.uid)
                and not exists (select 1 from app.care_week_log l where l.center_id = c.center_id and l.user_id = x.uid and l.week_start = v_week)
              order by x.uid loop
      if v_done >= v_limit then v_more := true; exit; end if;
      select count(*), count(*) filter (where t.overdue) into v_tasks, v_over from app._care_week_rows(c.center_id, u.uid) t;
      if v_tasks = 0 then continue; end if;
      v_done := v_done + 1;
      select au.email into v_email from auth.users au where au.id = u.uid;
      if v_email is null or btrim(v_email) = '' then
        insert into app.care_week_log (center_id, user_id, week_start, tasks, outcome, reason) values (c.center_id, u.uid, v_week, v_tasks, 'no_email', 'This person has no email address.');
        v_noemail := v_noemail + 1; v_n := v_n + 1;
        continue;
      end if;
      begin
        v_id := app.enqueue_message(c.center_id, 'email', v_email, 'care_week',
                                    jsonb_build_object('count', v_tasks, 'overdue', v_over, 'label', v_label, 'center_name', c.short_name), 'notification');
        insert into app.care_week_log (center_id, user_id, week_start, tasks, outcome, message_id) values (c.center_id, u.uid, v_week, v_tasks, 'queued', v_id);
        v_queued := v_queued + 1; v_q := v_q + 1;
      exception when others then
        v_reason := left(sqlerrm, 300);
        insert into app.care_week_log (center_id, user_id, week_start, tasks, outcome, reason) values (c.center_id, u.uid, v_week, v_tasks, 'refused', v_reason);
        v_refused := v_refused + 1; v_r := v_r + 1;
      end;
    end loop;
    if v_q + v_r + v_n > 0 then
      perform app.log_private_audit('care', c.center_id, 'care.week_notified', 'care_week_log', v_week::text,
        jsonb_build_object('queued', v_q, 'refused', v_r, 'no_email', v_n), 'Weekly relationship-care reminders: a number only, no names');
    end if;
    exit when v_more;
  end loop;
  return jsonb_build_object('centers', v_centers, 'queued', v_queued, 'refused', v_refused, 'no_email', v_noemail, 'more', v_more);
end $$;

revoke execute on function app.care_week_settings_get(uuid), app.save_care_week_settings(uuid, boolean, integer) from public, anon;
grant execute on function app.care_week_settings_get(uuid), app.save_care_week_settings(uuid, boolean, integer) to authenticated, service_role;
revoke execute on function app.worker_care_week_sweep(integer) from public, anon, authenticated, service_role;
grant execute on function app.worker_care_week_sweep(integer) to connect_worker;
comment on function app.worker_care_week_sweep(integer) is
  'The worker role only (job care.week_sweep, hourly, 0893): for each community that switched the weekly reminder on, from the chosen weekday at 08:00 local time (and for two days after), tells each person with at least one care task how many there are (a number, never a name) through app.enqueue_message, once per person and week (app.care_week_log). A refusal is logged with its reason. Returns {centers, queued, refused, no_email, more}.';
