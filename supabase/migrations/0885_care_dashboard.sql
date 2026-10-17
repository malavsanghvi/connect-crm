-- 0885 · DonorDelight slice 4, part 2: the organization's own numbers (docs/DONORDELIGHT.md sections 6 and 12; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.care_dashboard(center)   for care.view and care.manage (a relationship owner, care.own, sees households, not the organization's
--       totals): counts only, no household, no name and no amount, so no giving role is needed beyond the care key.
--         giving      the last 12 months against the 12 before (0882's gift rule, households, not payments):
--                       donors_last, donors_prev   households that gave in each window
--                       kept                       gave in both
--                       lybunt                     gave the year before, not in the last 12 months ("last year but not this")
--                       sybunt                     gave at some time before the last 12 months, not in the last 12 ("some year but not this")
--                       retention                  kept / donors_prev, or null when nobody gave the year before
--                       first_year                 the households whose first gift ever fell in the year before: how many, how many gave
--                                                  again in the last 12 months, and the share (null with no one in the group)
--         thanks      the thank-you speed of the last 90 days (0883's summary), or null before the rules are saved
--         touches     the personal touches that went well in the last 12 months: asks, no-ask touches and no-ask per ask (null with no ask)
--         key         key households (a gift in the last 24 months, or a care profile), and how many have an owner who still holds a care key
--         history_months   months of records in Weaver (0884). A share that compares two years needs about two: the portal says "not enough
--                       history yet" below that instead of showing a number that would mislead.
--   The read is logged (who, when, what; never names).
set client_min_messages = warning;

create or replace function app.care_dashboard(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_today date; v_giving boolean; v_thanks boolean; v_out jsonb; v_g jsonb := null; v_t jsonb := null; v_touch jsonb; v_key jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if not app.care_can(p_center, 'view') then perform app._care_refuse(p_center); end if;
  v_today := app._care_today(p_center);
  v_giving := app.module_enabled(p_center, 'giving');
  v_thanks := v_giving and exists (select 1 from app.care_settings s where s.center_id = p_center);

  if v_giving then
    with h as (
      select g.household_id,
             bool_or(g.received_on > v_today - 365 and g.received_on <= v_today) as last12,
             bool_or(g.received_on > v_today - 730 and g.received_on <= v_today - 365) as prev12,
             bool_or(g.received_on <= v_today - 365) as before_last,
             min(g.received_on) as first_on
        from app._care_gifts(p_center) g
       where g.received_on <= v_today
       group by g.household_id
    )
    select jsonb_build_object(
             'donors_last', count(*) filter (where h.last12),
             'donors_prev', count(*) filter (where h.prev12),
             'kept', count(*) filter (where h.last12 and h.prev12),
             'lybunt', count(*) filter (where h.prev12 and not h.last12),
             'sybunt', count(*) filter (where h.before_last and not h.last12),
             'retention', case when count(*) filter (where h.prev12) = 0 then null
                               else round((count(*) filter (where h.last12 and h.prev12))::numeric / (count(*) filter (where h.prev12)), 3) end,
             'first_year', jsonb_build_object(
               'cohort', count(*) filter (where h.first_on > v_today - 730 and h.first_on <= v_today - 365),
               'kept', count(*) filter (where h.first_on > v_today - 730 and h.first_on <= v_today - 365 and h.last12),
               'rate', case when count(*) filter (where h.first_on > v_today - 730 and h.first_on <= v_today - 365) = 0 then null
                            else round((count(*) filter (where h.first_on > v_today - 730 and h.first_on <= v_today - 365 and h.last12))::numeric
                                       / (count(*) filter (where h.first_on > v_today - 730 and h.first_on <= v_today - 365)), 3) end))
      into v_g from h;
  end if;

  if v_thanks then
    perform app._care_thanks_sync(p_center);
    select jsonb_build_object(
             'gifts', count(*), 'thanked', count(*) filter (where m.thanked_at is not null),
             'open', count(*) filter (where m.thanked_at is null), 'overdue', count(*) filter (where m.thanked_at is null and m.due_on < v_today),
             'median_hours', round((percentile_cont(0.5) within group (order by extract(epoch from (m.thanked_at - m.started_at)) / 3600.0)
                                      filter (where m.thanked_at is not null))::numeric, 1),
             'on_time_share', case when count(*) filter (where m.thanked_at is not null or m.due_on < v_today) = 0 then null
                                   else round((count(*) filter (where m.thanked_at is not null
                                                                  and m.thanked_at < ((m.due_on + 1)::timestamp at time zone coalesce((select c.time_zone from app.centers c where c.id = p_center), 'America/Chicago'))))::numeric
                                               / (count(*) filter (where m.thanked_at is not null or m.due_on < v_today)), 3) end)
      into v_t
      from app._care_thanks_mine(p_center) m
     where m.set_aside_at is null and m.gift_on >= v_today - 90;
  end if;

  select jsonb_build_object(
           'asks', count(*) filter (where t.is_ask), 'no_ask', count(*) filter (where not t.is_ask),
           'per_ask', case when count(*) filter (where t.is_ask) = 0 then null
                           else round((count(*) filter (where not t.is_ask))::numeric / (count(*) filter (where t.is_ask)), 1) end)
    into v_touch
    from app.care_touches t
   where t.center_id = p_center and t.voided_at is null and t.outcome = 'done' and t.touched_at > now() - interval '365 days';

  with key_h as (
    select x.household_id from (
      select g.household_id from app._care_gifts(p_center) g where v_giving and g.received_on > v_today - 730 and g.received_on <= v_today
      union
      select p.household_id from app.care_profiles p where p.center_id = p_center) x
  ),
  holders as (
    select distinct o.owner_user_id as u from app.care_owners o where o.center_id = p_center and o.owner_user_id is not null and app._care_holder(p_center, o.owner_user_id)
  )
  select jsonb_build_object(
           'households', (select count(*) from key_h),
           'with_owner', (select count(*) from key_h k join app.care_owners o on o.household_id = k.household_id
                           where o.owner_user_id in (select u from holders)),
           'share', case when (select count(*) from key_h) = 0 then null
                         else round(((select count(*) from key_h k join app.care_owners o on o.household_id = k.household_id
                                       where o.owner_user_id in (select u from holders)))::numeric / (select count(*) from key_h), 3) end)
    into v_key;

  v_out := jsonb_build_object('state', 'ok', 'today', v_today, 'history_months', app._care_history_months(p_center),
                              'giving', v_g, 'thanks', v_t, 'touches', v_touch, 'key', v_key);
  perform app.log_private_read(p_center, 'care', 'dashboard', 1);
  return v_out;
end $$;

revoke execute on function app.care_dashboard(uuid) from public, anon;
grant execute on function app.care_dashboard(uuid) to authenticated, service_role;
