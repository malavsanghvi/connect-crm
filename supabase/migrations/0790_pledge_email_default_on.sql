-- 0790 · The pledge confirmation email is ON by default, for every community (owner request 2026-10-14: "A pledge email should be sent
-- to the person regardless of if the pledge has been created by the member, center staff one-by-one OR in bulk"). Part 1 of 4 of the
-- pledge print + email work (0790 this, 0791 the PDF, 0792 the email, 0793 the bulk upload). NEEDS OWNER OK: it turns an email on for
-- every community, so a family that pledges now receives one.
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Until now "no row = off": a community had to switch the pledge confirmation on (0770). From here every community has the email
--   on unless it switches it off, with the same row and the same switch in Settings › Automatic emails.
--
--   app._pledge_email_automation(center)   the community's pledge_recorded row, made (switched ON) when it does not exist yet. The
--                                          pledge trigger, the upload and the "Email" menu item all use it, so there is always one row.
--   centers_pledge_email_default           AFTER INSERT on app.centers: a community made from now on has its row, switched on.
--   the backfill (below)                   every community without a row gets one, switched on. A row that is switched off stays off
--                                          when someone switched it off on purpose (the audit log has the entry); a row that was only
--                                          ever created by saving wording (never switched on or off by a person) is switched on.
--   app.email_automation_sends.reason_code why an email was not sent, as a word the screens can act on (no_email, declined, history,
--                                          not_approved, switched_off, sandbox, other). The sentence stays in `reason`.
--   app.pledges_recorded_email()           the 0770 trigger, with three more rules: a pledge dated more than 30 days before it is
--                                          recorded is history, not a new promise (an upload of old pledge cards) and gets no email; a
--                                          demo community queues nothing (it is made of invented people); and an upload that chose not
--                                          to email the families (0793: app.pledge_email = 'off') queues nothing.
--
--   Everything else of 0770 stays: the treasurer's current approval of the receipt templates is still needed before an automatic
--   pledge email goes (the reason is written to the pledge's History and the upload result when it is not), a sandbox reaches only
--   verified test recipients, nothing is sent to imported history, to pledges that have their own messages (fees, recurring cycles,
--   store orders, RSVP commitments) or to what the import tool writes.
set client_min_messages = warning;

alter table app.email_automation_sends add column if not exists reason_code text;
alter table app.email_automation_sends drop constraint if exists email_automation_sends_reason_code_check;
alter table app.email_automation_sends add constraint email_automation_sends_reason_code_check
  check (reason_code is null or reason_code in ('no_email', 'declined', 'history', 'not_approved', 'switched_off', 'sandbox', 'other'));
comment on column app.email_automation_sends.reason_code is
  'Why an email was not sent, as a word (0790): no_email (nobody to send to has an address), declined (the person recording it chose not to email), history (an old or imported record), not_approved (the treasurer''s approval of the templates is not current), switched_off, sandbox (a sandbox sends only to verified test recipients), other. null = it was queued.';

-- ── The community's own row, switched on ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function app._pledge_email_automation(p_center uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_id uuid;
begin
  select a.id into v_id from app.email_automations a where a.center_id = p_center and a.kind = 'trigger' and a.trigger_key = 'pledge_recorded';
  if v_id is not null then return v_id; end if;
  insert into app.email_automations (center_id, kind, trigger_key, template_key, enabled, created_by, updated_by)
  values (p_center, 'trigger', 'pledge_recorded', 'pledge_recorded', true, null, null)
  on conflict (center_id, trigger_key) where kind = 'trigger' do nothing
  returning id into v_id;
  if v_id is null then
    select a.id into v_id from app.email_automations a where a.center_id = p_center and a.kind = 'trigger' and a.trigger_key = 'pledge_recorded';
  end if;
  return v_id;
end $$;
revoke execute on function app._pledge_email_automation(uuid) from public, anon, authenticated;
grant execute on function app._pledge_email_automation(uuid) to service_role;
comment on function app._pledge_email_automation(uuid) is
  'The community''s pledge_recorded row of app.email_automations (0770), made and switched ON when it does not exist yet (0790: the pledge confirmation is on by default).';

-- A community made from now on has the row, switched on. Never blocks making the community.
create or replace function app.centers_pledge_email_default() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  begin
    perform app._pledge_email_automation(new.id);
  exception when others then
    raise warning 'centers_pledge_email_default: could not make the pledge email row for community %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function app.centers_pledge_email_default() from public, anon, authenticated;
drop trigger if exists centers_pledge_email_default on app.centers;
create trigger centers_pledge_email_default after insert on app.centers
  for each row execute function app.centers_pledge_email_default();

-- ── The backfill: every community has the row, switched on unless a person switched it off ────────────────────────────────────────
select app.set_audit_context('The pledge confirmation email is on by default (0790): a row for every community, switched on unless someone switched it off on purpose');
insert into app.email_automations (center_id, kind, trigger_key, template_key, enabled, created_by, updated_by)
select c.id, 'trigger', 'pledge_recorded', 'pledge_recorded', true, null, null
  from app.centers c
 where not exists (select 1 from app.email_automations a where a.center_id = c.id and a.kind = 'trigger' and a.trigger_key = 'pledge_recorded');

update app.email_automations a
   set enabled = true
 where a.kind = 'trigger' and a.trigger_key = 'pledge_recorded' and not a.enabled
   and not exists (select 1 from app.audit_log l
                    where l.record_table = 'email_automations' and l.record_id = a.id::text and l.action = 'email_automations.update'
                      and l.before->>'enabled' = 'true' and l.after->>'enabled' = 'false');

-- ── The trigger: three more reasons not to queue ─────────────────────────────────────────────────────────────────────────────────
create or replace function app.pledges_recorded_email() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_auto uuid;
begin
  if app._email_in_upload() or app._email_in_import() then return null; end if;
  -- An upload that chose not to email the families (0793) says so for its own transaction; it writes the reason on each pledge.
  if coalesce(current_setting('app.pledge_email', true), '') = 'off' then return null; end if;
  -- Only a pledge that is still to be paid when it is recorded (an imported or settled one is history, not a new promise).
  if not app._email_pledge_source_ok(new.source) or new.crm_external_id is not null
     or new.status not in ('open', 'partially_paid') then
    return null;
  end if;
  -- A pledge dated long before today (an upload of old pledge cards) is history too; last week's pledge card still is a promise.
  if new.pledged_at < now() - interval '30 days' then return null; end if;
  -- A demo community is made of invented people: nothing is queued for it.
  if app.is_demo_center(new.center_id) then return null; end if;
  v_auto := app._email_automation_on(new.center_id, 'pledge_recorded');
  if v_auto is null then return null; end if;
  begin
    perform app._email_compose_later(new.center_id, v_auto, new.id);
  exception when others then
    raise warning 'pledges_recorded_email: could not queue the pledge email for pledge %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke execute on function app.pledges_recorded_email() from public, anon, authenticated;
grant execute on function app.pledges_recorded_email() to service_role;
comment on function app.pledges_recorded_email() is
  'AFTER INSERT on app.pledges: queues the pledge confirmation (0770) while it is switched on, which it is by default (0790). Not for imported history, system-made pledges, a pledge dated over 30 days ago, a demo community, or an upload that chose not to email.';
