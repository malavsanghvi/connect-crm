-- 0793 · Pledge emails for a bulk upload: the screen's choice "Email each family their pledge" (on unless unticked) and the result that
-- says how many families were emailed, how many had no email address and how many failed, with the reason (owner request 2026-10-14).
-- Part 4 of 4 (0790 default on, 0791 the PDF, 0792 the email, 0793 this). NEEDS OWNER OK: it changes app.record_pledge_upload (0776).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   app.record_pledge_upload(..., p_send_emails)   0776's function with one more argument (the six-argument form stays and emails), false when the person unticked "Email each
--                                                  family their pledge". Everything else is exactly 0776: giving.manage, all or nothing,
--                                                  once per confirmation key, each row through the rules of recording a pledge by hand.
--                                                  The pledges go through the same trigger every pledge goes through (0790): each one
--                                                  queues its email to the household's primary member (0792) with the PDF attached, once
--                                                  per pledge. Unticked: the trigger stays quiet for this upload and each pledge records
--                                                  why (not emailed: chosen when it was uploaded) in its History. A replay of the same key
--                                                  never queues anything again. Pledges dated more than 30 days before the upload are
--                                                  history and are not emailed whatever the box says (0790).
--   app.pledge_email_status(center, pledges)        what became of each pledge's automatic email: sent, waiting (queued or not yet
--                                                  written), no_email (the primary member has no usable address), declined, history,
--                                                  not_approved, switched_off, failed (with the provider's reason) or not_sent (another
--                                                  reason, for example a sandbox, an unsubscribed or suppressed address). The upload's
--                                                  result screen asks again until nothing is waiting. giving.view or giving.manage.
set client_min_messages = warning;

create or replace function app.record_pledge_upload(
  p_center uuid,
  p_idempotency_key text,
  p_file_name text,
  p_file_sha256 text,
  p_reason text,
  p_rows jsonb,
  p_send_emails boolean)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_reason text := app.audit_clean_reason(p_reason);
  v_file text := nullif(left(btrim(coalesce(p_file_name, '')), 200), '');
  v_sha text := nullif(lower(btrim(coalesce(p_file_sha256, ''))), '');
  v_up app.giving_uploads;
  v_count integer;
  v_total bigint;
  v_tz text;
  v_today date;
  x record;
  v_r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_on date;
  v_same app.pledges;
  v_row_reason text;
  v_auto uuid;
  y record;
