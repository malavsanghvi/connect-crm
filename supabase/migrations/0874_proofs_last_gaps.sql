-- 0874 · Payment proofs, the last gaps (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §3.3, §4.5, §5.8).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   Staff can attach a photo or file to a payment they recorded (a photo of the check, a cash receipt). Such a file is never shown to
--   the family. The pledge page gets one timeline: pledged, each proof event, each payment, bank reconciled. And the daily job can find
--   photos a family uploaded but never sent (no proof was made) so they do not stay in the private bucket for ever.
--
--   app.attach_payment_evidence(payment, path, type, bytes, sha256)   staff attach a file to a payment      (giving.record_offline | giving.manage)
--   app.remove_payment_evidence_file(file, reason)                    staff take a file they attached back   (giving.manage)
--   app.pledge_timeline(pledge)                                       the pledge's story in time order        (the household's adults, staff)
--   app.proof_orphan_objects(limit)                                   uploads older than 48 hours nobody keeps (worker only)
--
-- RULES
--   * A staff file lives at payment-evidence/<center>/staff/<payment id>/<name> (the bucket policy already lets staff write there), at most
--     5 live staff files per payment, the same types and 10 MB limit as every proof file. The row has proof_id null and member_visible false.
--   * Only giving.manage removes one, only a file staff attached, never the family's proof files (the retention rule removes those), never
--     while the legal hold is on. The row stays as a tombstone (deleted_at + reason, audited); the caller then deletes the bytes.
--   * An upload is an orphan when its object is older than 48 hours and no live payment_proof_files row names it: a family uploaded
--     photos but never sent the proof, or a staff file was removed and its bytes could not be deleted at the time.
--   * Finance volunteers (giving.record_offline without giving.view) see only the payments they recorded, so they attach only to those.
-- ROLLBACK: drop the four functions.
set client_min_messages = warning;

-- ── 1. Staff attach a photo or file to a payment ─────────────────────────────────────────────────────────────────────────────
create or replace function app.attach_payment_evidence(p_payment uuid, p_path text, p_content_type text, p_bytes bigint, p_sha256 text default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare pay app.payments; v_me uuid := auth.uid(); v_sha text := nullif(lower(btrim(p_sha256)), ''); v_id uuid;
begin
  if v_me is null then raise exception 'Sign in to attach a file to a payment.' using errcode = '42501'; end if;
  select * into pay from app.payments where id = p_payment for update;   -- two people attaching at once: one at a time
  if pay.id is null then raise exception 'That payment was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pay.center_id, 'giving');
  perform app.assert_module_enabled(pay.center_id, 'giving_proofs');
  if not (app.has_permission(pay.center_id, 'giving.manage')
          or (app.has_permission(pay.center_id, 'giving.record_offline')
              and (pay.recorded_by = v_me or app.has_permission(pay.center_id, 'giving.view')))) then
    raise exception 'Attaching a file to a payment needs giving.record_offline (for a payment you recorded) or giving.manage.' using errcode = '42501';
  end if;
  if p_path is null or split_part(p_path, '/', 1) <> pay.center_id::text or split_part(p_path, '/', 2) <> 'staff'
     or split_part(p_path, '/', 3) <> pay.id::text or split_part(p_path, '/', 4) = '' or split_part(p_path, '/', 5) <> ''
     or p_path ~ '(^|/)\.\.?(/|$)' then
    raise exception 'The file was not uploaded to the right place. Start again from the payment.' using errcode = '22023';
  end if;
  if p_content_type is null or p_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf') then
    raise exception 'Attach a photo (JPEG, PNG, WebP or HEIC) or a PDF.' using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > 10485760 then
    raise exception 'A file can be at most 10 MB.' using errcode = '22023';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'The file''s fingerprint was not in the expected form. Try attaching it again.' using errcode = '22023';
  end if;
  if exists (select 1 from app.payment_proof_files where storage_path = p_path) then
    raise exception 'That file was already attached. Reload the payment to see it.' using errcode = '23505';
  end if;
  if (select count(*) from app.payment_proof_files where payment_id = pay.id and proof_id is null and deleted_at is null) >= 5 then
    raise exception 'A payment can have up to 5 files attached by staff. Remove one first.' using errcode = '22023';
  end if;
  insert into app.payment_proof_files (center_id, proof_id, payment_id, household_id, storage_path, content_type, bytes, sha256, member_visible, uploaded_by)
    values (pay.center_id, null, pay.id, pay.household_id, p_path, p_content_type, p_bytes, v_sha, false, v_me)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'storage_path', p_path);
end $$;

