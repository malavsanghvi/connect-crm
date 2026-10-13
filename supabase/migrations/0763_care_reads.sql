-- 0763 · WeCare slice 2, part 4: what the portal reads (docs/WECARE.md sections 3 and 5.1-5.3; W2; the slice-2 plan the
-- owner approved 2026-10-13). Builder CARE2.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Three read functions, the only way the portal reads WeCare. Each one checks the caller with 0760's rule (built on
--   app.care_can: no platform-admin branch), answers "You don't have access to this area." otherwise, and writes one
--   app.log_private_read entry (0758: who, when, what and how many rows, never names).
--
--   app.care_household_card(household)   the Care card on the Family page: the household as the community knows it
--       (name, household number, its own ID, city, zone, the adults; never a child), its owner and backup ("needs an
--       owner" when the owner no longer holds a WeCare key), the care profile, the community's languages, the latest
--       notes, the last touch and the touch counts of the last 12 months. And the People fields, READ where they live and
--       never copied (interests, expertise areas, best call time, language, anniversary, dietary needs, special days, the
--       channels each adult agreed to), only when the caller ALSO holds people.view or people.manage through the
--       organization: the People fields keep their own visibility. Adults only, always.
--   app.care_households(center, filter, search, limit, offset)   the WeCare area's list: all (care.view), mine (the
--       households I own or back up), needs an owner (care.view), resting (do not ask). A care.own holder always gets
--       only their own households, whatever the filter.
--   app.care_household_touches(household, before, limit)   the touch log: the touches people recorded (0762), and the
--       touches Weaver already knows, read live from their own tables, never copied:
--         message     emails, texts and WhatsApp messages sent to the household's adults (sent, delivered or opened); the
--                     campaign or topic name, never the subject or the words (a subject can carry an amount); receipts
--                     sent by message are left out here because they come from the payment
--         receipt     a payment's receipt sent (payments.receipt_sent_at); the amount ONLY with app.care_amounts_can
--         statement   a statement prepared for the household
--         check_in    an adult of the household checked in at an event
--         volunteer   a volunteer shift an adult of the household worked (completed, or confirmed and over)
--       Each source only while its module is on for the community (Communications, Giving, Statements, Events,
--       Volunteers). Nothing about anyone under 18: only adults' messages, check-ins and shifts.
--   Amounts appear nowhere else in this slice. No export and no AI read any of this.
set client_min_messages = warning;

