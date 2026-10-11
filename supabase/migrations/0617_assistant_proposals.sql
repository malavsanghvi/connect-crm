-- 0617: Niva for admins, step A1 · the database half (docs/ADMIN_REDESIGN.md "What Niva may do", "Rules Niva always
-- follows", "How Niva for admins is built"; MASTER_PLAN section 4).
--
-- A staff member asks Niva to do something that matters (level 3: money, messages to members, roles, merges, anything
-- that deletes). The portal's command layer then does exactly three things in the database, each as the signed-in
-- person (never the background service):
--   1. app.assistant_propose   writes down WHAT will happen (the command, its input, a preview for the card) and gives
--                              back a hash of the input. Nothing has changed yet.
--   2. app.assistant_confirm   the person presses the button. Works once, only for the person it was prepared for, only
--                              while it is fresh (15 minutes) and only with the hash of what they were shown. It hands
--                              the command and its input back; the portal then runs it.
--   3. app.assistant_finish    records whether it worked ('executed' or 'failed').
-- app.assistant_reject cancels a request. So the server, not the browser, enforces "prepare, confirm, then run".
--
-- Also here:
--   * app.assistant_usage and app.assistant_usage_check: a monthly limit per community (entitlement
--     assistant.monthly_actions, default 300, mirrors niva.monthly_questions from 0160/0531). D7 in ADMIN_REDESIGN.md.
--   * app.assistant_messages and app.assistant_log_message: the conversation text, kept 30 days (0618).
--
-- WHO SEES WHAT (owner decision pending, see the pull request). A person sees only their own rows, and only in a
-- community where they are staff (app.assistant_is_staff, which is app.is_staff_of for the caller: an active non-family
-- role grant, or the owner). A platform admin is
-- NOT staff by being a platform admin and sees nothing here; Community Connect reaches a community through a support
-- grant, which is a role grant, and then sees only its own rows too. Nobody can insert, update or delete these tables
-- directly; the functions below are the only way in (the table grants are revoked).
--
-- AUDIT. Every app table has an audit_<table> trigger on app.audit_row (test 13 checks it).
--   assistant_proposals   audited in full (insert, update, delete), with `input` and `preview` masked to '***' (the
--                         command, its status, who and when stay visible). The changes the command itself makes are
--                         audited on their own tables as usual, with client_app 'assistant' (0616).
--   assistant_messages    the trigger exists but fires only on UPDATE (nothing updates a message): one audit row per
--                         message would be volume, and the text is not for the audit log. `content` is masked anyway.
--                         Removal after 30 days writes one summary row (0618).
--   assistant_usage       the trigger exists but fires only on DELETE: the counter changes on every use.
--
-- app.audit_mask is redefined below. It is a shared function that every stream extends, so:
--   MERGE ORDER: this redefinition starts from 0594's text (the last one on main when this was written) and adds two
--   clauses. A migration numbered after 0617 that redefines app.audit_mask must start from THIS definition, or the
--   clauses go. Test 97 fails when they are lost.
--     0102   date_of_birth and the secrets / tokens          0546   the emergency contact and both dietary fields
--     0545   staged_rows, merge_answers                      0573   niva_tsv
--     0578   result.image_b64                                0587   text_answer, parent_note, review_note, storage_path
--     0589   homework file names (bucket rows)               0590   assistance_note
--     0594   path_key                                        0617   assistant_proposals.input and .preview, assistant_messages.content
set client_min_messages = warning;

-- ── The monthly limit, as an entitlement (0160) ──────────────────────────────────────────────────────────────────────
-- A number is the actions a community may use a month; JSON null is no limit (Community Connect can set it per
-- community in Platform › Centers). 300 for both environments until the owner sets a plan number (D7).
insert into app.entitlement_defaults (environment, key, value) values
  ('sandbox',    'assistant.monthly_actions', '300'),
  ('production', 'assistant.monthly_actions', '300')
on conflict (environment, key) do nothing;

-- ── Proposals: prepare, confirm, run ─────────────────────────────────────────────────────────────────────────────────
create table if not exists app.assistant_proposals (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  actor_user_id  uuid not null references auth.users(id) on delete cascade,
  thread_id      uuid,
  command_key    text not null check (command_key ~ '^[a-z][a-z0-9_.]{0,99}$'),
  level          smallint not null default 3 check (level between 1 and 4),
  input          jsonb not null check (jsonb_typeof(input) = 'object'),
  input_hash     text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  preview        jsonb not null default '{}'::jsonb check (jsonb_typeof(preview) = 'object'),
  status         text not null default 'proposed'
                   check (status in ('proposed', 'confirmed', 'executed', 'failed', 'rejected', 'expired')),
  expires_at     timestamptz not null,
  confirmed_at   timestamptz,
  finished_at    timestamptz,
  result_summary text check (result_summary is null or char_length(result_summary) <= 1000),
  correlation_id uuid,
  created_at     timestamptz not null default now(),
  constraint assistant_proposals_confirmed_chk check ((confirmed_at is not null) = (status in ('confirmed', 'executed', 'failed'))),
  constraint assistant_proposals_finished_chk check ((finished_at is not null) = (status in ('executed', 'failed')))
);
create index if not exists assistant_proposals_actor_idx on app.assistant_proposals (actor_user_id, center_id, created_at desc);
create index if not exists assistant_proposals_open_idx on app.assistant_proposals (status, expires_at) where status in ('proposed', 'confirmed');
create index if not exists assistant_proposals_created_idx on app.assistant_proposals (created_at);
create index if not exists assistant_proposals_thread_idx on app.assistant_proposals (thread_id) where thread_id is not null;
comment on table app.assistant_proposals is
  'Niva for admins (0617): one row per thing Niva was asked to do that needs the person''s OK. proposed -> confirmed (once, by the same person, within 15 minutes, with the input hash) -> executed | failed; or rejected | expired. input and preview are masked in the audit log. Written only by app.assistant_propose / assistant_confirm / assistant_finish / assistant_reject; read only by its own person. Kept 90 days (0618).';
comment on column app.assistant_proposals.input is 'The command''s typed input exactly as it will run. Never changes after the row is written.';
comment on column app.assistant_proposals.input_hash is 'sha256 (hex) of input::text. The card the person approves carries it; assistant_confirm refuses a different one.';
comment on column app.assistant_proposals.preview is 'What the confirmation card shows (household cards, dollars, wording). For people on the screen; never changes.';
comment on column app.assistant_proposals.result_summary is 'One plain-English line about what happened, written by the command layer after it ran.';

-- ── Conversation text ────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists app.assistant_messages (
  id             uuid primary key default gen_random_uuid(),
  center_id      uuid not null references app.centers(id) on delete cascade,
  actor_user_id  uuid not null references auth.users(id) on delete cascade,
  thread_id      uuid not null,
  role           text not null check (role in ('user', 'assistant', 'tool')),
  content        text not null check (char_length(content) between 1 and 8000),
  command_key    text check (command_key is null or command_key ~ '^[a-z][a-z0-9_.]{0,99}$'),
  created_at     timestamptz not null default clock_timestamp()
);
create index if not exists assistant_messages_thread_idx on app.assistant_messages (thread_id, created_at);
create index if not exists assistant_messages_actor_idx on app.assistant_messages (actor_user_id, center_id, created_at desc);
create index if not exists assistant_messages_created_idx on app.assistant_messages (created_at);
comment on table app.assistant_messages is
  'Niva for admins (0617): the conversation between one staff member and Niva, kept 30 days (0618). Not audited row by row (volume, and the text is not for the audit log). Written only by app.assistant_log_message; read only by its own person.';

-- ── Monthly use per community ────────────────────────────────────────────────────────────────────────────────────────
create table if not exists app.assistant_usage (
  center_id  uuid not null references app.centers(id) on delete cascade,
  month      date not null check (extract(day from month) = 1),
  used       integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (center_id, month)
);
comment on table app.assistant_usage is
  'Niva for admins (0617): actions used per community per calendar month (UTC), counted by app.assistant_usage_check against the entitlement assistant.monthly_actions. Staff of the community can read it; only the function writes it. Not audited when it counts up.';

insert into app.module_tables (table_name, module_key) values
  ('assistant_proposals', null), ('assistant_messages', null), ('assistant_usage', null)
on conflict (table_name) do nothing;

-- ── Audit ────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- app.audit_mask: 0594's definition plus the two clauses for these tables. Each clause is keyed on the SHAPE of the
-- row (columns only these tables have together), so a different table with a column called `input` or `content` is
-- not touched.
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
      || case when j->>'path_key' is not null then jsonb_build_object('path_key', '***') else '{}'::jsonb end
      -- 0617: Niva for admins. A proposal's input (the command's data) and preview (household cards, amounts); a
      -- message's text. The command, status, who and when stay in the log.
      || case when j ? 'command_key' and j ? 'input_hash' and j ? 'input'
              then jsonb_build_object('input', '***', 'preview', '***') else '{}'::jsonb end
      || case when j ? 'thread_id' and j ? 'role' and j->>'content' is not null
              then jsonb_build_object('content', '*** (' || char_length(j->>'content') || ' characters)') else '{}'::jsonb end
  end
