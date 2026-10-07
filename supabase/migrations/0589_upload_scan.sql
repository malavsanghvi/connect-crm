-- 0589_upload_scan.sql: virus scanning of uploaded files, built complete and SWITCHED OFF.
--
-- Owner decisions, 2026-10-06: scanner hosting "Not now": build it switched off and turn it on later (the droplet is
-- resized first, then deploy/clamav-setup.sh installs ClamAV; docs/DEPLOY.md › Malware scanning); the owner creates the
-- dedicated worker Supabase key; an infected file is deleted and the family and the office are told (never the file's
-- name); files uploaded before scanning starts are scanned once, in the background.
--
-- Nothing changes until a platform admin sets the mode. The default is OFF:
--   Platform › Setup › Background service › "Virus scanning of uploads" = the platform setting UPLOAD_SCAN_MODE
--   off      (the default, and what no setting means) uploads keep queueing storage.scan jobs exactly as since 0172; the
--            background service does not claim them (worker/src/handlers/storage.scan.ts is not configured), so they
--            wait; nothing is recorded, held back or removed; every read rule is what it was
--   monitor  every upload is checked and the result recorded in app.upload_scans; NOTHING is denied and nothing is
--            removed: an infected file is kept and written to the audit log (storage.scan_infected, "kept"), so the
--            owner can see what the scanner finds before anything is enforced
--   enforce  the read gate below, and an infected file is removed and the people concerned are told
-- Switching to monitor or enforce queues a sweep at once (storage.scan_sweep), which queues a check for every file that
-- has no result and no waiting job: the backlog is scanned once.
--
-- What it adds:
--   app.upload_scans               one row per checked file (bucket_id, name): clean | infected | failed, the engine
--                                  and the signature; no row = pending. A new version of the file (or a new file at
--                                  that name) clears the row, so it is checked again. Read by staff with
--                                  settings.manage and platform admins; nobody writes it over the API.
--   app.upload_scan_state(b, n)    'clean' | 'infected' | 'failed' | 'pending' | 'exempt' (a bucket that is not scanned:
--                                  statements and exports, which only the server writes)
--   app.upload_scan_gated_buckets()   the buckets whose files can be held back until they are checked, in rollout order:
--                                  homework, recordings, photos, org-documents, content, store. THIS RELEASE ENFORCES
--                                  ONLY homework AND recordings (app.upload_scan_enforced_buckets): for the other four
--                                  nobody has decided yet who may open a file before its check (a later change).
--   app.can_read_object            (0587's rules, all kept) + in ENFORCE mode only: a file found infected is refused to
--                                  everyone, in every scanned bucket, whenever it was uploaded; a homework file or a
--                                  recording uploaded after enforcement began is opened by the uploader and their
--                                  family at once (homework: app.gyan_can_act_for; recordings: app.can_act_for_person)
--                                  and by the teachers and reviewers only once it is clean. Uploads are never blocked.
--                                  Signed URLs are made through the same read rule, so the portal and the member app
--                                  follow it. In off and monitor modes nothing is denied (one settings lookup a read).
--   app.worker_scan_object, app.worker_record_scan, app.worker_scan_removed, app.worker_scan_sweep
--                                  the background service's side (connect_worker only)
--   storage.scan jobs              now 25 attempts (was 5): a scanner outage is retried for about 18 hours; the last
--                                  attempt records "failed". The sweep (every 6 hours) queues files with no result and
--                                  no live job, the infected files still stored once enforce is on, and failed checks a
--                                  day old.
--   On an infected file (enforce): the result is recorded first (reads blocked at once), the worker deletes the file
--                                  through the Storage API (like retention), then app.worker_scan_removed tidies up:
--                                  homework: the part is marked deleted (storage_path null, deleted_at,
--                                  removed_reason 'infected'); recordings: gyan_progress.recording_path is cleared;
--                                  photos: status 'removed'. It tells the learner (and, for a child, the household
--                                  adults: 0587's rule), or the uploader (photos and the other buckets), with the new
--                                  template upload.removed (push + email, never the file name); the office gets an
--                                  audit entry (storage.scan_infected) and, when the homework answer was already with
--                                  the reviewers, a push (type homework_review).
--   app.gyan_submission_json       each part also carries scan (the state above; 'infected' for a part removed by the
--                                  check, null for one removed by retention) and scan_held (enforce mode: held back from
--                                  the reviewers until it is clean)
--   Settings › Storage, Settings › Integrations   real counts: app.center_storage_overview and
--                                  app.background_service_status gain a "scan" summary
--   app.storage_audit              audits every Connect bucket (app.connect_storage_buckets), homework included (0587
--                                  left it out); a homework file's name is kept as its folder only, like 0587's entries
--   app.audit_mask                 also masks a homework file name in a row that names a bucket (upload_scans), and
--                                  carries 0590's assistance_note clause verbatim, so 0589 and 0590 merge in either order
--
-- ACCESS CHANGES (for the owner's sign-off, all dormant until the mode is enforce): the read gate above; a new table
-- readable by settings.manage staff and platform admins; four functions only the background service may call.
--
-- Applied migrations are never edited: every function below is redefined in full from its latest definition
-- (platform_setting_keys 0585, set_platform_setting 0320, storage_enqueue_scan 0172, storage_audit 0174,
-- background_service_status 0171, can_read_object / center_storage_overview / gyan_submission_json / audit_mask 0587).

set client_min_messages = warning;

-- ── Lock waits ───────────────────────────────────────────────────────────────
-- A deploy applies this file as ONE transaction (migrate.sh --single-transaction). It adds a trigger to storage.objects
-- (every upload writes there) and a column to app.gyan_submission_files: wait at most 10 seconds for any lock, so a busy
-- moment fails the deploy cleanly (run it again) instead of holding uploads behind it. No LOCK TABLE on storage.objects:
-- the hosted postgres role may create triggers there without holding UPDATE on it. In a DO block like 0587's, so it
-- lasts for the whole transaction.
do $$
begin
  set local lock_timeout = '10s';
end $$;

-- ── The mode: a platform setting ─────────────────────────────────────────────
-- 0585's settings list plus UPLOAD_SCAN_MODE (src/lib/platform-setup/catalog.ts holds the same list; tests/platform-setup.test.ts
-- keeps them in step). Anyone who changes this list again must start from THIS definition (0589).
create or replace function app.platform_setting_keys() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array[
    'portal_domain','wildcard_domain',
    'MESSAGING_EMAIL_PROVIDER','MESSAGING_FROM_ADDRESS','MESSAGING_FROM_NAME',
    'STRIPE_CLIENT_ID','PAYPAL_CLIENT_ID','PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_PARTNER_ID','PAYPAL_BN_CODE',
    'PAYPAL_WEBHOOK_ID','PAYPAL_SANDBOX_WEBHOOK_ID',
    'TWILIO_ACCOUNT_SID','TWILIO_FROM_NUMBER','TWILIO_MESSAGING_SERVICE_SID',
    'INTUIT_CLIENT_ID','INTUIT_SANDBOX_CLIENT_ID','INTUIT_REDIRECT_URI','GEMINI_IMAGE_MODEL','UPLOAD_SCAN_MODE']
$$;

-- 0320's body with UPLOAD_SCAN_MODE: off | monitor | enforce (lower case). Its row's set_at is when the mode last CHANGED
-- (saving the same mode again changes nothing), so app.upload_scan_enforced_since() is the moment enforcement began.
-- Switching to monitor or enforce queues a sweep straight away (the backlog is checked once, without waiting six hours).
create or replace function app.set_platform_setting(p_key text, p_value text, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_key text := btrim(coalesce(p_key, '')); v text := btrim(coalesce(p_value, '')); v_was text;
begin
  perform app.assert_platform_admin('change platform settings');
  if not (v_key = any (app.platform_setting_keys())) then
    raise exception '"%" is not a platform setting the setup wizard stores.', p_key;
  end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Say why the setting is being changed.'; end if;
  if v = '' then raise exception 'Enter a value.'; end if;
  if char_length(v) > 500 or v ~ '[[:cntrl:]]' then raise exception 'That value is too long or has line breaks.'; end if;
  if v_key in ('portal_domain','wildcard_domain') then
    -- A bare lower-case host: no scheme, path, port or trailing dot (o-https reads it as is).
    v := lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(v, '^https?://', '', 'i'), '/.*$', ''), ':[0-9]+$', ''), '\.$', ''));
    if v_key = 'wildcard_domain' then v := regexp_replace(v, '^\*\.', ''); end if;
    if not app.platform_domain_ok(v) then
      raise exception 'Enter a domain name only, for example crm.communityconnect.app (no https://, no path).';
    end if;
  elsif v_key = 'MESSAGING_EMAIL_PROVIDER' then
    v := lower(v);
    if v not in ('resend','postmark') then raise exception 'Choose Resend or Postmark.'; end if;
  elsif v_key = 'MESSAGING_FROM_ADDRESS' then
    if v !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then raise exception 'Enter an email address, for example no-reply@mail.communityconnect.app.'; end if;
  elsif v_key = 'TWILIO_FROM_NUMBER' then
    if v !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Enter the number in international format, for example +18325550100.'; end if;
  elsif v_key = 'INTUIT_REDIRECT_URI' then
    if v !~ '^https://[^\s/]+/api/oauth/intuit/callback$' and v !~ '^http://localhost(:[0-9]+)?/api/oauth/intuit/callback$' then
      raise exception 'The redirect address must be https://<portal>/api/oauth/intuit/callback.';
    end if;
  elsif v_key = 'UPLOAD_SCAN_MODE' then
    v := lower(v);
    if v not in ('off','monitor','enforce') then
      raise exception 'Choose off, monitor (check every upload and record the result, nothing is blocked) or enforce.';
    end if;
  end if;
  perform app.assert_platform_step_up('platform_setting.set');
  perform app.set_audit_context(p_reason);
  if v_key = 'UPLOAD_SCAN_MODE' then
    select s.value #>> '{}' into v_was from app.platform_settings s where s.key = v_key for update;
    if v_was is not distinct from v then return jsonb_build_object('key', v_key, 'value', v); end if;
  end if;
  insert into app.platform_settings (key, value, set_by, set_at) values (v_key, to_jsonb(v), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, set_by = excluded.set_by, set_at = excluded.set_at;
  if v_key = 'UPLOAD_SCAN_MODE' and v <> 'off' then
    perform app.enqueue_job(null, 'storage.scan_sweep', jsonb_build_object('reason', 'virus scanning switched to ' || v), now(), 3);
  end if;
  return jsonb_build_object('key', v_key, 'value', v);
end $$;

-- The mode as the read rules and the worker see it ('off' when nothing, or nothing valid, is saved). Every storage read
-- asks it, so it never fails: without the settings table (a database without 0320) scanning is simply off.
create or replace function app.upload_scan_mode() returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v text;
begin
  if to_regclass('app.platform_settings') is null then return 'off'; end if;
  select lower(s.value #>> '{}') into v from app.platform_settings s where s.key = 'UPLOAD_SCAN_MODE';
  return case when v in ('off', 'monitor', 'enforce') then v else 'off' end;
end $$;

-- When enforcement began (null unless the mode is enforce): the gate holds back only files uploaded from then on.
create or replace function app.upload_scan_enforced_since() returns timestamptz
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v timestamptz;
begin
  if to_regclass('app.platform_settings') is null then return null; end if;
  select s.set_at into v from app.platform_settings s where s.key = 'UPLOAD_SCAN_MODE' and lower(s.value #>> '{}') = 'enforce';
  return v;
end $$;

-- ── The buckets ──────────────────────────────────────────────────────────────
-- Community Connect's ten buckets (the storage.objects policies of 0587 name the same ten). app.storage_audit reads this
-- list instead of 0174's hard-coded nine, which left the homework bucket out.
create or replace function app.connect_storage_buckets() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['branding','content','photos','store','statements','recordings','homework','imports','org-documents','exports']
$$;

-- The buckets whose files the read gate can hold back until they are checked, in the order they are to be switched on.
-- All six are named here; app.upload_scan_enforced_buckets says which ones this release enforces.
create or replace function app.upload_scan_gated_buckets() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['homework','recordings','photos','org-documents','content','store']
$$;

-- Enforced in THIS release: homework and recordings, whose uploader and family are known from the path
-- (<center>/<person>/...). Photos, organization documents, content and the store come later, each once it is decided who
-- may open a file of theirs before its check.
create or replace function app.upload_scan_enforced_buckets() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array(select b from unnest(app.upload_scan_gated_buckets()) b where b in ('homework', 'recordings'))
$$;

-- ── The results ──────────────────────────────────────────────────────────────
create table if not exists app.upload_scans (
  bucket_id      text not null check (char_length(bucket_id) between 1 and 63),
  name           text not null check (char_length(name) between 1 and 1024),
  center_id      uuid references app.centers(id) on delete cascade,
  object_id      uuid not null,
  object_version text,
  status         text not null check (status in ('clean', 'infected', 'failed')),
  engine         text check (engine is null or char_length(engine) <= 200),
  signature      text check (signature is null or char_length(signature) <= 200),
  bytes          bigint check (bytes is null or bytes >= 0),
  uploaded_by    uuid,
  scanned_at     timestamptz not null default now(),
  job_id         bigint,
  detail         text check (detail is null or char_length(detail) <= 500),
  removed_at     timestamptz,
  primary key (bucket_id, name),
  check (removed_at is null or status = 'infected')
);
create index if not exists upload_scans_center_idx on app.upload_scans (center_id, status);
comment on table app.upload_scans is
  'Virus check results (0589), one per stored file (bucket_id, name) and file version: clean | infected | failed; no row = pending. Written only by the background service (app.worker_record_scan). A new version of the file, a new file at that name or the file''s removal clears the row, except an infected one, which stays as the record of what was removed (removed_at) until a new file takes the name. engine: the scanner and its signature database (ClamAV x/y/date); signature: what it found (infected) or the limit it hit (failed); uploaded_by: the file''s owner when it was checked; detail: a plain sentence. Read by settings.manage staff and platform admins.';
comment on column app.upload_scans.removed_at is 'Enforce mode: when the infected file was deleted and the people concerned were told (app.worker_scan_removed).';

insert into app.module_tables (table_name, module_key) values ('upload_scans', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- Audited like every app table. The record id is the bucket and the object's uuid (never the name: a homework file's
-- name stays out of record ids, as 0587 keeps it), and app.audit_mask keeps only a homework file's folder.
drop trigger if exists audit_upload_scans on app.upload_scans;
create trigger audit_upload_scans after insert or update or delete on app.upload_scans
  for each row execute function app.audit_row('bucket_id', 'object_id');

alter table app.upload_scans enable row level security;
drop policy if exists upload_scans_staff_read on app.upload_scans;
create policy upload_scans_staff_read on app.upload_scans for select to authenticated
  using ((center_id is not null and app.has_permission(center_id, 'settings.manage')) or app.is_platform_admin());
revoke all on app.upload_scans from public, anon, authenticated, service_role, connect_worker;
grant select on app.upload_scans to authenticated;
grant all on app.upload_scans to service_role;

-- A homework part removed by the check says so (the portal and the app show "removed by the virus check", not
-- "removed after the retention period"). Null: removed by retention, or not removed.
alter table app.gyan_submission_files add column if not exists removed_reason text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gyan_submission_files_removed_reason_check') then
    alter table app.gyan_submission_files add constraint gyan_submission_files_removed_reason_check
      check (removed_reason is null or removed_reason in ('retention', 'infected'));
  end if;
end $$;
comment on column app.gyan_submission_files.removed_reason is 'Why the file is gone (0589): infected (removed by the virus check), retention, or null (removed by retention before 0589, or not removed).';

-- ── State ────────────────────────────────────────────────────────────────────
-- One lock per file name, taken by the worker's recording and by every change to the file (the triggers below), so a
-- result recorded while the file is being replaced or removed can never stick to the wrong version.
create or replace function app.upload_scan_lock(p_bucket text, p_name text) returns void
language plpgsql volatile set search_path = app, public, extensions as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('app.upload_scans:' || coalesce(p_bucket, '') || '/' || coalesce(p_name, ''), 0));
end $$;

-- 'exempt' (a bucket that is not scanned), the result of the file's CURRENT version, or 'pending'. An infected result
-- stays after the file is removed.
create or replace function app.upload_scan_state(p_bucket text, p_name text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_status text;
begin
  if p_bucket is null or p_name is null then return null; end if;
  if not (p_bucket = any (app.storage_scan_buckets())) then return 'exempt'; end if;
  select s.status into v_status
    from app.upload_scans s
   where s.bucket_id = p_bucket and s.name = p_name
     and (s.status = 'infected'
          or not exists (select 1 from storage.objects o
                          where o.bucket_id = p_bucket and o.name = p_name and o.version is distinct from s.object_version));
  return coalesce(v_status, 'pending');
end $$;

-- Enforce mode: is this file held back from everyone but its uploader's family until it is clean? A file of an enforced
-- bucket, uploaded (or replaced) after enforcement began, whose check is pending or failed.
create or replace function app.upload_scan_held(p_bucket text, p_name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_since timestamptz; v_at timestamptz;
begin
  if p_bucket is null or p_name is null or not (p_bucket = any (app.upload_scan_enforced_buckets())) then return false; end if;
  if app.upload_scan_mode() <> 'enforce' then return false; end if;
  v_since := app.upload_scan_enforced_since();
  select greatest(o.created_at, coalesce(o.updated_at, o.created_at)) into v_at
    from storage.objects o where o.bucket_id = p_bucket and o.name = p_name;
  if v_since is null or v_at is null or v_at < v_since then return false; end if;
  return app.upload_scan_state(p_bucket, p_name) in ('pending', 'failed');
end $$;

-- ── Uploads: every upload still queues a check; a changed file loses its result ──
-- 0172's body with 25 attempts (was 5): a scanner that is down is retried for about 18 hours (fail_job backs off up to
-- an hour), and the last attempt records "failed". Nothing claims these jobs while scanning is off.
create or replace function app.storage_enqueue_scan() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.bucket_id = any (app.storage_scan_buckets())
     and not exists (select 1 from app.jobs where kind = 'storage.scan' and status in ('queued','running')
                       and payload->>'bucket' = new.bucket_id and payload->>'name' = new.name) then
    perform app.enqueue_job(app.storage_center(new.name), 'storage.scan',
      jsonb_build_object('bucket', new.bucket_id, 'name', new.name, 'object_id', new.id,
                         'size', new.metadata->'size', 'mimetype', new.metadata->>'mimetype'),
      now(), 25);
  end if;
  return new;
end $$;

-- A new file at a name, a new version, a move or a removal: the result follows the file. A moved file keeps its result
-- (the same bytes); a new version or a new file is checked again; a removed file's result goes with it, except an
-- infected one (the record of what was removed).
create or replace function app.upload_scans_follow_object() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid;
begin
  if tg_op = 'DELETE' then
    if old.bucket_id = any (app.storage_scan_buckets()) then
      perform app.upload_scan_lock(old.bucket_id, old.name);
      delete from app.upload_scans where bucket_id = old.bucket_id and name = old.name and status <> 'infected';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.version is not distinct from new.version and old.name is not distinct from new.name
       and old.bucket_id is not distinct from new.bucket_id then
      return new;   -- metadata-only touches (last_accessed_at and the like) leave the file as it was
    end if;
    if old.name is distinct from new.name or old.bucket_id is distinct from new.bucket_id then
      perform app.upload_scan_lock(old.bucket_id, old.name);
      perform app.upload_scan_lock(new.bucket_id, new.name);
      delete from app.upload_scans where bucket_id = new.bucket_id and name = new.name;
      if old.version is not distinct from new.version and new.bucket_id = any (app.storage_scan_buckets()) then
        select c.id into v_center from app.centers c where c.id = app.storage_center(new.name);
        update app.upload_scans set bucket_id = new.bucket_id, name = new.name, center_id = v_center
         where bucket_id = old.bucket_id and name = old.name and status <> 'infected';
      end if;
      delete from app.upload_scans where bucket_id = old.bucket_id and name = old.name and status <> 'infected';
      return new;
    end if;
  end if;
  if new.bucket_id = any (app.storage_scan_buckets()) then
    perform app.upload_scan_lock(new.bucket_id, new.name);
    delete from app.upload_scans where bucket_id = new.bucket_id and name = new.name;
  end if;
  return new;
end $$;
revoke execute on function app.upload_scans_follow_object() from public, anon, authenticated;
drop trigger if exists connect_scan_result_follows on storage.objects;
create trigger connect_scan_result_follows after insert or update or delete on storage.objects
  for each row execute function app.upload_scans_follow_object();

-- ── Reading objects: the gate ────────────────────────────────────────────────
-- 0587's body, every rule kept, then the virus check (enforce mode only): an infected file is refused to everyone; a held
-- file (app.upload_scan_held: homework or a recording uploaded after enforcement began, check pending or failed) is opened
-- only by the uploader's family: homework the learner and the household adults (app.gyan_can_act_for), a recording the
-- person and those who may act for them (app.can_act_for_person). The teachers and reviewers open it once it is clean.
create or replace function app.can_read_object(bucket text, name text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
-- $1/$2: the contract names the arguments bucket and name, which read badly next to columns.
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2); v_ok boolean;
begin
  if b = 'branding' then return c is not null; end if;
  if c is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) in ('events', 'flyer-art')
               then app.module_enabled(c, 'events') or app.is_platform_admin()
               else app.storage_module_on(b, c) end) then return false; end if;
  v_ok := case b
    when 'content'       then app.is_member_of(c) or app.event_flyer_is_public(n)
    when 'photos'        then app.has_permission(c, 'content.manage')
                              or (app.is_member_of(c) and (
                                    (auth.uid() is not null and app.storage_segment(n, 3) like auth.uid()::text || '-%')
                                    or exists (select 1 from app.photos p
                                                where p.center_id = c and p.status = 'approved'
                                                  and p.storage_path in (n, 'photos/' || n))))
    when 'store'         then app.is_member_of(c)
    when 'statements'    then app.has_permission(c, 'giving.view')
                              or (s2 is not null and app.adult_of_household(c, s2))
    when 'recordings'    then s2 is not null and (app.can_act_for_person(c, s2) or app.teaches_person(c, s2))
    when 'homework'      then s2 is not null and auth.uid() is not null and app.storage_segment_uuid(n, 3) is not null
                              and exists (select 1 from app.gyan_submissions s
                                           where s.id = app.storage_segment_uuid(n, 3) and s.center_id = c and s.person_id = s2)
                              and app.gyan_submission_readable(app.storage_segment_uuid(n, 3))
                              and (app.gyan_can_act_for(c, s2)
                                   or exists (select 1 from app.gyan_submission_files f
                                               where f.submission_id = app.storage_segment_uuid(n, 3) and f.storage_path = n and f.deleted_at is null))
    when 'imports'       then app.has_permission(c, 'people.manage') or app.has_permission(c, 'giving.manage')
                              or app.has_permission(c, 'accounting.manage') or app.has_permission(c, 'settings.manage')
    when 'org-documents' then app.is_center_owner(c) or app.is_platform_admin()
    when 'exports'       then auth.uid() is not null and s2 = auth.uid()
    else false
  end;
  if v_ok is not true then return false; end if;
  -- 0589: the virus check. Off and monitor deny nothing (this is the one lookup they cost).
  if app.upload_scan_mode() <> 'enforce' or not (b = any (app.storage_scan_buckets())) then return true; end if;
  if app.upload_scan_state(b, n) = 'infected' then return false; end if;
  if app.upload_scan_held(b, n) then
    return case b when 'homework'   then app.gyan_can_act_for(c, s2)
                  when 'recordings' then app.can_act_for_person(c, s2)
                  else false end;
  end if;
  return true;
end $$;

-- ── The worker's side ────────────────────────────────────────────────────────
-- What the scanner needs to know about one file before it fetches it: the mode, whether the bucket is scanned, the
-- object's id, version and size, and the result already recorded (current = for this very version).
create or replace function app.worker_scan_object(p_bucket text, p_name text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_id uuid; v_version text; v_meta jsonb; v_created timestamptz; s app.upload_scans; v_found boolean;
begin
  perform app.assert_worker();
  select o.id, o.version, o.metadata, o.created_at into v_id, v_version, v_meta, v_created
    from storage.objects o where o.bucket_id = p_bucket and o.name = p_name;
  v_found := found;
  select * into s from app.upload_scans where bucket_id = p_bucket and name = p_name;
  return jsonb_build_object(
    'mode', app.upload_scan_mode(),
    'scanned_bucket', coalesce(p_bucket = any (app.storage_scan_buckets()), false),
    'exists', v_found,
    'object_id', v_id,
    'version', v_version,
    'size', case when v_meta->>'size' ~ '^[0-9]{1,15}$' then (v_meta->>'size')::bigint end,
    'mimetype', v_meta->>'mimetype',
    'created_at', v_created,
    'result', case when s.bucket_id is null then null else jsonb_build_object(
                'status', s.status, 'removed_at', s.removed_at, 'scanned_at', s.scanned_at,
                'current', v_found and s.object_id = v_id and s.object_version is not distinct from v_version) end);
end $$;

-- Record one result for one version of a file. Refused for a bucket that is not scanned or a status that is not one of
-- the three. Not recorded (and said so) while scanning is off, or when the file is gone or has changed since it was
-- fetched (the worker then checks it again). A failed check never overwrites a clean or infected result of the same
-- version. Returns {recorded, reason?, status, action, mode}: action 'remove' (enforce: delete the infected file, then
-- call app.worker_scan_removed), 'keep' (monitor: an infected file is only written to the audit log) or 'none'.
create or replace function app.worker_record_scan(p_bucket text, p_name text, p_object_id uuid, p_version text, p_status text,
                                                  p_engine text, p_signature text, p_bytes bigint, p_job bigint, p_detail text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_mode text; v_id uuid; v_version text; v_owner text; v_center uuid; v_prev app.upload_scans; v_action text := 'none';
        v_sig text := nullif(left(regexp_replace(btrim(coalesce(p_signature, '')), '[^[:print:]]', '', 'g'), 200), '');
        v_engine text := nullif(left(regexp_replace(btrim(coalesce(p_engine, '')), '[^[:print:]]', '', 'g'), 200), '');
        v_detail text := nullif(left(regexp_replace(btrim(coalesce(p_detail, '')), '[[:cntrl:]]', ' ', 'g'), 500), '');
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if p_status is null or p_status not in ('clean', 'infected', 'failed') then
    raise exception 'A virus check result is clean, infected or failed (got "%").', p_status using errcode = '22023';
  end if;
  if p_bucket is null or p_name is null or not (p_bucket = any (app.storage_scan_buckets())) then
    raise exception 'Files in "%" are not checked for viruses.', coalesce(p_bucket, '?') using errcode = '22023';
  end if;
  v_mode := app.upload_scan_mode();
  if v_mode = 'off' then return jsonb_build_object('recorded', false, 'reason', 'off', 'mode', v_mode); end if;
  perform app.upload_scan_lock(p_bucket, p_name);
  select o.id, o.version, coalesce(o.owner_id, o.owner::text) into v_id, v_version, v_owner
    from storage.objects o where o.bucket_id = p_bucket and o.name = p_name;
  if not found then return jsonb_build_object('recorded', false, 'reason', 'gone', 'mode', v_mode); end if;
  if v_id is distinct from p_object_id or v_version is distinct from p_version then
    return jsonb_build_object('recorded', false, 'reason', 'changed', 'mode', v_mode);
  end if;
  select * into v_prev from app.upload_scans where bucket_id = p_bucket and name = p_name;
  if p_status = 'failed' and v_prev.status in ('clean', 'infected')
     and v_prev.object_id = v_id and v_prev.object_version is not distinct from v_version then
    return jsonb_build_object('recorded', false, 'reason', 'already', 'status', v_prev.status, 'mode', v_mode);
  end if;
  select c.id into v_center from app.centers c where c.id = app.storage_center(p_name);
  insert into app.upload_scans (bucket_id, name, center_id, object_id, object_version, status, engine, signature, bytes,
                                uploaded_by, scanned_at, job_id, detail, removed_at)
  values (p_bucket, p_name, v_center, v_id, v_version, p_status, v_engine, v_sig, case when p_bytes >= 0 then p_bytes end,
          case when v_owner ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_owner::uuid end,
          now(), p_job, v_detail, null)
  on conflict (bucket_id, name) do update
    set center_id = excluded.center_id, object_id = excluded.object_id, object_version = excluded.object_version,
        status = excluded.status, engine = excluded.engine, signature = excluded.signature, bytes = excluded.bytes,
        uploaded_by = excluded.uploaded_by, scanned_at = excluded.scanned_at, job_id = excluded.job_id,
        detail = excluded.detail, removed_at = null;
  if p_status = 'infected' then
    if v_mode = 'enforce' then
      v_action := 'remove';
    else
      v_action := 'keep';
      if v_prev.status is distinct from 'infected' or v_prev.object_id is distinct from v_id
         or v_prev.object_version is distinct from v_version then
        perform app.log_audit(v_center, 'storage.scan_infected', 'storage.objects', p_bucket || '/' || app.storage_name_for_audit(p_bucket, p_name), null,
          jsonb_build_object('bucket', p_bucket, 'name', app.storage_name_for_audit(p_bucket, p_name), 'signature', v_sig,
                             'engine', v_engine, 'bytes', p_bytes, 'mode', v_mode, 'removed', false),
          'Virus check (monitor mode): ' || coalesce(v_sig, 'a threat') || ' found; the file was kept and nothing was blocked (job '
            || coalesce(p_job::text, '?') || ')');
      end if;
    end if;
  end if;
  return jsonb_build_object('recorded', true, 'status', p_status, 'action', v_action, 'mode', v_mode);
end $$;

-- How an audit entry names a file: a homework file keeps its folder only (<center>/<person>/<submission>/***), as every
-- homework entry since 0587 does.
create or replace function app.storage_name_for_audit(p_bucket text, p_name text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when p_bucket = 'homework' then regexp_replace(coalesce(p_name, ''), '[^/]+$', '***') else p_name end
$$;

-- ── Telling people (never raising: 0587's notifier helpers) ─────────────────
-- The template: what was removed and what to do next; never the file's name. Push and email, platform defaults a
-- community may override.
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('upload.removed', 'push', 'A file was removed',
   '{{what}} was removed: the virus check found a problem with it. {{next}}'),
  ('upload.removed', 'email', 'A file was removed at {{center_short_name}}',
   E'{{what}} at {{center_short_name}} was removed because the virus check found a problem with it. {{next}}\n\nThe file itself is gone; everything else stays as it was. If you have a question, ask the office.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- The uploader (a login): push to every login of their person in this community and an email, or a push to the login
-- alone when it has no person there (a platform admin). Returns how many messages were queued.
create or replace function app._upload_scan_tell_user(p_center uuid, p_user uuid, p_vars jsonb) returns int
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_person uuid;
begin
  if p_center is null or p_user is null then return 0; end if;
  select cu.person_id into v_person from app.center_users cu
   where cu.center_id = p_center and cu.user_id = p_user and cu.person_id is not null limit 1;
  if v_person is not null then
    return app._gyan_homework_notify_person(p_center, 'upload.removed', v_person, p_vars, '{}'::jsonb, true);
  end if;
  return case when app._gyan_homework_send(p_center, 'upload.removed', 'push', p_user::text, p_vars, '{}'::jsonb) is null then 0 else 1 end;
end $$;

-- The reviewers of a homework answer that was already with them (push only, type homework_review, no deep link, as
-- 0587's _gyan_homework_notify_reviewers), except anyone from the learner's own household.
create or replace function app._upload_scan_tell_reviewers(p_center uuid, p_assignment uuid, p_person uuid, p_submission uuid, p_extra jsonb)
returns int language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.gyan_assignments; v jsonb; v_route jsonb; n int := 0; u uuid; v_person uuid;
begin
  select * into a from app.gyan_assignments where id = p_assignment;
  if not found then return 0; end if;
  v := (app._gyan_homework_vars(p_assignment, p_person, 'homework_review', p_submission) - 'deep_link') || coalesce(p_extra, '{}'::jsonb);
  v_route := app._gyan_homework_route(v);
  foreach u in array app._gyan_homework_reviewer_users(p_center, p_person, a.class_id, a.reviewer) loop
    v_person := null;
    select cu.person_id into v_person from app.center_users cu where cu.center_id = p_center and cu.user_id = u;
    if v_person is not null and (v_person = p_person
         or exists (select 1 from app.household_members h1
                      join app.household_members h2 on h2.household_id = h1.household_id and h2.left_at is null
                     where h1.person_id = v_person and h1.left_at is null and h2.person_id = p_person)) then
      continue;
    end if;
    if app._gyan_homework_send(p_center, 'upload.removed', 'push', u::text,
                               v || case when v_person is null then '{}'::jsonb else jsonb_build_object('person_id', v_person::text) end,
                               v_route) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- After the worker deleted an infected file through the Storage API: tidy up what pointed at it, tell the people
-- concerned and the office, once (removed_at). Refused (said so, nothing done) when the result is not infected or the
-- file is still there. Returns {done, already?, parts, told, reviewers}.
create or replace function app.worker_scan_removed(p_bucket text, p_name text, p_job bigint) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare s app.upload_scans; v_center uuid; v_person uuid; v_sub app.gyan_submissions; v_title text; v_learner text; v_what text; v_next text;
        v_parts int := 0; v_told int := 0; v_reviewers int := 0; v_uploader uuid; v_album_id uuid; v_album text; v_who text; r record;
        v_job text := coalesce(p_job::text, '?');
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  perform app.upload_scan_lock(p_bucket, p_name);
  select * into s from app.upload_scans where bucket_id = p_bucket and name = p_name for update;
  if not found or s.status <> 'infected' then
    return jsonb_build_object('done', false, 'reason', 'no infected result for this file');
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_name) then
    return jsonb_build_object('done', false, 'reason', 'the file is still stored');
  end if;
  if s.removed_at is not null then return jsonb_build_object('done', true, 'already', true); end if;
  update app.upload_scans set removed_at = now(),
         detail = left('Removed by the virus check (job ' || v_job || ').' || coalesce(' ' || s.detail, ''), 500)
   where bucket_id = p_bucket and name = p_name;
  v_center := s.center_id;
  v_person := app.storage_segment_uuid(p_name, 2);

  -- What pointed at the file.
  if p_bucket = 'homework' then
    perform set_config('app.audit_reason', 'Virus check: an infected homework file was removed (job ' || v_job || ')', true);
    update app.gyan_submission_files set storage_path = null, deleted_at = now(), removed_reason = 'infected'
     where storage_path in (p_name, 'homework/' || p_name) and deleted_at is null;
    get diagnostics v_parts = row_count;
    perform set_config('app.audit_reason', '', true);
  elsif p_bucket = 'recordings' then
    perform set_config('app.audit_reason', 'Virus check: an infected recording was removed (job ' || v_job || ')', true);
    update app.gyan_progress set recording_path = null where recording_path in (p_name, 'recordings/' || p_name);
    get diagnostics v_parts = row_count;
    perform set_config('app.audit_reason', '', true);
  elsif p_bucket = 'photos' then
    perform set_config('app.audit_reason', 'Virus check: an infected photo was removed (job ' || v_job || ')', true);
    with u as (update app.photos set status = 'removed'
                where center_id = v_center and storage_path in (p_name, 'photos/' || p_name) and status <> 'removed'
               returning uploaded_by, album_id)
    select count(*), (array_agg(uploaded_by) filter (where uploaded_by is not null))[1], (array_agg(album_id))[1]
      into v_parts, v_uploader, v_album_id from u;
    select a.title into v_album from app.photo_albums a where a.id = v_album_id;
    perform set_config('app.audit_reason', '', true);
  end if;

  -- Who is told. Never raising: a message that cannot be queued is recorded by 0587's helper, and anything else
  -- unexpected is written to the audit log; the tidy-up above stays.
  begin
    if p_bucket = 'homework' then
      select * into v_sub from app.gyan_submissions g
       where g.id = app.storage_segment_uuid(p_name, 3) and g.center_id = v_center and g.person_id = v_person;
      if found then
        select a.title into v_title from app.gyan_assignments a where a.id = v_sub.assignment_id;
        v_learner := coalesce(app.gyan_learner_name(v_person), 'the learner');
        v_what := 'A file in ' || v_learner || '''s homework "' || coalesce(v_title, 'Homework') || '"';
        v_next := case when v_sub.status in ('draft', 'needs_work')
                       then 'Open the homework in the Community Connect app to add that part again from another copy of the file.'
                       else 'The teacher sees that a part was removed and can send the homework back if it is needed.' end;
        v_told := app._gyan_homework_notify_family(v_center, 'upload.removed', v_sub.assignment_id, v_person, v_sub.id, true, false, false,
                                                   jsonb_build_object('what', v_what, 'next', v_next));
        if v_parts > 0 and v_sub.status in ('submitted', 'accepted', 'needs_work') then
          v_reviewers := app._upload_scan_tell_reviewers(v_center, v_sub.assignment_id, v_person, v_sub.id,
            jsonb_build_object('what', v_what, 'next', 'The answer stays in the queue without it; send it back if that part is needed.'));
        end if;
      end if;
    elsif p_bucket = 'recordings' then
      if v_person is not null and exists (select 1 from app.people p where p.id = v_person and p.center_id = v_center) then
        v_learner := coalesce(app.gyan_learner_name(v_person), 'a learner');
        v_what := 'A recording ' || v_learner || ' made in Gyan Path';
        v_next := 'Record it again in the app when you are ready.';
        v_told := app._gyan_homework_notify_person(v_center, 'upload.removed', v_person, jsonb_build_object('what', v_what, 'next', v_next), '{}'::jsonb, true);
        if app.person_is_minor(v_person) then
          for r in select * from app._gyan_homework_adults(v_center, v_person, false) as x(person_id) loop
            v_told := v_told + app._gyan_homework_notify_person(v_center, 'upload.removed', r.person_id,
                                 jsonb_build_object('what', v_what, 'next', v_next), '{}'::jsonb, true);
          end loop;
        end if;
      end if;
    else
      -- Photos and every other bucket: the uploader. A member's own photo upload carries their login in its name
      -- (<center>/<album>/<user id>-...).
      v_uploader := coalesce(v_uploader, s.uploaded_by,
                             case when app.storage_segment(p_name, 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-'
                                  then left(app.storage_segment(p_name, 3), 36)::uuid end);
      v_what := case p_bucket
                  when 'photos'        then 'A photo you uploaded' || coalesce(' to the album "' || v_album || '"', '')
                  when 'content'       then 'A file you uploaded to Content'
                  when 'store'         then 'A store picture you uploaded'
                  when 'branding'      then 'A branding file you uploaded'
                  when 'imports'       then 'An import file you uploaded'
                  when 'org-documents' then 'An organization document you uploaded'
                  else 'A file you uploaded' end;
      v_next := case when p_bucket = 'photos' then 'Upload it again from another copy if you still want to share it.'
                     else 'Upload it again from a clean copy if it is still needed.' end;
      if exists (select 1 from auth.users u where u.id = v_uploader) then
        v_told := app._upload_scan_tell_user(v_center, v_uploader, jsonb_build_object('what', v_what, 'next', v_next));
      end if;
    end if;
  exception when others then
    perform app.log_audit(v_center, 'storage.scan_notice_failed', 'storage.objects', p_bucket || '/' || app.storage_name_for_audit(p_bucket, p_name), null,
                          jsonb_build_object('bucket', p_bucket, 'error', sqlerrm), 'Virus check: the people concerned could not be told (job ' || v_job || ')');
  end;

  -- The office: one audit entry (audit.view holders read it).
  v_who := case when v_told > 0 and v_reviewers > 0 then 'the family and the reviewers were told'
                when v_told > 0 then case when p_bucket in ('homework', 'recordings') then 'the family was told' else 'the uploader was told' end
                when v_reviewers > 0 then 'the reviewers were told'
                else 'nobody could be told' end;
  perform app.log_audit(v_center, 'storage.scan_infected', 'storage.objects', p_bucket || '/' || app.storage_name_for_audit(p_bucket, p_name), null,
    jsonb_build_object('bucket', p_bucket, 'name', app.storage_name_for_audit(p_bucket, p_name), 'signature', s.signature, 'engine', s.engine,
                       'bytes', s.bytes, 'mode', 'enforce', 'removed', true, 'parts', v_parts, 'messages', v_told, 'reviewer_messages', v_reviewers),
    'Virus check: ' || coalesce(s.signature, 'a threat') || ' found; the file was removed and ' || v_who || ' (job ' || v_job || ')');
  return jsonb_build_object('done', true, 'parts', v_parts, 'told', v_told, 'reviewers', v_reviewers);
end $$;

-- Every 6 hours (storage.scan_sweep), and at once when scanning is switched on: queue a check for each file of a scanned
-- bucket that has no result for its current version and no live job (the backlog, once), the infected files still stored
-- once enforce is on (to remove them), and checks that failed for a passing reason (no signature) a day ago. At most
-- p_limit of each, oldest first. Nothing while scanning is off.
create or replace function app.worker_scan_sweep(p_limit int default 500) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_mode text := app.upload_scan_mode(); v_limit int := least(greatest(coalesce(p_limit, 500), 1), 5000);
        r record; v_new int := 0; v_remove int := 0; v_retry int := 0;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  if v_mode = 'off' then return jsonb_build_object('mode', v_mode, 'queued', 0); end if;
  for r in
    with live as (select j.payload->>'bucket' as bucket, j.payload->>'name' as name from app.jobs j
                   where j.kind = 'storage.scan' and j.status in ('queued', 'running'))
    select o.bucket_id::text as bucket_id, o.name::text as name, o.id, o.metadata,
           case when s.bucket_id is null or (s.status <> 'infected' and s.object_version is distinct from o.version) then 'new'
                when s.status = 'infected' then 'remove' else 'retry' end as why
      from storage.objects o
      left join app.upload_scans s on s.bucket_id = o.bucket_id and s.name = o.name
     where o.bucket_id = any (app.storage_scan_buckets())
       and not exists (select 1 from live l where l.bucket = o.bucket_id and l.name = o.name)
       and (s.bucket_id is null
            or (s.status <> 'infected' and s.object_version is distinct from o.version)
            or (v_mode = 'enforce' and s.status = 'infected')
            or (s.status = 'failed' and s.signature is null and s.scanned_at < now() - interval '1 day'))
     order by o.created_at
     limit v_limit * 3
  loop
    if (r.why = 'new' and v_new >= v_limit) or (r.why = 'remove' and v_remove >= v_limit) or (r.why = 'retry' and v_retry >= v_limit) then
      continue;
    end if;
    perform app.enqueue_job((select c.id from app.centers c where c.id = app.storage_center(r.name)), 'storage.scan',
      jsonb_build_object('bucket', r.bucket_id, 'name', r.name, 'object_id', r.id,
                         'size', r.metadata->'size', 'mimetype', r.metadata->>'mimetype', 'sweep', r.why),
      now(), 25);
    if r.why = 'new' then v_new := v_new + 1; elsif r.why = 'remove' then v_remove := v_remove + 1; else v_retry := v_retry + 1; end if;
  end loop;
  return jsonb_build_object('mode', v_mode, 'queued', v_new + v_remove + v_retry, 'unchecked', v_new, 'to_remove', v_remove, 'retried', v_retry);
end $$;

-- ── The audit log ────────────────────────────────────────────────────────────
-- 0587's definition (see the note there) plus 0589: a row that names a homework file (bucket_id or bucket 'homework' and
-- a name <center>/<person>/<submission>/<file>) keeps the folder only, as 0587's own entries do; plus 0590's clause
-- (assistance_note, Pathshala fee assistance), copied verbatim from feat/pathshala-db1, where 0590 carries this file's
-- clause too: the two migrations define the same function, so they can be applied in either order. (The assistance_note
-- clause masks a key no 0589 row has; without 0590 it does nothing.) Anyone who changes app.audit_mask again must start
-- from the later of the two definitions (0589, 0590):
--   0102   date_of_birth and the secrets / tokens
--   0546   the emergency contact's name and number, both dietary fields
--   0545   staged_rows (the uploaded rows, personal data) and merge_answers (they grow with the file)
--   0573   niva_tsv (derived search vector, dropped rather than masked)
--   0578   result.image_b64 (AI flyer art bytes in app.jobs.result)
--   0587   text_answer, parent_note, review_note (homework), and the file name of a homework part's storage_path
--   0589   the file name of a homework file in a row that names its bucket (app.upload_scans)
--   0590   assistance_note (Pathshala fee assistance)
create or replace function app.audit_mask(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - 'date_of_birth' - 'provider_ref' - 'fee_authorization_ref' - 'secret_ref' - 'niva_tsv'
      || case when j ? 'date_of_birth' then jsonb_build_object('date_of_birth', '***') else '{}'::jsonb end
      || case when j->>'ticket_token' is not null then jsonb_build_object('ticket_token', '***') else '{}'::jsonb end
      || case when j->>'attendance_token' is not null then jsonb_build_object('attendance_token', '***') else '{}'::jsonb end
      || case when j->>'token' is not null then jsonb_build_object('token', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_name' is not null then jsonb_build_object('emergency_contact_name', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_phone' is not null then jsonb_build_object('emergency_contact_phone', '***') else '{}'::jsonb end
      || case when j->>'dietary_other' is not null then jsonb_build_object('dietary_other', '***') else '{}'::jsonb end
      || case when j->'dietary' is not null and j->'dietary' <> '[]'::jsonb and j->'dietary' <> 'null'::jsonb
              then jsonb_build_object('dietary', '***') else '{}'::jsonb end
      || case when j ? 'staged_rows' then jsonb_build_object('staged_rows', '***') else '{}'::jsonb end
      || case when j ? 'merge_answers' then jsonb_build_object('merge_answers', '***') else '{}'::jsonb end
      || case when jsonb_typeof(j->'result') = 'object' and (j->'result') ? 'image_b64'
              then jsonb_build_object('result', (j->'result') || jsonb_build_object('image_b64', '***')) else '{}'::jsonb end
      || case when j->>'text_answer' is not null
              then jsonb_build_object('text_answer', '*** (' || char_length(j->>'text_answer') || ' characters)') else '{}'::jsonb end
      || case when j->>'parent_note' is not null
              then jsonb_build_object('parent_note', '*** (' || char_length(j->>'parent_note') || ' characters)') else '{}'::jsonb end
      || case when j->>'review_note' is not null
              then jsonb_build_object('review_note', '*** (' || char_length(j->>'review_note') || ' characters)') else '{}'::jsonb end
      || case when j->>'storage_path' ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[^/]+$'
              then jsonb_build_object('storage_path', regexp_replace(j->>'storage_path', '[^/]+$', '***')) else '{}'::jsonb end
      || case when coalesce(j->>'bucket_id', j->>'bucket') = 'homework'
                   and j->>'name' ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[^/]+$'
              then jsonb_build_object('name', regexp_replace(j->>'name', '[^/]+$', '***')) else '{}'::jsonb end
      || case when j->>'assistance_note' is not null
              then jsonb_build_object('assistance_note', '*** (' || char_length(j->>'assistance_note') || ' characters)') else '{}'::jsonb end
  end
$$;

-- 0174's body over every Connect bucket (app.connect_storage_buckets: the homework bucket was missing from its hard-coded
-- nine), a homework file named by its folder only (record id and before/after), and the entries masked like every other.
create or replace function app.storage_audit() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare r record; v_action text; c record; v_owner uuid; v_actor uuid; v_role text;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if r.bucket_id is null or not (r.bucket_id = any (app.connect_storage_buckets())) then
    return r;
  end if;
  if tg_op = 'UPDATE' and old.version is not distinct from new.version and old.name is not distinct from new.name then
    return r;   -- metadata-only touches (last_accessed_at and the like) are not changes to the file
  end if;
  v_action := 'storage.' || case tg_op when 'INSERT' then 'upload' when 'UPDATE' then 'replace' else 'remove' end;
  v_owner := case when coalesce(r.owner_id, r.owner::text) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then coalesce(r.owner_id, r.owner::text)::uuid end;
  v_actor := coalesce(auth.uid(), case when tg_op <> 'DELETE' then v_owner end);
  v_role := case when auth.uid() is null and v_actor is not null then 'authenticated' else auth.jwt()->>'role' end;
  select * into c from app.audit_context();
  insert into app.audit_log (center_id, actor_user_id, actor_role, action, record_table, record_id, before, after,
                             reason, correlation_id, ip, user_agent, module, client_app, client_screen)
  values (app.storage_center(r.name), v_actor, v_role, v_action, 'storage.objects', r.bucket_id || '/' || app.storage_name_for_audit(r.bucket_id, r.name),
          case when tg_op <> 'INSERT' then app.audit_mask(jsonb_build_object('bucket', old.bucket_id, 'name', app.storage_name_for_audit(old.bucket_id, old.name),
                                                              'owner', old.owner_id, 'size', old.metadata->'size', 'mimetype', old.metadata->>'mimetype')) end,
          case when tg_op <> 'DELETE' then app.audit_mask(jsonb_build_object('bucket', new.bucket_id, 'name', app.storage_name_for_audit(new.bucket_id, new.name),
                                                              'owner', new.owner_id, 'size', new.metadata->'size', 'mimetype', new.metadata->>'mimetype')) end,
          c.reason, c.correlation_id, c.ip, c.user_agent, app.storage_bucket_module(r.bucket_id), c.client_app, c.client_screen);
  return r;
end $$;
revoke execute on function app.storage_audit() from public, anon, authenticated;

-- ── What staff see ───────────────────────────────────────────────────────────
-- One community's files in the scanned buckets: how many, and how many of them are waiting (pending), clean, could not
-- be checked (failed) or infected and still stored (monitor mode keeps them; in enforce mode only until the removal
-- finishes); infected files removed; checks queued; the mode and since when it is enforced; the buckets held back.
create or replace function app._upload_scan_summary(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb;
begin
  select jsonb_build_object(
           'files', count(*),
           'pending', count(*) filter (where s.status is null),
           'clean', count(*) filter (where s.status = 'clean'),
           'failed', count(*) filter (where s.status = 'failed'),
           'infected', count(*) filter (where s.status = 'infected'))
    into v
    from storage.objects o
    left join app.upload_scans s on s.bucket_id = o.bucket_id and s.name = o.name
                                and (s.status = 'infected' or s.object_version is not distinct from o.version)
   where o.bucket_id = any (app.storage_scan_buckets()) and split_part(o.name, '/', 1) = p_center::text;
  return coalesce(v, '{}'::jsonb) || jsonb_build_object(
    'mode', app.upload_scan_mode(),
    'enforced_since', app.upload_scan_enforced_since(),
    'held_buckets', to_jsonb(app.upload_scan_enforced_buckets()),
    'removed', (select count(*) from app.upload_scans r where r.center_id = p_center and r.status = 'infected' and r.removed_at is not null),
    'queued', (select count(*) from app.jobs j where j.center_id = p_center and j.kind = 'storage.scan' and j.status in ('queued', 'running')));
end $$;

-- 0587's storage overview (Setup › Storage, Settings › Storage) with the virus check summary ("scan").
create or replace function app.center_storage_overview(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := '[]'; v_used jsonb := '{}'; v_limit jsonb;
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'You don''t have access to this community''s storage settings (it needs settings.manage).' using errcode = 'insufficient_privilege';
  end if;
  v_limit := app.entitlement(p_center, 'storage.bytes');
  if to_regclass('storage.buckets') is null then
    return jsonb_build_object('available', false, 'areas', v, 'limit_bytes', v_limit, 'used_bytes', 0);
  end if;
  if to_regclass('storage.objects') is not null then
    execute $q$
      select coalesce(jsonb_object_agg(bucket_id, jsonb_build_object('files', n, 'bytes', b)), '{}'::jsonb)
        from (select o.bucket_id, count(*) n, coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0) b
                from storage.objects o where split_part(o.name, '/', 1) = $1::text group by o.bucket_id) x
    $q$ into v_used using p_center;
  end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object(
             'bucket', b.id, 'public', b.public, 'max_file_bytes', b.file_size_limit, 'types', to_jsonb(b.allowed_mime_types),
             'files', coalesce(($1->b.id->>'files')::int, 0), 'bytes', coalesce(($1->b.id->>'bytes')::bigint, 0),
             'retention_days', app.storage_retention_days(b.id, $2),
             'retention_editable', b.id in ('imports','recordings','homework'),
             'module', app.storage_bucket_module(b.id),
             'module_on', app.storage_bucket_module(b.id) is null or app.module_enabled($2, app.storage_bucket_module(b.id)))
             order by array_position(array['branding','content','photos','store','statements','recordings','homework','imports','org-documents','exports'], b.id::text), b.id), '[]'::jsonb)
      from storage.buckets b
     where b.id in ('branding','content','photos','store','statements','recordings','homework','imports','org-documents','exports')
  $q$ into v using v_used, p_center;
  return jsonb_build_object('available', true, 'areas', v, 'limit_bytes', v_limit,
    'used_bytes', coalesce((select sum((e.value->>'bytes')::bigint) from jsonb_each(v_used) e), 0),
    'scan', case when to_regclass('storage.objects') is null then null else app._upload_scan_summary(p_center) end);
end $$;

-- 0171's status of the background service with the same summary ("scan"), for Settings › Integrations.
create or replace function app.background_service_status(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_last timestamptz; v_workers jsonb; v_jobs jsonb; v_state text; v_live int;
begin
  if not (app.has_permission(p_center, 'settings.manage') or app.has_permission(p_center, 'integrations.view')
          or app.has_permission(p_center, 'integrations.manage') or app.is_center_owner(p_center)) then
    raise exception 'Seeing the background service needs settings.manage or integrations.view.' using errcode = 'insufficient_privilege';
  end if;
  select max(beat_at), count(*) filter (where stopped_at is null and beat_at >= now() - app.worker_stale_after()),
         coalesce(jsonb_agg(jsonb_build_object('worker', worker, 'started_at', started_at, 'beat_at', beat_at,
                                               'stopped_at', stopped_at, 'version', version, 'kinds', kinds,
                                               'handlers', coalesce(info->'handlers', '{}'::jsonb))
                            order by (stopped_at is null) desc, beat_at desc), '[]'::jsonb)
    into v_last, v_live, v_workers
    from app.worker_heartbeats;
  v_state := case when v_last is null then 'not_configured'
                  when v_live > 0 then 'running'
                  else 'stopped' end;
  select jsonb_build_object(
           'queued',     count(*) filter (where status = 'queued'),
           'running',    count(*) filter (where status = 'running'),
           'failed_24h', count(*) filter (where status = 'failed' and finished_at > now() - interval '24 hours'),
           'done_24h',   count(*) filter (where status = 'done' and finished_at > now() - interval '24 hours'),
           'scan_pending', count(*) filter (where kind = 'storage.scan' and status in ('queued','running')))
    into v_jobs
    from app.jobs where center_id = p_center;
  return jsonb_build_object('state', v_state, 'last_beat_at', v_last,
                            'age_seconds', case when v_last is null then null else extract(epoch from now() - v_last)::int end,
                            'workers', v_workers, 'jobs', v_jobs,
                            'scan', case when to_regclass('storage.objects') is null then null else app._upload_scan_summary(p_center) end);
end $$;

-- 0587's answer JSON; each part also says where its virus check stands (scan: pending | clean | infected | failed |
-- exempt; 'infected' for a part the check removed, null for one retention removed) and whether it is held back from the
-- reviewers until it is clean (scan_held, enforce mode only). The member app and the portal's review queue read both.
create or replace function app.gyan_submission_json(p_submission uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
           'id', s.id, 'status', s.status, 'attempt', s.attempt, 'text_answer', s.text_answer, 'submitted_at', s.submitted_at,
           'parent_note', s.parent_note, 'review_note', s.review_note, 'decided_at', s.decided_at,
           'points_awarded', s.points_awarded, 'late', s.late,
           'files', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', f.id, 'kind', f.kind, 'storage_path', f.storage_path, 'mime_type', f.mime_type,
                                 'bytes', f.bytes, 'duration_seconds', f.duration_seconds, 'sort_order', f.sort_order,
                                 'deleted_at', f.deleted_at,
                                 'scan', case when f.storage_path is not null and f.deleted_at is null then app.upload_scan_state('homework', f.storage_path)
                                              when f.removed_reason = 'infected' then 'infected' end,
                                 'scan_held', f.storage_path is not null and f.deleted_at is null and app.upload_scan_held('homework', f.storage_path))
                                 order by f.sort_order, f.created_at, f.id)
                               from app.gyan_submission_files f where f.submission_id = s.id), '[]'::jsonb))
    from app.gyan_submissions s where s.id = p_submission
$$;

-- ── Comments ─────────────────────────────────────────────────────────────────
comment on function app.upload_scan_mode() is 'The virus check mode (0589), Platform › Setup UPLOAD_SCAN_MODE: off (the default) | monitor (check and record, deny nothing) | enforce (the read gate; infected files are removed and the people concerned told).';
comment on function app.upload_scan_enforced_since() is 'When the mode last changed to enforce (null unless it is enforce): the read gate holds back only files uploaded or replaced from then on.';
comment on function app.connect_storage_buckets() is 'Community Connect''s ten storage buckets (the storage.objects policies name the same ten); app.storage_audit audits all of them.';
comment on function app.upload_scan_gated_buckets() is 'The buckets whose files the read gate can hold back until checked, in rollout order. Only app.upload_scan_enforced_buckets() are enforced in 0589.';
comment on function app.upload_scan_enforced_buckets() is 'Held back until checked in this release (0589): homework and recordings. Photos, org-documents, content and store come later.';
comment on function app.upload_scan_state(text, text) is 'exempt (a bucket that is not scanned) | the current version''s result: clean | infected | failed | pending (no result yet). Infected stays after the file is removed.';
comment on function app.upload_scan_held(text, text) is 'Enforce mode: a homework file or recording uploaded or replaced after enforcement began whose check is pending or failed. Only the uploader''s family opens it until it is clean.';
comment on function app.worker_scan_object(text, text) is 'connect_worker: the mode, whether the bucket is scanned, the object''s id, version, size and type, and the result already recorded (current = for this version).';
comment on function app.worker_record_scan(text, text, uuid, text, text, text, text, bigint, bigint, text) is 'connect_worker: record clean | infected | failed for the version that was checked (not while scanning is off; not when the file is gone or changed). Returns {recorded, reason?, status, action: remove | keep | none, mode}.';
comment on function app.worker_scan_removed(text, text, bigint) is 'connect_worker, after the Storage API deleted an infected file: homework parts marked deleted (removed_reason infected), recordings cleared, photos removed; the learner (and a child''s household adults) or the uploader told with upload.removed; the reviewers of an answer already with them pushed; an audit entry for the office. Once per file (removed_at).';
comment on function app.worker_scan_sweep(int) is 'connect_worker (every 6 hours, and when scanning is switched on): queue storage.scan for files with no current result and no live job, infected files still stored (enforce), and failed checks without a signature older than a day.';

-- ── Grants ───────────────────────────────────────────────────────────────────
-- Internal: the read rule, the answer JSON, the summaries and the worker functions call these as their definer.
revoke execute on function app.upload_scan_mode(), app.upload_scan_enforced_since(), app.connect_storage_buckets(),
  app.upload_scan_gated_buckets(), app.upload_scan_enforced_buckets(), app.upload_scan_lock(text, text),
  app.upload_scan_state(text, text), app.upload_scan_held(text, text), app.storage_name_for_audit(text, text),
  app._upload_scan_tell_user(uuid, uuid, jsonb), app._upload_scan_tell_reviewers(uuid, uuid, uuid, uuid, jsonb),
  app._upload_scan_summary(uuid)
  from public, anon, authenticated;
grant execute on function app.upload_scan_mode(), app.upload_scan_enforced_since(), app.connect_storage_buckets(),
  app.upload_scan_gated_buckets(), app.upload_scan_enforced_buckets(), app.upload_scan_state(text, text),
  app.upload_scan_held(text, text), app.storage_name_for_audit(text, text), app._upload_scan_summary(uuid)
  to service_role;
-- The background service's side: connect_worker only (each one asserts it too).
revoke execute on function app.worker_scan_object(text, text),
  app.worker_record_scan(text, text, uuid, text, text, text, text, bigint, bigint, text),
  app.worker_scan_removed(text, text, bigint), app.worker_scan_sweep(int)
  from public, anon, authenticated, service_role;
grant execute on function app.worker_scan_object(text, text),
  app.worker_record_scan(text, text, uuid, text, text, text, text, bigint, bigint, text),
  app.worker_scan_removed(text, text, bigint), app.worker_scan_sweep(int)
  to connect_worker;
