-- 0920 · CatchTheMatch Phase 1, piece 0: ask the adults of donor families for their employer (docs/CATCH_THE_MATCH.md section 13;
-- owner request of 2026-10-17). NEEDS OWNER OK: messaging, personal data.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   THE AUDIENCE (app._match_ask_base, app.match_employer_ask_list)
--       The adults (never under 18, never deceased, never a merged record) of every household that has a gift that went through in
--       the last 24 months (app._match_gifts, 0886: completed, less refunds, no opening balance, no history import, no fee), who have
--       NO employer record at all: a person with an employer on file is not asked; a person who WITHDREW their employer is never
--       asked again (the withdrawn row stays and keeps them out); a person asked in the last 90 days is not asked again. Each person
--       is also told apart by how they can be reached today (email on file that is not suppressed and not opted out; a login with the
--       member app on a phone and the topic switched on), so staff see how many a send would reach and how many it cannot.
--       Staff with matching.manage (the organization's own, 0757's contract: never a platform admin, never the filing grant) read the
--       counts and the list; the household shows as its card (app._care_household_head), never a name alone; no address is returned,
--       no amount, no gift. The read is logged (app.log_private_read).
--   THE ASK (app.ask_match_employers)
--       Sends the message through the EXISTING messaging pipeline (app.enqueue_notice): the sandbox's verified-recipient rule
--       (messaging.recipients), suppressions, bounces, opt-outs, the member's own topic switch, quiet hours for the push, the
--       deceased rule, the delivery webhook. The wording is the owner's: "You may be eligible to double the donation from your employer
--       if you provide your employer information." No amount and no gift detail. It carries a link to the member app screen where
--       the person adds their employer, with their consent (0759). The message only ASKS: nothing is put on file by it.
--       At most 300 people per call; a second click finds the first call's asks (the audience excludes them), and a per-community lock
--       makes two clicks at once send one set. Each person and channel is recorded in app.match_employer_asks with what happened to it
--       (queued, or why not, in plain words and without the address). "Queued" is not "sent": the message row carries the real
--       outcome (Settings › Email › Recent emails). The portal refuses before calling this when the email provider is not set up.
--   app.match_employer_asks   one row per person and channel asked: who asked, when, the message, queued or not and why. The
--       organization's own data under 0757's contract: module 'matching', its own readers, adults only, a restrictive module_switch
--       with no platform-admin pass, the private audit (app.audit_private_row: text columns are masked in the log).
--   A new notification topic, 'matching' (Employer gift matching), on by default, which a member can switch off in the app. It is a
--   marketing topic: the email path also leaves out a person who withdrew their marketing_email consent.
set client_min_messages = warning;

-- ── The topic and the wording ────────────────────────────────────────────────
insert into app.notification_topics (key, name, default_on, marketing, has_sender) values
  ('matching', 'Employer gift matching', true, true, true)
on conflict (key) do nothing;

insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('match_employer_ask', 'email', 'Could your employer double your donation to {{center_name}}?',
   E'Hello {{first_name}},\n\nYou may be eligible to double the donation from your employer if you provide your employer information.\n\nIt takes a minute. Open the member app and go to "Does your employer match?" to tell us where you work. It is your choice: you can add it, change it or remove it whenever you like, and we use it only to help you ask for a match.\n\n%MEMBER_APP_URL%/matching\n\nIf you would rather not, you can ignore this message.\n\n{{center_name}}'),
  ('match_employer_ask', 'push', 'Could your employer double your donation?',
   'You may be eligible to double the donation from your employer if you provide your employer information.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ── What was asked of whom ───────────────────────────────────────────────────
create table if not exists app.match_employer_asks (
  id         uuid primary key default gen_random_uuid(),
  center_id  uuid not null references app.centers(id) on delete cascade,
  person_id  uuid not null references app.people(id) on delete cascade,
  channel    text not null check (channel in ('email', 'push')),
  asked_at   timestamptz not null default now(),
  asked_by   uuid references auth.users(id),
  message_id uuid references app.messages(id) on delete set null,
  queued     boolean not null,
  reason     text check (reason is null or char_length(reason) <= 300),
  constraint match_employer_asks_reason check (queued = (reason is null))
);
create index if not exists match_employer_asks_person_idx on app.match_employer_asks (center_id, person_id, asked_at desc);
comment on table app.match_employer_asks is
  'One row per adult and channel asked to give their employer for gift matching (0920): who asked, when, the message, whether it was queued and, if not, why in plain words (never the address). The organization''s own data: its CatchTheMatch readers only, no platform-admin read, a private audit. A person with a queued ask in the last 90 days is not asked again. Written only by app.ask_match_employers.';

drop trigger if exists audit_match_employer_asks on app.match_employer_asks;
create trigger audit_match_employer_asks after insert or update or delete on app.match_employer_asks
  for each row execute function app.audit_private_row('matching');
insert into app.module_tables (table_name, module_key) values ('match_employer_asks', 'matching')
  on conflict (table_name) do update set module_key = excluded.module_key;

create or replace function app.match_ask_readable(p_center uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select app._matching_org_can(p_center) and not app.person_is_minor(p_person)
$$;
revoke execute on function app.match_ask_readable(uuid, uuid) from public, anon;
grant execute on function app.match_ask_readable(uuid, uuid) to authenticated;

alter table app.match_employer_asks enable row level security;
drop policy if exists match_employer_asks_read on app.match_employer_asks;
create policy match_employer_asks_read on app.match_employer_asks for select to authenticated
  using (center_id = any ((select app.matching_org_readable_centers())::uuid[]) and app.match_ask_readable(center_id, person_id));
drop policy if exists module_switch on app.match_employer_asks;
create policy module_switch on app.match_employer_asks as restrictive for all to public
  using (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])))
  with check (center_id is null or not (center_id = any ((select app.module_off_centers('matching'))::uuid[])));
