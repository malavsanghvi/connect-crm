-- 0578: the flyer maker. Guests (anon) read exactly the CURRENT flyer of an
-- event they may see (public or members and guests; published, RSVPs closed
-- or live; not confidential) and nothing else in the content bucket; members
-- read all content as before; event folders follow the Events module; an
-- event folder must belong to an event of that centre; the leftovers list,
-- the "art taken" step and the 7-day sweep; guests never read a confidential
-- event's row.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.sign_in(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- A guest: the anon key, no user.
create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;
-- Does the CURRENT role see this content-bucket object (through the storage.objects read policy)?
create or replace function pg_temp.sees(p_name text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = 'content' and name = p_name)
$$;
grant connect_worker to postgres;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c '''65000000-0000-4000-8000-0000000000c1'''
\set c2 '''65000000-0000-4000-8000-0000000000c2'''
\set manager '''65000000-0000-4000-8000-000000000001'''
\set lead '''65000000-0000-4000-8000-000000000002'''
\set member '''65000000-0000-4000-8000-000000000003'''
\set other '''65000000-0000-4000-8000-000000000004'''
\set lead2 '''65000000-0000-4000-8000-000000000005'''
\set p_manager '''65000000-0000-4000-8000-0000000000a1'''
\set p_lead '''65000000-0000-4000-8000-0000000000a2'''
\set p_member '''65000000-0000-4000-8000-0000000000a3'''
\set p_other '''65000000-0000-4000-8000-0000000000a4'''
\set p_lead2 '''65000000-0000-4000-8000-0000000000a5'''
\set e_pub '''65000000-0000-4000-8000-0000000000e1'''
\set e_mag '''65000000-0000-4000-8000-0000000000e2'''
\set e_mem '''65000000-0000-4000-8000-0000000000e3'''
\set e_conf '''65000000-0000-4000-8000-0000000000e4'''
\set e_draft '''65000000-0000-4000-8000-0000000000e5'''
\set e_done '''65000000-0000-4000-8000-0000000000e6'''
\set e_cancel '''65000000-0000-4000-8000-0000000000e7'''
\set e_c2 '''65000000-0000-4000-8000-0000000000e8'''
\set nowhere '''65000000-0000-4000-8000-0000000000ff'''

insert into auth.users (id, email) values
  (:manager, 'manager65@example.com'), (:lead, 'lead65@example.com'), (:member, 'member65@example.com'),
  (:other, 'other65@example.com'), (:lead2, 'lead65b@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'orbit65', 'Orbit 65 Community', 'O65', 'TX', 'active'),
  (:c2, 'orbit65b', 'Other 65 Community', 'O65B', 'TX', 'active');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_manager, :c, 'Mona', 'Manager', date '1980-01-01'),
  (:p_lead, :c, 'Lalit', 'Lead', date '1981-01-01'),
  (:p_member, :c, 'Mira', 'Member', date '1982-01-01'),
  (:p_other, :c2, 'Omar', 'Other', date '1983-01-01'),
  (:p_lead2, :c, 'Leena', 'Lead', date '1984-01-01');
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :manager, :p_manager), (:c, :lead, :p_lead), (:c, :member, :p_member), (:c2, :other, :p_other), (:c, :lead2, :p_lead2);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :manager, 'pathshala_committee');   -- events.manage, NOT content.manage
insert into app.events (id, center_id, name, status, audience, confidential) values
  (:e_pub, :c, 'Diwali Mela', 'published', 'public', false),
  (:e_mag, :c, 'Navratri Garba', 'live', 'members_and_guests', false),
  (:e_mem, :c, 'Members Dinner', 'published', 'members_only', false),
  (:e_conf, :c, 'Committee Retreat', 'published', 'public', true),
  (:e_draft, :c, 'Draft Event', 'draft', 'public', false),
  (:e_done, :c, 'Finished Event', 'completed', 'public', false),
  (:e_cancel, :c, 'Cancelled Event', 'cancelled', 'public', false),
  (:e_c2, :c2, 'Other Community Event', 'published', 'public', false);
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c, :lead, 'event_lead', 'event', :e_pub::uuid),
  (:c, :lead2, 'event_lead', 'event', :e_mem::uuid);

