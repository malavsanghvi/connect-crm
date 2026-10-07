-- 0589: virus scanning of uploads, built complete and switched OFF.
-- The table, its rules and grants; the mode (off by default, monitor, enforce), set only by a platform admin with a fresh
-- 2FA check, and switching it on queues a sweep; off: every upload still queues a check that nothing claims, nothing is
-- recorded and every read is what it was; monitor: results are recorded, an infected file is kept and written to the
-- audit log, and nothing is denied; enforce: a homework file or recording uploaded after the switch is opened by the
-- family at once and by the teacher only once it is clean (a failed check keeps it with the family), files from before
-- the switch are not held, an infected file is refused to everyone at once; after the worker removed it: the homework
-- part is marked removed by the check, the recording cleared, the photo removed, the learner, the parent, the reviewer and
-- the uploader told with upload.removed (never the file name), the office gets an audit entry, and it happens once; a new
-- version clears a result; the sweep queues the backlog, the infected files still stored and day-old failed checks; the
-- worker functions are connect_worker's alone; Settings › Storage and Integrations get real counts; the storage audit
-- now covers the homework bucket (folder only, never a file name), and so does the audit of the results.
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
  perform set_config('role', 'authenticated', true);
end $$;
-- A platform admin who has just passed a fresh two-factor check (what the setup wizard needs to save a setting).
create or replace function pg_temp.sign_in_step_up(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 3600),
                             jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60)))::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- Does the signed-in role see this object through the storage.objects read policy (what a download or a signed URL asks)?
create or replace function pg_temp.sees(p_bucket text, p_name text) returns boolean language sql as $$
  select exists (select 1 from storage.objects where bucket_id = p_bucket and name = p_name)
$$;
-- The worker's view of one object, then its result recorded (as the background service does it).
create or replace function pg_temp.record(p_bucket text, p_name text, p_status text, p_signature text default null) returns jsonb
language plpgsql as $$
declare o jsonb;
begin
  o := app.worker_scan_object(p_bucket, p_name);
  return app.worker_record_scan(p_bucket, p_name, (o->>'object_id')::uuid, o->>'version', p_status, 'ClamAV 1.4.3/27790/test',
                                p_signature, coalesce((o->>'size')::bigint, 0), 74, case when p_status = 'failed' then 'clamd did not answer' end);
end $$;
-- The storage.scan jobs of one stored file: by the object's id (a homework job names no file) or by its name (the other
-- buckets).
create or replace function pg_temp.scan_jobs(p_bucket text, p_name text) returns setof app.jobs language sql stable as $$
  select j.* from app.jobs j
   where j.kind = 'storage.scan' and j.payload->>'bucket' = p_bucket
     and (j.payload->>'name' = p_name
          or j.payload->>'object_id' = (select o.id::text from storage.objects o where o.bucket_id = p_bucket and o.name = p_name))
$$;
-- The SQLSTATE a statement fails with ('OK' when it does not).
create or replace function pg_temp.state_of(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then return sqlstate;
end $$;
-- The tests switch to connect_worker; a hosted postgres holds ADMIN on it but not SET.
grant connect_worker to postgres;

-- ── Fixtures ───────────────────────────────────────────────────────────────
\set c '''74000000-0000-4000-8000-0000000000c1'''
\set mom '''74000000-0000-4000-8000-000000000001'''
\set kid '''74000000-0000-4000-8000-000000000002'''
\set teacher '''74000000-0000-4000-8000-000000000003'''
\set admin '''74000000-0000-4000-8000-000000000004'''
\set member '''74000000-0000-4000-8000-000000000005'''
\set pa '''74000000-0000-4000-8000-000000000006'''
\set p_mom '''74000000-0000-4000-8000-0000000000a1'''
\set p_kid '''74000000-0000-4000-8000-0000000000a2'''
\set p_teacher '''74000000-0000-4000-8000-0000000000a3'''
\set p_admin '''74000000-0000-4000-8000-0000000000a4'''
\set p_member '''74000000-0000-4000-8000-0000000000a5'''
\set h1 '''74000000-0000-4000-8000-0000000000b1'''
\set h2 '''74000000-0000-4000-8000-0000000000b2'''
\set term '''74000000-0000-4000-8000-000000000a01'''
\set track '''74000000-0000-4000-8000-000000000a02'''
\set plevel '''74000000-0000-4000-8000-000000000a03'''
\set class '''74000000-0000-4000-8000-000000000a04'''
\set goal '''74000000-0000-4000-8000-000000000e01'''
\set level '''74000000-0000-4000-8000-000000000f01'''
\set step '''74000000-0000-4000-8000-000000000d01'''
\set hw '''74000000-0000-4000-8000-000000000a10'''
\set sub '''74000000-0000-4000-8000-000000000a11'''
\set album '''74000000-0000-4000-8000-000000000a12'''

insert into auth.users (id, email) values
  (:mom, 'mom74@example.com'), (:kid, 'kid74@example.com'), (:teacher, 'teacher74@example.com'), (:admin, 'admin74@example.com'),
  (:member, 'member74@example.com'), (:pa, 'platform74@example.com');
insert into app.accounts (user_id, is_platform_admin) values (:pa, true);
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'scan74', 'Scan 74 Community', 'S74', 'TX', 'active', 'America/Chicago');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah household 74'), (:h2, :c, 'Mehta household 74');
insert into app.people (id, center_id, first_name, last_name, date_of_birth, email) values
  (:p_mom, :c, 'Mira', 'Shah', date '1982-01-01', 'mom74@example.com'),
  (:p_kid, :c, 'Anya', 'Shah', (current_date - interval '10 years')::date, null),
  (:p_teacher, :c, 'Tej', 'Teacher', date '1975-01-01', 'teacher74@example.com'),
  (:p_admin, :c, 'Ada', 'Admin', date '1978-01-01', 'admin74@example.com'),
  (:p_member, :c, 'Nita', 'Mehta', date '1981-05-05', 'member74@example.com');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_mom, :c, 'primary', true), (:h1, :p_kid, :c, 'child', false), (:h2, :p_member, :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :mom, :p_mom), (:c, :kid, :p_kid), (:c, :teacher, :p_teacher), (:c, :admin, :p_admin), (:c, :member, :p_member);
