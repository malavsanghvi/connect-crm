-- f-jsh-content · 1 of 4: subscribe a calendar layer to a calendar link (ICS).
--
-- Calendar › Layers › "Subscribe to a calendar (ICS link)": the layer keeps the
-- link (source_url, as before) and the background service fetches it, parses
-- VEVENTs (repeating ones expanded within a window) and upserts the layer's
-- entries by the event's UID (calendar_entries.source_uid). It runs at once
-- when someone subscribes or presses "Refresh now", and once a day after that.
-- A layer can also create events from its entries (feed_creates_events): each
-- entry gets one event (past = completed), linked by calendar_entries.event_id.
--
--   app.subscribe_calendar_layer(layer, url, create_events)   content.manage (platform admin for shared layers)
--   app.refresh_calendar_layer(layer)                         content.manage
--   app.unsubscribe_calendar_layer(layer)                     content.manage; the entries stay
--   app.calendar_feed_apply(layer, entries, keep_before)      internal: the one place entries are written
--                                                             (the worker and the JSH seed both use it)
--   app.worker_calendar_feed_layer / _feeds_due / _feed_import / _feed_failed   connect_worker
--
-- No new tables. Permissions unchanged: the RPCs check the same content.manage
-- that calendar_layers_manage / calendar_entries_manage already require.
set client_min_messages = warning;

alter table app.calendar_layers add column if not exists feed_subscribed boolean not null default false;
alter table app.calendar_layers add column if not exists feed_creates_events boolean not null default false;
alter table app.calendar_layers add column if not exists feed_status text not null default 'none';
alter table app.calendar_layers add column if not exists feed_synced_at timestamptz;
alter table app.calendar_layers add column if not exists feed_checked_at timestamptz;
alter table app.calendar_layers add column if not exists feed_error text;
alter table app.calendar_layers add column if not exists feed_result jsonb not null default '{}'::jsonb;
do $$ begin
  alter table app.calendar_layers add constraint calendar_layers_feed_status_check check (feed_status in ('none','pending','ok','error'));
exception when duplicate_object then null;
end $$;
comment on column app.calendar_layers.feed_subscribed is 'The layer follows its source_url (an ICS link): refreshed now and then daily by the background service.';
comment on column app.calendar_layers.feed_creates_events is 'Each entry of the subscribed calendar also becomes an event (linked by calendar_entries.event_id).';
comment on column app.calendar_layers.feed_status is 'none | pending (refresh queued) | ok | error (feed_error says why, in plain English).';
comment on column app.calendar_layers.feed_result is 'Counts of the last refresh: inserted, updated, unchanged, removed, events_created, events_updated, and the feed''s name.';

alter table app.calendar_entries add column if not exists source_uid text;
comment on column app.calendar_entries.source_uid is 'The subscribed calendar''s UID (a repeating event''s occurrence: "<UID>#<local start>"); a refresh upserts by it.';
create unique index if not exists calendar_entries_source_uid_idx on app.calendar_entries (layer_id, source_uid) where source_uid is not null;

-- ── The one writer ───────────────────────────────────────────────────────────
-- p_entries: [{uid, title, starts_on, ends_on, all_day, starts_at, ends_at, location, notes, link, sub}]
-- (worker/src/calendar/ics.ts FeedEntry). Entries of this layer that came from
-- the feed, start on or after p_keep_before and are no longer in it are removed
-- (older ones are kept as history). Events created from entries are never
-- deleted here; a past one moves from published to completed.
create or replace function app.calendar_feed_apply(p_layer uuid, p_entries jsonb, p_keep_before date)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  l app.calendar_layers; v_tz text; e record; cur app.calendar_entries; ev app.events;
  v_meta jsonb; v_title text; v_start timestamptz; v_end timestamptz; v_status text; v_event uuid;
  v_ins int := 0; v_upd int := 0; v_same int := 0; v_del int := 0; v_ev_new int := 0; v_ev_upd int := 0;
