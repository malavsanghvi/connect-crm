-- 0780 · Scheduled emails: "made on or after" is a date on the community's own calendar (fix for 0771).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   A scheduled email for pledges due soon or past due can leave out pledges made before a date ("made on or after").
--   0771 compared the moment a pledge was made with midnight of that date in UTC, not in the community's time zone. For a
--   community west of UTC, a pledge made in the evening counted as made the next day, so near midnight the wrong households
--   could be included or left out (and test 171 failed every night between 00:00 and 05:00 UTC).
--   Now the pledge's moment is turned into a date in the community's own time zone (app.centers.time_zone, UTC when unset)
--   before it is compared. Nothing else changes: the same function, the same arguments, the same rules for imported pledges,
--   fees, the due window and gifts.
--
--   create or replace keeps the function's owner and its grants; they are said again below, as 0771 set them.

create or replace function app._email_audience(p_center uuid, p_audience text, p_params jsonb, p_today date, p_from date, p_to date)
returns table (household_id uuid, data jsonb)
language sql stable security definer set search_path = app, public, extensions as $$
  with pl as (
    select p.household_id as hid, p.pledge_number, p.amount_cents - p.paid_cents as balance, p.due_on,
           coalesce((select o.name from app.opportunities o where o.id = p.opportunity_id),
                    (select cp.name from app.campaigns cp where cp.id = p.campaign_id),
                    (select f.name from app.funds f where f.id = p.fund_id)) as for_what
      from app.pledges p
     where p_audience in ('pledges_due_soon', 'pledges_past_due')
       and p.center_id = p_center and p.status in ('open', 'partially_paid') and p.amount_cents > p.paid_cents
       and p.due_on is not null and app._email_pledge_source_ok(p.source)
       and (coalesce((p_params->>'include_imported')::boolean, false) or not app._email_imported(p.center_id, 'pledges', p.id, p.crm_external_id))
       and (nullif(p_params->>'since', '') is null
            or (p.pledged_at at time zone coalesce((select c.time_zone from app.centers c where c.id = p_center), 'UTC'))::date
               >= (p_params->>'since')::date)
       and case when p_audience = 'pledges_due_soon'
                then p.due_on between p_today and p_today + coalesce((p_params->>'days')::int, 7)
                else p.due_on < p_today end
  ), gifts as (
    select pay.household_id as hid, pay.received_on, pay.amount_cents - pay.refunded_cents as amount,
           (select string_agg(distinct coalesce(f.name, cp.name), ', ')
              from app.payment_allocations al join app.pledges p2 on p2.id = al.pledge_id
              left join app.funds f on f.id = p2.fund_id left join app.campaigns cp on cp.id = p2.campaign_id
             where al.payment_id = pay.id) as for_what
      from app.payments pay
     where p_audience = 'gave_recently' and pay.center_id = p_center and app.statement_counted_status(pay.status)
       and not pay.is_opening_balance and not pay.is_historical and pay.amount_cents > pay.refunded_cents
       and not app._email_imported(pay.center_id, 'payments', pay.id, pay.crm_external_id)
       and pay.received_on >= p_from and pay.received_on < p_to
  )
  select pl.hid, jsonb_build_object(
           'pledges', jsonb_agg(jsonb_build_object('number', pl.pledge_number, 'for', pl.for_what, 'balance_cents', pl.balance, 'due_on', pl.due_on)
                                order by pl.due_on, pl.pledge_number),
           'count', count(*), 'balance_cents', sum(pl.balance), 'next_due', min(pl.due_on))
    from pl group by pl.hid
  union all
  select g.hid, jsonb_build_object(
           'gifts', jsonb_agg(jsonb_build_object('received_on', g.received_on, 'amount_cents', g.amount, 'for', g.for_what)
                              order by g.received_on),
           'count', count(*), 'total_cents', sum(g.amount), 'period_start', p_from, 'period_end', p_to - 1)
    from gifts g group by g.hid
$$;

revoke execute on function app._email_audience(uuid, text, jsonb, date, date, date) from public, anon, authenticated;
grant execute on function app._email_audience(uuid, text, jsonb, date, date, date) to service_role;
