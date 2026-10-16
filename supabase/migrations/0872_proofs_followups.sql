-- 0872 · Payment proofs, follow-ups from the portal build:
--   giving_draft_context      also returns soft_credit_cents per pledge, so a chat payment draft never overstates what is still open
--   log_proof_view(file)      a staff member opening a proof is written to the audit log (who, which file; never the file)
--   unreconcile_bank_line     also undoes a deposit line that banked several payments (not a line a count is linked to)
set client_min_messages = warning;

CREATE OR REPLACE FUNCTION app.giving_draft_context(p_household uuid, p_amount_cents bigint DEFAULT NULL::bigint, p_method text DEFAULT NULL::text, p_check_number text DEFAULT NULL::text, p_received_on date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  with h as (
    select hh.id, hh.center_id from app.households hh where hh.id = p_household and hh.merged_into_id is null
  ),
  plg as (
    select pl.id, pl.pledge_number, pl.source, pl.amount_cents, pl.paid_cents, pl.soft_credit_cents, pl.status, pl.pledged_at, pl.due_on,
           f.name as fund, c.name as campaign
      from app.pledges pl
      join h on pl.household_id = h.id and pl.center_id = h.center_id
      left join app.funds f on f.id = pl.fund_id
      left join app.campaigns c on c.id = pl.campaign_id
     where pl.status in ('open', 'partially_paid')
     order by pl.pledged_at, pl.id
     limit 200
  ),
  dup as (
    select p.id, p.receipt_number, p.received_on, p.amount_cents, p.method, p.check_number,
           coalesce(p_method = 'check' and p_check_number is not null and p.check_number = p_check_number, false) as same_check_number
      from app.payments p
      join h on p.household_id = h.id and p.center_id = h.center_id
     where p.status not in ('failed', 'voided', 'authorized')
       and ((p_method = 'check' and p_check_number is not null and p.check_number = p_check_number)
            or (p_amount_cents is not null and p_received_on is not null and p.amount_cents = p_amount_cents
                and p.received_on between p_received_on - 3 and p_received_on + 3))
     order by p.received_on desc, p.id
     limit 5
  )
  select jsonb_build_object(
    'household_id', h.id,
    'open_pledges', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'pledge_number', g.pledge_number, 'source', g.source, 'amount_cents', g.amount_cents,
               'paid_cents', g.paid_cents, 'soft_credit_cents', g.soft_credit_cents, 'status', g.status, 'pledged_at', g.pledged_at, 'due_on', g.due_on,
               'fund', g.fund, 'campaign', g.campaign)
               order by g.pledged_at, g.id)
        from plg g), '[]'::jsonb),
    'month_closed', case
      when p_received_on is null then null
      when app.has_permission(h.center_id, 'giving.view') or app.has_permission(h.center_id, 'giving.manage')
           or app.has_permission(h.center_id, 'accounting.close')
        then exists (select 1 from app.accounting_periods ap
                      where ap.center_id = h.center_id and ap.period_month = date_trunc('month', p_received_on)::date
                        and ap.status = 'closed')
      else null end,
    'duplicates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'payment_id', d.id, 'receipt_number', d.receipt_number, 'received_on', d.received_on,
               'amount_cents', d.amount_cents, 'method', d.method, 'check_number', d.check_number,
               'same_check_number', d.same_check_number)
               order by d.received_on desc, d.id)
        from dup d), '[]'::jsonb),
    'check_number_elsewhere', case
      when p_method = 'check' and p_check_number is not null
        then (select count(*)::integer from app.payments p2
               where p2.center_id = h.center_id and p2.household_id <> h.id and p2.check_number = p_check_number
                 and p2.status not in ('failed', 'voided', 'authorized'))
      else 0 end
  )
  from h
$function$;

create or replace function app.log_proof_view(p_file uuid) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare f app.payment_proof_files;
begin
  select * into f from app.payment_proof_files where id = p_file;
  if f.id is null then raise exception 'That file was not found.' using errcode = '22023'; end if;
  if not (app._proof_staff(f.center_id) or app.has_permission(f.center_id, 'giving.view')) then
    return;   -- a family member opening their own proof is not logged
  end if;
  perform app.log_audit(f.center_id, 'payment_proof_files.view', 'payment_proof_files', f.id::text, null,
                        jsonb_build_object('proof_id', f.proof_id, 'payment_id', f.payment_id), null);
end $$;
revoke all on function app.log_proof_view(uuid) from public, anon;
grant execute on function app.log_proof_view(uuid) to authenticated, service_role;

create or replace function app.unreconcile_bank_line(p_txn uuid, p_reason text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare t app.bank_transactions; v_n int; v_reason text := nullif(btrim(p_reason), '');
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  if t.id is null then raise exception 'That bank line was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(t.center_id, 'giving_bank');
  if not app.has_permission(t.center_id, 'giving.manage') then raise exception 'Undoing a bank match needs giving.manage.' using errcode = '42501'; end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Say why you are undoing it, in a few words.' using errcode = '22023'; end if;
  if t.status <> 'matched' then raise exception 'That bank line is not matched.' using errcode = '22023'; end if;
  if exists (select 1 from app.counting_sessions cs where cs.bank_transaction_id = t.id) then
    raise exception 'This line is matched to an offering count. Undo it from the count.' using errcode = '22023';
  end if;
  select count(*) into v_n from app.payments where deposit_bank_transaction_id = t.id and provider = 'offline';
  if v_n = 0 then
    raise exception 'This line created its payment. Undo that from the payment (a refund or a correction), not here.' using errcode = '22023';
  end if;
  if exists (select 1 from app.ledger_postings l where l.center_id = t.center_id and l.idempotency_key = 'deposit:' || t.id and l.status in ('posting', 'posted')) then
    raise exception 'QuickBooks already has this deposit, so it cannot be undone here.' using errcode = '22023';
  end if;
  perform app.set_audit_context(v_reason);
  delete from app.ledger_postings where center_id = t.center_id and idempotency_key = 'deposit:' || t.id and status in ('queued', 'failed');
  update app.payments set deposit_bank_transaction_id = null, status = 'captured' where deposit_bank_transaction_id = t.id and provider = 'offline';
  update app.bank_transactions set status = 'unmatched', is_batch_deposit = false, matched_household_id = null, payment_id = null, matched_by = null, matched_at = null where id = t.id;
  update app.payment_proofs set bank_transaction_id = null where bank_transaction_id = t.id;
  update app.payment_reports set bank_transaction_id = null where bank_transaction_id = t.id and status = 'matched';
end $$;
revoke all on function app.unreconcile_bank_line(uuid, text) from public, anon;
grant execute on function app.unreconcile_bank_line(uuid, text) to authenticated, service_role;
