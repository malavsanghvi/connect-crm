-- 0871 · Payment proofs, evidence retention (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §4.5, scenarios A36-A38, A41).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   The photos and files families and staff keep as evidence of a payment are removed once the organization's years have run out,
--   and not before. The daily background job asks the database which files are due, deletes each one from the private bucket, then
--   tells the database it is gone. The row stays as a tombstone (hash, size, type, who sent it, when it was removed and why), so the
--   pledge still says "the photo was removed on <date> because ..." while the receipt, the payment and the timeline stay.
--
--   app._proof_files_due(...)         the ONE rule for "is this file due?", shared by the list, the removal and the preview
--   app.proof_files_due(limit)        the files the worker should remove now                         (worker only)
--   app.proof_file_removed(file, why) the worker saying the bytes are gone: stamps the tombstone + audit (worker only)
--   app.proof_retention_preview(c, y) how many files would become due if the years were y        (settings.manage)
--
-- THE RULE (§4.5)
--   Not accepted or taken back proof ... kept 13 months from the decision, then removed.
--   Every other file (approved or merged proofs, files staff attached to a payment) ... removed only when ALL hold:
--     * the clock ran out: Dec 31 of (the year of the payment date + retention_years) is before the organization's today,
--     * the organization's legal hold is off (a hold stops all removal, the 13 months included),
--     * every pledge the payment or proof is connected to is final (Bank reconciled, written off or cancelled; none = final),
--     * the payment has no open refund (a refund asked for and not yet recorded, one flagged from the provider, or one on its way).
--   A proof still waiting for the treasury team (submitted, needs_info) is never due.
--
-- WORKER ROLE: the background service connects as connect_worker, so the two worker functions use app.assert_worker() and are
-- granted to connect_worker only (like record_storage_deletions, 0587). No other role, service_role included, can call them.
-- ROLLBACK: drop the three functions and _proof_files_due.
set client_min_messages = warning;

-- ── 1. The rule ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_years overrides the organization's years (the Settings preview); p_ignore_hold ignores the legal hold (the preview says the
-- hold is on instead of hiding the files); p_center / p_file narrow the search. Dates are the organization's own (its time zone).
create or replace function app._proof_files_due(p_center uuid default null, p_file uuid default null,
                                                p_years int default null, p_ignore_hold boolean default false)
returns table (file_id uuid, center_id uuid, storage_path text, member_visible boolean, reason text)
language sql stable security definer set search_path = app, public, extensions as $$
  with base as (
    select f.id, f.center_id, f.storage_path, f.member_visible, f.proof_id,
           pr.status as proof_status, pr.decided_at,
           coalesce(f.payment_id, pr.payment_id) as pay_id,
           coalesce(pay.received_on, pr.paid_on) as basis_on,
           pol.years, pol.hold,
           (now() at time zone coalesce(nullif(c.time_zone, ''), 'UTC'))::date as today
      from app.payment_proof_files f
      join app.centers c on c.id = f.center_id
      left join app.payment_proofs pr on pr.id = f.proof_id
      left join app.payments pay on pay.id = coalesce(f.payment_id, pr.payment_id)
      cross join lateral (
        select coalesce(p_years, (app.proof_policy(f.center_id) ->> 'retention_years')::int, 7) as years,
               coalesce((app.proof_policy(f.center_id) ->> 'legal_hold')::boolean, false) as hold) pol
     where f.deleted_at is null
       and (p_center is null or f.center_id = p_center)
       and (p_file is null or f.id = p_file)
  )
  select b.id, b.center_id, b.storage_path, b.member_visible,
         case when b.proof_status in ('rejected', 'withdrawn')
              then case b.proof_status when 'rejected' then 'Proof not accepted: kept 13 months, then removed'
                                       else 'Proof taken back by the family: kept 13 months, then removed' end
              else 'Kept ' || b.years || ' years after the end of ' || extract(year from b.basis_on)::int || ', then removed' end
    from base b
   where (p_ignore_hold or not b.hold)
     and (
       -- not accepted / taken back: 13 months from the decision
       (b.proof_status in ('rejected', 'withdrawn') and b.decided_at is not null and b.decided_at + interval '13 months' < now())
       or
       -- everything else that is settled: approved or merged proofs, and files staff attached to a payment
       ((b.proof_id is null or b.proof_status in ('approved', 'merged'))
        and b.basis_on is not null
        and make_date(extract(year from b.basis_on)::int + b.years, 12, 31) < b.today
        and not exists (
          select 1 from app.pledges pl
           where pl.id in (select a.pledge_id from app.payment_allocations a where a.payment_id = b.pay_id
                           union
                           select sc.pledge_id from app.soft_credits sc where sc.proof_id = b.proof_id)
             and pl.reconciled_at is null and pl.status not in ('written_off', 'cancelled'))
        and not exists (
          select 1 from app.payments pp
           where pp.id = b.pay_id and pp.refund_approved_by is not null and pp.refunded_cents = 0)
        and not exists (
          select 1 from app.payment_refunds r where r.payment_id = b.pay_id and r.status = 'flagged')
        and not exists (
          select 1 from app.jobs j
           where j.kind = 'payments.refund' and j.status in ('queued', 'running') and j.payload ->> 'payment_id' = b.pay_id::text))
     )