insert into app.pathshala_terms (id, center_id, name, starts_on, ends_on, status) values (:term, :c, 'Term 74', current_date - 30, current_date + 200, 'active');
insert into app.pathshala_tracks (id, center_id, key, name) values (:track, :c, 'jainism74', 'Jainism 74');
insert into app.pathshala_levels (id, center_id, track_id, key, name) values (:plevel, :c, :track, '1', 'Jainism 1 (74)');
insert into app.pathshala_classes (id, center_id, term_id, level_id, name) values (:class, :c, :term, :plevel, 'Class 74');
insert into app.pathshala_enrollments (center_id, term_id, student_person_id, household_id, class_id, status) values (:c, :term, :p_kid, :h1, :class, 'active');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:c, :teacher, 'teacher', 'class', :class), (:c, :admin, 'center_admin', 'center', null);
insert into app.gyan_goals (id, center_id, key, name) values (:goal, :c, 'g74', 'Learn 74');
insert into app.gyan_levels (id, goal_id, key, name, sort_order, points, requires_teacher_signoff) values (:level, :goal, '1', 'Foundations 74', 1, 0, false);
insert into app.gyan_steps (id, level_id, kind, title, sort_order) values (:step, :level, 'recite', 'Recite Navkar', 1);
insert into app.gyan_assignments (id, center_id, level_id, title, allowed_kinds, status, published_at) values
  (:hw, :c, :level, 'Draw a tirthankar', '{photo,voice,text}', 'published', now());
insert into app.gyan_submissions (id, center_id, assignment_id, person_id, status, submitted_by, submitted_at) values
  (:sub, :c, :hw, :p_kid, 'submitted', :kid, now());
insert into app.photo_albums (id, center_id, title) values (:album, :c, 'Picnic 74');

select :c || '/' || :p_kid || '/' || :sub || '/' as folder \gset
select :'folder' || '74000000-0000-4000-8000-0000000000f1.jpg' as hw_old,
       :'folder' || '74000000-0000-4000-8000-0000000000f2.jpg' as hw_new,
       :'folder' || '74000000-0000-4000-8000-0000000000f3.m4a' as hw_bad,
       :'folder' || '74000000-0000-4000-8000-0000000000f4.jpg' as hw_fail,
       :c || '/' || :p_kid || '/step-74.m4a' as rec,
       :c || '/' || :p_kid || '/step-74b.m4a' as rec_bad,
       :c || '/' || :album || '/' || :member || '-1759700000000.jpg' as photo,
       :c || '/run-74/people.csv' as imp,
       :c || '/' || :h1 || '/2025.pdf' as stmt
\gset

-- ── The schema, the rules, the grants ──────────────────────────────────────
select pg_temp.assert((select array_agg(a.attname::text order by k.ord) from pg_constraint con
                         cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
                         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
                        where con.conrelid = 'app.upload_scans'::regclass and con.contype = 'p') = array['bucket_id', 'name']
                      and (select relrowsecurity from pg_class where oid = 'app.upload_scans'::regclass)
                      and (select module_key is null from app.module_tables where table_name = 'upload_scans')
                      and exists (select 1 from pg_trigger where tgrelid = 'app.upload_scans'::regclass and tgname = 'audit_upload_scans'
                                    and tgfoid = 'app.audit_row'::regproc and tgnargs = 2),
  'app.upload_scans: one row per (bucket, name), row level security on, part of the core platform, audited by the bucket and the object id');
select pg_temp.assert(has_table_privilege('authenticated', 'app.upload_scans', 'select')
                      and not has_table_privilege('authenticated', 'app.upload_scans', 'insert')
                      and not has_table_privilege('authenticated', 'app.upload_scans', 'update')
                      and not has_table_privilege('authenticated', 'app.upload_scans', 'delete')
                      and not has_table_privilege('anon', 'app.upload_scans', 'select')
                      and not has_table_privilege('connect_worker', 'app.upload_scans', 'select'),
  'nobody writes the results over the API (only the worker''s functions do); signed-in staff read them through their policy');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.worker_scan_object(text, text, uuid)', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_record_scan(text, text, uuid, text, text, text, text, bigint, bigint, text)', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_scan_removed(text, text, bigint)', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_scan_sweep(int)', 'execute')
                      and not exists (select 1 from unnest(array['authenticated', 'anon', 'service_role']) r(role), unnest(array[
                                        'app.worker_scan_object(text, text, uuid)', 'app.worker_record_scan(text, text, uuid, text, text, text, text, bigint, bigint, text)',
                                        'app.worker_scan_removed(text, text, bigint)', 'app.worker_scan_sweep(int)']) f(fn)
                                       where has_function_privilege(r.role, f.fn, 'execute')),
  'the four worker functions are the background service''s alone');
select pg_temp.assert_raises($$select app.worker_scan_sweep(10)$$, 'only the background service', 'and each one asserts the worker role itself, even for the database owner');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.upload_scan_state(text, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.upload_scan_held(text, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.upload_scan_mode()', 'execute')
                      and not has_function_privilege('authenticated', 'app._upload_scan_summary(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._upload_scan_tell_user(uuid, uuid, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.upload_scan_state(text, text)', 'execute')
                      and has_function_privilege('anon', 'app.can_read_object(text, text)', 'execute'),
  'the state, the gate''s helpers, the summary and the notices are internal; the read rule itself is still the policy''s');
create or replace function pg_temp.scan_fns() returns setof pg_proc language sql stable as $$
  select p.* from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = any (array[
    'platform_setting_keys', 'set_platform_setting', 'upload_scan_mode', 'upload_scan_enforced_since', 'connect_storage_buckets',
    'upload_scan_gated_buckets', 'upload_scan_enforced_buckets', 'upload_scan_lock', 'upload_scan_state', 'upload_scan_held',
    'storage_enqueue_scan', 'upload_scans_follow_object', 'can_read_object', 'worker_scan_object', 'worker_record_scan',
    'storage_name_for_audit', '_upload_scan_tell_user', '_upload_scan_tell_reviewers', 'worker_scan_removed', 'worker_scan_sweep',
    'storage_audit', '_upload_scan_summary', 'center_storage_overview', 'background_service_status', 'gyan_submission_json']) $$;
select pg_temp.assert((select count(*) from pg_temp.scan_fns()) = 25
                      and (select count(*) from pg_temp.scan_fns() p where p.prosecdef and (p.proconfig is null or not (p.proconfig::text like '%search_path=app, public, extensions%'))) = 0
                      and (select count(*) from pg_temp.scan_fns() p where p.prosecdef
                              and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))) = 0,
  'every security definer function 0589 defines or redefines pins its search path and none is open to PUBLIC');
