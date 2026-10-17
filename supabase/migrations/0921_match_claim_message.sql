-- 0921 · CatchTheMatch Phase 1, piece 1: "Send to the member" (docs/CATCH_THE_MATCH.md section 13; owner request of 2026-10-17).
-- NEEDS OWNER OK: messaging.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Until now staff copied the message built from the library and sent it their own way (src/lib/matching/catch.ts buildMessage). Now a
--   CatchTheMatch manager can send it from Giving › Gift matching › To catch, after seeing the exact text, THROUGH THE EXISTING MESSAGING
--   QUEUE (app.enqueue_notice): the sandbox's verified-recipient rule, suppressions and bounces, opt-outs, the member's own topic switch,
--   quiet hours for the push, the deceased rule and the delivery webhook all apply unchanged. The text is built IN THE DATABASE from the
--   library, never taken from the screen, so matching.manage cannot be used to send anything else to a member. No amount, ever: the
--   message carries the gift's day and the last day to ask, the steps from the library and the organization's registered name.
--     app.match_claim_message_preview(center, person, program)  the exact subject and text that would go, how the person can be reached
--                                                                (booleans, no address) and, when it cannot go, why in words. Logged read.
--     app.send_match_claim_message(center, person, program)     queues it (email, and a push when the person has the app), makes a claim
--                                                                "asked" for each gift that had none, and RECORDS ON EACH CLAIM THAT IT WAS
--                                                                ASKED BY MESSAGE (asked_by_message_at, asked_message_id). Nothing is
--                                                                recorded unless something was queued: a message that could not be queued
--                                                                leaves the claims as they were and says why. A claim already asked by
--                                                                message is not messaged again for 14 days (then it is a reminder).
--   app.match_claims gains asked_by_message_at / asked_message_id; app.match_claims_list shows when. Template match_claim_ask (email and
--   push; a community may override them). The portal refuses before queueing anything when this server cannot send email (backlog B116).
set client_min_messages = warning;

alter table app.match_claims add column if not exists asked_by_message_at timestamptz;
alter table app.match_claims add column if not exists asked_message_id uuid references app.messages(id) on delete set null;
comment on column app.match_claims.asked_by_message_at is 'When the member was asked to claim by a message sent from Weaver (0921), null when staff asked another way. Set only by app.send_match_claim_message.';
comment on column app.match_claims.asked_message_id is 'The message queued to ask the member (0921); null if it was deleted by retention. Set only by app.send_match_claim_message.';

-- ── The wording (a community may override it) ────────────────────────────────
-- The push says "your employer", never its name: a notification can be read on a locked screen.
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('match_claim_ask', 'email', 'How to ask {{employer}} to match your gift to {{center_name}}',
   E'Hello {{first_name}},\n\n{{message}}\n\nThank you,\n{{center_name}}'),
  ('match_claim_ask', 'push', 'Could your employer match your gift?',
   'Open the app to see how to ask your employer to match your gift to {{center_name}}.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- ── The gifts a message may ask about ────────────────────────────────────────
-- The person's gifts for this program that can still be claimed: no claim yet, or a claim "asked" that no message went for (or not in
-- the last 14 days), and not past the program's deadline.
create or replace function app._match_claim_gifts(p_center uuid, p_person uuid, p_program uuid)
returns table (payment_id uuid, received_on date, deadline_on date, claim_id uuid)
language sql stable security definer set search_path = app, public, extensions as $$
  select c.payment_id, c.received_on, c.deadline_on, c.claim_id
    from app._match_catch(p_center) c
    left join app.match_claims mc on mc.id = c.claim_id
   where c.person_id = p_person
     and c.program_id = (select g.id from app._match_program_current(p_program) g)
     and (c.deadline_on is null or c.deadline_on >= app._match_today(p_center))
     and (c.claim_id is null
          or (c.claim_state = 'asked' and (mc.asked_by_message_at is null or mc.asked_by_message_at < now() - interval '14 days')))
$$;
revoke execute on function app._match_claim_gifts(uuid, uuid, uuid) from public, anon, authenticated;