revoke all on app.match_employer_asks from public, anon, authenticated;
grant select on app.match_employer_asks to authenticated;
grant all on app.match_employer_asks to service_role;

-- ── How one adult can be reached today ───────────────────────────────────────
-- email: the address on file (lower case) or null. email_ok: it looks like an address, is not suppressed, not unsubscribed from
-- announcements, not opted out at that address, and the person has not withdrawn their marketing_email consent (the latest answer wins;
-- no answer is yes). app_ok: a login in this community with a working phone, and the topic "matching" not switched off for push.
-- Internal: the audience, the ask and the claim message (0921) call it; the messaging queue applies the same rules again when it queues.
create or replace function app._match_reach(p_center uuid, p_person uuid)
returns table (email text, email_ok boolean, app_ok boolean, user_id uuid)
language sql stable security definer set search_path = app, public, extensions as $$
  with a as (
    select nullif(lower(btrim(coalesce(p.email::text, ''))), '') as email
      from app.people p where p.id = p_person and p.center_id = p_center
  ),
  u as (
    select cu.user_id,
           exists (select 1 from app.push_devices d where d.user_id = cu.user_id and d.invalid_at is null) as phone
      from app.center_users cu where cu.center_id = p_center and cu.person_id = p_person limit 1
  )
  select a.email,
         (coalesce(a.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', false)
          and (app.message_suppression_for(p_center, 'email', a.email)).id is null
          and (app.message_newsletter_suppression_for(p_center, 'email', a.email)).id is null
          and not coalesce((select not o.opted_in from app.channel_optins o
                             where o.center_id = p_center and o.channel = 'email' and lower(btrim(o.address)) = a.email
                             order by o.recorded_at desc limit 1), false)
          and coalesce((select cs.granted from app.consents cs where cs.person_id = p_person and cs.kind = 'marketing_email'
                         order by cs.recorded_at desc limit 1), true)),
         coalesce((select u.phone from u), false) and app._notice_topic_on(p_person, 'matching', 'push'),
         (select u.user_id from u)
    from a
$$;
revoke execute on function app._match_reach(uuid, uuid) from public, anon, authenticated;

-- ── The adults of donor households and where each stands ─────────────────────
-- state: ask (to be asked), on_file (an employer is on file), withdrew (they withdrew it: never asked again), recent (asked in the
-- last 90 days). email_ok / app_ok: how they can be reached today. Internal: the reads and the send call it after their checks.
create or replace function app._match_ask_base(p_center uuid)
returns table (person_id uuid, household_id uuid, state text, email_ok boolean, app_ok boolean, last_asked timestamptz)
language sql stable security definer set search_path = app, public, extensions as $$
  with hh as (
    select distinct g.household_id
      from app._match_gifts(p_center) g
     where g.household_id is not null and g.received_on > app._match_today(p_center) - 730
  ),
  adults as (
    select distinct on (p.id) p.id as person_id, hm.household_id
      from hh
      join app.households h on h.id = hh.household_id and h.center_id = p_center and h.merged_into_id is null
      join app.household_members hm on hm.household_id = hh.household_id and hm.left_at is null
      join app.people p on p.id = hm.person_id
     where p.center_id = p_center and p.merged_into_id is null and p.deceased_on is null and not coalesce(p.is_deceased, false)
       and not app.person_is_minor(p.id)
     order by p.id, hm.is_primary desc, hm.household_id
  )
  select a.person_id, a.household_id,
         case when e.person_id is not null and e.withdrawn_at is not null then 'withdrew'
              when e.person_id is not null then 'on_file'
              when k.last_queued > now() - interval '90 days' then 'recent'
              else 'ask' end,
         r.email_ok, r.app_ok, k.last_asked
    from adults a
    cross join lateral app._match_reach(p_center, a.person_id) r
    left join app.person_match_employers e on e.person_id = a.person_id
    left join lateral (select max(x.asked_at) filter (where x.queued) as last_queued, max(x.asked_at) as last_asked
                         from app.match_employer_asks x where x.person_id = a.person_id) k on true
$$;
revoke execute on function app._match_ask_base(uuid) from public, anon, authenticated;


-- ── Staff: the counts and the list ───────────────────────────────────────────
-- The people a send would ask now (state ask), most reachable first, with how each can be reached and when they were asked before.
-- No address, no amount, no gift: the household card and booleans. The organization's own matching.manage holders; logged.
create or replace function app.match_employer_ask_list(p_center uuid, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_counts jsonb; v_total int; v_rows jsonb;
begin
  perform app._match_manager_or_raise(p_center);
  with b as materialized (select * from app._match_ask_base(p_center)),
  shown as (
    select b.*, row_number() over (order by (b.email_ok or b.app_ok) desc, lower(app._care_person_name(b.person_id)), b.person_id) as ord
      from b where b.state = 'ask'
  ),
  pg as (select * from shown order by ord
          limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0))
  select jsonb_build_object(
           'people', (select count(*) from b),
           'to_ask', (select count(*) from b where state = 'ask'),
           'email', (select count(*) from b where state = 'ask' and email_ok),
           'app', (select count(*) from b where state = 'ask' and app_ok),
           'nobody', (select count(*) from b where state = 'ask' and not email_ok and not app_ok),
           'on_file', (select count(*) from b where state = 'on_file'),
           'withdrew', (select count(*) from b where state = 'withdrew'),
           'recent', (select count(*) from b where state = 'recent')),
         (select count(*) from shown),
         coalesce((select jsonb_agg(jsonb_build_object(
             'person', jsonb_build_object('id', x.person_id, 'name', app._care_person_name(x.person_id)),
             'household', app._care_household_head(x.household_id),
             'email', x.email_ok, 'app', x.app_ok, 'last_asked', x.last_asked) order by x.ord) from pg x), '[]'::jsonb)
    into v_counts, v_total, v_rows;
  perform app.log_private_read(p_center, 'matching', 'employer_ask_list', jsonb_array_length(v_rows));
  return jsonb_build_object('total', v_total, 'rows', v_rows, 'counts', v_counts, 'today', app._match_today(p_center),
                            'sandbox', coalesce((select c.environment = 'sandbox' from app.centers c where c.id = p_center), false));
end $$;

-- ── Staff: ask ───────────────────────────────────────────────────────────────
-- Asks the people in the audience (all of them, up to 300, or just the people named). Each person is reached by email, by the member
-- app, or both. Returns the counts; "queued" means handed to the messaging queue, not delivered.
create or replace function app._match_ask_reason(p_why text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case
    when p_why ilike '%opted out%' then 'The person opted out of these messages.'
    when p_why ilike '%unsubscribed%' then 'The person unsubscribed from newsletters and announcements.'
    when p_why ilike '%suppressed%' then 'The address is suppressed (it bounced, a spam complaint, STOP or added by staff).'
    when p_why ilike '%deceased%' then 'The person is recorded as deceased.'
    else 'The message could not be queued.' end
$$;
revoke execute on function app._match_ask_reason(text) from public, anon, authenticated;

create or replace function app.ask_match_employers(p_center uuid, p_people uuid[] default null, p_limit int default 300) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  r record; v_cap int := least(greatest(coalesce(p_limit, 300), 1), 300);
  v_done int := 0; v_left int := 0; v_nobody int := 0; v_asked int := 0; v_email int := 0; v_push int := 0; v_matched int := 0;
  v_not jsonb := '{}'::jsonb; v_id uuid; v_status text; v_why text; v_reason text; v_any boolean; v_vars jsonb;
  v_sandbox constant text := 'This community is a sandbox: it messages only verified test recipients (Settings › Limits).';
  v_failed constant text := 'The message could not be queued.';
begin
  perform app._match_manager_or_raise(p_center);
  -- Two clicks at once ask each person once: the second waits, then finds the first one's asks and leaves those people out.
  perform pg_advisory_xact_lock(hashtextextended('app.ask_match_employers:' || p_center::text, 0));
  perform app.set_audit_context('Asked members for their employer for gift matching');
  for r in
    select b.person_id, b.email_ok, b.app_ok, coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) as first_name,
           nullif(lower(btrim(coalesce(pe.language, ''))), '') as language, nullif(lower(btrim(coalesce(pe.email::text, ''))), '') as email,
           (select cu.user_id from app.center_users cu where cu.center_id = p_center and cu.person_id = b.person_id limit 1) as user_id
      from app._match_ask_base(p_center) b
      join app.people pe on pe.id = b.person_id
     where b.state = 'ask' and (p_people is null or b.person_id = any (p_people))
     order by b.last_asked nulls first, b.person_id
  loop
    v_matched := v_matched + 1;
    if not (r.email_ok or r.app_ok) then v_nobody := v_nobody + 1; continue; end if;
    if v_done >= v_cap then v_left := v_left + 1; continue; end if;
    v_done := v_done + 1;
    v_any := false;
    v_vars := jsonb_build_object('first_name', r.first_name, 'person_id', r.person_id::text) ||
              case when r.language is not null then jsonb_build_object('language', r.language) else '{}'::jsonb end;
    if r.email_ok then
      v_id := null; v_reason := null;
      begin
        v_id := app.enqueue_notice(p_center, 'email', r.email, 'match_employer_ask', v_vars, 'notification', now(), 'matching', null,
                                   jsonb_build_object('type', 'match_ask', 'deep_link', '/matching'), false);
        select m.status, m.failure_reason into v_status, v_why from app.messages m where m.id = v_id;
        if v_status is distinct from 'queued' then v_reason := app._match_ask_reason(v_why); end if;
      exception when others then
        v_id := null;
        v_reason := case when sqlstate = 'CCENT' then v_sandbox else v_failed end;
      end;
      insert into app.match_employer_asks (center_id, person_id, channel, asked_by, message_id, queued, reason)
      values (p_center, r.person_id, 'email', auth.uid(), v_id, v_reason is null, v_reason);
      if v_reason is null then
        v_email := v_email + 1; v_any := true;
      else
        v_not := jsonb_set(v_not, array[v_reason], to_jsonb(coalesce((v_not ->> v_reason)::int, 0) + 1));
      end if;
    end if;
    if r.app_ok and r.user_id is not null then
      v_id := null; v_reason := null;
      begin
        v_id := app.enqueue_notice(p_center, 'push', r.user_id::text, 'match_employer_ask', v_vars, 'notification', now(), 'matching', null,
                                   jsonb_build_object('type', 'match_ask', 'deep_link', '/matching'), false);
        select m.status, m.failure_reason into v_status, v_why from app.messages m where m.id = v_id;
        if v_status is distinct from 'queued' then v_reason := app._match_ask_reason(v_why); end if;
      exception when others then
        v_id := null;
        v_reason := case when sqlstate = 'CCENT' then v_sandbox else v_failed end;
      end;
      insert into app.match_employer_asks (center_id, person_id, channel, asked_by, message_id, queued, reason)
      values (p_center, r.person_id, 'push', auth.uid(), v_id, v_reason is null, v_reason);
      if v_reason is null then
        v_push := v_push + 1; v_any := true;
      else
        v_not := jsonb_set(v_not, array[v_reason], to_jsonb(coalesce((v_not ->> v_reason)::int, 0) + 1));
      end if;
    end if;
    if v_any then v_asked := v_asked + 1; end if;
  end loop;
  return jsonb_build_object('asked', v_asked, 'email', v_email, 'push', v_push, 'not_queued', v_not, 'nobody', v_nobody, 'left', v_left,
                            'not_in_audience', case when p_people is null then 0 else greatest(cardinality(p_people) - v_matched, 0) end);
end $$;

revoke execute on function app.match_employer_ask_list(uuid, int, int), app.ask_match_employers(uuid, uuid[], int) from public, anon;
grant execute on function app.match_employer_ask_list(uuid, int, int), app.ask_match_employers(uuid, uuid[], int) to authenticated, service_role;

-- ── The screen (the activity catalog lists every tab: 0620) ──────────────────
select app.activity_register('screen:/giving/matching/ask', 'screen', 'portal', 'Gift matching: ask families for their employer');