select pg_temp.assert(app.upload_scan_gated_buckets() = array['homework', 'recordings', 'photos', 'org-documents', 'content', 'store']
                      and app.upload_scan_enforced_buckets() = array['homework', 'recordings']
                      and app.connect_storage_buckets() @> array['homework', 'exports', 'statements'] and cardinality(app.connect_storage_buckets()) = 10
                      and 'homework' = any (app.storage_scan_buckets()) and not ('statements' = any (app.storage_scan_buckets())),
  'the gate names its six buckets in rollout order and enforces only homework and recordings in this release; the audit covers all ten buckets');
select pg_temp.assert((select count(*) from app.message_templates where center_id is null and key = 'upload.removed' and language = 'en') = 2
                      and not exists (select 1 from app.message_templates where key = 'upload.removed'
                                       and coalesce(subject, '') || body ~ '\{\{\s*(name|file|path|storage_path|signature)\s*\}\}'),
  'upload.removed is seeded for push and email, and no variable of it can carry the file''s name or the signature');
select pg_temp.assert(app.platform_setting_keys() @> array['UPLOAD_SCAN_MODE'] and cardinality(app.platform_setting_keys()) = 20,
  'the mode is a platform setting the setup wizard stores (0585''s nineteen plus UPLOAD_SCAN_MODE)');

-- ── Off: the default ───────────────────────────────────────────────────────
delete from app.platform_settings where key = 'UPLOAD_SCAN_MODE';
select pg_temp.assert(app.upload_scan_mode() = 'off' and app.upload_scan_enforced_since() is null, 'with no setting saved, scanning is off');
insert into storage.objects (bucket_id, name, metadata, version, owner_id) values
  ('homework', :'hw_old', '{"size": 1000, "mimetype": "image/jpeg"}', 'v1', :kid),
  ('recordings', :'rec', '{"size": 2000, "mimetype": "audio/mp4"}', 'r1', :mom),
  ('photos', :'photo', '{"size": 3000, "mimetype": "image/jpeg"}', 'p1', :member),
  ('imports', :'imp', '{"size": 4000, "mimetype": "text/csv"}', 'i1', :admin),
  ('statements', :'stmt', '{"size": 500, "mimetype": "application/pdf"}', 's1', null);
insert into app.gyan_submission_files (center_id, submission_id, kind, storage_path, mime_type, bytes) values
  (:c, :sub, 'photo', :'hw_old', 'image/jpeg', 1000);
insert into app.gyan_progress (center_id, person_id, step_id, stars, recording_path) values (:c, :p_kid, :step, 0, :'rec');
insert into app.photos (center_id, album_id, storage_path, uploaded_by, status) values (:c, :album, :'photo', :member, 'pending');
select pg_temp.assert((select count(*) = 4 and bool_and(max_attempts = 25 and status = 'queued')
                         from (select * from pg_temp.scan_jobs('homework', :'hw_old') union all select * from pg_temp.scan_jobs('recordings', :'rec')
                               union all select * from pg_temp.scan_jobs('photos', :'photo') union all select * from pg_temp.scan_jobs('imports', :'imp')) j)
                      and not exists (select 1 from pg_temp.scan_jobs('statements', :'stmt')),
  'every upload to a scanned bucket still queues a check, now with 25 attempts; statements are not scanned');
select pg_temp.assert((select bool_and(not (payload ? 'name') and payload->>'object_id' = (select id::text from storage.objects where bucket_id = 'homework' and name = :'hw_old'))
                         from pg_temp.scan_jobs('homework', :'hw_old'))
                      and (select bool_and(payload->>'name' = :'photo' and payload ? 'object_id') from pg_temp.scan_jobs('photos', :'photo'))
                      and not exists (select 1 from app.audit_log where record_table = 'jobs' and (coalesce(before::text, '') || coalesce(after::text, '')) ~ '0000000000f[0-9]\.(jpg|m4a)'),
  'a homework file''s check names the object by its id, never the file name (nor does its audit entry); other buckets keep the name');
select pg_temp.assert(app.upload_scan_state('homework', :'hw_old') = 'pending' and app.upload_scan_state('statements', :'stmt') = 'exempt'
                      and app.upload_scan_state('exports', 'x/y.csv') = 'exempt' and not app.upload_scan_held('homework', :'hw_old'),
  'nothing is checked yet: pending; statements and exports are exempt; nothing is held');
select (app.gyan_submission_json(:sub)->'files'->0) as part_off \gset
select pg_temp.assert(:'part_off'::jsonb->>'scan' = 'pending' and (:'part_off'::jsonb->>'scan_held')::boolean = false,
  'the answer''s part says pending and not held');
begin;
select pg_temp.sign_in(:teacher);
select pg_temp.assert(pg_temp.sees('homework', :'hw_old') and pg_temp.sees('recordings', :'rec'),
  'off: the teacher opens the handed-in part and the recording exactly as before');
rollback;
begin; set local role connect_worker;
select pg_temp.assert(pg_temp.record('homework', :'hw_old', 'clean') = '{"recorded": false, "reason": "off", "mode": "off"}'::jsonb
                      and app.worker_scan_sweep(100) = '{"mode": "off", "queued": 0}'::jsonb
                      and app.worker_scan_object('homework', :'hw_old')->>'mode' = 'off',
  'off: a result is not recorded and the sweep queues nothing (and the worker is told the mode)');
commit;
select pg_temp.assert(not exists (select 1 from app.upload_scans where center_id = :c), 'off: no result exists');

-- ── Setting the mode ───────────────────────────────────────────────────────
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.set_platform_setting('UPLOAD_SCAN_MODE', 'monitor', 'try')$$, 'platform admins',
  'an organization''s admin cannot switch scanning on');
rollback;
begin;
select pg_temp.sign_in(:pa);
select pg_temp.assert(pg_temp.state_of($$select app.set_platform_setting('UPLOAD_SCAN_MODE', 'monitor', 'ClamAV is installed')$$) = 'CCSTP',
  'a platform admin needs a fresh 2FA check');