begin
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  if not app.has_permission(p_center, 'giving.manage') then
    raise exception 'You do not have permission to upload pledges (it needs giving.manage).' using errcode = '42501';
  end if;
  if v_key is null or char_length(v_key) < 8 or char_length(v_key) > 120 then
    raise exception 'An upload needs a confirmation key of 8 to 120 characters, so that recording it twice cannot count it twice.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There are no rows to record.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'An upload holds at most 500 rows; this one has %. Split the file and upload each part.', jsonb_array_length(p_rows) using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 then
    raise exception 'Say why these pledges are recorded (for example "Pledge cards from the annual dinner"). It shows in each family''s History.'
      using errcode = '22023';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then
    v_sha := null;
  end if;
  select count(*)::integer, coalesce(sum((e->>'amount_cents')::bigint), 0) into v_count, v_total from jsonb_array_elements(p_rows) e;
  if v_total <= 0 then
    raise exception 'The rows add up to nothing; there is nothing to record.' using errcode = '22023';
  end if;
  -- Each row once: a row number twice would give two rows one key (the second a replay of the first) and skew the count and total.
  if (select count(distinct e->>'row') from jsonb_array_elements(p_rows) e) <> v_count then
    raise exception 'The same row number appears twice. Nothing was recorded; check the file again.' using errcode = '22023';
  end if;

  -- Once: the same confirmation returns the upload it recorded (a retry after a lost answer, or two clicks that arrived together).
  perform app.set_audit_context(format('Upload: %s', v_reason));
  insert into app.giving_uploads (center_id, kind, idempotency_key, file_name, file_sha256, reason, row_count, total_cents, created_by)
    values (p_center, 'pledges', v_key, v_file, v_sha, v_reason, v_count, v_total, auth.uid())
    on conflict (center_id, idempotency_key) do nothing
    returning * into v_up;
  if not found then
    select * into v_up from app.giving_uploads u where u.center_id = p_center and u.idempotency_key = v_key;
    if v_up.kind <> 'pledges' or v_up.row_count <> v_count or v_up.total_cents <> v_total or v_up.file_sha256 is distinct from v_sha then
      raise exception 'This confirmation was already used for a different upload. Nothing was recorded.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'upload_id', v_up.id, 'replayed', true, 'count', v_up.row_count, 'total_cents', v_up.total_cents,
      'pledges', coalesce((select jsonb_agg(jsonb_build_object('row', split_part(p.idempotency_key, ':', 3)::integer, 'pledge_id', p.id,
                                                                'pledge_number', p.pledge_number, 'household_id', p.household_id,
                                                                'amount_cents', p.amount_cents, 'due_on', p.due_on)
                                            order by split_part(p.idempotency_key, ':', 3)::integer)
                             from app.pledges p
                            where p.center_id = p_center and p.idempotency_key like 'upl:' || v_up.id::text || ':%'), '[]'::jsonb));
  end if;

  select coalesce(nullif(c.time_zone, ''), 'UTC') into v_tz from app.centers c where c.id = p_center;
  v_today := (now() at time zone v_tz)::date;

  -- The person may choose not to email the families. The pledge trigger (0790) then stays quiet for this transaction, and each pledge
  -- says why it was not emailed (below), so the upload's result and the pledge's History never leave it a mystery.
  if not coalesce(p_send_emails, true) then
    perform set_config('app.pledge_email', 'off', true);
  end if;

  for x in
    select (e->>'row')::integer as row_no,
           (e->>'household_id')::uuid as household_id,
           (e->>'amount_cents')::bigint as amount_cents,
           nullif(e->>'fund_id', '')::uuid as fund_id,
           nullif(e->>'campaign_id', '')::uuid as campaign_id,
           nullif(e->>'opportunity_id', '')::uuid as opportunity_id,
           nullif(e->>'pledged_on', '')::date as pledged_on,
           nullif(e->>'due_on', '')::date as due_on,
           nullif(e->>'pledged_by_person_id', '')::uuid as pledged_by,
           nullif(btrim(e->>'dedication'), '') as dedication,
           nullif(btrim(e->>'note'), '') as note,
           coalesce((e->>'repeat_ok')::boolean, false) as repeat_ok
      from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
     order by t.ord
  loop
    if x.row_no is null or x.row_no < 1 then
      raise exception 'Every row needs its row number from the file. Nothing was recorded.' using errcode = '22023';
    end if;
    -- A repeat: the same household, amount, purpose and day as a pledge already recorded (any source; an earlier row of this upload
    -- is recorded by now, so it counts too), unless the person ticked "Record anyway" for this row.
    v_on := coalesce(x.pledged_on, v_today);
    if not x.repeat_ok then
      select * into v_same from app.pledges p
       where p.center_id = p_center and p.household_id = x.household_id and p.amount_cents = x.amount_cents
         and p.status <> 'cancelled'
         and (p.pledged_at at time zone v_tz)::date = v_on
         and case when x.opportunity_id is not null then p.opportunity_id = x.opportunity_id
                  when x.campaign_id is not null then p.campaign_id = x.campaign_id
                  when x.fund_id is not null then p.fund_id = x.fund_id and p.campaign_id is null
                  else p.fund_id is null and p.campaign_id is null and p.opportunity_id is null end
       order by p.pledged_at
       limit 1;
      if found then
        raise exception 'Row %: this looks like a repeat of % (the same family, amount, purpose and day). Nothing was recorded. Tick "Record anyway" on that row if it is a second pledge.',
          x.row_no, coalesce(v_same.pledge_number, 'a pledge already recorded') using errcode = '23505';
      end if;
    end if;
    v_row_reason := left(v_reason || coalesce(' · ' || x.note, ''), 500);
    begin
      v_r := app._record_manual_pledge_core('upl:' || v_up.id::text || ':' || x.row_no::text, p_center, x.household_id, x.amount_cents,
                                            v_row_reason, x.fund_id, x.campaign_id, x.opportunity_id, null, x.due_on, x.pledged_by,
                                            x.dedication, x.pledged_on);
    exception when others then
      -- The row number leads the sentence. A row that names another community's household is a problem of the file, not of the
      -- person's permissions, so it is said as such (the portal shows the sentence itself).
      raise exception 'Row %: %', x.row_no, sqlerrm using errcode = case when sqlstate = '42501' then '22023' else sqlstate end;
    end;
    v_out := v_out || jsonb_build_array(jsonb_build_object('row', x.row_no, 'pledge_id', v_r->>'pledge_id', 'pledge_number', v_r->>'pledge_number',
                                                           'household_id', v_r->>'household_id', 'amount_cents', (v_r->>'amount_cents')::bigint,
                                                           'due_on', v_r->>'due_on'));
  end loop;

  if not coalesce(p_send_emails, true) then
    v_auto := app._pledge_email_automation(p_center);
    for y in select (e->>'pledge_id')::uuid as pledge_id, (e->>'household_id')::uuid as household_id from jsonb_array_elements(v_out) e loop
      insert into app.email_automation_sends (center_id, automation_id, ref_id, period, household_id, to_address, outcome, reason, reason_code)
      values (p_center, v_auto, y.pledge_id, '', y.household_id, '', 'skipped',
              'Not emailed: whoever uploaded these pledges chose not to email the families.', 'declined')
      on conflict on constraint email_automation_sends_once do nothing;
      perform app.log_audit(p_center, 'pledge.email_not_sent', 'pledges', y.pledge_id::text, null,
                            jsonb_build_object('result', 'The pledge email was not sent', 'why', 'Whoever uploaded the pledges chose not to email the families'),
                            'Not emailed: chosen when the pledges were uploaded');
    end loop;
  end if;

  return jsonb_build_object('upload_id', v_up.id, 'replayed', false, 'count', v_count, 'total_cents', v_total, 'pledges', v_out,
                            'emails', coalesce(p_send_emails, true));
