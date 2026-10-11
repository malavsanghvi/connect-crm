-- 0640_site_found_inputs.sql (backlog B92, phase W2: "What we found" about an organization's website)
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   An organization gives the address of its current website and up to three websites it likes. Staff who may change
--   settings press "Look at my website"; the background service reads each site (worker job site.crawl, phase W1) and the
--   screen shows "What we found" before anything is drafted. This migration adds only the plumbing:
--     app.center_site_inputs        the addresses (one row per community)
--     app.site_found_save_inputs    staff: save the addresses (settings.manage)
--     app.site_crawl_start          staff: queue the reads, at most 8 a hour per community, one at a time per website
--     app.site_found_status         staff: the addresses and the latest read of each website (no report)
--     app.site_found_report         staff: one finished read, in full
--   Nothing is published and nothing is drafted here; the reads are the jobs' results (app.jobs.result).
--
-- WHERE THE ADDRESSES LIVE, AND WHY NOT centers.rules
--   app.centers is readable by anyone, signed in or not (0010, 0613), and the member app reads `rules` before sign-in.
--   Which websites an organization likes is not for visitors, so the addresses are kept in their own table with row
--   level security on and NO policy and no grant: nobody can select, insert or update it through the API. Only the
--   SECURITY DEFINER functions below read or write it, after checking settings.manage themselves. (The organization's
--   own website address also exists as the public profile's `website`, 0180; the screen offers it as the starting
--   value, and nothing here changes it.)
--
-- SECURITY DEFINER, AND THE PATTERN FOLLOWED
--   The same as app.niva_discover_site / niva_discovery_status (0576): security definer, search_path = app, public,
--   extensions, "Sign in first" for a caller with no user, the permission checked inside, execute revoked from public,
--   anon and service_role and granted to authenticated only. No policy is added and no existing policy changes.
--
-- WHAT IS REFUSED (and said in plain English)
--   * an address that is not http or https (a bare "www.example.org" is read as https://www.example.org);
--   * an address with a user name or password, a space, a number instead of a name (127.0.0.1, 10.0.0.5), localhost, a
--     name with no dot, or a name ending .local .internal .localhost .lan .home .corp .intranet .test .example .invalid .arpa;
--     the background service checks again where the name leads before it reads anything;
--   * more than 3 websites the organization likes; the organization's own website listed as one it likes;
--   * a read while the same website is already being read (queued or running in the last 15 minutes);
--   * more than 8 reads in the last hour for one community (a full run is 4: the organization and three it likes).
--
-- Idempotent where it can be: create table if not exists, create or replace function.

set client_min_messages = warning;

-- ── 1. The addresses ─────────────────────────────────────────────────────────
create table if not exists app.center_site_inputs (
  center_id      uuid primary key references app.centers(id) on delete cascade,
  own_url        text check (own_url is null or char_length(own_url) <= 2000),
  reference_urls text[] not null default '{}' check (cardinality(reference_urls) <= 3),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null
);
comment on table app.center_site_inputs is
  'The organization''s current website and up to three websites it likes (0640, B92 W2). Kept apart from app.centers.rules, which anyone can read. Row level security is on with no policy: only app.site_found_* (settings.manage) reach it.';
comment on column app.center_site_inputs.own_url is 'The organization''s own website, written one way (app.niva_page_address); read in "own" mode: its text and images may be kept for drafting.';
comment on column app.center_site_inputs.reference_urls is 'Up to three websites the organization likes, read in "reference" mode: layout patterns only, never their text or images.';

alter table app.center_site_inputs enable row level security;
revoke all on app.center_site_inputs from public, anon, authenticated, service_role;

insert into app.module_tables (table_name, module_key) values ('center_site_inputs', null)
on conflict (table_name) do update set module_key = excluded.module_key;

drop trigger if exists audit_center_site_inputs on app.center_site_inputs;
create trigger audit_center_site_inputs after insert or update or delete on app.center_site_inputs
  for each row execute function app.audit_row('center_id');

-- ── 2. One website address, checked and written one way ──────────────────────
-- Returns the address in the form the crawl is given, null for a blank, and raises a plain sentence for anything that
-- is not a public web address. The worker checks again (DNS, redirects); this keeps the obvious mistakes out.
create or replace function app.site_clean_address(p_raw text) returns text
language plpgsql stable set search_path = app, public, extensions as $$
declare
  v text := btrim(coalesce(p_raw, ''));
  v_shown text;
  m text[];
  v_auth text;
  v_hp text[];
  v_host text;
  v_port text;
begin
  if v = '' then return null; end if;
  v_shown := left(v, 80);
  if char_length(v) > 2000 then raise exception '"%…" is too long to be a website address.', v_shown; end if;
  if v ~ '[[:space:]]' then
    raise exception '"%" has a space in it. A website address has none, for example https://www.example.org.', v_shown;
  end if;
  if v ~* '^[a-z][a-z0-9+.-]*:' and v !~* '^[a-z][a-z0-9+.-]*://' and v !~* '^[a-z0-9.-]+:[0-9]+([/?#]|$)' then
    raise exception '"%" is not a website address. It must start with http:// or https://.', v_shown;   -- mailto:, javascript:, tel:
  end if;
  if v !~* '^[a-z][a-z0-9+.-]*://' then v := 'https://' || v; end if;   -- "www.example.org" means https://www.example.org
  if v !~* '^https?://' then
    raise exception '"%" is not a web address. It must start with http:// or https://.', v_shown;
  end if;
  m := regexp_match(v, '^https?://([^/?#]*)([/?#].*)?$', 'i');
  if m is null or m[1] = '' then raise exception '"%" is not a website address. Try something like https://www.example.org.', v_shown; end if;
  v_auth := m[1];
  if position('@' in v_auth) > 0 then
    raise exception '"%" has a user name or password in it. Give only the website''s address.', v_shown;
  end if;
  v_hp := regexp_match(v_auth, '^([^:]+)(?::([0-9]{1,5}))?$');
  if v_hp is null then raise exception '"%" is not a website address. Use the website''s name, for example https://www.example.org.', v_shown; end if;
  v_host := lower(regexp_replace(v_hp[1], '\.$', ''));
  v_port := v_hp[2];
  if v_port is not null and (v_port::int < 1 or v_port::int > 65535) then
    raise exception '"%" has a port number that does not exist.', v_shown;
  end if;
  if v_host ~ '^[0-9.]+$' or v_host !~ '\.' or v_host ~ '(^|\.)(localhost|local|internal|lan|home|corp|intranet|test|example|invalid|arpa)$' then
    raise exception '"%" points to a private network or to something that is not a website name. Only public websites can be read, and they are given by name, for example https://www.example.org.', v_shown;
  end if;
  if v_host !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+(xn--[a-z0-9-]{2,59}|[a-z]{2,63})$' then
    raise exception '"%" is not a website name. Try something like https://www.example.org.', v_shown;
  end if;
  return app.niva_page_address(v);
end $$;
comment on function app.site_clean_address(text) is
  'A website address checked and written one way for the site crawl (0640): http or https only, a public-looking name (no number, localhost or private suffix, no user name), the address as app.niva_page_address writes it. Null for a blank; a plain sentence for anything else.';

-- The website an address belongs to, without "www.": two addresses on the same website have the same key.
create or replace function app.site_host_key(p_addr text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select regexp_replace(lower(coalesce(substring(p_addr from '^https?://([^/:?#]+)'), '')), '^www\.', '')
$$;
comment on function app.site_host_key(text) is 'The website an address is on, lower-case and without a leading "www." (0640): the apex and www forms, and any page of it, are one website.';

-- ── 3. Staff: save the addresses ─────────────────────────────────────────────
-- p_own: the organization's own website ('' or null clears it). p_refs: up to 3 websites it likes (blanks are dropped,
-- and two addresses on the same website are kept once). A website the organization lists as its own cannot also be one
-- it likes.
create or replace function app.site_found_save_inputs(p_center uuid, p_own text, p_refs text[])
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_own text; v_refs text[] := '{}'; v_keys text[] := '{}'; v_raw text; v_addr text; v_key text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Giving the website addresses needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;

  v_own := app.site_clean_address(p_own);
  foreach v_raw in array coalesce(p_refs, '{}'::text[]) loop
    v_addr := app.site_clean_address(v_raw);
    if v_addr is null then continue; end if;
    v_key := app.site_host_key(v_addr);
    if v_own is not null and v_key = app.site_host_key(v_own) then
      raise exception '"%" is the organization''s own website. List websites you like in the other boxes, or clear this one.', left(btrim(v_raw), 80);
    end if;
    if v_key = any (v_keys) then continue; end if;       -- the same website twice is kept once
    v_keys := v_keys || v_key;
    v_refs := v_refs || v_addr;
  end loop;
  if cardinality(v_refs) > 3 then
    raise exception 'You can give at most 3 websites you like (this was %). Remove % and save again.', cardinality(v_refs), cardinality(v_refs) - 3;
  end if;

  insert into app.center_site_inputs (center_id, own_url, reference_urls, updated_by)
  values (p_center, v_own, v_refs, auth.uid())
  on conflict (center_id) do update
    set own_url = excluded.own_url, reference_urls = excluded.reference_urls, updated_at = now(), updated_by = auth.uid();
  return jsonb_build_object('own_url', v_own, 'reference_urls', to_jsonb(v_refs));
end $$;

-- ── 4. Staff: read the saved websites (queue the reads) ─────────────────────────────────────────────────────────────
-- p_slot: null = the organization's website and every website it likes; 'own' or 'ref1'..'ref3' = just that one (for
-- Try again). The addresses read are always the SAVED ones: the caller cannot send an address of its own here.
-- A read counts toward the hour's limit of 8 whether it finishes or fails.
create or replace function app.site_crawl_start(p_center uuid, p_slot text default null)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_in app.center_site_inputs;
  v_slots text[] := '{}';
  v_slot text;
  v_i int;
  v_url text;
  v_mode text;
  v_run text := gen_random_uuid()::text;
  v_recent int;
  v_over int;
  v_free_at timestamptz;
  v_minutes int;
  v_id bigint;
  v_queued jsonb := '[]'::jsonb;
  c_limit constant int := 8;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Looking at a website needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;

  -- The row is locked for this transaction, so two presses at once cannot both get under the hourly limit.
  select * into v_in from app.center_site_inputs where center_id = p_center for update;
  if not found or (v_in.own_url is null and cardinality(v_in.reference_urls) = 0) then
    raise exception 'Give your website''s address (or one you like) and save it first.';
  end if;

  if v_in.own_url is not null then v_slots := v_slots || 'own'::text; end if;
  for v_i in 1 .. cardinality(v_in.reference_urls) loop v_slots := v_slots || ('ref' || v_i::text); end loop;
  if p_slot is not null then
    if p_slot not in ('own', 'ref1', 'ref2', 'ref3') then raise exception 'Weaver does not know which website "%" is.', left(p_slot, 20); end if;
    if not (p_slot = any (v_slots)) then raise exception 'There is no saved address for that website. Save the addresses first.'; end if;
    v_slots := array[p_slot];
  end if;

  -- One read at a time per website. One queued more than 15 minutes ago and never finished (the background service was
  -- down) does not block a new one.
  if exists (select 1 from app.jobs j
              where j.center_id = p_center and j.kind = 'site.crawl' and j.status in ('queued', 'running')
                and j.created_at > now() - interval '15 minutes' and j.payload ->> 'slot' = any (v_slots)) then
    raise exception 'Weaver is already reading %. Wait for that to finish (usually a minute or two), then try again.',
      case when cardinality(v_slots) = 1 then 'that website' else 'these websites' end;
  end if;

  -- At most c_limit reads an hour for one community.
  select count(*) into v_recent from app.jobs j
   where j.center_id = p_center and j.kind = 'site.crawl' and j.created_at > now() - interval '1 hour';
  v_over := v_recent + cardinality(v_slots) - c_limit;
  if v_over > 0 then
    select j.created_at into v_free_at from app.jobs j
     where j.center_id = p_center and j.kind = 'site.crawl' and j.created_at > now() - interval '1 hour'
     order by j.created_at offset (v_over - 1) limit 1;
    v_minutes := greatest(1, ceil(extract(epoch from (coalesce(v_free_at, now()) + interval '1 hour' - now())) / 60.0)::int);
    raise exception 'Weaver reads at most % websites an hour for one community, and % have been read in the last hour. Try again in about % minute%.',
      c_limit, v_recent, v_minutes, case when v_minutes = 1 then '' else 's' end;
  end if;

  foreach v_slot in array v_slots loop
    v_mode := case when v_slot = 'own' then 'own' else 'reference' end;
    v_url := case when v_slot = 'own' then v_in.own_url else v_in.reference_urls[substr(v_slot, 4)::int] end;
    v_id := app.enqueue_job(p_center, 'site.crawl',
              jsonb_build_object('start_url', v_url, 'mode', v_mode, 'max_pages', case when v_mode = 'own' then 40 else 20 end,
                                 'slot', v_slot, 'run', v_run),
              now(), 2);
    v_queued := v_queued || jsonb_build_array(jsonb_build_object('job_id', v_id, 'slot', v_slot, 'mode', v_mode, 'url', v_url));
  end loop;
  return jsonb_build_object('run', v_run, 'queued', v_queued);
end $$;

-- ── 5. Staff: the addresses and the latest read of each website ──────────────
-- No report in here (it can be large and the screen asks again while a read is on its way): app.site_found_report
-- gives one finished read. `reads_last_hour` and `max_reads_per_hour` let the screen say how many are left.
create or replace function app.site_found_status(p_center uuid)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_in app.center_site_inputs; v_profile text; v_jobs jsonb; v_recent int;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Seeing what Weaver found on a website needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_in from app.center_site_inputs where center_id = p_center;
  select p.website into v_profile from app.org_profiles p where p.center_id = p_center;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'slot', l.payload ->> 'slot', 'mode', l.payload ->> 'mode', 'url', l.payload ->> 'start_url',
           'run', l.payload ->> 'run', 'status', l.status, 'attempts', l.attempts, 'max_attempts', l.max_attempts,
           'last_error', l.last_error, 'created_at', l.created_at, 'finished_at', l.finished_at,
           'pages_read', l.result -> 'crawl' -> 'pages_fetched') order by l.payload ->> 'slot'), '[]'::jsonb)
    into v_jobs
    from (select distinct on (j.payload ->> 'slot') j.*
            from app.jobs j
           where j.center_id = p_center and j.kind = 'site.crawl' and j.payload ? 'slot'
           order by j.payload ->> 'slot', j.id desc) l;

  select count(*) into v_recent from app.jobs j
   where j.center_id = p_center and j.kind = 'site.crawl' and j.created_at > now() - interval '1 hour';

  return jsonb_build_object(
    'own_url', v_in.own_url,
    'reference_urls', to_jsonb(coalesce(v_in.reference_urls, '{}'::text[])),
    'saved_at', v_in.updated_at,
    'profile_website', v_profile,
    'jobs', v_jobs,
    'reads_last_hour', v_recent,
    'max_reads_per_hour', 8);
