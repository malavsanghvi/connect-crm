-- 0781: a class announcement that is published reaches the families it is for, as a push (PATHSHALA_REGISTRATION_PLAN F8, P31).
-- Publishing (by a class teacher through the table policy, by the principal, or an insert that is already published) queues
-- ONE job; a draft queues none; unpublishing and publishing again queues another. The worker's batch function pushes the
-- adults (never a child) of the households with a learner PLACED or ACTIVE in the class (or, with no class, the term),
-- each person once per announcement, with the audience, title and the start of the message; people with no phone with the app
-- are not pushed and are reached if they install it before a later publish; a withdrawn or waitlisted learner's household
-- and another class's households get nothing. Families read the published announcement through the existing policy
-- (drafts never). The functions are the worker's alone.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- The background service's call: one batch, as the worker role.
create or replace function pg_temp.notify_batch(p_announcement uuid, p_offset int default 0, p_limit int default 50) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.worker_pathshala_announcement_notify(p_announcement, p_offset, p_limit);
  reset role;
  return r;
end $$;
-- The pushes about one announcement (the announcement's id is at the top level of the payload).
create or replace function pg_temp.pushes(p_announcement uuid) returns setof app.messages language sql stable as $$
  select * from app.messages where template_key = 'pathshala_announcement' and payload->>'announcement_id' = p_announcement::text $$;
create or replace function pg_temp.jobs_for(p_announcement uuid) returns bigint language sql stable as $$
  select count(*) from app.jobs where kind = 'pathshala.announcement_notify' and payload->>'announcement_id' = p_announcement::text $$;
create or replace function pg_temp.told(p_announcement uuid, p_user uuid) returns boolean language sql stable as $$
  select exists (select 1 from pg_temp.pushes(p_announcement) m where m.to_address = p_user::text) $$;

grant connect_worker to postgres;

\set c '''81000000-0000-4000-8000-0000000000c1'''
\set term '''81000000-0000-4000-8000-0000000000b1'''
\set track '''81000000-0000-4000-8000-0000000000b2'''
\set plevel '''81000000-0000-4000-8000-0000000000b3'''
\set classA '''81000000-0000-4000-8000-0000000000b4'''
\set classB '''81000000-0000-4000-8000-0000000000b5'''
\set u_teacher '''81000000-0000-4000-8000-0000000000a1'''
\set u_principal '''81000000-0000-4000-8000-0000000000a2'''
\set u_mom '''81000000-0000-4000-8000-0000000000a3'''
\set u_dad '''81000000-0000-4000-8000-0000000000a4'''
\set u_kid '''81000000-0000-4000-8000-0000000000a5'''
\set u_nb '''81000000-0000-4000-8000-0000000000a6'''
\set u_wd '''81000000-0000-4000-8000-0000000000a7'''
\set u_wl '''81000000-0000-4000-8000-0000000000a8'''
\set p_mom '''81000000-0000-4000-8000-0000000000d1'''
\set p_dad '''81000000-0000-4000-8000-0000000000d2'''
\set p_kid '''81000000-0000-4000-8000-0000000000d3'''
\set p_nb '''81000000-0000-4000-8000-0000000000d4'''
\set p_nbkid '''81000000-0000-4000-8000-0000000000d5'''
\set p_wd '''81000000-0000-4000-8000-0000000000d6'''
\set p_wdkid '''81000000-0000-4000-8000-0000000000d7'''
\set p_wl '''81000000-0000-4000-8000-0000000000d8'''
\set p_wlkid '''81000000-0000-4000-8000-0000000000d9'''
\set h1 '''81000000-0000-4000-8000-0000000000e1'''
\set h2 '''81000000-0000-4000-8000-0000000000e2'''
\set h3 '''81000000-0000-4000-8000-0000000000e3'''
\set h4 '''81000000-0000-4000-8000-0000000000e4'''
\set annA '''81000000-0000-4000-8000-0000000000f1'''
\set annAll '''81000000-0000-4000-8000-0000000000f2'''
\set annDraft '''81000000-0000-4000-8000-0000000000f3'''

-- ── Fixtures ─────────────────────────────────────────────────────────────────────
-- One community with a term and two classes (A "Jainism 6", B "Jainism 7"). Household 1 (mom and dad, and a child with her own
-- login and phone) has the child ACTIVE in class A; household 2 (a parent) has a child PLACED in class B; household 3's child
-- was WITHDRAWN from class A and household 4's child is WAITLISTED for it (both parents have the app).
insert into auth.users (id, email) values
  (:u_teacher, 'teacher81@example.com'), (:u_principal, 'principal81@example.com'), (:u_mom, 'mom81@example.com'), (:u_dad, 'dad81@example.com'),
  (:u_kid, 'kid81@example.com'), (:u_nb, 'nb81@example.com'), (:u_wd, 'wd81@example.com'), (:u_wl, 'wl81@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'ann81', 'Announcement 81 Community', 'A81', 'TX', 'active', 'America/Chicago');
update app.centers
   set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('notifications',
                 coalesce(rules->'notifications', '{}'::jsonb) || '{"quiet_start_hour": 0, "quiet_end_hour": 0}'::jsonb)
 where id = :c;
insert into app.households (id, center_id, display_name) values
  (:h1, :c, 'Shah household 81'), (:h2, :c, 'Mehta household 81'), (:h3, :c, 'Rao household 81'), (:h4, :c, 'Patel household 81');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_mom, :c, 'Mira', 'Shah', date '1982-01-01', 'mom81@example.com'),
  (:p_dad, :c, 'Raj', 'Shah', date '1980-01-01', 'dad81@example.com'),
  (:p_kid, :c, 'Anya', 'Shah', (current_date - interval '10 years')::date, 'kid81@example.com'),
  (:p_nb, :c, 'Nita', 'Mehta', date '1981-05-05', 'nb81@example.com'),
  (:p_nbkid, :c, 'Veer', 'Mehta', (current_date - interval '8 years')::date, null),
  (:p_wd, :c, 'Wanda', 'Rao', date '1979-03-03', 'wd81@example.com'),
  (:p_wdkid, :c, 'Rhea', 'Rao', (current_date - interval '9 years')::date, null),
  (:p_wl, :c, 'Wil', 'Patel', date '1978-04-04', 'wl81@example.com'),
  (:p_wlkid, :c, 'Pia', 'Patel', (current_date - interval '9 years')::date, null);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_mom, :c, 'primary', true), (:h1, :p_dad, :c, 'spouse', false), (:h1, :p_kid, :c, 'child', false),
  (:h2, :p_nb, :c, 'primary', true), (:h2, :p_nbkid, :c, 'child', false),
  (:h3, :p_wd, :c, 'primary', true), (:h3, :p_wdkid, :c, 'child', false),
  (:h4, :p_wl, :c, 'primary', true), (:h4, :p_wlkid, :c, 'child', false);
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :u_mom, :p_mom), (:c, :u_dad, :p_dad), (:c, :u_kid, :p_kid), (:c, :u_nb, :p_nb), (:c, :u_wd, :p_wd), (:c, :u_wl, :p_wl);
-- Phones with the app: mom, the child, the neighbour parent, and the two parents whose learners are not in the class. Dad has a login but no phone yet.
insert into app.push_devices (user_id, center_id, platform, token, last_seen_at, invalid_at) values
  (:u_mom, :c, 'ios', 'ExponentPushToken[ann81mom]', now(), null),
  (:u_kid, :c, 'android', 'ExponentPushToken[ann81kid]', now(), null),
  (:u_nb, :c, 'android', 'ExponentPushToken[ann81nb]', now(), null),
  (:u_wd, :c, 'ios', 'ExponentPushToken[ann81wd]', now(), null),
  (:u_wl, :c, 'ios', 'ExponentPushToken[ann81wl]', now(), null);
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, status) values
  (:term, :c, 'Term 81', current_date - 30, current_date + 200, 'active');
