-- 0792 · Email a pledge: the pledge email goes to the household's PRIMARY MEMBER with the pledge's PDF attached, automatically for
-- every pledge that is recorded and, by hand, to whatever address a person types (owner request 2026-10-14). Part 3 of 4 (0790 default
-- on, 0791 the PDF, 0792 this, 0793 the bulk upload). NEEDS OWNER OK: a person with giving.manage can send the community's pledge email
-- with the PDF to an address of their choice.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   WHO GETS THE AUTOMATIC EMAIL    the household's primary member (app._pledge_primary_contact), not the person who pledged: a family
--                                   hears once, at one address, however the pledge was made (the member app, staff one by one, or a
--                                   spreadsheet). No email address, a child as primary member, or a primary member who died: nothing is
--                                   sent, and the reason is written to the pledge's History and (for an upload) the upload's result.
--   ONCE PER PLEDGE                 the automatic email goes once per pledge, whatever the address (a second address never gets a second
--                                   one); the Email item of the pledge menu is the only way to send again.
--   THE PDF                         the message names it in its payload ({attachments: [{kind: pledge_pdf, pledge_id}]}): ids only, and
--                                   the background service draws it when the message is sent (0791, src/lib/pledge-pdf).
--   app.pledge_emails               one row per Email click: who, which pledge, which address, when, and what happened to it. Written
--                                   only by app.send_pledge_email; read only through the functions below.
--   app.send_pledge_email(...)      giving.manage in the pledge's community, Giving on. The address is checked (one address, shaped like
--                                   one), the click is recorded once per confirmation key (a double click sends one email), at most 40
--                                   an hour per person, and the pledge's History says who emailed which address and when. The email is
--                                   written and queued by the background service from the request (the job carries ids only, never the
--                                   address). No approval step: a person is writing to a family on purpose.
--   app.pledge_email_recipient(...) what the Email sheet opens with: the primary member and their address (or why there is none) and
--                                   what was sent before.
--   app.pledge_email_request_status what happened to one click: waiting, sent, not sent (and why) or failed (and why).
--   Every automatic outcome is written to the pledge's History as well (pledge.email_queued, pledge.email_not_sent).
--
-- WHAT DOES NOT CHANGE: nothing is sent to a demo community; a sandbox reaches only verified test recipients; suppressions, bounces and
-- the deceased are honoured by app.enqueue_notice exactly as before; the automatic email still waits for the treasurer's current approval
-- of the receipt templates (0770).
set client_min_messages = warning;

-- ══ The primary member and how to reach them ═════════════════════════════════════════════════════════════════════════════════════
-- {person_id, name, first_name, language, email, problem, message}: email is the lower-cased address when it is usable, else null with
-- `problem` (no_primary, deceased, child, no_email, bad_email) and `message`, a sentence that can be shown as it is.
create or replace function app._pledge_primary_contact(p_household uuid, p_majority int default 18) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_maj int := greatest(18, least(coalesce(p_majority, 18), 25));
  v_person uuid; v_first text; v_name text; v_lang text; v_raw text; v_deceased boolean; v_adult boolean; v_email text;
begin
  select pe.id, coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name),
         btrim(coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) || ' ' || pe.last_name),
         pe.language, btrim(coalesce(pe.email::text, '')), coalesce(pe.is_deceased, false),
         app._statement_adult(pe.date_of_birth, hm.role, v_maj)
    into v_person, v_first, v_name, v_lang, v_raw, v_deceased, v_adult
    from app.household_members hm join app.people pe on pe.id = hm.person_id
   where hm.household_id = p_household and hm.is_primary and hm.left_at is null and pe.merged_into_id is null
   order by pe.id
   limit 1;
  if v_person is null then
    return jsonb_build_object('person_id', null, 'name', null, 'first_name', null, 'language', null, 'email', null, 'problem', 'no_primary',
                              'message', 'This household has no primary member on file, so there is nobody to email.');
  end if;
  if v_deceased then
    return jsonb_build_object('person_id', v_person, 'name', v_name, 'first_name', v_first, 'language', v_lang, 'email', null,
                              'problem', 'deceased', 'message', v_name || ' is recorded as deceased, so nothing is sent to them.');
  end if;
  if not v_adult then
    return jsonb_build_object('person_id', v_person, 'name', v_name, 'first_name', v_first, 'language', v_lang, 'email', null,
                              'problem', 'child', 'message', 'The primary member (' || v_name || ') is under age, so nothing is sent to them.');
  end if;
  v_email := lower(v_raw);
  if v_email = '' then
    return jsonb_build_object('person_id', v_person, 'name', v_name, 'first_name', v_first, 'language', v_lang, 'email', null,
                              'problem', 'no_email', 'message', 'The primary member (' || v_name || ') has no email address on file.');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('person_id', v_person, 'name', v_name, 'first_name', v_first, 'language', v_lang, 'email', null,
                              'problem', 'bad_email', 'message', 'The email address on file for the primary member (' || v_name || ') is not a valid address.');
  end if;
  return jsonb_build_object('person_id', v_person, 'name', v_name, 'first_name', v_first, 'language', v_lang, 'email', v_email,
                            'problem', null, 'message', null);
