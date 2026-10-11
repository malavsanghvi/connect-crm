-- 0672: Reports summary reads (BACKLOG B90 phase 4, B83 "Summary reads"). No table, column or policy changes: read-only SQL
-- functions that do, in the database, the sums the Reports page used to do in page code (nine scans of up to 50,000 rows, fetched
-- 1,000 at a time), and that the Reports commands (and so Niva) use to answer number questions. Niva never writes SQL: it can only
-- ask these functions, with a date range, and read what they answer.
--
--   app.reports_people_overview(center, year, today)         households, new ones, on the app, by zone, renewals due
--   app.reports_membership_matrix(center)                    memberships by tier and status, active households, applications
--   app.reports_membership_changes(center, from, to, today)  who started, who ended or lapsed, applications received
--   app.reports_payments_summary(center, from, to, group)    money received by method, month, year, fund or campaign
--   app.reports_pledges_summary(center, from, to)            pledges made in the range by campaign, and what is open now
--   app.reports_attendance(center, from, to, top)            check-ins in the range: total, by event, by month (counts only)
--   app.reports_store_sales(center, from, to, top)           store orders and sales in the range, by month and by item
--   app.reports_period_figures(center, from, to)             the headline figures of one period, for "this month vs last month"
--
-- Every function is SECURITY INVOKER: it reads the same tables the Reports page read, as the person asking, so row-level security
-- decides what comes back (a person who may not see payments gets zeros and empty lists, never somebody else's numbers); the
-- command layer and the page say "You don't have access to this area" before they get here. Money is integer cents and the
-- functions never format dollars. Dates are calendar days in the community's own time zone. Nothing here writes, and nothing
-- returns the name of a person: counts and sums only (D2: nothing about anyone under 18 leaves the database by name).
--
-- The rules are the ones the page used before this migration, so the figures do not change:
--   * money counted = payments that are not failed, voided or only authorized, net of refunds (opening balances included, as before)
--   * a pledge counts in the year it was made unless it was cancelled; "written off" is what was still unpaid on a written-off pledge
--   * "open pledges" = every open or partly paid pledge, whenever it was made
--   * "on the app" = a household with a current member who has signed in to this community
--   * store sales = orders placed, being prepared, ready or picked up (not carts and not cancelled), by the day they were placed
-- Giving by fund or campaign is the money applied to pledges, by the pledge's fund and campaign (a pledge with no fund takes its
-- campaign's fund); money not applied to any pledge is its own line, so the lines add up to what was received. Refunds are not split
-- by fund or campaign: they are in the totals only.
set client_min_messages = warning;

-- ── The community's own time zone ────────────────────────────────────────────
create or replace function app.reports_tz(p_center uuid) returns text
language sql stable security invoker set search_path = app, public, extensions as $$
  select coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'UTC')
$$;

-- ── Households, the app, zones and renewals ─────────────────────────────────
create or replace function app.reports_people_overview(p_center uuid, p_year integer, p_today date default null)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select app.reports_tz(p_center) as tz
  ),
  t as (
    select coalesce(p_today, (now() at time zone (select tz from z))::date) as today
  ),
  hh as (
    select h.id, h.zone_id, h.created_at
      from app.households h
     where h.center_id = p_center and h.merged_into_id is null
  ),
  on_app as (
    select distinct m.household_id
      from app.household_members m
      join app.center_users u on u.center_id = m.center_id and u.person_id = m.person_id
      join hh on hh.id = m.household_id
     where m.center_id = p_center and m.left_at is null
  ),
  by_zone as (
    select coalesce(zn.name, case when hh.zone_id is null then 'No zone' else 'Other' end) as zone,
           count(*)::integer as households
      from hh
      left join app.zones zn on zn.id = hh.zone_id and zn.center_id = p_center
     group by 1
  )
  select jsonb_build_object(
    'year', p_year,
    'as_of', (select today from t),
    'households', (select count(*) from hh)::integer,
    'new_in_year', (select count(*) from hh
                     where hh.created_at >= (make_date(p_year, 1, 1)::timestamp at time zone (select tz from z))
                       and hh.created_at < (make_date(p_year + 1, 1, 1)::timestamp at time zone (select tz from z)))::integer,
    'households_on_app', (select count(*) from on_app)::integer,
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object('zone', bz.zone, 'households', bz.households) order by bz.households desc, bz.zone)
        from by_zone bz), '[]'::jsonb),
    'renewals_due', (select count(*) from app.memberships ms
                      where ms.center_id = p_center and ms.status = 'active'
                        and ms.ends_on >= (select today from t)
                        and ms.ends_on <= (select today from t) + 60)::integer
  )
