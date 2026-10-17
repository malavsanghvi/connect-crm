-- 0884 · DonorDelight slice 4, part 1: what each household's health is worked out from (docs/DONORDELIGHT.md sections 6 and 12; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.care_health_facts(center, households)   for up to 100 households the caller may see: the plain facts, as counts and dates. The portal
--       turns them into a level and its reasons (src/lib/care/health.ts: arithmetic and wording, no AI, no score), so every sign can say WHY.
--       Per household:
--         gifts_12 / gifts_prev_12   gifts in the last 12 months and in the 12 before (0882's gift rule: donations that went through, less
--                                    refunds, never opening balances or history imports, never a payer under 18)
--         first_gift_on / last_gift_on
--         part_12 / last_part_on     adults who checked in at an event or worked a volunteer shift (the touch log's own rules, adults only,
--                                    each only for the days they lived in this household)
--         opened_12                  community messages an adult opened (never receipts, codes or learning messages)
--         touches_12 / asks_12 / no_ask_12 / last_touch_at   the personal touches people recorded that went well (voided ones never count)
--         unthanked                  open thank-you steps (null before the rules of 0881 are saved)
--       and for the community: today, and history_months, the months of records in Weaver (the earliest payment that is not an opening
--       balance, or the earliest touch), because a sign that needs history says "not enough history yet" until there is about a year.
--   NO AMOUNT is returned, so no giving role is needed beyond the care key. Whoever may see a household's care record (0760) may ask for
--   its facts; asking for one the caller may not see is refused for the whole call, so the answer never hints at who exists. Every read is
--   logged (who, when, how many; never names).
set client_min_messages = warning;

create or replace function app._care_history_months(p_center uuid) returns integer
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(
    (select (extract(year from age(app._care_today(p_center), f.d)) * 12 + extract(month from age(app._care_today(p_center), f.d)))::integer
       from (select least(
               (select min(p.received_on) from app.payments p
                 where p.center_id = p_center and not p.is_opening_balance and p.status in ('captured', 'settled', 'partially_refunded')),
               (select min(t.touched_at::date) from app.care_touches t where t.center_id = p_center and t.voided_at is null)) as d) f
      where f.d is not null), 0)
$$;
revoke execute on function app._care_history_months(uuid) from public, anon, authenticated;