rollback;
begin;
select pg_temp.sign_in_step_up(:pa);
select pg_temp.assert_raises($$select app.set_platform_setting('UPLOAD_SCAN_MODE', 'on', 'x')$$, 'Choose off or monitor', 'a mode that is not one of the three is refused');
select pg_temp.assert_raises($$select app.set_platform_setting('UPLOAD_SCAN_MODE', 'Enforce', 'x')$$,
  'Enforce (removing infected files) comes with the next update; use monitor until then.',
  'enforce is LOCKED in this release: the setting refuses it with a plain sentence (owner, 2026-10-07)');
select pg_temp.assert(app.set_platform_setting('UPLOAD_SCAN_MODE', ' MONITOR ', 'ClamAV is installed on the droplet') ->> 'value' = 'monitor',
  'a platform admin switches to monitor (lower-cased)');
commit;
select pg_temp.assert(app.upload_scan_mode() = 'monitor' and app.upload_scan_enforced_since() is null
                      and exists (select 1 from app.jobs where kind = 'storage.scan_sweep' and center_id is null and status = 'queued'),
  'monitor is on, nothing is enforced, and a sweep was queued to check the backlog at once');
select set_at as monitor_at from app.platform_settings where key = 'UPLOAD_SCAN_MODE' \gset
select count(*) as mode_audits from app.audit_log where record_table = 'platform_settings' and record_id = 'UPLOAD_SCAN_MODE' \gset
begin;
select pg_temp.sign_in_step_up(:pa);
select app.set_platform_setting('UPLOAD_SCAN_MODE', 'monitor', 'saved again');
commit;
select pg_temp.assert((select set_at = :'monitor_at'::timestamptz from app.platform_settings where key = 'UPLOAD_SCAN_MODE')
                      and (select count(*) from app.audit_log where record_table = 'platform_settings' and record_id = 'UPLOAD_SCAN_MODE') = :'mode_audits'::int
                      and (select count(*) from app.jobs where kind = 'storage.scan_sweep' and center_id is null and status = 'queued') = 1,
  'saving the same mode again changes nothing (set_at is when the mode last changed) and queues no second sweep');
-- The enforce lock leaves no trace: refused from monitor as well, the mode and its moment stay as they were, nothing is
-- audited as a change and no second sweep is queued.
begin;
select pg_temp.sign_in_step_up(:pa);
select pg_temp.assert_raises($$select app.set_platform_setting('UPLOAD_SCAN_MODE', 'enforce', 'Trying enforce from monitor')$$,
  'comes with the next update', 'enforce is refused from monitor too');
rollback;
select pg_temp.assert(app.upload_scan_mode() = 'monitor' and app.upload_scan_enforced_since() is null
                      and (select set_at = :'monitor_at'::timestamptz from app.platform_settings where key = 'UPLOAD_SCAN_MODE')
                      and (select count(*) from app.audit_log where record_table = 'platform_settings' and record_id = 'UPLOAD_SCAN_MODE') = :'mode_audits'::int
                      and (select count(*) from app.jobs where kind = 'storage.scan_sweep' and center_id is null and status = 'queued') = 1,
  'a refused enforce changes nothing: still monitor, the same moment, no audit entry, no second sweep');

-- ── Monitor: record everything, deny nothing ───────────────────────────────
begin; set local role connect_worker;
select pg_temp.assert(pg_temp.record('homework', :'hw_old', 'clean') = '{"recorded": true, "status": "clean", "action": "none", "mode": "monitor"}'::jsonb,
  'monitor: a clean result is recorded');
select pg_temp.assert(pg_temp.record('photos', :'photo', 'infected', 'Win.Test.EICAR_HDB-1') = '{"recorded": true, "status": "infected", "action": "keep", "mode": "monitor"}'::jsonb,
  'monitor: an infected file is recorded and kept');
select pg_temp.assert(pg_temp.record('homework', :'hw_old', 'failed') ->> 'reason' = 'already',
  'a failed check never overwrites a clean result of the same version');
select pg_temp.assert(app.worker_record_scan('homework', :'hw_old', gen_random_uuid(), 'v1', 'clean', null, null, 1, 74, null) ->> 'reason' = 'changed'
                      and app.worker_record_scan('homework', :'hw_old', (app.worker_scan_object('homework', :'hw_old')->>'object_id')::uuid, 'v0', 'clean', null, null, 1, 74, null) ->> 'reason' = 'changed'
                      and app.worker_record_scan('homework', :'folder' || '74000000-0000-4000-8000-0000000000ff.jpg', gen_random_uuid(), null, 'clean', null, null, 1, 74, null) ->> 'reason' = 'gone',
  'a result for another object or another version is not recorded (changed), nor one for a file that is gone');
select pg_temp.assert_raises($$select app.worker_record_scan('statements', 'x/y.pdf', gen_random_uuid(), null, 'clean', null, null, 1, 74, null)$$,
  'not checked for viruses', 'a bucket that is not scanned is refused');
select pg_temp.assert_raises($$select app.worker_record_scan('homework', 'x/y.jpg', gen_random_uuid(), null, 'suspicious', null, null, 1, 74, null)$$,
  'clean, infected or failed', 'a status that is not one of the three is refused');
select pg_temp.assert((app.worker_scan_object('homework', :'hw_old')->'result'->>'current')::boolean
                      and app.worker_scan_object('homework', :'hw_old')->'result'->>'status' = 'clean'
                      and (app.worker_scan_object('homework', :'hw_old')->>'size')::bigint = 1000,
  'the worker sees the recorded result as current for this version, and the size it must download');
commit;
select pg_temp.assert(app.upload_scan_state('homework', :'hw_old') = 'clean' and app.upload_scan_state('photos', :'photo') = 'infected'
                      and (select engine = 'ClamAV 1.4.3/27790/test' and signature = 'Win.Test.EICAR_HDB-1' and uploaded_by = :member and center_id = :c
                             and job_id = 74 and bytes = 3000 from app.upload_scans where bucket_id = 'photos' and name = :'photo'),
  'the results carry the engine, the signature, the uploader, the community and the job');
