-- 0824 · RSVP without signing in (docs/RSVP_WITHOUT_LOGIN.md section 5.4), design B: the masked family only after a 6-digit code.
--
-- WHAT THIS ADDS TO 0822 / 0823, IN PLAIN WORDS
--   An event (or a community) set to `code` instead of `open` now works. The visitor types a phone number or an email; the answer is the SAME
--   whether that contact is on a family record or not: {ok:true, step:"code", handle, expires_in}. Only when the contact is on an ADULT's record
--   is a 6-digit code sent, to that phone or email on file; the visitor types it into app.rsvp_contact_verify, and only then gets the masked family,
--   the masked contacts and the reasons that tell something about the family (a second RSVP, no email on file, ...).
--   Nothing before the code tells found from not found:
--     * the same answer, the same shape, the same keys; a handle in both cases (for a contact that is not on file it points at nothing);
--     * a wrong code, a handle that never existed and the code of a handle that points at nothing all answer "bad_code";
--     * the same counters move for both (tries per contact, per connection, per event), so the limits tell nothing either;
--     * a contact on two households gets a code, and "ambiguous" is said only after it was typed;
--     * what stays different is the time it takes to queue one message. The per-contact and per-connection limits are what keep that from being
--       measured.
--   The code is sent only to a contact on file: an email to the matched adult's email, a text to the matched adult's phone. A phone number is
--   accepted only where the community has texting set up (a connected Twilio connection) and under its daily cap (200 codes); otherwise the answer
--   is `use_email`, which depends on the community's set-up, never on the contact.
--
--   Limits (docs/RSVP_WITHOUT_LOGIN.md 5.2): the lookup limits of 0822 still apply (10 an hour per connection, 3 an hour per contact, 300 per event,
--   2,000 in all). Wrong codes: 5, then that handle AND that phone or email are locked for 15 minutes; 30 tries an hour per connection.
--
--   The save (app.rsvp_contact_submit) needs a handle whose code was typed, and an RSVP made that way is VERIFIED at once (contact_verified_at), so it
--   does not count against the share of places unverified RSVPs may hold.
--
--   Also redefined from their 0822 / 0823 bodies, with the one addition: app.rsvp_contact_limits (verify_ip_hour), app._rsvp_contact_fail (new codes),
--   app.rsvp_contact_lookup (the code branch; the open branch is unchanged), app.rsvp_contact_submit (verified handles).
set client_min_messages = warning;

-- ══ 1. Storage ═══════════════════════════════════════════════════════════════
-- A handle for a contact that is not on file points at nothing (household_id null); it is only ever made in code mode.
alter table app.rsvp_contact_handles alter column household_id drop not null;
alter table app.rsvp_contact_handles alter column matched_person_id drop not null;
alter table app.rsvp_contact_handles add column if not exists verified_at timestamptz;
alter table app.rsvp_contact_handles add column if not exists code_hash text;
alter table app.rsvp_contact_handles add column if not exists code_sent_at timestamptz;
alter table app.rsvp_contact_handles add column if not exists code_expires_at timestamptz;
alter table app.rsvp_contact_handles add column if not exists households_matched integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rsvp_contact_handles_family_check') then
    alter table app.rsvp_contact_handles add constraint rsvp_contact_handles_family_check
      check (household_id is not null or mode = 'code');
  end if;
end $$;
comment on column app.rsvp_contact_handles.code_hash is
  'Design B (0824): a keyed hash of the handle''s id and its 6-digit code; for a contact that is not on file, random, so no code ever matches.';
comment on column app.rsvp_contact_handles.households_matched is
  'Design B (0824): how many households the contact opened (0 = none: the handle points at nothing; 2 or more = "ambiguous", said only after the code).';

-- ══ 2. Limits and words ══════════════════════════════════════════════════════
create or replace function app.rsvp_contact_limits() returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'lookup_ip_hour', 10,
    'miss_weight', 2,
    'lookup_contact_hour', 3,
    'lookup_event_hour', 300,
    'lookup_all_hour', 2000,
    'submit_ip_hour', 5,
    'token_ip_hour', 60,
    'confirm_address_day', 3,
    'verify_ip_hour', 30,            -- design B: code tries an hour from one connection
    'code_wrong_max', 5,             -- design B: wrong codes before the handle and the contact are locked
    'lock_minutes', 15,
    'code_minutes', 10,
    'sms_center_day', 200,           -- design B: code texts a day for one community
    'handle_minutes', 30,
    'undo_minutes', 15,
    'unverified_percent', 25,
    'unverified_seats_no_capacity', 40,
    'purge_days', 7)
