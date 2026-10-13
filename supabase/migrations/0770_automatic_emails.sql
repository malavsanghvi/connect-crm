-- 0770 · Automatic emails with mail merge: a receipt for a payment, a pledge confirmation and a registration confirmation, each
-- with the community's own wording, placeholders filled from the record, a switch per email (OFF until someone turns it on), a
-- preview from a recent real record, a test to yourself and a log of what was sent (docs/AUTOMATIC_EMAILS.md; owner approval of
-- plan GV-E, 2026-10-13). Scheduled emails come in 0771.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Nothing is sent by this migration and nothing changes for any community until a person switches an email on.
--
--   app.email_automations       one row per community and automatic email: on or off, and (receipts) whether uploaded
--                               donations get a receipt too. No row = off. Written only through the functions below; audited.
--   app.email_automation_sends  what happened to each email: queued (with the message) or not sent and why. Once per record,
--                               period and address (the duplicate guard). Written by the database only.
--
--   The wording lives where every message's wording lives: app.message_templates (0008), a new version for each save, the
--   community's own over the platform's standard one, one per language. The merge language is the one every template already
--   uses: {{name}} (app.render_message_text, 0221). Each email has its own list of names (app._email_placeholders; the portal's
--   list in src/lib/merge/catalogue.ts is the same, tests/merge-catalogue.test.ts keeps them equal), and wording that uses any
--   other name is refused when it is saved.
--
--   WHEN AN EMAIL GOES (only while its switch is on and its module is on)
--     payment_receipt         a payment is recorded, or a provider payment goes through (captured, clearing, settled) with a
--                             receipt number. Never for imported history, opening balances, CRM imports, or rows uploaded in a
--                             transaction marked with app.mark_donation_upload(): uploaded donations get a receipt only when the
--                             community also switches on "email receipts for uploaded donations" and the upload calls
--                             app.email_receipts_for_uploaded (src/lib/automatic-emails/hooks.ts onDonationsUploaded).
--                             And only while the treasurer's approval of the receipt templates is current (0300): saving new
--                             receipt or pledge wording makes it "changed" until the treasurer approves again.
--     pledge_recorded         a pledge is recorded (general, manual, labh, pledges at events and on items). Not for fees,
--                             recurring gift cycles, store orders or registrations (they have their own records and messages),
--                             not for imported pledges. The same treasurer approval.
--     registration_confirmed  someone registers (RSVP) for an event that has not started. Not for imported registrations.
--
--   WHO GETS IT: adults only (app._statement_adult with the community's age of majority, which the background service works out
--   from the community's place, src/lib/age-of-majority.ts). The person who paid, pledged or registered when they are an adult
--   of the household with an email address; otherwise every adult of the household with one; a guest's own email for a guest
--   registration. One email per address. A child's name is never in it: the household's name loses its children's first names
--   and every other value is checked again (src/lib/merge/build.ts).
--
--   HOW: the trigger queues one messaging.compose job (cheap, never blocks the payment, pledge or registration). The background
--   service reads the record (app.worker_email_facts), writes the values in the community's currency, locale and time zone
--   (src/lib/merge), and queues each email through app.enqueue_notice (0598), the path every notice takes: suppressions,
--   opt-outs and the member's own topic switch for registrations, deceased people, the sandbox's test recipients. Receipts and
--   pledge confirmations go as purpose "receipt" (the receipts sender, no unsubscribe link, like every receipt: owner #15);
--   registrations as a notification of the "events" topic (the member's switch, the unsubscribe link).
--
--   NO 2FA STEP anywhere here (owner rule 2026-10-13: a fresh code only at sign-in and for admin-level actions).
--
--   REDEFINED: app.statement_templates_evidence (latest body 0300): a community that saved its own receipt or pledge email
--   wording has that wording in what the treasurer approves. A community that did not has exactly the evidence it had, so
--   every current approval stays current.
--
--   Permissions: the Giving emails are switched and worded with giving.manage and read with giving.view; the registration
--   email with events.manage and events.view; settings.manage reads them all. Test 170.
set client_min_messages = warning;

-- ══ Tables ═══════════════════════════════════════════════════════════════════
create table if not exists app.email_automations (
  id           uuid primary key default gen_random_uuid(),
  center_id    uuid not null references app.centers(id) on delete cascade,
  kind         text not null default 'trigger' constraint email_automations_kind_check check (kind in ('trigger', 'schedule')),
  trigger_key  text constraint email_automations_trigger_key_check
                 check (trigger_key is null or trigger_key in ('payment_receipt', 'pledge_recorded', 'registration_confirmed')),
  template_key text not null,
  enabled      boolean not null default false,
  options      jsonb not null default '{}'::jsonb,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) default auth.uid(),
  updated_at   timestamptz not null default now(),
  constraint email_automations_trigger_check check (kind <> 'trigger' or trigger_key is not null)
);
create unique index if not exists email_automations_trigger_idx on app.email_automations (center_id, trigger_key) where kind = 'trigger';
comment on table app.email_automations is
  'Automatic emails (0770): one row per community and email; no row = off. kind trigger (payment_receipt, pledge_recorded, registration_confirmed; 0771 adds schedule). options.uploaded: receipts for uploaded donations too. Written through app.set_email_automation / app.save_email_automation_wording only.';
drop trigger if exists stamp_email_automations on app.email_automations;
create trigger stamp_email_automations before insert or update on app.email_automations
  for each row execute function app.stamp_updated_by();
drop trigger if exists audit_email_automations on app.email_automations;
create trigger audit_email_automations after insert or update or delete on app.email_automations
  for each row execute function app.audit_row();

create table if not exists app.email_automation_sends (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  automation_id uuid not null references app.email_automations(id) on delete cascade,
  ref_id        uuid not null,
  period        text not null default '',
  household_id  uuid references app.households(id) on delete set null,
  person_id     uuid references app.people(id) on delete set null,
  to_address    text not null default '',
  outcome       text not null check (outcome in ('queued', 'skipped')),
  reason        text,
  message_id    uuid references app.messages(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint email_automation_sends_once unique (automation_id, ref_id, period, to_address)
);
create index if not exists email_automation_sends_center_idx on app.email_automation_sends (center_id, automation_id, created_at desc);
comment on table app.email_automation_sends is
  'What each automatic email did (0770): queued (message_id) or skipped (reason), once per automation, record (ref_id), period and address; to_address '''' = the whole email was not sent (reason). Inserts are not audited (the message is); changes and deletions are.';
drop trigger if exists audit_email_automation_sends on app.email_automation_sends;
create trigger audit_email_automation_sends after update or delete on app.email_automation_sends
  for each row execute function app.audit_row();

-- Core platform tables: each row is guarded by its own email's module in the functions below.
insert into app.module_tables (table_name, module_key) values ('email_automations', null), ('email_automation_sends', null)
on conflict (table_name) do update set module_key = excluded.module_key;

alter table app.email_automations enable row level security;
alter table app.email_automation_sends enable row level security;
drop policy if exists email_automations_read on app.email_automations;
create policy email_automations_read on app.email_automations for select to authenticated
  using (app.has_permission(center_id, 'settings.manage') or app.has_permission(center_id, 'giving.view')
         or app.has_permission(center_id, 'giving.manage') or app.has_permission(center_id, 'events.view')
         or app.has_permission(center_id, 'events.manage') or app.has_permission(center_id, 'comms.view')
         or app.has_permission(center_id, 'comms.send'));
drop policy if exists email_automation_sends_read on app.email_automation_sends;
create policy email_automation_sends_read on app.email_automation_sends for select to authenticated
  using (app.has_permission(center_id, 'settings.manage') or app.has_permission(center_id, 'giving.view')
         or app.has_permission(center_id, 'giving.manage') or app.has_permission(center_id, 'events.view')
         or app.has_permission(center_id, 'events.manage') or app.has_permission(center_id, 'comms.view')
         or app.has_permission(center_id, 'comms.send'));
revoke all on app.email_automations, app.email_automation_sends from anon, authenticated;
grant select on app.email_automations, app.email_automation_sends to authenticated;
grant all on app.email_automations, app.email_automation_sends to service_role;

-- ══ What each email is ═══════════════════════════════════════════════════════
create or replace function app._email_trigger_meta(p_key text) returns jsonb
language sql immutable set search_path = app, public, extensions as $$
  select case p_key
    when 'payment_receipt' then jsonb_build_object(
      'title', 'Receipt for a payment', 'module', 'giving', 'manage', 'giving.manage', 'view', jsonb_build_array('giving.view', 'giving.manage'),
      'template', 'receipt', 'purpose', 'receipt', 'topic', null, 'wording_kind', 'donation_receipt', 'approval', true)
    when 'pledge_recorded' then jsonb_build_object(
      'title', 'Pledge confirmation', 'module', 'giving', 'manage', 'giving.manage', 'view', jsonb_build_array('giving.view', 'giving.manage'),
      'template', 'pledge_recorded', 'purpose', 'receipt', 'topic', null, 'wording_kind', 'pledge_confirmation', 'approval', true)
    when 'registration_confirmed' then jsonb_build_object(
      'title', 'Registration confirmation', 'module', 'events', 'manage', 'events.manage', 'view', jsonb_build_array('events.view', 'events.manage'),
      'template', 'registration_confirmed', 'purpose', 'notification', 'topic', 'events', 'wording_kind', null, 'approval', false)
  end
$$;

-- The placeholders each email may use (src/lib/merge/catalogue.ts PLACEHOLDERS; tests/merge-catalogue.test.ts keeps them equal).
create or replace function app._email_placeholders(p_key text) returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select case p_key
    when 'payment_receipt' then array['center_name', 'center_short_name', 'recipient_first_name', 'recipient_name', 'household_name', 'household_number', 'payment_amount', 'payment_date', 'payment_method', 'payment_receipt_number', 'payment_applied_to', 'payment_receipt_name', 'receipt_signed_by', 'receipt_note']
    when 'pledge_recorded' then array['center_name', 'center_short_name', 'recipient_first_name', 'recipient_name', 'household_name', 'household_number', 'pledge_amount', 'pledge_number', 'pledge_date', 'pledge_due_date', 'pledge_for', 'pledge_balance', 'pledge_signed_by', 'pledge_note']
    when 'registration_confirmed' then array['center_name', 'center_short_name', 'recipient_first_name', 'recipient_name', 'household_name', 'household_number', 'event_title', 'event_number', 'event_date', 'event_time', 'event_place', 'registration_count']
  end
$$;

-- May the caller read (p_manage false) or switch and word (true) this email in this community?
create or replace function app._email_can(p_center uuid, p_key text, p_manage boolean) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare m jsonb := app._email_trigger_meta(p_key);
begin
  if m is null or auth.uid() is null then return false; end if;
  if p_manage then return app.has_permission(p_center, m->>'manage'); end if;
  return app.has_permission(p_center, 'settings.manage')
      or exists (select 1 from jsonb_array_elements_text(m->'view') v where app.has_permission(p_center, v));
end $$;

-- The email's row when it is switched on and its module is on, else null. Cheap: the triggers call it on every write.
create or replace function app._email_automation_on(p_center uuid, p_key text) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select a.id from app.email_automations a
   where a.center_id = p_center and a.kind = 'trigger' and a.trigger_key = p_key and a.enabled
     and app.module_enabled(p_center, app._email_trigger_meta(p_key)->>'module')
$$;

-- ══ The triggers: one compose job per record, never blocking the write ══════════
create or replace function app._email_compose_later(p_center uuid, p_automation uuid, p_ref uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.enqueue_job(p_center, 'messaging.compose', jsonb_build_object('automation_id', p_automation, 'ref_id', p_ref), now(), 5);
end $$;

-- A transaction that uploads donations marks itself, so its rows wait for app.email_receipts_for_uploaded instead.
create or replace function app.mark_donation_upload() returns void
language plpgsql volatile set search_path = app, public, extensions as $$
begin
  perform set_config('app.donation_upload', 'on', true);
end $$;

create or replace function app._email_in_upload() returns boolean
language sql stable set search_path = app, public, extensions as $$
  select coalesce(current_setting('app.donation_upload', true), '') = 'on'
$$;

create or replace function app.payments_receipt_email() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_auto uuid;
begin
  if not app.statement_counted_status(new.status) or new.is_opening_balance or new.is_historical
     or coalesce(btrim(new.receipt_number), '') = '' or new.crm_external_id is not null then
    return null;
  end if;
  if tg_op = 'UPDATE' and app.statement_counted_status(old.status) then return null; end if;
  if app._email_in_upload() then return null; end if;
  v_auto := app._email_automation_on(new.center_id, 'payment_receipt');
  if v_auto is not null then perform app._email_compose_later(new.center_id, v_auto, new.id); end if;
  return null;
exception when others then
  -- The payment is recorded whatever happens to its email; the reason is in the database log.
  raise warning 'payments_receipt_email: could not queue the receipt email for payment %: %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists payments_receipt_email on app.payments;
create trigger payments_receipt_email after insert or update of status on app.payments
  for each row execute function app.payments_receipt_email();

-- Pledges with a record of their own (fees, recurring cycles, store orders, registrations) are not confirmed by email here.
create or replace function app._email_pledge_source_ok(p_source app.pledge_source) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select p_source::text not in ('pathshala_fee', 'membership_fee', 'recurring', 'store', 'rsvp_commitment')
$$;

create or replace function app.pledges_recorded_email() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_auto uuid;
begin
  if not app._email_pledge_source_ok(new.source) or new.crm_external_id is not null or new.status = 'cancelled' then return null; end if;
  if app._email_in_upload() then return null; end if;
  v_auto := app._email_automation_on(new.center_id, 'pledge_recorded');
  if v_auto is not null then perform app._email_compose_later(new.center_id, v_auto, new.id); end if;
  return null;
exception when others then
  raise warning 'pledges_recorded_email: could not queue the pledge email for pledge %: %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists pledges_recorded_email on app.pledges;
create trigger pledges_recorded_email after insert on app.pledges
  for each row execute function app.pledges_recorded_email();

create or replace function app.rsvps_registered_email() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_auto uuid;
begin
  if new.status not in ('rsvpd', 'confirmed') or new.source = 'import' then return null; end if;
  if tg_op = 'UPDATE' and old.status in ('rsvpd', 'confirmed') then return null; end if;
  v_auto := app._email_automation_on(new.center_id, 'registration_confirmed');
  if v_auto is not null then perform app._email_compose_later(new.center_id, v_auto, new.id); end if;
  return null;
exception when others then
  raise warning 'rsvps_registered_email: could not queue the registration email for RSVP %: %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists rsvps_registered_email on app.rsvps;
create trigger rsvps_registered_email after insert or update of status on app.rsvps
  for each row execute function app.rsvps_registered_email();

-- ══ The facts an email is written from ═══════════════════════════════════════
-- The household's adults with an email address: the lead person (who paid, pledged or registered) when they are one of them,
-- else all of them. One per address, the primary member first.
create or replace function app._email_recipients(p_household uuid, p_lead uuid, p_majority int) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  with adults as (
    select pe.id, lower(btrim(pe.email::text)) as address,
           coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) as first_name,
           btrim(coalesce(nullif(btrim(pe.preferred_name), ''), pe.first_name) || ' ' || pe.last_name) as name,
           pe.language, hm.is_primary
      from app.household_members hm join app.people pe on pe.id = hm.person_id
     where hm.household_id = p_household and hm.left_at is null and not coalesce(pe.is_deceased, false) and pe.merged_into_id is null
       and app._statement_adult(pe.date_of_birth, hm.role, p_majority)
       and coalesce(btrim(pe.email::text), '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ), chosen as (
    select * from adults where id = p_lead
    union all
    select * from adults where not exists (select 1 from adults a where a.id = p_lead)
  ), one_each as (
    select distinct on (address) * from chosen order by address, is_primary desc, name
  )
  select coalesce(jsonb_agg(jsonb_build_object('person_id', id, 'address', address, 'first_name', first_name, 'name', name,
                                               'language', language) order by is_primary desc, name), '[]'::jsonb)
    from one_each
$$;

-- First names of the household's members under the age of majority (not a name an adult of the household also has).
create or replace function app._email_minor_first_names(p_household uuid, p_majority int) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  with m as (
    select pe.first_name, pe.preferred_name, app._statement_adult(pe.date_of_birth, hm.role, p_majority) as adult
      from app.household_members hm join app.people pe on pe.id = hm.person_id
     where hm.household_id = p_household and hm.left_at is null
  )
  select coalesce(jsonb_agg(distinct btrim(n)), '[]'::jsonb)
    from m cross join lateral unnest(array[m.first_name, m.preferred_name]) n
   where not m.adult and length(btrim(coalesce(n, ''))) >= 2
     and lower(btrim(n)) not in (select lower(btrim(x)) from m a cross join lateral unnest(array[a.first_name, a.preferred_name]) x
                                  where a.adult and x is not null)
$$;

-- Everything one email of this kind could say about this record, with no formatting (the background service and the preview
-- format it). `skip` says why the record gets no email.
create or replace function app._email_facts(p_key text, p_center uuid, p_ref uuid, p_majority int) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  c app.centers; pay app.payments; pl app.pledges; r app.rsvps; ev app.events;
  v_maj int := greatest(18, least(coalesce(p_majority, 18), 25));
  v_out jsonb; v_skip text; v_hh uuid; v_lead uuid; v_kind text; v_minors jsonb := '[]'::jsonb; v_recipients jsonb := '[]'::jsonb;
  v_payer_adult boolean; v_name text;
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
    elsif not app._email_pledge_source_ok(pl.source) then v_skip := 'Not sent: this kind of pledge has its own record and messages.';
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
    v_recipients := app._email_recipients(v_hh, v_lead, v_maj);
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

-- The most recent record a preview can be written from.
create or replace function app._email_sample_ref(p_center uuid, p_key text) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select case p_key
    when 'payment_receipt' then (select p.id from app.payments p
                                  where p.center_id = p_center and app.statement_counted_status(p.status) and not p.is_opening_balance
                                    and not p.is_historical and coalesce(btrim(p.receipt_number), '') <> ''
                                  order by p.received_on desc, p.created_at desc limit 1)
    when 'pledge_recorded' then (select p.id from app.pledges p
                                  where p.center_id = p_center and p.status <> 'cancelled' and app._email_pledge_source_ok(p.source)
                                  order by p.pledged_at desc limit 1)
    when 'registration_confirmed' then (select r.id from app.rsvps r join app.events e on e.id = r.event_id
                                         where r.center_id = p_center and r.status in ('rsvpd', 'confirmed')
                                         order by r.created_at desc limit 1)
  end
$$;

-- ══ The screen: Settings › Automatic emails ═══════════════════════════════════
create or replace function app.email_automations_state(p_center uuid, p_majority int default 18) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare k text; m jsonb; a app.email_automations; v_out jsonb := '[]'::jsonb; v_row jsonb; v_ref uuid; v_sample jsonb; v_on boolean;
begin
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then raise exception 'That community was not found.'; end if;
  if not (app._email_can(p_center, 'payment_receipt', false) or app._email_can(p_center, 'registration_confirmed', false)) then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  foreach k in array array['payment_receipt', 'pledge_recorded', 'registration_confirmed'] loop
    m := app._email_trigger_meta(k);
    v_on := app.module_enabled(p_center, m->>'module');
    if not app._email_can(p_center, k, false) then
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', k, 'title', m->>'title', 'module', m->>'module', 'module_on', v_on, 'can_view', false));
      continue;
    end if;
    select * into a from app.email_automations where center_id = p_center and kind = 'trigger' and trigger_key = k;
    v_sample := null;
    if v_on then
      v_ref := app._email_sample_ref(p_center, k);
      if v_ref is not null then
        v_sample := app._email_facts(k, p_center, v_ref, p_majority);
        -- A preview needs names, not addresses.
        v_sample := jsonb_set(v_sample, '{recipients}', coalesce((select jsonb_agg(x - 'address') from jsonb_array_elements(v_sample->'recipients') x), '[]'::jsonb));
      end if;
    end if;
    v_row := jsonb_build_object(
      'key', k, 'title', m->>'title', 'module', m->>'module', 'module_on', v_on, 'can_view', true,
      'can_edit', app._email_can(p_center, k, true),
      'enabled', coalesce(a.enabled, false), 'options', coalesce(a.options, '{}'::jsonb),
      'updated_at', a.updated_at,
      'template_key', m->>'template',
      'wording', coalesce((select jsonb_agg(jsonb_build_object('language', t.language, 'subject', t.subject, 'body', t.body, 'version', t.version)
                                            order by t.language)
                             from (select distinct on (mt.language) mt.language, mt.subject, mt.body, mt.version
                                     from app.message_templates mt
                                    where mt.center_id = p_center and mt.key = m->>'template' and mt.channel = 'email'
                                    order by mt.language, mt.version desc) t), '[]'::jsonb),
      'standard', (select jsonb_build_object('subject', mt.subject, 'body', mt.body) from app.message_templates mt
                    where mt.center_id is null and mt.key = m->>'template' and mt.channel = 'email' and mt.language = 'en'
                    order by mt.version desc limit 1),
      'week', (select jsonb_build_object('queued', count(*) filter (where s.outcome = 'queued'),
                                         'skipped', count(*) filter (where s.outcome = 'skipped'))
                 from app.email_automation_sends s
                where s.automation_id = a.id and s.created_at > now() - interval '7 days'),
      'approval', case when (m->>'approval')::boolean then app.check_statement_templates_approved(p_center) end,
      'sample', v_sample);
    v_out := v_out || jsonb_build_array(v_row);
  end loop;
  return jsonb_build_object('emails', v_out);
end $$;

-- What an email did lately: when, to whom (an adult's address; the household's number), queued or not and why.
create or replace function app.email_automation_log(p_center uuid, p_key text, p_limit int default 25) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if app._email_trigger_meta(p_key) is null then raise exception 'Unknown automatic email "%".', p_key; end if;
  if not app._email_can(p_center, p_key, false) then
    raise exception 'You don''t have access to this area.' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'at', x.created_at, 'to', nullif(x.to_address, ''), 'outcome', x.outcome, 'reason', x.reason,
             'household_number', x.household_number, 'status', x.status, 'failure', x.failure_reason, 'sent_at', x.sent_at)
             order by x.created_at desc)
      from (select s.created_at, s.to_address, s.outcome, s.reason, h.household_number, msg.status, msg.failure_reason, msg.sent_at
              from app.email_automation_sends s
              join app.email_automations a on a.id = s.automation_id
              left join app.households h on h.id = s.household_id
              left join app.messages msg on msg.id = s.message_id
             where a.center_id = p_center and a.kind = 'trigger' and a.trigger_key = p_key
             order by s.created_at desc
             limit greatest(1, least(coalesce(p_limit, 25), 100))) x), '[]'::jsonb);
end $$;

-- Save the community's wording for one email in one language: a new version (the older ones stay, audited).
create or replace function app.save_email_automation_wording(p_center uuid, p_key text, p_language text, p_subject text, p_body text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare m jsonb := app._email_trigger_meta(p_key); v_lang text := lower(btrim(coalesce(p_language, '')));
        v_subject text := btrim(coalesce(p_subject, '')); v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
        v_unknown text[]; v_version int; v_last app.message_templates;
begin
  if m is null then raise exception 'Unknown automatic email "%".', p_key; end if;
  if not app._email_can(p_center, p_key, true) then
    raise exception 'Changing the wording of the % needs %.', lower(m->>'title'), m->>'manage' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, m->>'module');
  if v_lang !~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$' then raise exception 'Choose the language this wording is in.'; end if;
  if v_subject = '' then raise exception 'Write a subject line.'; end if;
  if char_length(v_subject) > 200 then raise exception 'Keep the subject under 200 characters.'; end if;
  if v_subject ~ '[\r\n]' then raise exception 'The subject is one line.'; end if;
  if v_body = '' then raise exception 'Write the email.'; end if;
  if char_length(v_body) > 20000 then raise exception 'Keep the email under 20,000 characters.'; end if;
  select array_agg(distinct x[1] order by x[1]) into v_unknown
    from regexp_matches(v_subject || E'\n' || v_body, '\{\{\s*([A-Za-z0-9_]+)\s*\}\}', 'g') x
   where x[1] <> all (app._email_placeholders(p_key));
  if v_unknown is not null then
    raise exception 'The wording uses {{%}}, which this email does not have. Choose from the list of placeholders.',
      array_to_string(v_unknown, '}}, {{') using errcode = '22023';
  end if;
  select * into v_last from app.message_templates
   where center_id = p_center and key = m->>'template' and channel = 'email' and language = v_lang
   order by version desc limit 1;
  if v_last.id is not null and v_last.subject is not distinct from v_subject and v_last.body = v_body then
    return jsonb_build_object('version', v_last.version, 'language', v_lang, 'unchanged', true);
  end if;
  v_version := coalesce(v_last.version, 0) + 1;
  perform app.set_audit_context('Automatic email wording: ' || (m->>'title') || ' (' || v_lang || ')');
  insert into app.message_templates (center_id, key, channel, language, subject, body, version)
  values (p_center, m->>'template', 'email', v_lang, v_subject, v_body, v_version);
  insert into app.email_automations (center_id, kind, trigger_key, template_key)
  values (p_center, 'trigger', p_key, m->>'template')
  on conflict (center_id, trigger_key) where kind = 'trigger' do nothing;
  return jsonb_build_object('version', v_version, 'language', v_lang, 'unchanged', false,
                            'approval', case when (m->>'approval')::boolean then app.check_statement_templates_approved(p_center) end);
end $$;

-- Switch an email on or off (and, for receipts, whether uploaded donations get one too). No 2FA step (owner rule 2026-10-13).
create or replace function app.set_email_automation(p_center uuid, p_key text, p_enabled boolean, p_uploaded boolean default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare m jsonb := app._email_trigger_meta(p_key); a app.email_automations; v_appr jsonb;
begin
  if m is null then raise exception 'Unknown automatic email "%".', p_key; end if;
  if p_enabled is null then raise exception 'Say whether the email is on or off.'; end if;
  if not app._email_can(p_center, p_key, true) then
    raise exception 'Switching the % needs %.', lower(m->>'title'), m->>'manage' using errcode = 'insufficient_privilege';
  end if;
  if p_uploaded is not null and p_key <> 'payment_receipt' then
    raise exception 'Only receipts have the choice for uploaded donations.';
  end if;
  if p_enabled then
    perform app.assert_module_enabled(p_center, m->>'module');
    if (m->>'approval')::boolean then
      v_appr := app.check_statement_templates_approved(p_center);
      if not coalesce((v_appr->>'ok')::boolean, false) then
        raise exception 'The % goes only while the treasurer''s approval of the receipt templates is current. %',
          lower(m->>'title'), v_appr->>'detail' using errcode = 'check_violation';
      end if;
    end if;
  end if;
  perform app.set_audit_context('Automatic email "' || (m->>'title') || '" ' || case when p_enabled then 'switched on' else 'switched off' end
                                || case when p_uploaded is null then '' when p_uploaded then ', uploaded donations too' else ', not for uploaded donations' end);
  insert into app.email_automations as ea (center_id, kind, trigger_key, template_key, enabled, options)
  values (p_center, 'trigger', p_key, m->>'template', p_enabled,
          case when p_uploaded is null then '{}'::jsonb else jsonb_build_object('uploaded', p_uploaded) end)
  on conflict (center_id, trigger_key) where kind = 'trigger' do update
     set enabled = excluded.enabled,
         options = case when p_uploaded is null then ea.options else ea.options || jsonb_build_object('uploaded', p_uploaded) end
  returning * into a;
  return jsonb_build_object('key', p_key, 'enabled', a.enabled, 'options', a.options);
end $$;

-- A test of the saved wording to the caller's own sign-in address, with the preview's values (only this email's names).
create or replace function app.send_email_automation_test(p_center uuid, p_key text, p_language text, p_vars jsonb) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare m jsonb := app._email_trigger_meta(p_key); v_to text; v_vars jsonb := '{}'::jsonb; k text;
begin
  if m is null then raise exception 'Unknown automatic email "%".', p_key; end if;
  if not app._email_can(p_center, p_key, true) then
    raise exception 'Sending a test of the % needs %.', lower(m->>'title'), m->>'manage' using errcode = 'insufficient_privilege';
  end if;
  perform app.assert_module_enabled(p_center, m->>'module');
  select nullif(btrim(u.email), '') into v_to from auth.users u where u.id = auth.uid();
  if v_to is null then raise exception 'Your sign-in has no email address to send the test to.'; end if;
  foreach k in array app._email_placeholders(p_key) loop
    v_vars := v_vars || jsonb_build_object(k, left(regexp_replace(coalesce(p_vars->>k, ''), '[[:cntrl:]]+', ' ', 'g'), 500));
  end loop;
  v_vars := v_vars || jsonb_build_object('language', coalesce(nullif(lower(btrim(p_language)), ''), 'en'));
  return app.enqueue_notice(p_center, 'email', v_to, m->>'template', v_vars, 'test', now(), null, null,
                            jsonb_build_object('automation_test', p_key), false);
end $$;

-- ══ Uploaded donations (the hook the upload calls: src/lib/automatic-emails/hooks.ts onDonationsUploaded) ═════
create or replace function app.email_receipts_for_uploaded(p_center uuid, p_payments uuid[]) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; v_appr jsonb; v_n int := 0; v_total int; p record;
begin
  if not app.has_permission(p_center, 'giving.manage') then
    raise exception 'Receipts for uploaded donations need giving.manage.' using errcode = 'insufficient_privilege';
  end if;
  v_total := coalesce(cardinality(p_payments), 0);
  if v_total > 5000 then raise exception 'Send receipts for at most 5,000 uploaded donations at a time.'; end if;
  select * into a from app.email_automations where center_id = p_center and kind = 'trigger' and trigger_key = 'payment_receipt';
  if a.id is null or not a.enabled or not app.module_enabled(p_center, 'giving') then
    return jsonb_build_object('queued', 0, 'skipped', v_total, 'reason', 'Automatic receipts are switched off.');
  end if;
  if not coalesce((a.options->>'uploaded')::boolean, false) then
    return jsonb_build_object('queued', 0, 'skipped', v_total, 'reason', 'Receipts for uploaded donations are switched off.');
  end if;
  v_appr := app.check_statement_templates_approved(p_center);
  if not coalesce((v_appr->>'ok')::boolean, false) then
    return jsonb_build_object('queued', 0, 'skipped', v_total, 'reason', v_appr->>'detail');
  end if;
  for p in select distinct x.id from app.payments x
            where x.id = any (p_payments) and x.center_id = p_center and app.statement_counted_status(x.status)
              and not x.is_opening_balance and not x.is_historical and coalesce(btrim(x.receipt_number), '') <> '' loop
    perform app._email_compose_later(p_center, a.id, p.id);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('queued', v_n, 'skipped', v_total - v_n, 'reason', null);
end $$;

-- ══ The background service (connect_worker only) ════════════════════════════
-- The community's place, so the service can work out its age of majority (src/lib/age-of-majority.ts) before reading the record.
create or replace function app.worker_email_context(p_automation uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return (select jsonb_build_object('center_id', c.id, 'country', c.country, 'state_region', c.state_region,
                                    'age_of_majority', c.rules->'age_of_majority')
            from app.email_automations a join app.centers c on c.id = a.center_id where a.id = p_automation);
end $$;

-- The record's facts, or why it gets no email (that reason is written to the log once).
create or replace function app.worker_email_facts(p_automation uuid, p_ref uuid, p_majority int) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; m jsonb; v_facts jsonb; v_skip text; v_appr jsonb; v_hh uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into a from app.email_automations where id = p_automation;
  if a.id is null then return jsonb_build_object('skip', 'Not sent: the automatic email no longer exists.'); end if;
  m := app._email_trigger_meta(a.trigger_key);
  if not a.enabled then v_skip := 'Not sent: the email was switched off before it went.';
  elsif not app.module_enabled(a.center_id, m->>'module') then
    v_skip := 'Not sent: the ' || coalesce((select label from app.modules where key = m->>'module'), m->>'module') || ' module is switched off.';
  elsif (m->>'approval')::boolean then
    v_appr := app.check_statement_templates_approved(a.center_id);
    if not coalesce((v_appr->>'ok')::boolean, false) then v_skip := 'Not sent: ' || (v_appr->>'detail'); end if;
  end if;
  v_facts := app._email_facts(a.trigger_key, a.center_id, p_ref, p_majority);
  v_skip := coalesce(v_skip, v_facts->>'skip');
  if v_skip is null and a.trigger_key = 'registration_confirmed' and (v_facts #>> '{event,starts_at}') is not null
     and (v_facts #>> '{event,starts_at}')::timestamptz <= now() then
    v_skip := 'Not sent: the event had already started.';
  end if;
  if v_skip is null and jsonb_array_length(coalesce(v_facts->'recipients', '[]'::jsonb)) = 0 then
    v_skip := case when v_facts->'household' is null then 'Not sent: the guest gave no email address.'
                   else 'Not sent: no adult of the household has an email address on file.' end;
  end if;
  if v_skip is not null then
    v_hh := case when (v_facts #>> '{household,id}') ~* '^[0-9a-f-]{36}$' then (v_facts #>> '{household,id}')::uuid end;
    insert into app.email_automation_sends (center_id, automation_id, ref_id, period, household_id, to_address, outcome, reason)
    values (a.center_id, a.id, p_ref, '', v_hh, '', 'skipped', v_skip)
    on conflict on constraint email_automation_sends_once do nothing;
  end if;
  return v_facts || jsonb_build_object('skip', v_skip, 'automation', jsonb_build_object('id', a.id, 'key', a.trigger_key, 'template_key', a.template_key));
end $$;

-- Queue one email: once per record, period and address (the duplicate guard), through app.enqueue_notice. The values are the
-- service's (src/lib/merge/build.ts); the community's own wording in the recipient's language, else in the community's main
-- language, else the standard wording.
create or replace function app.worker_email_enqueue(p_automation uuid, p_ref uuid, p_period text, p_household uuid, p_person uuid,
                                                    p_address text, p_vars jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare a app.email_automations; m jsonb; v_to text; v_period text := coalesce(p_period, ''); v_main text; v_plang text; v_lang text;
        v_msg uuid; v_status text; v_reason text; v_outcome text := 'queued';
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
  -- Two runs for the same record cannot both queue it.
  perform pg_advisory_xact_lock(hashtextextended('email_automation:' || a.id || ':' || p_ref || ':' || v_period || ':' || v_to, 0));
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
    else v_plang end;

  if not app.messaging_recipient_ok(a.center_id, 'email', v_to, m->>'purpose') then
    v_outcome := 'skipped';
    v_reason := 'Not sent: this sandbox sends only to verified test recipients (Settings › Limits).';
  else
    begin
      v_msg := app.enqueue_notice(a.center_id, 'email', v_to, a.template_key,
                                  coalesce(p_vars, '{}'::jsonb) || jsonb_build_object('language', v_lang)
                                    || case when p_person is not null then jsonb_build_object('person_id', p_person::text) else '{}'::jsonb end,
                                  m->>'purpose', now(), m->>'topic', null,
                                  jsonb_build_object('automation_id', a.id, 'ref_id', p_ref), true);
      select msg.status, msg.failure_reason into v_status, v_reason from app.messages msg where msg.id = v_msg;
      if v_status <> 'queued' then v_outcome := 'skipped'; else v_reason := null; end if;
    exception when others then
      v_outcome := 'skipped';
      v_reason := 'Not sent: ' || sqlerrm;
      v_msg := null;
    end;
  end if;
  insert into app.email_automation_sends (center_id, automation_id, ref_id, period, household_id, person_id, to_address, outcome, reason, message_id)
  values (a.center_id, a.id, p_ref, v_period, p_household, p_person, v_to, v_outcome, v_reason, v_msg);
  return jsonb_build_object('outcome', v_outcome, 'reason', v_reason, 'message_id', v_msg);
end $$;

-- ══ The treasurer's approval covers the community's own receipt and pledge email wording ═════
-- 0300's body, plus "emails" when the community saved its own wording for the receipt or pledge email (absent otherwise, so
-- an approval given before this migration stays current).
create or replace function app.statement_templates_evidence(p_center uuid) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select (select jsonb_build_object('templates', coalesce(jsonb_agg(jsonb_build_object(
                   'kind', k.kind, 'customised', t.id is not null, 'signed_by', t.signed_by, 'personal_note', t.personal_note) order by k.o), '[]'::jsonb))
            from unnest(array['donation_receipt','pledge_confirmation','year_end_statement']) with ordinality as k(kind, o)
            left join app.receipt_templates t on t.center_id = p_center and t.kind = k.kind)
      || coalesce((select jsonb_build_object('emails', jsonb_agg(jsonb_build_object(
                            'key', e.key, 'language', e.language, 'version', e.version, 'subject', e.subject, 'body', e.body)
                            order by e.key, e.language))
                     from (select distinct on (mt.key, mt.language) mt.key, mt.language, mt.version, mt.subject, mt.body
                             from app.message_templates mt
                            where mt.center_id = p_center and mt.channel = 'email' and mt.key in ('receipt', 'pledge_recorded')
                            order by mt.key, mt.language, mt.version desc) e
                   having count(*) > 0), '{}'::jsonb)
$$;

-- ══ The standard wording (platform defaults, English; a community writes its own in any language) ═════
-- "receipt" (0220) was never sent by anything; version 2 uses this email's placeholders.
insert into app.message_templates (center_id, key, channel, language, subject, body, version)
select null, v.key, 'email'::app.channel, 'en', v.subject, v.body, v.version
  from (values
  ('receipt', 2, 'Receipt {{payment_receipt_number}} from {{center_name}}',
   E'Dear {{recipient_first_name}},\n\nThank you. {{center_name}} received {{payment_amount}} on {{payment_date}} ({{payment_method}}), for {{payment_applied_to}}.\n\nReceipt number: {{payment_receipt_number}}\nHousehold: {{household_name}} ({{household_number}})\n\n{{receipt_note}}\n\n{{receipt_signed_by}}'),
  ('pledge_recorded', 1, 'Your pledge {{pledge_number}} to {{center_name}}',
   E'Dear {{recipient_first_name}},\n\nThank you for your pledge of {{pledge_amount}} for {{pledge_for}}, made on {{pledge_date}}.\n\nPledge number: {{pledge_number}}\nDue: {{pledge_due_date}}\nStill to pay: {{pledge_balance}}\nHousehold: {{household_name}} ({{household_number}})\n\n{{pledge_note}}\n\n{{pledge_signed_by}}'),
  ('registration_confirmed', 1, 'You are registered: {{event_title}}',
   E'Dear {{recipient_first_name}},\n\nYour registration for {{event_title}} is confirmed. Registered: {{registration_count}}.\n\nWhen: {{event_date}}, {{event_time}}\nWhere: {{event_place}}\n\nWe look forward to seeing you.\n{{center_name}}')
  ) as v(key, version, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = 'email' and t.language = 'en' and t.version = v.version);

-- ══ Who may call what ════════════════════════════════════════════════════════
do $$
declare f text;
begin
  -- Internal: only the functions above call them.
  foreach f in array array[
    'app._email_trigger_meta(text)', 'app._email_placeholders(text)', 'app._email_can(uuid, text, boolean)',
    'app._email_automation_on(uuid, text)', 'app._email_compose_later(uuid, uuid, uuid)', 'app._email_in_upload()',
    'app._email_pledge_source_ok(app.pledge_source)', 'app.payments_receipt_email()', 'app.pledges_recorded_email()',
    'app.rsvps_registered_email()', 'app._email_recipients(uuid, uuid, integer)', 'app._email_minor_first_names(uuid, integer)',
    'app._email_facts(text, uuid, uuid, integer)', 'app._email_sample_ref(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- The portal.
  foreach f in array array[
    'app.email_automations_state(uuid, integer)', 'app.email_automation_log(uuid, text, integer)',
    'app.save_email_automation_wording(uuid, text, text, text, text)', 'app.set_email_automation(uuid, text, boolean, boolean)',
    'app.send_email_automation_test(uuid, text, text, jsonb)', 'app.email_receipts_for_uploaded(uuid, uuid[])',
    'app.mark_donation_upload()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- The background service only.
  foreach f in array array[
    'app.worker_email_context(uuid)', 'app.worker_email_facts(uuid, uuid, integer)',
    'app.worker_email_enqueue(uuid, uuid, text, uuid, uuid, text, jsonb)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to connect_worker', f);
  end loop;
end $$;
revoke execute on function app.statement_templates_evidence(uuid) from public, anon, authenticated;

comment on function app.set_email_automation(uuid, text, boolean, boolean) is
  'Settings › Automatic emails (0770): switch one automatic email on or off; p_uploaded (receipts only) also sends receipts for uploaded donations. Needs the email''s manage permission; Giving emails need the treasurer''s current approval of the receipt templates. No 2FA step.';
comment on function app.email_receipts_for_uploaded(uuid, uuid[]) is
  'The donation upload''s hook (0770): queue receipt emails for these uploaded payments, only when automatic receipts AND "uploaded donations too" are on and the treasurer''s approval is current. Returns {queued, skipped, reason}.';
comment on function app.mark_donation_upload() is
  'Call in the transaction that inserts uploaded donations (0770): its payments and pledges get no automatic email from the triggers; app.email_receipts_for_uploaded decides afterwards.';
