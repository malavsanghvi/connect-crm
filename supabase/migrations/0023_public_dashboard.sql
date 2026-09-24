-- 0023_public_dashboard.sql
-- 10. Public community dashboard: per-KPI publish setting and the prototype's
--     metrics (docs/PROTOTYPE_COMMUNITY_DASHBOARD.md, docs/parity/p3 §12).
--   * app.public_kpi_settings: which KPIs are shown to everyone ('public') and
--     which only to signed-in members of the center ('members', the default for
--     any KPI without a row — nothing becomes public until someone decides so).
--   * app.public_kpi_catalog(center): every KPI key with its label, section and
--     current visibility, for the settings screen.
--   * app.public_kpis(slug, from, to, campaign): now honours visibility, adds
--     deltas vs the previous period of the same length, attendance by month,
--     families by zone, learning and seva figures, volunteer hours and one
--     campaign's progress. Every count under 10 is still suppressed (null).

create table app.public_kpi_settings (
  center_id   uuid not null references app.centers(id) on delete cascade,
  kpi_key     text not null check (kpi_key in (
                'member_families','community_people','events_held','attendance','volunteer_hours','app_adoption',
                'samayik','pratikraman','navkar_malas','gyan_levels','gyan_steps','anumodana',
                'pathshala_students','volunteer_teachers','class_attendance_rate','store_orders',
                'attendance_by_month','families_by_zone','campaign')),
  visibility  text not null default 'members' check (visibility in ('public','members')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) default auth.uid(),
  primary key (center_id, kpi_key)
);
create trigger stamp_public_kpi_settings before insert or update on app.public_kpi_settings
  for each row execute function app.stamp_updated_by();
create trigger audit_public_kpi_settings after insert or update or delete on app.public_kpi_settings
  for each row execute function app.audit_row();
alter table app.public_kpi_settings enable row level security;
create policy public_kpi_settings_staff_read on app.public_kpi_settings for select to authenticated
  using (app.has_permission(center_id, 'reports.view') or app.has_permission(center_id, 'settings.manage'));
create policy public_kpi_settings_staff_write on app.public_kpi_settings for all to authenticated
  using (app.has_permission(center_id, 'settings.manage')) with check (app.has_permission(center_id, 'settings.manage'));
grant select, insert, update, delete on app.public_kpi_settings to authenticated;

create or replace function app.public_kpi_catalog(p_center uuid)
returns table (kpi_key text, label text, section text, visibility text)
language sql stable security definer set search_path = app, public, extensions as $$
  select k.key, k.label, k.section, coalesce(s.visibility, 'members')
    from (values
      ('member_families', 'Member families', 'summary', 1), ('community_people', 'Community members', 'summary', 2),
      ('events_held', 'Events held', 'summary', 3), ('attendance', 'Check-ins', 'summary', 4),
      ('volunteer_hours', 'Volunteer hours', 'summary', 5), ('app_adoption', 'Families on the app', 'summary', 6),
      ('samayik', 'Samayiks completed', 'practice', 7), ('pratikraman', 'Pratikramans', 'practice', 8),
      ('navkar_malas', 'Navkar malas', 'practice', 9), ('gyan_levels', 'Gyan Path levels completed', 'practice', 10),
      ('gyan_steps', 'Gyan Path steps completed', 'practice', 11), ('anumodana', 'Anumodanas sent', 'practice', 12),
      ('pathshala_students', 'Pathshala students', 'learning', 13), ('volunteer_teachers', 'Volunteer teachers', 'learning', 14),
      ('class_attendance_rate', 'Class attendance rate', 'learning', 15), ('store_orders', 'Satvik Store orders', 'seva', 16),
      ('attendance_by_month', 'Attendance by month', 'charts', 17), ('families_by_zone', 'Families by zone', 'charts', 18),
      ('campaign', 'Campaign progress', 'charts', 19)
    ) as k(key, label, section, ord)
    left join app.public_kpi_settings s on s.center_id = p_center and s.kpi_key = k.key
   where app.has_permission(p_center, 'reports.view') or app.has_permission(p_center, 'settings.manage')
   order by k.ord
$$;

