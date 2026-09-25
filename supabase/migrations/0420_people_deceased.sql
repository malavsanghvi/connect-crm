-- 0420 (stream e-people-legal) · the deceased flag, end to end in the database.
--
-- Owner decision 2026-09-25 (docs/DECISIONS.md, "New concepts: a deceased flag on a person").
-- app.people.is_deceased already existed (0001) and was already honoured by the directory,
-- the public dashboard, segments, the data-quality view and the people counts. This adds:
--
--   people.deceased_on / deceased_recorded_by / deceased_recorded_at / deceased_note
--   app.person_deceased_events      every "marked" / "undone" with its reason (and what it changed)
--   app.mark_person_deceased(p_person, p_deceased_on, p_note, p_reason)   people.manage · audited
--   app.undo_person_deceased(p_person, p_reason)                          people.manage · audited
--   app.set_household_primary(p_household, p_person, p_reason)            people.manage · audited
--   app.person_is_deceased(p_person)                                      helper for triggers / RPCs
--
-- What marking does (all in one transaction):
--   * memberships HELD by the person (memberships.person_id) that are active or pending end on
--     the date of death (status 'ended'); the ids and their previous end dates are kept on the
--     event so an undo can restore exactly those;
--   * their queued messages are suppressed (app.messages, any channel) — new ones are refused
--     at enqueue (0421) and by the trigger on app.messages below;
--   * voting: a new eligibility snapshot "not eligible · deceased" (only for people who had one);
--   * households they are the primary member of are returned so the portal asks for a new
--     primary (app.set_household_primary). Their household link, pledges, payments and every
--     other historical record are untouched: giving history keeps them as payer.
-- New attendance, check-ins, volunteer shifts, Pathshala enrollments, memberships, membership
-- applications and app logins for a deceased person are refused by triggers (imports excepted:
-- history may legitimately name someone who has since died).

set client_min_messages = warning;

alter table app.people add column if not exists deceased_on date;
alter table app.people add column if not exists deceased_recorded_by uuid references auth.users(id);
alter table app.people add column if not exists deceased_recorded_at timestamptz;
alter table app.people add column if not exists deceased_note text;
comment on column app.people.deceased_on is 'Date of death, when known (set with is_deceased by app.mark_person_deceased or an import).';

-- ── Keep the flag and its details consistent (imports may send only a date) ──────
create or replace function app.people_deceased_fill() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  -- A date of death alone (an import) marks the person; turning the flag off (an undo) wins.
  if new.deceased_on is not null and not new.is_deceased
     and (tg_op = 'INSERT' or not old.is_deceased) then
    new.is_deceased := true;
  end if;
  if new.is_deceased then
    if tg_op = 'INSERT' or not old.is_deceased then
      new.deceased_recorded_at := coalesce(new.deceased_recorded_at, now());
      new.deceased_recorded_by := coalesce(new.deceased_recorded_by, auth.uid());
    end if;
  else
    new.deceased_on := null;
    new.deceased_recorded_at := null;
    new.deceased_recorded_by := null;
    new.deceased_note := null;
  end if;
  return new;
end $$;
drop trigger if exists people_deceased_fill on app.people;
create trigger people_deceased_fill before insert or update of is_deceased, deceased_on, deceased_note, deceased_recorded_at, deceased_recorded_by
  on app.people for each row execute function app.people_deceased_fill();

create or replace function app.person_is_deceased(p_person uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select is_deceased from app.people where id = p_person), false)
$$;