$$;

-- ── Memberships by tier and status ──────────────────────────────────────────
create or replace function app.reports_membership_matrix(p_center uuid)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with ms as (
    select m.tier::text as tier, m.status::text as status, m.household_id
      from app.memberships m
     where m.center_id = p_center
  ),
  cells as (
    select tier, status, count(*)::integer as memberships from ms group by 1, 2
  ),
  active_hh as (
    select tier, count(distinct household_id)::integer as households from ms where status = 'active' group by 1
  ),
  apps as (
    select a.status::text as status, count(*)::integer as applications
      from app.membership_applications a
     where a.center_id = p_center
     group by 1
  )
  select jsonb_build_object(
    'cells', coalesce((
      select jsonb_agg(jsonb_build_object('tier', c.tier, 'status', c.status, 'memberships', c.memberships) order by c.tier, c.status)
        from cells c), '[]'::jsonb),
    'active_households', coalesce((
      select jsonb_agg(jsonb_build_object('tier', a.tier, 'households', a.households) order by a.tier)
        from active_hh a), '[]'::jsonb),
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object('status', p.status, 'applications', p.applications) order by p.status)
        from apps p), '[]'::jsonb)
  )
$$;

-- ── Who joined, who left, applications ──────────────────────────────────────
-- "Started" = memberships that began in the range (not ones still waiting to be confirmed). "Ended" = memberships that lapsed or
-- ended, by the day they were due to end. Applications are counted by the day they were made.
create or replace function app.reports_membership_changes(p_center uuid, p_from date, p_to date, p_today date default null)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select app.reports_tz(p_center) as tz
  ),
  t as (
    select coalesce(p_today, (now() at time zone (select tz from z))::date) as today
  ),
  started as (
    select m.tier::text as tier, count(*)::integer as n
      from app.memberships m
     where m.center_id = p_center and m.status <> 'pending' and m.starts_on between p_from and p_to
     group by 1
  ),
  ended as (
    select m.status::text as status, count(*)::integer as n
      from app.memberships m
     where m.center_id = p_center and m.status in ('lapsed', 'ended') and m.ends_on between p_from and p_to
     group by 1
  ),
  apps as (
    select a.status::text as status, count(*)::integer as n
      from app.membership_applications a
     where a.center_id = p_center
       and a.created_at >= (p_from::timestamp at time zone (select tz from z))
       and a.created_at < ((p_to + 1)::timestamp at time zone (select tz from z))
     group by 1
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'started', coalesce((select jsonb_agg(jsonb_build_object('tier', s.tier, 'memberships', s.n) order by s.tier) from started s), '[]'::jsonb),
    'started_total', coalesce((select sum(s.n) from started s), 0)::integer,
    'ended', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'memberships', e.n) order by e.status) from ended e), '[]'::jsonb),
    'ended_total', coalesce((select sum(e.n) from ended e), 0)::integer,
    'applications', coalesce((select jsonb_agg(jsonb_build_object('status', a.status, 'applications', a.n) order by a.status) from apps a), '[]'::jsonb),
    'applications_total', coalesce((select sum(a.n) from apps a), 0)::integer,
    'active_now', (select count(*) from app.memberships m where m.center_id = p_center and m.status = 'active')::integer,
    'renewals_due_60_days', (select count(*) from app.memberships m
                              where m.center_id = p_center and m.status = 'active'
                                and m.ends_on >= (select today from t) and m.ends_on <= (select today from t) + 60)::integer
  )
$$;