insert into app.pathshala_tracks (id, center_id, key, name) values (:track, :c, 'jainism81', 'Jainism 81');
insert into app.pathshala_levels (id, center_id, track_id, key, name) values (:plevel, :c, :track, '6', 'Jainism 6 (81)');
insert into app.pathshala_classes (id, center_id, term_id, level_id, name) values
  (:classA, :c, :term, :plevel, 'Jainism 6'), (:classB, :c, :term, :plevel, 'Jainism 7');
insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, class_id, status) values
  (:c, :term, :p_kid, :h1, :classA, 'active'),
  (:c, :term, :p_nbkid, :h2, :classB, 'placed'),
  (:c, :term, :p_wdkid, :h3, :classA, 'withdrawn'),
  (:c, :term, :p_wlkid, :h4, :classA, 'waitlisted');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c, :u_teacher, 'teacher', 'class', :classA), (:c, :u_principal, 'pathshala_principal', 'pathshala', null);

-- ── The pieces ───────────────────────────────────────────────────────────────────
select pg_temp.assert(to_regprocedure('app.worker_pathshala_announcement_notify(uuid,integer,integer)') is not null
                      and to_regprocedure('app._pathshala_announcement_recipients(uuid)') is not null
                      and to_regprocedure('app.class_announcement_published()') is not null
                      and exists (select 1 from pg_trigger t where t.tgrelid = 'app.class_announcements'::regclass and t.tgname = 'class_announcements_published' and not t.tgisinternal),
  '0781 adds the batch function, the recipients function and the publish trigger');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_pathshala_announcement_notify(uuid, int, int)', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_pathshala_announcement_notify(uuid, int, int)', 'execute')
                      and not has_function_privilege('anon', 'app.worker_pathshala_announcement_notify(uuid, int, int)', 'execute')
                      and not has_function_privilege('service_role', 'app.worker_pathshala_announcement_notify(uuid, int, int)', 'execute')
                      and not has_function_privilege('authenticated', 'app._pathshala_announcement_recipients(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app._pathshala_announcement_recipients(uuid)', 'execute'),
  'the batch function is the worker role''s alone and the recipients function is internal');