select pg_temp.assert((select count(*) = 1 and bool_and(after->>'removed' = 'false' and after->>'mode' = 'monitor' and reason like 'Virus check (monitor mode): Win.Test.EICAR_HDB-1 found; the file was kept%')
                         from app.audit_log where action = 'storage.scan_infected' and record_id = 'photos/' || :'photo'),
  'monitor: the office finds the infected file in the audit log, marked kept');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert(pg_temp.sees('photos', :'photo'), 'monitor denies nothing: the uploader still opens the infected photo');
rollback;
begin;
select pg_temp.sign_in(:teacher);
select pg_temp.assert(pg_temp.sees('recordings', :'rec'), 'monitor denies nothing: the teacher opens a recording that is not checked yet');
rollback;
-- A new version clears the result; a removed file takes its result with it, except an infected one.
update storage.objects set version = 'v2', updated_at = now() where bucket_id = 'homework' and name = :'hw_old';
select pg_temp.assert(not exists (select 1 from app.upload_scans where bucket_id = 'homework' and name = :'hw_old')
                      and app.upload_scan_state('homework', :'hw_old') = 'pending',
  'a new version of the file clears its result: it is pending again');
begin; set local role connect_worker;
select pg_temp.record('homework', :'hw_old', 'clean');
select pg_temp.record('imports', :'imp', 'clean');
commit;
delete from storage.objects where bucket_id = 'imports' and name = :'imp';
select pg_temp.assert(not exists (select 1 from app.upload_scans where bucket_id = 'imports' and name = :'imp')
                      and (select count(*) from app.audit_log where record_table = 'upload_scans' and action = 'upload_scans.delete' and record_id like 'imports:%') = 1,
  'a removed file''s clean result goes with it (audited)');

-- ── Enforce ────────────────────────────────────────────────────────────────
-- Locked for platform admins in this release; the code is built and tested here by writing the setting as the database
-- owner, the way the next update's set_platform_setting will.
begin;
select pg_temp.sign_in_step_up(:pa);
select pg_temp.assert_raises($$select app.set_platform_setting('UPLOAD_SCAN_MODE', 'enforce', 'A week of monitor found nothing wrong')$$,
  'comes with the next update', 'even a platform admin with a fresh 2FA check cannot switch to enforce yet');
rollback;
select pg_temp.assert(app.upload_scan_mode() = 'monitor', 'and the mode stays monitor');
update app.platform_settings set value = '"enforce"'::jsonb, set_by = :pa, set_at = now() where key = 'UPLOAD_SCAN_MODE';
select pg_temp.assert(app.upload_scan_mode() = 'enforce'
                      and app.upload_scan_enforced_since() = (select set_at from app.platform_settings where key = 'UPLOAD_SCAN_MODE'),
  'enforce (written by the database owner): on since the moment it was switched');
-- Files that arrive after the switch (each statement is its own transaction, so its now() is later).
insert into storage.objects (bucket_id, name, metadata, version, owner_id) values ('homework', :'hw_new', '{"size": 1100, "mimetype": "image/jpeg"}', 'v1', :kid);
insert into storage.objects (bucket_id, name, metadata, version, owner_id) values ('homework', :'hw_bad', '{"size": 1200, "mimetype": "audio/mp4"}', 'v1', :kid);
insert into storage.objects (bucket_id, name, metadata, version, owner_id) values ('homework', :'hw_fail', '{"size": 1300, "mimetype": "image/jpeg"}', 'v1', :mom);
insert into storage.objects (bucket_id, name, metadata, version, owner_id) values ('recordings', :'rec_bad', '{"size": 2100, "mimetype": "audio/mp4"}', 'r1', :kid);
insert into app.gyan_submission_files (center_id, submission_id, kind, storage_path, mime_type, bytes, sort_order) values
  (:c, :sub, 'photo', :'hw_new', 'image/jpeg', 1100, 1), (:c, :sub, 'voice', :'hw_bad', 'audio/mp4', 1200, 2), (:c, :sub, 'photo', :'hw_fail', 'image/jpeg', 1300, 3);
-- The recording from before the switch is still pending: it is not held.
select pg_temp.assert(app.upload_scan_held('homework', :'hw_new') and app.upload_scan_held('recordings', :'rec_bad')
                      and not app.upload_scan_held('recordings', :'rec') and app.upload_scan_state('recordings', :'rec') = 'pending'
                      and not app.upload_scan_held('homework', :'hw_old'),
  'a file uploaded after the switch is held while pending; one from before is not, and a clean one never is');
begin;
select pg_temp.sign_in(:teacher);
select pg_temp.assert(not pg_temp.sees('homework', :'hw_new') and not pg_temp.sees('recordings', :'rec_bad'),
  'enforce: the teacher cannot open a new homework part or recording that is not checked yet');
select pg_temp.assert(pg_temp.sees('homework', :'hw_old') and pg_temp.sees('recordings', :'rec'),
  'but opens the clean part, and the recording from before the switch');
rollback;
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert(pg_temp.sees('homework', :'hw_new') and pg_temp.sees('recordings', :'rec_bad') and pg_temp.sees('homework', :'hw_old'),
  'the parent opens her child''s new files at once');
rollback;
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert(pg_temp.sees('homework', :'hw_new') and pg_temp.sees('recordings', :'rec_bad'), 'and so does the child who uploaded them');
insert into storage.objects (bucket_id, name, metadata, version) values ('recordings', :c || '/' || :p_kid || '/step-74c.m4a', '{"size": 10}', 'r1');
select pg_temp.assert(pg_temp.sees('recordings', :c || '/' || :p_kid || '/step-74c.m4a'), 'uploads are never blocked: the child records again in enforce mode and hears it');
rollback;
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert(not pg_temp.sees('homework', :'hw_new') and not pg_temp.sees('homework', :'hw_old'), 'another family opens nothing, checked or not');
rollback;
select (app.gyan_submission_json(:sub)->'files') as parts_enforce \gset
select pg_temp.assert((select f->>'scan' = 'pending' and (f->>'scan_held')::boolean from jsonb_array_elements(:'parts_enforce'::jsonb) f where f->>'storage_path' = :'hw_new')
                      and (select f->>'scan' = 'clean' and not (f->>'scan_held')::boolean from jsonb_array_elements(:'parts_enforce'::jsonb) f where f->>'storage_path' = :'hw_old'),
  'the answer''s parts say which one is being checked (pending, held) and which is clean');
