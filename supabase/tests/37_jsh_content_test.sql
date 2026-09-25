-- 0510–0513 (stream f-jsh-content): calendar subscriptions (ICS links), JSH's live stream,
-- JSH's calendars and events, and JSH's Jain donation opportunities.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  perform set_config('request.jwt.claim.sub', p_user, false);
end $$;
grant connect_worker to postgres;

select id as jsh from app.centers where slug = 'jsh' \gset

-- ══ JSH's content, as the seed (the same functions as the migrations) left it ══════════════
select pg_temp.assert((select count(*) = 1 from app.content_items where center_id = :'jsh' and kind = 'darshan_stream'
                        and media_url = 'https://rtsp.me/embed/FR8NYFzs/' and status = 'published' and metadata->>'stream_status' = 'live'),
  'JSH has its live stream as a published live darshan stream');

select pg_temp.assert((select count(*) = 6 from app.calendar_layers where center_id = :'jsh' and feed_subscribed
                        and source_url like 'https://calendar.google.com/calendar/ical/c_%40group.calendar.google.com/public/basic.ics'),
  'six JSH layers follow their public Google calendar links');
select pg_temp.assert((select count(*) = 1 from app.calendar_layers where center_id = :'jsh' and kind = 'events')
                   and (select count(*) = 1 from app.calendar_layers where center_id = :'jsh' and kind = 'pathshala'),
  'JSH''s existing events and Pathshala layers were reused, not duplicated');
select pg_temp.assert((select name = 'School calendar (FBISD)' and kind = 'school_district' and not default_on
                         from app.calendar_layers where center_id = :'jsh' and key = 'school_fbisd'),
  'the FBISD calendar is a school-district layer, off by default');
select pg_temp.assert((select kind = 'tithi' from app.calendar_layers where center_id = :'jsh' and key = 'jain_panchang'),
  'the Jain Panchang is a tithi (panchang) layer');

select l.id as ev_layer from app.calendar_layers l where l.center_id = :'jsh' and l.kind = 'events' \gset
select pg_temp.assert((select count(*) = 16 and count(event_id) = 16 from app.calendar_entries where layer_id = :'ev_layer'),
  '16 JSH events on the events layer, each with its event');
select pg_temp.assert((select e.status = 'completed' and e.venue = 'JSH Main Hall' and e.starts_at = '2026-02-08 16:30+00'
                         from app.events e join app.calendar_entries ce on ce.event_id = e.id
                        where ce.source_uid = '15ojlagj14bhkrt9hvrbtt3fee@google.com'),
  'a past event (Bhaktamar Diya Vidhan) is completed, with its venue and time');
select pg_temp.assert((select bool_and(e.status = case when coalesce(e.ends_at, e.starts_at) < now() then 'completed' else 'published' end)
                         and bool_and(e.commitment_options = '{"per_person":[],"lump_sum":[],"open":false}'::jsonb)
                         from app.events e join app.calendar_entries ce on ce.event_id = e.id where ce.layer_id = :'ev_layer'),
  'imported events: past = completed, upcoming = published, and they ask for no money');
select pg_temp.assert(not exists (select 1 from app.calendar_entries where center_id = :'jsh' and title ilike '%tax exemption%')
                  and not exists (select 1 from app.events where center_id = :'jsh' and name ilike '%tax exemption%'),
  'the internal tax-exemption reminder is not imported');
select pg_temp.assert((select count(*) > 50 from app.calendar_entries ce join app.calendar_layers l on l.id = ce.layer_id
                        where l.center_id = :'jsh' and l.key = 'bhaktamber_online' and ce.metadata->>'link' = 'https://bit.ly/jshzoom'
                          and ce.metadata->>'notes' like '%Meeting ID: 343 341 0593%'),
  'weekly Bhaktamber sessions are expanded with their Zoom link in the notes');

select pg_temp.assert((select count(*) = 10 from app.campaigns where center_id = :'jsh' and name in
                        ('Jiv Daya','Sadharan','Dev Dravya','Gyan Dravya','Sadhu-Sadhvi Vaiyavach','Ayambil Oli sponsorship',
                         'Paryushan Swamivatsalya sponsorship','Pathshala sponsorship','Aangi and pooja sponsorship','Anukampa (humanitarian aid)')
                          and status = 'published'),
  'ten Jain giving campaigns are published');