$$;

drop trigger if exists audit_assistant_proposals on app.assistant_proposals;
create trigger audit_assistant_proposals after insert or update or delete on app.assistant_proposals
  for each row execute function app.audit_row();
drop trigger if exists audit_assistant_messages on app.assistant_messages;
create trigger audit_assistant_messages after update on app.assistant_messages
  for each row execute function app.audit_row();
drop trigger if exists audit_assistant_usage on app.assistant_usage;
create trigger audit_assistant_usage after delete on app.assistant_usage
  for each row execute function app.audit_row('center_id', 'month');

-- A prepared request is never edited: what the person approved is what runs. Only the status moves, one step at a time.
-- (A superuser tidying up by hand is held to the same rule; the tests turn triggers off to age a row.)
create or replace function app.assistant_proposals_guard() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if new.id <> old.id or new.center_id <> old.center_id or new.actor_user_id <> old.actor_user_id
     or new.thread_id is distinct from old.thread_id or new.command_key <> old.command_key or new.level <> old.level
     or new.input is distinct from old.input or new.input_hash <> old.input_hash or new.preview is distinct from old.preview
     or new.expires_at <> old.expires_at or new.created_at <> old.created_at then
    raise exception 'A prepared Niva request cannot be changed. Ask Niva to prepare a new one.';
  end if;
  if new.status <> old.status and (old.status, new.status) not in
     (('proposed', 'confirmed'), ('proposed', 'rejected'), ('proposed', 'expired'), ('confirmed', 'executed'), ('confirmed', 'failed')) then
    raise exception 'A Niva request cannot go from % to %.', old.status, new.status;
  end if;
  return new;
