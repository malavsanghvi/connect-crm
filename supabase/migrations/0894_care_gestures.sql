-- 0894 · DonorDelight slice 6: the gesture library (docs/DONORDELIGHT.md sections 5.7, 7 and 14; W2).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   A gesture is a thing to do FOR a supporter: a thank-you call with no ask, a handwritten card, a short video from a leader, a photo of what their gift
--   built, asking their advice, a greeting on their special day, a quiet behind-the-scenes visit, a welcome visit, a small token tied to the mission,
--   recognition (only if they chose it), a care moment (only if the family shared it and agreed). A gesture is NEVER paired with an ask: there is no ask in it
--   (no column, no field), the touch it records is always "no ask", and a gesture whose words ask for money cannot be saved.
--   app.care_gestures       the community's own library. Each gesture has:
--       cost         free or low (a card and a stamp)
--       effort       quick (minutes), some (under an hour) or a_while (half a day or more)
--       who          leader, staff, volunteer or anyone: who is the right person to do it
--       suits_thanks / suits_recognition   the care profiles it suits (how the household likes to be thanked, how it likes to be recognised); empty = any
--       needs        what the household's own records must hold: special_day, anniversary, expertise, interests (read from People, never copied)
--       suggest      false = never offered on its own (a care moment: only when the family shared it and agreed, chosen by a person)
--       kind, channel, draft   the touch it records and the words to start from ({{name}}, {{me}}, {{org}})
--   app.care_gesture_starters   the starter set per kind of organization (faith or civic), as DATA; nothing names a community, a religion or a language.
--   app.care_gestures_list(center)           care.own and up (not a read of a care record, so not logged)
--   app.save_care_gesture(center, gesture)   care.manage: create or change one
--   app.set_care_gesture_enabled(gesture, on)  care.manage: pause or resume (nothing is deleted)
--   app.install_care_gestures(center)        care.manage: copy the starters the community does not have yet (idempotent)
--   Audit: app.audit_private_row (0758): who, when, which columns, never the words. Nobody else reads or writes it, platform admins included.
set client_min_messages = warning;

create table if not exists app.care_gestures (
  id                 uuid primary key default gen_random_uuid(),
  center_id          uuid not null references app.centers(id) on delete cascade,
  key                text not null check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  name               text not null check (char_length(btrim(name)) between 1 and 80),
  description        text not null check (char_length(btrim(description)) between 1 and 400),
  cost               text not null check (cost in ('free', 'low')),
  effort             text not null check (effort in ('quick', 'some', 'a_while')),
  who                text not null check (who in ('leader', 'staff', 'volunteer', 'anyone')),
  suits_thanks       text[] not null default '{}' check (suits_thanks <@ array['in_person', 'call', 'card', 'message']),
  suits_recognition  text[] not null default '{}' check (suits_recognition <@ array['public', 'private_only', 'anonymous']),
  needs              text[] not null default '{}' check (needs <@ array['special_day', 'anniversary', 'expertise', 'interests']),
  suggest            boolean not null default true,
  kind               text not null check (kind in ('thank_you', 'check_in', 'greeting', 'welcome', 'update', 'invitation', 'care_moment', 'other')),
  channel            text check (channel is null or channel in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post', 'video', 'other')),
  draft              text check (draft is null or char_length(btrim(draft)) between 1 and 1500),
  enabled            boolean not null default true,
  starter_key        text,
  sort               integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id) on delete set null,
  unique (center_id, key)
);
create index if not exists care_gestures_center_idx on app.care_gestures (center_id, enabled);
comment on table app.care_gestures is
  'DonorDelight (0894): the community''s gesture library (things to do for a supporter, never paired with an ask). Written only by app.save_care_gesture / app.install_care_gestures / app.set_care_gesture_enabled (care.manage).';

drop trigger if exists audit_care_gestures on app.care_gestures;
create trigger audit_care_gestures after insert or update or delete on app.care_gestures
  for each row execute function app.audit_private_row('care');