-- ── Money received ──────────────────────────────────────────────────────────
-- p_group: method, month (2026-09), year, fund, campaign, or none (totals only). "net" is received minus refunded; by fund and
-- campaign the lines are the money applied to pledges (refunded is null there) plus one line for money not applied to a pledge.
create or replace function app.reports_payments_summary(p_center uuid, p_from date, p_to date, p_group text default 'method')
returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare v jsonb;
begin
  if p_group is null or p_group not in ('method', 'month', 'year', 'fund', 'campaign', 'none') then
    raise exception 'Group giving by method, month, year, fund, campaign or none.' using errcode = '22023';
  end if;
  with pay as (
    select p.id, p.method, p.received_on, p.amount_cents, p.refunded_cents
      from app.payments p
     where p.center_id = p_center
       and p.received_on between p_from and p_to
       and p.status not in ('failed', 'voided', 'authorized')
  ),
  tot as (
    select count(*)::integer as payments,
           coalesce(sum(pay.amount_cents), 0)::bigint as received,
           coalesce(sum(pay.refunded_cents), 0)::bigint as refunded
      from pay
  ),
  alloc as (
    select al.payment_id, al.amount_cents, coalesce(pl.fund_id, cp.fund_id) as fund_id, pl.campaign_id
      from app.payment_allocations al
      join pay on pay.id = al.payment_id
      join app.pledges pl on pl.id = al.pledge_id
      left join app.campaigns cp on cp.id = pl.campaign_id
     where al.center_id = p_center
  ),
  loose as (
    select count(*)::integer as n, coalesce(sum(r.rem), 0)::bigint as amount
      from (select pay.id, pay.amount_cents - coalesce((select sum(al.amount_cents) from alloc al where al.payment_id = pay.id), 0) as rem
              from pay) r
     where r.rem <> 0
  ),
  g as (
    select pm.method::text as k, pm.method::text as label, count(*)::integer as n,
           sum(pm.amount_cents)::bigint as received, sum(pm.refunded_cents)::bigint as refunded
      from pay pm where p_group = 'method' group by pm.method
    union all
    select to_char(pm.received_on, 'YYYY-MM'), to_char(pm.received_on, 'YYYY-MM'), count(*)::integer,
           sum(pm.amount_cents)::bigint, sum(pm.refunded_cents)::bigint
      from pay pm where p_group = 'month' group by to_char(pm.received_on, 'YYYY-MM')
    union all
    select extract(year from pm.received_on)::integer::text, extract(year from pm.received_on)::integer::text, count(*)::integer,
           sum(pm.amount_cents)::bigint, sum(pm.refunded_cents)::bigint
      from pay pm where p_group = 'year' group by extract(year from pm.received_on)::integer
    union all
    select coalesce(a.fund_id::text, 'none'), coalesce(f.name, 'No fund'), count(distinct a.payment_id)::integer,
           sum(a.amount_cents)::bigint, null::bigint
      from alloc a left join app.funds f on f.id = a.fund_id
     where p_group = 'fund' group by a.fund_id, f.name
    union all
    select coalesce(a.campaign_id::text, 'none'), coalesce(ca.name, 'No campaign'), count(distinct a.payment_id)::integer,
           sum(a.amount_cents)::bigint, null::bigint
      from alloc a left join app.campaigns ca on ca.id = a.campaign_id
     where p_group = 'campaign' group by a.campaign_id, ca.name
    union all
    select 'unallocated', 'Not applied to a pledge', lo.n, lo.amount, null::bigint
      from loose lo where p_group in ('fund', 'campaign') and lo.n > 0
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'group', p_group,
    'totals', jsonb_build_object(
      'payments', tot.payments,
      'received_cents', tot.received,
      'refunded_cents', tot.refunded,
      'net_cents', tot.received - tot.refunded),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', g.k,
               'label', g.label,
               'payments', g.n,
               'received_cents', g.received,
               'refunded_cents', g.refunded,
               'net_cents', case when g.refunded is null then null else g.received - g.refunded end)
             order by case when p_group in ('month', 'year') then 0 else -(g.received - coalesce(g.refunded, 0)) end, g.k)
        from g), '[]'::jsonb))
    into v
    from tot;
  return v;
end $$;

-- ── Pledges made in a range, by campaign, and what is open now ──────────────
create or replace function app.reports_pledges_summary(p_center uuid, p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select app.reports_tz(p_center) as tz
  ),
  pl as (
    select p.campaign_id, p.amount_cents, p.paid_cents, p.status
      from app.pledges p
     where p.center_id = p_center
       and p.status <> 'cancelled'
       and p.pledged_at >= (p_from::timestamp at time zone (select tz from z))
       and p.pledged_at < ((p_to + 1)::timestamp at time zone (select tz from z))
  ),
  by_c as (
    select pl.campaign_id,
           count(*)::integer as pledges,
           sum(pl.amount_cents)::bigint as pledged,
           sum(pl.paid_cents)::bigint as paid,
           coalesce(sum(pl.amount_cents - pl.paid_cents) filter (where pl.status = 'written_off'), 0)::bigint as written_off
      from pl
     group by pl.campaign_id
  ),
  named as (
    select b.campaign_id, ca.name, b.pledges, b.pledged, b.paid, b.written_off
      from by_c b left join app.campaigns ca on ca.id = b.campaign_id
  ),
  op as (
    select count(*)::integer as pledges, coalesce(sum(p.amount_cents - p.paid_cents), 0)::bigint as open_cents
      from app.pledges p
     where p.center_id = p_center and p.status in ('open', 'partially_paid')
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'totals', jsonb_build_object(
      'pledges', coalesce((select sum(n.pledges) from named n), 0)::integer,
      'pledged_cents', coalesce((select sum(n.pledged) from named n), 0)::bigint,
      'paid_cents', coalesce((select sum(n.paid) from named n), 0)::bigint,
      'written_off_cents', coalesce((select sum(n.written_off) from named n), 0)::bigint),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
               'campaign_id', n.campaign_id,
               'campaign', n.name,
               'pledges', n.pledges,
               'pledged_cents', n.pledged,
               'paid_cents', n.paid,
               'written_off_cents', n.written_off)
             order by n.pledged desc, n.name nulls last, n.campaign_id)
        from named n), '[]'::jsonb),
    'open_now', jsonb_build_object('pledges', (select pledges from op), 'open_cents', (select open_cents from op))
  )