select :c || '/events/' || :e_pub || '/flyer-2000.png' as pub_cur,
       :c || '/events/' || :e_pub || '/flyer-1000.png' as pub_old,
       :c || '/events/' || :e_pub || '/flyer-0500.png' as pub_orphan,
       :c || '/events/' || :e_pub || '/flyer-3000.png' as pub_fresh,
       :c || '/events/' || :e_pub || '/flyer-4000.png' as pub_new,
       :c || '/events/' || :e_pub || '/art-1000.jpg' as pub_art,
       :c || '/events/' || :e_pub || '/art-0500.jpg' as pub_art_old,
       :c || '/events/' || :e_pub || '/art-0900.jpg' as pub_art_young,
       :c || '/events/' || :e_pub || '/notes.pdf' as pub_notes,
       :c || '/events/' || :e_mag || '/flyer-1.png' as mag_cur,
       :c || '/events/' || :e_mem || '/flyer-1.png' as mem_cur,
       :c || '/events/' || :e_conf || '/flyer-1.png' as conf_cur,
       :c || '/events/' || :e_draft || '/flyer-1.png' as draft_cur,
       :c || '/events/' || :e_done || '/flyer-1.png' as done_cur,
       :c || '/events/' || :e_cancel || '/flyer-1.png' as cancel_cur,
       :c2 || '/events/' || :e_c2 || '/flyer-1.png' as c2_cur,
       :c || '/guide/x.png' as guide
\gset

-- Objects, inserted as the storage service would (bypassing the policies).
insert into storage.objects (bucket_id, name, created_at) values
  ('content', :'pub_cur', now() - interval '9 days'),
  ('content', :'pub_old', now() - interval '1 hour'),
  ('content', :'pub_orphan', now() - interval '8 days'),
  ('content', :'pub_fresh', now()),
  ('content', :'pub_art', now() - interval '9 days'),
  ('content', :'pub_art_old', now() - interval '2 days'),
  ('content', :'pub_art_young', now() - interval '2 hours'),
  ('content', :'pub_notes', now() - interval '9 days'),
  ('content', :'mag_cur', now()),
  ('content', :'mem_cur', now()),
  ('content', :'conf_cur', now()),
  ('content', :'draft_cur', now()),
  ('content', :'done_cur', now()),
  ('content', :'cancel_cur', now()),
  ('content', :'c2_cur', now()),
  ('content', :'guide', now());

update app.events set flyer_path = :'pub_cur', flyer_source = 'designed',
       flyer_design = jsonb_build_object('v', 1, 'template', 'classic', 'size', 'post', 'headline', 'Diwali Mela', 'show_qr', true,
                                         'background', jsonb_build_object('source', 'ai', 'path', :'pub_art', 'prompt', 'Abstract diya pattern'))
 where id = :e_pub;
update app.events set flyer_path = :'mag_cur' where id = :e_mag;
update app.events set flyer_path = :'mem_cur' where id = :e_mem;
update app.events set flyer_path = :'conf_cur' where id = :e_conf;
update app.events set flyer_path = :'draft_cur' where id = :e_draft;
update app.events set flyer_path = :'done_cur' where id = :e_done;
update app.events set flyer_path = :'cancel_cur' where id = :e_cancel;
update app.events set flyer_path = :'c2_cur' where id = :e_c2;

select pg_temp.assert(not has_function_privilege('anon', 'app.event_flyer_is_public(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.event_flyer_is_public(text)', 'execute'),
  'the public-flyer check is internal: neither guests nor members can call it directly');

-- ── 1–3. What a guest reads ─────────────────────────────────────────────────
begin;
select pg_temp.as_anon();
select pg_temp.assert(pg_temp.sees(:'pub_cur'), 'a guest reads the current flyer of a public, published event');
select pg_temp.assert(pg_temp.sees(:'mag_cur'), 'and of a members-and-guests event that is live');
select pg_temp.assert(pg_temp.sees(:'c2_cur'), 'and of another community''s public event');
select pg_temp.assert(not pg_temp.sees(:'mem_cur'), 'not the flyer of a members-only event');
select pg_temp.assert(not pg_temp.sees(:'conf_cur'), 'not the flyer of a confidential public event');
select pg_temp.assert(not pg_temp.sees(:'draft_cur'), 'not the flyer of a draft');
select pg_temp.assert(not pg_temp.sees(:'done_cur'), 'not the flyer of a completed event');
select pg_temp.assert(not pg_temp.sees(:'cancel_cur'), 'not the flyer of a cancelled event');
select pg_temp.assert(not pg_temp.sees(:'pub_old'), 'not an older flyer file of the public event');
select pg_temp.assert(not pg_temp.sees(:'pub_art'), 'not the AI background art, even the art the current flyer uses');
select pg_temp.assert(not pg_temp.sees(:'pub_notes'), 'not another file in the event''s folder');
select pg_temp.assert(not pg_temp.sees(:'guide'), 'and nothing else in the content bucket');
select pg_temp.assert(app.can_read_object('content', :'pub_cur') and not app.can_read_object('content', :'pub_old'),
  'can_read_object answers the same way when asked directly');