end $$;

-- The six-argument call of 0776 stays (a portal of an older build, the tests): it emails, as a first recording does. Two arities and no
-- default value, so a call is never ambiguous.
create or replace function app.record_pledge_upload(
  p_center uuid, p_idempotency_key text, p_file_name text, p_file_sha256 text, p_reason text, p_rows jsonb)
returns jsonb
language sql security definer set search_path = app, public, extensions as $$
  select app.record_pledge_upload(p_center, p_idempotency_key, p_file_name, p_file_sha256, p_reason, p_rows, true)
$$;
revoke execute on function app.record_pledge_upload(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function app.record_pledge_upload(uuid, text, text, text, text, jsonb) to authenticated;
comment on function app.record_pledge_upload(uuid, text, text, text, text, jsonb) is
  'Records an uploaded file of pledges (0776), emailing the families as a first recording does (0793): the same as the seven-argument form with p_send_emails true.';

revoke execute on function app.record_pledge_upload(uuid, text, text, text, text, jsonb, boolean) from public, anon;
grant execute on function app.record_pledge_upload(uuid, text, text, text, text, jsonb, boolean) to authenticated;
comment on function app.record_pledge_upload(uuid, text, text, text, text, jsonb, boolean) is
  'Records an uploaded file of pledges, all or nothing, each row through the rules of recording a pledge by hand (0745/0775). The same key returns the same upload. A repeat of a recorded pledge is refused unless its row says repeat_ok. At most 500 rows (0776). p_send_emails (0793): each pledge emails the household''s primary member with the PDF (0790, 0792); false records why it was not emailed on each pledge.';

-- ── What became of each pledge's automatic email ──────────────────────────────────────────────────────────────────────────────────
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
    elsif pl.pledged_at < now() - interval '30 days' then
      v_state := 'history';
      v_reason := 'This pledge is dated more than 30 days ago, so it counts as history and is not emailed.';
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
revoke execute on function app.pledge_email_status(uuid, uuid[], integer) from public, anon;
grant execute on function app.pledge_email_status(uuid, uuid[], integer) to authenticated;
comment on function app.pledge_email_status(uuid, uuid[], integer) is
  'What became of each pledge''s automatic email (0793): [{pledge_id, number, state, reason}] with state sent, waiting, pending, no_email, declined, history, not_approved, switched_off, failed or not_sent. giving.view or giving.manage. At most 500 pledges.';