end $$;
drop trigger if exists assistant_proposals_guard on app.assistant_proposals;
create trigger assistant_proposals_guard before update on app.assistant_proposals
  for each row execute function app.assistant_proposals_guard();

-- ── Who can see and change what ──────────────────────────────────────────────────────────────────────────────────────
-- Is the signed-in person staff of this community now? app.is_staff_of (0150, 0400) takes any user id, so it is not
-- callable by signed-in people (0150 revokes it); a policy runs as the signed-in person, so it needs this one-person
-- version, which can only ever answer about the caller.
create or replace function app.assistant_is_staff(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select p_center is not null and auth.uid() is not null and app.is_staff_of(p_center, auth.uid())
$$;

alter table app.assistant_proposals enable row level security;
alter table app.assistant_messages enable row level security;
alter table app.assistant_usage enable row level security;

-- Your own rows, in a community where you are staff now. No insert / update / delete policy exists, and the grants below
-- take the privileges away as well. A platform admin is not special here.
drop policy if exists assistant_proposals_own_read on app.assistant_proposals;
create policy assistant_proposals_own_read on app.assistant_proposals for select to authenticated
  using (actor_user_id = (select auth.uid()) and app.assistant_is_staff(center_id));
drop policy if exists assistant_messages_own_read on app.assistant_messages;
create policy assistant_messages_own_read on app.assistant_messages for select to authenticated
  using (actor_user_id = (select auth.uid()) and app.assistant_is_staff(center_id));
-- The count is the community's, not a person's: any staff member may see how much of the month is used.
drop policy if exists assistant_usage_staff_read on app.assistant_usage;
create policy assistant_usage_staff_read on app.assistant_usage for select to authenticated
  using (app.assistant_is_staff(center_id));

revoke all on app.assistant_proposals, app.assistant_messages, app.assistant_usage from public, anon, authenticated, connect_worker;
grant select on app.assistant_proposals, app.assistant_messages, app.assistant_usage to authenticated;
grant all on app.assistant_proposals, app.assistant_messages, app.assistant_usage to service_role;

-- ── Helpers (not callable from outside) ──────────────────────────────────────────────────────────────────────────────
-- The signed-in person, who must be staff of the community now.
create or replace function app._assistant_actor(p_center uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Sign in to use Niva.' using errcode = 'insufficient_privilege'; end if;
  if p_center is null or not app.is_staff_of(p_center, v_user) then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  return v_user;
end $$;

-- A conversation belongs to one person in one community.
create or replace function app._assistant_thread_ok(p_center uuid, p_user uuid, p_thread uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select not exists (select 1 from app.assistant_messages m
                      where m.thread_id = p_thread and (m.actor_user_id <> p_user or m.center_id <> p_center))
     and not exists (select 1 from app.assistant_proposals q
                      where q.thread_id = p_thread and (q.actor_user_id <> p_user or q.center_id <> p_center))
$$;

-- The first day of the current calendar month, UTC (the month the usage limit counts in).
create or replace function app._assistant_month() returns date
language sql stable set search_path = app, public, extensions as $$
  select date_trunc('month', timezone('utc', now()))::date
$$;

-- The community's actions per month: the override if there is one, else the environment default (300). NULL = no limit.
create or replace function app._assistant_limit(p_center uuid) returns integer
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb := app.entitlement(p_center, 'assistant.monthly_actions');
begin
  if v is null then return 300; end if;
  if jsonb_typeof(v) = 'null' then return null; end if;
  if jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric >= 0 then
    return least((v #>> '{}')::numeric, 2000000000)::integer;
  end if;
  return 300;
end $$;

-- ── Propose ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Returns {proposal_id, input_hash, expires_at}. Nothing changes in the community yet.
create or replace function app.assistant_propose(p_center uuid, p_command text, p_input jsonb, p_preview jsonb,
                                                 p_thread uuid default null)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid; v_cmd text := btrim(coalesce(p_command, '')); v_preview jsonb := coalesce(p_preview, '{}'::jsonb);
        v_id uuid; v_hash text; v_exp timestamptz := now() + interval '15 minutes'; v_open integer;
begin
  v_user := app._assistant_actor(p_center);
  if v_cmd !~ '^[a-z][a-z0-9_.]{0,99}$' then
    raise exception 'Niva could not prepare that: the name of the action is not valid.';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' then
    raise exception 'Niva could not prepare that: the details of the action are missing.';
  end if;
  if jsonb_typeof(v_preview) <> 'object' then
    raise exception 'Niva could not prepare that: the summary of the action is not valid.';
  end if;
  if octet_length(p_input::text) > 65536 or octet_length(v_preview::text) > 65536 then
    raise exception 'Niva could not prepare that: it is too large. Try a smaller request.';
  end if;
  if p_thread is not null and not app._assistant_thread_ok(p_center, v_user, p_thread) then
    raise exception 'That conversation belongs to someone else.';
  end if;

  perform set_config('app.client_app', 'assistant', true);
  perform app.set_audit_context('Niva prepared ' || v_cmd || ' and is waiting for the person''s OK');

  -- Requests nobody answered in time are closed first, so they do not count against the person.
  update app.assistant_proposals set status = 'expired'
   where actor_user_id = v_user and center_id = p_center and status = 'proposed' and expires_at <= now();
  select count(*) into v_open from app.assistant_proposals
   where actor_user_id = v_user and center_id = p_center and status = 'proposed';
  if v_open >= 20 then
    raise exception 'You already have 20 Niva requests waiting for your OK. Confirm or cancel some of them first.';
  end if;

  v_hash := encode(digest(p_input::text, 'sha256'), 'hex');
  insert into app.assistant_proposals (center_id, actor_user_id, thread_id, command_key, input, input_hash, preview, expires_at)
  values (p_center, v_user, p_thread, v_cmd, p_input, v_hash, v_preview, v_exp)
  returning id into v_id;
  return jsonb_build_object('proposal_id', v_id, 'input_hash', v_hash, 'expires_at', v_exp);
end $$;

-- ── Confirm ──────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Returns {ok: true, command, input, center_id} exactly once. Every refusal is {ok: false, reason: '<plain English>'}
-- (also under `error`, the key Server Actions use) and changes nothing, except that a request found past its time is
-- marked expired. The row is locked, so two taps at once cannot both succeed.
create or replace function app.assistant_confirm(p_proposal uuid, p_input_hash text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); p app.assistant_proposals; v_why text;
begin
  if v_user is null then raise exception 'Sign in to use Niva.' using errcode = 'insufficient_privilege'; end if;
  -- Somebody else's request is "not found": nothing says whether it exists.
  select * into p from app.assistant_proposals where id = p_proposal and actor_user_id = v_user for update;
  if p.id is null then
    v_why := 'This request was not found, or it was not prepared for you.';
  elsif not app.is_staff_of(p.center_id, v_user) then
    v_why := 'You don''t have access to this area.';
  elsif p.status <> 'proposed' then
    v_why := case p.status
      when 'confirmed' then 'This request was already confirmed, so it will not run a second time.'
      when 'executed'  then 'This request was already carried out, so it will not run a second time.'
      when 'failed'    then 'This request already ran and did not finish. Ask Niva again to try once more.'
      when 'rejected'  then 'You cancelled this request. Ask Niva again if you still want it.'
      else 'This request ran out of time. Ask Niva again.' end;
  elsif p.expires_at <= now() then
    perform set_config('app.client_app', 'assistant', true);
    perform app.set_audit_context('Niva request not answered in time');
    update app.assistant_proposals set status = 'expired' where id = p.id;
    v_why := 'This request ran out of time (it waits 15 minutes). Ask Niva again.';
  elsif encode(digest(p.input::text, 'sha256'), 'hex') <> p.input_hash then
    v_why := 'This request changed after it was prepared, so nothing was done. Ask Niva again.';
  elsif lower(btrim(coalesce(p_input_hash, ''))) <> p.input_hash then
    v_why := 'What you approved is not what was prepared, so nothing was done. Ask Niva again.';
  end if;
  if v_why is not null then
    return jsonb_build_object('ok', false, 'reason', v_why, 'error', v_why);
  end if;

  perform set_config('app.client_app', 'assistant', true);
  perform app.set_audit_context('Niva: ' || p.command_key || ' confirmed by the person it was prepared for');
  update app.assistant_proposals set status = 'confirmed', confirmed_at = now() where id = p.id;
  return jsonb_build_object('ok', true, 'command', p.command_key, 'input', p.input, 'center_id', p.center_id);
end $$;

-- ── Finish ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- After the command ran: executed or failed. Only the person it was prepared for, only from 'confirmed'.
create or replace function app.assistant_finish(p_proposal uuid, p_ok boolean, p_summary text, p_correlation uuid default null)
returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); p app.assistant_proposals;
begin
  if v_user is null then raise exception 'Sign in to use Niva.' using errcode = 'insufficient_privilege'; end if;
  if p_ok is null then raise exception 'Say whether the Niva request worked.'; end if;
  select * into p from app.assistant_proposals where id = p_proposal and actor_user_id = v_user for update;
  if p.id is null then raise exception 'That Niva request was not found.'; end if;
  if p.status <> 'confirmed' then
    raise exception 'That Niva request cannot be marked finished: it is %.',
      case p.status when 'proposed' then 'still waiting for your OK' when 'executed' then 'already done'
                    when 'failed' then 'already marked as not finished' when 'rejected' then 'cancelled'
                    else 'out of time' end;
  end if;
  perform set_config('app.client_app', 'assistant', true);
  perform app.set_audit_context('Niva: ' || p.command_key || case when p_ok then ' was carried out' else ' did not finish' end, p_correlation);
  update app.assistant_proposals
     set status = case when p_ok then 'executed' else 'failed' end, finished_at = now(),
         result_summary = left(nullif(btrim(p_summary), ''), 1000), correlation_id = p_correlation
   where id = p.id;
end $$;

-- ── Reject ───────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The person says no. Only their own, only before it was confirmed; cancelling twice is fine.
create or replace function app.assistant_reject(p_proposal uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid := auth.uid(); p app.assistant_proposals;
begin
  if v_user is null then raise exception 'Sign in to use Niva.' using errcode = 'insufficient_privilege'; end if;
  select * into p from app.assistant_proposals where id = p_proposal and actor_user_id = v_user for update;
  if p.id is null then raise exception 'That Niva request was not found.'; end if;
  if p.status = 'rejected' then return; end if;
  if p.status <> 'proposed' then
    raise exception 'That Niva request cannot be cancelled any more: it is %.',
      case p.status when 'confirmed' then 'already confirmed' when 'executed' then 'already done'
                    when 'failed' then 'already over' else 'out of time' end;
  end if;
  perform set_config('app.client_app', 'assistant', true);
  perform app.set_audit_context('Niva: ' || p.command_key || ' cancelled by the person it was prepared for');
  update app.assistant_proposals set status = 'rejected' where id = p.id;
end $$;

-- ── Monthly limit ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Counts p_cost actions (default 1, 1 to 5; anything else is refused) against the community's month and records them when they fit. Returns
-- {allowed, used, limit, month, reason?}: `limit` is null when there is none, `month` is the first day of the month,
-- `used` includes this use when it was allowed, `reason` is the plain-English refusal when it was not. Concurrent
-- calls cannot both slip under the limit: the counter is one atomic upsert.
create or replace function app.assistant_usage_check(p_center uuid, p_cost integer default 1) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid; v_limit integer; v_month date := app._assistant_month(); v_used integer; v_why text;
begin
  v_user := app._assistant_actor(p_center);
  -- Refused, not clamped: a direct call cannot burn the community's month in one go, and nobody is told a bigger use
  -- was counted as a smaller one.
  if p_cost is null or p_cost < 1 or p_cost > 5 then
    raise exception 'An action must count for between 1 and 5.';
  end if;
  v_limit := app._assistant_limit(p_center);
  if v_limit is null or p_cost <= v_limit then
    insert into app.assistant_usage as u (center_id, month, used) values (p_center, v_month, p_cost)
    on conflict (center_id, month) do update set used = u.used + excluded.used, updated_at = now()
      where v_limit is null or u.used + excluded.used <= v_limit
    returning u.used into v_used;
  end if;
  if v_used is not null then
    return jsonb_build_object('allowed', true, 'used', v_used, 'limit', v_limit, 'month', v_month);
  end if;
  select coalesce((select u.used from app.assistant_usage u where u.center_id = p_center and u.month = v_month), 0) into v_used;
  v_why := format('Niva has used up this community''s %s actions for the month. It starts again on the 1st, or ask Community Connect to raise the limit.',
                  to_char(v_limit, 'FM999,999,999,990'));
  return jsonb_build_object('allowed', false, 'used', v_used, 'limit', v_limit, 'month', v_month, 'reason', v_why);
end $$;

-- The same numbers without counting a use: {used, limit, month}.
create or replace function app.assistant_usage_status(p_center uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_month date := app._assistant_month();
begin
  perform app._assistant_actor(p_center);
  return jsonb_build_object(
    'used', coalesce((select u.used from app.assistant_usage u where u.center_id = p_center and u.month = v_month), 0),
    'limit', app._assistant_limit(p_center), 'month', v_month);
end $$;

-- ── Conversation text ────────────────────────────────────────────────────────────────────────────────────────────────
-- Adds one line to the person's own conversation; returns its id. Long text is cut to 8,000 characters and says so.
create or replace function app.assistant_log_message(p_center uuid, p_thread uuid, p_role text, p_content text,
                                                     p_command_key text default null)
returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_user uuid; v_text text := btrim(coalesce(p_content, '')); v_key text := nullif(btrim(p_command_key), ''); v_id uuid;
begin
  v_user := app._assistant_actor(p_center);
  if p_thread is null then raise exception 'There is no conversation to add this to.'; end if;
  if p_role is null or p_role not in ('user', 'assistant', 'tool') then
    raise exception 'A conversation line is from you, from Niva or from a tool.';
  end if;
  if v_text = '' then raise exception 'There is nothing to add to the conversation.'; end if;
  if v_key is not null and v_key !~ '^[a-z][a-z0-9_.]{0,99}$' then
    raise exception 'The name of the action is not valid.';
  end if;
  if not app._assistant_thread_ok(p_center, v_user, p_thread) then
    raise exception 'That conversation belongs to someone else.';
  end if;
  if (select count(*) from app.assistant_messages m where m.thread_id = p_thread) >= 500 then
    raise exception 'This conversation is getting long. Start a new one.';
  end if;
  if char_length(v_text) > 8000 then v_text := left(v_text, 7970) || ' ... (shortened)'; end if;
  insert into app.assistant_messages (center_id, actor_user_id, thread_id, role, content, command_key)
  values (p_center, v_user, p_thread, p_role, v_text, v_key)
  returning id into v_id;
  return v_id;
end $$;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function app._assistant_actor(uuid), app._assistant_thread_ok(uuid, uuid, uuid), app._assistant_month(),
  app._assistant_limit(uuid), app.assistant_proposals_guard(),
  app.assistant_propose(uuid, text, jsonb, jsonb, uuid), app.assistant_confirm(uuid, text),
  app.assistant_finish(uuid, boolean, text, uuid), app.assistant_reject(uuid),
  app.assistant_usage_check(uuid, integer), app.assistant_usage_status(uuid),
  app.assistant_log_message(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke execute on function app.assistant_is_staff(uuid) from public, anon, service_role;
grant execute on function app.assistant_propose(uuid, text, jsonb, jsonb, uuid), app.assistant_confirm(uuid, text),
  app.assistant_finish(uuid, boolean, text, uuid), app.assistant_reject(uuid),
  app.assistant_usage_check(uuid, integer), app.assistant_usage_status(uuid),
  app.assistant_log_message(uuid, uuid, text, text, text), app.assistant_is_staff(uuid)
  to authenticated;

comment on function app.assistant_propose(uuid, text, jsonb, jsonb, uuid) is
  'Niva for admins (0617): staff of the community write down what Niva will do, for their own OK. Returns {proposal_id, input_hash, expires_at} (15 minutes). Changes nothing else.';
comment on function app.assistant_confirm(uuid, text) is
  'Niva for admins (0617): the person''s OK. Once only, only for the person it was prepared for, only before it expires, only with the input_hash from assistant_propose. Returns {ok, command, input, center_id}, or {ok: false, reason} in plain English.';
comment on function app.assistant_finish(uuid, boolean, text, uuid) is
  'Niva for admins (0617): after the confirmed command ran, mark it executed (p_ok) or failed. Only the same person, only from confirmed.';
comment on function app.assistant_reject(uuid) is
  'Niva for admins (0617): cancel a request that was not confirmed yet. Only the same person.';
comment on function app.assistant_usage_check(uuid, integer) is
  'Niva for admins (0617): count p_cost actions (1 to 5) against the community''s month (entitlement assistant.monthly_actions, default 300, JSON null = none) and record them when allowed. Returns {allowed, used, limit, month, reason?}.';
comment on function app.assistant_usage_status(uuid) is
  'Niva for admins (0617): {used, limit, month} for the current month, without counting a use.';
comment on function app.assistant_log_message(uuid, uuid, text, text, text) is
  'Niva for admins (0617): add a line to the person''s own conversation (role user | assistant | tool). Kept 30 days.';