-- ── History of marks and undos ───────────────────────────────────────────────────
create table if not exists app.person_deceased_events (
  id                 uuid primary key default gen_random_uuid(),
  center_id          uuid not null references app.centers(id) on delete cascade,
  person_id          uuid not null references app.people(id) on delete cascade,
  action             text not null check (action in ('marked','undone')),
  deceased_on        date,
  note               text,
  reason             text not null,
  ended_memberships  jsonb not null default '[]'::jsonb,   -- [{id, status, ends_on}] as they were before
  primary_of         uuid[] not null default '{}',          -- households they were the primary member of
  recorded_by        uuid references auth.users(id),
  recorded_at        timestamptz not null default now()
);
create index if not exists person_deceased_events_person_idx on app.person_deceased_events (person_id, recorded_at desc);
alter table app.person_deceased_events enable row level security;
drop policy if exists person_deceased_events_read on app.person_deceased_events;
create policy person_deceased_events_read on app.person_deceased_events for select to authenticated
  using (app.has_permission(center_id, 'people.view') or app.has_permission(center_id, 'people.manage'));
revoke insert, update, delete, truncate on app.person_deceased_events from anon, authenticated;
grant select on app.person_deceased_events to authenticated;
grant all on app.person_deceased_events to service_role;
drop trigger if exists audit_person_deceased_events on app.person_deceased_events;
create trigger audit_person_deceased_events after insert or update or delete on app.person_deceased_events
  for each row execute function app.audit_row();
insert into app.module_tables (table_name, module_key) values ('person_deceased_events', 'people') on conflict (table_name) do nothing;

-- ── Mark as deceased ─────────────────────────────────────────────────────────────
create or replace function app.mark_person_deceased(p_person uuid, p_deceased_on date, p_note text, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.people; v_today date; v_name text; v_ended jsonb; v_primary uuid[]; v_msgs int; v_prompt jsonb; v_snap app.eligibility_snapshots;
begin
  select * into p from app.people where id = p_person for update;
  if p.id is null or not (app.has_permission(p.center_id, 'people.manage')) then
    raise exception 'Marking someone as deceased needs the people.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason (for example, who told the office). It goes in the audit log.' using errcode = '22023';
  end if;
  if p.merged_into_id is not null then raise exception 'This record was merged into another one. Mark that one instead.' using errcode = '22023'; end if;
  v_name := coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name;
  if p.is_deceased then raise exception '% is already recorded as deceased.', v_name using errcode = '22023'; end if;
  v_today := (now() at time zone coalesce((select time_zone from app.centers where id = p.center_id), 'America/Chicago'))::date;
  if p_deceased_on is null then raise exception 'Enter the date of death (an approximate date is fine; say so in the note).' using errcode = '22023'; end if;
  if p_deceased_on > v_today then raise exception 'The date of death cannot be in the future.' using errcode = '22023'; end if;
  if p.date_of_birth is not null and p_deceased_on < p.date_of_birth then
    raise exception 'The date of death is before % ''s date of birth.', v_name using errcode = '22023';
  end if;

  perform app.set_audit_context(btrim(p_reason));

  update app.people
     set is_deceased = true, deceased_on = p_deceased_on, deceased_note = nullif(btrim(coalesce(p_note, '')), ''),
         deceased_recorded_by = auth.uid(), deceased_recorded_at = now()
   where id = p_person;

  -- Memberships held by them end on the date of death (kept for an undo).
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'status', m.status, 'ends_on', m.ends_on) order by m.starts_on), '[]'::jsonb)
    into v_ended
    from app.memberships m where m.person_id = p_person and m.status in ('active','pending');
  update app.memberships m
     set status = 'ended', ends_on = greatest(m.starts_on, p_deceased_on),
         notes = concat_ws(E'\n', nullif(m.notes, ''), 'Ended: ' || v_name || ' passed away (' || to_char(p_deceased_on, 'FMMonth FMDD, YYYY') || ').')
   where m.person_id = p_person and m.status in ('active','pending');

  -- Nothing queued to them goes out.
  update app.messages
     set status = 'suppressed', failure_reason = 'Not sent: ' || v_name || ' is recorded as deceased.'
   where status = 'queued' and center_id = p.center_id
     and (person_id = p_person
          or (channel = 'push' and to_address in (select cu.user_id::text from app.center_users cu where cu.person_id = p_person)));
  get diagnostics v_msgs = row_count;

  -- Not eligible to vote from now on (only where eligibility is tracked for them).
  select * into v_snap from app.eligibility_snapshots where person_id = p_person order by computed_at desc limit 1;
  if v_snap.id is not null then
    insert into app.eligibility_snapshots (center_id, person_id, can_vote, reasons)
    values (p.center_id, p_person, false, '["Deceased"]'::jsonb);
  end if;

  -- Households they are the primary member of: the portal asks for a new primary.
  select coalesce(array_agg(hm.household_id), '{}') into v_primary
    from app.household_members hm join app.households h on h.id = hm.household_id
   where hm.person_id = p_person and hm.is_primary and hm.left_at is null and h.merged_into_id is null;
  select coalesce(jsonb_agg(jsonb_build_object('household_id', h.id, 'name', h.display_name, 'household_number', h.household_number,
                                               'living_members', (select count(*) from app.household_members o join app.people op on op.id = o.person_id
                                                                   where o.household_id = h.id and o.left_at is null and o.person_id <> p_person
                                                                     and not op.is_deceased and op.merged_into_id is null))), '[]'::jsonb)
    into v_prompt from app.households h where h.id = any (v_primary);

  insert into app.person_deceased_events (center_id, person_id, action, deceased_on, note, reason, ended_memberships, primary_of, recorded_by)
  values (p.center_id, p_person, 'marked', p_deceased_on, nullif(btrim(coalesce(p_note, '')), ''), btrim(p_reason), v_ended, v_primary, auth.uid());

  return jsonb_build_object('person_id', p_person, 'name', v_name, 'ended_memberships', jsonb_array_length(v_ended),
                            'suppressed_messages', v_msgs, 'needs_new_primary', v_prompt);