$$;

-- ── Check-ins ───────────────────────────────────────────────────────────────
-- Counts only: how many checked in, at how many events, which events had the most, and by month. No attendee is named.
create or replace function app.reports_attendance(p_center uuid, p_from date, p_to date, p_top integer default 10)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select app.reports_tz(p_center) as tz
  ),
  ci as (
    select a.event_id, to_char(a.checked_in_at at time zone (select tz from z), 'YYYY-MM') as month
      from app.attendees a
     where a.center_id = p_center
       and a.checked_in_at >= (p_from::timestamp at time zone (select tz from z))
       and a.checked_in_at < ((p_to + 1)::timestamp at time zone (select tz from z))
  ),
  per_event as (
    select ci.event_id, count(*)::integer as n from ci group by ci.event_id
  ),
  ranked as (
    select pe.event_id, pe.n, e.name, e.starts_at,
           row_number() over (order by pe.n desc, e.starts_at desc nulls last, pe.event_id) as rn
      from per_event pe join app.events e on e.id = pe.event_id
  ),
  by_month as (
    select ci.month, count(*)::integer as n from ci group by ci.month
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'check_ins', (select count(*) from ci)::integer,
    'events', (select count(*) from per_event)::integer,
    'top_events', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', r.event_id, 'name', r.name, 'starts_at', r.starts_at, 'check_ins', r.n) order by r.rn)
        from ranked r
       where r.rn <= greatest(coalesce(p_top, 10), 1)), '[]'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m.month, 'check_ins', m.n) order by m.month) from by_month m), '[]'::jsonb)
  )
$$;

-- ── Store sales ─────────────────────────────────────────────────────────────
create or replace function app.reports_store_sales(p_center uuid, p_from date, p_to date, p_top integer default 10)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select app.reports_tz(p_center) as tz
  ),
  ord as (
    select o.id, o.total_cents, to_char(o.placed_at at time zone (select tz from z), 'YYYY-MM') as month
      from app.store_orders o
     where o.center_id = p_center
       and o.status in ('placed', 'preparing', 'ready', 'picked_up')
       and o.placed_at >= (p_from::timestamp at time zone (select tz from z))
       and o.placed_at < ((p_to + 1)::timestamp at time zone (select tz from z))
  ),
  by_month as (
    select ord.month, count(*)::integer as orders, coalesce(sum(ord.total_cents), 0)::bigint as sales
      from ord group by ord.month
  ),
  items as (
    select i.id as item_id, i.name, sum(l.quantity)::bigint as units, sum(l.line_total_cents)::bigint as sales
      from app.store_order_lines l
      join ord on ord.id = l.order_id
      join app.store_items i on i.id = l.item_id
     where l.center_id = p_center
     group by i.id, i.name
  ),
  ranked as (
    select it.*, row_number() over (order by it.sales desc, it.name, it.item_id) as rn from items it
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'orders', (select count(*) from ord)::integer,
    'sales_cents', coalesce((select sum(ord.total_cents) from ord), 0)::bigint,
    'by_month', coalesce((
      select jsonb_agg(jsonb_build_object('month', bm.month, 'orders', bm.orders, 'sales_cents', bm.sales) order by bm.month)
        from by_month bm), '[]'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object('item', r.name, 'units', r.units, 'sales_cents', r.sales) order by r.rn)
        from ranked r
       where r.rn <= greatest(coalesce(p_top, 10), 1)), '[]'::jsonb)
  )
$$;