end $$;
revoke execute on function app._pledge_primary_contact(uuid, integer) from public, anon, authenticated;
grant execute on function app._pledge_primary_contact(uuid, integer) to service_role;
comment on function app._pledge_primary_contact(uuid, integer) is
  'The household''s primary member and a usable email address for them, or why there is none (0792). Internal.';

-- What a message's status means for a person looking at a pledge: sent, waiting, failed or not sent.
create or replace function app._pledge_email_outcome(p_status text) returns text
language sql immutable set search_path = app, public, extensions as $$
  select case when p_status in ('sent', 'delivered') then 'sent'
              when p_status = 'queued' then 'waiting'
              when p_status in ('failed', 'bounced', 'complained') then 'failed'
              else 'not_sent' end
$$;
revoke execute on function app._pledge_email_outcome(text) from public, anon, authenticated;
grant execute on function app._pledge_email_outcome(text) to service_role;

-- ══ Each click of "Email" ════════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists app.pledge_emails (
  id              uuid primary key default gen_random_uuid(),
  center_id       uuid not null references app.centers(id) on delete cascade,
  pledge_id       uuid not null references app.pledges(id) on delete cascade,
  household_id    uuid references app.households(id) on delete set null,
  to_address      text not null check (char_length(to_address) between 3 and 254),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  requested_by    uuid references auth.users(id) default auth.uid(),
  requested_at    timestamptz not null default now(),
  status          text not null default 'requested' check (status in ('requested', 'queued', 'not_sent')),
  reason          text,
  reason_code     text check (reason_code is null or reason_code in ('no_email', 'declined', 'history', 'not_approved', 'switched_off', 'sandbox', 'other')),
  message_id      uuid references app.messages(id) on delete set null,
  constraint pledge_emails_key_uniq unique (center_id, idempotency_key)
);
create index if not exists pledge_emails_pledge_idx on app.pledge_emails (pledge_id, requested_at desc);
create index if not exists pledge_emails_who_idx on app.pledge_emails (center_id, requested_by, requested_at desc);
comment on table app.pledge_emails is
  'One row per click of "Email" on a pledge (0792): who asked, which pledge, which address, when, and what happened (requested, queued with its message, or not sent and why). Written only by app.send_pledge_email and the background service; read through app.pledge_email_recipient and app.pledge_email_request_status.';
insert into app.module_tables (table_name, module_key) values ('pledge_emails', null)
  on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_pledge_emails on app.pledge_emails;
create trigger audit_pledge_emails after insert or update or delete on app.pledge_emails
  for each row execute function app.audit_row();
alter table app.pledge_emails enable row level security;
revoke all on app.pledge_emails from public, anon, authenticated;
grant all on app.pledge_emails to service_role;

-- ══ The facts one pledge email is written from ═══════════════════════════════════════════════════════════════════════════════════
-- 0770's body with one change for the pledge: the recipient is the primary member (and the reason when there is none). p_manual skips
-- the "this kind of pledge has its own messages" rule: a person may email any pledge on purpose.
drop function if exists app._email_facts(text, uuid, uuid, integer);
create or replace function app._email_facts(p_key text, p_center uuid, p_ref uuid, p_majority int, p_manual boolean default false) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  c app.centers; pay app.payments; pl app.pledges; r app.rsvps; ev app.events;
  v_maj int := greatest(18, least(coalesce(p_majority, 18), 25));
  v_out jsonb; v_skip text; v_hh uuid; v_lead uuid; v_kind text; v_minors jsonb := '[]'::jsonb; v_recipients jsonb := '[]'::jsonb;
  v_payer_adult boolean; v_name text; v_contact jsonb;
