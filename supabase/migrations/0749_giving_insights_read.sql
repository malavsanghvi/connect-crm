-- 0749 (Giving redesign slice 10, BACKLOG B98 slice 1): Giving › Insights, the community's own giving numbers.
--
-- docs/GIVING_INSIGHTS.md sections 3.1 and 5. One read function, app.giving_insights, that adds up a year of giving in the
-- database and returns AGGREGATES ONLY: sums, counts, a median, the top tenth's share. No household id, no name, no person,
-- nothing about anyone under 18 (it reads households' money, never people). Retention ("first gift ever", "regained") and the
-- median need every year of a household's giving grouped together, which the portal's API cannot do, and the rows never leave
-- the database.
--
-- Rules (the same as the year-end statements and docs/GIVING_INSIGHTS.md section 3):
--   * A gift is a payment that went through (not failed, voided or only authorized), less what was refunded, in integer cents.
--   * Opening-balance lines (is_opening_balance, 0413) carry made-up dates: they are left out of every number here.
--   * Fees are split out: the part of a payment applied to a membership fee, a school or class fee or a store sale
--     (pledges.source membership_fee, pathshala_fee, store) is not a donation. It is reported on its own line.
--   * The year is the one the portal asks for (p_from .. p_to, the community's financial year, src/lib/reports/periods.ts):
--     "last year" is the same window one year earlier; "same point last year" stops on the same day.
--   * Concentration follows the under-10 rule of the public dashboard (0011): with fewer than 10 giving households the top
--     tenth's share is null, never computed.
--   * A pledge with no due date is due 30 days after it was made (giving_pledges_behind, 0656); its ageing buckets are the same.
--
-- Who: giving.view or giving.manage (the paymentsAll access of the portal). The giving_insights module must be on (0741); the
-- sentence a switched-off module gives comes from app.assert_module_enabled. Security definer, so a person never gets partial
-- numbers from RLS: either all of the community's numbers or a refusal. Read only.
--
-- Also: the activity allowlist learns the Insights screen (0620 drops screen keys it does not know).

create or replace function app.giving_insights(p_center uuid, p_from date, p_to date, p_today date default null)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_tz        text;
  v_today     date;
  v_prev_from date;
  v_prev_to   date;
  v_prev_end  date;
  v           jsonb;
begin
  if p_center is null or p_from is null or p_to is null or p_to < p_from or p_to >= (p_from + interval '1 year')::date then
    raise exception 'Pick one year of giving: a first day and a last day less than a year apart.' using errcode = '22023';
  end if;
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'Giving insights need giving.view or giving.manage in this community.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(p_center, 'giving_insights');

  v_tz := coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'UTC');
  v_today := coalesce(p_today, (now() at time zone v_tz)::date);
  v_prev_from := (p_from - interval '1 year')::date;
  v_prev_to := (p_to - interval '1 year')::date;
  v_prev_end := p_from - 1;

  with pay as (
    select p.id, p.household_id, p.received_on, greatest(p.amount_cents - p.refunded_cents, 0)::bigint as net
      from app.payments p
     where p.center_id = p_center
       and p.status not in ('failed', 'voided', 'authorized')
       and not p.is_opening_balance
  ),
  fee_alloc as (
    select al.payment_id,
           sum(al.amount_cents)::bigint as fee,
           coalesce(sum(al.amount_cents) filter (where pl.source = 'membership_fee'), 0)::bigint as membership,
           coalesce(sum(al.amount_cents) filter (where pl.source = 'pathshala_fee'), 0)::bigint as school,
           coalesce(sum(al.amount_cents) filter (where pl.source = 'store'), 0)::bigint as store
      from app.payment_allocations al
      join app.pledges pl on pl.id = al.pledge_id
     where al.center_id = p_center and pl.source in ('membership_fee', 'pathshala_fee', 'store')
     group by al.payment_id
  ),
  gift as (
    select pay.id, pay.household_id, pay.received_on, pay.net,
           least(coalesce(fa.fee, 0), pay.net) as fee,
           pay.net - least(coalesce(fa.fee, 0), pay.net) as donation,
           coalesce(fa.membership, 0) as membership, coalesce(fa.school, 0) as school, coalesce(fa.store, 0) as store
      from pay left join fee_alloc fa on fa.payment_id = pay.id
  ),
  this_g as (select * from gift where received_on between p_from and p_to and donation > 0),
  same_g as (select * from gift where received_on between v_prev_from and v_prev_to and donation > 0),
  hh as (
    select g.household_id,
           coalesce(sum(g.donation) filter (where g.received_on between p_from and p_to), 0)::bigint as this_c,
           coalesce(sum(g.donation) filter (where g.received_on between v_prev_from and v_prev_end), 0)::bigint as last_c,
           bool_or(g.received_on < v_prev_from) as before,
           min(g.received_on) as first_on
      from gift g
     where g.donation > 0 and g.received_on <= p_to
     group by g.household_id
  ),
  givers as (select household_id, this_c, row_number() over (order by this_c desc, household_id) as rn, count(*) over () as n from hh where this_c > 0),
  -- What the donations were applied to (pledges that are not fees), with the day the money came in.
  alloc as (
    select al.amount_cents::bigint as cents, g.received_on, coalesce(pl.fund_id, cp.fund_id) as fund_id, pl.campaign_id, pl.opportunity_id,
           pl.source
      from app.payment_allocations al
      join gift g on g.id = al.payment_id
      join app.pledges pl on pl.id = al.pledge_id
      left join app.campaigns cp on cp.id = pl.campaign_id
     where al.center_id = p_center and pl.source not in ('membership_fee', 'pathshala_fee', 'store')
       and (g.received_on between p_from and p_to or g.received_on between v_prev_from and v_prev_to)
  ),
  cat as (
    select 'fund'::text as kind, a.fund_id as id,
           coalesce(sum(a.cents) filter (where a.received_on between p_from and p_to), 0)::bigint as this_c,
           coalesce(sum(a.cents) filter (where a.received_on between v_prev_from and v_prev_to), 0)::bigint as last_c
      from alloc a where a.fund_id is not null group by a.fund_id
    union all
    select 'campaign', a.campaign_id,
           coalesce(sum(a.cents) filter (where a.received_on between p_from and p_to), 0)::bigint,
           coalesce(sum(a.cents) filter (where a.received_on between v_prev_from and v_prev_to), 0)::bigint
      from alloc a where a.campaign_id is not null group by a.campaign_id
    union all
    select 'opportunity', a.opportunity_id,
           coalesce(sum(a.cents) filter (where a.received_on between p_from and p_to), 0)::bigint,
           coalesce(sum(a.cents) filter (where a.received_on between v_prev_from and v_prev_to), 0)::bigint
      from alloc a where a.opportunity_id is not null group by a.opportunity_id
  ),
  cat_named as (
    select c.kind, c.id, c.this_c, c.last_c,
           coalesce(case c.kind when 'fund' then f.name when 'campaign' then ca.name else o.name end, 'Unnamed') as label,
           row_number() over (partition by c.kind order by c.this_c desc, c.last_c desc, c.id) as rn
      from cat c
      left join app.funds f on c.kind = 'fund' and f.id = c.id
      left join app.campaigns ca on c.kind = 'campaign' and ca.id = c.id
      left join app.opportunities o on c.kind = 'opportunity' and o.id = c.id
  ),
  applied as (
    select coalesce(sum(a.cents) filter (where a.received_on between p_from and p_to), 0)::bigint as this_c,
           coalesce(sum(a.cents) filter (where a.received_on between v_prev_from and v_prev_to), 0)::bigint as last_c,
           coalesce(sum(a.cents) filter (where a.received_on between p_from and p_to and a.source = 'recurring'), 0)::bigint as recurring_c
      from alloc a
  ),
  open_p as (
    select pl.amount_cents - pl.paid_cents as open_cents,
           coalesce(pl.due_on, (pl.pledged_at at time zone v_tz)::date + 30) as due
      from app.pledges pl
     where pl.center_id = p_center
       and pl.status in ('open', 'partially_paid')
       and pl.source not in ('membership_fee', 'pathshala_fee', 'store')
       and pl.amount_cents - pl.paid_cents > 0
  ),
  made as (
    select pl.amount_cents, pl.paid_cents, pl.status
      from app.pledges pl
     where pl.center_id = p_center
       and pl.status <> 'cancelled'
       and pl.source not in ('membership_fee', 'pathshala_fee', 'store')
       and (pl.pledged_at at time zone v_tz)::date between p_from and p_to
  ),
  months as (
    select (p_from + make_interval(months => m))::date as first_day, m from generate_series(0, 11) m
  ),
  goals as (
    select ca.id, ca.name, ca.goal_cents, ca.starts_on, ca.ends_on,
           coalesce((select sum(pl.amount_cents) from app.pledges pl where pl.campaign_id = ca.id and pl.status <> 'cancelled'), 0)::bigint as pledged_c,
           coalesce((select sum(pl.paid_cents) from app.pledges pl where pl.campaign_id = ca.id and pl.status <> 'cancelled'), 0)::bigint as paid_c
      from app.campaigns ca
     where ca.center_id = p_center
       and ca.goal_cents > 0
       and ca.status <> 'archived'
       and (ca.starts_on is null or ca.starts_on <= p_to)
       and (ca.ends_on is null or ca.ends_on >= p_from)
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'today', v_today,
    'prev_from', v_prev_from, 'prev_to', v_prev_to, 'prev_end', v_prev_end,
    'donations', jsonb_build_object(
      'this_cents', (select coalesce(sum(donation), 0) from this_g)::bigint,
      'same_point_last_cents', (select coalesce(sum(donation), 0) from same_g)::bigint,
      'last_year_cents', (select coalesce(sum(last_c), 0) from hh)::bigint,
      'gifts', (select count(*) from this_g)::integer,
      'average_gift_cents', (select round(avg(donation)) from this_g)::bigint,
      'median_gift_cents', (select round(percentile_cont(0.5) within group (order by donation)) from this_g)::bigint,
      'households', (select count(*) from givers)::integer,
      'households_same_point_last', (select count(distinct household_id) from same_g)::integer,
      'median_household_cents', (select round(percentile_cont(0.5) within group (order by this_c)) from givers)::bigint,
      'member_households', (select count(*) from app.households h where h.center_id = p_center and h.merged_into_id is null)::integer),
    'fees', jsonb_build_object(
      'this_cents', (select coalesce(sum(fee), 0) from gift where received_on between p_from and p_to)::bigint,
      'membership_cents', (select coalesce(sum(membership), 0) from gift where received_on between p_from and p_to)::bigint,
      'school_cents', (select coalesce(sum(school), 0) from gift where received_on between p_from and p_to)::bigint,
      'store_cents', (select coalesce(sum(store), 0) from gift where received_on between p_from and p_to)::bigint),
    'retention', jsonb_build_object(
      'kept', (select count(*) from hh where last_c > 0 and this_c > 0)::integer,
      'lost', (select count(*) from hh where last_c > 0 and this_c = 0)::integer,
      'new', (select count(*) from hh where this_c > 0 and first_on >= p_from)::integer,
      'regained', (select count(*) from hh where this_c > 0 and last_c = 0 and before)::integer),
    'concentration', jsonb_build_object(
      'households', (select count(*) from givers)::integer,
      'top_households', case when (select count(*) from givers) >= 10 then (select ceil(count(*) / 10.0) from givers)::integer end,
      'top_cents', case when (select count(*) from givers) >= 10
                        then (select coalesce(sum(this_c), 0) from givers where rn <= ceil(n / 10.0))::bigint end),
    'categories', jsonb_build_object(
      'fund', coalesce((select jsonb_agg(jsonb_build_object('key', id, 'label', label, 'this_cents', this_c, 'last_cents', last_c) order by rn)
                          from cat_named where kind = 'fund' and rn <= 25), '[]'::jsonb),
      'campaign', coalesce((select jsonb_agg(jsonb_build_object('key', id, 'label', label, 'this_cents', this_c, 'last_cents', last_c) order by rn)
                              from cat_named where kind = 'campaign' and rn <= 25), '[]'::jsonb),
      'opportunity', coalesce((select jsonb_agg(jsonb_build_object('key', id, 'label', label, 'this_cents', this_c, 'last_cents', last_c) order by rn)
                                 from cat_named where kind = 'opportunity' and rn <= 25), '[]'::jsonb),
      'applied_this_cents', (select this_c from applied),
      'applied_last_cents', (select last_c from applied)),
    'recurring', jsonb_build_object(
      'this_cents', (select recurring_c from applied),
      'active_gifts', (select count(*) from app.recurring_gifts r where r.center_id = p_center and r.status = 'active')::integer),
    'pledges', jsonb_build_object(
      'made', (select count(*) from made)::integer,
      'pledged_cents', (select coalesce(sum(amount_cents), 0) from made)::bigint,
      'paid_cents', (select coalesce(sum(paid_cents), 0) from made)::bigint,
      'written_off_cents', (select coalesce(sum(amount_cents - paid_cents), 0) from made where status = 'written_off')::bigint,
      'ageing', (select jsonb_agg(jsonb_build_object('bucket', b.key, 'pledges', coalesce(x.n, 0), 'open_cents', coalesce(x.c, 0)) order by b.ord)
                   from (values (0, 'not_due'), (1, '1_30'), (2, '31_60'), (3, '61_90'), (4, 'over_90')) b(ord, key)
                   left join (select case when v_today - due < 1 then 0 when v_today - due <= 30 then 1 when v_today - due <= 60 then 2
                                          when v_today - due <= 90 then 3 else 4 end as ord,
                                     count(*)::integer as n, sum(open_cents)::bigint as c
                                from open_p group by 1) x on x.ord = b.ord)),
    'pipeline', jsonb_build_object(
      'overdue_cents', (select coalesce(sum(open_cents), 0) from open_p where due < v_today)::bigint,
      'overdue_pledges', (select count(*) from open_p where due < v_today)::integer,
      'months', (select jsonb_agg(jsonb_build_object('month', to_char(mm.first_day, 'YYYY-MM'), 'pledges', coalesce(x.n, 0), 'open_cents', coalesce(x.c, 0))
                                  order by mm.first_day)
                   from (select (date_trunc('month', v_today) + make_interval(months => m))::date as first_day from generate_series(0, 11) m) mm
                   left join (select date_trunc('month', due)::date as first_day, count(*)::integer as n, sum(open_cents)::bigint as c
                                from open_p where due >= v_today group by 1) x on x.first_day = mm.first_day),
      'later_cents', (select coalesce(sum(open_cents), 0) from open_p
                        where due >= (date_trunc('month', v_today) + interval '12 months')::date)::bigint),
    'months', (select jsonb_agg(jsonb_build_object(
                        'month', to_char(mo.first_day, 'YYYY-MM'),
                        'this_cents', (select coalesce(sum(donation), 0) from gift
                                        where donation > 0 and received_on >= mo.first_day and received_on < (mo.first_day + interval '1 month')::date
                                          and received_on <= p_to)::bigint,
                        'last_cents', (select coalesce(sum(donation), 0) from gift
                                        where donation > 0 and received_on >= (mo.first_day - interval '1 year')::date
                                          and received_on < (mo.first_day - interval '1 year' + interval '1 month')::date)::bigint)
                      order by mo.m)
                 from months mo),
    'goals', coalesce((select jsonb_agg(jsonb_build_object('key', g.id, 'label', g.name, 'goal_cents', g.goal_cents, 'starts_on', g.starts_on,
                                                           'ends_on', g.ends_on, 'pledged_cents', g.pledged_c, 'paid_cents', g.paid_c)
                                        order by g.ends_on nulls last, g.name)
                         from (select * from goals order by ends_on nulls last, name limit 20) g), '[]'::jsonb)
  ) into v;
  return v;
end $$;

revoke execute on function app.giving_insights(uuid, date, date, date) from public, anon;
grant execute on function app.giving_insights(uuid, date, date, date) to authenticated;

comment on function app.giving_insights(uuid, date, date, date) is
  'Giving > Insights (0749, B98 slice 1): one year of the community''s giving as aggregates only (donations, gifts, average and '
  'median, giving households, participation, retention kept/lost/new/regained, the top tenth''s share with the under-10 rule, '
  'by fund/campaign/opportunity, recurring share, pledge fulfilment and ageing, pipeline by due month, months, campaign goals; '
  'fees split out; opening balances, failed, voided and authorized payments left out). Integer cents. No household id, no '
  'name, no person. Needs giving.view or giving.manage and the giving_insights module. Security definer. Read only.';

select app.activity_register('screen:/giving/insights', 'screen', 'portal', 'Giving insights');