insert into app.module_tables (table_name, module_key) values ('care_gestures', 'care'), ('care_gesture_starters', null)
  on conflict (table_name) do update set module_key = excluded.module_key;
alter table app.care_gestures enable row level security;
drop policy if exists care_gestures_read on app.care_gestures;
create policy care_gestures_read on app.care_gestures for select to authenticated using (app.care_can(center_id, 'own'));
drop policy if exists module_switch on app.care_gestures;
create policy module_switch on app.care_gestures as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('care'))::uuid[])));
revoke all on app.care_gestures from public, anon, authenticated;
grant select on app.care_gestures to authenticated;
grant all on app.care_gestures to service_role;

-- ── Words that ask ────────────────────────────────────────────────────────────
-- A gesture is never paired with an ask: its name, description and draft may not ask for money. A plain check on words (the organization is told what to
-- change); it cannot catch every phrasing, which is why a gesture also records a touch that is always "no ask".
create or replace function app._care_words_ask(p_text text) returns boolean
language sql immutable security definer set search_path = app, public, extensions as $$
  select coalesce(p_text, '') ~* '(please (give|donate|contribute|pledge)|(would|could|can|will) you (please )?(give|donate|contribute|pledge|consider (giving|donating|a (gift|donation)))|make a (gift|donation|pledge|contribution)|donate (now|today|here)|give (now|today|generously)|consider (giving|donating)|support us with a|\$ ?[0-9])'
$$;
revoke execute on function app._care_words_ask(text) from public, anon, authenticated;

-- ── The starters (data, per kind of organization) ─────────────────────────────
create table if not exists app.care_gesture_starters (
  key               text not null check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  audience          text not null check (audience in ('faith', 'civic')),
  name              text not null,
  description       text not null,
  cost              text not null,
  effort            text not null,
  who               text not null,
  suits_thanks      text[] not null default '{}',
  suits_recognition text[] not null default '{}',
  needs             text[] not null default '{}',
  suggest           boolean not null default true,
  kind              text not null,
  channel           text,
  draft             text,
  sort              integer not null default 0,
  primary key (key, audience)
);
comment on table app.care_gesture_starters is
  'DonorDelight (0894): starter gestures per kind of organization (faith or civic), as data. Platform-wide, read only through app.install_care_gestures; copied into a community''s own library, which it edits.';
drop trigger if exists audit_care_gesture_starters on app.care_gesture_starters;
create trigger audit_care_gesture_starters after insert or update or delete on app.care_gesture_starters
  for each row execute function app.audit_row('key', 'audience');
alter table app.care_gesture_starters enable row level security;
revoke all on app.care_gesture_starters from public, anon, authenticated;
grant all on app.care_gesture_starters to service_role;

