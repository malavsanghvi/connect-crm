-- 0761 · WeCare slice 2, part 2: a household's care profile and its care notes (docs/WECARE.md section 5.1; W2; the
-- slice-2 plan the owner approved 2026-10-13). Builder CARE2.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.care_profiles   one row per household, about its ADULTS only:
--     thanks        how they like to be thanked: in person, a call, a card, a message, or no thanks at all
--     recognition   public, private only, or anonymous (some give in secret: an anonymous giver gets private thanks only)
--     channel       the way to reach them: in person, phone, text, email, WhatsApp or post
--     language      one of the COMMUNITY'S OWN languages (org_profiles.languages, Setup > Profile), never a fixed list
--     contact       the adult of the household to reach first (an adult by app.person_is_minor, 0587)
--     do not ask    with an optional rest-until date: "do not ask" with no date holds until someone changes it; with a
--                   date, the household rests until that day and is not resting after it
--   app.care_notes      short notes about the household (up to 2,000 characters), optionally about one adult of it. The
--                       author may correct a note; the author or a WeCare manager archives it. Nothing is ever deleted.
--   The People fields (interests, expertise areas, best call time, anniversary, dietary needs, special days, consents) are
--   NOT copied here: the care card reads them where they live, with their own visibility (0763).
--
--   Who: whoever may see the household's care record (app.care_household_can, 0760) reads and writes both, through the
--   functions below; RLS lets the same people read the rows directly. Platform admins: nothing. WeCare off: nothing.
--   Audit: app.audit_private_row (0758), module 'care': who, when and which columns, never the words.
set client_min_messages = warning;

