-- 0883 · DonorDelight slice 3, part 3: what the screens read (docs/DONORDELIGHT.md sections 5.4, 6 and 12; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Four read functions, the only way the portal reads the thank-you tracker. Each checks the caller with 0760's rule (built on
--   app.care_can: no platform-admin branch), answers "You don't have access to this area." otherwise, opens the steps that are missing
--   (0882), and writes one app.log_private_read entry (who, when, what and how many rows, never names).
--     app.care_thanks_queue(center, filter, limit, offset)   the thank-you list: open (due first), overdue, done (the last 30 days) or set
--                                                            aside, with the counts of each. Household cards show adults only.
--     app.care_thanks_summary(center, days)                  how fast gifts are thanked: gifts, thanked, open, overdue, the median hours
--                                                            to a thank-you and the share thanked within the window
--     app.care_household_thanks(household)                   the open steps of one household, for the Care card
--     app.care_thanks_counts(center)                         three numbers for Home's task row (open, overdue, personal), no names, not logged
--   WHO SEES WHICH. care.view and care.manage: every household. care.own: only the households they own or back up. A gift AMOUNT
--   appears only with app.care_amounts_can (a care key AND giving.view or giving.manage); without it the field is null and the screens
--   say "Thank them warmly". Nothing about anyone under 18 is read: the household card lists adults only, and a gift whose payer is
--   under 18 never opens a step (0882).
--   States: not_set_up (the rules are not saved yet: a manager is told to set them), giving_off (Giving is off: no gifts to thank).
set client_min_messages = warning;

-- The steps the caller may see, with when they were thanked. Private helper: the reads below check access first.
create or replace function app._care_thanks_mine(p_center uuid)
returns table (id uuid, household_id uuid, payment_id uuid, gift_on date, due_on date, needs_personal boolean,
               set_aside_at timestamptz, set_aside_reason text, thanked_at timestamptz, how text, started_at timestamptz)
language sql stable security definer set search_path = app, public, extensions as $$
  select t.id, p.household_id, t.payment_id, t.gift_on, t.due_on, t.needs_personal, t.set_aside_at, t.set_aside_reason, th.thanked_at, th.how,
         greatest((t.gift_on::timestamp at time zone coalesce((select c.time_zone from app.centers c where c.id = p_center), 'America/Chicago')), p.created_at)
    from app.care_thanks t
    join app.payments p on p.id = t.payment_id
    left join app._care_thanked(p_center) th on th.thank_id = t.id
   where t.center_id = p_center
     and (app.care_can(p_center, 'view') or p.household_id = any (app.care_my_households()))
$$;
revoke execute on function app._care_thanks_mine(uuid) from public, anon, authenticated;

