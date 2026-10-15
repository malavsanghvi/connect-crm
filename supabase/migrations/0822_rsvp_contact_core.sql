-- 0822 · RSVP without signing in (docs/RSVP_WITHOUT_LOGIN.md, owner-approved 2026-10-15), 1 of 2: the database core in mode `open`.
--
-- WHAT THIS IS, IN PLAIN WORDS
--   A visitor who is not signed in types a phone number or an email on an event. If it belongs to an ADULT on a family record,
--   the family comes back with MASKED names and the masked phone and email the confirmation will go to; the visitor ticks who
--   is coming and saves (0823). Nothing is returned that the plan did not list: never an id, a real name, a real email or phone.
--
--   Everything is OFF until a person switches it on, twice:
--     centers.rules.rsvp.contact_lookup   'off' (default) | 'code' | 'open'   the most open mode any event may use (settings.manage)
--     events.contact_rsvp                  'off' (default) | 'code' | 'open'   per event (events.manage or the event's lead), never above the
--                                                                              community's, and only for a free, public, non-confidential event
--   'open' = the masked family shows straight after typing (the owner's request). 'code' = the same screens after a 6-digit code (the
--   next migration set builds it; until then a 'code' event answers `unavailable`).
--
--   NEW OBJECTS
--     app.mask_name / mask_email / mask_phone          pure masks (docs/RSVP_WITHOUT_LOGIN.md section 4); src/lib/mask.ts is the TypeScript twin
--     app.rsvp_contact_lookup(event, contact)          anon-callable: the masked family + an opaque handle (30 minutes, one use)
--     app.rsvp_contact_undo(handle)                    anon-callable: take the RSVP back within 15 minutes
--     app.rsvp_contact_view(token) / _cancel(token)    anon-callable: the emailed link (or, for 30 minutes after saving, the handle) shows the
--                                                      RSVP; the emailed link cancels it
--     app.rsvp_contact_verify_staff(rsvp, reason)      staff: mark an RSVP made this way as checked with the family
--     (app.rsvp_contact_submit is in 0823, with the confirmation email.)
--     app.rsvp_contact_handles / rsvp_manage_links / rsvp_contact_attempts     locked tables (RLS on, no policy, no grant to anon or signed-in)
--     app.rsvps.source gains 'guest_contact'; rsvps gains contact_kind, contact_person_id, contact_verified_at.
--       UNVERIFIED = source 'guest_contact' and contact_verified_at is null.
--     events.contact_rsvp + the trigger that keeps it inside the rules above.
--
--   THE DESIGN RULES (each is tested in supabase/tests/822_rsvp_contact_test.sql)
--     * Every anonymous function is security definer with search_path = app, public, extensions, execute revoked from public and granted
--       explicitly. They answer {ok:true, ...} or {ok:false, code, message}; only real faults raise.
--     * A handle is 24 random bytes; only its SHA-256 is stored. The visitor gets the handle and "slots" (1, 2, 3): the people behind the
--       slots stay in the database. No person, household, RSVP or attendee id leaves.
--     * A phone number or email is never stored and never logged: counters and handles hold only a keyed hash (HMAC-SHA256 with a pepper
--       kept in the Vault; a plain SHA-256 of a phone number can be reversed by trying every number).
--     * Only an adult's contact opens a family (app.person_is_minor); a contact on two households opens neither (`ambiguous`).
--     * No money, no free text, no pledge.
--
--   ACCESS CHANGE (the owner approved the plan; the owner approves this pull request again before it merges): people without a session
--   can now cause writes to rsvps and attendees (0823) and read a masked view of people and households, only through these functions.
--   No existing RLS policy or grant is loosened.
--
-- ROLLBACK: see the pull request description (one paste).
set client_min_messages = warning;

-- ══ 1. The masks ═════════════════════════════════════════════════════════════
-- The characters that join the letter before them into ONE visible unit: accents, and the vowel signs and viramas of the Indic
-- scripts, Hebrew and Arabic points, Thai marks, variation selectors. A letter is never split from its mark.
create or replace function app._mask_marks() returns text
language sql immutable set search_path = app, public, extensions as $$
  select string_agg(case when r.lo = r.hi then chr(r.lo) else chr(r.lo) || '-' || chr(r.hi) end, '' order by r.lo)
    from (values
    (x'0300'::int, x'036f'::int), (x'0483'::int, x'0489'::int), (x'0591'::int, x'05bd'::int), (x'05bf'::int, x'05bf'::int), (x'05c1'::int, x'05c2'::int),
    (x'05c4'::int, x'05c5'::int), (x'05c7'::int, x'05c7'::int), (x'0610'::int, x'061a'::int), (x'064b'::int, x'065f'::int), (x'0670'::int, x'0670'::int),
    (x'06d6'::int, x'06dc'::int), (x'06df'::int, x'06e4'::int), (x'06e7'::int, x'06e8'::int), (x'06ea'::int, x'06ed'::int), (x'0900'::int, x'0903'::int),
    (x'093a'::int, x'093c'::int), (x'093e'::int, x'094f'::int), (x'0951'::int, x'0957'::int), (x'0962'::int, x'0963'::int), (x'0981'::int, x'0983'::int),
    (x'09bc'::int, x'09bc'::int), (x'09be'::int, x'09cd'::int), (x'09d7'::int, x'09d7'::int), (x'09e2'::int, x'09e3'::int), (x'0a01'::int, x'0a03'::int),
    (x'0a3c'::int, x'0a3c'::int), (x'0a3e'::int, x'0a4d'::int), (x'0a51'::int, x'0a51'::int), (x'0a70'::int, x'0a71'::int), (x'0a75'::int, x'0a75'::int),
    (x'0a81'::int, x'0a83'::int), (x'0abc'::int, x'0abc'::int), (x'0abe'::int, x'0acd'::int), (x'0ae2'::int, x'0ae3'::int), (x'0b01'::int, x'0b03'::int),
    (x'0b3c'::int, x'0b3c'::int), (x'0b3e'::int, x'0b57'::int), (x'0b62'::int, x'0b63'::int), (x'0b82'::int, x'0b82'::int), (x'0bbe'::int, x'0bcd'::int),
    (x'0bd7'::int, x'0bd7'::int), (x'0c00'::int, x'0c04'::int), (x'0c3e'::int, x'0c56'::int), (x'0c62'::int, x'0c63'::int), (x'0c81'::int, x'0c83'::int),
    (x'0cbc'::int, x'0cbc'::int), (x'0cbe'::int, x'0cd6'::int), (x'0ce2'::int, x'0ce3'::int), (x'0d00'::int, x'0d03'::int), (x'0d3b'::int, x'0d3c'::int),
    (x'0d3e'::int, x'0d4d'::int), (x'0d57'::int, x'0d57'::int), (x'0d62'::int, x'0d63'::int), (x'0d81'::int, x'0d83'::int), (x'0dca'::int, x'0ddf'::int),
    (x'0e31'::int, x'0e31'::int), (x'0e34'::int, x'0e3a'::int), (x'0e47'::int, x'0e4e'::int), (x'0eb1'::int, x'0eb1'::int), (x'0eb4'::int, x'0ebc'::int),
    (x'0ec8'::int, x'0ecd'::int), (x'1ab0'::int, x'1aff'::int), (x'1dc0'::int, x'1dff'::int), (x'200c'::int, x'200d'::int), (x'20d0'::int, x'20ff'::int),
    (x'fe00'::int, x'fe0f'::int), (x'fe20'::int, x'fe2f'::int)
  ) as r(lo, hi)
$$;

-- One word. n units: 1 shows *, 2 or 3 show the first unit and stars, 4 or more show the first and the last unit and stars between.
-- The visible units never exceed floor(n/2), so at least half of every word is hidden.
create or replace function app._mask_word(p_word text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare m text := app._mask_marks(); u text[]; n int;
begin
  select coalesce(array_agg(t.x[1] order by t.ord), '{}') into u
    from regexp_matches(p_word, '[^' || m || '][' || m || ']*|[' || m || ']+', 'g') with ordinality as t(x, ord);
  n := coalesce(array_length(u, 1), 0);
  return case when n = 0 then ''
              when n = 1 then '*'
              when n <= 3 then u[1] || repeat('*', n - 1)
              else u[1] || repeat('*', n - 2) || u[n] end;
end $$;

-- A name: every word masked, the separators (space, hyphen, apostrophe, period, comma) kept and not counted.
create or replace function app.mask_name(p_name text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text := normalize(coalesce(p_name, ''), nfc); m text[]; r text := '';
begin
  for m in select regexp_matches(v, '([^\s''’.,-]+)|([\s''’.,-]+)', 'g') loop
    r := r || case when m[1] is not null then app._mask_word(m[1]) else m[2] end;
  end loop;
  return r;
end $$;

-- An email: the first character of the local part then ***; every label of the domain except the last: its first character then ***;
-- the last label (.com) stays. A fixed *** does not reveal the length. Null when it is not an email.
create or replace function app.mask_email(p_email text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare v text := lower(btrim(coalesce(p_email, ''))); m text := app._mask_marks();
        v_local text; v_domain text; v_first text; v_labels text[]; v_out text; i int;
begin
  if v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return null; end if;
  v_local := substring(v from '^(.*)@[^@]*$');
  v_domain := substring(v from '@([^@]*)$');
  v_first := substring(v_local from ('^[^' || m || '][' || m || ']*'));
  v_out := case when char_length(v_local) >= 2 and v_first is not null then v_first else '' end || '***@';
  v_labels := string_to_array(v_domain, '.');
  for i in 1 .. array_length(v_labels, 1) loop
    v_out := v_out || case when i = array_length(v_labels, 1) then v_labels[i]
                           when char_length(v_labels[i]) >= 2 then left(v_labels[i], 1) || '***'
                           else '***' end
                   || case when i < array_length(v_labels, 1) then '.' else '' end;
  end loop;
  return v_out;
end $$;

-- A phone: +1 and the last 2 digits for a US / Canada number, otherwise + and the last 2 digits. Null when there are fewer than 7 digits.
create or replace function app.mask_phone(p_phone text) returns text
language plpgsql immutable set search_path = app, public, extensions as $$
declare d text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(d) < 7 then return null; end if;
  if length(d) = 10 or (length(d) = 11 and left(d, 1) = '1') then return '+1 *** *** **' || right(d, 2); end if;
  return '+' || repeat('*', length(d) - 2) || right(d, 2);
end $$;

-- ══ 2. The switches ══════════════════════════════════════════════════════════
alter table app.events add column if not exists contact_rsvp text not null default 'off';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_contact_rsvp_check') then
    alter table app.events add constraint events_contact_rsvp_check check (contact_rsvp in ('off', 'code', 'open'));
  end if;
end $$;
comment on column app.events.contact_rsvp is
  'RSVP without signing in (0822): off (default), code (after a 6-digit code to the phone or email) or open (the masked family shows straight after typing). Never above the community''s rules.rsvp.contact_lookup; only on a free, non-confidential event whose audience is public or members_and_guests. A trigger keeps it so.';

create or replace function app._rsvp_contact_rank(p_mode text) returns integer
language sql immutable set search_path = app, public, extensions as $$
  select case p_mode when 'open' then 2 when 'code' then 1 else 0 end
$$;

-- The most open mode the community allows (anything but 'code' or 'open' reads as off).
create or replace function app._rsvp_contact_master(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case coalesce((select c.rules #>> '{rsvp,contact_lookup}' from app.centers c where c.id = p_center), 'off')
              when 'open' then 'open' when 'code' then 'code' else 'off' end
$$;

-- The mode an event really has: its own, but never above the community's.
create or replace function app._rsvp_contact_mode(p_event_mode text, p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select case when p_event_mode not in ('code', 'open') then 'off'
              when app._rsvp_contact_rank(p_event_mode) <= app._rsvp_contact_rank(app._rsvp_contact_master(p_center)) then p_event_mode
              else app._rsvp_contact_master(p_center) end
$$;

-- Setting the switch needs the community's say-so and an event that qualifies (plain sentences). If something else about the event
-- changes later so that it no longer qualifies (it becomes paid, confidential or members-only), the switch quietly goes back to off.
create or replace function app.events_contact_rsvp_guard() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_master text;
begin
  if new.contact_rsvp = 'off' then return new; end if;
  if tg_op = 'UPDATE' and new.contact_rsvp is not distinct from old.contact_rsvp then
    if new.is_paid or new.confidential or new.audience not in ('public', 'members_and_guests') then new.contact_rsvp := 'off'; end if;
    return new;
  end if;
  v_master := app._rsvp_contact_master(new.center_id);
  if app._rsvp_contact_rank(new.contact_rsvp) > app._rsvp_contact_rank(v_master) then
    raise exception using errcode = 'check_violation',
      message = case when v_master = 'off'
                     then 'RSVP without signing in is switched off for this community. An administrator can allow it in Settings › Rules.'
                     else 'This community allows RSVP without signing in only with a code. Choose "with a code", or ask an administrator to allow more in Settings › Rules.' end;
  end if;
  if new.is_paid then
    raise exception using errcode = 'check_violation', message = 'RSVP without signing in is for free events only. Turn it off for a paid event.';
  end if;
  if new.confidential then
    raise exception using errcode = 'check_violation', message = 'RSVP without signing in is not available for a confidential event.';
  end if;
  if new.audience not in ('public', 'members_and_guests') then
    raise exception using errcode = 'check_violation',
      message = 'RSVP without signing in is only for events open to the public, or to members and guests.';
  end if;
  return new;
end $$;
drop trigger if exists events_contact_rsvp_guard on app.events;
create trigger events_contact_rsvp_guard before insert or update of contact_rsvp, is_paid, confidential, audience on app.events
  for each row execute function app.events_contact_rsvp_guard();

-- ══ 3. The columns an RSVP made this way carries ═════════════════════════════
do $$
declare c record;
begin
  for c in select con.conname from pg_constraint con
            where con.conrelid = 'app.rsvps'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%guest_web%' loop
    execute format('alter table app.rsvps drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'rsvps_source_check') then
    alter table app.rsvps add constraint rsvps_source_check
      check (source in ('app', 'guest_web', 'admin', 'walk_in', 'kiosk', 'import', 'guest_contact'));
  end if;
end $$;
alter table app.rsvps add column if not exists contact_kind text;
alter table app.rsvps add column if not exists contact_person_id uuid references app.people(id) on delete set null;
alter table app.rsvps add column if not exists contact_verified_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rsvps_contact_kind_check') then
    alter table app.rsvps add constraint rsvps_contact_kind_check check (contact_kind is null or contact_kind in ('phone', 'email'));
  end if;
end $$;
comment on column app.rsvps.contact_kind is 'RSVP without signing in (0822): what the visitor typed to find the family, phone or email (never the value).';
comment on column app.rsvps.contact_person_id is 'RSVP without signing in (0822): the adult whose phone or email matched. Staff only; no phone or email is stored here.';
comment on column app.rsvps.contact_verified_at is 'RSVP without signing in (0822): when the contact was proved (the code, the emailed link opened, or staff). Null on source guest_contact = UNVERIFIED.';
create index if not exists rsvps_unverified_contact_idx on app.rsvps (event_id) where source = 'guest_contact' and contact_verified_at is null;

-- ══ 4. The locked tables ═════════════════════════════════════════════════════
-- Counters for the limits: a keyed hash of the connection / contact / address, or the event id, and a time.
create table if not exists app.rsvp_contact_attempts (
  id      uuid primary key default gen_random_uuid(),
  kind    text not null check (kind ~ '^[a-z_.]+$'),
  subject text not null,
  at      timestamptz not null default now()
);
create index if not exists rsvp_contact_attempts_idx on app.rsvp_contact_attempts (kind, subject, at desc);
create index if not exists rsvp_contact_attempts_at_idx on app.rsvp_contact_attempts (at);
comment on table app.rsvp_contact_attempts is
  'Counters for RSVP without signing in (0822): kind, a keyed hash (never a phone, email or address) or an event id, and the time. Written and read only by the anonymous RSVP functions; purged after two days. Not audited on purpose: high-volume anonymous traffic with nothing a person could be named by (test 13, test 822).';

-- What a lookup hands the visitor a reference to: the household and the ordered people behind the slots. Only the SHA-256 of the handle.
create table if not exists app.rsvp_contact_handles (
  id                uuid primary key default gen_random_uuid(),
  center_id         uuid not null references app.centers(id) on delete cascade,
  event_id          uuid not null references app.events(id) on delete cascade,
  household_id      uuid not null references app.households(id) on delete cascade,
  matched_person_id uuid not null references app.people(id) on delete cascade,
  mode              text not null check (mode in ('code', 'open')),
  members           jsonb not null,
  contact_kind      text not null check (contact_kind in ('phone', 'email')),
  contact_hash      text not null,
  ip_hash           text not null,
  handle_hash       text not null unique,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  used_at           timestamptz,
  rsvp_id           uuid references app.rsvps(id) on delete set null,
  undo_until        timestamptz
);
create index if not exists rsvp_contact_handles_expires_idx on app.rsvp_contact_handles (expires_at);
comment on table app.rsvp_contact_handles is
  'RSVP without signing in (0822): one row per lookup that found a family. Only the SHA-256 of the handle, the household and the ordered people behind the slots; the contact is a keyed hash. 30 minutes, one use; purged a week after it ends. Not audited on purpose (anonymous traffic; the RSVP it leads to is).';

-- The emailed link: one per RSVP made this way. Only the SHA-256 of the token.
create table if not exists app.rsvp_manage_links (
  rsvp_id        uuid primary key references app.rsvps(id) on delete cascade,
  center_id      uuid not null references app.centers(id) on delete cascade,
  token_hash     text not null unique,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  last_opened_at timestamptz,
  revoked_at     timestamptz
);
comment on table app.rsvp_manage_links is
  'RSVP without signing in (0822): the emailed link that shows and cancels one RSVP. Only the SHA-256 of the token; it ends two days after the event.';

do $$
declare t text;
begin
  foreach t in array array['rsvp_contact_attempts', 'rsvp_contact_handles', 'rsvp_manage_links'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format('revoke all on app.%I from public, anon, authenticated', t);
    execute format('grant all on app.%I to service_role', t);
  end loop;
end $$;
drop trigger if exists audit_rsvp_manage_links on app.rsvp_manage_links;
create trigger audit_rsvp_manage_links after insert or update or delete on app.rsvp_manage_links
  for each row execute function app.audit_row('rsvp_id');
insert into app.module_tables (table_name, module_key)
values ('rsvp_contact_attempts', null), ('rsvp_contact_handles', null), ('rsvp_manage_links', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ══ 5. Limits, hashes and small helpers ══════════════════════════════════════
-- Every number in one place (the way app.demo_signin_limits is). The owner approved these starting numbers on 2026-10-15.
create or replace function app.rsvp_contact_limits() returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'lookup_ip_hour', 10,            -- lookups an hour from one connection (a miss counts miss_weight)
    'miss_weight', 2,
    'lookup_contact_hour', 3,        -- lookups an hour for one phone number or email
    'lookup_event_hour', 300,        -- lookups an hour for one event
    'lookup_all_hour', 2000,         -- lookups an hour in all
    'submit_ip_hour', 5,             -- saves an hour from one connection
    'submit_all_hour', 500,          -- saves an hour in all (so a flood from many addresses cannot grow the counters without end)
    'token_ip_hour', 60,             -- views, cancels and undos an hour from one connection
    'token_all_hour', 3000,          -- views, cancels and undos an hour in all
    'verify_all_hour', 3000,         -- design B: code tries an hour in all
    'confirm_address_day', 3,        -- confirmation emails a day to one address
    'code_contact_hour', 3,          -- design B: codes an hour to one contact
    'code_ip_hour', 10,              -- design B: code requests an hour from one connection
    'code_wrong_max', 5,             -- design B: wrong codes before the contact is locked
    'lock_minutes', 15,
    'code_minutes', 10,
    'sms_center_day', 200,           -- design B: code texts a day for one community
    'handle_minutes', 30,
    'undo_minutes', 15,
    'unverified_percent', 25,        -- unverified seats may be at most this share of the capacity
    'unverified_seats_no_capacity', 40,
    'purge_days', 7)
$$;

-- The connection, as text; an IPv6 visitor is counted by their /64.
-- Behind Cloudflare the platform overwrites `cf-connecting-ip` with the real address, which a caller cannot forge; so it comes first. Without it, the
-- first address of x-forwarded-for as the audit log reads it (a caller who sends their own can change that one, which is why the limits that
-- do not depend on the address -- per contact, per event, in all -- are the ones that hold).
create or replace function app._rsvp_contact_ip() returns text
language plpgsql volatile set search_path = app, public, extensions as $$
declare v inet; h jsonb; cf text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
    cf := nullif(btrim(h ->> 'cf-connecting-ip'), '');
    if cf is not null then v := cf::inet; end if;
  exception when others then
    v := null;
  end;
  v := coalesce(v, app.caller_ip(null));
  if v is null then return 'unknown'; end if;
  return case when family(v) = 6 then host(network(set_masklen(v, 64))) else host(v) end;
end $$;

-- The pepper for the keyed hashes: a random value made on first use and kept in the Vault.
create or replace function app._rsvp_contact_pepper() returns text
language plpgsql volatile security definer set search_path = app, public, extensions as $$
declare v text;
begin
  select s.decrypted_secret into v from vault.decrypted_secrets s where s.name = 'connect/rsvp_contact/pepper';
  if v is null then
    begin
      perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'connect/rsvp_contact/pepper',
                                  'Keyed hash for the RSVP-without-signing-in counters and handles (never shown)');
    exception when unique_violation then null;
    end;
    select s.decrypted_secret into v from vault.decrypted_secrets s where s.name = 'connect/rsvp_contact/pepper';
  end if;
  return v;
end $$;

create or replace function app._rsvp_contact_hash(p_pepper text, p_value text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select encode(hmac(coalesce(p_value, ''), coalesce(p_pepper, ''), 'sha256'), 'hex')
$$;

create or replace function app._rsvp_contact_hit(p_kind text, p_subject text, p_times integer default 1) returns void
language sql volatile security definer set search_path = app, public, extensions as $$
  insert into app.rsvp_contact_attempts (kind, subject) select p_kind, p_subject from generate_series(1, greatest(coalesce(p_times, 1), 1))
$$;

create or replace function app._rsvp_contact_over(p_kind text, p_subject text, p_window interval, p_max integer) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select count(*) >= p_max from app.rsvp_contact_attempts where kind = p_kind and subject = p_subject and at > now() - p_window
$$;

-- Old counters and finished handles go (a little at a time, by whoever comes next).
create or replace function app._rsvp_contact_cleanup() returns void
language plpgsql volatile security definer set search_path = app, public, extensions as $$
begin
  delete from app.rsvp_contact_attempts where id in (select a.id from app.rsvp_contact_attempts a where a.at < now() - interval '2 days' limit 200);
  delete from app.rsvp_contact_handles
   where id in (select h.id from app.rsvp_contact_handles h
                 where h.expires_at < now() - make_interval(days => (app.rsvp_contact_limits() ->> 'purge_days')::int) limit 100);
end $$;

-- The plain-English answer for every code the functions can give. The app maps the code to its own words in each language.
create or replace function app._rsvp_contact_fail(p_code text) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', case p_code
    when 'bad_contact'    then 'That does not look like a mobile number or an email address. Check it and try again.'
    when 'not_found'      then 'We could not find a family record with that number or email. Check it, try the other one, or sign in. If your family is new here, join first.'
    when 'ambiguous'      then 'That number or email is on more than one family record, so we cannot tell which is yours. Try another one, sign in, or ask the office.'
    when 'already_rsvpd'  then 'Your family already has an RSVP for this event. To change it, use the link in your confirmation email, or sign in.'
    when 'no_email'       then 'We found your family, but we have no email address on file to send the confirmation to, so we could not register you. Please sign in or call the office.'
    when 'cannot_send'    then 'We could not send a confirmation to the email we have on file, so we did not save your RSVP. Please sign in or call the office.'
    when 'full'           then 'This event is full.'
    when 'quota'          then 'The places for RSVP without signing in are all taken. Please sign in to RSVP.'
    when 'closed'         then 'RSVPs for this event are closed, or have not opened yet.'
    when 'demo'           then 'This is a demo. RSVPs are not saved and nothing is sent.'
    when 'unavailable'    then 'RSVP without signing in is not available for this event. Please sign in to RSVP.'
    when 'rate_limited'   then 'Too many tries from this phone. Please wait a few minutes, or sign in.'
    when 'expired'        then 'This page timed out. Start again.'
    when 'used'           then 'This RSVP was already saved.'
    when 'bad_selection'  then 'Choose at least one person who is coming.'
    when 'too_late'       then 'This RSVP can no longer be changed here because someone has already arrived. Please speak to the event team.'
    else 'Something went wrong. Please try again.' end)
$$;

-- Seats taken on an event (people on RSVPs that are not cancelled or waitlisted); p_unverified counts only unverified contact RSVPs.
create or replace function app._rsvp_contact_seats(p_event uuid, p_unverified boolean default false) returns integer
language sql stable security definer set search_path = app, public, extensions as $$
  select count(*)::int
    from app.attendees x join app.rsvps r on r.id = x.rsvp_id
   where r.event_id = p_event and r.status not in ('cancelled', 'waitlisted') and x.status <> 'cancelled'
     and (not p_unverified or (r.source = 'guest_contact' and r.contact_verified_at is null))
$$;

-- May a guest RSVP to this event now, and in which mode? o_code is null when yes; otherwise the code to answer with.
create or replace function app._rsvp_contact_gate(e app.events, out o_code text, out o_mode text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  o_code := null; o_mode := 'off';
  if e.id is null or not app.community_open(e.center_id) then o_code := 'unavailable'; return; end if;
  if app.is_demo_center(e.center_id) then o_code := 'demo'; return; end if;
  if not app.module_enabled(e.center_id, 'events') then o_code := 'unavailable'; return; end if;
  o_mode := app._rsvp_contact_mode(e.contact_rsvp, e.center_id);
  if o_mode = 'off' or e.is_paid or e.confidential or e.audience not in ('public', 'members_and_guests') then
    o_code := 'unavailable'; o_mode := 'off'; return;
  end if;
  if e.status not in ('published', 'live') then
    o_code := case when e.status in ('rsvp_closed', 'completed') then 'closed' else 'unavailable' end; return;
  end if;
  if (e.rsvp_opens_at is not null and now() < e.rsvp_opens_at) or (e.rsvp_closes_at is not null and now() > e.rsvp_closes_at)
     or coalesce(e.ends_at, e.starts_at + interval '6 hours') < now() then
    o_code := 'closed';
  end if;
end $$;

-- ══ 6. Finding the family ════════════════════════════════════════════════════
-- The households of the ADULTS whose phone or email is this one: not a child (app.person_is_minor), not deceased, not merged, a
-- current member of a household that is not merged. person_id = the adult it matched.
create or replace function app._rsvp_contact_find(p_center uuid, p_kind text, p_norm text)
returns table (household_id uuid, person_id uuid)
language sql stable security definer set search_path = app, public, extensions as $$
  select distinct on (hm.household_id) hm.household_id, p.id
    from app.people p
    join app.household_members hm on hm.person_id = p.id and hm.left_at is null
    join app.households h on h.id = hm.household_id and h.merged_into_id is null and h.center_id = p_center
   where p.center_id = p_center and p.merged_into_id is null and not p.is_deceased
     and not app.person_is_minor(p.id)
     and ((p_kind = 'email' and (p.email = p_norm::citext
                                 or exists (select 1 from app.person_emails pe where pe.person_id = p.id and pe.email = p_norm::citext)))
          or (p_kind = 'phone' and regexp_replace(coalesce(p.phone_e164, ''), '\D', '', 'g')
                                   in (ltrim(p_norm, '+'), case when p_norm ~ '^\+1\d{10}$' then right(p_norm, 10) end)))
   order by hm.household_id, hm.is_primary desc, p.id
$$;

-- The household as the visitor may see it, in order: the adults (the primary first), then the children (the oldest first).
-- label = the masked name, or "Child 1", "Child 2" (no letters of a child's name, no age). The flags are worked out from the
-- date of birth on the event's day, the way the app does.
create or replace function app._rsvp_contact_family(p_household uuid, p_event_date date)
returns table (person_id uuid, kind text, label text, under_12 boolean, senior boolean, ord integer)
language sql stable security definer set search_path = app, public, extensions as $$
  with m as (
    select p.id, p.first_name, p.preferred_name, p.last_name, p.date_of_birth, hm.is_primary, app.person_is_minor(p.id) as minor
      from app.household_members hm join app.people p on p.id = hm.person_id
     where hm.household_id = p_household and hm.left_at is null and not p.is_deceased and p.merged_into_id is null
  ), a as (
    select m.*, row_number() over (order by m.is_primary desc, m.date_of_birth asc nulls last, m.id) as n from m where not m.minor
  ), c as (
    select m.*, row_number() over (order by m.date_of_birth asc nulls last, m.id) as n from m where m.minor
  )
  select a.id, 'adult'::text,
         btrim(app.mask_name(coalesce(nullif(btrim(a.preferred_name), ''), a.first_name)) || ' ' || app.mask_name(a.last_name)),
         false,
         coalesce(a.date_of_birth is not null and a.date_of_birth <= p_event_date - interval '65 years', false),
         a.n::int
    from a
  union all
  select c.id, 'child'::text, 'Child ' || c.n,
         coalesce(c.date_of_birth is not null and c.date_of_birth > p_event_date - interval '12 years', false),
         false,
         (100 + c.n)::int
    from c
  order by 6
$$;

-- Where the confirmation goes: the matched adult's email on file, else another adult of the household (the primary first). Never an address
-- the visitor typed. phone = the same person's phone on file, else the matched adult's, else another adult's.
create or replace function app._rsvp_contact_recipient(p_household uuid, p_person uuid)
returns table (person_id uuid, email text, phone text)
language sql stable security definer set search_path = app, public, extensions as $$
  with cand as (
    select p.id, nullif(btrim(p.phone_e164), '') as phone,
           btrim(coalesce(nullif(btrim(p.email::text), ''),
                          (select pe.email::text from app.person_emails pe where pe.person_id = p.id order by pe.verified desc, pe.created_at, pe.id limit 1))) as addr,
           case when p.id = p_person then 0 else 1 end as o1, hm.is_primary
      from app.household_members hm join app.people p on p.id = hm.person_id
     where hm.household_id = p_household and hm.left_at is null and not p.is_deceased and p.merged_into_id is null
       and not app.person_is_minor(p.id)
  )
  select w.id, lower(w.addr),
         coalesce(w.phone,
                  (select c2.phone from cand c2 where c2.id = p_person),
                  (select c3.phone from cand c3 where c3.phone is not null order by c3.o1, c3.is_primary desc, c3.id limit 1))
    from cand w
   where w.addr ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
   order by w.o1, w.is_primary desc, w.id
   limit 1
$$;

-- Would the confirmation to this address be refused? null = no; otherwise a short reason (never shown to the visitor, never logged with the address).
-- It repeats what app.enqueue_notice checks, so the visitor is told before they tick anything.
create or replace function app._rsvp_contact_email_problem(p_center uuid, p_person uuid, p_email text, p_pepper text) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_to text := app.normalize_recipient('email', p_email); v_opt boolean;
begin
  if v_to is null or v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'address'; end if;
  if (app.message_suppression_for(p_center, 'email', v_to)).id is not null then return 'suppressed'; end if;
  if (app.message_newsletter_suppression_for(p_center, 'email', v_to)).id is not null then return 'unsubscribed'; end if;
  select not o.opted_in into v_opt from app.channel_optins o
   where o.center_id = p_center and o.channel = 'email'::app.channel and lower(btrim(o.address)) = v_to
   order by o.recorded_at desc limit 1;
  if coalesce(v_opt, false) then return 'opted_out'; end if;
  if app.message_recipient_deceased(p_center, 'email', v_to, p_person) is not null then return 'deceased'; end if;
  if not app._notice_topic_on(p_person, 'events', 'email') then return 'topic_off'; end if;
  if not app.messaging_recipient_ok(p_center, 'email', v_to, 'notification') then return 'sandbox'; end if;
  if app._rsvp_contact_over('confirm.address', app._rsvp_contact_hash(p_pepper, v_to), interval '1 day',
                            (app.rsvp_contact_limits() ->> 'confirm_address_day')::int) then
    return 'address_limit';
  end if;
  return null;
end $$;

-- ══ 7. The lookup ════════════════════════════════════════════════════════════
create or replace function app.rsvp_contact_lookup(p_event uuid, p_contact text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_lim jsonb := app.rsvp_contact_limits();
  v_pepper text := app._rsvp_contact_pepper();
  v_ip_h text; v_contact_h text; v_event_h text;
  v_raw text := btrim(coalesce(p_contact, ''));
  v_kind text; v_norm text;
  e app.events; v_gcode text; v_gmode text; v_tz text; v_date date;
  v_hh uuid[]; v_per uuid[]; v_n int; v_hid uuid; v_pid uuid;
  v_rperson uuid; v_remail text; v_rphone text;
  v_handle text; v_members jsonb; v_list jsonb;
begin
  v_ip_h := app._rsvp_contact_hash(v_pepper, app._rsvp_contact_ip());
  v_event_h := coalesce(p_event::text, 'none');
  -- This connection, then the event, then everyone: before any look at the contact.
  if app._rsvp_contact_over('lookup.ip', v_ip_h, interval '1 hour', (v_lim ->> 'lookup_ip_hour')::int)
     or app._rsvp_contact_over('lookup.event', v_event_h, interval '1 hour', (v_lim ->> 'lookup_event_hour')::int)
     or app._rsvp_contact_over('lookup.all', 'all', interval '1 hour', (v_lim ->> 'lookup_all_hour')::int) then
    return app._rsvp_contact_fail('rate_limited');
  end if;
  perform app._rsvp_contact_hit('lookup.ip', v_ip_h);
  perform app._rsvp_contact_hit('lookup.event', v_event_h);
  perform app._rsvp_contact_hit('lookup.all', 'all');
  perform app._rsvp_contact_cleanup();

  select * into e from app.events where id = p_event;
  select g.o_code, g.o_mode into v_gcode, v_gmode from app._rsvp_contact_gate(e) g;
  if v_gcode is not null then return app._rsvp_contact_fail(v_gcode); end if;
  -- 'code' events are built in the next migration set; until then they answer like an event with the switch off.
  if v_gmode <> 'open' then return app._rsvp_contact_fail('unavailable'); end if;

  -- The contact: a phone or an email, in one normal form. Never stored, never logged.
  if length(v_raw) < 5 or length(v_raw) > 200 then return app._rsvp_contact_fail('bad_contact'); end if;
  if position('@' in v_raw) > 0 then
    v_kind := 'email'; v_norm := lower(v_raw);
    if v_norm !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return app._rsvp_contact_fail('bad_contact'); end if;
  else
    v_kind := 'phone'; v_norm := app.normalize_recipient('sms', v_raw);
    if v_norm is null or v_norm !~ '^\+[1-9]\d{7,14}$' then return app._rsvp_contact_fail('bad_contact'); end if;
  end if;
  v_contact_h := app._rsvp_contact_hash(v_pepper, v_kind || ':' || v_norm);
  if app._rsvp_contact_over('lookup.contact', v_contact_h, interval '1 hour', (v_lim ->> 'lookup_contact_hour')::int) then
    return app._rsvp_contact_fail('rate_limited');
  end if;
  perform app._rsvp_contact_hit('lookup.contact', v_contact_h);

  -- Room left? (Said before the family is looked for, so it tells nothing about who is a member.)
  if e.capacity is not null and app._rsvp_contact_seats(e.id) >= e.capacity then return app._rsvp_contact_fail('full'); end if;

  select array_agg(f.household_id), array_agg(f.person_id) into v_hh, v_per from app._rsvp_contact_find(e.center_id, v_kind, v_norm) f;
  v_n := coalesce(array_length(v_hh, 1), 0);
  if v_n = 0 then
    -- A miss costs more of this connection's tries, which slows a walk through phone numbers.
    perform app._rsvp_contact_hit('lookup.ip', v_ip_h, (v_lim ->> 'miss_weight')::int - 1);
    return app._rsvp_contact_fail('not_found');
  end if;
  if v_n > 1 then return app._rsvp_contact_fail('ambiguous'); end if;
  v_hid := v_hh[1]; v_pid := v_per[1];

  if exists (select 1 from app.rsvps r where r.event_id = e.id and r.household_id = v_hid and r.status <> 'cancelled') then
    return app._rsvp_contact_fail('already_rsvpd');
  end if;

  select rp.person_id, rp.email, rp.phone into v_rperson, v_remail, v_rphone from app._rsvp_contact_recipient(v_hid, v_pid) rp;
  if v_remail is null then return app._rsvp_contact_fail('no_email'); end if;
  if app._rsvp_contact_email_problem(e.center_id, v_rperson, v_remail, v_pepper) is not null then
    return app._rsvp_contact_fail('cannot_send');
  end if;

  v_tz := (select c.time_zone from app.centers c where c.id = e.center_id);
  v_date := (coalesce(e.starts_at, now()) at time zone coalesce(v_tz, 'UTC'))::date;
  select jsonb_agg(to_jsonb(f.person_id) order by f.rn),
         jsonb_agg(jsonb_build_object('slot', f.rn, 'label', f.label, 'kind', f.kind, 'under_12', f.under_12) order by f.rn)
    into v_members, v_list
    from (select x.*, row_number() over (order by x.ord) as rn from app._rsvp_contact_family(v_hid, v_date) x) f
   where f.rn <= 24;
  if v_members is null then return app._rsvp_contact_fail('not_found'); end if;

  v_handle := translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_');
  insert into app.rsvp_contact_handles (center_id, event_id, household_id, matched_person_id, mode, members, contact_kind,
                                        contact_hash, ip_hash, handle_hash, expires_at)
  values (e.center_id, e.id, v_hid, v_pid, 'open', v_members, v_kind, v_contact_h, v_ip_h,
          encode(digest(v_handle, 'sha256'), 'hex'), now() + make_interval(mins => (v_lim ->> 'handle_minutes')::int));

  return jsonb_build_object('ok', true, 'step', 'choose', 'handle', v_handle,
                            'expires_in', (v_lim ->> 'handle_minutes')::int * 60,
                            'members', v_list,
                            'send_to', jsonb_build_object('email', app.mask_email(v_remail), 'phone', app.mask_phone(v_rphone)));
end $$;

-- ══ 8. Taking an RSVP back, seeing it, cancelling it ═════════════════════════
-- Cancels one RSVP made without signing in: the RSVP, its people and tickets, and the confirmation if it has not gone yet.
-- 'cancelled', 'too_late' (someone already arrived), or 'gone'.
create or replace function app._rsvp_contact_cancel_rsvp(p_rsvp uuid, p_why text) returns text
language plpgsql volatile security definer set search_path = app, public, extensions as $$
declare r app.rsvps;
begin
  select * into r from app.rsvps where id = p_rsvp for update;
  if r.id is null or r.source <> 'guest_contact' then return 'gone'; end if;
  if r.status = 'cancelled' then return 'cancelled'; end if;
  if r.status in ('attended', 'no_show') or exists (select 1 from app.attendees a where a.rsvp_id = r.id and a.checked_in_at is not null) then
    return 'too_late';
  end if;
  perform app.set_audit_context(p_why);
  update app.rsvps set status = 'cancelled', cancelled_at = now() where id = r.id;
  update app.attendees set status = 'cancelled', ticket_revoked = true where rsvp_id = r.id and checked_in_at is null;
  update app.messages set status = 'cancelled', failure_reason = 'Not sent: the RSVP was cancelled before it went.'
   where center_id = r.center_id and status = 'queued' and template_key = 'rsvp_contact_confirmation' and payload ->> 'rsvp_id' = r.id::text;
  return 'cancelled';
end $$;

-- Within 15 minutes of saving, with the handle the visitor still holds.
create or replace function app.rsvp_contact_undo(p_handle text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_lim jsonb := app.rsvp_contact_limits(); v_ip_h text; h app.rsvp_contact_handles; v_result text;
begin
  v_ip_h := app._rsvp_contact_hash(app._rsvp_contact_pepper(), app._rsvp_contact_ip());
  if app._rsvp_contact_over('token.ip', v_ip_h, interval '1 hour', (v_lim ->> 'token_ip_hour')::int)
     or app._rsvp_contact_over('token.all', 'all', interval '1 hour', (v_lim ->> 'token_all_hour')::int) then
    return app._rsvp_contact_fail('rate_limited');
  end if;
  perform app._rsvp_contact_hit('token.ip', v_ip_h);
  perform app._rsvp_contact_hit('token.all', 'all');
  perform app._rsvp_contact_cleanup();
  if p_handle is null or p_handle !~ '^[A-Za-z0-9_-]{32}$' then return app._rsvp_contact_fail('expired'); end if;
  select * into h from app.rsvp_contact_handles where handle_hash = encode(digest(p_handle, 'sha256'), 'hex');
  if h.id is null or h.rsvp_id is null or h.undo_until is null or h.undo_until <= now() then return app._rsvp_contact_fail('expired'); end if;
  v_result := app._rsvp_contact_cancel_rsvp(h.rsvp_id, 'RSVP taken back within minutes of saving it, by the person who made it (without signing in)');
  if v_result = 'too_late' then return app._rsvp_contact_fail('too_late'); end if;
  if v_result = 'gone' then return app._rsvp_contact_fail('expired'); end if;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;

-- The RSVP behind an emailed token, or (for the 30 minutes the handle lasts) behind the handle of the visit that made it.
-- Returns the RSVP and whether it was the emailed link.
create or replace function app._rsvp_contact_resolve(p_secret text, out o_rsvp uuid, out o_via text)
language plpgsql volatile security definer set search_path = app, public, extensions as $$
declare v_hash text; l app.rsvp_manage_links; h app.rsvp_contact_handles;
begin
  o_rsvp := null; o_via := null;
  if p_secret is null or p_secret !~ '^[A-Za-z0-9_-]{32}$' then return; end if;
  v_hash := encode(digest(p_secret, 'sha256'), 'hex');
  select * into l from app.rsvp_manage_links where token_hash = v_hash and revoked_at is null and expires_at > now();
  if l.rsvp_id is not null then o_rsvp := l.rsvp_id; o_via := 'link'; return; end if;
  select * into h from app.rsvp_contact_handles where handle_hash = v_hash and used_at is not null and rsvp_id is not null and expires_at > now();
  if h.id is not null then o_rsvp := h.rsvp_id; o_via := 'handle'; end if;
end $$;

create or replace function app.rsvp_contact_view(p_token text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_lim jsonb := app.rsvp_contact_limits(); v_ip_h text; v_rsvp uuid; v_via text;
  r app.rsvps; e app.events; v_tz text; v_date date; v_people jsonb; v_over boolean; v_can boolean;
begin
  v_ip_h := app._rsvp_contact_hash(app._rsvp_contact_pepper(), app._rsvp_contact_ip());
  if app._rsvp_contact_over('token.ip', v_ip_h, interval '1 hour', (v_lim ->> 'token_ip_hour')::int)
     or app._rsvp_contact_over('token.all', 'all', interval '1 hour', (v_lim ->> 'token_all_hour')::int) then
    return app._rsvp_contact_fail('rate_limited');
  end if;
  perform app._rsvp_contact_hit('token.ip', v_ip_h);
  perform app._rsvp_contact_hit('token.all', 'all');
  perform app._rsvp_contact_cleanup();
  select x.o_rsvp, x.o_via into v_rsvp, v_via from app._rsvp_contact_resolve(p_token) x;
  if v_rsvp is null then return app._rsvp_contact_fail('expired'); end if;
  select * into r from app.rsvps where id = v_rsvp;
  select * into e from app.events where id = r.event_id;
  if r.id is null or e.id is null or r.source <> 'guest_contact' then return app._rsvp_contact_fail('expired'); end if;
  -- Opening the emailed link proves the email: the RSVP is verified from now on.
  if v_via = 'link' then
    update app.rsvp_manage_links set last_opened_at = now() where rsvp_id = r.id;
    if r.contact_verified_at is null then update app.rsvps set contact_verified_at = now() where id = r.id; end if;
  end if;
  v_tz := (select c.time_zone from app.centers c where c.id = e.center_id);
  v_date := (coalesce(e.starts_at, now()) at time zone coalesce(v_tz, 'UTC'))::date;
  v_over := coalesce(e.ends_at, e.starts_at + interval '6 hours') < now() or e.status in ('completed', 'cancelled');
  v_can := r.status in ('rsvpd', 'confirmed') and not v_over
           and not exists (select 1 from app.attendees a where a.rsvp_id = r.id and a.checked_in_at is not null);
  select coalesce(jsonb_agg(jsonb_build_object(
           'slot', q.rn, 'label', coalesce(f.label, app.mask_name(q.display_name)), 'kind', coalesce(f.kind, 'adult'),
           'status', q.status::text, 'checked_in', q.checked_in_at is not null,
           'ticket', case when q.status <> 'cancelled' and not q.ticket_revoked then q.ticket_token end) order by q.rn), '[]'::jsonb)
    into v_people
    from (select a.*, row_number() over (order by a.created_at, a.id) as rn from app.attendees a where a.rsvp_id = r.id) q
    left join app._rsvp_contact_family(r.household_id, v_date) f on f.person_id = q.person_id;
  return jsonb_build_object('ok', true,
    'event', jsonb_build_object('name', e.name, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'venue', e.venue),
    'status', r.status::text, 'can_cancel', v_can, 'people', v_people);
end $$;

create or replace function app.rsvp_contact_cancel(p_token text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_lim jsonb := app.rsvp_contact_limits(); v_ip_h text; v_rsvp uuid; v_via text; r app.rsvps; e app.events; v_result text;
begin
  v_ip_h := app._rsvp_contact_hash(app._rsvp_contact_pepper(), app._rsvp_contact_ip());
  if app._rsvp_contact_over('token.ip', v_ip_h, interval '1 hour', (v_lim ->> 'token_ip_hour')::int)
     or app._rsvp_contact_over('token.all', 'all', interval '1 hour', (v_lim ->> 'token_all_hour')::int) then
    return app._rsvp_contact_fail('rate_limited');
  end if;
  perform app._rsvp_contact_hit('token.ip', v_ip_h);
  perform app._rsvp_contact_hit('token.all', 'all');
  perform app._rsvp_contact_cleanup();
  select x.o_rsvp, x.o_via into v_rsvp, v_via from app._rsvp_contact_resolve(p_token) x;
  -- Cancelling needs the emailed link (the handle can only undo, within 15 minutes).
  if v_rsvp is null or v_via <> 'link' then return app._rsvp_contact_fail('expired'); end if;
  select * into r from app.rsvps where id = v_rsvp;
  select * into e from app.events where id = r.event_id;
  if r.id is null or e.id is null then return app._rsvp_contact_fail('expired'); end if;
  if r.status <> 'cancelled' and (coalesce(e.ends_at, e.starts_at + interval '6 hours') < now() or e.status in ('completed', 'cancelled')) then
    return app._rsvp_contact_fail('closed');
  end if;
  v_result := app._rsvp_contact_cancel_rsvp(r.id, 'RSVP cancelled with the link in the confirmation email (made without signing in)');
  if v_result = 'too_late' then return app._rsvp_contact_fail('too_late'); end if;
  if v_result = 'gone' then return app._rsvp_contact_fail('expired'); end if;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;

-- Staff: "I checked this RSVP with the family." Events › RSVPs (the portal slice) calls it.
create or replace function app.rsvp_contact_verify_staff(p_rsvp uuid, p_reason text default null) returns boolean
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.rsvps;
begin
  select * into r from app.rsvps where id = p_rsvp for update;
  if r.id is null or r.source <> 'guest_contact' then raise exception 'That RSVP was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(r.center_id, 'events');
  if not (app.has_permission(r.center_id, 'events.manage') or app.has_scoped_role(r.center_id, r.event_id, 'event_lead')) then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'Staff checked this RSVP with the family'));
  update app.rsvps set contact_verified_at = coalesce(contact_verified_at, now()) where id = r.id;
  return true;
end $$;

-- ══ 9. Who may call what ═════════════════════════════════════════════════════
do $$
declare f text;
begin
  -- Inside only: the database's own functions call these.
  foreach f in array array[
    'app._mask_marks()', 'app._mask_word(text)', 'app._rsvp_contact_rank(text)', 'app._rsvp_contact_master(uuid)',
    'app._rsvp_contact_mode(text, uuid)', 'app.events_contact_rsvp_guard()', 'app.rsvp_contact_limits()', 'app._rsvp_contact_ip()',
    'app._rsvp_contact_pepper()', 'app._rsvp_contact_hash(text, text)', 'app._rsvp_contact_hit(text, text, integer)',
    'app._rsvp_contact_over(text, text, interval, integer)', 'app._rsvp_contact_cleanup()', 'app._rsvp_contact_fail(text)',
    'app._rsvp_contact_seats(uuid, boolean)', 'app._rsvp_contact_gate(app.events)', 'app._rsvp_contact_find(uuid, text, text)',
    'app._rsvp_contact_family(uuid, date)', 'app._rsvp_contact_recipient(uuid, uuid)',
    'app._rsvp_contact_email_problem(uuid, uuid, text, text)', 'app._rsvp_contact_cancel_rsvp(uuid, text)', 'app._rsvp_contact_resolve(text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- The masks are pure: staff screens may show what a visitor would see.
  foreach f in array array['app.mask_name(text)', 'app.mask_email(text)', 'app.mask_phone(text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- The visitor's functions: callable without a session.
  foreach f in array array[
    'app.rsvp_contact_lookup(uuid, text)', 'app.rsvp_contact_undo(text)', 'app.rsvp_contact_view(text)', 'app.rsvp_contact_cancel(text)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
  -- Staff only.
  revoke execute on function app.rsvp_contact_verify_staff(uuid, text) from public, anon;
  grant execute on function app.rsvp_contact_verify_staff(uuid, text) to authenticated, service_role;
end $$;

comment on function app.rsvp_contact_lookup(uuid, text) is
  '0822: RSVP without signing in, step 1. Anyone, no session. {ok:true, step:"choose", handle, expires_in, members:[{slot,label,kind,under_12}], send_to:{email,phone}} (masked), or {ok:false, code, message}. Never an id, a real name, email or phone.';
comment on function app.rsvp_contact_view(text) is
  '0822: the RSVP behind the emailed token (marks it verified) or, for 30 minutes, behind the handle of the visit that saved it: the event, masked people with their ticket tokens, status. Anyone, no session.';