rollback;

-- ── 4. A change takes effect at once ────────────────────────────────────────
begin;
update app.events set audience = 'members_only' where id = :e_pub;
select pg_temp.as_anon();
select pg_temp.assert(not pg_temp.sees(:'pub_cur'), 'making the event members-only hides its flyer from guests at once');
rollback;
begin;
update app.events set confidential = true where id = :e_pub;
select pg_temp.as_anon();
select pg_temp.assert(not pg_temp.sees(:'pub_cur'), 'marking it confidential hides the flyer at once');
rollback;
begin;
update app.events set flyer_path = :'pub_old' where id = :e_pub;
select pg_temp.as_anon();
select pg_temp.assert(pg_temp.sees(:'pub_old') and not pg_temp.sees(:'pub_cur'),
  'moving flyer_path shows the new file and hides the old one at once');
rollback;

-- ── 5. A legacy value with the bucket prefix still matches ──────────────────
begin;
update app.events set flyer_path = 'content/' || :'mag_cur' where id = :e_mag;
select pg_temp.as_anon();
select pg_temp.assert(pg_temp.sees(:'mag_cur'), 'a flyer_path stored as content/<key> still makes <key> readable');
rollback;

-- ── 6. A flyer_path outside the event's own folder is never made public ─────
begin;
update app.events set flyer_path = :'guide' where id = :e_mag;
update app.events set flyer_path = :'mem_cur' where id = :e_pub;
select pg_temp.as_anon();
select pg_temp.assert(not pg_temp.sees(:'guide'), 'pointing a public event''s flyer_path at <center>/guide/… does not publish that file');
select pg_temp.assert(not pg_temp.sees(:'mem_cur'), 'nor does pointing it at another event''s folder');
rollback;

-- ── 7. Another community's member ───────────────────────────────────────────
begin;
select pg_temp.sign_in(:other);
select pg_temp.assert(pg_temp.sees(:'pub_cur'), 'a member of another community reads a public event''s flyer, like any guest');
select pg_temp.assert(not pg_temp.sees(:'mem_cur') and not pg_temp.sees(:'pub_old'), 'but not a members-only flyer or an older file');
rollback;

-- ── 8. Members read all content as before ───────────────────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert(pg_temp.sees(:'mem_cur') and pg_temp.sees(:'pub_old') and pg_temp.sees(:'pub_art')
                      and pg_temp.sees(:'conf_cur') and pg_temp.sees(:'guide'),
  'a member of the community reads every content object, flyers and art included');
rollback;

-- ── 9. Event folders follow the Events module, not Content ──────────────────
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'events', false, 'Test 65: events off');
select pg_temp.as_anon();
select pg_temp.assert(not pg_temp.sees(:'pub_cur'), 'with Events off, a guest no longer reads the flyer');
rollback;
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'events', false, 'Test 65: events off');
select pg_temp.sign_in(:member);
select pg_temp.assert(not pg_temp.sees(:'pub_cur') and not pg_temp.sees(:'pub_old'), 'nor does a member');
select pg_temp.assert(pg_temp.sees(:'guide'), 'the rest of the content bucket still follows Content, which is on');
rollback;
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'events', false, 'Test 65: events off');
select pg_temp.sign_in(:manager);
select pg_temp.assert(not app.can_write_object('content', :'pub_new'), 'with Events off, the event manager cannot write a flyer');
select pg_temp.assert_raises(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'content', :'pub_new'),
  'row-level security', 'and the upload itself is refused');