begin
  select * into c from app.centers where id = p_center;
  if c.id is null then return jsonb_build_object('trigger', p_key, 'skip', 'Not sent: the community was not found.'); end if;
  v_out := jsonb_build_object('trigger', p_key, 'center', jsonb_build_object(
    'name', c.name, 'short_name', coalesce(nullif(btrim(c.short_name), ''), c.name), 'currency', c.currency,
    'time_zone', c.time_zone, 'country', c.country,
    'languages', to_jsonb(coalesce(nullif((select p.languages from app.org_profiles p where p.center_id = c.id), '{}'::text[]), array['en']::text[]))));
  v_kind := app._email_trigger_meta(p_key)->>'wording_kind';

  if p_key = 'payment_receipt' then
    select * into pay from app.payments where id = p_ref and center_id = p_center;
    if pay.id is null then v_skip := 'Not sent: the payment is no longer on file.';
    elsif not app.statement_counted_status(pay.status) then v_skip := 'Not sent: the payment did not go through, or it was refunded in full.';
    elsif pay.is_opening_balance or pay.is_historical then v_skip := 'Not sent: imported history and opening balances never get a receipt email.';
    elsif coalesce(btrim(pay.receipt_number), '') = '' then v_skip := 'Not sent: the payment has no receipt number.';
    end if;
    if pay.id is not null then
      v_hh := pay.household_id;
      v_lead := case when pay.joint_receipt then null else pay.payer_person_id end;
      v_minors := app._email_minor_first_names(v_hh, v_maj);
      -- The name on the receipt, as app.receipt_copy (0746) prints it: not when the payer is under age or it names a child.
      if pay.payer_person_id is not null then
        select app._statement_adult(pe.date_of_birth,
                 (select hm.role from app.household_members hm
                   where hm.person_id = pe.id and hm.household_id = pay.household_id and hm.left_at is null limit 1), v_maj)
          into v_payer_adult
          from app.people pe where pe.id = pay.payer_person_id;
      end if;
      v_name := nullif(btrim(pay.receipt_name), '');
      if v_name is not null and ((pay.payer_person_id is not null and v_payer_adult is not true)
           or exists (select 1 from jsonb_array_elements_text(v_minors) m where position(lower(m) in lower(v_name)) > 0)) then
        v_name := null;
      end if;
      v_out := v_out || jsonb_build_object('payment', jsonb_build_object(
        'amount_cents', pay.amount_cents, 'received_on', pay.received_on, 'method', pay.method, 'receipt_number', pay.receipt_number,
        'receipt_name', v_name,
        'applied_to', coalesce((select jsonb_agg(distinct coalesce(f.name, cp.name))
                                  from app.payment_allocations al join app.pledges p2 on p2.id = al.pledge_id
                                  left join app.funds f on f.id = p2.fund_id
                                  left join app.campaigns cp on cp.id = p2.campaign_id
                                 where al.payment_id = pay.id and coalesce(f.name, cp.name) is not null), '[]'::jsonb)));
    end if;

  elsif p_key = 'pledge_recorded' then
    select * into pl from app.pledges where id = p_ref and center_id = p_center;
    if pl.id is null then v_skip := 'Not sent: the pledge is no longer on file.';
    elsif pl.status = 'cancelled' then v_skip := 'Not sent: the pledge was cancelled.';
    elsif not p_manual and not app._email_pledge_source_ok(pl.source) then v_skip := 'Not sent: this kind of pledge has its own record and messages.';
    end if;
    if pl.id is not null then
      v_hh := pl.household_id;
      v_lead := pl.pledged_by_person_id;
      v_minors := app._email_minor_first_names(v_hh, v_maj);
      v_out := v_out || jsonb_build_object('pledge', jsonb_build_object(
        'amount_cents', pl.amount_cents, 'paid_cents', pl.paid_cents, 'number', pl.pledge_number,
        'pledged_at', (pl.pledged_at at time zone coalesce(c.time_zone, 'UTC'))::date, 'due_on', pl.due_on,
        'for', coalesce((select o.name from app.opportunities o where o.id = pl.opportunity_id),
                        (select cp.name from app.campaigns cp where cp.id = pl.campaign_id),
                        (select f.name from app.funds f where f.id = pl.fund_id))));
    end if;

  elsif p_key = 'registration_confirmed' then
    select * into r from app.rsvps where id = p_ref and center_id = p_center;
    if r.id is null then v_skip := 'Not sent: the registration is no longer on file.';
    else
      select * into ev from app.events where id = r.event_id;
      if r.status not in ('rsvpd', 'confirmed') then v_skip := 'Not sent: the registration was cancelled.';
      elsif ev.status = 'cancelled' then v_skip := 'Not sent: the event was cancelled.';
      end if;
      v_hh := r.household_id;
      v_lead := r.submitted_by_person_id;
      if v_hh is not null then v_minors := app._email_minor_first_names(v_hh, v_maj); end if;
      v_out := v_out || jsonb_build_object(
        'event', jsonb_build_object('name', ev.name, 'number', ev.event_number, 'starts_at', ev.starts_at, 'venue', ev.venue),
        'registration', jsonb_build_object('count', (select count(*) from app.attendees att where att.rsvp_id = r.id)));
      if v_hh is null then
        v_recipients := case when coalesce(btrim(r.guest_email::text), '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                             then jsonb_build_array(jsonb_build_object('person_id', null, 'address', lower(btrim(r.guest_email::text)),
                                    'first_name', nullif(split_part(btrim(coalesce(r.guest_name, '')), ' ', 1), ''),
                                    'name', nullif(btrim(coalesce(r.guest_name, '')), ''), 'language', null))
                             else '[]'::jsonb end;
      end if;
    end if;
  else
    return jsonb_build_object('trigger', p_key, 'skip', 'Not sent: unknown automatic email.');
  end if;

  if v_hh is not null then
    if p_key = 'pledge_recorded' then
      -- The household's primary member, and when there is nobody to write to, why (the screens and the log say it as it is).
      v_contact := app._pledge_primary_contact(v_hh, v_maj);
      if v_contact->>'email' is not null then
        v_recipients := jsonb_build_array(jsonb_build_object('person_id', v_contact->'person_id', 'address', v_contact->>'email',
                                                             'first_name', v_contact->>'first_name', 'name', v_contact->>'name',
                                                             'language', v_contact->>'language'));
      end if;
      v_out := v_out || jsonb_build_object('primary_problem', v_contact->>'problem', 'primary_message', v_contact->>'message');
    else
      v_recipients := app._email_recipients(v_hh, v_lead, v_maj);
    end if;
    v_out := v_out || jsonb_build_object('household', (select jsonb_build_object('id', h.id, 'name', h.display_name,
                                                                                 'number', h.household_number, 'minor_first_names', v_minors)
                                                         from app.households h where h.id = v_hh));
  end if;
  if v_kind is not null then
    v_out := v_out || jsonb_build_object('wording', (select jsonb_build_object('signed_by', t.signed_by, 'personal_note', t.personal_note)
                                                       from app.receipt_templates t where t.center_id = p_center and t.kind = v_kind));
  end if;
  return v_out || jsonb_build_object('recipients', v_recipients, 'skip', v_skip);