$$;
revoke all on function app._proof_files_due(uuid, uuid, int, boolean) from public, anon, authenticated, service_role;

-- ── 2. What the daily job removes ────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.proof_files_due(p_limit int default 200)
returns table (file_id uuid, center_id uuid, storage_path text, reason text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query
    select d.file_id, d.center_id, d.storage_path, d.reason
      from app._proof_files_due() d
      join app.payment_proof_files f on f.id = d.file_id
     order by f.created_at, f.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;

-- The bytes are gone from the bucket: keep the row as a tombstone and write the audit entry. Refuses a file that is not due.
create or replace function app.proof_file_removed(p_file uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare f app.payment_proof_files; d record; v_reason text;
begin
  perform app.assert_worker();
  select * into f from app.payment_proof_files where id = p_file for update;
  if f.id is null then raise exception 'That evidence file was not found.' using errcode = '22023'; end if;
  if f.deleted_at is not null then return; end if;   -- already recorded (a retried job)
  select * into d from app._proof_files_due(f.center_id, f.id);
  if d.file_id is null then
    raise exception 'That evidence file is not due for removal yet, so it was not marked removed.' using errcode = '22023';
  end if;
  v_reason := left(coalesce(nullif(btrim(p_reason), ''), d.reason), 300);
  perform set_config('app.client_app', 'job', true);
  perform set_config('app.audit_reason', v_reason, true);
  update app.payment_proof_files set deleted_at = now(), deleted_reason = v_reason where id = f.id;
  perform set_config('app.audit_reason', '', true);
  -- Same event as every other retention removal (0587); the bucket and path only, never the file's words.
  perform app.log_audit(f.center_id, 'storage.retention_delete', 'storage.objects', 'payment-evidence/' || f.storage_path,
                        jsonb_build_object('bucket', 'payment-evidence', 'name', f.storage_path, 'created_at', f.created_at,
                                           'sha256', f.sha256, 'bytes', f.bytes, 'content_type', f.content_type),
                        null, v_reason);
end $$;

-- ── 3. The Settings warning (A37) ────────────────────────────────────────────────────────────────────────────────────────────
-- "N files would be removed": files due if the years were p_years that are not due under the current years. The legal hold is
-- reported, not applied, so the screen can say "on hold: nothing is removed while it stays on". Staff with settings.manage only.
create or replace function app.proof_retention_preview(p_center uuid, p_years int)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_now int; v_files int; v_family int;
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Seeing the proof rules needs settings.manage.' using errcode = '42501';
  end if;
  if p_years is null or p_years not between 3 and 25 then raise exception 'Keep proofs for 3 to 25 years.' using errcode = '22023'; end if;
  v_now := coalesce((app.proof_policy(p_center) ->> 'retention_years')::int, 7);
  with already as (select d.file_id from app._proof_files_due(p_center, null, v_now, true) d)
  select count(*), count(*) filter (where n.member_visible) into v_files, v_family
    from app._proof_files_due(p_center, null, p_years, true) n
   where n.file_id not in (select file_id from already);
  return jsonb_build_object('current_years', v_now, 'new_years', p_years, 'files', v_files, 'family_files', v_family,
                            'legal_hold', coalesce((app.proof_policy(p_center) ->> 'legal_hold')::boolean, false));
end $$;

-- ── 4. Who may call them ─────────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function app.proof_files_due(int), app.proof_file_removed(uuid, text) from public, anon, authenticated, service_role;
grant execute on function app.proof_files_due(int), app.proof_file_removed(uuid, text) to connect_worker;
revoke execute on function app.proof_retention_preview(uuid, int) from public, anon;
grant execute on function app.proof_retention_preview(uuid, int) to authenticated;