begin
  select * into l from app.calendar_layers where id = p_layer for update;
  if l.id is null then raise exception 'That calendar layer no longer exists.'; end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then raise exception 'The calendar''s dates must be a list.'; end if;
  if jsonb_array_length(p_entries) > 5000 then
    raise exception 'The calendar has % dates in the window; the most a subscription takes is 5,000.', jsonb_array_length(p_entries);
  end if;
  select c.time_zone into v_tz from app.centers c where c.id = l.center_id;
  v_tz := coalesce(v_tz, 'America/Chicago');
  perform app.set_audit_context('Calendar subscription refresh: ' || l.name);

  for e in
    select distinct on (x.uid) x.*
      from jsonb_to_recordset(p_entries) as x(uid text, title text, starts_on date, ends_on date, all_day boolean,
                                              starts_at timestamptz, ends_at timestamptz, location text, notes text, link text, sub text)
     where nullif(btrim(x.uid), '') is not null and x.starts_on is not null
     order by x.uid
  loop
    v_title := left(coalesce(nullif(btrim(e.title), ''), 'Untitled'), 160);
    v_meta := jsonb_strip_nulls(jsonb_build_object('source', 'feed', 'sub', nullif(btrim(e.sub), ''), 'location', nullif(btrim(e.location), ''),
                                                   'notes', nullif(btrim(e.notes), ''), 'link', nullif(btrim(e.link), '')));
    select * into cur from app.calendar_entries where layer_id = p_layer and source_uid = e.uid;
    if cur.id is null then
      insert into app.calendar_entries (center_id, layer_id, title, starts_on, ends_on, all_day, starts_at, ends_at, metadata, source_uid)
      values (l.center_id, p_layer, v_title, e.starts_on, nullif(e.ends_on, e.starts_on), coalesce(e.all_day, true), e.starts_at, e.ends_at, v_meta, e.uid)
      returning * into cur;
      v_ins := v_ins + 1;
    elsif (cur.title, cur.starts_on, cur.ends_on, cur.all_day, cur.starts_at, cur.ends_at, cur.metadata)
          is distinct from (v_title, e.starts_on, nullif(e.ends_on, e.starts_on), coalesce(e.all_day, true), e.starts_at, e.ends_at, v_meta) then
      update app.calendar_entries
         set title = v_title, starts_on = e.starts_on, ends_on = nullif(e.ends_on, e.starts_on), all_day = coalesce(e.all_day, true),
             starts_at = e.starts_at, ends_at = e.ends_at, metadata = v_meta
       where id = cur.id
      returning * into cur;
      v_upd := v_upd + 1;
    else
      v_same := v_same + 1;
    end if;

    continue when not l.feed_creates_events or l.center_id is null;
    v_start := coalesce(e.starts_at, e.starts_on::timestamp at time zone v_tz);
    v_end := coalesce(e.ends_at, case when e.starts_at is null then (coalesce(e.ends_on, e.starts_on) + 1)::timestamp at time zone v_tz end);
    v_status := case when coalesce(v_end, v_start + interval '6 hours') < now() then 'completed' else 'published' end;
    ev := null;
    if cur.event_id is not null then select * into ev from app.events where id = cur.event_id; end if;
    if ev.id is null then
      -- An imported event asks for no money: no commitment amounts.
      insert into app.events (center_id, name, description, venue, starts_at, ends_at, status, audience, commitment_options)
      values (l.center_id, v_title, nullif(btrim(e.notes), ''), nullif(btrim(e.location), ''), v_start, v_end, v_status, 'members_and_guests',
              '{"per_person":[],"lump_sum":[],"open":false}'::jsonb)
      returning id into v_event;
      update app.calendar_entries set event_id = v_event where id = cur.id;
      v_ev_new := v_ev_new + 1;
    elsif (ev.name, ev.description, ev.venue, ev.starts_at, ev.ends_at)
          is distinct from (v_title, nullif(btrim(e.notes), ''), nullif(btrim(e.location), ''), v_start, v_end)
       or (ev.status = 'published' and v_status = 'completed') then
      update app.events
         set name = v_title, description = nullif(btrim(e.notes), ''), venue = nullif(btrim(e.location), ''), starts_at = v_start, ends_at = v_end,
             status = case when ev.status = 'published' and v_status = 'completed' then 'completed' else ev.status end
       where id = ev.id;
      v_ev_upd := v_ev_upd + 1;
    end if;
  end loop;

  with gone as (
    delete from app.calendar_entries ce
     where ce.layer_id = p_layer and ce.source_uid is not null
       and ce.starts_on >= coalesce(p_keep_before, '-infinity'::date)
       and not exists (select 1 from jsonb_array_elements(p_entries) x where x->>'uid' = ce.source_uid)
    returning 1)
  select count(*)::int into v_del from gone;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'unchanged', v_same, 'removed', v_del,
                            'events_created', v_ev_new, 'events_updated', v_ev_upd);