create or replace function app.care_health_facts(p_center uuid, p_households uuid[]) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_today date; v_tz text; v_ids uuid[]; h uuid; v_rows jsonb; v_msgs boolean; v_events boolean; v_volunteers boolean; v_giving boolean; v_thanks boolean;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_households, '{}'::uuid[])) x where x is not null;
  if cardinality(v_ids) > 100 then raise exception 'Ask for at most 100 households at a time.' using errcode = '22023'; end if;
  foreach h in array v_ids loop
    if not exists (select 1 from app.households x where x.id = h and x.center_id = p_center) or not app.care_household_can(h) then
      perform app._care_refuse(p_center);
    end if;
  end loop;
  v_today := app._care_today(p_center);
  v_tz := coalesce((select nullif(c.time_zone, '') from app.centers c where c.id = p_center), 'America/Chicago');
  v_msgs := app._care_source_on(p_center, 'messages');
  v_events := app._care_source_on(p_center, 'attendees');
  v_volunteers := app._care_source_on(p_center, 'volunteer_assignments');
  v_giving := app.module_enabled(p_center, 'giving');
  v_thanks := v_giving and exists (select 1 from app.care_settings s where s.center_id = p_center);
  if v_thanks then perform app._care_thanks_sync(p_center); end if;

  with hh as (select unnest(v_ids) as household_id),
  gifts as (
    select g.household_id,
           count(*) filter (where g.received_on > v_today - 365 and g.received_on <= v_today) as gifts_12,
           count(*) filter (where g.received_on > v_today - 730 and g.received_on <= v_today - 365) as gifts_prev_12,
           min(g.received_on) as first_gift_on, max(g.received_on) as last_gift_on
      from app._care_gifts(p_center) g
     where v_giving and g.household_id = any (v_ids)
     group by g.household_id
  ),
  adults as (
    select hm.household_id, hm.person_id, coalesce(hm.joined_at, '-infinity'::date) as from_day, coalesce(hm.left_at, 'infinity'::date) as to_day
      from app.household_members hm
     where hm.household_id = any (v_ids) and not app.person_is_minor(hm.person_id)
  ),
  part as (
    select a.household_id, (a2.checked_in_at at time zone v_tz)::date as day
      from app.attendees a2 join adults a on a.person_id = a2.person_id
     where v_events and a2.center_id = p_center and a2.checked_in_at is not null and not a2.is_child_under_12
       and (a2.checked_in_at at time zone v_tz)::date between a.from_day and a.to_day
    union all
    select a.household_id, (coalesce(vs.starts_at, va.created_at) at time zone v_tz)::date
      from app.volunteer_assignments va
      join adults a on a.person_id = va.person_id
      join app.volunteer_shifts vs on vs.id = va.shift_id
     where v_volunteers and va.center_id = p_center
       and (va.status = 'completed' or (va.status = 'confirmed' and coalesce(vs.ends_at, vs.starts_at) < now()))
       and (coalesce(vs.starts_at, va.created_at) at time zone v_tz)::date between a.from_day and a.to_day
  ),
  part_s as (
    select p.household_id, count(*) filter (where p.day > v_today - 365 and p.day <= v_today) as part_12, max(p.day) filter (where p.day <= v_today) as last_part_on
      from part p group by p.household_id
  ),
  opened as (
    select a.household_id, count(*) as opened_12
      from app.messages m
      join adults a on a.person_id = m.person_id
      left join app.comms_campaigns cc on cc.id = m.campaign_id
     where v_msgs and m.center_id = p_center and m.opened_at is not null
       and m.channel in ('email', 'sms', 'whatsapp') and m.status in ('sent', 'delivered')
       and app._care_message_counts(m.purpose, cc.kind, m.campaign_id is not null, m.topic_key)
       and m.opened_at > now() - interval '365 days'
       and (m.opened_at at time zone v_tz)::date between a.from_day and a.to_day
     group by a.household_id
  ),
  touches as (
    select t.household_id,
           count(*) filter (where t.touched_at > now() - interval '365 days') as touches_12,
           count(*) filter (where t.touched_at > now() - interval '365 days' and t.is_ask) as asks_12,
           count(*) filter (where t.touched_at > now() - interval '365 days' and not t.is_ask) as no_ask_12,
           max(t.touched_at) as last_touch_at
      from app.care_touches t
     where t.household_id = any (v_ids) and t.voided_at is null and t.outcome = 'done'
     group by t.household_id
  ),
  unthanked as (
    select m.household_id, count(*) as n
      from app._care_thanks_mine(p_center) m
     where v_thanks and m.household_id = any (v_ids) and m.set_aside_at is null and m.thanked_at is null
     group by m.household_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'household_id', hh.household_id,
           'gifts_12', coalesce(g.gifts_12, 0), 'gifts_prev_12', coalesce(g.gifts_prev_12, 0),
           'first_gift_on', g.first_gift_on, 'last_gift_on', g.last_gift_on,
           'part_12', coalesce(ps.part_12, 0), 'last_part_on', ps.last_part_on,
           'opened_12', coalesce(o.opened_12, 0),
           'touches_12', coalesce(t.touches_12, 0), 'asks_12', coalesce(t.asks_12, 0), 'no_ask_12', coalesce(t.no_ask_12, 0), 'last_touch_at', t.last_touch_at,
           'unthanked', case when v_thanks then coalesce(u.n, 0) end)
         order by hh.household_id), '[]'::jsonb)
    into v_rows
    from hh
    left join gifts g on g.household_id = hh.household_id
    left join part_s ps on ps.household_id = hh.household_id
    left join opened o on o.household_id = hh.household_id
    left join touches t on t.household_id = hh.household_id
    left join unthanked u on u.household_id = hh.household_id;

  perform app.log_private_read(p_center, 'care', 'health', jsonb_array_length(v_rows));
  return jsonb_build_object('today', v_today, 'history_months', app._care_history_months(p_center), 'giving', v_giving, 'rows', v_rows);
end $$;

revoke execute on function app.care_health_facts(uuid, uuid[]) from public, anon;
grant execute on function app.care_health_facts(uuid, uuid[]) to authenticated, service_role;