-- The community's languages (Setup > Profile), the community's order; English when none were chosen.
create or replace function app._care_languages(p_center uuid) returns text[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(nullif((select p.languages from app.org_profiles p where p.center_id = p_center), '{}'::text[]), array['en']::text[])
$$;

-- The community's date today.
create or replace function app._care_today(p_center uuid) returns date
language sql stable security definer set search_path = app, public, extensions as $$
  select (now() at time zone coalesce((select c.time_zone from app.centers c where c.id = p_center), 'America/Chicago'))::date
$$;

-- A person's name as the screens show it.
create or replace function app._care_person_name(p_person uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || coalesce(' ' || nullif(btrim(p.last_name), ''), '')
    from app.people p where p.id = p_person
$$;

-- The adults of a household now (not merged, not deceased, not under 18), primary first.
create or replace function app._care_adults(p_household uuid) returns table (person_id uuid, name text, is_primary boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select p.id, app._care_person_name(p.id), hm.is_primary
    from app.household_members hm join app.people p on p.id = hm.person_id
   where hm.household_id = p_household and hm.left_at is null
     and p.merged_into_id is null and p.deceased_on is null
     and not app.person_is_minor(p.id)
   order by hm.is_primary desc, p.first_name, p.last_name
$$;

-- The household as the community knows it, without anyone under 18 (the household_card details a WeCare screen may show).
create or replace function app._care_household_head(p_household uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'id', h.id, 'name', h.display_name, 'number', h.household_number,
    'org_household_id', (select e.value from app.external_ids e
                          where e.household_id = h.id and e.kind = 'org_household' and e.valid_to is null
                          order by e.is_primary desc, e.created_at limit 1),
    'city', h.city, 'zone', z.name,
    'primary_member', (select a.name from app._care_adults(h.id) a where a.is_primary limit 1),
    'adults', (select coalesce(jsonb_agg(jsonb_build_object('person_id', a.person_id, 'name', a.name, 'is_primary', a.is_primary)
                                         order by a.is_primary desc, a.name), '[]'::jsonb)
                 from app._care_adults(h.id) a),
    'merged', h.merged_into_id is not null)
    from app.households h left join app.zones z on z.id = h.zone_id
   where h.id = p_household
$$;

-- ── The Care card ────────────────────────────────────────────────────────────
create or replace function app.care_household_card(p_household uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_people boolean; v_card jsonb; v_level text; v_mail boolean;
begin
  v_center := app._care_household_or_raise(p_household);
  v_people := app._org_holds(v_center, auth.uid(), 'people.view') or app._org_holds(v_center, auth.uid(), 'people.manage');
  v_level := case when app.care_can(v_center, 'manage') then 'manage' when app.care_can(v_center, 'view') then 'view' else 'own' end;
  select h.physical_mail_opt_in into v_mail from app.households h where h.id = p_household;

  v_card := jsonb_build_object(
    'household', app._care_household_head(p_household),
    'label', app._module_label(v_center, 'care'),
    'access', jsonb_build_object('level', v_level, 'manage', v_level = 'manage', 'amounts', app.care_amounts_can(v_center),
                                 'people', v_people),
    'owners', app._care_owner_card(p_household),
    'profile', app._care_profile_json(p_household),
    'languages', to_jsonb(app._care_languages(v_center)),
    'today', app._care_today(v_center),
    'people', case when v_people then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'person_id', p.id, 'name', a.name, 'is_primary', a.is_primary,
               'best_call_time', p.best_call_time, 'interests', to_jsonb(coalesce(p.interests, '{}'::text[])),
               'expertise', to_jsonb(coalesce(p.expertise_tags, '{}'::text[])), 'language', p.language,
               'anniversary', d.anniversary,
               'dietary', (select coalesce(jsonb_agg(coalesce(o.label, k.key) order by k.ord), '[]'::jsonb)
                             from unnest(coalesce(d.dietary, '{}'::text[])) with ordinality as k(key, ord)
                             left join app.dietary_options o on o.center_id = p.center_id and o.key = k.key),
               'dietary_other', d.dietary_other,
               'agreed', jsonb_build_object(
                 'email', (select c.granted from app.consents c where c.person_id = p.id and c.kind = 'marketing_email'
                            order by c.recorded_at desc limit 1),
                 'sms', (select c.granted from app.consents c where c.person_id = p.id and c.kind = 'sms'
                          order by c.recorded_at desc limit 1),
                 'whatsapp', (select c.granted from app.consents c where c.person_id = p.id and c.kind = 'whatsapp'
                               order by c.recorded_at desc limit 1),
                 'post', v_mail)) order by a.is_primary desc, a.name), '[]'::jsonb)
        from app._care_adults(p_household) a
        join app.people p on p.id = a.person_id
        left join app.person_profile_details d on d.person_id = p.id) end,
    'special_days', case when v_people then (
      select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'label', s.label, 'date', s.calendar_date, 'tithi', s.tithi,
                                                   'tithi_month', s.tithi_month, 'person_id', s.person_id,
                                                   'person_name', case when s.person_id is not null then app._care_person_name(s.person_id) end)
                                order by to_char(s.calendar_date, 'MM-DD') nulls last, s.kind), '[]'::jsonb)
        from app.special_days s
       where s.household_id = p_household
         and (s.person_id is null or not app.person_is_minor(s.person_id))) end,
    'notes', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', n.id, 'body', n.body, 'person_id', n.person_id,
                       'person_name', case when n.person_id is not null then app._care_person_name(n.person_id) end,
                       'by', case when n.created_by is not null then app._user_label(v_center, n.created_by) end,
                       'mine', n.created_by = auth.uid(), 'created_at', n.created_at, 'edited_at', n.edited_at)
                     order by n.created_at desc), '[]'::jsonb)
                from (select * from app.care_notes x where x.household_id = p_household and x.archived_at is null
                       order by x.created_at desc limit 20) n),
    'notes_total', (select count(*) from app.care_notes x where x.household_id = p_household and x.archived_at is null),
    'last_touch', (select jsonb_build_object('at', t.touched_at, 'kind', t.kind, 'channel', t.channel, 'outcome', t.outcome,
                                             'is_ask', t.is_ask,
                                             'by', case when t.by_user_id is not null then app._user_label(v_center, t.by_user_id) end)
                     from app.care_touches t where t.household_id = p_household and t.voided_at is null
                    order by t.touched_at desc limit 1),
    'touches_12m', (select count(*) from app.care_touches t where t.household_id = p_household and t.voided_at is null
                      and t.touched_at > now() - interval '12 months'),
    'asks_12m', (select count(*) from app.care_touches t where t.household_id = p_household and t.voided_at is null and t.is_ask
                   and t.touched_at > now() - interval '12 months'));
  perform app.log_private_read(v_center, 'care', 'household', 1);
  return v_card;