insert into app.care_gesture_starters (key, audience, name, description, cost, effort, who, suits_thanks, suits_recognition, needs, suggest, kind, channel, draft, sort)
select g.key, a.audience, g.name || '', replace(replace(g.description, '{one}', a.one), '{ones}', a.ones), g.cost, g.effort, g.who, g.suits_thanks, g.suits_recognition, g.needs, g.suggest, g.kind, g.channel, g.draft, g.sort
  from (values ('faith', 'family', 'families'), ('civic', 'supporter', 'supporters')) as a(audience, one, ones)
 cross join (values
  ('thank_you_call', 'A thank-you call with no ask', 'A short call to say thank you and to listen. Nothing else is said: no request, no news that leads to one.', 'free', 'quick', 'anyone',
     array['call', 'in_person', 'message']::text[], array[]::text[], array[]::text[], true, 'thank_you', 'phone',
     'Hello {{name}}, it is {{me}} from {{org}}. I am not calling for anything. I wanted to say thank you, and to hear how you are.', 10),
  ('handwritten_card', 'A handwritten card', 'A few warm lines on a card, signed by a person. It asks for nothing and needs no answer.', 'low', 'quick', 'anyone',
     array['card', 'message']::text[], array[]::text[], array[]::text[], true, 'thank_you', 'post',
     'Dear {{name}}, thank you for being part of {{org}}. We are grateful for you. {{me}}', 20),
  ('leader_video', 'A short video from a leader', 'A one-minute video of thanks from the person who leads the organization, sent only to this {one}.', 'free', 'some', 'leader',
     array['message', 'call']::text[], array[]::text[], array[]::text[], true, 'update', 'video',
     'Dear {{name}}, a short video of thanks from {{me}} at {{org}}.', 30),
  ('gift_photo', 'A photo of what their gift built', 'A photo and two lines about what their gift made possible. Show the result; do not mention the next one.', 'free', 'quick', 'staff',
     array['message', 'card']::text[], array[]::text[], array[]::text[], true, 'update', 'email',
     'Dear {{name}}, here is what your gift made possible at {{org}}. Thank you. {{me}}', 40),
  ('ask_advice', 'Ask for their advice', 'Ask a {one} who knows something we need to know for their view, and thank them for it. It is advice, not a request for help with money.', 'free', 'some', 'leader',
     array['call', 'in_person']::text[], array[]::text[], array['expertise']::text[], true, 'check_in', 'phone',
     'Hello {{name}}, it is {{me}} from {{org}}. You know a great deal about this, and I would value your view on something we are thinking about.', 50),
  ('special_day_greeting', 'A greeting on their special day', 'A short greeting on a day that matters to them, from their People record. A greeting only.', 'free', 'quick', 'anyone',
     array[]::text[], array[]::text[], array['special_day']::text[], true, 'greeting', 'text',
     'Dear {{name}}, thinking of you on your special day. {{me}} and everyone at {{org}}', 60),
  ('anniversary_greeting', 'An anniversary greeting', 'A short greeting on a wedding or membership anniversary on file. A greeting only.', 'free', 'quick', 'anyone',
     array[]::text[], array[]::text[], array['anniversary']::text[], true, 'greeting', 'text',
     'Dear {{name}}, warm wishes on your anniversary from {{me}} and everyone at {{org}}.', 70),
  ('behind_the_scenes', 'A quiet behind-the-scenes visit', 'Invite a {one} to see how the work is done, without a crowd and without a speech.', 'free', 'some', 'leader',
     array['in_person', 'call']::text[], array[]::text[], array[]::text[], true, 'invitation', 'in_person',
     'Hello {{name}}, it is {{me}} from {{org}}. Would you like to see how the work is done, one quiet morning? No programme, just a visit.', 80),
  ('welcome_visit', 'A welcome visit for someone new', 'A visit, or a coffee, for a new {one}, to say welcome and to listen.', 'free', 'some', 'volunteer',
     array['in_person', 'call']::text[], array[]::text[], array[]::text[], true, 'welcome', 'in_person',
     'Hello {{name}}, it is {{me}} from {{org}}. We would love to welcome you properly. May I visit, or meet you for a coffee?', 90),
  ('mission_token', 'A small token tied to the mission', 'A small thing that reminds them of the work: a book, a calendar, a seedling, a blessed or handmade item. Chosen to fit your mission.', 'low', 'some', 'staff',
     array['card', 'in_person']::text[], array[]::text[], array[]::text[], true, 'greeting', 'post',
     'Dear {{name}}, a small token from {{org}}, with our thanks. {{me}}', 100),
  ('share_interest', 'Share something about their interest', 'Send a {one} something about a subject they care about, from their People record: a story, a date, an invitation to a related event.', 'free', 'quick', 'anyone',
     array['message', 'call', 'card']::text[], array[]::text[], array['interests']::text[], true, 'update', 'email',
     'Dear {{name}}, I thought of you when I saw this. It is close to what you care about. {{me}} at {{org}}', 110),
  ('public_recognition', 'Recognition, only if they chose it', 'Name them in a newsletter or on a wall of thanks. Only for a {one} who said they are happy to be named; never for one who gives in private or in secret.', 'free', 'quick', 'staff',
     array[]::text[], array['public']::text[], array[]::text[], true, 'other', 'other',
     null, 120),
  ('care_moment', 'A care moment, only if the family shared it', 'When a {one} has told you of an illness or a loss and agreed to be contacted, reach out with care. Never offered on its own; a person chooses it. Never an ask.', 'free', 'some', 'leader',
     array[]::text[], array[]::text[], array[]::text[], false, 'care_moment', 'phone',
     'Hello {{name}}, it is {{me}} from {{org}}. We heard, and we are thinking of you. Is there anything we can do?', 130)
 ) as g(key, name, description, cost, effort, who, suits_thanks, suits_recognition, needs, suggest, kind, channel, draft, sort)