create or replace function app.care_thanks_queue(p_center uuid, p_filter text default 'open', p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_settings; v_filter text; v_limit integer; v_offset integer; v_today date; v_amounts boolean; v_rows jsonb; v_total integer; v_counts jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  v_filter := coalesce(nullif(btrim(p_filter), ''), 'open');
  if v_filter not in ('open', 'overdue', 'done', 'set_aside') then
    raise exception 'Show the open, overdue, done or set-aside thank-yous.' using errcode = '22023';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  select * into s from app.care_settings where center_id = p_center;
  if s.center_id is null then
    perform app.log_private_read(p_center, 'care', 'thanks_queue', 0);
    return jsonb_build_object('state', 'not_set_up', 'can_manage', app.care_settings_can(p_center));
  end if;
  if not app.module_enabled(p_center, 'giving') then
    perform app.log_private_read(p_center, 'care', 'thanks_queue', 0);
    return jsonb_build_object('state', 'giving_off');
  end if;
  perform app._care_thanks_sync(p_center);
  v_today := app._care_today(p_center);
  v_amounts := app.care_amounts_can(p_center);

  select jsonb_build_object(
           'open', count(*) filter (where m.set_aside_at is null and m.thanked_at is null),
           'overdue', count(*) filter (where m.set_aside_at is null and m.thanked_at is null and m.due_on < v_today),
           'personal_open', count(*) filter (where m.set_aside_at is null and m.thanked_at is null and m.needs_personal),
           'done', count(*) filter (where m.set_aside_at is null and m.thanked_at is not null and m.thanked_at >= now() - interval '30 days'),
           'set_aside', count(*) filter (where m.set_aside_at is not null))
    into v_counts from app._care_thanks_mine(p_center) m;

  with f as (
    select m.*
      from app._care_thanks_mine(p_center) m
     where case v_filter
             when 'open' then m.set_aside_at is null and m.thanked_at is null
             when 'overdue' then m.set_aside_at is null and m.thanked_at is null and m.due_on < v_today
             when 'done' then m.set_aside_at is null and m.thanked_at is not null and m.thanked_at >= now() - interval '30 days'
             else m.set_aside_at is not null end
  ),
  gifts as (select g.payment_id, g.donation_cents from app._care_gifts(p_center) g where v_amounts),
  page as (
    select f.* from f
     order by case when v_filter in ('open', 'overdue') then f.due_on end asc nulls last,
              case when v_filter in ('open', 'overdue') then f.started_at end asc nulls last,
              case when v_filter = 'done' then f.thanked_at end desc nulls last,
              case when v_filter = 'set_aside' then f.set_aside_at end desc nulls last, f.id
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', pg.id,
           'household', app._care_household_head(pg.household_id),
           'gift_on', pg.gift_on, 'due_on', pg.due_on,
           'overdue', pg.set_aside_at is null and pg.thanked_at is null and pg.due_on < v_today,
           'days_overdue', case when pg.set_aside_at is null and pg.thanked_at is null and pg.due_on < v_today then v_today - pg.due_on end,
           'needs_personal', pg.needs_personal,
           'amount_cents', case when v_amounts then (select g.donation_cents from gifts g where g.payment_id = pg.payment_id) end,
           'thanked_at', pg.thanked_at, 'how', pg.how,
           'set_aside_at', pg.set_aside_at, 'set_aside_reason', pg.set_aside_reason)
         order by case when v_filter in ('open', 'overdue') then pg.due_on end asc nulls last,
                  case when v_filter in ('open', 'overdue') then pg.started_at end asc nulls last,
                  case when v_filter = 'done' then pg.thanked_at end desc nulls last,
                  case when v_filter = 'set_aside' then pg.set_aside_at end desc nulls last, pg.id), '[]'::jsonb),
         (select count(*)::integer from f)
    into v_rows, v_total
    from page pg;

  perform app.log_private_read(p_center, 'care', 'thanks_queue', jsonb_array_length(v_rows));
  return jsonb_build_object(
    'state', 'ok', 'filter', v_filter, 'rows', v_rows, 'total', v_total, 'counts', v_counts,
    'window_days', s.thank_window_days, 'amounts', v_amounts, 'today', v_today,
    'limit', v_limit, 'offset', v_offset, 'can_manage', app.care_settings_can(p_center));
end $$;

create or replace function app.care_thanks_summary(p_center uuid, p_days integer default 90) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_settings; v_days integer; v_today date; v_tz text; v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  v_days := least(greatest(coalesce(p_days, 90), 7), 730);
  select * into s from app.care_settings where center_id = p_center;
  if s.center_id is null then
    perform app.log_private_read(p_center, 'care', 'thanks_summary', 0);
    return jsonb_build_object('state', 'not_set_up', 'can_manage', app.care_settings_can(p_center));
  end if;
  if not app.module_enabled(p_center, 'giving') then
    perform app.log_private_read(p_center, 'care', 'thanks_summary', 0);
    return jsonb_build_object('state', 'giving_off');
  end if;
  perform app._care_thanks_sync(p_center);
  v_today := app._care_today(p_center);
  v_tz := coalesce((select c.time_zone from app.centers c where c.id = p_center), 'America/Chicago');

  select jsonb_build_object(
           'state', 'ok', 'days', v_days, 'window_days', s.thank_window_days,
           'gifts', count(*),
           'thanked', count(*) filter (where m.thanked_at is not null),
           'open', count(*) filter (where m.thanked_at is null),
           'overdue', count(*) filter (where m.thanked_at is null and m.due_on < v_today),
           'median_hours', round((percentile_cont(0.5) within group (order by extract(epoch from (m.thanked_at - m.started_at)) / 3600.0)
                                    filter (where m.thanked_at is not null))::numeric, 1),
           -- Of the gifts whose time is up (thanked, or past their due day), the share thanked by the end of the due day.
           'on_time_share', case when count(*) filter (where m.thanked_at is not null or m.due_on < v_today) = 0 then null
                                 else round((count(*) filter (where m.thanked_at is not null and m.thanked_at < ((m.due_on + 1)::timestamp at time zone v_tz)))::numeric
                                             / (count(*) filter (where m.thanked_at is not null or m.due_on < v_today)), 3) end)
    into v_out
    from app._care_thanks_mine(p_center) m
   where m.set_aside_at is null and m.gift_on >= v_today - v_days;

  perform app.log_private_read(p_center, 'care', 'thanks_summary', (v_out->>'gifts')::integer);
  return v_out;
