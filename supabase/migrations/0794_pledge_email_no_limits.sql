-- 0794 · The pledge email has no limits of its own (owner decision 2026-10-14: "Pledge Email - No need for limits."). A follow-up to 0790-0793.
-- NEEDS OWNER OK: a bulk upload of old pledge cards now emails every family.
--
-- WHAT CHANGES, IN PLAIN WORDS
--   1. No "history" by date. 0790 kept the automatic email from a pledge dated more than 30 days before it was recorded. That rule is gone:
--      every pledge recorded by a member, by staff one at a time or in a bulk upload gets its email, whatever its date. What stays out is what
--      the data model itself marks as history: pledges the import tool wrote (app.client_app = 'import'), pledges brought in with a CRM or
--      QuickBooks id (crm_external_id), pledges that are not open when recorded, and pledges that have their own messages (fees, recurring
--      cycles, store orders, RSVP commitments). The upload screen's tick "Email each family their pledge" is the control (on by default).
--   2. No hourly cap on the Email menu item. 0792 refused a person's 41st manual email within an hour. That limit is gone. What stays: the
--      address check, giving.manage, once per confirmation key (a double click is one email), and the once-per-pledge rule of the AUTOMATIC
--      email.
--   Everything else is as it was: the treasurer's current approval of the receipt templates still gates the automatic email, demo
--   communities are queued nothing, a sandbox reaches only verified test recipients, suppressions, bounces and the deceased are honoured,
--   and a primary member with no email address is reported (History, the upload result), never "failed".
--
-- The three functions are redefined from their latest bodies (0790, 0792, 0793), each with one block taken out; their signatures, grants
-- and callers are unchanged, so the generated types do not change.
set client_min_messages = warning;

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

create or replace function app.pledge_email_status(p_center uuid, p_pledges uuid[], p_majority int default 18) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  v_ids uuid[]; v_auto record; v_out jsonb := '[]'::jsonb; pl app.pledges; s record; v_state text; v_reason text; v_contact jsonb;
  v_demo boolean; v_mstatus text; v_mreason text; v_on boolean;
begin
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
  if not (app.has_permission(p_center, 'giving.view') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'You don''t have access to this area.' using errcode = '42501';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  select array_agg(distinct x) into v_ids from unnest(coalesce(p_pledges, '{}'::uuid[])) x;
  if coalesce(cardinality(v_ids), 0) > 500 then
    raise exception 'Ask about at most 500 pledges at a time.' using errcode = '22023';
  end if;
  select a.id, a.enabled into v_auto from app.email_automations a where a.center_id = p_center and a.kind = 'trigger' and a.trigger_key = 'pledge_recorded';
  v_demo := app.is_demo_center(p_center);
  v_on := coalesce(v_auto.enabled, false) and app.module_enabled(p_center, 'giving');
  for pl in select p.* from app.pledges p where p.center_id = p_center and p.id = any (coalesce(v_ids, '{}'::uuid[])) order by p.pledge_number nulls last, p.created_at loop
    s := null;
    select s2.outcome, s2.reason, s2.reason_code, s2.message_id into s
      from app.email_automation_sends s2
     where s2.automation_id = v_auto.id and s2.ref_id = pl.id and s2.period = ''
     order by (s2.outcome = 'queued') desc, s2.created_at desc
     limit 1;
    v_reason := null;
    if s.outcome = 'queued' then
      select m.status, m.failure_reason into v_mstatus, v_mreason from app.messages m where m.id = s.message_id;
      v_state := app._pledge_email_outcome(v_mstatus);
      v_reason := v_mreason;
    elsif s.outcome = 'skipped' then
      v_state := case s.reason_code when 'no_email' then 'no_email' when 'declined' then 'declined' when 'history' then 'history'
                                    when 'not_approved' then 'not_approved' when 'switched_off' then 'switched_off' else 'not_sent' end;
      v_reason := s.reason;
    elsif v_demo then
      v_state := 'not_sent';
      v_reason := 'Nothing is ever sent from a demo community.';
    elsif pl.crm_external_id is not null or not app._email_pledge_source_ok(pl.source) then
      v_state := 'history';
      v_reason := 'Imported pledges, and pledges that have their own messages (fees, recurring gifts, store orders), are not emailed.';
    elsif pl.status not in ('open', 'partially_paid') then
      v_state := 'history';
      v_reason := 'A pledge that is already paid, written off or cancelled is not emailed.';
    elsif not v_on then
      v_state := 'switched_off';
      v_reason := 'Pledge emails are switched off for this community (Settings › Automatic emails).';
    else
      -- Nothing is written yet (the background service has not got to it): the answer is already known when nobody can be emailed.
      v_contact := app._pledge_primary_contact(pl.household_id, p_majority);
      if v_contact->>'email' is null then
        v_state := 'no_email';
        v_reason := 'Not sent: ' || (v_contact->>'message');
      else
        v_state := 'pending';
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('pledge_id', pl.id, 'number', pl.pledge_number, 'state', v_state, 'reason', v_reason));
  end loop;
  return v_out;
end $$;

comment on function app.pledges_recorded_email() is
  'AFTER INSERT on app.pledges: queues the pledge confirmation (0770) while it is switched on, which it is by default (0790). Whatever the pledge''s date (0794). Not for what the data model marks as history (the import tool, a CRM or QuickBooks id, a pledge that is not open), system-made pledges, a demo community, or an upload that chose not to email.';
comment on function app.send_pledge_email(uuid, uuid, text, text) is
  'The Email item of the pledge menu (0792): giving.manage, Giving on. Records who asked which pledge to be sent to which address (once per confirmation key; no hourly limit, 0794), writes it to the pledge''s History and queues the job that writes the email with the PDF attached. Returns {request_id, replayed, to, status}.';
comment on function app.pledge_email_status(uuid, uuid[], integer) is
  'What became of each pledge''s automatic email (0793, 0794): [{pledge_id, number, state, reason}] with state sent, waiting, pending, no_email, declined, history (what the data model marks as history), not_approved, switched_off, failed or not_sent. giving.view or giving.manage. At most 500 pledges.';