select pg_temp.assert((select count(*) = 3 and bool_and(exists (select 1 from unnest(p.proconfig) as g(setting) where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('worker_pathshala_announcement_notify', '_pathshala_announcement_recipients', 'class_announcement_published')),
  'each of the three pins the search path app, public, extensions');
select pg_temp.assert_raises($$select app.worker_pathshala_announcement_notify('81000000-0000-4000-8000-0000000000ff', 0, 50)$$,
  'only the background service', 'it asserts the worker role itself, even for the database owner');
select pg_temp.assert(exists (select 1 from app.message_templates t where t.center_id is null and t.key = 'pathshala_announcement' and t.channel = 'push' and t.language = 'en'
                                 and t.subject = '{{audience}}: {{title}}' and t.body = '{{snippet}}'),
  'the platform default push template says the audience, the title and the start of the message');

-- ── A draft queues nothing; publishing queues one job ───────────────────────────
insert into app.class_announcements (id, center_id, class_id, term_id, title, body_md, author_user, published_at)
values (:annA, :c, :classA, :term, 'Jai Jinendra', E'Test Message...\n\nTest 123', :u_teacher, null);
select pg_temp.assert(pg_temp.jobs_for(:annA) = 0, 'a draft announcement queues no job');
insert into app.class_announcements (id, center_id, class_id, term_id, title, body_md, author_user, published_at)
values (:annDraft, :c, :classB, :term, 'Not yet', 'Draft only', :u_principal, null);
select pg_temp.assert(pg_temp.jobs_for(:annDraft) = 0, 'a second draft queues no job either');
select pg_temp.assert(pg_temp.notify_batch(:annA) ->> 'reason' = 'The announcement is no longer published.'
                      and (pg_temp.notify_batch(:annA) ->> 'done')::boolean and not exists (select 1 from pg_temp.pushes(:annA)),
  'the batch function does nothing for an announcement that is not published');

-- A class's teacher publishes it through the table policy (the portal's Publish button).
begin;
select pg_temp.sign_in(:u_teacher);
update app.class_announcements set published_at = now() where id = :annA;
commit;
select pg_temp.assert(pg_temp.jobs_for(:annA) = 1 and (select center_id from app.jobs where kind = 'pathshala.announcement_notify' and payload->>'announcement_id' = :annA::text) = :c,
  'a teacher publishing their class''s announcement queues one pathshala.announcement_notify job for the community');
-- Saving it again (another field) does not queue another: the job is for the moment it becomes published.
update app.class_announcements set title = 'Jai Jinendra' where id = :annA;
select pg_temp.assert(pg_temp.jobs_for(:annA) = 1, 'editing a published announcement queues nothing');

-- ── The pushes ─────────────────────────────────────────────────────────────────
-- Class A: the active learner's household adults are mom and dad (the child is not told); the withdrawn and waitlisted learners' households, and class B's, are not.
select pg_temp.notify_batch(:annA) as r1 \gset
select pg_temp.assert((:'r1'::jsonb ->> 'total')::int = 2 and (:'r1'::jsonb ->> 'people')::int = 2 and (:'r1'::jsonb ->> 'pushed')::int = 1
                      and (:'r1'::jsonb ->> 'unreachable')::int = 1 and (:'r1'::jsonb ->> 'skipped')::int = 0 and (:'r1'::jsonb ->> 'done')::boolean,
  'class A: two adults, one pushed (mom) and one with no phone with the app yet (dad)');
select pg_temp.assert(pg_temp.told(:annA, :u_mom), 'mom (an adult of the active learner''s household, with the app) is pushed');
select pg_temp.assert(not pg_temp.told(:annA, :u_dad), 'dad has a login but no phone with the app: no push is queued for him');
select pg_temp.assert(not pg_temp.told(:annA, :u_kid), 'the child is never pushed, even with a login and a phone');
select pg_temp.assert(not pg_temp.told(:annA, :u_nb) and not pg_temp.told(:annA, :u_wd) and not pg_temp.told(:annA, :u_wl),
  'another class''s parent, a withdrawn learner''s parent and a waitlisted learner''s parent are not pushed');
select pg_temp.assert((select count(*) from pg_temp.pushes(:annA)) = 1
                      and (select m.channel::text = 'push' and m.subject = 'Jainism 6: Jai Jinendra' and m.body like 'Test Message...%Test 123' and m.topic_key = 'pathshala'
                                  and m.payload->>'type' = 'pathshala' and m.payload->>'deep_link' = '/pathshala-announcements' and m.status = 'queued'
                             from pg_temp.pushes(:annA) m),
  'the push is queued with the class name and title as its title, the start of the message, the pathshala topic, and the type and deep link a tap needs');
-- Whoever else the notice was for is logged once; the unreachable are not logged.
select pg_temp.assert((select count(*) = 1 and bool_and(person_id = :p_mom and outcome = 'pushed') from app.notice_log where kind = 'pathshala_announcement' and ref_id = :annA),
  'the log holds one row, for mom, as pushed (dad is not logged: nothing could be sent)');

-- A second batch run (a retried job, or the same publish twice) tells nobody twice.
select pg_temp.notify_batch(:annA) as r2 \gset
select pg_temp.assert((:'r2'::jsonb ->> 'pushed')::int = 0 and (:'r2'::jsonb ->> 'skipped')::int = 1 and (:'r2'::jsonb ->> 'unreachable')::int = 1
                      and (select count(*) from pg_temp.pushes(:annA)) = 1,
  'running the job again skips mom (already told) and sends nothing new');

-- Unpublish and publish again: another job is queued, and still nobody is told twice.
begin;
select pg_temp.sign_in(:u_principal);
update app.class_announcements set published_at = null where id = :annA;
commit;
select pg_temp.assert(pg_temp.jobs_for(:annA) = 1, 'unpublishing queues nothing');
select pg_temp.assert(pg_temp.notify_batch(:annA) ->> 'reason' = 'The announcement is no longer published.', 'while it is a draft again the job tells nobody');
begin;
select pg_temp.sign_in(:u_principal);
update app.class_announcements set published_at = now() where id = :annA;
commit;
select pg_temp.assert(pg_temp.jobs_for(:annA) = 2, 'publishing it again queues another job');
-- Dad installs the app in the meantime: the second job reaches him (he was never logged), and mom is not told again.
insert into app.push_devices (user_id, center_id, platform, token, last_seen_at, invalid_at) values (:u_dad, :c, 'ios', 'ExponentPushToken[ann81dad]', now(), null);
select pg_temp.notify_batch(:annA) as r3 \gset
select pg_temp.assert((:'r3'::jsonb ->> 'pushed')::int = 1 and (:'r3'::jsonb ->> 'skipped')::int = 1
                      and pg_temp.told(:annA, :u_dad) and (select count(*) from pg_temp.pushes(:annA)) = 2,
  'after dad installs the app, publishing again reaches him once and does not tell mom a second time');

-- ── A whole-Pathshala announcement, published as it is created ──────────────────
-- A long message: the push carries only its start, the audience is "Pathshala", and every household with a learner placed or active in the term is told.
insert into app.class_announcements (id, center_id, class_id, term_id, title, body_md, author_user, published_at)
values (:annAll, :c, null, :term, 'No class next Sunday', repeat('Please read this carefully. ', 30), :u_principal, now());
select pg_temp.assert(pg_temp.jobs_for(:annAll) = 1, 'an announcement inserted already published queues its job');
select pg_temp.notify_batch(:annAll) as r4 \gset
select pg_temp.assert((:'r4'::jsonb ->> 'total')::int = 3 and (:'r4'::jsonb ->> 'pushed')::int = 3 and (:'r4'::jsonb ->> 'unreachable')::int = 0,
  'term-wide: mom, dad (active learner) and the placed learner''s parent are told');
select pg_temp.assert(pg_temp.told(:annAll, :u_mom) and pg_temp.told(:annAll, :u_dad) and pg_temp.told(:annAll, :u_nb)
                      and not pg_temp.told(:annAll, :u_kid) and not pg_temp.told(:annAll, :u_wd) and not pg_temp.told(:annAll, :u_wl),
  'term-wide reaches the adults of every placed or active learner''s household, and nobody else');
select pg_temp.assert((select bool_and(m.subject = 'Pathshala: No class next Sunday' and char_length(m.body) = 121 and m.body like '%…' and m.body like 'Please read this carefully.%')
                         from pg_temp.pushes(:annAll) m),
  'a term-wide push says "Pathshala" and carries only the first 120 characters of a long message');

-- ── Paging: small batches add up to the same people, once each ───────────────────
select pg_temp.notify_batch(:annAll, 0, 1) as b1 \gset
select pg_temp.notify_batch(:annAll, 1, 1) as b2 \gset
select pg_temp.notify_batch(:annAll, 2, 1) as b3 \gset
select pg_temp.assert((:'b1'::jsonb ->> 'done')::boolean = false and (:'b2'::jsonb ->> 'done')::boolean = false and (:'b3'::jsonb ->> 'done')::boolean
                      and (:'b1'::jsonb ->> 'skipped')::int + (:'b2'::jsonb ->> 'skipped')::int + (:'b3'::jsonb ->> 'skipped')::int = 3
                      and (select count(*) from pg_temp.pushes(:annAll)) = 3,
  'a batch of one at a time covers the same three people, finishes on the last, and (already told) sends nothing more');

-- ── What families read in the app (the existing policy, untouched) ──────────────
begin;
select pg_temp.sign_in(:u_mom);
select pg_temp.assert((select count(*) from app.class_announcements where id = :annA) = 1 and (select count(*) from app.class_announcements where id = :annAll) = 1
                      and (select count(*) from app.class_announcements where id = :annDraft) = 0,
  'mom reads her child''s class announcement and the whole-Pathshala one, and never a draft');
commit;
begin;
select pg_temp.sign_in(:u_nb);
select pg_temp.assert((select count(*) from app.class_announcements where id = :annA) = 0 and (select count(*) from app.class_announcements where id = :annAll) = 1
                      and (select count(*) from app.class_announcements where id = :annDraft) = 0,
  'a parent whose child is in another class reads the whole-Pathshala announcement but not class A''s, and never a draft');
commit;