rollback;
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'content', false, 'Test 65: content off');
select pg_temp.sign_in(:manager);
insert into storage.objects (bucket_id, name) values ('content', :'pub_new');
select pg_temp.assert(pg_temp.sees(:'pub_new'), 'with Content off and Events on, the event manager still writes and reads the event''s flyer');
select pg_temp.assert(not pg_temp.sees(:'guide'), 'while <center>/guide/… stays switched off');
rollback;
begin;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'content', false, 'Test 65: content off');
select pg_temp.as_anon();
select pg_temp.assert(pg_temp.sees(:'pub_cur'), 'and a guest still reads the public event''s flyer');
rollback;

-- ── 10. An event folder must be an event of that community ──────────────────
begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert(app.can_write_object('content', :'pub_new'), 'the event manager may write into a real event''s folder');
select pg_temp.assert(not app.can_write_object('content', :c || '/events/' || :nowhere || '/flyer-1.png'),
  'not into a folder named after an event that does not exist');
select pg_temp.assert(not app.can_write_object('content', :c || '/events/' || :e_c2 || '/flyer-1.png'),
  'nor into a folder named after another community''s event');
rollback;
begin;
select pg_temp.sign_in(:lead);
select pg_temp.assert(app.can_write_object('content', :'pub_new') and not app.can_write_object('content', :c || '/events/' || :e_mem || '/flyer-1.png'),
  'an event lead writes only into their own event''s folder');
rollback;

-- ── 11. flyer_source and flyer_design ───────────────────────────────────────
select pg_temp.assert((select flyer_source from app.events where id = :e_pub) = 'designed', 'flyer_source ''designed'' is accepted');
select pg_temp.assert_raises(format('update app.events set flyer_source = %L where id = %L', 'bogus', :e_mag),
  'events_flyer_source_check', 'an unknown flyer_source is refused');
select pg_temp.assert_raises(format('update app.events set flyer_design = %L::jsonb where id = %L', '[1, 2]', :e_mag),
  'events_flyer_design_check', 'a flyer_design that is not an object is refused');
select pg_temp.assert((select count(*) from pg_constraint where conrelid = 'app.events'::regclass and contype = 'c'
                          and pg_get_constraintdef(oid) ilike '%flyer_source%') = 1,
  'exactly one check constraint covers flyer_source (0535''s inline one was replaced)');

-- ── 12. Leftovers the portal tidies up ──────────────────────────────────────
begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert(array(select l.name from app.event_flyer_leftovers(:e_pub::uuid) l)
                        = array[:'pub_orphan', :'pub_art_old', :'pub_old']::text[],
  'leftovers: old flyers and art older than a day, oldest first; never the current flyer, the design''s art, fresh files or other files');
rollback;
begin;
select pg_temp.sign_in(:lead);
select pg_temp.assert(array_length(array(select l.name from app.event_flyer_leftovers(:e_pub::uuid) l), 1) = 3,
  'this event''s lead gets the same list');
rollback;
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises(format('select * from app.event_flyer_leftovers(%L::uuid)', :e_pub), 'only event managers',
  'a member cannot list an event''s flyer files');
rollback;
begin;
select pg_temp.sign_in(:lead2);
select pg_temp.assert_raises(format('select * from app.event_flyer_leftovers(%L::uuid)', :e_pub), 'only event managers',
  'the lead of a different event cannot either');
rollback;

-- ── 13. "Art taken": the bytes leave app.jobs ───────────────────────────────
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c, 'events.generate_flyer', jsonb_build_object('event_id', :e_pub, 'prompt', 'x'), 'done',
        jsonb_build_object('image_b64', 'ZmFrZQ==', 'content_type', 'image/jpeg', 'model', 'pollinations-flux', 'prompt', 'x'), now())
returning id as job_pub \gset
update app.events set flyer_job_id = :job_pub where id = :e_pub;
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e_pub, :'pub_art'), 'only event managers',
  'a member cannot mark art as stored');
rollback;
begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e_pub, :c || '/events/' || :e_mem || '/art-1.jpg'),
  'not this event''s flyer art', 'a path in another event''s folder is refused');
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e_pub, :'pub_old'),
  'not this event''s flyer art', 'a flyer (not art) path is refused');