-- ── The care profile ─────────────────────────────────────────────────────────
create table if not exists app.care_profiles (
  household_id      uuid primary key references app.households(id) on delete no action,
  center_id         uuid not null references app.centers(id) on delete cascade,
  thanks            text check (thanks in ('in_person', 'call', 'card', 'message', 'none')),
  recognition       text check (recognition in ('public', 'private_only', 'anonymous')),
  channel           text check (channel in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post')),
  language          text check (language is null or (language ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,4}$' and char_length(language) <= 35)),
  contact_person_id uuid references app.people(id) on delete no action,
  do_not_ask        boolean not null default false,
  rest_until        date,
  updated_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint care_profiles_rest_needs_do_not_ask check (rest_until is null or do_not_ask)
);
create index if not exists care_profiles_center_idx on app.care_profiles (center_id);
comment on table app.care_profiles is
  'WeCare (0761): how a household''s adults like to be thanked and recognised, the channel and language to use, the adult to reach first, and do-not-ask with a rest-until date. Written only by app.save_care_profile. Read with app.care_household_can.';
comment on column app.care_profiles.rest_until is
  'The last day of a do-not-ask rest; null with do_not_ask: until someone changes it.';

-- The language is one of the community's own (the community's spelling is kept); the contact's rule is care_row_adult.
create or replace function app.care_profiles_check() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_langs text[]; v_match text;
begin
  -- Checked when it is set or changed. (INSERT ... ON CONFLICT runs the insert trigger first: a language already on file
  -- is not checked again, so a community that drops a language does not block the rest of a household's profile.)
  if new.language is not null
     and (case when tg_op = 'INSERT'
               then not exists (select 1 from app.care_profiles x where x.household_id = new.household_id and x.language = new.language)
               else new.language is distinct from old.language end) then
    select coalesce(nullif(p.languages, '{}'::text[]), array['en']::text[]) into v_langs
      from app.org_profiles p where p.center_id = new.center_id;
    v_langs := coalesce(v_langs, array['en']::text[]);
    select l into v_match from unnest(v_langs) l where lower(l) = lower(btrim(new.language)) limit 1;
    if v_match is null then
      raise exception 'Choose one of the community''s languages (%). Setup > Profile lists them.', array_to_string(v_langs, ', ')
        using errcode = '23514';
    end if;
    new.language := v_match;
  end if;
  if not new.do_not_ask then new.rest_until := null; end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke execute on function app.care_profiles_check() from public, anon, authenticated;

-- BEFORE triggers run in name order: the household (and so the community) first, then the contact, then the rest.
drop trigger if exists care_profiles_1_household on app.care_profiles;
create trigger care_profiles_1_household before insert or update on app.care_profiles
  for each row execute function app.care_row_household();
drop trigger if exists care_profiles_2_contact on app.care_profiles;
create trigger care_profiles_2_contact before insert or update of contact_person_id, household_id on app.care_profiles
  for each row execute function app.care_row_adult('contact_person_id');
drop trigger if exists care_profiles_3_check on app.care_profiles;
create trigger care_profiles_3_check before insert or update on app.care_profiles
  for each row execute function app.care_profiles_check();
drop trigger if exists audit_care_profiles on app.care_profiles;
create trigger audit_care_profiles after insert or update or delete on app.care_profiles
  for each row execute function app.audit_private_row('care', 'household_id');
insert into app.module_tables (table_name, module_key) values ('care_profiles', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

-- ── Care notes ───────────────────────────────────────────────────────────────
create table if not exists app.care_notes (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  household_id uuid not null references app.households(id) on delete no action,
  person_id    uuid references app.people(id) on delete no action,
  body         text not null check (char_length(btrim(body)) between 1 and 2000),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  edited_at    timestamptz,
  archived_at  timestamptz,
  archived_by  uuid references auth.users(id) on delete set null
);
create index if not exists care_notes_household_idx on app.care_notes (household_id, created_at desc);
create index if not exists care_notes_center_idx on app.care_notes (center_id);
comment on table app.care_notes is
  'WeCare (0761): notes about a household''s adults. Written only by app.add_care_note / app.edit_care_note / app.archive_care_note; archived, never deleted. Read with app.care_household_can.';

drop trigger if exists care_notes_household on app.care_notes;
create trigger care_notes_household before insert or update on app.care_notes
  for each row execute function app.care_row_household();
drop trigger if exists care_notes_person on app.care_notes;
create trigger care_notes_person before insert or update of person_id, household_id on app.care_notes
  for each row execute function app.care_row_adult('person_id');
drop trigger if exists audit_care_notes on app.care_notes;
create trigger audit_care_notes after insert or update or delete on app.care_notes
  for each row execute function app.audit_private_row('care');
insert into app.module_tables (table_name, module_key) values ('care_notes', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

-- ── RLS (both tables): the household's care readers; WeCare off hides everything ─
alter table app.care_profiles enable row level security;
drop policy if exists care_profiles_read on app.care_profiles;
create policy care_profiles_read on app.care_profiles for select to authenticated
  using (center_id = any ((select app.care_view_centers())::uuid[])
         or household_id = any ((select app.care_my_households())::uuid[]));
drop policy if exists module_switch on app.care_profiles;
create policy module_switch on app.care_profiles as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_profiles from public, anon, authenticated;
grant select on app.care_profiles to authenticated;
grant all on app.care_profiles to service_role;

alter table app.care_notes enable row level security;
drop policy if exists care_notes_read on app.care_notes;
create policy care_notes_read on app.care_notes for select to authenticated
  using (center_id = any ((select app.care_view_centers())::uuid[])
         or household_id = any ((select app.care_my_households())::uuid[]));
drop policy if exists module_switch on app.care_notes;
create policy module_switch on app.care_notes as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_notes from public, anon, authenticated;
grant select on app.care_notes to authenticated;
grant all on app.care_notes to service_role;

-- ── Writing the profile ──────────────────────────────────────────────────────
-- p_profile: {thanks, recognition, channel, language, contact_person_id, do_not_ask, rest_until}; a key left out keeps its
-- value, a key sent as null (or "") clears it. Returns the saved profile.
create or replace function app._care_profile_json(p_household uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select case when cp.household_id is null then null else jsonb_build_object(
    'thanks', cp.thanks, 'recognition', cp.recognition, 'channel', cp.channel, 'language', cp.language,
    -- Adults only, checked again when read: a contact who has left, or is under 18 by today's records, is not named.
    'contact_person_id', case when ok.yes then cp.contact_person_id end,
    'contact_name', case when ok.yes then (select coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name
                                             from app.people p where p.id = cp.contact_person_id) end,
    'do_not_ask', cp.do_not_ask, 'rest_until', cp.rest_until,
    'resting', cp.do_not_ask and (cp.rest_until is null
                                  or cp.rest_until >= (now() at time zone coalesce(c.time_zone, 'America/Chicago'))::date),
    'updated_at', cp.updated_at,
    'updated_by', case when cp.updated_by is not null then app._user_label(cp.center_id, cp.updated_by) end) end
    from app.households h
    join app.centers c on c.id = h.center_id
    left join app.care_profiles cp on cp.household_id = h.id
    cross join lateral (select cp.contact_person_id is not null and not app.person_is_minor(cp.contact_person_id)
                               and exists (select 1 from app.household_members hm where hm.household_id = h.id
                                              and hm.person_id = cp.contact_person_id and hm.left_at is null) as yes) ok
   where h.id = p_household
$$;

create or replace function app.save_care_profile(p_household uuid, p_profile jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; cur app.care_profiles; k text; v_text text; v_date date; v_contact uuid;
  v_allowed constant text[] := array['thanks', 'recognition', 'channel', 'language', 'contact_person_id', 'do_not_ask', 'rest_until'];
begin
  v_center := app._care_household_or_raise(p_household);
  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'Nothing to save: send the care profile''s fields.' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_profile) loop
    if not (k = any (v_allowed)) then
      raise exception 'The care profile has no field "%".', k using errcode = '22023';
    end if;
  end loop;
  select * into cur from app.care_profiles where household_id = p_household for update;
  if cur.household_id is null then cur.household_id := p_household; cur.do_not_ask := false; end if;
  -- A contact who has left the household, or is not an adult by today's records, is no longer the one to reach first.
  if cur.contact_person_id is not null
     and (app.person_is_minor(cur.contact_person_id)
          or not exists (select 1 from app.household_members hm where hm.household_id = p_household
                            and hm.person_id = cur.contact_person_id and hm.left_at is null)) then
    cur.contact_person_id := null;
  end if;

  if p_profile ? 'thanks' then cur.thanks := nullif(btrim(coalesce(p_profile->>'thanks', '')), ''); end if;
  if p_profile ? 'recognition' then cur.recognition := nullif(btrim(coalesce(p_profile->>'recognition', '')), ''); end if;
  if p_profile ? 'channel' then cur.channel := nullif(btrim(coalesce(p_profile->>'channel', '')), ''); end if;
  if p_profile ? 'language' then cur.language := nullif(btrim(coalesce(p_profile->>'language', '')), ''); end if;
  if p_profile ? 'contact_person_id' then
    v_text := nullif(btrim(coalesce(p_profile->>'contact_person_id', '')), '');
    if v_text is not null and v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'That person was not found.' using errcode = '22023';
    end if;
    v_contact := v_text::uuid;
    cur.contact_person_id := v_contact;
  end if;
  -- A rest-until date alone means "do not ask until then"; "do not ask: no" ends any rest.
  if p_profile ? 'rest_until' then
    v_text := nullif(btrim(coalesce(p_profile->>'rest_until', '')), '');
    if v_text is not null and v_text !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'The rest-until date has the wrong format.' using errcode = '22007';
    end if;
    v_date := v_text::date;
    if v_date is not null and v_date < (now() at time zone coalesce((select time_zone from app.centers where id = v_center), 'America/Chicago'))::date then
      raise exception 'The rest-until date is in the past. Choose today or a later day.' using errcode = '23514';
    end if;
    cur.rest_until := v_date;
    if v_date is not null and not (p_profile ? 'do_not_ask') then cur.do_not_ask := true; end if;
  end if;
  if p_profile ? 'do_not_ask' then
    if jsonb_typeof(p_profile->'do_not_ask') not in ('boolean', 'null') then
      raise exception 'Do not ask is yes or no.' using errcode = '22023';
    end if;
    cur.do_not_ask := coalesce((p_profile->>'do_not_ask')::boolean, false);
  end if;
  if not coalesce(cur.do_not_ask, false) then cur.do_not_ask := false; cur.rest_until := null; end if;
  if cur.thanks is not null and cur.thanks not in ('in_person', 'call', 'card', 'message', 'none') then
    raise exception 'Choose how they like to be thanked: in person, a call, a card, a message, or no thanks.' using errcode = '23514';
  end if;
  if cur.recognition is not null and cur.recognition not in ('public', 'private_only', 'anonymous') then
    raise exception 'Choose public, private only or anonymous.' using errcode = '23514';
  end if;
  if cur.channel is not null and cur.channel not in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post') then
    raise exception 'Choose in person, phone, text, email, WhatsApp or post.' using errcode = '23514';
  end if;

  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'Care profile changed'));
  insert into app.care_profiles as t (household_id, center_id, thanks, recognition, channel, language, contact_person_id,
                                      do_not_ask, rest_until)
  values (p_household, v_center, cur.thanks, cur.recognition, cur.channel, cur.language, cur.contact_person_id,
          cur.do_not_ask, cur.rest_until)
  on conflict (household_id) do update
    set thanks = excluded.thanks, recognition = excluded.recognition, channel = excluded.channel,
        language = excluded.language, contact_person_id = excluded.contact_person_id,
        do_not_ask = excluded.do_not_ask, rest_until = excluded.rest_until
    where (t.thanks, t.recognition, t.channel, t.language, t.contact_person_id, t.do_not_ask, t.rest_until)
          is distinct from (excluded.thanks, excluded.recognition, excluded.channel, excluded.language,
                            excluded.contact_person_id, excluded.do_not_ask, excluded.rest_until);
  return app._care_profile_json(p_household);
end $$;

-- ── Writing notes ────────────────────────────────────────────────────────────
create or replace function app.add_care_note(p_household uuid, p_body text, p_person uuid default null) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_id uuid; v_body text := btrim(coalesce(p_body, ''));
begin
  v_center := app._care_household_or_raise(p_household);
  if v_body = '' then raise exception 'Write the note first.' using errcode = '23514'; end if;
  if char_length(v_body) > 2000 then raise exception 'A note is at most 2,000 characters.' using errcode = '23514'; end if;
  perform app.set_audit_context('Care note added');
  insert into app.care_notes (center_id, household_id, person_id, body, created_by)
  values (v_center, p_household, p_person, v_body, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- The author corrects their own note (not an archived one).
create or replace function app.edit_care_note(p_note uuid, p_body text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare n app.care_notes; v_body text := btrim(coalesce(p_body, ''));
begin
  select * into n from app.care_notes where id = p_note for update;
  if n.id is null then raise exception 'That note was not found.' using errcode = 'P0002'; end if;
  perform app._care_household_or_raise(n.household_id);
  if n.created_by is distinct from auth.uid() then
    raise exception 'Only the person who wrote a note can change it.' using errcode = 'insufficient_privilege';
  end if;
  if n.archived_at is not null then raise exception 'This note was archived and cannot be changed.' using errcode = '23514'; end if;
  if v_body = '' then raise exception 'Write the note first.' using errcode = '23514'; end if;
  if char_length(v_body) > 2000 then raise exception 'A note is at most 2,000 characters.' using errcode = '23514'; end if;
  if v_body = n.body then return; end if;
  perform app.set_audit_context('Care note corrected');
  update app.care_notes set body = v_body, edited_at = now() where id = p_note;
end $$;

-- The author, or someone who manages WeCare, archives a note: it leaves the card; the row stays.
create or replace function app.archive_care_note(p_note uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare n app.care_notes;
begin
  select * into n from app.care_notes where id = p_note for update;
  if n.id is null then raise exception 'That note was not found.' using errcode = 'P0002'; end if;
  perform app._care_household_or_raise(n.household_id);
  if n.created_by is distinct from auth.uid() and not app.care_can(n.center_id, 'manage') then
    raise exception 'Only the person who wrote a note, or someone who manages %, can archive it.', app._module_label(n.center_id, 'care')
      using errcode = 'insufficient_privilege';
  end if;
  if n.archived_at is not null then return; end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'Care note archived'));
  update app.care_notes set archived_at = now(), archived_by = auth.uid() where id = p_note;
end $$;

-- ── Who may call what ────────────────────────────────────────────────────────
revoke execute on function app._care_profile_json(uuid) from public, anon, authenticated;
revoke execute on function app.save_care_profile(uuid, jsonb, text), app.add_care_note(uuid, text, uuid),
  app.edit_care_note(uuid, text), app.archive_care_note(uuid, text) from public, anon;
grant execute on function app.save_care_profile(uuid, jsonb, text), app.add_care_note(uuid, text, uuid),
  app.edit_care_note(uuid, text), app.archive_care_note(uuid, text) to authenticated;