end $$;

create or replace function app.care_household_thanks(p_household uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_today date; v_amounts boolean; v_rows jsonb; s app.care_settings;
begin
  v_center := app._care_household_or_raise(p_household);
  select * into s from app.care_settings where center_id = v_center;
  if s.center_id is null then
    perform app.log_private_read(v_center, 'care', 'household_thanks', 0);
    return jsonb_build_object('state', 'not_set_up', 'open', '[]'::jsonb, 'can_manage', app.care_settings_can(v_center));
  end if;
  if not app.module_enabled(v_center, 'giving') then
    perform app.log_private_read(v_center, 'care', 'household_thanks', 0);
    return jsonb_build_object('state', 'giving_off', 'open', '[]'::jsonb);
  end if;
  perform app._care_thanks_sync(v_center);
  v_today := app._care_today(v_center);
  v_amounts := app.care_amounts_can(v_center);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'gift_on', m.gift_on, 'due_on', m.due_on, 'overdue', m.due_on < v_today,
           'needs_personal', m.needs_personal,
           'amount_cents', case when v_amounts then (select g.donation_cents from app._care_gifts(v_center) g where g.payment_id = m.payment_id) end)
         order by m.due_on, m.id), '[]'::jsonb)
    into v_rows
    from app._care_thanks_mine(v_center) m
   where m.household_id = p_household and m.set_aside_at is null and m.thanked_at is null;
  perform app.log_private_read(v_center, 'care', 'household_thanks', jsonb_array_length(v_rows));
  return jsonb_build_object('state', 'ok', 'open', v_rows, 'amounts', v_amounts, 'window_days', s.thank_window_days);
end $$;

-- Home's "gifts to thank": three numbers for the households the caller may see, no names and no list, so it is not logged as a read of a
-- care record. The steps that are missing are opened first, as for the list.
create or replace function app.care_thanks_counts(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.care_settings; v_today date; v_out jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  select * into s from app.care_settings where center_id = p_center;
  if s.center_id is null then return jsonb_build_object('state', 'not_set_up'); end if;
  if not app.module_enabled(p_center, 'giving') then return jsonb_build_object('state', 'giving_off'); end if;
  perform app._care_thanks_sync(p_center);
  v_today := app._care_today(p_center);
  select jsonb_build_object(
           'state', 'ok',
           'open', count(*) filter (where m.set_aside_at is null and m.thanked_at is null),
           'overdue', count(*) filter (where m.set_aside_at is null and m.thanked_at is null and m.due_on < v_today),
           'personal_open', count(*) filter (where m.set_aside_at is null and m.thanked_at is null and m.needs_personal))
    into v_out from app._care_thanks_mine(p_center) m;
  return v_out;
end $$;

revoke execute on function app.care_thanks_queue(uuid, text, integer, integer), app.care_thanks_summary(uuid, integer), app.care_household_thanks(uuid), app.care_thanks_counts(uuid)
  from public, anon;
grant execute on function app.care_thanks_queue(uuid, text, integer, integer), app.care_thanks_summary(uuid, integer), app.care_household_thanks(uuid), app.care_thanks_counts(uuid)
  to authenticated, service_role;