select pg_temp.assert((select count(*) = 10 from app.opportunities o join app.campaigns c on c.id = o.campaign_id
                        where c.center_id = :'jsh' and o.status = 'open' and o.sort_order > 100 and o.description is not null),
  'each has one open opportunity with a description');
select pg_temp.assert((select f.restricted from app.campaigns c join app.funds f on f.id = c.fund_id where c.center_id = :'jsh' and c.name = 'Dev Dravya')
                  and (select f.restricted from app.campaigns c join app.funds f on f.id = c.fund_id where c.center_id = :'jsh' and c.name = 'Aangi and pooja sponsorship')
                  and (select f.key = 'dev_dravya' from app.campaigns c join app.funds f on f.id = c.fund_id where c.center_id = :'jsh' and c.name = 'Aangi and pooja sponsorship'),
  'Dev Dravya and the aangi/pooja sponsorship go to the restricted Dev Dravya fund');
select pg_temp.assert((select f.key = 'jeevdaya' from app.campaigns c join app.funds f on f.id = c.fund_id where c.center_id = :'jsh' and c.name = 'Jiv Daya')
                  and not exists (select 1 from app.funds where center_id = :'jsh' and key = 'jiv_daya')
                  and (select f.key = 'general' and not f.restricted from app.campaigns c join app.funds f on f.id = c.fund_id where c.center_id = :'jsh' and c.name = 'Sadharan'),
  'existing funds are reused (Jeevdaya for Jiv Daya, the general fund for Sadharan), not duplicated');

-- ══ Running it all again adds nothing ═════════════════════════════════════════════════════
select (select count(*) from app.calendar_entries where center_id = :'jsh') as n_entries,
       (select count(*) from app.events where center_id = :'jsh') as n_events,
       (select count(*) from app.opportunities where center_id = :'jsh') as n_opps,
       (select count(*) from app.funds where center_id = :'jsh') as n_funds \gset
select app.seed_jsh_live_stream(:'jsh') as r1, app.seed_jsh_calendars(:'jsh') as r2, app.seed_jsh_giving(:'jsh') as r3 \gset
select pg_temp.assert((:'r1')::jsonb->>'added' = '0', 'live stream: a second run adds nothing');
select pg_temp.assert(not exists (select 1 from jsonb_each((:'r2')::jsonb) x
                                   where (x.value->>'inserted')::int + (x.value->>'updated')::int + (x.value->>'removed')::int
                                         + (x.value->>'events_created')::int + (x.value->>'events_updated')::int > 0),
  'calendars: a second run inserts, updates and removes nothing');
select pg_temp.assert((:'r3')::jsonb = '{"funds":0,"campaigns":0,"opportunities":0}'::jsonb, 'giving: a second run adds nothing');
select pg_temp.assert((select count(*) from app.calendar_entries where center_id = :'jsh') = :n_entries
                  and (select count(*) from app.events where center_id = :'jsh') = :n_events
                  and (select count(*) from app.opportunities where center_id = :'jsh') = :n_opps
                  and (select count(*) from app.funds where center_id = :'jsh') = :n_funds,
  'row counts are unchanged');
select pg_temp.assert(app.seed_jsh_calendars('37000000-0000-4000-8000-00000000dead') = '{}'::jsonb
                  and (app.seed_jsh_giving('37000000-0000-4000-8000-00000000dead')->>'funds') = '0'
                  and (app.seed_jsh_live_stream('37000000-0000-4000-8000-00000000dead')->>'added') = '0',
  'without the organization the seed functions do nothing');

-- ══ The live stream link must be https ════════════════════════════════════════════════════
select pg_temp.assert_raises($$insert into app.content_items (center_id, kind, slug, title, media_url, status)
                               select id, 'darshan_stream', 'insecure', 'Insecure', 'http://example.com/live', 'draft' from app.centers where slug = 'jsh'$$,
  'content_items_darshan_https', 'a darshan stream with an http:// link is refused');