-- Flow metrics for one center and date range (internal; suppression happens in public_kpis).
create or replace function app.kpi_flows(p_center uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'events_held', (select count(*) from app.events e where e.center_id = p_center and e.status in ('live','completed')
                      and (e.starts_at at time zone c.time_zone)::date between p_from and p_to),
    'attendance', (select count(*) from app.attendees a where a.center_id = p_center
                     and (a.checked_in_at at time zone c.time_zone)::date between p_from and p_to)
                + (select count(*) from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
                    where pa.center_id = p_center and pa.status in ('present','late') and s.held_on between p_from and p_to),
    'volunteer_hours', (select round(sum(extract(epoch from (sh.ends_at - sh.starts_at))) / 3600)::bigint
                          from app.volunteer_assignments va join app.volunteer_shifts sh on sh.id = va.shift_id
                         where va.center_id = p_center and va.status = 'completed' and sh.ends_at > sh.starts_at
                           and (sh.starts_at at time zone c.time_zone)::date between p_from and p_to),
    'volunteers', (select count(distinct va.person_id) from app.volunteer_assignments va join app.volunteer_shifts sh on sh.id = va.shift_id
                    where va.center_id = p_center and va.status = 'completed'
                      and (sh.starts_at at time zone c.time_zone)::date between p_from and p_to),
    'samayik', (select count(*) from app.practice_logs l join app.practices pr on pr.id = l.practice_id
                 where l.center_id = p_center and pr.key = 'samayik' and l.logged_on between p_from and p_to),
    'pratikraman', (select count(*) from app.practice_logs l join app.practices pr on pr.id = l.practice_id
                     where l.center_id = p_center and pr.key = 'pratikraman' and l.logged_on between p_from and p_to),
    'navkar_malas', (select count(*) from app.practice_logs l join app.practices pr on pr.id = l.practice_id
                      where l.center_id = p_center and pr.key = 'navkarvali' and l.logged_on between p_from and p_to),
    'gyan_levels', (select count(*) from app.gyan_signoffs g where g.center_id = p_center and g.status = 'approved'
                     and (g.decided_at at time zone c.time_zone)::date between p_from and p_to),
    'gyan_steps', (select count(*) from app.gyan_progress g where g.center_id = p_center
                    and (g.completed_at at time zone c.time_zone)::date between p_from and p_to),
    'anumodana', (select count(*) from app.anumodana a where a.center_id = p_center
                   and (a.created_at at time zone c.time_zone)::date between p_from and p_to),
    'store_orders', (select count(*) from app.store_orders o where o.center_id = p_center
                      and o.status in ('placed','preparing','ready','picked_up')
                      and (o.placed_at at time zone c.time_zone)::date between p_from and p_to),
    'class_sessions_marked', (select count(*) from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
                               where pa.center_id = p_center and s.held_on between p_from and p_to),
    'class_present', (select count(*) from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
                       where pa.center_id = p_center and pa.status in ('present','late') and s.held_on between p_from and p_to))
  from app.centers c where c.id = p_center
$$;

drop function app.public_kpis(text, date, date);
create function app.public_kpis(p_slug text, p_from date default date_trunc('year', current_date)::date,
                                p_to date default current_date, p_campaign text default null)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_center uuid; v_tz text; v_member boolean; v_len int; v_pfrom date; v_pto date;
  cur jsonb; prev jsonb; m jsonb := '{}'; d jsonb := '{}'; k text; v_out jsonb; v_public text[];
  v_families bigint; v_people bigint; v_on_app bigint; v_new_fam bigint; v_new_people bigint;
  v_students bigint; v_teachers bigint; v_start date; v_months jsonb; v_zones jsonb; v_camp jsonb;
  c record; v_donors bigint;
