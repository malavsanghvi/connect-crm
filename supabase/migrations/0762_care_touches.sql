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
  household_id uuid not null references app.households(id) on delete cascade,
  person_id    uuid references app.people(id) on delete set null,
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

revoke execute on function app.log_care_touch(uuid, jsonb), app.void_care_touch(uuid, text) from public, anon;
grant execute on function app.log_care_touch(uuid, jsonb), app.void_care_touch(uuid, text) to authenticated;
