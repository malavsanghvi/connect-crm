-- 0823 · RSVP without signing in (docs/RSVP_WITHOUT_LOGIN.md), 2 of 2: saving the RSVP, and the confirmation email that goes with it.
--
--   app.rsvp_contact_submit(handle, slots, assist)   anon-callable. Saves the RSVP for the ticked people and queues ONE confirmation email to the
--                                                    address ON FILE, in the same transaction. If the confirmation cannot be queued (no email on file,
--                                                    bounced before, opted out, a sandbox's recipient rule) nothing is saved: the visitor is told.
--   template rsvp_contact_confirmation               the standard wording (English); the link is %MEMBER_APP_URL%/rsvp/<token>, which the background
--                                                    service writes out when it sends (worker/src/messaging.ts). The token travels as the Vault-held
--                                                    `token` value of app.enqueue_notice and is never in the queue's text.
--   app.rsvps_registered_email                       redefined (0770's body) to skip source 'guest_contact': this migration sends its own email, so
--                                                    nobody gets two.
--
-- WHAT THE DATABASE DECIDES (the phone sends only the handle and the ticked slots):
--   * who the people are (the slots point at the household members frozen in the handle), their two flags (under 12, senior; from the date of
--     birth on the event's day) and their names; the visitor sends no name, no flag, no note;
--   * where the email goes: the matched adult's email on file, else another adult of the household; nothing the visitor typed;
--   * whether there is room (the event row is locked while seats are counted, so two visitors cannot both take the last place), whether the
--     family already has an RSVP, and the share of the places RSVP-without-signing-in may hold while unverified (25% of the capacity, 40 seats
--     when there is none).
-- No pledge, no payment, no free text. Status is always rsvpd: a no-login RSVP never goes on a waitlist (v1).
set client_min_messages = warning;

-- ══ 1. The confirmation wording ══════════════════════════════════════════════
insert into app.message_templates (center_id, key, channel, language, subject, body, version)
select null, 'rsvp_contact_confirmation', 'email'::app.channel, 'en', 'You are registered: {{event_title}}',
       E'Dear {{recipient_first_name}},\n\nYour RSVP for {{event_title}} is saved. People registered: {{registration_count}}.\n\nWhen: {{event_date}}, {{event_time}}\nWhere: {{event_place}}\n\nTo see your tickets, or to cancel if you cannot come, open this link:\n%MEMBER_APP_URL%/rsvp/{{token}}\n\nIf you did not ask for this, open the link and cancel the RSVP. Nothing else is needed.\n\n{{center_name}}',
       1
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = 'rsvp_contact_confirmation' and t.channel = 'email' and t.language = 'en' and t.version = 1);

-- ══ 2. No second email ═══════════════════════════════════════════════════════
-- 0770's trigger function, unchanged except for the one line that leaves out this source.
create or replace function app.rsvps_registered_email() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_auto uuid;
begin
  if app._email_in_import() then return null; end if;
  if new.source = 'guest_contact' then return null; end if;
  if new.status not in ('rsvpd', 'confirmed') or new.source = 'import' then return null; end if;
  if tg_op = 'UPDATE' and old.status in ('rsvpd', 'confirmed') then return null; end if;
  v_auto := app._email_automation_on(new.center_id, 'registration_confirmed');
  if v_auto is null then return null; end if;
  begin
    perform app._email_compose_later(new.center_id, v_auto, new.id);
  exception when others then
    raise warning 'rsvps_registered_email: could not queue the registration email for RSVP %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

-- ══ 3. Saving ════════════════════════════════════════════════════════════════
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
  if app._rsvp_contact_over('submit.ip', v_ip_h, interval '1 hour', (v_lim ->> 'submit_ip_hour')::int)
     or app._rsvp_contact_over('submit.all', 'all', interval '1 hour', (v_lim ->> 'submit_all_hour')::int) then
    return app._rsvp_contact_fail('rate_limited');
  end if;
  perform app._rsvp_contact_hit('submit.ip', v_ip_h);
  perform app._rsvp_contact_hit('submit.all', 'all');
  perform app._rsvp_contact_cleanup();

  -- The ticked people: slots, no repeats, at most 24; "needs help" only for someone ticked.
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
  if exists (select 1 from unnest(p_slots) s where s > jsonb_array_length(h.members)) then return app._rsvp_contact_fail('bad_selection'); end if;

  -- The event row is locked from here: two visitors cannot both take the last place, or both RSVP for one family.
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
  if v_unver + v_n > v_quota then return app._rsvp_contact_fail('quota'); end if;

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
    perform app.set_audit_context('RSVP made without signing in: the phone or email typed matched a family record');
    insert into app.rsvps (center_id, event_id, household_id, submitted_by_person_id, status, source, commitment_mode, contact_kind, contact_person_id)
    values (e.center_id, e.id, h.household_id, null, 'rsvpd', 'guest_contact', 'none', h.contact_kind, h.matched_person_id)
    returning id into v_rsvp;

    -- The people behind the ticked slots, with the flags worked out here.
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

    -- The emailed link: only its hash is kept; it ends two days after the event.
    v_token := translate(encode(gen_random_bytes(24), 'base64'), '+/', '-_');
    insert into app.rsvp_manage_links (rsvp_id, center_id, token_hash, expires_at)
    values (v_rsvp, e.center_id, encode(digest(v_token, 'sha256'), 'hex'),
            coalesce(e.ends_at, e.starts_at + interval '6 hours', now() + interval '30 days') + interval '2 days');

    -- The confirmation, by the path every notice takes (suppressions, opt-outs, the sandbox's recipient rule). The token is a secret value:
    -- the Vault holds it until the message is sent, and the queue shows bullets.
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
                          jsonb_build_object('event_id', e.id, 'household_id', h.household_id, 'people', v_n, 'contact_kind', h.contact_kind));
  exception
    when sqlstate 'CCRC1' or sqlstate 'CCRC2' or sqlstate 'CCENT' or sqlstate '22023' then
      -- Everything in this block is undone. The reason is a code only: the address is in the error text, so the text is not logged.
      raise warning 'rsvp_contact_submit: the RSVP was not saved (%).', sqlstate;
      return app._rsvp_contact_fail(case when sqlstate = 'CCRC2' then 'expired' else 'cannot_send' end);
  end;

  return jsonb_build_object('ok', true, 'status', 'rsvpd', 'count', v_n,
                            'send_to', jsonb_build_object('email', app.mask_email(v_remail)), 'undo_until', v_undo);
end $$;

-- ══ 4. Who may call it ═══════════════════════════════════════════════════════
revoke execute on function app.rsvp_contact_submit(text, integer[], integer[]) from public;
grant execute on function app.rsvp_contact_submit(text, integer[], integer[]) to anon, authenticated, service_role;
revoke execute on function app.rsvps_registered_email() from public, anon, authenticated;
grant execute on function app.rsvps_registered_email() to service_role;

comment on function app.rsvp_contact_submit(text, integer[], integer[]) is
  '0823: RSVP without signing in, step 2. Anyone, no session. {ok:true, status:"rsvpd", count, send_to:{email}, undo_until} (masked), or {ok:false, code, message}. Saves nothing unless the confirmation email to the address on file is queued.';