$$;

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
    when 'use_email'      then 'Text messages are not available for this event. Please use your email address instead.'
    when 'bad_code'       then 'That code is not right. Check it, or ask for a new one.'
    when 'locked'         then 'Too many wrong codes. Please wait 15 minutes, or sign in.'
    else 'Something went wrong. Please try again.' end)
$$;

-- ══ 3. The wording of the code ═══════════════════════════════════════════════
insert into app.message_templates (center_id, key, channel, language, subject, body, version)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body, 1
  from (values
    ('rsvp_contact_code', 'email', 'Your code: {{code}}',
     E'Your code to RSVP for {{event_title}} is {{code}}.\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this message.\n\n{{center_name}}'),
    ('rsvp_contact_code', 'sms', null,
     '{{center_short_name}}: your code to RSVP for {{event_title}} is {{code}}. It works for 10 minutes. If you did not ask for it, ignore this message.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en' and t.version = 1);

-- ══ 4. Small helpers ═════════════════════════════════════════════════════════
-- Is texting set up for this community (the same connection the sender needs)?
create or replace function app._rsvp_contact_texting_on(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.integration_connections c where c.center_id = p_center and c.provider = 'twilio' and c.status = 'connected')
$$;

-- Six digits.
create or replace function app._rsvp_contact_new_code() returns text
language plpgsql volatile set search_path = app, public, extensions as $$
declare b bytea := gen_random_bytes(4);
begin
  return lpad(((get_byte(b, 0)::bigint * 16777216 + get_byte(b, 1)::bigint * 65536 + get_byte(b, 2)::bigint * 256 + get_byte(b, 3)::bigint) % 1000000)::text, 6, '0');
end $$;

create or replace function app._rsvp_contact_code_hash(p_pepper text, p_handle_id uuid, p_code text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select app._rsvp_contact_hash(p_pepper, 'code:' || p_handle_id::text || ':' || coalesce(p_code, ''))
$$;

-- What the family may be told once it is known to be theirs: not a second RSVP, an address to send to (and one that can be sent to), the
-- masked list. Failure = the same {ok:false, code, message} the lookup gives; success = {ok:true, ids, list, send_to}.
create or replace function app._rsvp_contact_family_answer(p_household uuid, p_person uuid, e app.events, p_pepper text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_rperson uuid; v_remail text; v_rphone text; v_tz text; v_date date; v_ids jsonb; v_list jsonb;
begin
  if exists (select 1 from app.rsvps r where r.event_id = e.id and r.household_id = p_household and r.status <> 'cancelled') then
    return app._rsvp_contact_fail('already_rsvpd');
  end if;
  select rp.person_id, rp.email, rp.phone into v_rperson, v_remail, v_rphone from app._rsvp_contact_recipient(p_household, p_person) rp;
  if v_remail is null then return app._rsvp_contact_fail('no_email'); end if;
  if app._rsvp_contact_email_problem(e.center_id, v_rperson, v_remail, p_pepper) is not null then return app._rsvp_contact_fail('cannot_send'); end if;
  v_tz := (select c.time_zone from app.centers c where c.id = e.center_id);
  v_date := (coalesce(e.starts_at, now()) at time zone coalesce(v_tz, 'UTC'))::date;
  select jsonb_agg(to_jsonb(f.person_id) order by f.rn),
         jsonb_agg(jsonb_build_object('slot', f.rn, 'label', f.label, 'kind', f.kind, 'under_12', f.under_12) order by f.rn)
    into v_ids, v_list
    from (select x.*, row_number() over (order by x.ord) as rn from app._rsvp_contact_family(p_household, v_date) x) f
   where f.rn <= 24;
  if v_ids is null then return app._rsvp_contact_fail('not_found'); end if;
  return jsonb_build_object('ok', true, 'ids', v_ids, 'list', v_list,
                            'send_to', jsonb_build_object('email', app.mask_email(v_remail), 'phone', app.mask_phone(v_rphone)));
end $$;

-- ══ 5. The code branch of the lookup ═════════════════════════════════════════
-- Always the same answer. A real contact gets a code; any other gets a handle that points at nothing.
create or replace function app._rsvp_contact_code_step(e app.events, p_kind text, p_norm text, p_contact_h text, p_ip_h text, p_pepper text) returns jsonb
language plpgsql volatile security definer set search_path = app, public, extensions as $$
declare
  v_lim jsonb := app.rsvp_contact_limits();
  v_hh uuid[]; v_per uuid[]; v_n int; v_hid uuid; v_pid uuid; v_id uuid := gen_random_uuid();
  v_handle text := translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_');
  v_code text := app._rsvp_contact_new_code(); v_to text;
begin
  -- Texting depends on how the community is set up, never on the contact.
  if p_kind = 'phone' and (not app._rsvp_contact_texting_on(e.center_id)
                           or app._rsvp_contact_over('code.sms', e.center_id::text, interval '1 day', (v_lim ->> 'sms_center_day')::int)) then
    return app._rsvp_contact_fail('use_email');
  end if;
  select array_agg(f.household_id), array_agg(f.person_id) into v_hh, v_per from app._rsvp_contact_find(e.center_id, p_kind, p_norm) f;
  v_n := coalesce(array_length(v_hh, 1), 0);
  if v_n = 1 then v_hid := v_hh[1]; v_pid := v_per[1]; end if;
  insert into app.rsvp_contact_handles (id, center_id, event_id, household_id, matched_person_id, mode, members, contact_kind, contact_hash, ip_hash,
                                        handle_hash, expires_at, code_hash, code_sent_at, code_expires_at, households_matched)
  values (v_id, e.center_id, e.id, v_hid, v_pid, 'code', '[]'::jsonb, p_kind, p_contact_h, p_ip_h,
          encode(digest(v_handle, 'sha256'), 'hex'), now() + make_interval(mins => (v_lim ->> 'handle_minutes')::int),
          case when v_n > 0 then app._rsvp_contact_code_hash(p_pepper, v_id, v_code) else encode(gen_random_bytes(32), 'hex') end,
          now(), now() + make_interval(mins => (v_lim ->> 'code_minutes')::int), v_n);
  if v_n > 0 then
    -- To the contact on file: the stored email (any case), or the stored phone in its international form. Never more than the one.
    if p_kind = 'email' then
      select lower(x.addr) into v_to
        from (select p.email::text as addr from app.people p where p.id = v_per[1] and p.email = p_norm::citext
              union all
              select pe.email::text from app.person_emails pe where pe.person_id = v_per[1] and pe.email = p_norm::citext) x limit 1;
    else
      select app.normalize_recipient('sms', p.phone_e164) into v_to from app.people p where p.id = v_per[1];
    end if;
    if v_to is not null then
      begin
        perform app.enqueue_notice(e.center_id, case when p_kind = 'phone' then 'sms' else 'email' end, v_to, 'rsvp_contact_code',
                                   jsonb_build_object('code', v_code, 'event_title', e.name),
                                   'verification_code', now(), null, now() + make_interval(mins => (v_lim ->> 'code_minutes')::int), null, true);
        if p_kind = 'phone' then perform app._rsvp_contact_hit('code.sms', e.center_id::text); end if;
      exception when others then
        -- A refused message (a sandbox's recipient rule, a suppressed address) must not tell the visitor anything. The reason is a code only.
        raise warning 'rsvp_contact_lookup: the code was not queued (%).', sqlstate;
      end;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'step', 'code', 'handle', v_handle, 'expires_in', (v_lim ->> 'code_minutes')::int * 60);
end $$;

-- ══ 6. The lookup (0822's, with the code branch) ═════════════════════════════
create or replace function app.rsvp_contact_lookup(p_event uuid, p_contact text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_lim jsonb := app.rsvp_contact_limits();
  v_pepper text := app._rsvp_contact_pepper();
  v_ip_h text; v_contact_h text; v_event_h text;
  v_raw text := btrim(coalesce(p_contact, ''));
  v_kind text; v_norm text;
  e app.events; v_gcode text; v_gmode text;
  v_hh uuid[]; v_per uuid[]; v_n int; v_hid uuid; v_pid uuid;
  v_handle text; v_ans jsonb;
begin
  v_ip_h := app._rsvp_contact_hash(v_pepper, app._rsvp_contact_ip());
  v_event_h := coalesce(p_event::text, 'none');
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
  if v_gmode not in ('open', 'code') then return app._rsvp_contact_fail('unavailable'); end if;

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

  if e.capacity is not null and app._rsvp_contact_seats(e.id) >= e.capacity then return app._rsvp_contact_fail('full'); end if;

  -- Design B: the same answer for every contact; the family comes after the code.
  if v_gmode = 'code' then return app._rsvp_contact_code_step(e, v_kind, v_norm, v_contact_h, v_ip_h, v_pepper); end if;

  -- Design A: the family straight away.
  select array_agg(f.household_id), array_agg(f.person_id) into v_hh, v_per from app._rsvp_contact_find(e.center_id, v_kind, v_norm) f;
  v_n := coalesce(array_length(v_hh, 1), 0);
  if v_n = 0 then
    perform app._rsvp_contact_hit('lookup.ip', v_ip_h, (v_lim ->> 'miss_weight')::int - 1);
    return app._rsvp_contact_fail('not_found');
  end if;
  if v_n > 1 then return app._rsvp_contact_fail('ambiguous'); end if;
  v_hid := v_hh[1]; v_pid := v_per[1];
  v_ans := app._rsvp_contact_family_answer(v_hid, v_pid, e, v_pepper);
  if not (v_ans ->> 'ok')::boolean then return v_ans; end if;

  v_handle := translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_');
  insert into app.rsvp_contact_handles (center_id, event_id, household_id, matched_person_id, mode, members, contact_kind,
                                        contact_hash, ip_hash, handle_hash, expires_at)
  values (e.center_id, e.id, v_hid, v_pid, 'open', v_ans -> 'ids', v_kind, v_contact_h, v_ip_h,
          encode(digest(v_handle, 'sha256'), 'hex'), now() + make_interval(mins => (v_lim ->> 'handle_minutes')::int));

  return jsonb_build_object('ok', true, 'step', 'choose', 'handle', v_handle,
                            'expires_in', (v_lim ->> 'handle_minutes')::int * 60,
                            'members', v_ans -> 'list', 'send_to', v_ans -> 'send_to');
end $$;

-- ══ 7. The code ══════════════════════════════════════════════════════════════
create or replace function app.rsvp_contact_verify(p_handle text, p_code text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_lim jsonb := app.rsvp_contact_limits();
  v_pepper text := app._rsvp_contact_pepper();
  v_ip_h text; v_hh text; v_max int := (v_lim ->> 'code_wrong_max')::int; v_lock interval := make_interval(mins => (v_lim ->> 'lock_minutes')::int);
  h app.rsvp_contact_handles; e app.events; v_gcode text; v_gmode text; v_wrong int; v_ans jsonb;
begin
  v_ip_h := app._rsvp_contact_hash(v_pepper, app._rsvp_contact_ip());
  if app._rsvp_contact_over('verify.ip', v_ip_h, interval '1 hour', (v_lim ->> 'verify_ip_hour')::int) then return app._rsvp_contact_fail('rate_limited'); end if;
  perform app._rsvp_contact_hit('verify.ip', v_ip_h);

  -- Wrong tries are counted on whatever string was given as the handle (so a made-up handle is counted like a real one) and, for a real
  -- handle, on its contact (so asking for a new code does not give new tries).
  v_hh := app._rsvp_contact_hash(v_pepper, 'verify:' || left(coalesce(p_handle, ''), 64));
  if p_handle ~ '^[A-Za-z0-9_-]{32}$' then
    select * into h from app.rsvp_contact_handles where handle_hash = encode(digest(p_handle, 'sha256'), 'hex');
  end if;
  if app._rsvp_contact_over('verify.wrong', v_hh, v_lock, v_max)
     or (h.id is not null and app._rsvp_contact_over('verify.wrong', h.contact_hash, v_lock, v_max)) then
    return app._rsvp_contact_fail('locked');
  end if;
  if h.id is not null and (h.expires_at <= now() or h.code_expires_at <= now()) then return app._rsvp_contact_fail('expired'); end if;

  if h.id is null or h.mode <> 'code' or h.used_at is not null or h.households_matched < 1 or h.code_hash is null
     or coalesce(p_code, '') !~ '^[0-9]{6}$' or h.code_hash <> app._rsvp_contact_code_hash(v_pepper, h.id, p_code) then
    perform app._rsvp_contact_hit('verify.wrong', v_hh);
    if h.id is not null then perform app._rsvp_contact_hit('verify.wrong', h.contact_hash); end if;
    select greatest(count(*) filter (where a.subject = v_hh),
                    count(*) filter (where h.id is not null and a.subject = h.contact_hash)) into v_wrong
      from app.rsvp_contact_attempts a where a.kind = 'verify.wrong' and a.at > now() - v_lock;
    return app._rsvp_contact_fail('bad_code') || jsonb_build_object('tries_left', greatest(v_max - v_wrong, 0));
  end if;

  -- The right code: now the family may be told what is true of it.
  select * into e from app.events where id = h.event_id;
  select g.o_code, g.o_mode into v_gcode, v_gmode from app._rsvp_contact_gate(e) g;
  if v_gcode is not null then return app._rsvp_contact_fail(v_gcode); end if;
  if e.capacity is not null and app._rsvp_contact_seats(e.id) >= e.capacity then return app._rsvp_contact_fail('full'); end if;
  if h.households_matched > 1 or h.household_id is null then return app._rsvp_contact_fail('ambiguous'); end if;
  v_ans := app._rsvp_contact_family_answer(h.household_id, h.matched_person_id, e, v_pepper);
  if not (v_ans ->> 'ok')::boolean then return v_ans; end if;
  update app.rsvp_contact_handles set verified_at = coalesce(verified_at, now()), members = v_ans -> 'ids' where id = h.id;
  return jsonb_build_object('ok', true, 'step', 'choose', 'handle', p_handle,
                            'expires_in', greatest(floor(extract(epoch from (h.expires_at - now())))::int, 0),
                            'members', v_ans -> 'list', 'send_to', v_ans -> 'send_to');
end $$;

-- ══ 8. The save (0823's, for a verified handle) ══════════════════════════════
create or replace function app.rsvp_contact_submit(p_handle text, p_slots integer[], p_assist integer[] default '{}')
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_lim jsonb := app.rsvp_contact_limits();
  v_pepper text := app._rsvp_contact_pepper();
  v_ip_h text;
  h app.rsvp_contact_handles; e app.events;
  v_tz text; v_date date; v_gcode text; v_gmode text;
  v_n int; v_ins int; v_taken int; v_unver int; v_quota int;
  v_rperson uuid; v_remail text; v_rphone text; v_first text; v_lang text;
  v_rsvp uuid; v_token text; v_msg uuid; v_mstatus text; v_undo timestamptz;
begin
  v_ip_h := app._rsvp_contact_hash(v_pepper, app._rsvp_contact_ip());
  if app._rsvp_contact_over('submit.ip', v_ip_h, interval '1 hour', (v_lim ->> 'submit_ip_hour')::int) then
    return app._rsvp_contact_fail('rate_limited');
  end if;
  perform app._rsvp_contact_hit('submit.ip', v_ip_h);
  perform app._rsvp_contact_cleanup();

  v_n := coalesce(array_length(p_slots, 1), 0);
  if v_n < 1 or v_n > 24
     or exists (select 1 from unnest(p_slots) s where s is null or s < 1)
     or (select count(distinct s) from unnest(p_slots) s) <> v_n
     or exists (select 1 from unnest(coalesce(p_assist, '{}'::int[])) a where a is null or not (a = any (p_slots))) then
    return app._rsvp_contact_fail('bad_selection');
  end if;

  if p_handle is null or p_handle !~ '^[A-Za-z0-9_-]{32}$' then return app._rsvp_contact_fail('expired'); end if;
  select * into h from app.rsvp_contact_handles where handle_hash = encode(digest(p_handle, 'sha256'), 'hex') for update;
  if h.id is null or h.expires_at <= now() then return app._rsvp_contact_fail('expired'); end if;
  if h.used_at is not null then return app._rsvp_contact_fail('used'); end if;
  -- A handle that points at nothing, or whose code was never typed, saves nothing.
  if h.household_id is null or (h.mode = 'code' and h.verified_at is null) then return app._rsvp_contact_fail('expired'); end if;
  if exists (select 1 from unnest(p_slots) s where s > jsonb_array_length(h.members)) then return app._rsvp_contact_fail('bad_selection'); end if;

  select * into e from app.events where id = h.event_id for update;
  select g.o_code, g.o_mode into v_gcode, v_gmode from app._rsvp_contact_gate(e) g;
  if v_gcode is not null then return app._rsvp_contact_fail(v_gcode); end if;
  if app._rsvp_contact_rank(v_gmode) < app._rsvp_contact_rank(h.mode) then return app._rsvp_contact_fail('unavailable'); end if;
  if not exists (select 1 from app.household_members hm join app.people p on p.id = hm.person_id
                  where hm.household_id = h.household_id and hm.person_id = h.matched_person_id and hm.left_at is null
                    and not p.is_deceased and p.merged_into_id is null and not app.person_is_minor(p.id)) then
    return app._rsvp_contact_fail('expired');
  end if;

  if exists (select 1 from app.rsvps r where r.event_id = e.id and r.household_id = h.household_id and r.status <> 'cancelled') then
    return app._rsvp_contact_fail('already_rsvpd');
  end if;
  v_taken := app._rsvp_contact_seats(e.id);
  if e.capacity is not null and v_taken + v_n > e.capacity then return app._rsvp_contact_fail('full'); end if;
  v_unver := app._rsvp_contact_seats(e.id, true);
  v_quota := case when e.capacity is not null then greatest(ceil(e.capacity * (v_lim ->> 'unverified_percent')::int / 100.0)::int, 1)
                  else (v_lim ->> 'unverified_seats_no_capacity')::int end;
  -- A verified handle (the code was typed) makes a verified RSVP, which does not count against the unverified share.
  if h.verified_at is null and v_unver + v_n > v_quota then return app._rsvp_contact_fail('quota'); end if;

  select rp.person_id, rp.email, rp.phone into v_rperson, v_remail, v_rphone from app._rsvp_contact_recipient(h.household_id, h.matched_person_id) rp;
  if v_remail is null then return app._rsvp_contact_fail('no_email'); end if;
  if app._rsvp_contact_email_problem(e.center_id, v_rperson, v_remail, v_pepper) is not null then
    return app._rsvp_contact_fail('cannot_send');
  end if;

  v_tz := (select c.time_zone from app.centers c where c.id = e.center_id);
  v_date := (coalesce(e.starts_at, now()) at time zone coalesce(v_tz, 'UTC'))::date;
  select coalesce(nullif(btrim(p.preferred_name), ''), p.first_name), coalesce(nullif(btrim(p.language), ''), 'en')
    into v_first, v_lang from app.people p where p.id = v_rperson;

  begin
    perform app.set_audit_context(case when h.verified_at is not null
      then 'RSVP made without signing in: the 6-digit code sent to the phone or email on file was typed'
      else 'RSVP made without signing in: the phone or email typed matched a family record' end);
    insert into app.rsvps (center_id, event_id, household_id, submitted_by_person_id, status, source, commitment_mode, contact_kind, contact_person_id, contact_verified_at)
    values (e.center_id, e.id, h.household_id, null, 'rsvpd', 'guest_contact', 'none', h.contact_kind, h.matched_person_id, h.verified_at)
    returning id into v_rsvp;

    insert into app.attendees (center_id, event_id, rsvp_id, person_id, display_name, is_child_under_12, is_senior, needs_assistance, status)
    select e.center_id, e.id, v_rsvp, f.person_id,
           btrim(coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name),
           f.under_12, f.senior, (s.slot = any (coalesce(p_assist, '{}'::int[]))), 'rsvpd'
      from unnest(p_slots) as s(slot)
      join app._rsvp_contact_family(h.household_id, v_date) f on f.person_id = (h.members ->> (s.slot - 1))::uuid
      join app.people p on p.id = f.person_id
     order by s.slot;
    get diagnostics v_ins = row_count;
    if v_ins <> v_n then raise exception using errcode = 'CCRC2', message = 'the family changed'; end if;

    v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_');
    insert into app.rsvp_manage_links (rsvp_id, center_id, token_hash, expires_at)
    values (v_rsvp, e.center_id, encode(digest(v_token, 'sha256'), 'hex'),
            coalesce(e.ends_at, e.starts_at + interval '6 hours', now() + interval '30 days') + interval '2 days');

    v_msg := app.enqueue_notice(e.center_id, 'email', v_remail, 'rsvp_contact_confirmation',
      jsonb_build_object('person_id', v_rperson::text, 'language', v_lang, 'recipient_first_name', v_first, 'event_title', e.name,
                         'event_date', coalesce(to_char(e.starts_at at time zone coalesce(v_tz, 'UTC'), 'FMDay, FMMonth FMDD, YYYY'), 'to be announced'),
                         'event_time', coalesce(to_char(e.starts_at at time zone coalesce(v_tz, 'UTC'), 'FMHH12:MI AM'), ''),
                         'event_place', coalesce(nullif(btrim(e.venue), ''), 'to be announced'),
                         'registration_count', v_n::text, 'token', v_token),
      'notification', now(), 'events', null, jsonb_build_object('rsvp_id', v_rsvp::text), true);
    select m.status into v_mstatus from app.messages m where m.id = v_msg;
    if v_mstatus is distinct from 'queued' then raise exception using errcode = 'CCRC1', message = 'the confirmation was not queued'; end if;

    v_undo := now() + make_interval(mins => (v_lim ->> 'undo_minutes')::int);
    update app.rsvp_contact_handles set used_at = now(), rsvp_id = v_rsvp, undo_until = v_undo where id = h.id;
    perform app._rsvp_contact_hit('confirm.address', app._rsvp_contact_hash(v_pepper, lower(v_remail)));
    perform app.log_audit(e.center_id, 'rsvp.contact_submitted', 'rsvps', v_rsvp::text, null,
                          jsonb_build_object('event_id', e.id, 'household_id', h.household_id, 'people', v_n, 'contact_kind', h.contact_kind,
                                             'code_typed', h.verified_at is not null));
  exception
    when sqlstate 'CCRC1' or sqlstate 'CCRC2' or sqlstate 'CCENT' or sqlstate '22023' then
      raise warning 'rsvp_contact_submit: the RSVP was not saved (%).', sqlstate;
      return app._rsvp_contact_fail(case when sqlstate = 'CCRC2' then 'expired' else 'cannot_send' end);
  end;

  return jsonb_build_object('ok', true, 'status', 'rsvpd', 'count', v_n,
                            'send_to', jsonb_build_object('email', app.mask_email(v_remail)), 'undo_until', v_undo);
end $$;

-- ══ 9. Who may call what ═════════════════════════════════════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    'app._rsvp_contact_texting_on(uuid)', 'app._rsvp_contact_new_code()', 'app._rsvp_contact_code_hash(text, uuid, text)',
    'app._rsvp_contact_family_answer(uuid, uuid, app.events, text)', 'app._rsvp_contact_code_step(app.events, text, text, text, text, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Redefined above: keep the grants of 0822 / 0823 exactly.
  revoke execute on function app.rsvp_contact_limits() from public, anon, authenticated;
  grant execute on function app.rsvp_contact_limits() to service_role;
  revoke execute on function app._rsvp_contact_fail(text) from public, anon, authenticated;
  grant execute on function app._rsvp_contact_fail(text) to service_role;
  revoke execute on function app.rsvp_contact_lookup(uuid, text), app.rsvp_contact_submit(text, integer[], integer[]), app.rsvp_contact_verify(text, text) from public;
  grant execute on function app.rsvp_contact_lookup(uuid, text), app.rsvp_contact_submit(text, integer[], integer[]), app.rsvp_contact_verify(text, text)
    to anon, authenticated, service_role;
end $$;

comment on function app.rsvp_contact_verify(text, text) is
  '0824: RSVP without signing in, design B: the 6-digit code. Anyone, no session. The masked family (the same answer as design A''s lookup) or {ok:false, code: bad_code (tries_left) | locked | expired | ...}. 5 wrong codes lock the handle and the contact for 15 minutes.';