on conflict (key, audience) do nothing;

-- ── The library ───────────────────────────────────────────────────────────────
create or replace function app.care_gestures_list(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_rows jsonb; v_missing integer; v_aud text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'own') then perform app._care_refuse(p_center); end if;
  v_aud := app._care_audience(p_center);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'key', g.key, 'name', g.name, 'description', g.description, 'cost', g.cost, 'effort', g.effort, 'who', g.who,
           'suits_thanks', to_jsonb(g.suits_thanks), 'suits_recognition', to_jsonb(g.suits_recognition), 'needs', to_jsonb(g.needs),
           'suggest', g.suggest, 'kind', g.kind, 'channel', g.channel, 'draft', g.draft, 'enabled', g.enabled, 'starter_key', g.starter_key)
         order by g.sort, g.name, g.id), '[]'::jsonb)
    into v_rows from app.care_gestures g where g.center_id = p_center;
  select count(*) into v_missing from app.care_gesture_starters st
   where st.audience = v_aud and not exists (select 1 from app.care_gestures g where g.center_id = p_center and g.starter_key = st.key);
  return jsonb_build_object('gestures', v_rows, 'starters_missing', v_missing, 'audience', v_aud, 'can_manage', app.care_can(p_center, 'manage'),
                            'label', app._module_label(p_center, 'care'));
end $$;

create or replace function app.install_care_gestures(p_center uuid) returns integer
language plpgsql security definer set search_path = app, public, extensions as $$
declare st app.care_gesture_starters; v_n integer := 0; v_aud text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  v_aud := app._care_audience(p_center);
  perform app.set_audit_context('Care starter gestures installed');
  for st in select * from app.care_gesture_starters x where x.audience = v_aud order by x.sort, x.key loop
    if exists (select 1 from app.care_gestures g where g.center_id = p_center and g.starter_key = st.key) then continue; end if;
    insert into app.care_gestures (center_id, key, name, description, cost, effort, who, suits_thanks, suits_recognition, needs, suggest, kind, channel, draft, enabled, starter_key, sort, updated_by)
    values (p_center, st.key, st.name, st.description, st.cost, st.effort, st.who, st.suits_thanks, st.suits_recognition, st.needs, st.suggest, st.kind, st.channel, st.draft, true, st.key, st.sort, auth.uid())
    on conflict (center_id, key) do nothing
    returning id into v_id;
    if v_id is not null then v_n := v_n + 1; end if;
    v_id := null;
  end loop;
  return v_n;
end $$;