end $$;
revoke execute on function app._email_facts(text, uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function app._email_facts(text, uuid, uuid, integer, boolean) to service_role;

-- ══ The background service: the record's facts, and what was written to the log ══════════════════════════════════════════════════
-- 0770's body, with a reason code on each skipped row, the pledge's own "nobody to email" sentence, and the same skip written to the
-- pledge's History.
create or replace function app.worker_email_facts(p_automation uuid, p_ref uuid, p_majority int) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; m jsonb; v_facts jsonb; v_skip text; v_code text; v_appr jsonb; v_hh uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into a from app.email_automations where id = p_automation;
  if a.id is null then return jsonb_build_object('skip', 'Not sent: the automatic email no longer exists.'); end if;
  m := app._email_trigger_meta(a.trigger_key);
  if not a.enabled then
    v_skip := 'Not sent: the email was switched off before it went.';
    v_code := 'switched_off';
  elsif not app.module_enabled(a.center_id, m->>'module') then
    v_skip := 'Not sent: the ' || coalesce((select label from app.modules where key = m->>'module'), m->>'module') || ' module is switched off.';
    v_code := 'switched_off';
  elsif (m->>'approval')::boolean then
    v_appr := app.check_statement_templates_approved(a.center_id);
    if not coalesce((v_appr->>'ok')::boolean, false) then
      v_skip := 'Not sent: ' || (v_appr->>'detail');
      v_code := 'not_approved';
    end if;
  end if;
  v_facts := app._email_facts(a.trigger_key, a.center_id, p_ref, p_majority);
  if v_skip is null and v_facts->>'skip' is not null then
    v_skip := v_facts->>'skip';
    v_code := 'other';
  end if;
  if v_skip is null and a.trigger_key = 'registration_confirmed' and (v_facts #>> '{event,starts_at}') is not null
     and (v_facts #>> '{event,starts_at}')::timestamptz <= now() then
    v_skip := 'Not sent: the event had already started.';
    v_code := 'other';
  end if;
  if v_skip is null and jsonb_array_length(coalesce(v_facts->'recipients', '[]'::jsonb)) = 0 then
    v_skip := case when a.trigger_key = 'pledge_recorded' and v_facts->>'primary_message' is not null then 'Not sent: ' || (v_facts->>'primary_message')
                   when v_facts->'household' is null then 'Not sent: the guest gave no email address.'
                   else 'Not sent: no adult of the household has an email address on file.' end;
    v_code := 'no_email';
  end if;
  if v_skip is not null then
    v_hh := case when (v_facts #>> '{household,id}') ~* '^[0-9a-f-]{36}$' then (v_facts #>> '{household,id}')::uuid end;
    insert into app.email_automation_sends (center_id, automation_id, ref_id, period, household_id, to_address, outcome, reason, reason_code)
    values (a.center_id, a.id, p_ref, '', v_hh, '', 'skipped', v_skip, v_code)
    on conflict on constraint email_automation_sends_once do nothing;
    if found and a.trigger_key = 'pledge_recorded' then
      perform app.log_audit(a.center_id, 'pledge.email_not_sent', 'pledges', p_ref::text, null,
                            jsonb_build_object('result', 'The pledge email was not sent', 'why', v_skip), v_skip);
    end if;
  end if;
  return v_facts || jsonb_build_object('skip', v_skip, 'automation', jsonb_build_object('id', a.id, 'key', a.trigger_key, 'template_key', a.template_key));
end $$;

-- The facts of one pledge emailed by hand: the typed address is the only recipient. Not held back by the switch or the approval of the
-- automatic email (a person is writing to a family on purpose), but by everything about the pledge itself.
create or replace function app.worker_pledge_email_request(p_request uuid, p_majority int) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  r app.pledge_emails; v_auto uuid; a app.email_automations; v_facts jsonb; v_skip text; v_code text; v_person uuid; v_first text; v_name text;
  v_lang text;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into r from app.pledge_emails where id = p_request;
  if r.id is null then return jsonb_build_object('skip', 'Not sent: the request no longer exists.'); end if;
  if r.status <> 'requested' then return jsonb_build_object('skip', 'Not sent: this request was already handled.', 'handled', true); end if;
  v_auto := app._pledge_email_automation(r.center_id);
  select * into a from app.email_automations where id = v_auto;
  v_facts := app._email_facts('pledge_recorded', r.center_id, r.pledge_id, p_majority, true);
  v_skip := v_facts->>'skip';
  if v_skip is not null then v_code := 'other'; end if;
  if v_skip is null and not app.module_enabled(r.center_id, 'giving') then
    v_skip := 'Not sent: the Giving module is switched off.';
    v_code := 'switched_off';
  end if;
  -- The person the address belongs to, when it is an adult of the household (so the email can greet them by name); else nobody.
  select pe.id, coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name),
         btrim(coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) || ' ' || pe.last_name), pe.language
    into v_person, v_first, v_name, v_lang
    from app.household_members hm join app.people pe on pe.id = hm.person_id
   where hm.household_id = r.household_id and hm.left_at is null and pe.merged_into_id is null and not coalesce(pe.is_deceased, false)
     and app._statement_adult(pe.date_of_birth, hm.role, p_majority) and lower(btrim(coalesce(pe.email::text, ''))) = lower(r.to_address)
   order by hm.is_primary desc, pe.id
   limit 1;
  if v_skip is not null then
    update app.pledge_emails set status = 'not_sent', reason = v_skip, reason_code = v_code where id = r.id;
    perform app.log_audit(r.center_id, 'pledge.email_not_sent', 'pledges', r.pledge_id::text, null,
                          jsonb_build_object('result', 'The pledge email was not sent', 'to', r.to_address, 'why', v_skip), v_skip);
  end if;
  return v_facts || jsonb_build_object(
    'recipients', jsonb_build_array(jsonb_build_object('person_id', v_person, 'address', r.to_address, 'first_name', v_first, 'name', v_name, 'language', v_lang)),
    'skip', v_skip,
    'automation', jsonb_build_object('id', a.id, 'key', 'pledge_recorded', 'template_key', a.template_key),
    'request_id', r.id);
end $$;

-- ══ Queueing one email ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 0770's body, plus: a pledge's email names its PDF in the payload; the automatic pledge email goes once per pledge whatever the address;
-- the outcome is written to the pledge's History; a manual request is updated with what happened.
create or replace function app.worker_email_enqueue(p_automation uuid, p_ref uuid, p_period text, p_household uuid, p_person uuid,
                                                    p_address text, p_vars jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; m jsonb; v_to text; v_period text := coalesce(p_period, ''); v_main text; v_plang text; v_lang text;
        v_msg uuid; v_status text; v_reason text; v_outcome text := 'queued'; v_code text; v_route jsonb; v_request uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into a from app.email_automations where id = p_automation;
  if a.id is null then raise exception 'That automatic email does not exist.'; end if;
  m := app._email_trigger_meta(coalesce(a.trigger_key, a.kind));
  v_to := app.normalize_recipient('email', p_address);
  if v_to is null or v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('outcome', 'skipped', 'reason', 'Not an email address.');
  end if;
  -- Two runs for the same record cannot both queue it. The automatic pledge email is once per pledge, so its lock leaves the address out.
  if a.trigger_key = 'pledge_recorded' and v_period = '' then
    perform pg_advisory_xact_lock(hashtextextended('email_automation:' || a.id || ':' || p_ref || ':' || v_period, 0));
    if exists (select 1 from app.email_automation_sends s
                where s.automation_id = a.id and s.ref_id = p_ref and s.period = '' and s.outcome = 'queued') then
      return jsonb_build_object('outcome', 'duplicate');
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended('email_automation:' || a.id || ':' || p_ref || ':' || v_period || ':' || v_to, 0));
  end if;
  if exists (select 1 from app.email_automation_sends s
              where s.automation_id = a.id and s.ref_id = p_ref and s.period = v_period and s.to_address = v_to) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  v_main := coalesce((select (p.languages)[1] from app.org_profiles p where p.center_id = a.center_id), 'en');
  v_plang := coalesce(nullif(lower(btrim((select pe.language from app.people pe where pe.id = p_person))), ''), v_main);
  v_lang := case
    when exists (select 1 from app.message_templates t where t.center_id = a.center_id and t.key = a.template_key
                    and t.channel = 'email' and t.language = v_plang) then v_plang
    when exists (select 1 from app.message_templates t where t.center_id = a.center_id and t.key = a.template_key
                    and t.channel = 'email' and t.language = v_main) then v_main
    -- No standard wording in either language (a scheduled email has only the community's own): any language it was written in.
    when not exists (select 1 from app.message_templates t where t.center_id is null and t.key = a.template_key and t.channel = 'email') then
      coalesce((select t.language from app.message_templates t where t.center_id = a.center_id and t.key = a.template_key
                   and t.channel = 'email' order by t.version desc, t.language limit 1), v_plang)
    else v_plang end;

  -- What the message carries besides its words: a pledge's email names the pledge's PDF (drawn when the message is sent).
  v_route := jsonb_build_object('automation_id', a.id, 'ref_id', p_ref);
  if a.trigger_key = 'pledge_recorded' then
    v_route := v_route || jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('kind', 'pledge_pdf', 'pledge_id', p_ref)));
  end if;

  if not app.messaging_recipient_ok(a.center_id, 'email', v_to, m->>'purpose') then
    v_outcome := 'skipped';
    v_reason := 'Not sent: this sandbox sends only to verified test recipients (Settings › Limits).';
    v_code := 'sandbox';
  else
    begin
      v_msg := app.enqueue_notice(a.center_id, 'email', v_to, a.template_key,
                                  coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('language', v_lang)
                                    || case when p_person is not null then jsonb_build_object('person_id', p_person::text) else '{}'::jsonb end,
                                  m->>'purpose', now(), m->>'topic', null, v_route, true);
      select msg.status, msg.failure_reason into v_status, v_reason from app.messages msg where msg.id = v_msg;
      if v_status <> 'queued' then
        v_outcome := 'skipped';
        v_code := 'other';
      else
        v_reason := null;
      end if;
    exception
      -- What will not change on a retry is written to the log: the wording or an address the message cannot use (22023), a
      -- sandbox's recipient rule (CCENT). Anything else fails the call, so the job is tried again.
      when invalid_parameter_value or sqlstate 'CCENT' then
        v_outcome := 'skipped';
        v_reason := 'Not sent: ' || sqlerrm;
        v_code := case when sqlstate = 'CCENT' then 'sandbox' else 'other' end;
        v_msg := null;
    end;
  end if;
  insert into app.email_automation_sends (center_id, automation_id, ref_id, period, household_id, person_id, to_address, outcome, reason, reason_code, message_id)
  values (a.center_id, a.id, p_ref, v_period, p_household, p_person, v_to, v_outcome, v_reason, case when v_outcome = 'skipped' then v_code end, v_msg);

  if a.trigger_key = 'pledge_recorded' then
    if v_period like 'manual:%' and v_period ~* '^manual:[0-9a-f-]{36}$' then
      v_request := substr(v_period, 8)::uuid;
      update app.pledge_emails
         set status = case when v_outcome = 'queued' then 'queued' else 'not_sent' end, message_id = v_msg,
             reason = case when v_outcome = 'queued' then null else v_reason end,
             reason_code = case when v_outcome = 'queued' then null else v_code end
       where id = v_request;
      -- The click is in the History already (who asked); a refusal is added.
      if v_outcome <> 'queued' then
        perform app.log_audit(a.center_id, 'pledge.email_not_sent', 'pledges', p_ref::text, null,
                              jsonb_build_object('result', 'The pledge email was not sent', 'to', v_to, 'why', v_reason), v_reason);
      end if;
    elsif v_outcome = 'queued' then
      perform app.log_audit(a.center_id, 'pledge.email_queued', 'pledges', p_ref::text, null,
                            jsonb_build_object('result', 'The pledge email was queued with the pledge attached as a PDF', 'to', v_to,
                                               'how', 'Sent automatically when the pledge was recorded'), null);
    else
      perform app.log_audit(a.center_id, 'pledge.email_not_sent', 'pledges', p_ref::text, null,
                            jsonb_build_object('result', 'The pledge email was not sent', 'to', v_to, 'why', v_reason), v_reason);
    end if;
  end if;
  return jsonb_build_object('outcome', v_outcome, 'reason', v_reason, 'message_id', v_msg);
end $$;

-- ══ The Email sheet ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- What the sheet opens with: the pledge, the primary member and their address (or why there is none), and what was sent before.
create or replace function app.pledge_email_recipient(p_center uuid, p_pledge uuid, p_majority int default 18) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare pl app.pledges; v_contact jsonb; v_earlier jsonb;
begin
  select * into pl from app.pledges where id = p_pledge;
  if pl.id is null or p_center is null or pl.center_id <> p_center then
    raise exception 'That pledge was not found.' using errcode = 'P0002';
  end if;
  if not app.has_permission(pl.center_id, 'giving.manage') then
    raise exception 'You don''t have access to this area.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(pl.center_id, 'giving');
  v_contact := app._pledge_primary_contact(pl.household_id, p_majority);
  select coalesce(jsonb_agg(e order by e->>'at' desc), '[]'::jsonb) into v_earlier
    from (
      select jsonb_build_object('at', x.happened_at, 'to', x.to_address, 'how', x.how, 'outcome', x.outcome, 'reason', x.reason) as e
        from (
          select s.created_at as happened_at, nullif(s.to_address, '') as to_address, 'automatic' as how,
                 case when s.outcome = 'queued' then app._pledge_email_outcome(msg.status) else 'not_sent' end as outcome,
                 case when s.outcome = 'queued' then msg.failure_reason else s.reason end as reason
            from app.email_automation_sends s
            join app.email_automations au on au.id = s.automation_id and au.trigger_key = 'pledge_recorded'
            left join app.messages msg on msg.id = s.message_id
           where s.ref_id = pl.id and s.period = '' and au.center_id = pl.center_id
          union all
          select pe.requested_at, pe.to_address, 'manual',
                 case when pe.status = 'queued' then app._pledge_email_outcome(msg.status) when pe.status = 'not_sent' then 'not_sent' else 'waiting' end,
                 case when pe.status = 'queued' then msg.failure_reason else pe.reason end
            from app.pledge_emails pe left join app.messages msg on msg.id = pe.message_id
           where pe.pledge_id = pl.id and pe.center_id = pl.center_id
          order by 1 desc
          limit 5) x) y;
  return jsonb_build_object(
    'pledge', jsonb_build_object('id', pl.id, 'number', pl.pledge_number, 'status', pl.status::text, 'household_id', pl.household_id,
                                 'amount_cents', pl.amount_cents),
    'primary', jsonb_build_object('person_id', v_contact->'person_id', 'name', v_contact->>'name', 'email', v_contact->>'email',
                                  'problem', v_contact->>'problem', 'message', v_contact->>'message'),
    'earlier', v_earlier);
end $$;

-- Click "Send": the request, once per confirmation key, and the job that writes and queues the email.
create or replace function app.send_pledge_email(p_center uuid, p_pledge uuid, p_to text, p_key text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  pl app.pledges; r app.pledge_emails; v_to text := lower(btrim(coalesce(p_to, ''))); v_key text := nullif(btrim(coalesce(p_key, '')), '');
  v_auto uuid;
begin
  select * into pl from app.pledges where id = p_pledge;
  if pl.id is null or p_center is null or pl.center_id <> p_center then
    raise exception 'That pledge was not found.' using errcode = 'P0002';
  end if;
  perform app.assert_module_enabled(pl.center_id, 'giving');
  if not app.has_permission(pl.center_id, 'giving.manage') then
    raise exception 'You do not have permission to email a pledge (it needs giving.manage).' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) < 8 or char_length(v_key) > 120 then
    raise exception 'An email needs a confirmation key of 8 to 120 characters, so that clicking twice cannot send it twice.' using errcode = '22023';
  end if;
  -- The same confirmation again (a double click, or a retry after a lost answer) gives back the request it made.
  select * into r from app.pledge_emails e where e.center_id = pl.center_id and e.idempotency_key = v_key;
  if found then
    if r.pledge_id <> pl.id or lower(r.to_address) <> v_to then
      raise exception 'This confirmation was already used for a different email. Nothing was sent.' using errcode = '23505';
    end if;
    return jsonb_build_object('request_id', r.id, 'replayed', true, 'to', r.to_address, 'status', r.status);
  end if;
  if pl.status = 'cancelled' then
    raise exception 'This pledge was deleted (cancelled), so there is nothing to send.' using errcode = '22023';
  end if;
  if v_to = '' then
    raise exception 'Type the email address to send the pledge to.' using errcode = '22023';
  end if;
  if char_length(v_to) > 254 or v_to !~ '^[^@\s,;<>"]+@[^@\s,;<>"]+\.[^@\s,;<>"]+$' or length(v_to) - length(replace(v_to, '@', '')) <> 1 then
    raise exception '"%" is not one email address. Check it and try again.', left(v_to, 80) using errcode = '22023';
  end if;
  -- Writing to families from the community's own address is limited, so a mistake or a misuse cannot send hundreds.
  if (select count(*) from app.pledge_emails e where e.center_id = pl.center_id and e.requested_by = auth.uid() and e.requested_at > now() - interval '1 hour') >= 40 then
    raise exception 'You have emailed 40 pledges in the last hour. Wait a while before sending more.' using errcode = '22023';
  end if;
  insert into app.pledge_emails (center_id, pledge_id, household_id, to_address, idempotency_key)
  values (pl.center_id, pl.id, pl.household_id, v_to, v_key)
  returning * into r;
  v_auto := app._pledge_email_automation(pl.center_id);
  perform app.log_audit(pl.center_id, 'pledge.email_requested', 'pledges', pl.id::text, null,
                        jsonb_build_object('result', 'The pledge was emailed with its PDF attached', 'to', v_to, 'how', 'Emailed from the pledge menu'),
                        'Emailed the pledge to ' || v_to);
  -- The job carries ids only: the address stays in the request row.
  perform app.enqueue_job(pl.center_id, 'messaging.compose', jsonb_build_object('automation_id', v_auto, 'ref_id', pl.id, 'request_id', r.id), now(), 5);
  return jsonb_build_object('request_id', r.id, 'replayed', false, 'to', v_to, 'status', r.status);
end $$;

-- What happened to one click: waiting, sent, not sent (with the reason) or failed (with the reason).
create or replace function app.pledge_email_request_status(p_center uuid, p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r app.pledge_emails; msg app.messages; v_outcome text;
begin
  select * into r from app.pledge_emails where id = p_request;
  if r.id is null or p_center is null or r.center_id <> p_center then
    raise exception 'That email was not found.' using errcode = 'P0002';
  end if;
  if not app.has_permission(r.center_id, 'giving.manage') then
    raise exception 'You don''t have access to this area.' using errcode = '42501';
  end if;
  if r.message_id is not null then select * into msg from app.messages where id = r.message_id; end if;
  v_outcome := case when r.status = 'requested' then 'waiting'
                    when r.status = 'not_sent' then 'not_sent'
                    else app._pledge_email_outcome(msg.status) end;
  return jsonb_build_object('status', v_outcome, 'to', r.to_address, 'reason', coalesce(r.reason, case when r.status = 'queued' then msg.failure_reason end),
                            'requested_at', r.requested_at, 'sent_at', msg.sent_at);
end $$;

-- ══ Wording: the standard pledge email says the PDF is attached (a community's own wording is left as it is) ═══════════════════
insert into app.message_templates (center_id, key, channel, language, subject, body, version)
select null, 'pledge_recorded', 'email'::app.channel, 'en', 'Your pledge {{pledge_number}} to {{center_name}}',
       E'Dear {{recipient_first_name}},\n\nThank you for your pledge of {{pledge_amount}} for {{pledge_for}}, made on {{pledge_date}}. A copy of your pledge is attached as a PDF.\n\nPledge number: {{pledge_number}}\nDue: {{pledge_due_date}}\nStill to pay: {{pledge_balance}}\nHousehold: {{household_name}} ({{household_number}})\n\n{{pledge_note}}\n\n{{pledge_signed_by}}',
       2
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = 'pledge_recorded' and t.channel = 'email' and t.language = 'en' and t.version = 2);

-- ══ The activity catalog and who may call what ═══════════════════════════════════════════════════════════════════════════════════
select app.activity_register('giving.email_pledge', 'action', 'portal', 'Email a pledge with its PDF', 'pledge');

revoke execute on function app.worker_email_facts(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function app.worker_email_facts(uuid, uuid, integer) to connect_worker;
revoke execute on function app.worker_email_enqueue(uuid, uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function app.worker_email_enqueue(uuid, uuid, text, uuid, uuid, text, jsonb) to connect_worker;
revoke execute on function app.worker_pledge_email_request(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function app.worker_pledge_email_request(uuid, integer) to connect_worker;
revoke execute on function app.pledge_email_recipient(uuid, uuid, integer), app.send_pledge_email(uuid, uuid, text, text),
  app.pledge_email_request_status(uuid, uuid) from public, anon;
grant execute on function app.pledge_email_recipient(uuid, uuid, integer), app.send_pledge_email(uuid, uuid, text, text),
  app.pledge_email_request_status(uuid, uuid) to authenticated;

comment on function app.send_pledge_email(uuid, uuid, text, text) is
  'The Email item of the pledge menu (0792): giving.manage, Giving on. Records who asked which pledge to be sent to which address (once per confirmation key, at most 40 an hour per person), writes it to the pledge''s History and queues the job that writes the email with the PDF attached. Returns {request_id, replayed, to, status}.';
comment on function app.pledge_email_recipient(uuid, uuid, integer) is
  'What the Email sheet opens with (0792): the primary member and their address (or why there is none) and the last five emails of this pledge. giving.manage.';
comment on function app.pledge_email_request_status(uuid, uuid) is
  'What happened to one click of Email (0792): waiting, sent, not_sent or failed, with the reason. giving.manage.';