end $$;

-- ── The WeCare area's list ───────────────────────────────────────────────────
create or replace function app.care_households(p_center uuid, p_filter text default 'all', p_search text default null,
                                               p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_all boolean; v_filter text; v_search text; v_today date; v_holders uuid[]; v_rows jsonb; v_total int; v_counts jsonb;
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200)); v_offset int := greatest(0, coalesce(p_offset, 0));
begin
  if auth.uid() is null or p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  v_all := app.care_can(p_center, 'view');
  v_filter := coalesce(nullif(btrim(p_filter), ''), 'all');
  if v_filter not in ('all', 'mine', 'needs_owner', 'resting') then
    raise exception 'Show all households, mine, those that need an owner, or those resting.' using errcode = '22023';
  end if;
  -- A care.own holder sees their own households only.
  if not v_all and v_filter in ('all', 'needs_owner') then v_filter := 'mine'; end if;
  v_search := left(lower(nullif(btrim(coalesce(p_search, '')), '')), 100);
  v_today := app._care_today(p_center);
  select coalesce(array_agg(u.uid), '{}'::uuid[]) into v_holders
    from (select o.user_id as uid from app.center_owners o where o.center_id = p_center
          union
          select g.user_id from app.role_grants g where g.center_id = p_center and g.status = 'active') u
   where app._care_holder(p_center, u.uid);

  with base as (
    select h.id as household_id, h.display_name as name, o.owner_user_id, o.backup_user_id,
           coalesce(o.owner_user_id = auth.uid() or o.backup_user_id = auth.uid(), false) as mine,
           (o.owner_user_id is null or not (o.owner_user_id = any (v_holders))) as needs_owner,
           coalesce(cp.do_not_ask and (cp.rest_until is null or cp.rest_until >= v_today), false) as resting,
           case when cp.do_not_ask then cp.rest_until end as rest_until
      from app.households h
      left join app.care_owners o on o.household_id = h.id
      left join app.care_profiles cp on cp.household_id = h.id
     where h.center_id = p_center and h.merged_into_id is null
       and (v_all or o.owner_user_id = auth.uid() or o.backup_user_id = auth.uid())
       and (v_search is null
            or position(v_search in lower(h.display_name)) > 0
            or position(v_search in lower(coalesce(h.household_number, ''))) > 0
            or exists (select 1 from app.external_ids e where e.household_id = h.id and e.valid_to is null
                          and position(v_search in lower(e.value)) > 0)
            or exists (select 1 from app._care_adults(h.id) a where position(v_search in lower(a.name)) > 0))
  ), chosen as (
    select * from base b
     where case v_filter when 'mine' then b.mine when 'needs_owner' then b.needs_owner when 'resting' then b.resting else true end
  ), page as (
    select * from chosen c order by lower(c.name), c.household_id limit v_limit offset v_offset
  )
  select (select jsonb_build_object('mine', count(*) filter (where b.mine),
                                    'needs_owner', case when v_all then count(*) filter (where b.needs_owner) end,
                                    'resting', count(*) filter (where b.resting),
                                    'all', case when v_all then count(*) end)
            from base b),
         (select count(*) from chosen),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'household', app._care_household_head(p.household_id),
                   'owner', case when p.owner_user_id is not null then app._user_label(p_center, p.owner_user_id) end,
                   'owner_holds', p.owner_user_id is not null and p.owner_user_id = any (v_holders),
                   'backup', case when p.backup_user_id is not null then app._user_label(p_center, p.backup_user_id) end,
                   'mine', p.mine, 'needs_owner', p.needs_owner, 'resting', p.resting, 'rest_until', p.rest_until,
                   'last_touch_at', (select max(t.touched_at) from app.care_touches t
                                      where t.household_id = p.household_id and t.voided_at is null))
                 order by lower(p.name), p.household_id), '[]'::jsonb)
            from page p)
    into v_counts, v_total, v_rows;

  perform app.log_private_read(p_center, 'care', 'list', jsonb_array_length(v_rows));
  return jsonb_build_object('filter', v_filter, 'total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows,
                            'counts', v_counts, 'label', app._module_label(p_center, 'care'),
                            'can', jsonb_build_object('all', v_all, 'manage', app.care_can(p_center, 'manage')));
