-- 0535: "Generate flyer with AI" — the request/result RPCs are gated the
-- same way editing the event already is (events.manage or this event's
-- lead), and the "content" bucket accepts a flyer write from an event
-- manager or lead under <center>/events/<event id>/… only, not the rest of
-- the bucket (which stays content.manage-only).
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

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c '''45000000-0000-4000-8000-0000000000c1'''
\set manager '''45000000-0000-4000-8000-000000000001'''
\set lead '''45000000-0000-4000-8000-000000000002'''
\set member '''45000000-0000-4000-8000-000000000003'''
\set contentmgr '''45000000-0000-4000-8000-000000000004'''
\set event1 '''45000000-0000-4000-8000-0000000000e1'''
\set event2 '''45000000-0000-4000-8000-0000000000e2'''
insert into auth.users (id, email, phone) values
  (:manager, 'manager45@example.com', null),
  (:lead, 'lead45@example.com', null),
  (:member, 'member45@example.com', null),
  (:contentmgr, 'contentmgr45@example.com', null);
insert into app.centers (id, slug, name, short_name, state_region, status) values (:c, 'orbit45', 'Orbit Test Community', 'OTC', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :manager, 'pathshala_committee'),   -- has events.manage, NOT content.manage
  (:c, :contentmgr, 'religious_coordinator'); -- has content.manage, NOT events.manage
insert into app.events (id, center_id, name, status) values
  (:event1, :c, 'Diwali Mela', 'draft'),
  (:event2, :c, 'Another Event', 'draft');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c, :lead, 'event_lead', 'event', :event1::uuid);

-- ── Request: permission gating mirrors editing the event ────────────────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.events_request_flyer('$$ || :event1 || $$'::uuid, 'A festive flyer')$$,
  'only event managers', 'a member with no events access cannot request a flyer');
rollback;

begin;
select pg_temp.sign_in(:lead);
select pg_temp.assert_raises($$select app.events_request_flyer('$$ || :event2 || $$'::uuid, 'A festive flyer')$$,
  'only event managers', 'this event''s lead cannot request a flyer for a DIFFERENT event');
rollback;

begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert_raises($$select app.events_request_flyer('$$ || :event1 || $$'::uuid, '   ')$$,
  'describe the flyer', 'an empty prompt is refused');
rollback;

-- ── An event manager can request one; it queues a job and remembers it ──────
begin;
select pg_temp.sign_in(:manager);
select app.events_request_flyer(:event1::uuid, 'A warm Diwali celebration flyer for Orbit Test Community, with diyas and rangoli.') as req \gset
commit;
select pg_temp.assert((:'req'::jsonb ->> 'status') = 'queued', 'the request is queued');
select pg_temp.assert((select flyer_job_id from app.events where id = :event1::uuid) is not null, 'the event remembers the job id');
select pg_temp.assert(exists (select 1 from app.jobs where id = (select flyer_job_id from app.events where id = :event1::uuid)
                                and kind = 'events.generate_flyer' and payload ->> 'event_id' = :event1
                                and payload ->> 'prompt' like 'A warm Diwali%'),
  'the job carries the event id and the prompt, and nothing else');

-- ── This event's lead (no center-wide events.manage) can request one too ────
begin;
select pg_temp.sign_in(:lead);
select app.events_request_flyer(:event1::uuid, 'A simpler flyer, please.') as req2 \gset
commit;
select pg_temp.assert((:'req2'::jsonb ->> 'status') = 'queued', 'this event''s lead can also request a flyer for their own event');

-- ── Result polling mirrors permission and reads app.jobs even though jobs'
-- own RLS (settings/integrations.manage) would otherwise hide it ───────────
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.events_flyer_result('$$ || :event1 || $$'::uuid)$$,
  'only event managers', 'a member cannot poll the flyer job either');
rollback;

begin;
select pg_temp.sign_in(:manager);
select app.events_flyer_result(:event1::uuid) as res \gset
commit;
select pg_temp.assert((:'res'::jsonb ->> 'status') = 'queued', 'the event manager sees the queued status');

update app.jobs set status = 'done', result = jsonb_build_object('image_b64', 'ZmFrZQ==', 'model', 'gpt-image-1', 'prompt', 'x'), finished_at = now()
 where id = (select flyer_job_id from app.events where id = :event1::uuid);
begin;
select pg_temp.sign_in(:manager);
select app.events_flyer_result(:event1::uuid) as res2 \gset
commit;
select pg_temp.assert((:'res2'::jsonb ->> 'status') = 'done', 'once the worker finishes, the manager reads "done"');
select pg_temp.assert((:'res2'::jsonb -> 'result' ->> 'image_b64') = 'ZmFrZQ==', 'and the image bytes');

-- ── An event with no request yet reads "none" ───────────────────────────────
begin;
select pg_temp.sign_in(:manager);
select app.events_flyer_result(:event2::uuid) as res3 \gset
commit;
select pg_temp.assert((:'res3'::jsonb ->> 'status') = 'none', 'an event that never asked for a flyer reads "none"');

-- ── Storage: the flyer path is writable by an event manager (or this
-- event's lead), never by an unrelated member, and the rest of the "content"
-- bucket stays content.manage-only ───────────────────────────────────────────
begin;
select pg_temp.sign_in(:manager);
insert into storage.objects (bucket_id, name) values ('content', :c || '/events/' || :event1 || '/flyer-1.png');
commit;
select pg_temp.assert(exists (select 1 from storage.objects where bucket_id = 'content' and name = :c || '/events/' || :event1 || '/flyer-1.png'),
  'an event manager can write a flyer under the event''s own folder');

begin;
select pg_temp.sign_in(:lead);
insert into storage.objects (bucket_id, name) values ('content', :c || '/events/' || :event1 || '/flyer-2.png');
commit;
select pg_temp.assert(exists (select 1 from storage.objects where bucket_id = 'content' and name = :c || '/events/' || :event1 || '/flyer-2.png'),
  'this event''s lead can write a flyer for their own event too');

begin;
select pg_temp.sign_in(:lead);
select pg_temp.assert_raises($s$insert into storage.objects (bucket_id, name) values ('content', '$s$ || :c || $s$/events/$s$ || :event2 || $s$/flyer-3.png')$s$,
  'row-level security', 'this event''s lead cannot write a flyer for a DIFFERENT event');
rollback;

begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($s$insert into storage.objects (bucket_id, name) values ('content', '$s$ || :c || $s$/events/$s$ || :event1 || $s$/flyer-4.png')$s$,
  'row-level security', 'an unrelated member cannot write a flyer at all');
rollback;

begin;
select pg_temp.sign_in(:manager);
select pg_temp.assert_raises($s$insert into storage.objects (bucket_id, name) values ('content', '$s$ || :c || $s$/guide/some-other-media.png')$s$,
  'row-level security', 'events.manage does not open the REST of the content bucket (still content.manage-only)');
rollback;

begin;
select pg_temp.sign_in(:contentmgr);
insert into storage.objects (bucket_id, name) values ('content', :c || '/guide/some-other-media.png');
commit;
select pg_temp.assert(exists (select 1 from storage.objects where bucket_id = 'content' and name = :c || '/guide/some-other-media.png'),
  'content.manage still writes the rest of the content bucket as before');
