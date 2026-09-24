-- Onboarding · stream o-platform · 1 of 4: access requests (ONBOARDING_PLAN §3, §6 "Requests").
--
--   app.access_requests            the public "Request access" form's rows; written only by
--                                  app.submit_access_request (anon, rate-limited) and decided by
--                                  platform admins through app.decide_access_request.
--   app.public_rate_events         one row per anonymous attempt that counts toward a rate limit
--                                  (hashed subjects only; no policies, reached only through RPCs).
--   app.platform_send_message(...) Community Connect's own emails (p_center = null) through the
--                                  messaging stream's app.enqueue_message when it exists; otherwise
--                                  it says honestly that email sending is not set up.
--   app.submit_access_request(...) anon: validates and inserts one request. The honeypot field is
--                                  checked by the portal route; this function enforces the limits:
--                                  5 per hour per address, 3 per day per email, 200 per hour overall.
--   app.decide_access_request(...) platform admins: approve (issues the sandbox code, 0201),
--                                  decline (the contact gets the reason) or ask for more information.
set client_min_messages = warning;

create table if not exists app.access_requests (
  id                 uuid primary key default gen_random_uuid(),
  org_legal_name     text not null check (length(btrim(org_legal_name)) between 2 and 200),
  org_type           text not null check (org_type in ('temple','community_center','other_nonprofit')),
  city               text not null check (length(btrim(city)) between 1 and 100),
  state              text not null check (length(btrim(state)) between 2 and 60),
  approx_households  int check (approx_households is null or approx_households between 0 and 1000000),
  contact_name       text not null check (length(btrim(contact_name)) between 2 and 120),
  contact_email      text not null check (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and contact_email = lower(contact_email)),
  contact_phone      text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  website            text check (website is null or length(website) <= 300),
  modules_interested text[] not null default '{}',
  current_systems    text[] not null default '{}',
  heard_from         text check (heard_from is null or length(heard_from) <= 300),
  status             text not null default 'new' check (status in ('new','more_info','approved','declined')),
  decided_by         uuid references auth.users(id),
  decided_at         timestamptz,
  decision_note      text check (decision_note is null or length(decision_note) <= 2000),
  -- What happened to the last email about a decision: queued | not_set_up | failed: <why>.
  decision_email_status text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  ip                 inet,
  user_agent         text check (user_agent is null or length(user_agent) <= 500)
);
comment on table app.access_requests is
  'Public "Request access" submissions (ONBOARDING_PLAN §3). Inserted only by app.submit_access_request; decided by platform admins.';
create index if not exists access_requests_status_idx on app.access_requests (status, created_at desc);
create index if not exists access_requests_email_idx on app.access_requests (contact_email, created_at desc);

create or replace function app.access_requests_stamp() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists access_requests_stamp on app.access_requests;
create trigger access_requests_stamp before update on app.access_requests
  for each row execute function app.access_requests_stamp();

alter table app.access_requests enable row level security;
drop policy if exists access_requests_platform_read on app.access_requests;
create policy access_requests_platform_read on app.access_requests for select to authenticated
  using (app.is_platform_admin());
-- No write policies: rows change only through the functions below.
revoke all on app.access_requests from anon;
revoke insert, update, delete, truncate on app.access_requests from authenticated;
grant select on app.access_requests to authenticated;
grant all on app.access_requests to service_role;

drop trigger if exists audit_access_requests on app.access_requests;
create trigger audit_access_requests after insert or update or delete on app.access_requests
  for each row execute function app.audit_row();

-- ── Rate limits for anonymous functions ──────────────────────────────────────
create table if not exists app.public_rate_events (
  id       bigserial primary key,
  kind     text not null check (kind ~ '^[a-z_.]+$'),
  subject  text not null,           -- a sha-256 hex digest, never the address itself
  at       timestamptz not null default now()
);
comment on table app.public_rate_events is
  'Attempts counted toward the anonymous rate limits (access requests, sandbox-code checks). Subjects are hashed.';
create index if not exists public_rate_events_idx on app.public_rate_events (kind, subject, at desc);
alter table app.public_rate_events enable row level security;
revoke all on app.public_rate_events from anon, authenticated;
grant all on app.public_rate_events to service_role;
grant usage on sequence app.public_rate_events_id_seq to service_role;
drop trigger if exists audit_public_rate_events on app.public_rate_events;
create trigger audit_public_rate_events after insert or update or delete on app.public_rate_events
  for each row execute function app.audit_row();

insert into app.module_tables (table_name, module_key) values ('access_requests', null), ('public_rate_events', null)
on conflict (table_name) do update set module_key = excluded.module_key;