end $$;

-- ── The touch log ────────────────────────────────────────────────────────────
-- Is the module that owns this table on for the community? (The table's module from app.module_tables.)
create or replace function app._care_source_on(p_center uuid, p_table text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app.module_enabled(p_center, coalesce((select mt.module_key from app.module_tables mt where mt.table_name = p_table), 'people'))
$$;

-- Newest first; p_before (the "at" of the last row shown) pages further back. Returns {rows, more, amounts}.
create or replace function app.care_household_touches(p_household uuid, p_before timestamptz default null, p_limit int default 30)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_adults uuid[]; v_amounts boolean; v_manage boolean; v_rows jsonb; v_n int;
  v_limit int := greatest(1, least(coalesce(p_limit, 30), 100));
  v_before timestamptz := coalesce(p_before, now() + interval '1 day');
  v_msgs boolean; v_giving boolean; v_statements boolean; v_events boolean; v_volunteers boolean;
begin
  v_center := app._care_household_or_raise(p_household);
  v_amounts := app.care_amounts_can(v_center);
  v_manage := app.care_can(v_center, 'manage');
  -- Every adult who is or was in the household (D2: never anyone under 18).
  select coalesce(array_agg(distinct hm.person_id), '{}'::uuid[]) into v_adults
    from app.household_members hm
   where hm.household_id = p_household and not app.person_is_minor(hm.person_id);
  v_msgs := app._care_source_on(v_center, 'messages');
  v_giving := app._care_source_on(v_center, 'payments');
  v_statements := app._care_source_on(v_center, 'statements');
  v_events := app._care_source_on(v_center, 'attendees');
  v_volunteers := app._care_source_on(v_center, 'volunteer_assignments');

  with t as (
    select 'manual'::text as source, ct.id::text as id, ct.touched_at as at, ct.kind, ct.channel, ct.outcome, ct.is_ask,
           ct.note, ct.by_user_id, ct.person_id, null::text as label, null::bigint as amount_cents, null::boolean as opened
      from app.care_touches ct
     where ct.household_id = p_household and ct.voided_at is null and ct.touched_at < v_before
    union all
    select 'message', m.id::text, coalesce(m.sent_at, m.scheduled_at), null, m.channel::text,
           case when m.opened_at is not null then 'opened' else m.status end, false, null, null, m.person_id,
           coalesce(cc.title, nt.name, 'A message'), null, m.opened_at is not null
      from app.messages m
      left join app.comms_campaigns cc on cc.id = m.campaign_id
      left join app.notification_topics nt on nt.key = m.topic_key
     where v_msgs and m.center_id = v_center and m.person_id = any (v_adults)
       and m.channel in ('email', 'sms', 'whatsapp') and m.status in ('sent', 'delivered')
       and coalesce(m.template_key, '') not like '%receipt%'
       and coalesce(m.sent_at, m.scheduled_at) < v_before
    union all
    select 'receipt', pay.id::text, pay.receipt_sent_at, null, null, 'done', false, null, null,
           case when pay.payer_person_id = any (v_adults) then pay.payer_person_id end,
           case when nullif(btrim(pay.receipt_number), '') is not null then 'Receipt ' || btrim(pay.receipt_number) else 'Receipt' end,
           case when v_amounts then pay.amount_cents end, null
      from app.payments pay
     where v_giving and pay.household_id = p_household and pay.receipt_sent_at is not null and pay.receipt_sent_at < v_before
    union all
    select 'statement', s.id::text, s.generated_at, null, null, 'done', false, null, null, null,
           case s.kind when 'tax_year' then 'Year-end statement' || coalesce(' ' || s.tax_year::text, '')
                       when 'pledge' then 'Pledge statement' when 'donation' then 'Donation statement'
                       when 'event' then 'Event statement' else 'Statement' end,
           null, null
      from app.statements s
     where v_statements and s.household_id = p_household and s.generated_at < v_before
    union all
    select 'check_in', a.id::text, a.checked_in_at, null, 'in_person', 'done', false, null, null, a.person_id, e.name, null, null
      from app.attendees a join app.events e on e.id = a.event_id
     where v_events and a.center_id = v_center and a.person_id = any (v_adults) and a.checked_in_at is not null
       and not a.is_child_under_12 and a.checked_in_at < v_before
    union all
    select 'volunteer', va.id::text, coalesce(vs.starts_at, va.created_at), null, 'in_person', 'done', false, null, null,
           va.person_id, e.name || coalesce(' · ' || nullif(btrim(vs.station), ''), ''), null, null
      from app.volunteer_assignments va
      join app.volunteer_shifts vs on vs.id = va.shift_id
      join app.events e on e.id = vs.event_id
     where v_volunteers and va.center_id = v_center and va.person_id = any (v_adults)
       and (va.status = 'completed' or (va.status = 'confirmed' and coalesce(vs.ends_at, vs.starts_at) < now()))
       and coalesce(vs.starts_at, va.created_at) < v_before
  ), page as (
    select * from t where t.at is not null order by t.at desc, t.id desc limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'source', p.source, 'id', p.id, 'at', p.at, 'kind', p.kind, 'channel', p.channel, 'outcome', p.outcome,
           'is_ask', p.is_ask, 'note', p.note,
           'by', case when p.by_user_id is not null then app._user_label(v_center, p.by_user_id) end,
           'person_name', case when p.person_id is not null then app._care_person_name(p.person_id) end,
           'label', p.label, 'amount_cents', p.amount_cents, 'opened', p.opened,
           'can_remove', p.source = 'manual' and (p.by_user_id = auth.uid() or v_manage))
         order by p.at desc, p.id desc), '[]'::jsonb),
         count(*)
    into v_rows, v_n
    from page p;

  if v_n > v_limit then
    select coalesce(jsonb_agg(x.e order by x.i), '[]'::jsonb) into v_rows
      from jsonb_array_elements(v_rows) with ordinality as x(e, i) where x.i <= v_limit;
  end if;
  perform app.log_private_read(v_center, 'care', 'touches', jsonb_array_length(v_rows));
  return jsonb_build_object('rows', v_rows, 'more', v_n > v_limit, 'amounts', v_amounts);
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._care_languages(uuid), app._care_today(uuid), app._care_person_name(uuid), app._care_adults(uuid),
  app._care_household_head(uuid), app._care_source_on(uuid, text) from public, anon, authenticated;
revoke execute on function app.care_household_card(uuid), app.care_households(uuid, text, text, int, int),
  app.care_household_touches(uuid, timestamptz, int) from public, anon;
grant execute on function app.care_household_card(uuid), app.care_households(uuid, text, text, int, int),
  app.care_household_touches(uuid, timestamptz, int) to authenticated;

comment on function app.care_household_card(uuid) is
  'WeCare (0763): the Care card of one household for a caller who may see its care record (0760). People fields only with people.view through the organization; adults only; no amounts. Each call is logged (app.log_private_read).';
comment on function app.care_household_touches(uuid, timestamptz, int) is
  'WeCare (0763): the touch log, recorded touches plus those Weaver already knows read live from their own tables (messages, receipts, statements, check-ins, volunteer shifts); adults only; receipt amounts only with app.care_amounts_can. Each call is logged.';

