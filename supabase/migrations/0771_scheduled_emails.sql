-- 0771 · Scheduled emails: the community's own email to an audience it chooses (pledges due soon, pledges past due, givers since
-- the last run), at a set frequency in its own time zone, with each household's data merged in (plan GV-E, approved by the owner
-- 2026-10-13). Builds on 0770 (automatic emails).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Nothing is sent by this migration, and a scheduled email sends nothing until someone with comms.approve switches it on.
--
--   A scheduled email is an app.email_automations row of kind 'schedule': a name, an audience and its settings, how often
--   (every day; every week on a weekday; every month on day 1-28; every year on a date) at an hour of the community's own clock,
--   and its wording (app.message_templates, the community's own, a version per save, any language). Status draft -> active ->
--   paused. Any change to an active one puts it back to draft: it goes again only when someone with comms.approve switches it
--   on (owner decision 2026-10-13). Editing needs comms.send, switching on comms.approve, and both need giving.view or
--   giving.manage (the email says what households pledged or gave). Communications and Giving must both be on.
--
--   AUDIENCES (households; the email goes to each ADULT of the household with an email address, one email per adult per run)
--     pledges_due_soon   open pledges due in the next N days (1-60, 7 by default)
--     pledges_past_due   open pledges whose due date has passed
--       Both: fees, recurring gift cycles, store orders and registrations are left out (they have their own records and
--       messages), and imported pledges are left out unless "include imported" is ticked; "made on or after" a date is optional.
--     gave_recently      households that gave in the period before the run (the day, week, month or year before), with what
--                        they gave (payments that went through; imported history and opening balances left out)
--
--   SENDING: every 5 minutes the background service (messaging.email_schedules_sweep) asks which runs are due
--   (app.worker_email_schedules_due), takes the audience in batches (app.worker_email_schedule_batch), writes each household's
--   values (src/lib/merge/build.ts) and queues each email through app.worker_email_enqueue (0770) and app.enqueue_notice
--   (0598): purpose "notification" of the "giving" topic, so a member who switched giving emails off in the app, an address that
--   unsubscribed or opted out, a suppressed address and a person recorded as deceased get nothing, every email carries the
--   unsubscribe link, and a sandbox reaches only its verified test recipients. Once per household, adult and run (the period:
--   the run's date in the community's time zone), whatever happens. At most 500 emails per scheduled email in one sweep: a
--   larger audience goes on in the next sweeps of the same run, never twice. When the audience is done, the next run is set.
--   A run is claimed for 10 minutes by the sweep that takes it, so two sweeps at once never work on the same run. A run still
--   going when the next one is due is closed (what it sent stays sent) and the new one starts with its own date; a service
--   that was down runs once for the latest date, not once per missed date. Imported pledges and payments are those with a CRM
--   id or written by the import tool (app.import_keys).
--
--   DRY RUN: app.email_schedule_preview says how many households and adults it would go to now and why the others would not
--   (no email address, giving emails switched off, unsubscribed or opted out), with three households for the cards.
--
--   REDEFINED (latest bodies 0770): app._email_trigger_meta and app._email_placeholders gain the scheduled email's entries; nothing
--   else in them changes. No 2FA step anywhere (owner rule 2026-10-13). Test 171.
set client_min_messages = warning;

-- ══ The schedule's columns ═══════════════════════════════════════════════════
alter table app.email_automations
  add column if not exists name            text,
  add column if not exists audience        text,
  add column if not exists audience_params jsonb not null default '{}'::jsonb,
  add column if not exists frequency       text,
  add column if not exists day_of_week     integer,
  add column if not exists day_of_month    integer,
  add column if not exists month_of_year   integer,
  add column if not exists send_hour       integer,
  add column if not exists status          text not null default 'draft',
  add column if not exists approved_by     uuid references auth.users(id),
  add column if not exists approved_at     timestamptz,
  add column if not exists next_run_at     timestamptz,
  add column if not exists run_period      text,
  add column if not exists last_run_at     timestamptz,
  add column if not exists last_run        jsonb,
  add column if not exists run_claimed_until timestamptz;
alter table app.email_automations drop constraint if exists email_automations_status_check;
alter table app.email_automations add constraint email_automations_status_check check (status in ('draft', 'active', 'paused'));
alter table app.email_automations drop constraint if exists email_automations_schedule_check;
alter table app.email_automations add constraint email_automations_schedule_check check (
  kind <> 'schedule' or (
    name is not null and char_length(btrim(name)) between 1 and 120
    and audience in ('pledges_due_soon', 'pledges_past_due', 'gave_recently')
    and frequency in ('daily', 'weekly', 'monthly', 'yearly')
    and send_hour between 0 and 23
    and (frequency <> 'weekly' or day_of_week between 0 and 6)
    and (frequency not in ('monthly', 'yearly') or day_of_month between 1 and 28)
    and (frequency <> 'yearly' or month_of_year between 1 and 12)));
create index if not exists email_automations_due_idx on app.email_automations (next_run_at) where kind = 'schedule' and status = 'active';
comment on column app.email_automations.run_claimed_until is
  'The background service is working on this run until then (app.worker_email_schedules_due claims it; done or release clears it), so two sweeps never take the same run.';
comment on column app.email_automations.run_period is
  'A scheduled email''s run in progress: the run''s date in the community''s time zone (YYYY-MM-DD); null between runs. Each household and address gets one email per period (app.email_automation_sends).';

-- ══ What a scheduled email is (0770's bodies plus the schedule) ═════════════════
create or replace function app._email_trigger_meta(p_key text) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select case p_key
    when 'payment_receipt' then jsonb_build_object(
      'title', 'Receipt for a payment', 'module', 'giving', 'manage', 'giving.manage', 'view', jsonb_build_array('giving.view', 'giving.manage'),
      'template', 'payment_receipt', 'purpose', 'receipt', 'topic', null, 'wording_kind', 'donation_receipt', 'approval', true)
    when 'pledge_recorded' then jsonb_build_object(
      'title', 'Pledge confirmation', 'module', 'giving', 'manage', 'giving.manage', 'view', jsonb_build_array('giving.view', 'giving.manage'),
      'template', 'pledge_recorded', 'purpose', 'receipt', 'topic', null, 'wording_kind', 'pledge_confirmation', 'approval', true)
    when 'registration_confirmed' then jsonb_build_object(
      'title', 'Registration confirmation', 'module', 'events', 'manage', 'events.manage', 'view', jsonb_build_array('events.view', 'events.manage'),
      'template', 'registration_confirmed', 'purpose', 'notification', 'topic', 'events', 'wording_kind', null, 'approval', false)
    -- 0771: a scheduled email (its wording is its own row's template; Communications and Giving both on).
    when 'schedule' then jsonb_build_object(
      'title', 'Scheduled email', 'module', 'comms', 'manage', 'comms.send', 'view', jsonb_build_array('comms.view', 'comms.send', 'comms.approve'),
      'template', null, 'purpose', 'notification', 'topic', 'giving', 'wording_kind', null, 'approval', false)
  end
$$;

create or replace function app._email_placeholders(p_key text) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select case p_key
    when 'payment_receipt' then array['center_name', 'center_short_name', 'recipient_first_name', 'recipient_name', 'household_name', 'household_number', 'payment_amount', 'payment_date', 'payment_method', 'payment_receipt_number', 'payment_applied_to', 'payment_receipt_name', 'receipt_signed_by', 'receipt_note']
    when 'pledge_recorded' then array['center_name', 'center_short_name', 'recipient_first_name', 'recipient_name', 'household_name', 'household_number', 'pledge_amount', 'pledge_number', 'pledge_date', 'pledge_due_date', 'pledge_for', 'pledge_balance', 'pledge_signed_by', 'pledge_note']
    when 'registration_confirmed' then array['center_name', 'center_short_name', 'recipient_first_name', 'recipient_name', 'household_name', 'household_number', 'event_title', 'event_number', 'event_date', 'event_time', 'event_place', 'registration_count']
    -- 0771: scheduled emails, by audience.
    when 'schedule:pledges_due_soon' then array['center_name', 'center_short_name', 'recipient_first_name', 'recipient_name', 'household_name', 'household_number', 'pledges_list', 'pledges_count', 'pledges_balance', 'next_due_date']
    when 'schedule:pledges_past_due' then array['center_name', 'center_short_name', 'recipient_first_name', 'recipient_name', 'household_name', 'household_number', 'pledges_list', 'pledges_count', 'pledges_balance', 'next_due_date']
    when 'schedule:gave_recently' then array['center_name', 'center_short_name', 'recipient_first_name', 'recipient_name', 'household_name', 'household_number', 'gifts_list', 'gifts_count', 'gifts_total', 'gifts_period']
  end
$$;

-- Lists (one line per pledge or gift): in the email, never in the subject line.
create or replace function app._email_list_placeholders() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['pledges_list', 'gifts_list']
$$;

-- ══ Who, and when ═════════════════════════════════════════════════════════════
-- p_level: view (comms.view, comms.send or comms.approve), edit (comms.send), approve (comms.approve); each with giving.view
-- or giving.manage, because the email says what households pledged or gave.
create or replace function app._email_schedule_can(p_center uuid, p_level text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null
     and (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage'))
     and case p_level
           when 'view' then app.has_permission(p_center, 'comms.view') or app.has_permission(p_center, 'comms.send')
                         or app.has_permission(p_center, 'comms.approve') or app.has_permission(p_center, 'settings.manage')
           when 'edit' then app.has_permission(p_center, 'comms.send')
           when 'approve' then app.has_permission(p_center, 'comms.approve')
           else false end
$$;

create or replace function app._email_schedule_modules_on(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.module_enabled(p_center, 'comms') and app.module_enabled(p_center, 'giving')
$$;

create or replace function app._email_schedule_modules_message(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case when not app.module_enabled(p_center, 'comms') then 'Scheduled emails need the Communications module, which is switched off for this community.'
              when not app.module_enabled(p_center, 'giving') then 'Scheduled emails need the Giving module, which is switched off for this community.' end
$$;

-- The next moment a schedule goes after p_after, on the community's clock: the first matching day at the hour.
create or replace function app._email_schedule_next(p_frequency text, p_day_of_week int, p_day_of_month int, p_month int, p_hour int,
                                                   p_tz text, p_after timestamptz) returns timestamptz
language plpgsql stable set search_path = app, public, extensions as $$
declare v_tz text := coalesce(nullif(p_tz, ''), 'UTC'); v_local timestamp; v_day date; v_at timestamp; v_match boolean; i int;
begin
  v_local := p_after at time zone v_tz;
  for i in 0..400 loop
    v_day := v_local::date + i;
    v_at := v_day + make_interval(hours => coalesce(p_hour, 9));
    v_match := case p_frequency
                 when 'daily' then true
                 when 'weekly' then extract(dow from v_day)::int = p_day_of_week
                 when 'monthly' then extract(day from v_day)::int = p_day_of_month
                 when 'yearly' then extract(month from v_day)::int = p_month and extract(day from v_day)::int = p_day_of_month
                 else false end;
    if v_at > v_local and coalesce(v_match, false) then
      return v_at at time zone v_tz;
    end if;
  end loop;
  return null;
end $$;

-- The period a "givers since the last email" run covers: the day, week, month or year before the run's date.
create or replace function app._email_schedule_window(p_frequency text, p_run date) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object('from', case p_frequency when 'daily' then p_run - 1 when 'weekly' then p_run - 7
                                                     when 'yearly' then (p_run - interval '1 year')::date
                                                     else (p_run - interval '1 month')::date end,
                            'to', p_run)
$$;

-- An audience's settings, checked and with their defaults.
create or replace function app._email_schedule_params(p_audience text, p_params jsonb) returns jsonb
language plpgsql immutable set search_path = app, public, extensions as $$
declare v_days int; v_since date; v_imported boolean := coalesce((p_params->>'include_imported')::boolean, false);
begin
  if p_audience not in ('pledges_due_soon', 'pledges_past_due', 'gave_recently') then
    raise exception 'Choose who the email goes to.' using errcode = '22023';
  end if;
  if p_audience = 'gave_recently' then return '{}'::jsonb; end if;
  if nullif(btrim(coalesce(p_params->>'since', '')), '') is not null then
    begin
      v_since := (p_params->>'since')::date;
    exception when others then
      raise exception 'The "made on or after" date is not a date.' using errcode = '22023';
    end;
  end if;
  if p_audience = 'pledges_due_soon' then
    v_days := coalesce(nullif(p_params->>'days', '')::int, 7);
    if v_days < 1 or v_days > 60 then raise exception 'Choose between 1 and 60 days before the due date.' using errcode = '22023'; end if;
    return jsonb_build_object('days', v_days, 'since', v_since, 'include_imported', v_imported);
  end if;
  return jsonb_build_object('since', v_since, 'include_imported', v_imported);
end $$;

-- ══ The audiences: one row per household with what its email says ════════════
-- Imported = brought in with a CRM id, or by the import tool (every row it writes is in app.import_keys, 0192).
create index if not exists import_keys_record_idx on app.import_keys (center_id, table_name, record_id);
create or replace function app._email_imported(p_center uuid, p_table text, p_id uuid, p_crm_external_id text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_crm_external_id is not null
      or exists (select 1 from app.import_keys k where k.center_id = p_center and k.table_name = p_table and k.record_id = p_id::text)
$$;


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
       and (nullif(p_params->>'since', '') is null or p.pledged_at >= (p_params->>'since')::date)
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

-- One household as a scheduled email sees it (the household card's facts the email may say; children's first names to keep out).
create or replace function app._email_schedule_household(p_household uuid, p_majority int) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('id', h.id, 'name', h.display_name, 'number', h.household_number,
                            'minor_first_names', app._email_minor_first_names(h.id, p_majority))
    from app.households h where h.id = p_household
$$;

create or replace function app._email_center_facts(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('name', c.name, 'short_name', coalesce(nullif(btrim(c.short_name), ''), c.name), 'currency', c.currency,
                            'time_zone', c.time_zone, 'country', c.country,
                            'languages', to_jsonb(coalesce(nullif((select p.languages from app.org_profiles p where p.center_id = c.id), '{}'::text[]), array['en']::text[])))
    from app.centers c where c.id = p_center
$$;

-- ══ The screen ═════════════════════════════════════════════════════════════════
-- Who it would go to now, and why the others would not; three households for the cards and one household's facts for the preview.
create or replace function app.email_schedule_preview(p_center uuid, p_audience text, p_params jsonb, p_frequency text,
                                                      p_majority int default 18) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_params jsonb; v_today date; v_window jsonb; v_maj int := greatest(18, least(coalesce(p_majority, 18), 25)); v_out jsonb;
begin
  if not app._email_schedule_can(p_center, 'view') then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  if not app._email_schedule_modules_on(p_center) then raise exception '%', app._email_schedule_modules_message(p_center); end if;
  v_params := app._email_schedule_params(p_audience, p_params);
  v_today := (now() at time zone coalesce((select c.time_zone from app.centers c where c.id = p_center), 'UTC'))::date;
  v_window := app._email_schedule_window(coalesce(p_frequency, 'monthly'), v_today);
  with hh as (
    select a.household_id, a.data from app._email_audience(p_center, p_audience, v_params, v_today,
                                                          (v_window->>'from')::date, (v_window->>'to')::date) a
  ), rec as (
    select hh.household_id, r.value as r, nullif(r.value->>'person_id', '')::uuid as pid, r.value->>'address' as addr
      from hh cross join lateral jsonb_array_elements(app._email_recipients(hh.household_id, null, v_maj)) r
  ), judged as (
    select rec.*,
           exists (select 1 from app.notification_preferences np where np.person_id = rec.pid and np.topic_key = 'giving'
                     and np.channel = 'email' and not np.enabled) as switched_off,
           (app.message_suppression_for(p_center, 'email', rec.addr)).id is not null
             or (app.message_newsletter_suppression_for(p_center, 'email', rec.addr)).id is not null
             or coalesce((select not o.opted_in from app.channel_optins o
                           where o.center_id = p_center and o.channel = 'email' and lower(btrim(o.address)) = rec.addr
                           order by o.recorded_at desc limit 1), false) as unsubscribed
      from rec
  )
  select jsonb_build_object(
           'households', (select count(*) from hh),
           'adults', (select count(*) from judged),
           'would_send', (select count(*) from judged where not switched_off and not unsubscribed),
           'skipped', jsonb_build_object(
             'no_email', (select count(*) from hh where not exists (select 1 from rec where rec.household_id = hh.household_id)),
             'switched_off', (select count(*) from judged where switched_off),
             'unsubscribed', (select count(*) from judged where unsubscribed and not switched_off)),
           'sample_households', coalesce((select jsonb_agg(x.household_id) from (select distinct household_id from rec order by household_id limit 3) x), '[]'::jsonb),
           'sample', (select app._email_preview_facts(jsonb_build_object('center', app._email_center_facts(p_center),
                                                'household', app._email_schedule_household(hh.household_id, v_maj),
                                                'recipients', coalesce((select jsonb_agg(rr - 'address') from jsonb_array_elements(app._email_recipients(hh.household_id, null, v_maj)) rr), '[]'::jsonb),
                                                'data', hh.data))
                        from hh where exists (select 1 from rec where rec.household_id = hh.household_id)
                        order by hh.household_id limit 1))
    into v_out;
  return v_out;
end $$;

-- The community's scheduled emails, with their wording, their dry run and what the last run did.
create or replace function app.email_schedules_state(p_center uuid, p_majority int default 18) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_rows jsonb := '[]'::jsonb; a app.email_automations; v_preview jsonb;
begin
  if not app._email_schedule_can(p_center, 'view') then
    return jsonb_build_object('can_view', false, 'modules_on', app._email_schedule_modules_on(p_center), 'schedules', '[]'::jsonb);
  end if;
  if not app._email_schedule_modules_on(p_center) then
    return jsonb_build_object('can_view', true, 'modules_on', false, 'modules_message', app._email_schedule_modules_message(p_center), 'schedules', '[]'::jsonb);
  end if;
  for a in select * from app.email_automations where center_id = p_center and kind = 'schedule' order by created_at loop
    begin
      v_preview := app.email_schedule_preview(p_center, a.audience, a.audience_params, a.frequency, p_majority);
    exception when others then
      v_preview := jsonb_build_object('error', sqlerrm);
    end;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', a.id, 'name', a.name, 'audience', a.audience, 'params', a.audience_params, 'frequency', a.frequency,
      'day_of_week', a.day_of_week, 'day_of_month', a.day_of_month, 'month', a.month_of_year, 'hour', a.send_hour,
      'status', a.status, 'approved_at', a.approved_at,
      'approved_by_name', (select coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), u.email) from auth.users u where u.id = a.approved_by),
      'next_run_at', a.next_run_at, 'run_period', a.run_period, 'last_run_at', a.last_run_at, 'last_run', a.last_run,
      'wording', coalesce((select jsonb_agg(jsonb_build_object('language', t.language, 'subject', t.subject, 'body', t.body, 'version', t.version)
                                            order by t.language)
                             from (select distinct on (mt.language) mt.language, mt.subject, mt.body, mt.version
                                     from app.message_templates mt
                                    where mt.center_id = p_center and mt.key = a.template_key and mt.channel = 'email'
                                    order by mt.language, mt.version desc) t), '[]'::jsonb),
      'preview', v_preview,
      'week', (select jsonb_build_object('queued', count(*) filter (where s.outcome = 'queued'), 'skipped', count(*) filter (where s.outcome = 'skipped'))
                 from app.email_automation_sends s where s.automation_id = a.id and s.created_at > now() - interval '7 days')));
  end loop;
  return jsonb_build_object('can_view', true, 'modules_on', true,
                            'can_edit', app._email_schedule_can(p_center, 'edit'), 'can_approve', app._email_schedule_can(p_center, 'approve'),
                            'time_zone', (select c.time_zone from app.centers c where c.id = p_center), 'schedules', v_rows);
end $$;

-- Create a scheduled email, or change one (an active one goes back to draft until it is switched on again).
create or replace function app.save_email_schedule(p_center uuid, p_id uuid, p_name text, p_audience text, p_params jsonb, p_frequency text,
                                                   p_day_of_week int, p_day_of_month int, p_month int, p_hour int,
                                                   p_language text, p_subject text, p_body text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; v_id uuid := coalesce(p_id, gen_random_uuid()); v_params jsonb; v_name text := btrim(coalesce(p_name, ''));
        v_lang text := lower(btrim(coalesce(p_language, ''))); v_subject text := btrim(coalesce(p_subject, ''));
        v_body text := btrim(coalesce(p_body, ''), E' \t\r\n'); v_unknown text[]; v_lists text[]; v_last app.message_templates;
        v_template text; v_wording_changed boolean := false; v_config_changed boolean := true; v_was_active boolean := false;
        v_dow int; v_dom int; v_moy int;
begin
  if not app._email_schedule_can(p_center, 'edit') then
    raise exception 'Writing a scheduled email needs comms.send, and giving.view or giving.manage.' using errcode = 'insufficient_privilege';
  end if;
  if not app._email_schedule_modules_on(p_center) then raise exception '%', app._email_schedule_modules_message(p_center); end if;
  if v_name = '' then raise exception 'Give the scheduled email a name.' using errcode = '22023'; end if;
  if char_length(v_name) > 120 then raise exception 'Keep the name under 120 characters.' using errcode = '22023'; end if;
  v_params := app._email_schedule_params(p_audience, p_params);
  if p_frequency is null or p_frequency not in ('daily', 'weekly', 'monthly', 'yearly') then
    raise exception 'Choose how often it goes.' using errcode = '22023';
  end if;
  if p_hour is null or p_hour < 0 or p_hour > 23 then raise exception 'Choose the hour it goes.' using errcode = '22023'; end if;
  v_dow := case when p_frequency = 'weekly' then p_day_of_week end;
  v_dom := case when p_frequency in ('monthly', 'yearly') then p_day_of_month end;
  v_moy := case when p_frequency = 'yearly' then p_month end;
  if p_frequency = 'weekly' and (v_dow is null or v_dow < 0 or v_dow > 6) then raise exception 'Choose the day of the week.' using errcode = '22023'; end if;
  if p_frequency in ('monthly', 'yearly') and (v_dom is null or v_dom < 1 or v_dom > 28) then
    raise exception 'Choose a day of the month from 1 to 28 (every month has it).' using errcode = '22023';
  end if;
  if p_frequency = 'yearly' and (v_moy is null or v_moy < 1 or v_moy > 12) then raise exception 'Choose the month.' using errcode = '22023'; end if;
  -- The wording, as for an automatic email (0770), plus: a list is never in the subject line.
  if v_lang !~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$' then raise exception 'Choose the language this wording is in.' using errcode = '22023'; end if;
  if v_subject = '' then raise exception 'Write a subject line.' using errcode = '22023'; end if;
  if char_length(v_subject) > 200 then raise exception 'Keep the subject under 200 characters.' using errcode = '22023'; end if;
  if v_subject ~ '[\r\n]' then raise exception 'The subject is one line.' using errcode = '22023'; end if;
  if v_body = '' then raise exception 'Write the email.' using errcode = '22023'; end if;
  if char_length(v_body) > 20000 then raise exception 'Keep the email under 20,000 characters.' using errcode = '22023'; end if;
  select array_agg(distinct x[1] order by x[1]) into v_unknown
    from regexp_matches(v_subject || E'\n' || v_body, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') x
   where x[1] <> all (app._email_placeholders('schedule:' || p_audience));
  if v_unknown is not null then
    raise exception 'The wording uses {{%}}, which this email does not have. Choose from the list of placeholders.',
      array_to_string(v_unknown, '}}, {{') using errcode = '22023';
  end if;
  select array_agg(distinct x[1] order by x[1]) into v_lists
    from regexp_matches(v_subject, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') x
   where x[1] = any (app._email_list_placeholders());
  if v_lists is not null then
    raise exception '{{%}} is a list (one line each): use it in the email, not in the subject.', array_to_string(v_lists, '}}, {{')
      using errcode = '22023';
  end if;

  if p_id is not null then
    select * into a from app.email_automations where id = p_id for update;
    if a.id is null or a.center_id is distinct from p_center or a.kind <> 'schedule' then
      raise exception 'That scheduled email was not found.';
    end if;
    v_template := a.template_key;
    v_was_active := a.status = 'active';
    v_config_changed := a.name is distinct from v_name or a.audience is distinct from p_audience or a.audience_params is distinct from v_params
                        or a.frequency is distinct from p_frequency or a.day_of_week is distinct from v_dow
                        or a.day_of_month is distinct from v_dom or a.month_of_year is distinct from v_moy or a.send_hour is distinct from p_hour;
  else
    v_template := 'schedule_' || replace(v_id::text, '-', '');
  end if;

  select * into v_last from app.message_templates
   where center_id = p_center and key = v_template and channel = 'email' and language = v_lang
   order by version desc limit 1;
  v_wording_changed := v_last.id is null or v_last.subject is distinct from v_subject or v_last.body <> v_body;
  if not v_config_changed and not v_wording_changed then
    return jsonb_build_object('id', a.id, 'status', a.status, 'unchanged', true);
  end if;

  perform app.set_audit_context(case when p_id is null then 'Scheduled email created: ' else 'Scheduled email changed: ' end || v_name);
  if p_id is null then
    insert into app.email_automations (id, center_id, kind, template_key, enabled, name, audience, audience_params, frequency,
                                       day_of_week, day_of_month, month_of_year, send_hour, status)
    values (v_id, p_center, 'schedule', v_template, false, v_name, p_audience, v_params, p_frequency, v_dow, v_dom, v_moy, p_hour, 'draft')
    returning * into a;
  else
    -- Any change to an active schedule needs comms.approve again before it goes (owner decision 2026-10-13).
    update app.email_automations
       set name = v_name, audience = p_audience, audience_params = v_params, frequency = p_frequency, day_of_week = v_dow,
           day_of_month = v_dom, month_of_year = v_moy, send_hour = p_hour,
           status = case when status = 'active' then 'draft' else status end,
           enabled = false, approved_by = null, approved_at = null, next_run_at = null, run_period = null, run_claimed_until = null
     where id = p_id
    returning * into a;
  end if;
  if v_wording_changed then
    insert into app.message_templates (center_id, key, channel, language, subject, body, version)
    values (p_center, v_template, 'email', v_lang, v_subject, v_body, coalesce(v_last.version, 0) + 1);
  end if;
  return jsonb_build_object('id', a.id, 'status', a.status, 'unchanged', false, 'was_active', v_was_active);
end $$;

-- Switch a scheduled email on: comms.approve (the person who wrote it may be the one who approves it, as for newsletters).
create or replace function app.approve_email_schedule(p_center uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; v_tz text;
begin
  if not app._email_schedule_can(p_center, 'approve') then
    raise exception 'Switching a scheduled email on needs comms.approve, and giving.view or giving.manage.' using errcode = 'insufficient_privilege';
  end if;
  if not app._email_schedule_modules_on(p_center) then raise exception '%', app._email_schedule_modules_message(p_center); end if;
  select * into a from app.email_automations where id = p_id for update;
  if a.id is null or a.center_id is distinct from p_center or a.kind <> 'schedule' then raise exception 'That scheduled email was not found.'; end if;
  if not exists (select 1 from app.message_templates t where t.center_id = p_center and t.key = a.template_key and t.channel = 'email') then
    raise exception 'Write the email before switching it on.';
  end if;
  if a.status = 'active' then return jsonb_build_object('id', a.id, 'status', a.status, 'next_run_at', a.next_run_at); end if;
  select c.time_zone into v_tz from app.centers c where c.id = p_center;
  perform app.set_audit_context('Scheduled email switched on: ' || a.name);
  update app.email_automations
     set status = 'active', enabled = true, approved_by = auth.uid(), approved_at = now(), run_period = null, run_claimed_until = null,
         next_run_at = app._email_schedule_next(a.frequency, a.day_of_week, a.day_of_month, a.month_of_year, a.send_hour, v_tz, now())
   where id = a.id
  returning * into a;
  return jsonb_build_object('id', a.id, 'status', a.status, 'next_run_at', a.next_run_at);
end $$;

-- Pause: nothing more goes (a run in progress stops where it is) until it is switched on again.
create or replace function app.pause_email_schedule(p_center uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations;
begin
  if not (app._email_schedule_can(p_center, 'edit') or app._email_schedule_can(p_center, 'approve')) then
    raise exception 'Pausing a scheduled email needs comms.send or comms.approve, and giving.view or giving.manage.' using errcode = 'insufficient_privilege';
  end if;
  select * into a from app.email_automations where id = p_id for update;
  if a.id is null or a.center_id is distinct from p_center or a.kind <> 'schedule' then raise exception 'That scheduled email was not found.'; end if;
  if a.status <> 'active' then return jsonb_build_object('id', a.id, 'status', a.status); end if;
  perform app.set_audit_context('Scheduled email paused: ' || a.name);
  update app.email_automations set status = 'paused', enabled = false, next_run_at = null, run_period = null, run_claimed_until = null
   where id = a.id
  returning * into a;
  return jsonb_build_object('id', a.id, 'status', a.status);
end $$;

-- What a scheduled email did lately.
create or replace function app.email_schedule_log(p_center uuid, p_id uuid, p_limit int default 25) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app._email_schedule_can(p_center, 'view') then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', x.created_at, 'to', nullif(x.to_address, ''), 'outcome', x.outcome, 'reason', x.reason,
                                        'period', x.period, 'household_number', x.household_number, 'status', x.status,
                                        'failure', x.failure_reason, 'sent_at', x.sent_at) order by x.created_at desc)
      from (select s.created_at, s.to_address, s.outcome, s.reason, s.period, h.household_number, msg.status, msg.failure_reason, msg.sent_at
              from app.email_automation_sends s
              join app.email_automations a on a.id = s.automation_id
              left join app.households h on h.id = s.household_id
              left join app.messages msg on msg.id = s.message_id
             where a.id = p_id and a.center_id = p_center and a.kind = 'schedule'
             order by s.created_at desc
             limit greatest(1, least(coalesce(p_limit, 25), 100))) x), '[]'::jsonb);
end $$;

-- ══ The background service (connect_worker only) ════════════════════════════
-- The last scheduled moment that is not in the future, starting from p_from (a service that was down for days runs once, for
-- today, not once for each day it missed).
create or replace function app._email_schedule_catch_up(a app.email_automations, p_tz text) returns timestamptz
language plpgsql stable set search_path = app, public, extensions as $$
declare v_at timestamptz := a.next_run_at; v_next timestamptz; i int;
begin
  for i in 1..1000 loop
    v_next := app._email_schedule_next(a.frequency, a.day_of_week, a.day_of_month, a.month_of_year, a.send_hour, p_tz, v_at);
    exit when v_next is null or v_next > now();
    v_at := v_next;
  end loop;
  return v_at;
end $$;

-- What a run sent, for the last-run line.
create or replace function app._email_schedule_summary(p_automation uuid, p_period text) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object('period', p_period, 'queued', count(*) filter (where s.outcome = 'queued'),
                            'skipped', count(*) filter (where s.outcome = 'skipped'), 'at', now())
    from app.email_automation_sends s where s.automation_id = p_automation and s.period = p_period
$$;

-- The runs this call takes: those already going that nobody is working on, and those whose time has come (their period is
-- the run's date on the community's clock). Each is claimed for 10 minutes, so a second sweep at the same time takes none of
-- them. A run still going when the next one is due is closed (what it sent stays sent) and the new one starts; a run whose
-- Communications or Giving module is off is closed and waits for its next time. Returns only the runs this call claimed.
create or replace function app.worker_email_schedules_due(p_limit int default 20) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; v_tz text; v_at timestamptz; v_period text; v_out jsonb := '[]'::jsonb; v_sum jsonb;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  for a in select e.* from app.email_automations e
            where e.kind = 'schedule' and e.status = 'active'
              and (e.run_period is not null or e.next_run_at <= now())
              and (e.run_claimed_until is null or e.run_claimed_until < now())
            order by e.next_run_at nulls last
            limit greatest(1, least(coalesce(p_limit, 20), 100))
            for update skip locked loop
    select c.time_zone into v_tz from app.centers c where c.id = a.center_id;
    v_tz := coalesce(v_tz, 'UTC');
    if not app._email_schedule_modules_on(a.center_id) then
      update app.email_automations
         set run_period = null, run_claimed_until = null,
             next_run_at = app._email_schedule_next(a.frequency, a.day_of_week, a.day_of_month, a.month_of_year, a.send_hour, v_tz, now()),
             last_run = coalesce(case when a.run_period is not null then app._email_schedule_summary(a.id, a.run_period) end, '{}'::jsonb)
                        || jsonb_build_object('not_run', app._email_schedule_modules_message(a.center_id), 'at', now())
       where id = a.id;
      continue;
    end if;
    if a.run_period is not null
       and app._email_schedule_next(a.frequency, a.day_of_week, a.day_of_month, a.month_of_year, a.send_hour, v_tz, a.next_run_at) <= now() then
      -- Stale: the next run is due before this one finished. Close it; the next starts below with its own date.
      v_sum := app._email_schedule_summary(a.id, a.run_period);
      update app.email_automations
         set run_period = null, last_run_at = now(),
             last_run = v_sum || jsonb_build_object('not_run', 'The run of ' || a.run_period || ' did not finish before the next one was due, so it was closed.')
       where id = a.id;
      a.run_period := null;
    end if;
    if a.run_period is null then
      v_at := app._email_schedule_catch_up(a, v_tz);
      v_period := to_char(v_at at time zone v_tz, 'YYYY-MM-DD');
      update app.email_automations set run_period = v_period, next_run_at = v_at, run_claimed_until = now() + interval '10 minutes'
       where id = a.id;
    else
      v_period := a.run_period;
      update app.email_automations set run_claimed_until = now() + interval '10 minutes' where id = a.id;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('automation_id', a.id, 'period', v_period, 'audience', a.audience));
  end loop;
  return v_out;
end $$;

-- The service stops working on a run for now (the rate limit, or an error): another sweep may take it.
create or replace function app.worker_email_schedule_release(p_automation uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  update app.email_automations set run_claimed_until = null where id = p_automation and run_claimed_until is not null;
end $$;

-- The next households of a run that have nothing yet for this period, with their adults and their data. A household with no
-- adult who has an email address is written to the log once (and so is not handed out again).
create or replace function app.worker_email_schedule_batch(p_automation uuid, p_period text, p_majority int, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; v_run date; v_window jsonb; v_maj int := greatest(18, least(coalesce(p_majority, 18), 25));
        v_limit int := greatest(1, least(coalesce(p_limit, 100), 500)); v_out jsonb := '[]'::jsonb; v_rec jsonb; v_seen int := 0; hh record;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into a from app.email_automations where id = p_automation;
  if a.id is null or a.kind <> 'schedule' then return jsonb_build_object('households', '[]'::jsonb, 'more', false, 'stop', 'The scheduled email no longer exists.'); end if;
  if a.status <> 'active' or a.run_period is distinct from p_period then
    return jsonb_build_object('households', '[]'::jsonb, 'more', false, 'stop', 'The scheduled email was paused or changed during the run.');
  end if;
  if not app._email_schedule_modules_on(a.center_id) then
    return jsonb_build_object('households', '[]'::jsonb, 'more', false, 'stop', app._email_schedule_modules_message(a.center_id));
  end if;
  v_run := p_period::date;
  v_window := app._email_schedule_window(a.frequency, v_run);
  for hh in select au.household_id, au.data
              from app._email_audience(a.center_id, a.audience, a.audience_params, v_run, (v_window->>'from')::date, (v_window->>'to')::date) au
             where not exists (select 1 from app.email_automation_sends s
                                where s.automation_id = a.id and s.period = p_period and s.ref_id = au.household_id)
             order by au.household_id limit v_limit loop
    v_seen := v_seen + 1;
    v_rec := app._email_recipients(hh.household_id, null, v_maj);
    if jsonb_array_length(v_rec) = 0 then
      insert into app.email_automation_sends (center_id, automation_id, ref_id, period, household_id, to_address, outcome, reason)
      values (a.center_id, a.id, hh.household_id, p_period, hh.household_id, '', 'skipped', 'Not sent: no adult of the household has an email address on file.')
      on conflict on constraint email_automation_sends_once do nothing;
      continue;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('household', app._email_schedule_household(hh.household_id, v_maj),
                                                           'recipients', v_rec, 'data', hh.data));
  end loop;
  return jsonb_build_object('center', app._email_center_facts(a.center_id), 'audience', a.audience, 'households', v_out, 'more', v_seen >= v_limit);
end $$;

-- A run is done: what it did, and the next time it goes.
create or replace function app.worker_email_schedule_done(p_automation uuid, p_period text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; v_tz text; v_sum jsonb;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into a from app.email_automations where id = p_automation for update;
  if a.id is null or a.kind <> 'schedule' then return null; end if;
  v_sum := app._email_schedule_summary(a.id, p_period);
  select c.time_zone into v_tz from app.centers c where c.id = a.center_id;
  update app.email_automations
     set last_run_at = case when run_period = p_period then now() else last_run_at end,
         last_run = case when run_period = p_period then v_sum else last_run end,
         run_claimed_until = case when run_period = p_period then null else run_claimed_until end,
         run_period = case when run_period = p_period then null else run_period end,
         next_run_at = case when status = 'active' and run_period = p_period
                            then app._email_schedule_next(frequency, day_of_week, day_of_month, month_of_year, send_hour, v_tz, now())
                            else next_run_at end
   where id = a.id
  returning * into a;
  return v_sum || jsonb_build_object('next_run_at', a.next_run_at);
end $$;

-- ══ Who may call what ════════════════════════════════════════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    'app._email_list_placeholders()', 'app._email_schedule_can(uuid, text)', 'app._email_schedule_modules_on(uuid)',
    'app._email_schedule_modules_message(uuid)', 'app._email_schedule_next(text, integer, integer, integer, integer, text, timestamptz)',
    'app._email_schedule_window(text, date)', 'app._email_schedule_params(text, jsonb)',
    'app._email_audience(uuid, text, jsonb, date, date, date)', 'app._email_schedule_household(uuid, integer)', 'app._email_center_facts(uuid)',
    'app._email_imported(uuid, text, uuid, text)', 'app._email_schedule_catch_up(app.email_automations, text)',
    'app._email_schedule_summary(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'app.email_schedule_preview(uuid, text, jsonb, text, integer)', 'app.email_schedules_state(uuid, integer)',
    'app.save_email_schedule(uuid, uuid, text, text, jsonb, text, integer, integer, integer, integer, text, text, text)',
    'app.approve_email_schedule(uuid, uuid)', 'app.pause_email_schedule(uuid, uuid)', 'app.email_schedule_log(uuid, uuid, integer)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'app.worker_email_schedules_due(integer)', 'app.worker_email_schedule_batch(uuid, text, integer, integer)',
    'app.worker_email_schedule_done(uuid, text)', 'app.worker_email_schedule_release(uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to connect_worker', f);
  end loop;
end $$;
-- 0770's grants on the two redefined functions stay (create or replace keeps them); said again for a fresh database.
revoke execute on function app._email_trigger_meta(text), app._email_placeholders(text) from public, anon, authenticated;
grant execute on function app._email_trigger_meta(text), app._email_placeholders(text) to service_role;

comment on function app.approve_email_schedule(uuid, uuid) is
  'Settings › Automatic emails › Scheduled emails (0771): switch a scheduled email on. comms.approve with giving.view or giving.manage; Communications and Giving on; its wording written. Sets the next run in the community''s time zone. No 2FA step.';