end $$;

-- ── Undo (a mistake, or the wrong person) ────────────────────────────────────────
create or replace function app.undo_person_deceased(p_person uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.people; e app.person_deceased_events; m jsonb; v_restored int := 0; v_name text; v_prev app.eligibility_snapshots;
begin
  select * into p from app.people where id = p_person for update;
  if p.id is null or not (app.has_permission(p.center_id, 'people.manage')) then
    raise exception 'Undoing "deceased" needs the people.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason for the undo. It goes in the audit log.' using errcode = '22023';
  end if;
  v_name := coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name;
  if not p.is_deceased then raise exception '% is not recorded as deceased.', v_name using errcode = '22023'; end if;

  perform app.set_audit_context(btrim(p_reason));
  select * into e from app.person_deceased_events where person_id = p_person and action = 'marked' order by recorded_at desc limit 1;

  update app.people set is_deceased = false where id = p_person;   -- the fill trigger clears the date and note

  -- Restore exactly the memberships the mark ended (only while they are still as it left them).
  for m in select * from jsonb_array_elements(coalesce(e.ended_memberships, '[]'::jsonb)) loop
    update app.memberships x
       set status = (m->>'status')::app.membership_status, ends_on = nullif(m->>'ends_on', '')::date,
           notes = concat_ws(E'\n', nullif(x.notes, ''), 'Restored: "deceased" was undone.')
     where x.id = (m->>'id')::uuid and x.status = 'ended' and x.ends_on = greatest(x.starts_on, e.deceased_on);
    if found then v_restored := v_restored + 1; end if;
  end loop;

  -- Voting: back to what it was before (the latest snapshot that is not the deceased one).
  if exists (select 1 from app.eligibility_snapshots s where s.person_id = p_person and s.reasons = '["Deceased"]'::jsonb) then
    select * into v_prev from app.eligibility_snapshots s
     where s.person_id = p_person and s.reasons is distinct from '["Deceased"]'::jsonb order by s.computed_at desc limit 1;
    insert into app.eligibility_snapshots (center_id, person_id, can_vote, reasons)
    values (p.center_id, p_person, coalesce(v_prev.can_vote, false),
            coalesce(v_prev.reasons, '[]'::jsonb) || '["Restored after \"deceased\" was undone"]'::jsonb);
  end if;

  insert into app.person_deceased_events (center_id, person_id, action, deceased_on, reason, recorded_by)
  values (p.center_id, p_person, 'undone', e.deceased_on, btrim(p_reason), auth.uid());
  return jsonb_build_object('person_id', p_person, 'name', v_name, 'restored_memberships', v_restored);
end $$;

-- ── Choose a household's primary member ──────────────────────────────────────────
-- Asked after the primary member dies; also usable any time (people.manage). Only the
-- is_primary flag moves: relationships, pledges, payments and memberships stay as they are.
create or replace function app.set_household_primary(p_household uuid, p_person uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare h app.households; p app.people; v_link app.household_members; v_today date;
begin
  select * into h from app.households where id = p_household;
  if h.id is null or not app.has_permission(h.center_id, 'people.manage') then
    raise exception 'Choosing the primary member needs the people.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  if h.merged_into_id is not null then raise exception 'That household was merged into another household.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Give a reason. It goes in the audit log.' using errcode = '22023';
  end if;
  select * into v_link from app.household_members where household_id = p_household and person_id = p_person and left_at is null;
  if v_link.person_id is null then raise exception 'That person is not a current member of this household.' using errcode = '22023'; end if;
  select * into p from app.people where id = p_person;
  if p.is_deceased then raise exception 'A person recorded as deceased cannot be the primary member.' using errcode = '22023'; end if;
  if p.merged_into_id is not null then raise exception 'That person record was merged into another record.' using errcode = '22023'; end if;
  v_today := (now() at time zone coalesce((select time_zone from app.centers where id = h.center_id), 'America/Chicago'))::date;
  if p.date_of_birth is not null and p.date_of_birth > (v_today - interval '18 years')::date then
    raise exception '% is under 18, so cannot be the primary member.', p.first_name using errcode = '22023';
  end if;
  if v_link.is_primary then return; end if;
  perform app.set_audit_context(btrim(p_reason));
  update app.household_members set is_primary = false where household_id = p_household and is_primary and person_id <> p_person;
  update app.household_members set is_primary = true where household_id = p_household and person_id = p_person;
end $$;

-- ── Refuse new activity for a deceased person (imports excepted) ─────────────────
create or replace function app.refuse_deceased_person() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_person uuid; v_name text; v_what text; n jsonb := to_jsonb(new); o jsonb;
begin
  -- Imports bring history in (set in the database by the import engine, never from a request header).
  if coalesce(current_setting('app.client_app', true), '') = 'import' then return new; end if;
  v_person := nullif(case tg_table_name
                       when 'pathshala_enrollments' then n->>'student_person_id'
                       when 'membership_applications' then n->>'applicant_person_id'
                       else n->>'person_id' end, '')::uuid;
  if v_person is null then return new; end if;
  -- Only what starts something new: an insert, a check-in, or a membership (re)activated.
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    if tg_table_name = 'attendees' then
      if not (n->>'checked_in_at' is not null and o->>'checked_in_at' is null) then return new; end if;
    elsif tg_table_name = 'memberships' then
      if not (n->>'status' in ('active','pending') and o->>'status' not in ('active','pending')) then return new; end if;
    else
      return new;
    end if;
  end if;
  if tg_table_name = 'memberships' and n->>'status' not in ('active','pending') then return new; end if;
  select coalesce(nullif(btrim(preferred_name), ''), first_name) || ' ' || last_name into v_name
    from app.people where id = v_person and is_deceased;
  if v_name is null then return new; end if;
  v_what := case tg_table_name
              when 'attendees' then case when tg_op = 'UPDATE' then 'checked in' else 'added to an event' end
              when 'volunteer_assignments' then 'assigned a volunteer shift'
              when 'pathshala_enrollments' then 'enrolled in Pathshala'
              when 'memberships' then 'given a membership'
              when 'membership_applications' then 'named as a membership applicant'
              when 'center_users' then 'linked to an app login'
              else 'added here' end;
  raise exception '% is recorded as deceased, so cannot be %.', v_name, v_what using errcode = '22023';
end $$;

do $$
declare t text;
begin
  foreach t in array array['attendees','volunteer_assignments','pathshala_enrollments','memberships','membership_applications','center_users'] loop
    execute format('drop trigger if exists refuse_deceased on app.%I', t);
    if t in ('attendees','memberships') then
      execute format('create trigger refuse_deceased before insert or update on app.%I for each row execute function app.refuse_deceased_person()', t);
    else
      execute format('create trigger refuse_deceased before insert on app.%I for each row execute function app.refuse_deceased_person()', t);
    end if;
  end loop;
end $$;

-- ── Any message row naming a deceased person is suppressed, however it was queued ──
create or replace function app.message_recipient_deceased(p_center uuid, p_channel text, p_to text, p_person uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_name text; v_living int; v_dead text; v_to text;
begin
  if p_center is null then return null; end if;
  if p_person is not null then
    select coalesce(nullif(btrim(preferred_name), ''), first_name) || ' ' || last_name into v_name
      from app.people where id = p_person and is_deceased;
    if v_name is not null then return v_name; end if;
  end if;
  if p_to is null then return null; end if;
  if p_channel = 'push' then
    select coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name into v_name
      from app.center_users cu join app.people p on p.id = cu.person_id
     where cu.center_id = p_center and cu.user_id::text = btrim(p_to) and p.is_deceased;
    return v_name;
  end if;
  -- By address: only when EVERY person on file with it is deceased (a shared family address
  -- still reaches the living).
  v_to := case when p_channel = 'email' then lower(btrim(p_to)) else app.normalize_recipient(p_channel, p_to) end;
  select count(*) filter (where not x.is_deceased), min(case when x.is_deceased then x.name end)
    into v_living, v_dead
    from (select distinct p.id, p.is_deceased, coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name as name
            from app.people p
           where p.center_id = p_center and p.merged_into_id is null
             and ((p_channel = 'email' and (lower(p.email::text) = v_to
                                            or exists (select 1 from app.person_emails e where e.person_id = p.id and lower(e.email::text) = v_to)))
                  or (p_channel in ('sms','whatsapp') and p.phone_e164 = v_to))) x;
  if coalesce(v_living, 0) = 0 then return v_dead; end if;
  return null;
end $$;

create or replace function app.messages_refuse_deceased() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_name text;
begin
  if new.status <> 'queued' or coalesce((new.payload->>'keyword_reply')::boolean, false) then return new; end if;
  v_name := app.message_recipient_deceased(new.center_id, new.channel::text, new.to_address, new.person_id);
  if v_name is not null then
    new.status := 'suppressed';
    new.failure_reason := 'Not sent: ' || v_name || ' is recorded as deceased.';
  end if;
  return new;
end $$;
drop trigger if exists messages_refuse_deceased on app.messages;
create trigger messages_refuse_deceased before insert on app.messages for each row execute function app.messages_refuse_deceased();

revoke execute on function app.mark_person_deceased(uuid, date, text, text), app.undo_person_deceased(uuid, text),
  app.set_household_primary(uuid, uuid, text), app.person_is_deceased(uuid),
  app.message_recipient_deceased(uuid, text, text, uuid) from public, anon;
grant execute on function app.mark_person_deceased(uuid, date, text, text), app.undo_person_deceased(uuid, text),
  app.set_household_primary(uuid, uuid, text), app.person_is_deceased(uuid) to authenticated;
revoke execute on function app.message_recipient_deceased(uuid, text, text, uuid), app.refuse_deceased_person(),
  app.messages_refuse_deceased(), app.people_deceased_fill() from authenticated;
grant execute on all functions in schema app to service_role;
