-- 0762 · WeCare slice 2, part 3: the touch log (docs/WECARE.md section 5.3; W2; the slice-2 plan the owner approved
-- 2026-10-13). Builder CARE2.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.care_touches   every personal touch someone records for a household: what it was (kind), how (channel), who did
--                      it and when, how it went (outcome), an optional note of up to 1,000 characters, and whether it was an
--                      ASK or NO ASK. Optionally the adult of the household it was with (never anyone under 18).
--     kind      thank_you, check_in, greeting (a special day), welcome, update (what their gift did), invitation,
--               care_moment (illness, bereavement: never an ask), other
--     channel   in_person, phone, text, email, whatsapp, post, video, other
--     outcome   done, no_answer, left_message, declined, later
--   The one-tap touches ("Called, no answer", "Card sent", "Visited") are presets of these in the portal.
--   app.log_care_touch(household, touch)   anyone who may see the household's care record (0760); who = the caller.
--                                          The time may be earlier (a call yesterday), never in the future.
--   app.void_care_touch(touch, reason)     the person who recorded it, or someone who manages WeCare: it leaves the log,
--                                          the row stays (nothing is deleted).
--   The touches Weaver already knows (messages sent and opened, receipts, statements, event check-ins, volunteer shifts)
--   are NOT copied here: 0763 reads them from their own tables when the log is shown.
--   A care moment is never an ask (refused). Audit: app.audit_private_row (0758), module 'care', never the note.
set client_min_messages = warning;

create table if not exists app.care_touches (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  household_id uuid not null references app.households(id) on delete no action,
  person_id    uuid references app.people(id) on delete no action,
  kind         text not null check (kind in ('thank_you', 'check_in', 'greeting', 'welcome', 'update', 'invitation', 'care_moment', 'other')),
  channel      text not null check (channel in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post', 'video', 'other')),
  outcome      text not null default 'done' check (outcome in ('done', 'no_answer', 'left_message', 'declined', 'later')),
  is_ask       boolean not null default false,
  note         text check (note is null or char_length(btrim(note)) between 1 and 1000),
  touched_at   timestamptz not null default now(),
  by_user_id   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  voided_at    timestamptz,
  voided_by    uuid references auth.users(id) on delete set null,
  void_reason  text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 500),
  constraint care_touches_care_moment_no_ask check (not (kind = 'care_moment' and is_ask)),
  constraint care_touches_after_2000 check (touched_at >= timestamptz '2000-01-01')
);
create index if not exists care_touches_household_idx on app.care_touches (household_id, touched_at desc);
create index if not exists care_touches_center_idx on app.care_touches (center_id, touched_at desc);
create index if not exists care_touches_person_idx on app.care_touches (person_id) where person_id is not null;
comment on table app.care_touches is
  'WeCare (0762): personal touches recorded for a household (kind, channel, who, when, outcome, note, ask or no ask). Written only by app.log_care_touch / app.void_care_touch; voided, never deleted. Read with app.care_household_can. The touches Weaver already knows are read from their own tables (0763), not copied.';

drop trigger if exists care_touches_household on app.care_touches;
create trigger care_touches_household before insert or update on app.care_touches
  for each row execute function app.care_row_household();
drop trigger if exists care_touches_person on app.care_touches;
create trigger care_touches_person before insert or update of person_id, household_id on app.care_touches
  for each row execute function app.care_row_adult('person_id');
drop trigger if exists audit_care_touches on app.care_touches;
create trigger audit_care_touches after insert or update or delete on app.care_touches
  for each row execute function app.audit_private_row('care');
insert into app.module_tables (table_name, module_key) values ('care_touches', 'care')
  on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.care_touches enable row level security;
drop policy if exists care_touches_read on app.care_touches;
create policy care_touches_read on app.care_touches for select to authenticated
  using (center_id = any ((select app.care_view_centers())::uuid[])
         or household_id = any ((select app.care_my_households())::uuid[]));
drop policy if exists module_switch on app.care_touches;
create policy module_switch on app.care_touches as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_touches from public, anon, authenticated;
grant select on app.care_touches to authenticated;
grant all on app.care_touches to service_role;