-- Checked clean: the teacher opens it. A failed check keeps the file with the family.
begin; set local role connect_worker;
select pg_temp.record('homework', :'hw_new', 'clean');
select pg_temp.assert(pg_temp.record('homework', :'hw_fail', 'failed') ->> 'status' = 'failed', 'a check that could not finish is recorded as failed');
commit;
begin;
select pg_temp.sign_in(:teacher);
select pg_temp.assert(pg_temp.sees('homework', :'hw_new'), 'once it is clean, the teacher opens it');
select pg_temp.assert(not pg_temp.sees('homework', :'hw_fail'), 'a failed check keeps the part from the teacher');
rollback;
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert(pg_temp.sees('homework', :'hw_fail'), 'and with the family, who can still open it');
rollback;

-- An infected homework part: refused to everyone at once, then removed and the people concerned told.
begin; set local role connect_worker;
select pg_temp.assert(pg_temp.record('homework', :'hw_bad', 'infected', 'Win.Test.EICAR_HDB-1') = '{"recorded": true, "status": "infected", "action": "remove", "mode": "enforce"}'::jsonb,
  'enforce: an infected file is recorded and the worker is told to remove it');
select pg_temp.assert(app.worker_scan_removed('homework', :'hw_bad', 74) ->> 'reason' = 'the file is still stored',
  'the tidy-up waits until the Storage API has deleted the file');
commit;
begin;
select pg_temp.sign_in(:kid);
select pg_temp.assert(not pg_temp.sees('homework', :'hw_bad'), 'from the moment it is recorded, not even the child who uploaded it opens it');
rollback;
begin;
select pg_temp.sign_in(:mom);
select pg_temp.assert(not pg_temp.sees('homework', :'hw_bad'), 'nor the parent');
rollback;
-- The Storage API deletes the file (as the worker asks it to); the infected result stays as the record.
delete from storage.objects where bucket_id = 'homework' and name = :'hw_bad';
select pg_temp.assert((select status = 'infected' and removed_at is null from app.upload_scans where bucket_id = 'homework' and name = :'hw_bad'),
  'removing the file keeps its infected result');
select count(*) as msgs_before from app.messages where center_id = :c \gset
begin; set local role connect_worker;
select app.worker_scan_removed('homework', :'hw_bad', 74) as removed_hw \gset
select pg_temp.assert(app.worker_scan_removed('homework', :'hw_bad', 74) = '{"done": true, "already": true}'::jsonb,
  'the tidy-up happens once');
commit;
select pg_temp.assert(:'removed_hw'::jsonb->>'done' = 'true' and (:'removed_hw'::jsonb->>'parts')::int = 1
                      and (:'removed_hw'::jsonb->>'told')::int >= 2 and (:'removed_hw'::jsonb->>'reviewers')::int = 1,
  'the part was marked, the family told and the reviewer told');
select pg_temp.assert((select storage_path is null and deleted_at is not null and removed_reason = 'infected' and kind = 'voice'
                         from app.gyan_submission_files where submission_id = :sub and bytes = 1200),
  'the homework part is marked removed by the virus check (no path, deleted, removed_reason infected)');
select pg_temp.assert((select count(*) from app.messages where center_id = :c and template_key = 'upload.removed' and to_address = :kid::text and channel = 'push') = 1
                      and (select count(*) from app.messages where center_id = :c and template_key = 'upload.removed' and to_address = :mom::text and channel = 'push') = 1
                      and (select count(*) from app.messages where center_id = :c and template_key = 'upload.removed' and channel = 'email' and to_address = 'mom74@example.com') = 1
                      and (select payload->>'type' = 'homework_parent' and payload->>'deep_link' = '/gyan/homework/' || :hw || '?person=' || :p_kid
                             from app.messages where center_id = :c and template_key = 'upload.removed' and to_address = :mom::text and channel = 'push')
                      and (select payload->>'type' = 'homework_review' and not (payload ? 'deep_link')
                             from app.messages where center_id = :c and template_key = 'upload.removed' and to_address = :teacher::text),
  'the child and the parent (push and email) and the teacher (push, homework_review) are told; a tap opens the homework');
select pg_temp.assert((select bool_and(body like 'A file in Anya''s homework "Draw a tirthankar" was removed: the virus check found a problem with it.%'
                                       and position('0000000000f3' in coalesce(subject, '') || body || payload::text) = 0
                                       and position('.m4a' in coalesce(subject, '') || body || payload::text) = 0
                                       and position('EICAR' in coalesce(subject, '') || body || payload::text) = 0)
                         from app.messages where center_id = :c and template_key = 'upload.removed' and channel = 'push'),
  'no message carries the file''s name, its extension or what the scanner found');
select pg_temp.assert((select count(*) = 1 and bool_and(record_id = 'homework/' || :'folder' || '***' and after->>'name' = :'folder' || '***'
                                                        and after->>'removed' = 'true' and after->>'signature' = 'Win.Test.EICAR_HDB-1'
                                                        and reason like 'Virus check: Win.Test.EICAR_HDB-1 found; the file was removed and the family and the reviewers were told (job 74)%'
                                                        and client_app = 'job')
                         from app.audit_log where action = 'storage.scan_infected' and center_id = :c and record_id like 'homework/%'),
  'the office finds it in the audit log: what was found, that it was removed, who was told, the folder but not the file name');
select (app.gyan_submission_json(:sub)->'files') as parts_after \gset
select pg_temp.assert((select f->>'scan' = 'infected' and not (f->>'scan_held')::boolean and f->>'storage_path' is null and f->>'deleted_at' is not null
                         from jsonb_array_elements(:'parts_after'::jsonb) f where f->>'kind' = 'voice'),
  'the answer''s part says it was removed by the virus check');

-- An infected recording: cleared from the learner's progress; the child and the parent are told.
begin; set local role connect_worker;
select pg_temp.assert(pg_temp.record('recordings', :'rec', 'infected', 'Win.Test.EICAR_HDB-1') ->> 'action' = 'remove',
  'a recording uploaded before the switch is checked like any other: infected, to be removed');