end $$;

-- ── 6. Staff: one finished read, in full ─────────────────────────────────────
create or replace function app.site_found_report(p_center uuid, p_job bigint)
returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Seeing what Weaver found on a website needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  select jsonb_build_object('id', j.id, 'slot', j.payload ->> 'slot', 'mode', j.payload ->> 'mode', 'url', j.payload ->> 'start_url',
                            'finished_at', j.finished_at, 'result', j.result)
    into v
    from app.jobs j
   where j.id = p_job and j.center_id = p_center and j.kind = 'site.crawl' and j.status = 'done' and j.result is not null;
  if v is null then
    raise exception 'That report is not available: the website may still be read, or it was not read for this community.';
  end if;
  return v;
end $$;

-- ── 7. Grants (as 0540 and 0576) ─────────────────────────────────────────────
revoke execute on function app.site_clean_address(text), app.site_host_key(text), app.site_found_save_inputs(uuid, text, text[]),
  app.site_crawl_start(uuid, text), app.site_found_status(uuid), app.site_found_report(uuid, bigint)
  from public, anon, authenticated, service_role;
grant execute on function app.site_found_save_inputs(uuid, text, text[]), app.site_crawl_start(uuid, text),
  app.site_found_status(uuid), app.site_found_report(uuid, bigint) to authenticated;