-- ══ Subscriptions: who, what, and the job ═════════════════════════════════════════════════
\set c '''37000000-0000-4000-8000-0000000000c1'''
\set admin '''37000000-0000-4000-8000-0000000000a1'''
\set member '''37000000-0000-4000-8000-0000000000a2'''
\set layer '''37000000-0000-4000-8000-0000000000b1'''
insert into auth.users (id, email) values (:admin, 'cal.admin@example.com'), (:member, 'cal.member@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'caltest', 'Calendar Test Center', 'CTC', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, scope_kind) values (:c, :admin, 'center_admin', 'center');
insert into app.people (id, center_id, first_name, last_name, email, is_verified) values
  ('37000000-0000-4000-8000-0000000000e1', :c, 'Cal', 'Member', 'cal.member@example.com', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :member, '37000000-0000-4000-8000-0000000000e1');
insert into app.calendar_layers (id, center_id, key, name, kind) values (:layer, :c, 'events', 'Events', 'events');

begin;
set local role authenticated;
select pg_temp.as_user(:member);
select pg_temp.assert_raises($$select app.subscribe_calendar_layer('37000000-0000-4000-8000-0000000000b1', 'https://example.com/cal.ics', false)$$,
  'permission', 'a member without content.manage cannot subscribe a layer');
rollback;

begin;
set local role authenticated;
select pg_temp.as_user(:admin);
select pg_temp.assert_raises($$select app.subscribe_calendar_layer('37000000-0000-4000-8000-0000000000b1', 'ftp://example.com/cal.ics', false)$$,
  'https://', 'a link that is not http(s) or webcal is refused');
select app.subscribe_calendar_layer(:layer, 'webcal://example.com/cal.ics', true) as job1 \gset
select app.refresh_calendar_layer(:layer) as job2 \gset
select pg_temp.assert(:job1 = :job2, 'refreshing while a refresh is queued reuses that job');
reset role;
select pg_temp.assert((select source_url = 'https://example.com/cal.ics' and feed_subscribed and feed_creates_events and feed_status = 'pending'
                         from app.calendar_layers where id = :layer),
  'subscribing stores the link (webcal:// read as https://), and asks for events');
select pg_temp.assert((select kind = 'calendar.import_feed' and center_id = :c and payload->>'layer_id' = :layer and status = 'queued'
                         from app.jobs where id = :job1),
  'subscribing queues a calendar.import_feed job for the layer');
commit;

select pg_temp.assert_raises($$select * from app.worker_calendar_feeds_due(10)$$, 'background service', 'only the background service reads the due feeds');

-- The worker's side: import, refresh unchanged, then a changed feed.
begin;
set local role connect_worker;
select pg_temp.assert((select count(*) = 1 from app.worker_calendar_feed_layer('37000000-0000-4000-8000-0000000000b1')), 'the worker reads the subscribed layer');
select pg_temp.assert(exists (select 1 from app.worker_calendar_feeds_due(200) where layer_id = '37000000-0000-4000-8000-0000000000b1'),
  'a layer never refreshed is due');
select app.worker_calendar_feed_import(:layer, '[
  {"uid":"a@x","title":"Past puja","starts_on":"2020-01-05","ends_on":null,"all_day":false,"starts_at":"2020-01-05T16:00:00Z","ends_at":"2020-01-05T18:00:00Z","location":"Main hall","notes":null,"link":null,"sub":"10:00 AM – 12:00 PM · Main hall"},
  {"uid":"b@x","title":"Future festival","starts_on":"2099-10-01","ends_on":"2099-10-03","all_day":true,"starts_at":null,"ends_at":null,"location":null,"notes":"Bring family","link":"https://example.com/zoom","sub":null},
  {"uid":"c@x#20990105T100000","title":"Weekly class","starts_on":"2099-01-05","ends_on":null,"all_day":false,"starts_at":"2099-01-05T16:00:00Z","ends_at":null,"location":null,"notes":null,"link":null,"sub":"10:00 AM"}
]'::jsonb, '2000-01-01', '{"calendar_name":"Test"}'::jsonb) as r \gset
select pg_temp.assert((:'r')::jsonb @> '{"inserted":3,"updated":0,"removed":0,"events_created":3}'::jsonb, 'first import: 3 entries, 3 events');
select app.worker_calendar_feed_import(:layer, '[
  {"uid":"a@x","title":"Past puja","starts_on":"2020-01-05","ends_on":null,"all_day":false,"starts_at":"2020-01-05T16:00:00Z","ends_at":"2020-01-05T18:00:00Z","location":"Main hall","notes":null,"link":null,"sub":"10:00 AM – 12:00 PM · Main hall"},
  {"uid":"b@x","title":"Future festival","starts_on":"2099-10-01","ends_on":"2099-10-03","all_day":true,"starts_at":null,"ends_at":null,"location":null,"notes":"Bring family","link":"https://example.com/zoom","sub":null},
  {"uid":"c@x#20990105T100000","title":"Weekly class","starts_on":"2099-01-05","ends_on":null,"all_day":false,"starts_at":"2099-01-05T16:00:00Z","ends_at":null,"location":null,"notes":null,"link":null,"sub":"10:00 AM"}
]'::jsonb, '2000-01-01', '{}'::jsonb) as r \gset
select pg_temp.assert((:'r')::jsonb = '{"inserted":0,"updated":0,"unchanged":3,"removed":0,"events_created":0,"events_updated":0}'::jsonb,
  'the same feed again changes nothing');
select app.worker_calendar_feed_import(:layer, '[
  {"uid":"b@x","title":"Future festival (moved)","starts_on":"2099-10-02","ends_on":"2099-10-03","all_day":true,"starts_at":null,"ends_at":null,"location":null,"notes":"Bring family","link":"https://example.com/zoom","sub":null}
]'::jsonb, '2050-01-01', '{}'::jsonb) as r \gset
select pg_temp.assert((:'r')::jsonb @> '{"inserted":0,"updated":1,"removed":1,"events_updated":1}'::jsonb,
  'a changed feed updates the moved date and removes the dropped one after the kept-history date');
reset role;
select pg_temp.assert((select count(*) = 2 from app.calendar_entries where layer_id = :layer)
                  and exists (select 1 from app.calendar_entries where layer_id = :layer and source_uid = 'a@x'),
  'history before the kept date stays');
select pg_temp.assert((select e.status = 'completed' and e.venue = 'Main hall' from app.events e join app.calendar_entries ce on ce.event_id = e.id where ce.source_uid = 'a@x')
                  and (select e.status = 'published' and e.name = 'Future festival (moved)'
                         and e.starts_at = ('2099-10-02'::timestamp at time zone 'America/Chicago')
                         and e.ends_at = ('2099-10-04'::timestamp at time zone 'America/Chicago')
                         from app.events e join app.calendar_entries ce on ce.event_id = e.id where ce.source_uid = 'b@x'),
  'events follow their entries: past completed, all-day spans the whole days in the organization''s time zone');
select pg_temp.assert((select feed_status = 'ok' and feed_synced_at is not null and feed_result->>'events_updated' = '1'
                         from app.calendar_layers where id = :layer),
  'the layer shows the refresh as done, with its counts');
set local role connect_worker;
select app.worker_calendar_feed_failed(:layer, 'The calendar link was not found (the server answered 404).');
reset role;
select pg_temp.assert((select feed_status = 'error' and feed_error like '%404%' from app.calendar_layers where id = :layer),
  'a failed refresh is shown on the layer in plain English');
set local role connect_worker;
select pg_temp.assert(not exists (select 1 from app.worker_calendar_feeds_due(200) where layer_id = '37000000-0000-4000-8000-0000000000b1'),
  'a layer tried within the day is not due again');
reset role;
commit;

begin;
set local role authenticated;
select pg_temp.as_user(:admin);
select app.unsubscribe_calendar_layer(:layer);
reset role;
select pg_temp.assert((select not feed_subscribed and feed_status = 'none' and source_url is not null from app.calendar_layers where id = :layer)
                  and (select count(*) = 2 from app.calendar_entries where layer_id = :layer),
  'unsubscribing stops the refresh; the link and the entries stay');
commit;