commit;
delete from storage.objects where bucket_id = 'recordings' and name = :'rec';
begin; set local role connect_worker;
select app.worker_scan_removed('recordings', :'rec', 75) as removed_rec \gset
commit;
select pg_temp.assert((:'removed_rec'::jsonb->>'parts')::int = 1 and (select recording_path is null from app.gyan_progress where person_id = :p_kid and step_id = :step)
                      and (select count(*) from app.messages where center_id = :c and template_key = 'upload.removed' and payload->'vars'->>'what' = 'A recording Anya made in Gyan Path'
                             and to_address in (:kid::text, :mom::text, 'mom74@example.com')) = 3,
  'an infected recording is cleared from the progress row, and the child and the parent are told');

-- An infected photo (recorded and kept in monitor): the sweep queues its removal now that enforce is on.
delete from app.jobs where id in (select id from pg_temp.scan_jobs('photos', :'photo'));
begin; set local role connect_worker;
select app.worker_scan_sweep(1000) as sweep1 \gset
commit;
select pg_temp.assert((select count(*) from pg_temp.scan_jobs('photos', :'photo') j where j.status = 'queued' and j.payload->>'sweep' = 'remove' and j.max_attempts = 25) = 1
                      and (:'sweep1'::jsonb->>'to_remove')::int >= 1,
  'enforce: the sweep queues the removal of an infected file kept in monitor mode');
select pg_temp.assert((select count(*) from (select * from pg_temp.scan_jobs('homework', :'hw_old') union all select * from pg_temp.scan_jobs('homework', :'hw_new')) j
                        where j.payload ? 'sweep') = 0
                      and (select count(*) from pg_temp.scan_jobs('recordings', :'rec_bad') j where j.status in ('queued', 'running')) = 1,
  'it queues nothing for a clean file, and nothing twice for a file whose check is already waiting');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert(not pg_temp.sees('photos', :'photo'), 'enforce: an infected photo is refused even to its uploader (a bucket that is not held still refuses infected files)');
rollback;
delete from storage.objects where bucket_id = 'photos' and name = :'photo';
begin; set local role connect_worker;
select app.worker_scan_removed('photos', :'photo', 76) as removed_photo \gset
commit;
select pg_temp.assert((select status = 'removed' from app.photos where storage_path = :'photo')
                      and (select count(*) from app.messages where center_id = :c and template_key = 'upload.removed'
                             and payload->'vars'->>'what' = 'A photo you uploaded to the album "Picnic 74"' and to_address in (:member::text, 'member74@example.com')) = 2,
  'an infected photo is marked removed and its uploader is told (push and email)');

-- The sweep: the backlog (a file with no result and no waiting check) and a failed check a day old.
delete from app.jobs where id in (select id from pg_temp.scan_jobs('recordings', :'rec_bad') union all select id from pg_temp.scan_jobs('homework', :'hw_fail'));
update app.upload_scans set scanned_at = now() - interval '2 days' where bucket_id = 'homework' and name = :'hw_fail';
begin; set local role connect_worker;
select app.worker_scan_sweep(1000) as sweep2 \gset
commit;
select pg_temp.assert((select count(*) from pg_temp.scan_jobs('recordings', :'rec_bad') j where j.status = 'queued' and j.payload->>'sweep' = 'new') = 1
                      and (select count(*) from pg_temp.scan_jobs('homework', :'hw_fail') j
                            where j.status = 'queued' and j.payload->>'sweep' = 'retry' and not (j.payload ? 'name')) = 1
                      and (select bool_and(center_id = :c) from pg_temp.scan_jobs('recordings', :'rec_bad') j where j.status = 'queued'),
  'the sweep queues a file nobody checked yet (the backlog) and retries a check that failed a day ago (a homework one by its object id)');
-- The worker finds the file of a homework check by the object's id alone, and the infected record of a removed one.
select (select id from storage.objects where bucket_id = 'homework' and name = :'hw_fail') as fail_oid,
       (select object_id from app.upload_scans where bucket_id = 'homework' and name = :'hw_bad') as bad_oid \gset
begin; set local role connect_worker;
select pg_temp.assert((app.worker_scan_object('homework', null, :'fail_oid'::uuid))->>'name' = :'hw_fail'
                      and (app.worker_scan_object('homework', null, :'bad_oid'::uuid))->>'name' = :'hw_bad'
                      and (app.worker_scan_object('homework', null, :'bad_oid'::uuid))->>'exists' = 'false'
                      and (app.worker_scan_object('homework', null, gen_random_uuid()))->>'name' is null,
  'a check named by the object''s id finds the file, or the record of a removed one, or nothing');
commit;

-- ── What staff see ─────────────────────────────────────────────────────────
-- Another community's result, which this community's staff must not read.
insert into app.upload_scans (bucket_id, name, center_id, object_id, status)
values ('content', '00000000-0000-4000-8000-000000000001/scan74-elsewhere.png', '00000000-0000-4000-8000-000000000001', gen_random_uuid(), 'clean');
begin;
select pg_temp.sign_in(:admin);
select app.center_storage_overview(:c)->'scan' as overview_scan \gset
select app.background_service_status(:c)->'scan' as service_scan \gset
select pg_temp.assert((select count(*) from app.upload_scans where center_id = :c) >= 6
                      and not exists (select 1 from app.upload_scans where center_id <> :c),
  'settings.manage staff read their own community''s results, and only those');
rollback;
select pg_temp.assert(:'overview_scan'::jsonb->>'mode' = 'enforce' and :'overview_scan'::jsonb->'held_buckets' = '["homework", "recordings"]'::jsonb
                      and (:'overview_scan'::jsonb->>'files')::int = 4 and (:'overview_scan'::jsonb->>'pending')::int = 1
                      and (:'overview_scan'::jsonb->>'clean')::int = 2 and (:'overview_scan'::jsonb->>'failed')::int = 1
                      and (:'overview_scan'::jsonb->>'infected')::int = 0 and (:'overview_scan'::jsonb->>'removed')::int = 3
                      and (:'overview_scan'::jsonb->>'queued')::int >= 2 and :'overview_scan'::jsonb->>'enforced_since' is not null
                      and :'service_scan'::jsonb = :'overview_scan'::jsonb,
  'Settings › Storage and Integrations count the files: waiting, clean, could not be checked, removed, queued checks, and the mode');