create or replace function app.rate_subject(p_value text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select encode(extensions.digest(coalesce(lower(btrim(p_value)), ''), 'sha256'), 'hex')
$$;

-- True when `subject` has reached `p_max` attempts of `kind` inside the window.
create or replace function app.rate_limited(p_kind text, p_subject text, p_window interval, p_max int) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select count(*) >= p_max from app.public_rate_events
   where kind = p_kind and subject = app.rate_subject(p_subject) and at > now() - p_window
$$;

create or replace function app.rate_note(p_kind text, p_subject text) returns void
language sql security definer set search_path = app, public, extensions as $$
  insert into app.public_rate_events (kind, subject) values (p_kind, app.rate_subject(p_subject))
$$;

-- The caller's address: the one the portal passed (the browser's), else the
-- request's forwarded address. An unparseable value is ignored.
create or replace function app.caller_ip(p_ip text) returns inet
language plpgsql set search_path = app, public, extensions as $$
declare v inet;
begin
  begin
    v := nullif(btrim(split_part(coalesce(p_ip, ''), ',', 1)), '')::inet;
  exception when others then
    v := null;
  end;
  return coalesce(v, (select c.ip from app.audit_context() c));
end $$;

-- ── Community Connect's own emails ───────────────────────────────────────────
-- Messaging (stream o-messaging) owns app.enqueue_message(p_center, p_channel,
-- p_to, p_template_key, p_vars, p_purpose). Until it exists this returns
-- {status: 'not_set_up'}; the CC console then shows the text to send by hand.
-- A refusal (suppression, entitlement) comes back as {status: 'failed', error}.
create or replace function app.platform_send_message(p_to text, p_template text, p_vars jsonb, p_purpose text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid;
begin
  if to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is null then
    return jsonb_build_object('status', 'not_set_up');
  end if;
  begin
    execute 'select app.enqueue_message(null::uuid, ''email'', $1, $2, $3, $4)' into v_id
      using p_to, p_template, coalesce(p_vars, '{}'::jsonb), p_purpose;
  exception when others then
    return jsonb_build_object('status', 'failed', 'error', sqlerrm);
  end;
  return jsonb_build_object('status', 'queued', 'message_id', v_id);
end $$;

create or replace function app.message_status_text(p jsonb) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case p->>'status' when 'failed' then 'failed: ' || coalesce(p->>'error', 'unknown reason') else p->>'status' end
$$;

-- ── Submit (anonymous) ───────────────────────────────────────────────────────
create or replace function app.submit_access_request(
  p_org_legal_name text, p_org_type text, p_city text, p_state text, p_approx_households int,
  p_contact_name text, p_contact_email text, p_contact_phone text default null, p_website text default null,
  p_modules_interested text[] default '{}', p_current_systems text[] default '{}', p_heard_from text default null,
  p_ip text default null, p_user_agent text default null)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_email text := lower(btrim(coalesce(p_contact_email, ''))); v_phone text; v_ip inet; v_id uuid;
        v_modules text[]; v_systems text[];
begin
  v_ip := app.caller_ip(p_ip);
  if app.rate_limited('access_request.all', 'all', interval '1 hour', 200) then
    raise exception 'We are receiving a lot of requests right now. Please try again in an hour.' using errcode = 'CCRTE';
  end if;
  if app.rate_limited('access_request.ip', coalesce(host(v_ip), 'unknown'), interval '1 hour', 5) then
    raise exception 'Too many requests were sent from this connection. Please try again in an hour.' using errcode = 'CCRTE';
  end if;
  if app.rate_limited('access_request.email', v_email, interval '1 day', 3) then
    raise exception 'We already have requests from this email today. We will reply to it; there is no need to send another.' using errcode = 'CCRTE';
  end if;

  if length(btrim(coalesce(p_org_legal_name, ''))) < 2 then raise exception 'Enter the organization''s legal name.'; end if;
  if coalesce(p_org_type, '') not in ('temple','community_center','other_nonprofit') then
    raise exception 'Choose the kind of organization: temple, community center or other non-profit.';
  end if;
  if length(btrim(coalesce(p_city, ''))) < 1 or length(btrim(coalesce(p_state, ''))) < 2 then raise exception 'Enter the city and state.'; end if;
  if p_approx_households is not null and (p_approx_households < 0 or p_approx_households > 1000000) then
    raise exception 'Enter roughly how many households, as a number.';
  end if;
  if length(btrim(coalesce(p_contact_name, ''))) < 2 then raise exception 'Enter your name.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right.'; end if;
  v_phone := nullif(regexp_replace(coalesce(p_contact_phone, ''), '[\s().-]', '', 'g'), '');
  if v_phone is not null and v_phone ~ '^[0-9]{10}$' then v_phone := '+1' || v_phone; end if;
  if v_phone is not null and v_phone ~ '^1[0-9]{10}$' then v_phone := '+' || v_phone; end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the mobile number with its area code, for example (713) 555-0142.';
  end if;
  select coalesce(array_agg(distinct m order by m), '{}') into v_modules
    from unnest(coalesce(p_modules_interested, '{}')) m where m in (select key from app.modules);
  select coalesce(array_agg(distinct left(btrim(s), 60)), '{}') into v_systems
    from unnest(coalesce(p_current_systems, '{}')) s where btrim(s) <> '';
  if cardinality(v_systems) > 20 then raise exception 'List at most 20 current systems.'; end if;

  perform app.set_audit_context('Access request from ' || btrim(p_org_legal_name));
  insert into app.access_requests (org_legal_name, org_type, city, state, approx_households, contact_name, contact_email,
                                   contact_phone, website, modules_interested, current_systems, heard_from, ip, user_agent)
  values (btrim(p_org_legal_name), p_org_type, btrim(p_city), btrim(p_state), p_approx_households, btrim(p_contact_name), v_email,
          v_phone, nullif(left(btrim(coalesce(p_website, '')), 300), ''), v_modules, v_systems,
          nullif(left(btrim(coalesce(p_heard_from, '')), 300), ''), v_ip,
          left(nullif(btrim(coalesce(p_user_agent, (select c.user_agent from app.audit_context() c), '')), ''), 500))
  returning id into v_id;
  perform app.rate_note('access_request.all', 'all');
  perform app.rate_note('access_request.ip', coalesce(host(v_ip), 'unknown'));
  perform app.rate_note('access_request.email', v_email);
  return v_id;
end $$;

-- ── Decide (platform admins) ─────────────────────────────────────────────────
-- 'approve' issues the sandbox code (app.issue_sandbox_code, 0201) and returns
-- it once; 'decline' and 'more_info' need a note, which is emailed to the contact.
create or replace function app.decide_access_request(p_request uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.access_requests; v_note text := app.audit_clean_reason(p_note); v_mail jsonb; v_code record;
begin
  if not app.is_platform_admin() then
    raise exception 'Only the Community Connect team decides access requests.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from app.access_requests where id = p_request for update;
  if r.id is null then raise exception 'That access request was not found.'; end if;
  if p_decision not in ('approve','decline','more_info') then raise exception 'Choose approve, decline or ask for more information.'; end if;
  if r.status in ('approved','declined') then
    raise exception 'This request was already %. Use Sandbox codes to re-issue or revoke its code.', r.status;
  end if;
  if p_decision in ('decline','more_info') and v_note is null then
    raise exception '%', case p_decision when 'decline' then 'Give the reason for declining. The contact receives it.'
                               else 'Write the question for the contact. They receive it by email.' end;
  end if;

  perform app.set_audit_context(coalesce(v_note, case p_decision when 'approve' then 'Access request approved' end));
  if p_decision = 'approve' then
    update app.access_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where id = p_request;
    select * into v_code from app.issue_sandbox_code(p_request, coalesce(v_note, 'Access request approved'));
    return jsonb_build_object('status', 'approved', 'code_id', v_code.code_id, 'code', v_code.code, 'expires_at', v_code.expires_at,
                              'email_status', v_code.email_status);
  end if;

  v_mail := app.platform_send_message(r.contact_email, case p_decision when 'decline' then 'request_declined' else 'request_more_info' end,
              jsonb_build_object('contact_name', r.contact_name, 'org_name', r.org_legal_name,
                                 case p_decision when 'decline' then 'reason' else 'question' end, v_note),
              'notification');
  update app.access_requests
     set status = case p_decision when 'decline' then 'declined' else 'more_info' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = v_note, decision_email_status = app.message_status_text(v_mail)
   where id = p_request;
  return jsonb_build_object('status', case p_decision when 'decline' then 'declined' else 'more_info' end,
                            'email_status', app.message_status_text(v_mail));
end $$;

-- ── Access ───────────────────────────────────────────────────────────────────
revoke execute on function app.rate_subject(text), app.rate_limited(text, text, interval, int), app.rate_note(text, text),
  app.caller_ip(text), app.platform_send_message(text, text, jsonb, text), app.message_status_text(jsonb),
  app.access_requests_stamp()
  from public, anon, authenticated;
revoke execute on function app.submit_access_request(text, text, text, text, int, text, text, text, text, text[], text[], text, text, text),
  app.decide_access_request(uuid, text, text) from public;
grant execute on function app.submit_access_request(text, text, text, text, int, text, text, text, text, text[], text[], text, text, text)
  to anon, authenticated;
grant execute on function app.decide_access_request(uuid, text, text) to authenticated;
grant execute on all functions in schema app to service_role;