end $$;

-- ── Staff ────────────────────────────────────────────────────────────────────
create or replace function app.calendar_feed_can_manage(l app.calendar_layers) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select case when l.center_id is null then app.is_platform_admin()
              else app.has_permission(l.center_id, 'content.manage') or app.is_platform_admin() end
$$;

create or replace function app.calendar_feed_enqueue(l app.calendar_layers) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_job bigint;
begin
  select j.id into v_job from app.jobs j
   where j.kind = 'calendar.import_feed' and j.status in ('queued','running') and j.payload->>'layer_id' = l.id::text
   order by j.id desc limit 1;
  if v_job is not null then return v_job; end if;
  return app.enqueue_job(l.center_id, 'calendar.import_feed', jsonb_build_object('layer_id', l.id), now(), 3);
end $$;

create or replace function app.subscribe_calendar_layer(p_layer uuid, p_url text, p_create_events boolean default false)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
declare l app.calendar_layers; v_url text := btrim(coalesce(p_url, ''));
begin
  select * into l from app.calendar_layers where id = p_layer for update;
  if l.id is null then raise exception 'That calendar layer no longer exists.'; end if;
  if not app.calendar_feed_can_manage(l) then
    raise exception 'You don''t have permission to change this calendar layer.' using errcode = 'insufficient_privilege';
  end if;
  v_url := regexp_replace(v_url, '^webcals?://', 'https://', 'i');
  if v_url !~* '^https?://[^\s/?#@]+(/[^\s]*)?$' or length(v_url) > 2000 then
    raise exception 'Enter the calendar''s public link, starting with https:// (or webcal://).' using errcode = 'check_violation';
  end if;
  if coalesce(p_create_events, false) and l.center_id is null then
    raise exception 'A shared layer cannot create events: events belong to one organization.' using errcode = 'check_violation';
  end if;
  update app.calendar_layers
     set source_url = v_url, feed_subscribed = true, feed_creates_events = coalesce(p_create_events, false),
         feed_status = 'pending', feed_error = null
   where id = l.id
  returning * into l;
  return app.calendar_feed_enqueue(l);
end $$;

create or replace function app.refresh_calendar_layer(p_layer uuid)
returns bigint language plpgsql security definer set search_path = app, public, extensions as $$
declare l app.calendar_layers;
begin
  select * into l from app.calendar_layers where id = p_layer for update;
  if l.id is null then raise exception 'That calendar layer no longer exists.'; end if;
  if not app.calendar_feed_can_manage(l) then
    raise exception 'You don''t have permission to change this calendar layer.' using errcode = 'insufficient_privilege';
  end if;
  if not l.feed_subscribed or l.source_url is null then raise exception 'This layer is not subscribed to a calendar link.'; end if;
  update app.calendar_layers set feed_status = 'pending', feed_error = null where id = l.id returning * into l;
  return app.calendar_feed_enqueue(l);