begin;
select pg_temp.sign_in(:member);
select pg_temp.assert(not exists (select 1 from app.upload_scans), 'a member reads no results');
rollback;
begin;
select pg_temp.sign_in(:pa);
select pg_temp.assert(exists (select 1 from app.upload_scans where center_id = :c)
                      and exists (select 1 from app.upload_scans where center_id = '00000000-0000-4000-8000-000000000001'),
  'a platform admin reads every community''s results');
rollback;
delete from app.upload_scans where name = '00000000-0000-4000-8000-000000000001/scan74-elsewhere.png';

-- ── The audit log ──────────────────────────────────────────────────────────
-- app.audit_mask carries both clauses (0589's homework file name, 0590's assistance note), so 0589 and 0590 can be applied
-- in either order and neither undoes the other.
select pg_temp.assert(app.audit_mask(jsonb_build_object('bucket_id', 'homework', 'name', :'hw_old', 'status', 'clean'))
                        = jsonb_build_object('bucket_id', 'homework', 'name', :'folder' || '***', 'status', 'clean')
                      and app.audit_mask(jsonb_build_object('bucket', 'homework', 'name', :'hw_new'))->>'name' = :'folder' || '***'
                      and app.audit_mask(jsonb_build_object('bucket_id', 'photos', 'name', :'photo'))->>'name' = :'photo'
                      and app.audit_mask(jsonb_build_object('bucket_id', 'homework', 'name', 'odd-name.jpg'))->>'name' = 'odd-name.jpg',
  'audit_mask keeps only the folder of a homework file named with its bucket (0589), and leaves other buckets and other names as they are');
select pg_temp.assert(app.audit_mask('{"assistance_note": "We need help with fees", "status": "requested"}'::jsonb)
                        = '{"assistance_note": "*** (22 characters)", "status": "requested"}'::jsonb
                      and app.audit_mask('{"assistance_note": null}'::jsonb) = '{"assistance_note": null}'::jsonb
                      and app.audit_mask(jsonb_build_object('text_answer', 'Namo', 'storage_path', :'hw_old'))
                          = jsonb_build_object('text_answer', '*** (4 characters)', 'storage_path', :'folder' || '***'),
  'and it keeps 0590''s assistance-note clause and 0587''s homework clauses');
select pg_temp.assert(app.audit_mask(jsonb_build_object('bucket_id', 'homework', 'name', :'hw_old', 'assistance_note', 'Need help', 'status', 'clean'))
                        = jsonb_build_object('bucket_id', 'homework', 'name', :'folder' || '***', 'assistance_note', '*** (9 characters)', 'status', 'clean'),
  'one row can need both clauses (a homework file name and an assistance note): both are applied');
select pg_temp.assert((select count(*) from app.audit_log where action = 'storage.upload' and record_id = 'homework/' || :'folder' || '***'
                         and after->>'name' = :'folder' || '***' and after->>'mimetype' = 'image/jpeg') >= 2
                      and not exists (select 1 from app.audit_log where record_table = 'storage.objects' and record_id like 'homework/%'
                                       and (record_id || coalesce(before::text, '') || coalesce(after::text, '')) ~ '0000000000f[0-9]\.(jpg|m4a)'),
  'homework uploads are audited now (0587 left the bucket out), by their folder only: never a file name');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'upload_scans' and record_id like 'homework:%') >= 4
                      and not exists (select 1 from app.audit_log where record_table = 'upload_scans'
                                       and (record_id || coalesce(before::text, '') || coalesce(after::text, '')) ~ '0000000000f[0-9]\.(jpg|m4a)')
                      and exists (select 1 from app.audit_log where record_table = 'upload_scans' and after->>'name' = :'folder' || '***'),
  'the results are audited by bucket and object id, and a homework file''s name is masked there too');

-- ── Back to off: nothing is denied ─────────────────────────────────────────
begin;
select pg_temp.sign_in_step_up(:pa);
select app.set_platform_setting('UPLOAD_SCAN_MODE', 'off', 'Scanner moved to a new droplet');
commit;
begin;
select pg_temp.sign_in(:teacher);
select pg_temp.assert(pg_temp.sees('homework', :'hw_fail') and pg_temp.sees('recordings', :'rec_bad'),
  'switched off again, the teacher opens what was held (nothing is ever denied while scanning is off)');
rollback;
select pg_temp.assert(app.upload_scan_enforced_since() is null and not app.upload_scan_held('recordings', :'rec_bad'),
  'and nothing is held');

-- Off to monitor again (the scanner is back): a new moment and one fresh sweep, nothing enforced or held, and the checks that
-- waited in the queue while it was off are still there (switching the mode never touches them).
select set_at as off_at from app.platform_settings where key = 'UPLOAD_SCAN_MODE' \gset
select count(*) as waiting_checks from app.jobs where kind = 'storage.scan' and status = 'queued' and center_id = :c \gset
delete from app.jobs where kind = 'storage.scan_sweep' and center_id is null and status = 'queued';
begin;
select pg_temp.sign_in_step_up(:pa);
select app.set_platform_setting('UPLOAD_SCAN_MODE', 'monitor', 'The scanner is back');
commit;
select pg_temp.assert(app.upload_scan_mode() = 'monitor' and app.upload_scan_enforced_since() is null
                      and (select set_at > :'off_at'::timestamptz from app.platform_settings where key = 'UPLOAD_SCAN_MODE')
                      and (select count(*) from app.jobs where kind = 'storage.scan_sweep' and center_id is null and status = 'queued') = 1
                      and (select count(*) from app.jobs where kind = 'storage.scan' and status = 'queued' and center_id = :c) = :'waiting_checks'::int
                      and :'waiting_checks'::int > 0
                      and not app.upload_scan_held('recordings', :'rec_bad'),
  'off to monitor again: a fresh moment and one new sweep, nothing enforced or held, and the waiting checks are untouched');

-- ── Tidy up (the database is shared with the next test files) ───────────────
delete from app.platform_settings where key = 'UPLOAD_SCAN_MODE';
delete from storage.objects where name like :c || '/%';
delete from app.upload_scans where center_id = :c;
delete from app.jobs where kind = 'storage.scan_sweep' and center_id is null and status = 'queued';
delete from app.jobs where kind = 'storage.scan' and (center_id = :c or payload->>'name' like :c || '/%');