-- ── The text: the same words as src/lib/matching/catch.ts buildMessage (the greeting and the signature are the template's) ──
create or replace function app._match_claim_message_text(p_center uuid, p_person uuid, p_program uuid) returns text
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  g app.match_programs; pr app.match_processes; v_org text; v_legal text; v_ein text; v_employer text; v_text text; v_url text; r record;
begin
  select * into g from app._match_program_current(p_program) x;
  select * into pr from app.match_processes p
   where p.program_id in (select y.id from app.match_programs y where y.id = g.id or y.merged_into = g.id)
   order by (p.program_id = g.id) desc limit 1;
  select c.name, o.legal_name, o.ein into v_org, v_legal, v_ein from app.centers c left join app.org_profiles o on o.center_id = c.id where c.id = p_center;
  select e.employer_name into v_employer from app.person_match_employers e where e.person_id = p_person and e.withdrawn_at is null;
  v_text := 'Thank you for your gift to ' || v_org || '. ' || coalesce(v_employer, g.company_name)
            || ' may match it: other members who work there have had a match paid to us, and yours can be claimed too.' || E'\n\n';
  for r in select * from app._match_claim_gifts(p_center, p_person, p_program) order by received_on desc loop
    v_text := v_text || 'Your gift of ' || to_char(r.received_on, 'FMDD FMMonth YYYY')
              || case when r.deadline_on is not null then ' (ask by ' || to_char(r.deadline_on, 'FMDD FMMonth YYYY') || ')' else '' end || E'\n';
  end loop;
  v_text := v_text || E'\n';
  if pr.program_id is not null then
    v_text := v_text || case pr.who_submits
                          when 'organization' then 'The organization makes the request'
                          when 'either' then 'Either the member or the organization can make the request'
                          else 'The member makes the request' end || '. ' || pr.summary || E'\n\nHow:\n';
    for r in select s.step, s.n from unnest(pr.steps) with ordinality as s(step, n) order by s.n loop
      v_text := v_text || r.n || '. ' || r.step || E'\n';
    end loop;
    if cardinality(pr.documents) > 0 then v_text := v_text || E'\nHave ready: ' || array_to_string(pr.documents, '; ') || E'.\n'; end if;
    if pr.typical_days is not null then
      v_text := v_text || E'\nIt usually takes about ' || pr.typical_days || case when pr.typical_days = 1 then ' day' else ' days' end || E'.\n';
    end if;
    if pr.tips is not null then v_text := v_text || E'\n' || pr.tips || E'\n'; end if;
  else
    v_text := v_text || 'Please ask ' || g.company_name
              || E'''s matching program (usually through human resources or the company''s giving portal). We are happy to help you find it.\n';
  end if;
  v_url := coalesce(g.portal_url, (pr.links -> 0 ->> 'url'));
  if v_url is not null then v_text := v_text || E'\nWhere to ask: ' || v_url || E'\n'; end if;
  v_text := v_text || E'\nPlease use our registered name' || case when v_ein is not null then ' and tax ID' else '' end || ': '
            || coalesce(v_legal, v_org) || case when v_ein is not null then ', tax ID ' || v_ein else '' end || E'.\n';
  v_text := v_text || E'\nIf anything is unclear, reply and we will help.';
  -- A template token inside library text must stay text.
  return replace(v_text, '{{', '{ {');
end $$;
revoke execute on function app._match_claim_message_text(uuid, uuid, uuid) from public, anon, authenticated;

-- ── What would go, to whom, and whether it can ───────────────────────────────
-- {problem, program_id, first_name, employer, language, gifts, message, subject, body, email, app}. problem is a sentence when it cannot go.
create or replace function app._match_claim_prepare(p_center uuid, p_person uuid, p_program uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  g app.match_programs; pe app.people; v_employer text; v_gifts jsonb; v_reach record; v_message text; v_vars jsonb; v_rendered jsonb;
  v_problem text; v_sandbox boolean;
begin
  select * into pe from app.people where id = p_person and center_id = p_center;
  if pe.id is null or app.person_is_minor(p_person) then raise exception 'That person was not found.' using errcode = '22023'; end if;
  select * into g from app._match_program_current(p_program) x;
  if g.id is null then raise exception 'That employer program was not found.' using errcode = '22023'; end if;
  select e.employer_name into v_employer from app.person_match_employers e where e.person_id = p_person and e.withdrawn_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('payment_id', x.payment_id, 'received_on', x.received_on, 'deadline_on', x.deadline_on)
                            order by x.received_on desc), '[]'::jsonb)
    into v_gifts from app._match_claim_gifts(p_center, p_person, g.id) x;
  select * into v_reach from app._match_reach(p_center, p_person);
  if v_employer is null or not exists (select 1 from app.person_match_programs l cross join lateral app._match_program_current(l.program_id) x
                                        where l.person_id = p_person and l.center_id = p_center and x.id = g.id) then
    v_problem := 'This person''s employer is not confirmed as ' || g.company_name || '. Confirm it under Employers on file first.';
  elsif pe.is_deceased or pe.deceased_on is not null or pe.merged_into_id is not null then
    v_problem := 'This person''s record is closed (deceased or merged), so nothing is sent to them.';
  elsif jsonb_array_length(v_gifts) = 0 then
    v_problem := 'Nothing is left to ask for: this person has no gift that can still be claimed, or each one was asked about by message in the last 14 days.';
  elsif not (coalesce(v_reach.email_ok, false) or coalesce(v_reach.app_ok, false)) then
    v_problem := 'There is no way to reach this person from Weaver: no email address that can be written to and no member app. Copy the message and send it another way.';
  end if;
  v_message := case when v_problem is null or jsonb_array_length(v_gifts) > 0 then app._match_claim_message_text(p_center, p_person, g.id) end;
  v_vars := jsonb_build_object('first_name', coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name), 'employer', v_employer,
                               'message', v_message, 'person_id', p_person::text)
            || case when nullif(btrim(coalesce(pe.language, '')), '') is not null then jsonb_build_object('language', lower(btrim(pe.language))) else '{}'::jsonb end;
  v_sandbox := coalesce((select c.environment = 'sandbox' from app.centers c where c.id = p_center), false);
  if v_message is not null and v_employer is not null then
    v_rendered := app.message_render(p_center, 'email', 'match_claim_ask', v_vars, false);
  end if;
  return jsonb_build_object('problem', v_problem, 'program_id', g.id, 'company_name', g.company_name, 'employer', v_employer,
                            'gifts', v_gifts, 'vars', v_vars, 'subject', v_rendered ->> 'subject', 'body', v_rendered ->> 'body',
                            'email', coalesce(v_reach.email_ok, false), 'app', coalesce(v_reach.app_ok, false),
                            'email_to', v_reach.email, 'user_id', v_reach.user_id, 'sandbox', v_sandbox);
end $$;
revoke execute on function app._match_claim_prepare(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function app.match_claim_message_preview(p_center uuid, p_person uuid, p_program uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare j jsonb;
begin
  perform app._match_manager_or_raise(p_center);
  j := app._match_claim_prepare(p_center, p_person, p_program);
  perform app.log_private_read(p_center, 'matching', 'claim_message_preview', 1);
  -- No address and no internal id leaves: how the person can be reached, as booleans.
  return jsonb_build_object('problem', j -> 'problem', 'program', jsonb_build_object('id', j -> 'program_id', 'company_name', j -> 'company_name'),
                            'employer', j -> 'employer', 'person', jsonb_build_object('id', p_person, 'name', app._care_person_name(p_person)),
                            'gifts', (select coalesce(jsonb_agg(jsonb_build_object('received_on', e -> 'received_on', 'deadline_on', e -> 'deadline_on')), '[]'::jsonb)
                                        from jsonb_array_elements(j -> 'gifts') e),
                            'subject', j -> 'subject', 'body', j -> 'body', 'email', j -> 'email', 'app', j -> 'app', 'sandbox', j -> 'sandbox');
end $$;

-- ── Send ─────────────────────────────────────────────────────────────────────
create or replace function app.send_match_claim_message(p_center uuid, p_person uuid, p_program uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  j jsonb; v_vars jsonb; v_id uuid; v_email_id uuid; v_push_id uuid; v_status text; v_why text; v_reason text; v_not jsonb := '{}'::jsonb;
  v_email boolean := false; v_push boolean := false; v_program uuid; v_n int := 0; e jsonb;
  v_sandbox constant text := 'This community is a sandbox: it messages only verified test recipients (Settings › Limits).';
  v_failed constant text := 'The message could not be queued.';
begin
  perform app._match_manager_or_raise(p_center);
  -- Two clicks at once send one message: the second waits, then finds the first one's claims asked by message.
  perform pg_advisory_xact_lock(hashtextextended('app.send_match_claim_message:' || p_person::text, 0));
  j := app._match_claim_prepare(p_center, p_person, p_program);
  if j ->> 'problem' is not null then raise exception '%', j ->> 'problem' using errcode = '22023'; end if;
  v_program := (j ->> 'program_id')::uuid;
  v_vars := j -> 'vars';
  perform app.set_audit_context('Sent the gift matching message to a member');

  if (j ->> 'email')::boolean then
    begin
      v_id := app.enqueue_notice(p_center, 'email', j ->> 'email_to', 'match_claim_ask', v_vars, 'notification', now(), 'matching', null,
                                 jsonb_build_object('type', 'match_claim', 'deep_link', '/matching'), false);
      select m.status, m.failure_reason into v_status, v_why from app.messages m where m.id = v_id;
      if v_status is distinct from 'queued' then v_reason := app._match_ask_reason(v_why); else v_email := true; v_email_id := v_id; end if;
    exception when others then
      v_reason := case when sqlstate = 'CCENT' then v_sandbox else v_failed end;
    end;
    if v_reason is not null then v_not := jsonb_set(v_not, array[v_reason], to_jsonb(coalesce((v_not ->> v_reason)::int, 0) + 1)); v_reason := null; end if;
  end if;
  if (j ->> 'app')::boolean then
    begin
      v_id := app.enqueue_notice(p_center, 'push', j ->> 'user_id', 'match_claim_ask', v_vars, 'notification', now(), 'matching', null,
                                 jsonb_build_object('type', 'match_claim', 'deep_link', '/matching'), false);
      select m.status, m.failure_reason into v_status, v_why from app.messages m where m.id = v_id;
      if v_status is distinct from 'queued' then v_reason := app._match_ask_reason(v_why); else v_push := true; v_push_id := v_id; end if;
    exception when others then
      v_reason := case when sqlstate = 'CCENT' then v_sandbox else v_failed end;
    end;
    if v_reason is not null then v_not := jsonb_set(v_not, array[v_reason], to_jsonb(coalesce((v_not ->> v_reason)::int, 0) + 1)); end if;
  end if;

  -- Nothing queued: nothing is recorded, and the caller is told why.
  if not (v_email or v_push) then
    return jsonb_build_object('queued', false, 'email', false, 'push', false, 'not_queued', v_not, 'claims', 0);
  end if;

  -- A claim "asked" for each gift that had none, and every claim records that it was asked by message.
  for e in select * from jsonb_array_elements(j -> 'gifts') loop
    insert into app.match_claims (center_id, person_id, program_id, payment_id, state, state_by, created_by)
    values (p_center, p_person, v_program, (e ->> 'payment_id')::uuid, 'asked', auth.uid(), auth.uid())
    on conflict (payment_id, program_id) do nothing;
    update app.match_claims
       set asked_by_message_at = now(), asked_message_id = coalesce(v_email_id, v_push_id)
     where payment_id = (e ->> 'payment_id')::uuid and program_id = v_program and center_id = p_center and state = 'asked';
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('queued', true, 'email', v_email, 'push', v_push, 'not_queued', v_not, 'claims', v_n);
end $$;

-- ── The claims list shows when a member was asked by message (0888's body plus the one column) ──
create or replace function app.match_claims_list(p_center uuid, p_filter text default 'open', p_limit int default 50,
                                                 p_offset int default 0) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_filter text := case when p_filter in ('open', 'ended') then p_filter else 'open' end;
        v_today date; v_amounts boolean; v_total int; v_rows jsonb; v_states text[];
begin
  perform app._match_org_reader_or_raise(p_center);
  v_today := app._match_today(p_center);
  v_amounts := app.match_amounts_can(p_center);
  v_states := case when v_filter = 'open' then array['asked', 'requested', 'verified']
                   else array['received', 'declined', 'expired', 'withdrawn'] end;
  with base as (
    select c.*, pay.household_id, pay.received_on as gift_on, greatest(pay.amount_cents - pay.refunded_cents, 0)::bigint as gift_cents,
           m.company_name, m.portal, m.portal_url, m.deadline_kind, m.deadline_months, m.deadline_month, m.deadline_day
      from app.match_claims c
      join app.payments pay on pay.id = c.payment_id
      join app.match_programs m on m.id = c.program_id
     where c.center_id = p_center and c.state = any (v_states) and not app.person_is_minor(c.person_id)
  ),
  pg as (select * from base order by state_at desc, id
          limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from base),
         coalesce((select jsonb_agg(jsonb_build_object(
             'id', x.id, 'state', x.state, 'state_at', x.state_at, 'received_on', x.received_on, 'note', x.note,
             'asked_by_message_at', x.asked_by_message_at,
             'person', jsonb_build_object('id', x.person_id, 'name', app._care_person_name(x.person_id)),
             'household', app._care_household_head(x.household_id),
             'program', jsonb_build_object('id', x.program_id, 'company_name', x.company_name, 'portal', x.portal, 'portal_url', x.portal_url),
             'gift', jsonb_build_object('payment_id', x.payment_id, 'received_on', x.gift_on,
                                        'amount_cents', case when v_amounts then x.gift_cents end),
             'deadline_on', app._match_deadline(x.deadline_kind, x.deadline_months, x.deadline_month, x.deadline_day, x.gift_on))
             order by x.state_at desc, x.id) from pg x), '[]'::jsonb)
    into v_total, v_rows;
  perform app.log_private_read(p_center, 'matching', 'claims', jsonb_array_length(v_rows));
  return jsonb_build_object('filter', v_filter, 'total', v_total, 'rows', v_rows, 'amounts', v_amounts, 'today', v_today,
                            'can_manage', app.org_private_can(p_center, 'matching.manage'));
end $$;

revoke execute on function app.match_claim_message_preview(uuid, uuid, uuid), app.send_match_claim_message(uuid, uuid, uuid) from public, anon;
grant execute on function app.match_claim_message_preview(uuid, uuid, uuid), app.send_match_claim_message(uuid, uuid, uuid) to authenticated, service_role;

-- ── The screen (the activity catalog lists every tab: 0620) ──────────────────
select app.activity_register('screen:/giving/matching/send', 'screen', 'portal', 'Gift matching: send the message to a member');