-- p_touch: {kind, channel, outcome?, is_ask?, note?, touched_at?, person_id?}. Returns the new touch's id.
create or replace function app.log_care_touch(p_household uuid, p_touch jsonb) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_id uuid; k text; v_kind text; v_channel text; v_outcome text; v_ask boolean; v_note text;
  v_at timestamptz; v_person uuid; v_text text;
  v_allowed constant text[] := array['kind', 'channel', 'outcome', 'is_ask', 'note', 'touched_at', 'person_id'];
begin
  v_center := app._care_household_or_raise(p_household);
  if p_touch is null or jsonb_typeof(p_touch) <> 'object' then
    raise exception 'Nothing to record: say what the touch was.' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_touch) loop
    if not (k = any (v_allowed)) then raise exception 'A touch has no field "%".', k using errcode = '22023'; end if;
  end loop;
  v_kind := nullif(btrim(coalesce(p_touch->>'kind', '')), '');
  v_channel := nullif(btrim(coalesce(p_touch->>'channel', '')), '');
  v_outcome := coalesce(nullif(btrim(coalesce(p_touch->>'outcome', '')), ''), 'done');
  if v_kind is null or v_kind not in ('thank_you', 'check_in', 'greeting', 'welcome', 'update', 'invitation', 'care_moment', 'other') then
    raise exception 'Say what the touch was: a thank-you, a check-in, a greeting, a welcome, an update, an invitation, a care moment or something else.'
      using errcode = '23514';
  end if;
  if v_channel is null or v_channel not in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post', 'video', 'other') then
    raise exception 'Say how: in person, phone, text, email, WhatsApp, post, video or another way.' using errcode = '23514';
  end if;
  if v_outcome not in ('done', 'no_answer', 'left_message', 'declined', 'later') then
    raise exception 'Say how it went: done, no answer, left a message, declined or later.' using errcode = '23514';
  end if;
  if p_touch ? 'is_ask' and jsonb_typeof(p_touch->'is_ask') not in ('boolean', 'null') then
    raise exception 'Ask or no ask is yes or no.' using errcode = '22023';
  end if;
  v_ask := coalesce((p_touch->>'is_ask')::boolean, false);
  if v_kind = 'care_moment' and v_ask then
    raise exception 'A care moment is never an ask. Record the ask as a touch of its own, later.' using errcode = '23514';
  end if;
  v_note := nullif(btrim(coalesce(p_touch->>'note', '')), '');
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'A touch note is at most 1,000 characters.' using errcode = '23514';
  end if;
  v_text := nullif(btrim(coalesce(p_touch->>'touched_at', '')), '');
  begin
    v_at := coalesce(v_text::timestamptz, now());
  exception when others then
    raise exception 'The time of the touch has the wrong format.' using errcode = '22007';
  end;
  if v_at > now() + interval '5 minutes' then
    raise exception 'A touch cannot be in the future. Record it once it has happened.' using errcode = '23514';
  end if;
  if v_at < timestamptz '2000-01-01' then raise exception 'That date is too far back.' using errcode = '23514'; end if;
  v_text := nullif(btrim(coalesce(p_touch->>'person_id', '')), '');
  if v_text is not null and v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'That person was not found.' using errcode = '22023';
  end if;
  v_person := v_text::uuid;

  perform app.set_audit_context('Care touch recorded');
  insert into app.care_touches (center_id, household_id, person_id, kind, channel, outcome, is_ask, note, touched_at, by_user_id)
  values (v_center, p_household, v_person, v_kind, v_channel, v_outcome, v_ask, v_note, v_at, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.void_care_touch(p_touch uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.care_touches;
begin
  select * into t from app.care_touches where id = p_touch for update;
  if t.id is null then raise exception 'That touch was not found.' using errcode = 'P0002'; end if;
  perform app._care_household_or_raise(t.household_id);
  if t.by_user_id is distinct from auth.uid() and not app.care_can(t.center_id, 'manage') then
    raise exception 'Only the person who recorded a touch, or someone who manages %, can remove it from the log.', app._module_label(t.center_id, 'care')
      using errcode = 'insufficient_privilege';
  end if;
  if t.voided_at is not null then return; end if;
  perform app.set_audit_context(coalesce(app.audit_clean_reason(p_reason), 'Care touch removed from the log'));
  update app.care_touches
     set voided_at = now(), voided_by = auth.uid(), void_reason = coalesce(app.audit_clean_reason(p_reason), 'Removed from the log')
   where id = p_touch;
end $$;

-- ══ Care records stay with their family ═════════════════════════════════════
-- Nothing deletes a household's or a person's care records silently: the four tables point at households and people with
-- NO ACTION (checked at the end of the statement), and these triggers refuse the delete first, in plain words, whoever asks
-- (a platform admin through 0010's households_staff_write, or undoing an import: app.import_undo / app.import_delete of 0402
-- and 0192, which set app.client_app = 'import'). The refusal is restrict_violation, so import_undo's foreign-key handler does
-- not turn it into its generic sentence. Deleting a whole community (its row already gone) still removes everything.
create or replace function app.care_keep_household() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not exists (select 1 from app.centers c where c.id = old.center_id) then return old; end if;
  if exists (select 1 from app.care_owners x where x.household_id = old.id)
     or exists (select 1 from app.care_profiles x where x.household_id = old.id)
     or exists (select 1 from app.care_notes x where x.household_id = old.id)
     or exists (select 1 from app.care_touches x where x.household_id = old.id) then
    raise exception '%', case when current_setting('app.client_app', true) = 'import'
                              then 'This household has WeCare records, so undoing the import cannot remove it.'
                              else 'This household has WeCare records, so it cannot be deleted. Merge it into another household instead.' end
      using errcode = 'restrict_violation';
  end if;
  return old;
end $$;
revoke execute on function app.care_keep_household() from public, anon, authenticated;
drop trigger if exists care_keep_household on app.households;
create trigger care_keep_household before delete on app.households
  for each row execute function app.care_keep_household();

create or replace function app.care_keep_person() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if not exists (select 1 from app.centers c where c.id = old.center_id) then return old; end if;
  if exists (select 1 from app.care_profiles x where x.contact_person_id = old.id)
     or exists (select 1 from app.care_notes x where x.person_id = old.id)
     or exists (select 1 from app.care_touches x where x.person_id = old.id) then
    raise exception '%', case when current_setting('app.client_app', true) = 'import'
                              then 'This person is named in WeCare records, so undoing the import cannot remove them.'
                              else 'This person is named in WeCare records, so they cannot be deleted. Merge them into another person instead.' end
      using errcode = 'restrict_violation';
  end if;
  return old;
end $$;
revoke execute on function app.care_keep_person() from public, anon, authenticated;
drop trigger if exists care_keep_person on app.people;
create trigger care_keep_person before delete on app.people
  for each row execute function app.care_keep_person();

-- ══ Merging two households moves their care records ═════════════════════════
-- When a household is merged into another (households.merged_into_id is set: app.merge_households of 0104, or any later
-- merge path), its care records follow the family to the surviving household:
--   notes and touches     move (the people they name stay as they were written);
--   the care profile      the survivor's wins; the merged household's fills only what the survivor left blank (a contact only
--                         when they are a current adult member of the survivor, a language only when it is still one of the
--                         community's). Do not ask is kept if either household asked for it (the safer reading), with the
--                         longer rest (no end date wins). With no survivor profile, the merged one moves over;
--   the owner and backup  the survivor's stay; the merged household's become the survivor's only when it has no owner.
-- Every change is audited (app.audit_private_row, with the merge's own reason). Nothing is deleted: the merged household
-- keeps any profile or owner row it had, as history.
create or replace function app._care_current_adult(p_household uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_person is not null and not app.person_is_minor(p_person)
     and exists (select 1 from app.household_members hm
                  where hm.household_id = p_household and hm.person_id = p_person and hm.left_at is null)
$$;
revoke execute on function app._care_current_adult(uuid, uuid) from public, anon, authenticated;

create or replace function app.care_households_merged() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_keep uuid := new.merged_into_id; k app.care_profiles; d app.care_profiles; ko app.care_owners; dro app.care_owners;
  v_langs text[]; v_lang text; v_dna boolean; v_rest date;
begin
  if v_keep is null or old.merged_into_id is not distinct from v_keep then return new; end if;
  update app.care_notes set household_id = v_keep where household_id = new.id;
  update app.care_touches set household_id = v_keep where household_id = new.id;

  select * into d from app.care_profiles where household_id = new.id;
  if d.household_id is not null then
    select * into k from app.care_profiles where household_id = v_keep;
    if k.household_id is null then
      update app.care_profiles
         set household_id = v_keep,
             contact_person_id = case when app._care_current_adult(v_keep, contact_person_id) then contact_person_id end
       where household_id = new.id;
    else
      v_langs := coalesce(nullif((select p.languages from app.org_profiles p where p.center_id = new.center_id), '{}'::text[]), array['en']::text[]);
      v_lang := coalesce(k.language, case when d.language = any (v_langs) then d.language end);
      v_dna := k.do_not_ask or d.do_not_ask;
      v_rest := case when not v_dna then null
                     when (k.do_not_ask and k.rest_until is null) or (d.do_not_ask and d.rest_until is null) then null
                     else greatest(case when k.do_not_ask then k.rest_until end, case when d.do_not_ask then d.rest_until end) end;
      update app.care_profiles
         set thanks = coalesce(k.thanks, d.thanks),
             recognition = coalesce(k.recognition, d.recognition),
             channel = coalesce(k.channel, d.channel),
             language = v_lang,
             contact_person_id = case when k.contact_person_id is not null then k.contact_person_id
                                      when app._care_current_adult(v_keep, d.contact_person_id) then d.contact_person_id end,
             do_not_ask = v_dna,
             rest_until = v_rest
       where household_id = v_keep;
    end if;
  end if;

  select * into dro from app.care_owners where household_id = new.id;
  if dro.owner_user_id is not null then
    select * into ko from app.care_owners where household_id = v_keep;
    if ko.household_id is null or ko.owner_user_id is null then
      -- Who chose them and when stay as they were; who merged the households is the audit entry's actor.
      insert into app.care_owners as o (household_id, center_id, owner_user_id, backup_user_id, assigned_by, assigned_at)
      values (v_keep, new.center_id, dro.owner_user_id, dro.backup_user_id, dro.assigned_by, dro.assigned_at)
      on conflict (household_id) do update
        set owner_user_id = excluded.owner_user_id, backup_user_id = excluded.backup_user_id,
            assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at;
    end if;
  end if;
  return new;
end $$;
revoke execute on function app.care_households_merged() from public, anon, authenticated;
drop trigger if exists care_households_merged on app.households;
create trigger care_households_merged after update of merged_into_id on app.households
  for each row execute function app.care_households_merged();

-- ══ Merging two person records moves their care references ═════════════════
-- When a person is merged into another (people.merged_into_id is set: app.merge_people of 0104, which first moves the
-- duplicate's current households to the kept record), every care row that named the duplicate names the kept record:
-- notes and touches (in their own household, whether or not the kept record lives there), and a profile's contact when the
-- kept record is a current adult member of that household (otherwise the contact is cleared and the primary member is
-- reached first). Never a child: a kept record under 18 is not named. Audited (app.audit_private_row, the merge's reason).
create or replace function app.care_people_merged() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_keep uuid := new.merged_into_id; v_adult boolean;
begin
  if v_keep is null or old.merged_into_id is not distinct from v_keep then return new; end if;
  v_adult := not app.person_is_minor(v_keep);
  update app.care_profiles
     set contact_person_id = case when app._care_current_adult(household_id, v_keep) then v_keep end
   where contact_person_id = new.id;
  update app.care_notes set person_id = case when v_adult then v_keep end where person_id = new.id;
  update app.care_touches set person_id = case when v_adult then v_keep end where person_id = new.id;
  return new;
end $$;
revoke execute on function app.care_people_merged() from public, anon, authenticated;
drop trigger if exists care_people_merged on app.people;
create trigger care_people_merged after update of merged_into_id on app.people
  for each row execute function app.care_people_merged();

revoke execute on function app.log_care_touch(uuid, jsonb), app.void_care_touch(uuid, text) from public, anon;
grant execute on function app.log_care_touch(uuid, jsonb), app.void_care_touch(uuid, text) to authenticated;