-- ── The headline figures of one period ──────────────────────────────────────
-- Asked twice (this month, last month) to compare them.
create or replace function app.reports_period_figures(p_center uuid, p_from date, p_to date)
returns jsonb
language sql stable security invoker set search_path = app, public, extensions as $$
  with z as (
    select app.reports_tz(p_center) as tz
  ),
  b as (
    select (p_from::timestamp at time zone (select tz from z)) as t0,
           ((p_to + 1)::timestamp at time zone (select tz from z)) as t1
  ),
  pay as (
    select count(*)::integer as n,
           coalesce(sum(p.amount_cents), 0)::bigint as received,
           coalesce(sum(p.refunded_cents), 0)::bigint as refunded
      from app.payments p
     where p.center_id = p_center
       and p.received_on between p_from and p_to
       and p.status not in ('failed', 'voided', 'authorized')
  ),
  shop as (
    select count(*)::integer as orders, coalesce(sum(o.total_cents), 0)::bigint as amount
      from app.store_orders o
     where o.center_id = p_center
       and o.status in ('placed', 'preparing', 'ready', 'picked_up')
       and o.placed_at >= (select t0 from b) and o.placed_at < (select t1 from b)
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'giving', jsonb_build_object(
      'payments', (select n from pay),
      'received_cents', (select received from pay),
      'refunded_cents', (select refunded from pay),
      'net_cents', (select received - refunded from pay)),
    'new_households', (select count(*) from app.households h
                        where h.center_id = p_center and h.merged_into_id is null
                          and h.created_at >= (select t0 from b) and h.created_at < (select t1 from b))::integer,
    'memberships_started', (select count(*) from app.memberships m
                             where m.center_id = p_center and m.status <> 'pending' and m.starts_on between p_from and p_to)::integer,
    'applications_received', (select count(*) from app.membership_applications a
                               where a.center_id = p_center
                                 and a.created_at >= (select t0 from b) and a.created_at < (select t1 from b))::integer,
    'check_ins', (select count(*) from app.attendees a
                   where a.center_id = p_center
                     and a.checked_in_at >= (select t0 from b) and a.checked_in_at < (select t1 from b))::integer,
    'store', jsonb_build_object('orders', (select orders from shop), 'sales_cents', (select amount from shop))
  )
$$;

revoke execute on function app.reports_tz(uuid),
  app.reports_people_overview(uuid, integer, date),
  app.reports_membership_matrix(uuid),
  app.reports_membership_changes(uuid, date, date, date),
  app.reports_payments_summary(uuid, date, date, text),
  app.reports_pledges_summary(uuid, date, date),
  app.reports_attendance(uuid, date, date, integer),
  app.reports_store_sales(uuid, date, date, integer),
  app.reports_period_figures(uuid, date, date) from public, anon;
grant execute on function app.reports_tz(uuid),
  app.reports_people_overview(uuid, integer, date),
  app.reports_membership_matrix(uuid),
  app.reports_membership_changes(uuid, date, date, date),
  app.reports_payments_summary(uuid, date, date, text),
  app.reports_pledges_summary(uuid, date, date),
  app.reports_attendance(uuid, date, date, integer),
  app.reports_store_sales(uuid, date, date, integer),
  app.reports_period_figures(uuid, date, date) to authenticated;

comment on function app.reports_people_overview(uuid, integer, date) is
  'Households, new ones in the year, households on the app, households by zone and renewals due in 60 days. Security invoker (RLS applies). Read only.';
comment on function app.reports_membership_matrix(uuid) is
  'Memberships by tier and status, active households per tier, applications by status. Security invoker. Read only.';
comment on function app.reports_membership_changes(uuid, date, date, date) is
  'Memberships that started, lapsed or ended in a range, and applications received. Counts only. Security invoker. Read only.';
comment on function app.reports_payments_summary(uuid, date, date, text) is
  'Money received in a range, net of refunds, grouped by method, month, year, fund or campaign. Integer cents. Security invoker. Read only.';
comment on function app.reports_pledges_summary(uuid, date, date) is
  'Pledges made in a range by campaign (pledged, paid, written off) and what is open now. Security invoker. Read only.';
comment on function app.reports_attendance(uuid, date, date, integer) is
  'Event check-ins in a range: total, events, top events, by month. Counts only, no attendee is named. Security invoker. Read only.';
comment on function app.reports_store_sales(uuid, date, date, integer) is
  'Store orders and sales in a range, by month and top items. Security invoker. Read only.';
comment on function app.reports_period_figures(uuid, date, date) is
  'The headline figures of one period (giving, new households, memberships started, applications, check-ins, store sales). Security invoker. Read only.';
