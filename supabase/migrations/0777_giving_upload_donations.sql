-- 0777: upload donations from a spreadsheet, separately from pledges (owner ask 2026-10-13: "we will need similar for donations
-- separately"; GV-U slice C). NEEDS OWNER OK: a bulk way to record money.
--
-- Owner rules for it (2026-10-13): whoever may record a payment by hand may upload them (giving.record_offline or giving.manage); no
-- fresh 2FA (2FA is for signing in and for administrators' actions); rows from someone who may not apply payments are recorded and
-- not applied, exactly as the Record payment sheet does; no undo (a wrong row is fixed with a refund that a second person approves);
-- no receipt is emailed on upload.
--
-- What is added, and only this:
--   app.giving_upload_payment_repeats(center, rows)  read only: for each row, a payment already recorded that it looks like: the same
--                                                     household, amount, day and method, or for a check the same household and check
--                                                     number. Failed, voided and refunded payments do not count. Only the receipt number
--                                                     and day are returned. giving.record_offline or giving.manage (a finance volunteer
--                                                     reads only their own payments, so the review asks the database).
--   app.record_donation_upload(center, key, file, sha256, reason, rows)
--                                                     records every row as ONE offline payment through app.record_offline_payment_once
--                                                     (0658), unchanged: check, cash, ACH, Zelle or stock; a received date not in the
--                                                     future; the household in this community; applied exactly to the pledges and
--                                                     amounts the review showed (a pledge that changed since refuses the row), or
--                                                     recorded and not applied for someone without giving.manage. All or nothing: one
--                                                     refused row refuses the upload, with the row number. Once: the same key returns
--                                                     the upload it recorded; each payment's key is upl:<upload id>:<row>. A row that
--                                                     looks like a payment already recorded (an earlier row of the file included) is
--                                                     refused unless the person ticked "Record anyway". At most 500 rows. The reason (and
--                                                     the row's note) is the audit entry's reason of each payment. Uploaded payments are
--                                                     ordinary offline payments: they post to QuickBooks as a payment recorded by hand
--                                                     does. The transaction is marked as an upload (app.mark_donation_upload when the
--                                                     automatic emails of 0770 exist, else the same setting), so no receipt is emailed
--                                                     unless that community switched on receipts for uploaded donations.
--
-- What does NOT change: app.record_offline_payment_once, the two-person rule, refunds, the repeat check of the Record payment sheet, and
-- every policy and permission. A donations upload is never cancelled (app.cancel_pledge_upload refuses it, 0776).
set client_min_messages = warning;

create or replace function app.giving_upload_payment_repeats(p_center uuid, p_rows jsonb)
returns table (row_no integer, receipt_number text, received_on date)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
begin
  perform app.assert_module_enabled(p_center, 'giving');
  if not (app.has_permission(p_center, 'giving.record_offline') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'You do not have permission to record payments.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception 'Check at most 500 rows at a time.' using errcode = '22023';
  end if;
  return query
  select distinct on (x.row_no) x.row_no, p.receipt_number, p.received_on
    from (select (e->>'row')::integer as row_no, (e->>'household_id')::uuid as household_id, (e->>'amount_cents')::bigint as amount_cents,
                 (e->>'received_on')::date as received_on, e->>'method' as method, nullif(btrim(e->>'check_number'), '') as check_number
            from jsonb_array_elements(p_rows) e) x
    join app.payments p on p.center_id = p_center and p.household_id = x.household_id
   where p.status::text not in ('failed', 'voided', 'refunded')
     and ((p.amount_cents = x.amount_cents and p.received_on = x.received_on and p.method::text = x.method)
          or (x.method = 'check' and x.check_number is not null and p.method::text = 'check' and p.check_number = x.check_number))
   order by x.row_no, p.received_on desc, p.receipt_number;
end $$;
revoke execute on function app.giving_upload_payment_repeats(uuid, jsonb) from public, anon;
grant execute on function app.giving_upload_payment_repeats(uuid, jsonb) to authenticated;
comment on function app.giving_upload_payment_repeats(uuid, jsonb) is
  'For a donations upload: per row, a payment already recorded that it looks like (same household, amount, day and method; or a check with the same number). Receipt number and day only. giving.record_offline or giving.manage (0777).';

create or replace function app.record_donation_upload(
  p_center uuid,
  p_idempotency_key text,
  p_file_name text,
  p_file_sha256 text,
  p_reason text,
  p_rows jsonb)
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
  x record;
  v_r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_same app.payments;
  v_not_applied integer := 0;
begin
  if p_center is null or not exists (select 1 from app.centers c where c.id = p_center) then
    raise exception 'That community was not found.' using errcode = 'P0002';
  end if;
  perform app.assert_module_enabled(p_center, 'giving');
  if not (app.has_permission(p_center, 'giving.record_offline') or app.has_permission(p_center, 'giving.manage')) then
    raise exception 'You do not have permission to record payments.' using errcode = '42501';
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
    raise exception 'Say why these payments are recorded (for example "Sunday collection checks"). It shows in each payment''s history.'
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

  perform app.set_audit_context(format('Upload: %s', v_reason));
  insert into app.giving_uploads (center_id, kind, idempotency_key, file_name, file_sha256, reason, row_count, total_cents, created_by)
    values (p_center, 'payments', v_key, v_file, v_sha, v_reason, v_count, v_total, auth.uid())
    on conflict (center_id, idempotency_key) do nothing
    returning * into v_up;
  if not found then
    select * into v_up from app.giving_uploads u where u.center_id = p_center and u.idempotency_key = v_key;
    if v_up.kind <> 'payments' or v_up.row_count <> v_count or v_up.total_cents <> v_total or v_up.file_sha256 is distinct from v_sha then
      raise exception 'This confirmation was already used for a different upload. Nothing was recorded.' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'upload_id', v_up.id, 'replayed', true, 'count', v_up.row_count, 'total_cents', v_up.total_cents, 'not_applied', null,
      'payments', coalesce((select jsonb_agg(jsonb_build_object('row', split_part(p.idempotency_key, ':', 3)::integer, 'payment_id', p.id,
                                                                 'receipt_number', p.receipt_number, 'household_id', p.household_id,
                                                                 'amount_cents', p.amount_cents,
                                                                 'applied_cents', coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.payment_id = p.id), 0))
                                             order by split_part(p.idempotency_key, ':', 3)::integer)
                              from app.payments p
                             where p.center_id = p_center and p.idempotency_key like 'upl:' || v_up.id::text || ':%'), '[]'::jsonb));
  end if;

  -- An upload: no receipt is emailed unless the community switched on receipts for uploaded donations (automatic emails, 0770).
  if to_regprocedure('app.mark_donation_upload()') is not null then
    execute 'select app.mark_donation_upload()';
  else
    perform set_config('app.donation_upload', 'on', true);
  end if;

  for x in
    select (e->>'row')::integer as row_no,
           (e->>'household_id')::uuid as household_id,
           (e->>'amount_cents')::bigint as amount_cents,
           e->>'method' as method,
           (e->>'received_on')::date as received_on,
           nullif(btrim(e->>'check_number'), '') as check_number,
           nullif(btrim(e->>'envelope_number'), '') as envelope_number,
           nullif(btrim(e->>'memo'), '') as memo,
           nullif(btrim(e->>'note'), '') as note,
           coalesce(e->'allocations', '[]'::jsonb) as allocations,
           coalesce((e->>'repeat_ok')::boolean, false) as repeat_ok
      from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
     order by t.ord
  loop
    if x.row_no is null or x.row_no < 1 then
      raise exception 'Every row needs its row number from the file. Nothing was recorded.' using errcode = '22023';
    end if;
    if not x.repeat_ok then
      select * into v_same from app.payments p
       where p.center_id = p_center and p.household_id = x.household_id
         and p.status::text not in ('failed', 'voided', 'refunded')
         and ((p.amount_cents = x.amount_cents and p.received_on = x.received_on and p.method::text = x.method)
              or (x.method = 'check' and x.check_number is not null and p.method::text = 'check' and p.check_number = x.check_number))
       order by p.received_on desc
       limit 1;
      if found then
        raise exception 'Row %: this looks like a repeat of receipt % (%). Nothing was recorded. Tick "Record anyway" on that row if it is a second payment.',
          x.row_no, coalesce(v_same.receipt_number, 'already recorded'), to_char(v_same.received_on, 'YYYY-MM-DD') using errcode = '23505';
      end if;
    end if;
    perform app.set_audit_context(left(v_reason || coalesce(' · ' || x.note, ''), 500));
    begin
      v_r := app.record_offline_payment_once('upl:' || v_up.id::text || ':' || x.row_no::text, p_center, x.household_id, x.amount_cents,
                                             x.method::app.payment_method, x.received_on, x.allocations, false, x.check_number,
                                             x.envelope_number, x.memo);
    exception when others then
      raise exception 'Row %: %', x.row_no, sqlerrm using errcode = case when sqlstate = '42501' then '22023' else sqlstate end;
    end;
    if v_r->>'allocation_skipped' is not null then
      v_not_applied := v_not_applied + 1;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'row', x.row_no, 'payment_id', v_r->>'payment_id', 'receipt_number', v_r->>'receipt_number', 'household_id', x.household_id,
      'amount_cents', x.amount_cents, 'applied_cents', x.amount_cents - (v_r->>'unallocated_cents')::bigint,
      'allocation_skipped', v_r->>'allocation_skipped'));
  end loop;

  return jsonb_build_object('upload_id', v_up.id, 'replayed', false, 'count', v_count, 'total_cents', v_total, 'not_applied', v_not_applied,
                            'payments', v_out);
end $$;
revoke execute on function app.record_donation_upload(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function app.record_donation_upload(uuid, text, text, text, text, jsonb) to authenticated;
comment on function app.record_donation_upload(uuid, text, text, text, text, jsonb) is
  'Records an uploaded file of offline payments, all or nothing, each row through app.record_offline_payment_once (0658). giving.record_offline or giving.manage; applying needs giving.manage. The same key returns the same upload. A repeat is refused unless its row says repeat_ok. No receipt is emailed by the upload. At most 500 rows (0777).';

-- ── The portal's action, in the activity allowlist ───────────────────────────────────────────────────────────────────────────────
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('giving.upload_donations', 'Upload donations from a spreadsheet', null::text)
  ) as v(k, l, e);