end $$;

create or replace function app.unsubscribe_calendar_layer(p_layer uuid)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare l app.calendar_layers;
begin
  select * into l from app.calendar_layers where id = p_layer for update;
  if l.id is null then raise exception 'That calendar layer no longer exists.'; end if;
  if not app.calendar_feed_can_manage(l) then
    raise exception 'You don''t have permission to change this calendar layer.' using errcode = 'insufficient_privilege';
  end if;
  -- The link stays (members can still add it to their phone); the entries stay.
  update app.calendar_layers set feed_subscribed = false, feed_creates_events = false, feed_status = 'none', feed_error = null where id = l.id;
end $$;

-- ── The background service ───────────────────────────────────────────────────
create or replace function app.worker_calendar_feed_layer(p_layer uuid)
returns table (layer_id uuid, center_id uuid, source_url text, time_zone text, name text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query
  select l.id, l.center_id, l.source_url, coalesce(c.time_zone, 'America/Chicago'), l.name
    from app.calendar_layers l left join app.centers c on c.id = l.center_id
   where l.id = p_layer and l.feed_subscribed and l.source_url is not null;
end $$;

-- Layers not refreshed (or tried) for about a day, oldest first.
create or replace function app.worker_calendar_feeds_due(p_limit int default 50)
returns table (layer_id uuid, center_id uuid, source_url text, time_zone text, name text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query
  select l.id, l.center_id, l.source_url, coalesce(c.time_zone, 'America/Chicago'), l.name
    from app.calendar_layers l left join app.centers c on c.id = l.center_id
   where l.feed_subscribed and l.source_url is not null
     and (l.feed_checked_at is null or l.feed_checked_at < now() - interval '23 hours')
   order by l.feed_checked_at nulls first, l.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

create or replace function app.worker_calendar_feed_import(p_layer uuid, p_entries jsonb, p_keep_before date, p_feed jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v jsonb;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if not exists (select 1 from app.calendar_layers where id = p_layer and feed_subscribed) then
    raise exception 'The calendar layer is no longer subscribed to a calendar link.';
  end if;
  v := app.calendar_feed_apply(p_layer, p_entries, p_keep_before);
  update app.calendar_layers
     set feed_status = 'ok', feed_synced_at = now(), feed_checked_at = now(), feed_error = null,
         feed_result = v || jsonb_build_object('feed', coalesce(p_feed, '{}'::jsonb))
   where id = p_layer;
  return v;
end $$;

create or replace function app.worker_calendar_feed_failed(p_layer uuid, p_error text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  update app.calendar_layers
     set feed_status = 'error', feed_checked_at = now(), feed_error = left(coalesce(nullif(btrim(p_error), ''), 'The refresh failed.'), 500)
   where id = p_layer;
end $$;

-- ── Access ───────────────────────────────────────────────────────────────────
revoke execute on function app.calendar_feed_apply(uuid, jsonb, date), app.calendar_feed_can_manage(app.calendar_layers),
  app.calendar_feed_enqueue(app.calendar_layers), app.subscribe_calendar_layer(uuid, text, boolean), app.refresh_calendar_layer(uuid),
  app.unsubscribe_calendar_layer(uuid), app.worker_calendar_feed_layer(uuid), app.worker_calendar_feeds_due(int),
  app.worker_calendar_feed_import(uuid, jsonb, date, jsonb), app.worker_calendar_feed_failed(uuid, text) from public, anon, authenticated;
grant execute on function app.subscribe_calendar_layer(uuid, text, boolean), app.refresh_calendar_layer(uuid),
  app.unsubscribe_calendar_layer(uuid) to authenticated;
grant execute on function app.worker_calendar_feed_layer(uuid), app.worker_calendar_feeds_due(int),
  app.worker_calendar_feed_import(uuid, jsonb, date, jsonb), app.worker_calendar_feed_failed(uuid, text) to connect_worker;
grant execute on all functions in schema app to service_role;