select pg_temp.assert_raises(format('select app.events_flyer_art_taken(%L::uuid, %L)', :e_pub, :'pub_art' || '/../x'),
  'not this event''s flyer art', 'a path that climbs out of the folder is refused');
commit;
begin;
select pg_temp.sign_in(:manager);
select app.events_flyer_art_taken(:e_pub::uuid, :'pub_art');
commit;
select pg_temp.assert((select not (result ? 'image_b64') and result ->> 'stored_path' = :'pub_art' and result ? 'stored_at'
                              and result ->> 'content_type' = 'image/jpeg'
                         from app.jobs where id = :job_pub),
  'the image bytes are removed from the job, the stored path is recorded, and the rest of the result is kept');

-- ── 14. A new request strips older image bytes ──────────────────────────────
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c, 'events.generate_flyer', jsonb_build_object('event_id', :e_mag, 'prompt', 'x'), 'done', jsonb_build_object('image_b64', 'ZmFrZQ=='), now())
returning id as job_mag \gset
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c, 'events.generate_flyer', jsonb_build_object('event_id', :e_mem, 'prompt', 'x'), 'done', jsonb_build_object('image_b64', 'ZmFrZQ=='), now() - interval '2 days')
returning id as job_mem_old \gset
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c, 'events.generate_flyer', jsonb_build_object('event_id', :e_mem, 'prompt', 'x'), 'done', jsonb_build_object('image_b64', 'ZmFrZQ=='), now())
returning id as job_mem_new \gset
insert into app.jobs (center_id, kind, payload, status, result, finished_at)
values (:c2, 'events.generate_flyer', jsonb_build_object('event_id', :e_c2, 'prompt', 'x'), 'done', jsonb_build_object('image_b64', 'ZmFrZQ=='), now() - interval '2 days')
returning id as job_c2 \gset
update app.events set flyer_job_id = :job_mag where id = :e_mag;
begin;
select pg_temp.sign_in(:manager);
select app.events_request_flyer(:e_mag::uuid, 'Abstract golden mandala pattern, soft light') as req \gset
commit;
select pg_temp.assert((:'req'::jsonb ->> 'status') = 'queued', 'the new AI art request is queued');
select pg_temp.assert((select not (result ? 'image_b64') from app.jobs where id = :job_mag),
  'this event''s earlier finished job no longer holds image bytes');
select pg_temp.assert((select not (result ? 'image_b64') from app.jobs where id = :job_mem_old),
  'nor does a finished flyer job of this community more than a day old');
select pg_temp.assert((select result ? 'image_b64' from app.jobs where id = :job_mem_new),
  'another event''s fresh result is left for its organizer to take');
select pg_temp.assert((select result ? 'image_b64' from app.jobs where id = :job_c2),
  'and another community''s jobs are untouched');

-- ── 15. The 7-day sweep of orphaned flyer files ─────────────────────────────
begin;
set local role connect_worker;
select pg_temp.assert((select array_agg(x.name || '|' || x.retention_days order by x.name)
                         from app.storage_expired_objects(1000) x where x.center_id = :c::uuid)
                        = array[:'pub_orphan' || '|7']::text[],
  'the sweep lists the 8-day-old orphan flyer; not the current flyer, the design''s art, newer orphans or other files');
select pg_temp.assert(app.record_storage_deletions(65, jsonb_build_array(jsonb_build_object('bucket', 'content', 'name', :'pub_orphan',
                                                                                          'created_at', now() - interval '8 days'))) = 1,
  'the removal is recorded');
commit;
select pg_temp.assert((select reason like 'Event flyer tidy-up: a replaced or unused flyer file (job 65)%'
                         from app.audit_log where action = 'storage.retention_delete' and record_id = 'content/' || :'pub_orphan'
                        order by id desc limit 1),
  'with the flyer tidy-up reason in the audit log');

-- ── 16. Guests never read a confidential event ──────────────────────────────
begin;
select pg_temp.as_anon();
select pg_temp.assert((select count(*) from app.events where id = :e_conf::uuid) = 0, 'a guest no longer reads a confidential public event');
select pg_temp.assert((select count(*) from app.events where id in (:e_pub::uuid, :e_mag::uuid)) = 2,
  'non-confidential public and members-and-guests events are still visible to guests');
rollback;