-- ── 2. Staff take a file they attached back ──────────────────────────────────────────────────────────────────────────────────
-- Marks the row removed (a tombstone, never deleted); the portal then deletes the bytes. Returns the path to delete.
create or replace function app.remove_payment_evidence_file(p_file uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare f app.payment_proof_files; v_reason text := nullif(btrim(p_reason), '');
begin
  select * into f from app.payment_proof_files where id = p_file for update;
  if f.id is null then raise exception 'That file was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(f.center_id, 'giving_proofs');
  if not app.has_permission(f.center_id, 'giving.manage') then
    raise exception 'Removing a file from a payment needs giving.manage.' using errcode = '42501';
  end if;
  if f.proof_id is not null or f.payment_id is null or f.member_visible then
    raise exception 'Only a file staff attached to a payment can be removed here. A family''s proof files are removed by the retention rule.' using errcode = '22023';
  end if;
  if f.deleted_at is not null then raise exception 'That file was already removed.' using errcode = '22023'; end if;
  if coalesce((app.proof_policy(f.center_id) ->> 'legal_hold')::boolean, false) then
    raise exception 'A legal hold is on, so no file can be removed. Turn it off in Settings first.' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Say why you are removing it, in a few words.' using errcode = '22023'; end if;
  perform app.set_audit_context(v_reason);
  update app.payment_proof_files set deleted_at = now(), deleted_reason = left(v_reason, 300) where id = f.id;
  return jsonb_build_object('id', f.id, 'storage_path', f.storage_path);
end $$;

-- ── 3. The pledge's timeline ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Entries in time order, each {at, kind, event, text, amount_cents, ...}:
--   pledged     the pledge was made (amount_cents = the pledge)
--   proof       an event of a proof that covers this pledge (event = submitted | question | reply | approved | rejected | withdrawn |
--               merged | pledge_cancelled; text = the words the family reads; amount_cents = this pledge's share of the proof)
--   payment     a payment allocated to it, at the moment it was applied, and never before the approval that made it (receipt, method,
--               paid_on; amount_cents = this pledge's share)
--   reconciled  every payment on it is matched to the bank (or is imported history), and never before anything it rests on;
--               reconciled_kind says which
-- Same readers as pledge_evidence: the household's adults and staff who verify or view giving.
create or replace function app.pledge_timeline(p_pledge uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare pl app.pledges;
begin
  select * into pl from app.pledges where id = p_pledge;
  if pl.id is null then raise exception 'That pledge was not found.' using errcode = '22023'; end if;
  if not (app._proof_staff(pl.center_id) or app.has_permission(pl.center_id, 'giving.view') or app.adult_of_household(pl.center_id, pl.household_id)) then
    raise exception 'You don''t have access to this area.' using errcode = '42501';
  end if;
  return coalesce((
    with base as (
      select pl.pledged_at as ts, 0 as rank, pl.id::text as tie,
             jsonb_build_object('kind', 'pledged', 'event', null, 'text', null, 'amount_cents', pl.amount_cents) as j
      union all
      select e.created_at, 1, e.id::text,
             jsonb_build_object('kind', 'proof', 'event', e.kind, 'text', e.body, 'amount_cents', sc.amount_cents, 'proof_id', pr.id)
        from app.soft_credits sc
        join app.payment_proofs pr on pr.id = sc.proof_id
        join app.payment_proof_events e on e.proof_id = pr.id
       where sc.pledge_id = p_pledge
         and e.kind in ('submitted', 'question', 'reply', 'approved', 'rejected', 'withdrawn', 'merged', 'pledge_cancelled')
      union all
      select greatest(a.created_at, pl.pledged_at,
                      (select max(e.created_at) from app.payment_proofs q join app.payment_proof_events e on e.proof_id = q.id
                        where q.payment_id = p.id and e.kind = 'approved')),
             2, a.id::text,
             jsonb_build_object('kind', 'payment', 'event', null, 'text', null, 'amount_cents', a.amount_cents, 'payment_id', p.id,
                                'receipt_number', p.receipt_number, 'method', p.method, 'paid_on', p.received_on)
        from app.payment_allocations a join app.payments p on p.id = a.payment_id
       where a.pledge_id = p_pledge and p.status not in ('failed', 'voided')
    )
    select jsonb_agg(jsonb_build_object('at', x.ts) || x.j order by x.ts, x.rank, x.tie)
      from (
        select b.ts, b.rank, b.tie, b.j from base b
        union all
        select greatest(pl.reconciled_at, (select max(b.ts) from base b)), 3, pl.id::text,
               jsonb_build_object('kind', 'reconciled', 'event', null, 'text', null, 'amount_cents', null, 'reconciled_kind', pl.reconciled_kind)
         where pl.reconciled_at is not null
      ) x), '[]'::jsonb);
end $$;

-- ── 4. Uploads nobody keeps (the daily job removes them) ─────────────────────────────────────────────────────────────────────
-- An object of the payment-evidence bucket older than 48 hours with no live payment_proof_files row naming it. A removed (tombstone)
-- row does not keep its bytes. The oldest first. Worker only, like proof_files_due (0871).
create or replace function app.proof_orphan_objects(p_limit int default 200)
returns table (name text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_worker();
  return query
    select o.name
      from storage.objects o
     where o.bucket_id = 'payment-evidence' and o.name is not null
       and o.created_at < now() - interval '48 hours'
       and not exists (select 1 from app.payment_proof_files f where f.storage_path = o.name and f.deleted_at is null)
     order by o.created_at, o.name
     limit greatest(1, least(coalesce(p_limit, 200), 1000));
end $$;

-- ── 5. Who may call them ─────────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function app.attach_payment_evidence(uuid, text, text, bigint, text), app.remove_payment_evidence_file(uuid, text),
                           app.pledge_timeline(uuid) from public, anon;
grant execute on function app.attach_payment_evidence(uuid, text, text, bigint, text), app.remove_payment_evidence_file(uuid, text),
                          app.pledge_timeline(uuid) to authenticated;
revoke execute on function app.proof_orphan_objects(int) from public, anon, authenticated, service_role;
grant execute on function app.proof_orphan_objects(int) to connect_worker;