-- p_gesture: {id?, name, description, cost, effort, who, suits_thanks?, suits_recognition?, needs?, suggest?, kind, channel?, draft?, enabled?}.
create or replace function app.save_care_gesture(p_center uuid, p_gesture jsonb) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.care_gestures; k text; v_id uuid; v_name text; v_desc text; v_cost text; v_effort text; v_who text; v_kind text; v_channel text; v_draft text;
  v_thanks text[]; v_recog text[]; v_needs text[]; v_suggest boolean; v_enabled boolean; v_key text; v_sort integer;
  v_allowed constant text[] := array['id', 'name', 'description', 'cost', 'effort', 'who', 'suits_thanks', 'suits_recognition', 'needs', 'suggest', 'kind', 'channel', 'draft', 'enabled'];
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.care_can(p_center, 'manage') then perform app._care_refuse(p_center); end if;
  if p_gesture is null or jsonb_typeof(p_gesture) <> 'object' then raise exception 'Nothing to save: send the gesture.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_gesture) loop
    if not (k = any (v_allowed)) then raise exception 'A gesture has no field "%". A gesture is never paired with an ask.', k using errcode = '22023'; end if;
  end loop;
  if nullif(p_gesture->>'id', '') is not null then
    select * into g from app.care_gestures x where x.id = (p_gesture->>'id')::uuid and x.center_id = p_center for update;
    if g.id is null then raise exception 'That gesture was not found.' using errcode = 'P0002'; end if;
  end if;
  v_name := btrim(coalesce(p_gesture->>'name', g.name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 80 then raise exception 'Give the gesture a name of up to 80 characters.' using errcode = '23514'; end if;
  v_desc := btrim(coalesce(p_gesture->>'description', g.description, ''));
  if char_length(v_desc) < 1 or char_length(v_desc) > 400 then raise exception 'Say what to do, in up to 400 characters.' using errcode = '23514'; end if;
  v_cost := coalesce(nullif(btrim(coalesce(p_gesture->>'cost', '')), ''), g.cost);
  if v_cost is null or v_cost not in ('free', 'low') then raise exception 'A gesture costs nothing or very little: choose free or low.' using errcode = '23514'; end if;
  v_effort := coalesce(nullif(btrim(coalesce(p_gesture->>'effort', '')), ''), g.effort);
  if v_effort is null or v_effort not in ('quick', 'some', 'a_while') then raise exception 'Say how much effort it takes: quick, some or a while.' using errcode = '23514'; end if;
  v_who := coalesce(nullif(btrim(coalesce(p_gesture->>'who', '')), ''), g.who);
  if v_who is null or v_who not in ('leader', 'staff', 'volunteer', 'anyone') then raise exception 'Say who should do it: a leader, staff, a volunteer or anyone.' using errcode = '23514'; end if;
  v_kind := coalesce(nullif(btrim(coalesce(p_gesture->>'kind', '')), ''), g.kind);
  if v_kind is null or v_kind not in ('thank_you', 'check_in', 'greeting', 'welcome', 'update', 'invitation', 'care_moment', 'other') then
    raise exception 'Say what the touch is: a thank-you, a check-in, a greeting, a welcome, an update, an invitation, a care moment or something else.' using errcode = '23514';
  end if;
  if p_gesture ? 'channel' then v_channel := nullif(btrim(coalesce(p_gesture->>'channel', '')), ''); else v_channel := g.channel; end if;
  if v_channel is not null and v_channel not in ('in_person', 'phone', 'text', 'email', 'whatsapp', 'post', 'video', 'other') then
    raise exception 'Say how: in person, phone, text, email, WhatsApp, post, video or another way.' using errcode = '23514';
  end if;
  if p_gesture ? 'draft' then v_draft := nullif(btrim(coalesce(p_gesture->>'draft', '')), ''); else v_draft := g.draft; end if;
  if v_draft is not null and char_length(v_draft) > 1500 then raise exception 'The draft is at most 1,500 characters.' using errcode = '23514'; end if;
  if app._care_words_ask(v_name) or app._care_words_ask(v_desc) or app._care_words_ask(v_draft) then
    raise exception 'A gesture is never paired with an ask. Take out the words that ask for a gift, a donation or a pledge; an ask is its own step, later.' using errcode = '23514';
  end if;
  v_thanks := case when p_gesture ? 'suits_thanks' then array(select jsonb_array_elements_text(p_gesture->'suits_thanks')) else coalesce(g.suits_thanks, '{}') end;
  v_recog := case when p_gesture ? 'suits_recognition' then array(select jsonb_array_elements_text(p_gesture->'suits_recognition')) else coalesce(g.suits_recognition, '{}') end;
  v_needs := case when p_gesture ? 'needs' then array(select jsonb_array_elements_text(p_gesture->'needs')) else coalesce(g.needs, '{}') end;
  if not (v_thanks <@ array['in_person', 'call', 'card', 'message']) then raise exception 'Suits: choose from in person, a call, a card or a message.' using errcode = '23514'; end if;
  if not (v_recog <@ array['public', 'private_only', 'anonymous']) then raise exception 'Recognition: choose from public, private only or anonymous.' using errcode = '23514'; end if;
  if not (v_needs <@ array['special_day', 'anniversary', 'expertise', 'interests']) then raise exception 'Needs: choose from a special day, an anniversary, expertise or interests.' using errcode = '23514'; end if;
  if p_gesture ? 'suggest' and jsonb_typeof(p_gesture->'suggest') <> 'boolean' then raise exception 'Offered on its own is yes or no.' using errcode = '22023'; end if;
  v_suggest := coalesce((p_gesture->>'suggest')::boolean, g.suggest, true);
  if p_gesture ? 'enabled' and jsonb_typeof(p_gesture->'enabled') <> 'boolean' then raise exception 'Enabled is yes or no.' using errcode = '22023'; end if;
  v_enabled := coalesce((p_gesture->>'enabled')::boolean, g.enabled, true);
  if v_kind = 'care_moment' then v_suggest := false; end if;

  perform app.set_audit_context('Care gesture saved');
  if g.id is null then
    v_key := 'g_' || trim(both '_' from left(regexp_replace(lower(v_name), '[^a-z0-9]+', '_', 'g'), 40)) || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
    select coalesce(max(x.sort), 0) + 10 into v_sort from app.care_gestures x where x.center_id = p_center;
    insert into app.care_gestures (center_id, key, name, description, cost, effort, who, suits_thanks, suits_recognition, needs, suggest, kind, channel, draft, enabled, sort, updated_by)
    values (p_center, v_key, v_name, v_desc, v_cost, v_effort, v_who, v_thanks, v_recog, v_needs, v_suggest, v_kind, v_channel, v_draft, v_enabled, v_sort, auth.uid()) returning id into v_id;
  else
    v_id := g.id;
    update app.care_gestures set name = v_name, description = v_desc, cost = v_cost, effort = v_effort, who = v_who, suits_thanks = v_thanks, suits_recognition = v_recog,
           needs = v_needs, suggest = v_suggest, kind = v_kind, channel = v_channel, draft = v_draft, enabled = v_enabled, updated_at = now(), updated_by = auth.uid()
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function app.set_care_gesture_enabled(p_gesture uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare g app.care_gestures;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = 'insufficient_privilege'; end if;
  select * into g from app.care_gestures x where x.id = p_gesture for update;
  if g.id is null or not app.care_can(g.center_id, 'manage') then perform app._care_refuse(g.center_id); end if;
  if p_enabled is null then raise exception 'Say whether the gesture is on or paused.' using errcode = '22023'; end if;
  perform app.set_audit_context(case when p_enabled then 'Care gesture resumed' else 'Care gesture paused' end);
  update app.care_gestures set enabled = p_enabled, updated_at = now(), updated_by = auth.uid() where id = g.id;
end $$;

revoke execute on function app.care_gestures_list(uuid), app.install_care_gestures(uuid), app.save_care_gesture(uuid, jsonb),
  app.set_care_gesture_enabled(uuid, boolean) from public, anon;
grant execute on function app.care_gestures_list(uuid), app.install_care_gestures(uuid), app.save_care_gesture(uuid, jsonb),
  app.set_care_gesture_enabled(uuid, boolean) to authenticated, service_role;