begin
  select id, time_zone into v_center, v_tz from app.centers where slug = p_slug and status = 'active';
  if v_center is null then return null; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception 'choose a valid period'; end if;
  v_member := app.is_member_of(v_center);
  select coalesce(array_agg(kpi_key), '{}') into v_public from app.public_kpi_settings
   where center_id = v_center and visibility = 'public';

  v_len := p_to - p_from + 1;
  v_pto := p_from - 1; v_pfrom := p_from - v_len;
  cur := app.kpi_flows(v_center, p_from, p_to);
  prev := app.kpi_flows(v_center, v_pfrom, v_pto);

  -- Stocks (point in time) and their "new this period".
  select count(distinct mb.household_id) into v_families from app.memberships mb
   where mb.center_id = v_center and mb.status = 'active' and mb.tier <> 'community';
  select count(*) into v_new_fam from (
    select mb.household_id from app.memberships mb
     where mb.center_id = v_center and mb.status = 'active' and mb.tier <> 'community'
     group by mb.household_id having min(mb.starts_on) between p_from and p_to) x;
  select count(*) into v_people from app.people p where p.center_id = v_center and p.merged_into_id is null and not p.is_deceased;
  select count(*) into v_new_people from app.people p where p.center_id = v_center and p.merged_into_id is null and not p.is_deceased
     and (p.created_at at time zone v_tz)::date between p_from and p_to;
  select count(distinct mb.household_id) into v_on_app from app.memberships mb
   where mb.center_id = v_center and mb.status = 'active' and mb.tier <> 'community'
     and exists (select 1 from app.household_members hm join app.center_users cu on cu.person_id = hm.person_id
                  where hm.household_id = mb.household_id and hm.left_at is null);
  select count(distinct e.student_person_id) into v_students from app.pathshala_enrollments e
    join app.pathshala_terms t on t.id = e.term_id
   where e.center_id = v_center and e.status in ('placed','active') and t.status in ('registration','active');
  select count(distinct pt.person_id) into v_teachers from app.pathshala_teachers pt
    join app.pathshala_classes cl on cl.id = pt.class_id join app.pathshala_terms t on t.id = cl.term_id
   where pt.center_id = v_center and t.status in ('registration','active');

  m := jsonb_build_object(
    'member_families', v_families, 'community_people', v_people,
    'events_held', cur->'events_held', 'attendance', cur->'attendance',
    'volunteer_hours', case when (cur->>'volunteers')::bigint >= 10 then cur->'volunteer_hours' end,
    'app_adoption', case when v_families >= 10 then round(100.0 * v_on_app / v_families)::int end,
    'samayik', cur->'samayik', 'pratikraman', cur->'pratikraman', 'navkar_malas', cur->'navkar_malas',
    'gyan_levels', cur->'gyan_levels', 'gyan_steps', cur->'gyan_steps', 'anumodana', cur->'anumodana',
    'pathshala_students', v_students, 'volunteer_teachers', v_teachers,
    'class_attendance_rate', case when (cur->>'class_sessions_marked')::bigint >= 10
                                  then round(100.0 * (cur->>'class_present')::bigint / (cur->>'class_sessions_marked')::bigint)::int end,
    'store_orders', cur->'store_orders');
  -- Suppress counts under 10 (percentages were gated on their denominators above).
  for k in select jsonb_object_keys(m) loop
    if k not in ('app_adoption','class_attendance_rate') and jsonb_typeof(m->k) = 'number' and (m->>k)::numeric < 10 then
      m := jsonb_set(m, array[k], 'null');
    end if;
  end loop;

  -- Deltas: flows vs the previous period of equal length; stocks = new this period.
  for k in select unnest(array['events_held','attendance','volunteer_hours','samayik','pratikraman','navkar_malas',
                               'gyan_levels','gyan_steps','anumodana','store_orders']) loop
    d := d || jsonb_build_object(k, case
      when m->>k is null or coalesce((prev->>k)::numeric, 0) < 10
           or (k = 'volunteer_hours' and coalesce((prev->>'volunteers')::bigint, 0) < 10)
        then jsonb_build_object('previous', null, 'change', null, 'change_pct', null)
      else jsonb_build_object('previous', prev->k, 'change', (m->>k)::numeric - (prev->>k)::numeric,
                              'change_pct', round(100.0 * ((m->>k)::numeric - (prev->>k)::numeric) / (prev->>k)::numeric)::int)
      end);
  end loop;
  d := d || jsonb_build_object(
    'member_families', jsonb_build_object('new_in_period', case when v_new_fam >= 10 then v_new_fam end),
    'community_people', jsonb_build_object('new_in_period', case when v_new_people >= 10 then v_new_people end),
    'volunteer_hours_volunteers', jsonb_build_object('volunteers', case when (cur->>'volunteers')::bigint >= 10 then cur->'volunteers' end));

  -- Attendance by month: 12 buckets from the period's first month (or the 12
  -- months ending at p_to for longer periods); months after p_to are partial.
  v_start := date_trunc('month', greatest(p_from, (p_to - interval '11 months')::date))::date;
  select jsonb_agg(jsonb_build_object(
           'month', b.m, 'label', to_char(b.m, 'Mon'),
           'value', case when b.m > p_to then null
                         else nullif(greatest(
                           (select count(*) from app.attendees a where a.center_id = v_center
                              and date_trunc('month', a.checked_in_at at time zone v_tz)::date = b.m)
                         + (select count(*) from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
                             where pa.center_id = v_center and pa.status in ('present','late') and date_trunc('month', s.held_on)::date = b.m), 0), 0) end,
           'partial', b.m > p_to or b.m + interval '1 month' > p_to + 1) order by b.m)
    into v_months
    from (select (v_start + make_interval(months => i))::date as m from generate_series(0, 11) i) b;
  select jsonb_agg(case when (x->>'value')::bigint < 10 then x || '{"value":null}' else x end) into v_months
    from jsonb_array_elements(v_months) x;

  -- Families by zone (member families, largest first); zones under 10 hidden.
  select coalesce(jsonb_agg(jsonb_build_object('zone', z.name, 'families', case when z.n >= 10 then z.n end) order by z.n desc, z.name), '[]')
    into v_zones
    from (select zo.name, count(distinct mb.household_id) as n from app.zones zo
            left join app.households h on h.zone_id = zo.id and h.merged_into_id is null
            left join app.memberships mb on mb.household_id = h.id and mb.status = 'active' and mb.tier <> 'community'
           where zo.center_id = v_center group by zo.name) z;

  -- One campaign: by name (case-insensitive) or, by default, the largest published construction campaign.
  select cp.* into c from app.campaigns cp
   where cp.center_id = v_center and cp.status in ('published','closed')
     and (case when p_campaign is null then cp.kind = 'construction' else lower(cp.name) = lower(trim(p_campaign)) end)
   order by cp.goal_cents desc nulls last, cp.created_at limit 1;
  if c.id is not null then
    select count(distinct p.household_id) into v_donors from app.pledges p
     where p.campaign_id = c.id and p.status not in ('cancelled','written_off');
    v_camp := jsonb_build_object('name', c.name, 'goal_cents', c.goal_cents,
      'pledged_cents', case when v_donors >= 10 then (select coalesce(sum(p.amount_cents), 0) from app.pledges p
                                                       where p.campaign_id = c.id and p.status not in ('cancelled','written_off')) end,
      'paid_cents', case when v_donors >= 10 then (select coalesce(sum(p.paid_cents), 0) from app.pledges p
                                                    where p.campaign_id = c.id and p.status not in ('cancelled','written_off')) end,
      'donor_families', case when v_donors >= 10 then v_donors end,
      'participation_percent', case when v_donors >= 10 and v_families >= 10 then round(100.0 * v_donors / v_families)::int end);
    v_camp := v_camp || jsonb_build_object('percent', case when coalesce(c.goal_cents, 0) > 0 and v_camp->>'pledged_cents' is not null
                                                        then least(100, round(100.0 * (v_camp->>'pledged_cents')::bigint / c.goal_cents))::int end);
  end if;

  -- Visibility: members of the center see everything; everyone else only 'public' keys.
  if not v_member then
    m := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(m) where key = any(v_public));
    d := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(d)
           where key = any(v_public) or (key = 'volunteer_hours_volunteers' and 'volunteer_hours' = any(v_public)));
  end if;

  v_out := jsonb_build_object(
    'center', p_slug, 'from', p_from, 'to', p_to, 'as_of', now(), 'suppressed_below', 10,
    'previous', jsonb_build_object('from', v_pfrom, 'to', v_pto),
    'audience', case when v_member then 'members' else 'public' end,
    'metrics', m, 'deltas', d);
  if v_member or 'attendance_by_month' = any(v_public) then v_out := v_out || jsonb_build_object('attendance_by_month', v_months); end if;
  if v_member or 'families_by_zone' = any(v_public) then v_out := v_out || jsonb_build_object('families_by_zone', v_zones); end if;
  if (v_member or 'campaign' = any(v_public)) and v_camp is not null then v_out := v_out || jsonb_build_object('campaign', v_camp); end if;
  return v_out;
end $$;

revoke execute on function app.kpi_flows(uuid, date, date) from public, anon, authenticated;
revoke execute on function app.public_kpi_catalog(uuid) from public, anon;
grant execute on function app.public_kpi_catalog(uuid) to authenticated;
grant execute on function app.public_kpis(text, date, date, text) to anon, authenticated;
grant execute on all functions in schema app to service_role;
