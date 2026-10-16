-- 0876 · Say "payment confirmation", not "proof". The words a person reads change; nothing else does.
-- The owner's direct instruction (2026-10-16): "proof" feels like we do not trust the person. This migration replaces the text people
-- read - the module label, the three notice templates, the error and event text and the labels the Payment confirmations screen, the
-- bank reconcile preview and the storage rules show. Tables, columns, function names, signatures, error codes, the module key
-- giving_proofs and the route /giving/proofs keep their names ("proof" is the internal name). Every function below is the whole current
-- body with only its human-read string literals changed; its grants are re-issued exactly as they were. History stays as it was written:
-- payment_proof_events rows already recorded are not edited.
set client_min_messages = warning;

-- ── The module and the platform notice templates (a community's own copy of a template is left alone) ─────────────────────────
update app.modules
   set label = 'Payment confirmations',
       description = 'Members send a photo or file when they paid another way. The pledges it covers show Soft credit until the treasury team approves it.'
 where key = 'giving_proofs';

update app.message_templates set body = E'Your {{amount}} payment ({{method}}) is recorded and your pledges are paid. Receipt {{receipt}}.\n\nYou can see your payment confirmation on the pledge in the app.'
 where center_id is null and key = 'proof_approved' and channel = 'email'::app.channel and language = 'en';

update app.message_templates
   set subject = 'Your payment confirmation was not accepted',
       body = 'The treasury team could not accept your {{amount}} confirmation: {{reason}} Your pledges are open again. You can send a new confirmation.'
 where center_id is null and key = 'proof_rejected' and channel = 'push'::app.channel and language = 'en';

update app.message_templates
   set subject = 'Your payment confirmation to {{center_name}} was not accepted',
       body = E'The treasury team could not accept your {{amount}} confirmation: {{reason}}\n\nYour pledges are open again. You can send a new confirmation in the app.'
 where center_id is null and key = 'proof_rejected' and channel = 'email'::app.channel and language = 'en';

update app.message_templates set body = 'About your {{amount}} payment confirmation: {{question}}'
 where center_id is null and key = 'proof_question' and channel = 'push'::app.channel and language = 'en';

update app.message_templates
   set subject = 'A question about your payment confirmation to {{center_name}}',
       body = E'About your {{amount}} payment confirmation: {{question}}\n\nYour pledges stay as Soft credit while you answer, in the app.'
 where center_id is null and key = 'proof_question' and channel = 'email'::app.channel and language = 'en';

-- ── Functions (create or replace keeps the owner; the grants are re-issued below exactly as they were) ───────────────────────

-- ── app._pledge_locks ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app._pledge_locks(p app.pledges)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare
  v_ref text := coalesce(p.pledge_number, 'This pledge');
  v_open boolean := p.status in ('open', 'partially_paid');
  v_soft boolean := p.status::text = 'soft_credit' or coalesce(p.soft_credit_cents, 0) > 0;
  v_pending boolean := p.written_off_by is not null;
  v_own boolean := p.source::text in ('manual', 'general', 'other', 'sponsorship', 'pujan', 'construction');
  v_from text := case p.source::text
                   when 'rsvp_commitment' then 'an event registration'
                   when 'boli' then 'a boli'
                   when 'labh' then 'a labh'
                   when 'membership_fee' then 'a membership'
                   when 'pathshala_fee' then 'a Pathshala registration'
                   when 'store' then 'a store order'
                   when 'recurring' then 'a recurring gift'
                   else 'another screen' end;
  v_qbo text;
  v_closed text;
  v_details text; v_due text; v_amount text; v_for text; v_delete text;
begin
  if p.crm_external_id like 'qbo:%' then
    v_qbo := 'QuickBooks ' || replace(substr(p.crm_external_id, 5), ':', ' #');
  elsif exists (select 1 from app.qbo_transactions t where t.center_id = p.center_id and t.cc_pledge_id = p.id) then
    v_qbo := 'a QuickBooks entry matched to it';
  elsif exists (select 1 from app.ledger_postings l
                 where l.center_id = p.center_id and l.source_table = 'pledges' and l.source_id = p.id and l.status in ('queued', 'posting', 'posted')) then
    v_qbo := 'an entry sent to QuickBooks';
  end if;
  v_closed := case p.status::text
                when 'paid' then v_ref || ' is paid, so it stays as it is.'
                when 'written_off' then v_ref || ' is written off, so it stays as it is.'
                when 'cancelled' then v_ref || ' was deleted (cancelled), so it cannot change.'
                else null end;

  if p.status = 'cancelled' then
    v_details := v_closed;
  end if;
  if v_soft then
    v_due := v_ref || ' has a payment confirmation waiting for the treasury team. Approve or reject the confirmation first.';
    v_amount := v_due;
    v_for := v_due;
    v_delete := v_due;
  elsif not v_open then
    v_due := coalesce(v_closed, 'Only an open pledge can change.');
    v_amount := v_due;
    v_for := v_due;
    v_delete := case p.status::text
                  when 'paid' then v_ref || ' is paid, so it stays on record. A refund is asked for from the payment.'
                  when 'written_off' then v_ref || ' is written off, so it stays on record.'
                  else v_closed end;
  elsif v_pending then
    v_due := 'A write-off of ' || v_ref || ' is waiting for approval, so it does not change now. Withdraw the request first if the family is paying after all.';
    v_amount := v_due;
    v_for := v_due;
    v_delete := v_due;
  end if;

  if v_open and not v_pending and not v_soft then
    if not v_own then
      v_amount := v_ref || ' comes from ' || v_from || '. Change its amount there so the two agree.';
      v_for := v_amount;
      v_delete := v_ref || ' comes from ' || v_from || '. Cancel it there so the two agree.';
    end if;
    if v_qbo is not null then
      v_amount := coalesce(v_amount, v_ref || ' is in QuickBooks (' || v_qbo || '). Change it in QuickBooks first, so the books and Community Connect agree.');
      v_for := coalesce(v_for, v_ref || ' is in QuickBooks (' || v_qbo || '). Change it in QuickBooks first, so the books and Community Connect agree.');
      v_delete := coalesce(v_delete, v_ref || ' is in QuickBooks (' || v_qbo || '). It has to be deleted there as well; until that is done here it stays, so the two never disagree.');
    end if;
    if p.opportunity_id is not null then
      v_for := coalesce(v_for, v_ref || ' is part of an opportunity, so what it is for does not change here.');
    end if;
    if p.paid_cents > 0 or exists (select 1 from app.payment_allocations a where a.pledge_id = p.id) then
      v_for := coalesce(v_for, 'Payments are already applied to ' || v_ref || ', so what it is for does not change.');
      v_delete := coalesce(v_delete, 'Payments are already applied to ' || v_ref || '. Undo them first, or write off what is still open.');
    end if;
  end if;
  return jsonb_build_object('details', v_details, 'due', v_due, 'amount', v_amount, 'for', v_for, 'delete', v_delete,
                            'qbo', v_qbo, 'own', v_own);
end $function$;

-- ── app._pledge_soft_guard ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app._pledge_soft_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
begin
  if new.status in ('written_off','cancelled') and old.status is distinct from new.status then
    raise exception 'A payment confirmation is waiting on this pledge. Approve or reject the confirmation first.' using errcode = '22023';
  end if;
  return new;
end $function$;

-- ── app._proof_files_due ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app._proof_files_due(p_center uuid DEFAULT NULL::uuid, p_file uuid DEFAULT NULL::uuid, p_years integer DEFAULT NULL::integer, p_ignore_hold boolean DEFAULT false, p_ahead_days integer DEFAULT 0)
 RETURNS TABLE(file_id uuid, center_id uuid, storage_path text, member_visible boolean, reason text, due_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  with base as (
    select f.id, f.center_id, f.storage_path, f.member_visible, f.proof_id,
           pr.status as proof_status, pr.decided_at,
           coalesce(f.payment_id, pr.payment_id) as pay_id,
           coalesce(pay.received_on, pr.paid_on) as basis_on,
           pol.years, pol.hold, tz.name as tz_name,
           now() + make_interval(days => greatest(coalesce(p_ahead_days, 0), 0)) as as_of,
           (now() at time zone tz.name)::date + greatest(coalesce(p_ahead_days, 0), 0) as today
      from app.payment_proof_files f
      join app.centers c on c.id = f.center_id
      cross join lateral (select coalesce(nullif(c.time_zone, ''), 'UTC') as name) tz
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
              then case b.proof_status when 'rejected' then 'Confirmation not accepted: kept 13 months, then removed'
                                       else 'Confirmation taken back by the family: kept 13 months, then removed' end
              else 'Kept ' || b.years || ' years after the end of ' || extract(year from b.basis_on)::int || ', then removed' end,
         case when b.proof_status in ('rejected', 'withdrawn')
              then ((b.decided_at + interval '13 months') at time zone b.tz_name)::date
              else make_date(extract(year from b.basis_on)::int + b.years, 12, 31) + 1 end
    from base b
   where (p_ignore_hold or not b.hold)
     and (
       -- not accepted / taken back: 13 months from the decision
       (b.proof_status in ('rejected', 'withdrawn') and b.decided_at is not null and b.decided_at + interval '13 months' < b.as_of)
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
$function$;

-- ── app.answer_proof_question ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.answer_proof_question(p_proof uuid, p_message text, p_files jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare pr app.payment_proofs; f jsonb; v_have int; v_add int := coalesce(jsonb_array_length(p_files), 0);
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That payment confirmation was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app.adult_of_household(pr.center_id, pr.household_id) then
    raise exception 'Only an adult of the family can answer.' using errcode = '42501';
  end if;
  if pr.status <> 'needs_info' then raise exception 'The treasury team is not waiting for an answer on this confirmation.' using errcode = '22023'; end if;
  select count(*) into v_have from app.payment_proof_files where proof_id = pr.id and deleted_at is null;
  if v_have + v_add > 5 then raise exception 'A payment confirmation can have up to 5 files.' using errcode = '22023'; end if;
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    if split_part(f ->> 'path', '/', 1) <> pr.center_id::text or split_part(f ->> 'path', '/', 2) <> pr.household_id::text
       or split_part(f ->> 'path', '/', 3) <> pr.id::text or split_part(f ->> 'path', '/', 4) = '' then
      raise exception 'A file was not uploaded to the right place. Try again.' using errcode = '22023';
    end if;
    insert into app.payment_proof_files (center_id, proof_id, household_id, storage_path, content_type, bytes, sha256, member_visible, uploaded_by)
      values (pr.center_id, pr.id, pr.household_id, f ->> 'path', f ->> 'content_type', (f ->> 'bytes')::bigint, nullif(f ->> 'sha256', ''), true, auth.uid());
  end loop;
  update app.payment_proofs set status = 'submitted', answered_at = now() where id = pr.id;
  perform app._proof_event(pr.id, 'reply', coalesce(nullif(btrim(p_message), ''), 'Sent more.') || case when v_add > 0 then ' (' || v_add || ' new file' || case when v_add > 1 then 's' end || ')' else '' end);
  return app._proof_json(pr.id);
end $function$;

-- ── app.approve_payment_proof ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.approve_payment_proof(p_proof uuid, p_amount_cents bigint DEFAULT NULL::bigint, p_paid_on date DEFAULT NULL::date, p_method text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_merge_payment uuid DEFAULT NULL::uuid, p_separate_reason text DEFAULT NULL::text, p_bank_txn uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare pr app.payment_proofs; v_amount bigint; v_date date; v_method app.payment_method; v_pol jsonb; v_limit bigint; v_look jsonb;
        v_ids uuid[]; v_pay uuid; v_receipt text; v_notice jsonb; mp app.payments; v_bank uuid;
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That payment confirmation was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving');
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app._proof_staff(pr.center_id) then raise exception 'Reviewing a payment confirmation needs giving.record_offline.' using errcode = '42501'; end if;
  if app.in_my_household(pr.center_id, pr.household_id) then
    raise exception 'You cannot review a payment confirmation from your own household. Another member of the treasury team must.' using errcode = '42501';
  end if;
  if pr.status not in ('submitted','needs_info') then
    raise exception 'This payment confirmation was already % by someone else.', pr.status using errcode = '22023';
  end if;
  v_amount := coalesce(p_amount_cents, pr.amount_cents);
  v_date := coalesce(p_paid_on, pr.paid_on);
  v_method := coalesce(p_method, pr.method::text)::app.payment_method;
  if v_amount < 1 or v_amount > 100000000 then raise exception 'Enter an amount from $0.01 to $1,000,000.' using errcode = '22023'; end if;

  v_pol := app.proof_policy(pr.center_id);
  v_limit := coalesce((v_pol ->> 'second_approver_over_cents')::bigint, 0);
  if v_limit > 0 and v_amount > v_limit and p_merge_payment is null then
    if pr.first_approved_by is null then
      update app.payment_proofs set first_approved_by = auth.uid(), first_approved_at = now() where id = pr.id;
      perform app._proof_event(pr.id, 'first_approved', 'First approval given. A second person with approval rights must also approve.');
      return jsonb_build_object('state', 'first_approved', 'proof', app._proof_json(pr.id, true));
    elsif pr.first_approved_by = auth.uid() then
      raise exception 'A different person must give the second approval.' using errcode = '42501';
    elsif not app.has_permission(pr.center_id, 'giving.approve') then
      raise exception 'The second approval needs giving.approve.' using errcode = '42501';
    end if;
  end if;

  if p_merge_payment is not null then
    select * into mp from app.payments where id = p_merge_payment for update;
    if mp.id is null or mp.center_id <> pr.center_id or mp.household_id <> pr.household_id then
      raise exception 'That payment was not found for this family.' using errcode = '22023';
    end if;
    update app.payment_proof_files set payment_id = mp.id where proof_id = pr.id;
    update app.soft_credits set state = 'released' where proof_id = pr.id and state = 'active';
    update app.payment_proofs set status = 'merged', payment_id = mp.id, decided_by = auth.uid(), decided_at = now(),
           decision_reason = nullif(btrim(p_note), '') where id = pr.id;
    perform app._proof_event(pr.id, 'merged', 'Checked. Your confirmation is kept with the payment already recorded' || coalesce(' (receipt ' || mp.receipt_number || ')', '') || '.');
    return jsonb_build_object('state', 'merged', 'payment_id', mp.id, 'proof', app._proof_json(pr.id, true),
                              'notice', app._proof_notice(pr.id, 'proof_approved'));
  end if;

  v_look := app.proof_lookalikes(pr.household_id, v_amount, v_method::text, v_date, pr.reference, pr.id);
  if jsonb_array_length(v_look) > 0 then
    if app.audit_clean_reason(p_separate_reason) is null then
      raise exception using errcode = 'CCDUP',
        message = 'This family already has a lookalike of this payment. Merge the confirmation into it as evidence, or say why this is a different gift.',
        detail = v_look::text;
    end if;
    perform app.set_audit_context(p_separate_reason);
  end if;

  -- Soft credits become real: convert them (the pledges open up again), record the payment once, allocate in the same order.
  update app.soft_credits set state = 'converted' where proof_id = pr.id and state = 'active';
  select array_agg(pledge_id order by position) into v_ids from app.soft_credits where proof_id = pr.id and state = 'converted';
  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, check_number, received_on,
                            recorded_by, memo, idempotency_key)
    values (pr.center_id, pr.household_id, pr.submitted_by_person, v_amount, v_method, 'captured', 'offline',
            case when v_method = 'check' then pr.reference end, v_date, auth.uid(),
            left('Payment confirmation' || coalesce(' · ' || pr.reference, '') || coalesce(' · ' || nullif(btrim(p_note), ''), ''), 280), 'proof:' || pr.id::text)
    returning id, receipt_number into v_pay, v_receipt;
  perform app.allocate_payment(v_pay, v_ids, true);
  update app.payment_proof_files set payment_id = v_pay where proof_id = pr.id;
  update app.payment_proofs set status = 'approved', payment_id = v_pay, decided_by = auth.uid(), decided_at = now(),
         approved_amount_cents = v_amount, paid_on = v_date, method = v_method, decision_reason = nullif(btrim(p_note), '') where id = pr.id;
  select receipt_number into v_receipt from app.payments where id = v_pay;
  perform app._proof_event(pr.id, 'approved', 'Checked and recorded' || coalesce('. Receipt ' || v_receipt, '') ||
                           case when v_amount <> pr.amount_cents then '. The amount was recorded as ' || to_char(v_amount / 100.0, 'FM$999,999,990.00') || ' (you sent ' || to_char(pr.amount_cents / 100.0, 'FM$999,999,990.00') || ')' else '' end || '.');
  if p_bank_txn is not null then
    v_bank := app.attach_bank_line_to_payment(p_bank_txn, v_pay);
    update app.payment_proofs set bank_transaction_id = p_bank_txn where id = pr.id;
  end if;
  v_notice := app._proof_notice(pr.id, 'proof_approved');
  return jsonb_build_object('state', 'approved', 'payment_id', v_pay, 'receipt_number', v_receipt, 'proof', app._proof_json(pr.id, true), 'notice', v_notice);
end $function$;

-- ── app.ask_proof_question ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.ask_proof_question(p_proof uuid, p_question text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare pr app.payment_proofs; v_q text := nullif(btrim(p_question), '');
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That payment confirmation was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app._proof_staff(pr.center_id) then raise exception 'Reviewing a payment confirmation needs giving.record_offline.' using errcode = '42501'; end if;
  if app.in_my_household(pr.center_id, pr.household_id) then
    raise exception 'You cannot review a payment confirmation from your own household. Another member of the treasury team must.' using errcode = '42501';
  end if;
  if pr.status not in ('submitted','needs_info') then raise exception 'This payment confirmation was already % by someone else.', pr.status using errcode = '22023'; end if;
  if v_q is null or char_length(v_q) < 3 then raise exception 'Write what you need, in a few words. The family will read it.' using errcode = '22023'; end if;
  update app.payment_proofs set status = 'needs_info', question = v_q, question_at = now() where id = pr.id;
  perform app._proof_event(pr.id, 'question', 'The treasury team asks: ' || v_q);
  return jsonb_build_object('state', 'needs_info', 'proof', app._proof_json(pr.id, true), 'notice', app._proof_notice(pr.id, 'proof_question'));
end $function$;

-- ── app.confirm_bank_match ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.confirm_bank_match(p_txn uuid, p_household uuid, p_pledge_ids uuid[] DEFAULT NULL::uuid[], p_learn_payer boolean DEFAULT true, p_payer_person uuid DEFAULT NULL::uuid, p_report uuid DEFAULT NULL::uuid, p_separate_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare t app.bank_transactions; v_payment uuid; v_method app.payment_method; r app.payment_reports; v_ref text; v_n int;
        v_dup_kind text; v_dup_label text; v_dup_ids text; v_pledges uuid[];
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  perform app.assert_module_enabled(t.center_id, 'giving');
  perform app.assert_module_enabled(t.center_id, 'giving_bank');
  if t.id is null then raise exception 'bank line not found'; end if;
  if not (app.has_permission(t.center_id, 'giving.record_offline') or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'not allowed to reconcile bank lines';
  end if;
  if t.status = 'matched' then raise exception 'bank line already matched'; end if;
  if t.is_batch_deposit then raise exception 'this is a deposit of several checks — match it to the recorded payments instead'; end if;
  if t.status = 'payout' then raise exception 'this is a card-processor payout, not a gift'; end if;
  if t.amount_cents <= 0 then raise exception 'only incoming money can be matched to a household'; end if;
  if not exists (select 1 from app.households where id = p_household and center_id = t.center_id) then
    raise exception 'household not in this center';
  end if;
  v_method := case
    when t.originator_kind = 'daf' then 'daf'
    when t.originator_kind in ('matching_gift','payroll_giving') then 'matching_gift'
    when t.channel = 'zelle' then 'zelle' when t.channel = 'check' then 'check' when t.channel = 'ach' then 'ach'
    else 'other' end;
  v_ref := nullif(upper(regexp_replace(coalesce(t.reference, ''), '[^A-Za-z0-9]', '', 'g')), '');

  -- The member's report this line is: the one the treasurer chose, else the family's one open
  -- report with this confirmation number and amount (bookkeeping only; the money still needs this click).
  -- A Zelle report goes only with a Zelle line or one the bank did not label, never a check, a wire or a fund.
  if p_report is not null then
    select * into r from app.payment_reports where id = p_report for update;
    if r.id is null or r.center_id <> t.center_id then raise exception 'That Zelle report was not found.' using errcode = '22023'; end if;
    if t.originator_kind is not null or coalesce(t.channel, 'other') not in ('zelle','other') then
      raise exception 'A Zelle report can only be matched to a Zelle line, or to one the bank did not label. Confirm this line without the report.'
        using errcode = '22023';
    end if;
    if r.household_id <> p_household then
      raise exception 'That Zelle report is from another family. Confirm this line for the family that reported it, or without the report.'
        using errcode = '22023';
    end if;
    if r.status not in ('reported','unmatched') then
      raise exception 'That Zelle report is already %; confirm the line without it.', r.status using errcode = '22023';
    end if;
    if r.amount_cents <> t.amount_cents then
      raise exception 'The report says % but the bank line is %; confirm without the report, then reject or withdraw it.',
        to_char(r.amount_cents / 100.0, 'FM$999,999,990.00'), to_char(t.amount_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
    end if;
  elsif v_ref is not null and t.originator_kind is null and coalesce(t.channel, 'other') in ('zelle','other') then
    select count(*) into v_n from app.payment_reports x
     where x.center_id = t.center_id and x.household_id = p_household and x.status in ('reported','unmatched')
       and x.confirmation_normalized = v_ref and x.amount_cents = t.amount_cents;
    if v_n = 1 then
      select * into r from app.payment_reports x
       where x.center_id = t.center_id and x.household_id = p_household and x.status in ('reported','unmatched')
         and x.confirmation_normalized = v_ref and x.amount_cents = t.amount_cents
       for update;
    end if;
  end if;

  -- A line the member's report names is a Zelle even when the bank did not label it one: recorded as
  -- a Zelle, and held to the double-count guard below.
  if r.id is not null and v_method = 'other' then v_method := 'zelle'; end if;

  -- I3 (generalises G6): this family already has an unbanked payment, or a waiting proof, of this amount around the line.
  -- Attach the line to it (or approve the proof with the line) so the gift is not counted twice; a separate gift needs a typed reason.
  select z.kind, z.label into v_dup_kind, v_dup_label from app.unbanked_lookalikes(p_household, t.amount_cents, t.posted_on) z limit 1;
  if found then
    if app.audit_clean_reason(p_separate_reason) is null then
      select string_agg(z.id::text, ',') into v_dup_ids from app.unbanked_lookalikes(p_household, t.amount_cents, t.posted_on) z;
      raise exception using errcode = 'CCDUP',
        message = format('This family already has %s for %s that is not on the bank yet. %s, or say why this is a separate gift.',
                         v_dup_label, to_char(t.amount_cents / 100.0, 'FM$999,999,990.00'),
                         case v_dup_kind when 'proof' then 'Approve that confirmation with this bank line' else 'Attach this bank line to that payment so the gift is not counted twice' end),
        detail = v_dup_ids;
    end if;
    perform app.set_audit_context(p_separate_reason);
  end if;

  insert into app.payments (center_id, household_id, payer_person_id, amount_cents, method, status, provider, provider_ref,
                            check_number, received_on, recorded_by, memo, deposit_bank_transaction_id)
    values (t.center_id, p_household, coalesce(p_payer_person, r.reported_by_person), t.amount_cents, v_method, 'settled', 'bank',
            coalesce(t.reference, t.fingerprint), case when t.channel = 'check' then t.reference end, t.posted_on, auth.uid(),
            'Bank: ' || t.description, t.id)
    returning id into v_payment;
  -- The pledges the member chose on the report (still open), chosen by the donor; else earliest open first.
  v_pledges := p_pledge_ids;
  if v_pledges is null and r.id is not null and cardinality(r.pledge_ids) > 0 then
    select array_agg(u.x order by u.o) into v_pledges
      from unnest(r.pledge_ids) with ordinality as u(x, o)
     where exists (select 1 from app.pledges pl where pl.id = u.x and pl.household_id = p_household and pl.status in ('open','partially_paid'));
  end if;
  perform app.allocate_payment(v_payment, v_pledges, true);
  perform app.enqueue_payment_posting(v_payment);
  update app.bank_transactions set status = 'matched', matched_household_id = p_household, payment_id = v_payment,
         matched_by = auth.uid(), matched_at = now() where id = p_txn;
  -- Learn the payer name — but never a DAF / platform name (it is not the donor).
  if p_learn_payer and t.payer_name is not null and t.originator_kind is null then
    insert into app.external_ids (center_id, household_id, person_id, kind, system, value, label, source, confidence, created_by,
                                  times_matched, last_matched_at)
      values (t.center_id, p_household, p_payer_person, 'bank_payer',
              coalesce((select lower(institution) from app.bank_accounts where id = t.bank_account_id), 'bank'),
              t.payer_name, initcap(coalesce(t.channel, 'bank')) || ' payer name', 'learned', 0.9, auth.uid(), 1, now())
    on conflict (center_id, household_id, system, normalized) where kind = 'bank_payer'
      do update set times_matched = app.external_ids.times_matched + 1, last_matched_at = now(),
                    confidence = least(1, coalesce(app.external_ids.confidence, 0.9) + 0.02);
  end if;
  if r.id is not null then
    update app.payment_reports set status = 'matched', bank_transaction_id = t.id, payment_id = v_payment,
           matched_by = auth.uid(), matched_at = now()
     where id = r.id;
  end if;
  return v_payment;
end $function$;

-- ── app.my_payment_proofs ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.my_payment_proofs(p_center uuid, p_household uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not app.adult_of_household(p_center, p_household) then
    raise exception 'Only an adult of the family can see its payment confirmations.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(app._proof_json(x.id) order by x.created_at desc)
                     from (select id, created_at from app.payment_proofs where household_id = p_household and center_id = p_center
                            order by created_at desc limit 100) x), '[]'::jsonb);
end $function$;

-- ── app.payment_proof_counts ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.payment_proof_counts(p_center uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_wait int := coalesce((app.proof_policy(p_center) ->> 'reply_wait_days')::int, 14);
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not (app._proof_staff(p_center) or app.has_permission(p_center, 'giving.view')) then
    raise exception 'Seeing payment confirmations needs giving.view or giving.record_offline.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'waiting', (select count(*) from app.payment_proofs where center_id = p_center and status = 'submitted'),
    'needs_info', (select count(*) from app.payment_proofs where center_id = p_center and status = 'needs_info'),
    'stale', (select count(*) from app.payment_proofs where center_id = p_center and status = 'needs_info' and question_at < now() - make_interval(days => v_wait)),
    'oldest_days', (select coalesce(max(current_date - created_at::date), 0) from app.payment_proofs where center_id = p_center and status = 'submitted'));
end $function$;

-- ── app.payment_proof_queue ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.payment_proof_queue(p_center uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_pol jsonb := app.proof_policy(p_center); v_limit bigint := coalesce((v_pol ->> 'second_approver_over_cents')::bigint, 0);
        v_wait int := coalesce((v_pol ->> 'reply_wait_days')::int, 14);
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not (app._proof_staff(p_center) or app.has_permission(p_center, 'giving.view')) then
    raise exception 'Seeing payment confirmations needs giving.view or giving.record_offline.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(c.j order by c.created_at) from (
      select pr.created_at, app._proof_json(pr.id, true) || jsonb_build_object(
        'household', (select to_jsonb(h) from app.household_card(pr.household_id) h),
        'sent_by', (select nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') from app.people p where p.id = pr.submitted_by_person),
        'age_days', current_date - pr.created_at::date,
        'stale', pr.status = 'needs_info' and pr.question_at < now() - make_interval(days => v_wait),
        'own_household', app.in_my_household(pr.center_id, pr.household_id),
        'needs_second', v_limit > 0 and pr.amount_cents > v_limit,
        'first_approved_by_me', pr.first_approved_by = auth.uid(),
        'first_approved', pr.first_approved_by is not null,
        'lookalikes', app.proof_lookalikes(pr.household_id, pr.amount_cents, pr.method::text, pr.paid_on, pr.reference, pr.id),
        'same_file', exists (select 1 from app.payment_proof_files a join app.payment_proof_files b
                               on b.center_id = a.center_id and b.sha256 = a.sha256 and b.id <> a.id and b.proof_id is distinct from a.proof_id
                              where a.proof_id = pr.id and a.sha256 is not null),
        'bank_lines', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'posted_on', t.posted_on, 'description', t.description))
                                  from (select id, posted_on, description from app.bank_transactions t
                                         where t.center_id = pr.center_id and t.status in ('unmatched','suggested') and t.amount_cents = pr.amount_cents
                                           and not t.is_batch_deposit and t.posted_on between pr.paid_on - 1 and pr.paid_on + 45
                                         order by t.posted_on limit 3) t), '[]'::jsonb)) as j
        from app.payment_proofs pr where pr.center_id = p_center and pr.status in ('submitted','needs_info')) c), '[]'::jsonb);
end $function$;

-- ── app.proof_files_due_soon ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.proof_files_due_soon(p_center uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_days int := greatest(1, least(coalesce(p_days, 30), 365)); v_count int; v_soonest date;
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not (app._proof_staff(p_center) or app.has_permission(p_center, 'settings.manage')) then
    raise exception 'Seeing which confirmations are about to be removed needs giving.record_offline, giving.manage or settings.manage.'
      using errcode = '42501';
  end if;
  with already as (select d.file_id from app._proof_files_due(p_center, null, null, true, 0) d)
  select count(*), min(n.due_on) into v_count, v_soonest
    from app._proof_files_due(p_center, null, null, true, v_days) n
   where n.file_id not in (select file_id from already);
  return jsonb_build_object('count', v_count, 'soonest_on', v_soonest, 'days', v_days,
                            'legal_hold', coalesce((app.proof_policy(p_center) ->> 'legal_hold')::boolean, false));
end $function$;

-- ── app.proof_lookalikes ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.proof_lookalikes(p_household uuid, p_amount_cents bigint, p_method text, p_paid_on date, p_reference text, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_center uuid; v_ref text := nullif(upper(regexp_replace(coalesce(p_reference, ''), '[^A-Za-z0-9]', '', 'g')), '');
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then return '[]'::jsonb; end if;
  if not (app._proof_staff(v_center) or app.has_permission(v_center, 'giving.view') or app.adult_of_household(v_center, p_household)) then
    raise exception 'Not allowed to look at this family''s payments.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.o) from (
      select 1 as o, jsonb_build_object('kind', 'payment', 'id', p.id,
               'label', coalesce('Receipt ' || p.receipt_number, 'A payment') || ', ' || replace(p.method::text, '_', ' ') || ', ' || to_char(p.received_on, 'Mon FMDD'),
               'certain', v_ref is not null and p.method::text = p_method
                          and v_ref in (upper(regexp_replace(coalesce(p.check_number, ''), '[^A-Za-z0-9]', '', 'g')),
                                        upper(regexp_replace(coalesce(p.provider_ref, ''), '[^A-Za-z0-9]', '', 'g')))) as j
        from app.payments p
       where p.household_id = p_household and p.amount_cents = p_amount_cents and p.status in ('captured','pending_clearing','settled')
         and abs(p.received_on - p_paid_on) <= 7
         and (p_exclude is null or p.idempotency_key is distinct from 'proof:' || p_exclude::text)
      union all
      select 2, jsonb_build_object('kind', 'proof', 'id', q.id,
               'label', 'A payment confirmation sent ' || to_char(q.created_at, 'Mon FMDD') || ' (' || replace(q.method::text, '_', ' ') || ')',
               'certain', v_ref is not null and q.method::text = p_method and upper(regexp_replace(coalesce(q.reference, ''), '[^A-Za-z0-9]', '', 'g')) = v_ref)
        from app.payment_proofs q
       where q.household_id = p_household and q.amount_cents = p_amount_cents and q.status in ('submitted','needs_info')
         and abs(q.paid_on - p_paid_on) <= 7 and q.id is distinct from p_exclude
      union all
      select 3, jsonb_build_object('kind', 'zelle_report', 'id', r.id,
               'label', 'A Zelle report of ' || to_char(r.sent_on, 'Mon FMDD'), 'certain', false)
        from app.payment_reports r
       where r.household_id = p_household and r.amount_cents = p_amount_cents and r.status in ('reported','unmatched')
         and abs(r.sent_on - p_paid_on) <= 7
    ) x), '[]'::jsonb);
end $function$;

-- ── app.proof_retention_preview ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.proof_retention_preview(p_center uuid, p_years integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_now int; v_files int; v_family int;
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not app.has_permission(p_center, 'settings.manage') then
    raise exception 'Seeing the payment confirmation rules needs settings.manage.' using errcode = '42501';
  end if;
  if p_years is null or p_years not between 3 and 25 then raise exception 'Keep confirmations for 3 to 25 years.' using errcode = '22023'; end if;
  v_now := coalesce((app.proof_policy(p_center) ->> 'retention_years')::int, 7);
  with already as (select d.file_id from app._proof_files_due(p_center, null, v_now, true) d)
  select count(*), count(*) filter (where n.member_visible) into v_files, v_family
    from app._proof_files_due(p_center, null, p_years, true) n
   where n.file_id not in (select file_id from already);
  return jsonb_build_object('current_years', v_now, 'new_years', p_years, 'files', v_files, 'family_files', v_family,
                            'legal_hold', coalesce((app.proof_policy(p_center) ->> 'legal_hold')::boolean, false));
end $function$;

-- ── app.reconcile_candidates ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.reconcile_candidates(p_txn uuid)
 RETURNS TABLE(rank integer, tier text, kind text, ref_id uuid, household_id uuid, household_name text, label text, reasons jsonb, consequence text, blocked boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare t app.bank_transactions; v_ref text;
begin
  select * into t from app.bank_transactions where id = p_txn;
  if t.id is null then return; end if;
  perform app.assert_module_enabled(t.center_id, 'giving');
  perform app.assert_module_enabled(t.center_id, 'giving_bank');
  if not (app._proof_staff(t.center_id) or app.has_permission(t.center_id, 'giving.view')) then
    raise exception 'Reconciling the bank needs giving.record_offline or giving.view.' using errcode = '42501';
  end if;
  if t.amount_cents <= 0 or t.is_batch_deposit or t.status in ('matched', 'ignored', 'payout') then return; end if;
  v_ref := nullif(upper(regexp_replace(coalesce(t.reference, ''), '[^A-Za-z0-9]', '', 'g')), '');
  return query
  with hh as (select s.household_id, s.score, s.report_id from app.suggest_bank_matches(p_txn) s),
  fit as (   -- unbanked recorded payments and waiting proofs of exactly this amount, inside the method's window
    select 'payment'::text as kind, p.id, p.household_id, p.method, p.received_on as on_date, p.receipt_number as ref_text,
           (v_ref is not null and upper(regexp_replace(coalesce(p.check_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_ref) as ref_ok
      from app.payments p
     where p.center_id = t.center_id and p.provider = 'offline' and p.deposit_bank_transaction_id is null
       and p.status in ('captured', 'pending_clearing') and p.amount_cents = t.amount_cents and p.method <> 'cash'
       and app._line_fits_method(t.channel, p.method)
       and p.received_on between t.posted_on - app.bank_window_days(t.center_id, p.method::text) and t.posted_on + 3
    union all
    select 'proof', q.id, q.household_id, q.method, q.paid_on, q.reference,
           (v_ref is not null and upper(regexp_replace(coalesce(q.reference, ''), '[^A-Za-z0-9]', '', 'g')) = v_ref)
      from app.payment_proofs q
     where q.center_id = t.center_id and q.status in ('submitted', 'needs_info') and q.amount_cents = t.amount_cents and q.method <> 'cash'
       and app._line_fits_method(t.channel, q.method)
       and q.paid_on between t.posted_on - app.bank_window_days(t.center_id, q.method::text) and t.posted_on + 3
  ),
  scored as (
    select f.*, coalesce((select max(h.score) from hh h where h.household_id = f.household_id), 0) as who, count(*) over () as n
      from fit f
  ),
  rows_fit as (
    select case when s.ref_ok and s.n = 1 then 'A'
                when s.ref_ok then 'B'
                when s.n = 1 and s.who >= 0.9 then 'A'
                when s.n = 1 and s.who > 0 then 'B'
                else 'C' end as tier,
           s.kind, s.id as ref_id, s.household_id,
           case s.kind when 'payment' then 'Receipt ' || coalesce(s.ref_text, '?') || ', ' || replace(s.method::text, '_', ' ') || ', ' || to_char(s.on_date, 'FMMon FMDD') || ', not yet on the bank'
                       else 'Payment confirmation sent for ' || to_char(s.on_date, 'FMMon FMDD') || ', ' || replace(s.method::text, '_', ' ') || coalesce(' ' || s.ref_text, '') end as label,
           (select jsonb_agg(x) from (values ('Amount matches'), (case when s.ref_ok then 'Reference matches' end),
                  (case when s.who >= 0.9 then 'Known payer name' when s.who > 0 then 'Payer fits this family' end),
                  ('Inside the usual window'), (case when s.n = 1 then 'Only one candidate' else s.n || ' candidates fit' end)) v(x) where x is not null) as reasons,
           case s.kind when 'payment' then 'The line is attached to this payment. No pledge changes.'
                       else 'The payment confirmation is approved and banked in one step: its pledges become Paid, then Bank reconciled.' end as consequence,
           s.who
      from scored s
  ),
  rows_zelle as (
    select case when h.score >= 0.99 then 'A' when h.score >= 0.9 then 'B' else 'C' end as tier, 'zelle_report'::text as kind, h.report_id as ref_id,
           h.household_id, 'A Zelle report from this family'::text as label,
           '["Amount matches","Member reported this Zelle"]'::jsonb as reasons,
           'Confirm the line with the family''s report: a payment is recorded and its pledges are chosen as the family said.'::text as consequence,
           h.score as who
      from hh h where h.report_id is not null and not exists (select 1 from fit)
  ),
  rows_conflict as (   -- same family, same kind of money, but the amount differs by up to a fifth
    select 'D'::text as tier, 'conflict'::text as kind, c.id as ref_id, c.household_id,
           'Recorded ' || to_char(c.amount_cents / 100.0, 'FM$999,999,990.00') || ', the bank shows ' || to_char(t.amount_cents / 100.0, 'FM$999,999,990.00')
             || ' (' || case when t.amount_cents > c.amount_cents then 'more' else 'less' end || ' by ' || to_char(abs(t.amount_cents - c.amount_cents) / 100.0, 'FM$999,999,990.00') || ')' as label,
           '["Same family","Amount differs"]'::jsonb as reasons,
           'Nothing is attached until you choose: record the bank''s amount (the bank is the truth) with a reason, or leave the line.'::text as consequence,
           0::numeric as who
      from (select p.id, p.household_id, p.amount_cents, p.method, p.received_on from app.payments p
             where p.center_id = t.center_id and p.provider = 'offline' and p.deposit_bank_transaction_id is null and p.status in ('captured', 'pending_clearing')
               and p.method <> 'cash' and p.amount_cents <> t.amount_cents and abs(p.amount_cents - t.amount_cents) <= p.amount_cents / 5
               and app._line_fits_method(t.channel, p.method)
               and p.received_on between t.posted_on - app.bank_window_days(t.center_id, p.method::text) and t.posted_on + 3
            union all
            select q.id, q.household_id, q.amount_cents, q.method, q.paid_on from app.payment_proofs q
             where q.center_id = t.center_id and q.status in ('submitted', 'needs_info') and q.method <> 'cash' and q.amount_cents <> t.amount_cents
               and abs(q.amount_cents - t.amount_cents) <= q.amount_cents / 5 and app._line_fits_method(t.channel, q.method)
               and q.paid_on between t.posted_on - app.bank_window_days(t.center_id, q.method::text) and t.posted_on + 3) c
     where exists (select 1 from hh h where h.household_id = c.household_id) and not exists (select 1 from fit)
  ),
  rows_new as (       -- nothing recorded or waiting can be this money: new money, or a blocked lookalike in the family it points to
    select case when exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on)) then 'D'
                when h.score >= 0.9 then 'B' else 'C' end as tier,
           case when exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on)) then 'lookalike' else 'new_money' end as kind,
           null::uuid as ref_id, h.household_id,
           case when exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on))
                then 'This family has ' || (select z.label from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on) z limit 1) || ' of this amount not on the bank yet'
                else 'No recorded payment or confirmation explains this money' end as label,
           (select jsonb_agg(x) from (values (case when h.score >= 0.9 then 'Known payer name' else 'Payer name or ID suggests this family' end),
                  (case when not exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on)) then 'No lookalike found' end)) v(x) where x is not null) as reasons,
           case when exists (select 1 from app.unbanked_lookalikes(h.household_id, t.amount_cents, t.posted_on))
                then 'Creating a second payment is blocked. Attach the line to that payment (or approve that confirmation with it), or say why this is a separate gift.'
                else coalesce('A payment is recorded from the line. Oldest uncovered pledges first: ' ||
                              (select string_agg(coalesce(a.pledge_number, 'a pledge') || ' ' || to_char(a.amount_cents / 100.0, 'FM$999,999,990.00'), ', ' order by a.pledge_number)
                                 from app.preview_allocation(h.household_id, t.amount_cents) a) || '. Pledges already covered by a payment confirmation are skipped.',
                              'A payment is recorded from the line; this family has no open pledge, so it stays unallocated.') end as consequence,
           h.score as who
      from (select * from hh order by score desc limit 3) h
     where not exists (select 1 from fit) and not exists (select 1 from rows_zelle) and not exists (select 1 from rows_conflict)
  )
  select (row_number() over (order by u.tier, u.who desc))::int, u.tier, u.kind, u.ref_id, u.household_id, h2.display_name, u.label,
         coalesce(u.reasons, '[]'::jsonb), u.consequence, (u.kind = 'lookalike')
    from (select tier, kind, ref_id, household_id, label, reasons, consequence, who from rows_fit
          union all select tier, kind, ref_id, household_id, label, reasons, consequence, who from rows_zelle
          union all select tier, kind, ref_id, household_id, label, reasons, consequence, who from rows_conflict
          union all select tier, kind, ref_id, household_id, label, reasons, consequence, who from rows_new) u
    join app.households h2 on h2.id = u.household_id
   order by 1;
end $function$;

-- ── app.reject_payment_proof ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.reject_payment_proof(p_proof uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare pr app.payment_proofs; v_reason text := nullif(btrim(p_reason), '');
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That payment confirmation was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app._proof_staff(pr.center_id) then raise exception 'Reviewing a payment confirmation needs giving.record_offline.' using errcode = '42501'; end if;
  if app.in_my_household(pr.center_id, pr.household_id) then
    raise exception 'You cannot review a payment confirmation from your own household. Another member of the treasury team must.' using errcode = '42501';
  end if;
  if pr.status not in ('submitted','needs_info') then raise exception 'This payment confirmation was already % by someone else.', pr.status using errcode = '22023'; end if;
  if v_reason is null or char_length(v_reason) < 3 then raise exception 'Say why, in a few words. The family will read it.' using errcode = '22023'; end if;
  update app.soft_credits set state = 'released' where proof_id = pr.id and state = 'active';
  update app.payment_proofs set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason where id = pr.id;
  perform app._proof_event(pr.id, 'rejected', 'Not accepted: ' || v_reason || ' Your pledges are open again.');
  return jsonb_build_object('state', 'rejected', 'proof', app._proof_json(pr.id, true), 'notice', app._proof_notice(pr.id, 'proof_rejected', v_reason));
end $function$;

-- ── app.remove_payment_evidence_file ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.remove_payment_evidence_file(p_file uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare f app.payment_proof_files; v_reason text := nullif(btrim(p_reason), '');
begin
  select * into f from app.payment_proof_files where id = p_file for update;
  if f.id is null then raise exception 'That file was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(f.center_id, 'giving_proofs');
  if not app.has_permission(f.center_id, 'giving.manage') then
    raise exception 'Removing a file from a payment needs giving.manage.' using errcode = '42501';
  end if;
  if f.proof_id is not null or f.payment_id is null or f.member_visible then
    raise exception 'Only a file staff attached to a payment can be removed here. A family''s confirmation files are removed by the retention rule.' using errcode = '22023';
  end if;
  if f.deleted_at is not null then raise exception 'That file was already removed.' using errcode = '22023'; end if;
  if coalesce((app.proof_policy(f.center_id) ->> 'legal_hold')::boolean, false) then
    raise exception 'A legal hold is on, so no file can be removed. Turn it off in Settings first.' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then raise exception 'Say why you are removing it, in a few words.' using errcode = '22023'; end if;
  perform app.set_audit_context(v_reason);
  update app.payment_proof_files set deleted_at = now(), deleted_reason = left(v_reason, 300) where id = f.id;
  return jsonb_build_object('id', f.id, 'storage_path', f.storage_path);
end $function$;

-- ── app.set_proof_policy ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.set_proof_policy(p_center uuid, p_policy jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_old jsonb := app.proof_policy(p_center); v_new jsonb; k text;
        v_allowed text[] := array['required_methods','retention_years','legal_hold','second_approver_over_cents','reply_wait_days','honour_event_entry','release_store_orders','windows'];
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not app.has_permission(p_center, 'settings.manage') then raise exception 'Changing the payment confirmation rules needs settings.manage.' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(p_policy) loop
    if not (k = any(v_allowed)) then raise exception 'Unknown setting: %.', k using errcode = '22023'; end if;
  end loop;
  v_new := v_old || p_policy;
  if (v_new ->> 'retention_years')::int not between 3 and 25 then raise exception 'Keep confirmations for 3 to 25 years.' using errcode = '22023'; end if;
  if (v_new ->> 'second_approver_over_cents')::bigint < 0 then raise exception 'The amount for a second approval cannot be negative.' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(v_new -> 'windows', '{}'::jsonb)) <> 'object'
     or exists (select 1 from jsonb_each_text(coalesce(v_new -> 'windows', '{}'::jsonb)) w
                 where w.key not in ('cash','check','ach','zelle','stock','daf','matching_gift','other') or w.value !~ '^[0-9]{1,3}$' or w.value::int not between 1 and 180) then
    raise exception 'The usual days to reach the bank must be 1 to 180 for each method.' using errcode = '22023';
  end if;
  if (v_new ->> 'reply_wait_days')::int not between 1 and 60 then raise exception 'Wait 1 to 60 days for a reply.' using errcode = '22023'; end if;
  if jsonb_typeof(v_new -> 'required_methods') <> 'array'
     or exists (select 1 from jsonb_array_elements_text(v_new -> 'required_methods') m
                 where m not in ('cash','check','ach','zelle','stock','daf','matching_gift','other')) then
    raise exception 'The list of methods that need a confirmation is not valid.' using errcode = '22023';
  end if;
  if (v_new ->> 'retention_years')::int < (v_old ->> 'retention_years')::int then
    if app.audit_clean_reason(p_reason) is null then raise exception 'Say why you are shortening the years.' using errcode = '22023'; end if;
    perform app.assert_step_up('payment_proofs_retention');
  end if;
  perform app.set_audit_context(coalesce(p_reason, 'Payment confirmation rules changed'));
  update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}',
         coalesce(rules -> 'payments', '{}'::jsonb) || jsonb_build_object('proofs', v_new)) where id = p_center;
  return v_new;
end $function$;

-- ── app.store_order_pledge ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.store_order_pledge(p_order uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare o app.store_orders; v_pledge uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to send a payment confirmation.' using errcode = '42501'; end if;
  select * into o from app.store_orders where id = p_order for update;
  if o.id is null then raise exception 'That order was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(o.center_id, 'giving');
  perform app.assert_module_enabled(o.center_id, 'giving_proofs');
  if o.household_id is null or not app.adult_of_household(o.center_id, o.household_id) then
    raise exception 'Only an adult of the family that placed the order can do this.' using errcode = '42501';
  end if;
  if o.status not in ('placed', 'preparing', 'ready') then
    raise exception 'This order is % and cannot take a payment confirmation.', o.status using errcode = '22023';
  end if;
  if coalesce(o.total_cents, 0) <= 0 then raise exception 'This order has nothing to pay.' using errcode = '22023'; end if;
  select id into v_pledge from app.pledges where center_id = o.center_id and source = 'store' and source_ref_id = o.id and status <> 'cancelled' limit 1;
  if v_pledge is not null then return v_pledge; end if;
  insert into app.pledges (center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, dedication, created_by)
    values (o.center_id, o.household_id, app.my_person_id(o.center_id), 'store', o.id, o.total_cents, 'Store order ' || o.order_number, auth.uid())
    returning id into v_pledge;
  return v_pledge;
end $function$;

-- ── app.submit_payment_proof ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.submit_payment_proof(p_center uuid, p_household uuid, p_method text, p_amount_cents bigint, p_paid_on date, p_reference text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_pledge_ids uuid[] DEFAULT NULL::uuid[], p_entry text DEFAULT 'open_pledges'::text, p_entry_ref uuid DEFAULT NULL::uuid, p_files jsonb DEFAULT '[]'::jsonb, p_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare
  v_me uuid := auth.uid(); v_pol jsonb; v_today date; v_id uuid; v_existing app.payment_proofs; v_remaining bigint; r record; v_take bigint;
  v_pos int := 0; v_n int; f jsonb; v_seg text; v_tz text; v_need boolean; v_first text;
begin
  if v_me is null then raise exception 'Sign in to send a payment confirmation.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not exists (select 1 from app.households where id = p_household and center_id = p_center) then
    raise exception 'That family was not found in this community.' using errcode = '22023';
  end if;
  if not app.adult_of_household(p_center, p_household) then
    raise exception 'Only an adult of the family can send a payment confirmation. Ask a parent to send it.' using errcode = '42501';
  end if;
  perform 1 from app.households where id = p_household for update;   -- two adults, one tap each: one at a time
  if p_key is not null then
    if char_length(p_key) < 8 or char_length(p_key) > 120 then
      raise exception 'The sheet sent a bad confirmation key. Close it and start again.' using errcode = '22023';
    end if;
    select * into v_existing from app.payment_proofs where center_id = p_center and idempotency_key = p_key;
    if found then
      if v_existing.household_id <> p_household or v_existing.amount_cents <> p_amount_cents then
        raise exception 'This request was already used for a different payment confirmation. Close the sheet and start again.' using errcode = '23505';
      end if;
      return jsonb_build_object('proof', app._proof_json(v_existing.id), 'replayed', true);
    end if;
  end if;
  if p_method is null or p_method not in ('cash','check','ach','zelle','stock','daf','matching_gift','other') then
    raise exception 'Choose how you paid.' using errcode = '22023';
  end if;
  if not exists (select 1 from app.center_payment_methods m where m.center_id = p_center and m.method = p_method::app.payment_method and m.accepted) then
    raise exception 'Your community does not take that way of paying here.' using errcode = '22023';
  end if;
  if p_amount_cents is null or p_amount_cents < 1 or p_amount_cents > 100000000 then
    raise exception 'Enter the amount you paid, from $0.01 to $1,000,000.' using errcode = '22023';
  end if;
  select time_zone into v_tz from app.centers where id = p_center;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;
  if p_paid_on is null or p_paid_on > v_today then raise exception 'The date you paid cannot be in the future.' using errcode = '22023'; end if;
  if p_paid_on < v_today - 400 then raise exception 'That date is more than a year ago. Ask the treasurer to record it.' using errcode = '22023'; end if;
  if char_length(coalesce(p_reference, '')) > 80 or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'The reference or note is too long.' using errcode = '22023';
  end if;
  if (select count(*) from app.payment_proofs where household_id = p_household and status in ('submitted','needs_info')) >= 5 then
    raise exception 'You already have 5 payment confirmations waiting. Wait for the treasury team to check one, or take one back.' using errcode = '22023';
  end if;
  if p_entry not in ('open_pledges','rsvp','store','opportunity','labh','pathshala_fee','membership','other') then
    raise exception 'Unknown place to send a payment confirmation from.' using errcode = '22023';
  end if;
  if p_entry in ('rsvp','store','opportunity','labh','pathshala_fee','membership') and coalesce(array_length(p_pledge_ids, 1), 0) <> 1 then
    raise exception 'A payment confirmation sent from checkout covers that order''s pledge only.' using errcode = '22023';
  end if;

  v_pol := app.proof_policy(p_center);
  v_n := coalesce(jsonb_array_length(p_files), 0);
  if v_n > 5 then raise exception 'You can add up to 5 files.' using errcode = '22023'; end if;
  v_need := v_pol -> 'required_methods' ? p_method;
  if v_n = 0 and v_need then raise exception 'Add a photo or file of your receipt. A payment confirmation is needed for this way of paying.' using errcode = '22023'; end if;
  v_id := gen_random_uuid();
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    v_seg := split_part(f ->> 'path', '/', 3);
    if split_part(f ->> 'path', '/', 1) <> p_center::text or split_part(f ->> 'path', '/', 2) <> p_household::text
       or v_seg !~ '^[0-9a-f-]{36}$' or split_part(f ->> 'path', '/', 4) = '' then
      raise exception 'A file was not uploaded to the right place. Close the sheet and try again.' using errcode = '22023';
    end if;
    v_id := v_seg::uuid;
  end loop;
  if exists (select 1 from app.payment_proofs where id = v_id) then
    raise exception 'This payment confirmation was already sent. Close the sheet and look in your payment confirmations.' using errcode = '23505';
  end if;

  insert into app.payment_proofs (id, center_id, household_id, submitted_by, submitted_by_person, entry, entry_ref, method, amount_cents,
                                  paid_on, reference, note, idempotency_key, is_test)
    values (v_id, p_center, p_household, v_me, app.my_person_id(p_center), p_entry, p_entry_ref, p_method::app.payment_method, p_amount_cents,
            p_paid_on, nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), p_key,
            coalesce((select environment = 'sandbox' from app.centers where id = p_center), false));

  v_remaining := p_amount_cents;
  for r in
    select p.id, p.amount_cents - p.paid_cents - p.soft_credit_cents as open_cents
      from app.pledges p
     where p.center_id = p_center and p.household_id = p_household and p.status in ('open','partially_paid')
       and p.amount_cents - p.paid_cents - p.soft_credit_cents > 0
       and (p_pledge_ids is null or p.id = any(p_pledge_ids))
     order by p.pledged_at, p.created_at, p.id
       for update of p
  loop
    exit when v_remaining <= 0;
    if p_entry <> 'open_pledges' and p_amount_cents <> r.open_cents then
      raise exception 'The amount is set by your order: % to pay.', to_char(r.open_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
    end if;
    v_take := least(r.open_cents, v_remaining);
    insert into app.soft_credits (center_id, proof_id, pledge_id, amount_cents, position) values (p_center, v_id, r.id, v_take, v_pos);
    v_pos := v_pos + 1;
    v_remaining := v_remaining - v_take;
  end loop;
  if v_pos = 0 then
    raise exception 'You have no open pledge that this can cover. If you paid something that is not listed, ask the treasurer.' using errcode = '22023';
  end if;
  update app.payment_proofs set excess_cents = v_remaining where id = v_id;

  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    insert into app.payment_proof_files (center_id, proof_id, household_id, storage_path, content_type, bytes, sha256, member_visible, uploaded_by)
      values (p_center, v_id, p_household, f ->> 'path', f ->> 'content_type', (f ->> 'bytes')::bigint, nullif(f ->> 'sha256', ''), true, v_me);
  end loop;
  select coalesce(p.preferred_name, p.first_name) into v_first from app.people p where p.id = app.my_person_id(p_center);
  perform app._proof_event(v_id, 'submitted', 'Sent' || coalesce(' by ' || v_first, '') || '. Your pledges show Soft credit while the treasury team checks it.');
  return jsonb_build_object('proof', app._proof_json(v_id), 'replayed', false,
                            'lookalikes', app.proof_lookalikes(p_household, p_amount_cents, p_method, p_paid_on, p_reference, v_id));
end $function$;

-- ── app.unbanked_lookalikes ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.unbanked_lookalikes(p_household uuid, p_amount_cents bigint, p_on date)
 RETURNS TABLE(kind text, id uuid, label text, on_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  select 'payment', p.id, 'a payment' || coalesce(' (receipt ' || p.receipt_number || ')', '') || ' from ' || to_char(p.received_on, 'FMMonth FMDD'), p.received_on
    from app.payments p
   where p.household_id = p_household and p.amount_cents = p_amount_cents and p.provider = 'offline'
     and p.deposit_bank_transaction_id is null and p.status in ('captured','pending_clearing')
     and p.received_on between p_on - 45 and p_on + 3
  union all
  select 'proof', q.id, 'a payment confirmation sent ' || to_char(q.created_at, 'FMMonth FMDD'), q.paid_on
    from app.payment_proofs q
   where q.household_id = p_household and q.amount_cents = p_amount_cents and q.status in ('submitted','needs_info')
     and q.paid_on between p_on - 45 and p_on + 3
$function$;

-- ── app.withdraw_payment_proof ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.withdraw_payment_proof(p_proof uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare pr app.payment_proofs;
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That payment confirmation was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app.adult_of_household(pr.center_id, pr.household_id) then
    raise exception 'Only an adult of the family can take a payment confirmation back.' using errcode = '42501';
  end if;
  if pr.status not in ('submitted','needs_info') then
    raise exception 'This payment confirmation was already checked, so it cannot be taken back.' using errcode = '22023';
  end if;
  update app.soft_credits set state = 'released' where proof_id = pr.id and state = 'active';
  update app.payment_proofs set status = 'withdrawn', decided_at = now() where id = pr.id;
  perform app._proof_event(pr.id, 'withdrawn', 'Taken back. Your pledges are open again.');
  return app._proof_json(pr.id);
end $function$;

-- ── Grants, as before ─────────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function app._pledge_locks(app.pledges) from public, anon, authenticated, service_role;
revoke all on function app._proof_files_due(uuid,uuid,integer,boolean,integer) from public, anon, authenticated, service_role;
revoke all on function app.answer_proof_question(uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function app.answer_proof_question(uuid,text,jsonb) to authenticated, service_role;
revoke all on function app.approve_payment_proof(uuid,bigint,date,text,text,uuid,text,uuid) from public, anon, authenticated, service_role;
grant execute on function app.approve_payment_proof(uuid,bigint,date,text,text,uuid,text,uuid) to authenticated, service_role;
revoke all on function app.ask_proof_question(uuid,text) from public, anon, authenticated, service_role;
grant execute on function app.ask_proof_question(uuid,text) to authenticated, service_role;
revoke all on function app.confirm_bank_match(uuid,uuid,uuid[],boolean,uuid,uuid,text) from public, anon, authenticated, service_role;
grant execute on function app.confirm_bank_match(uuid,uuid,uuid[],boolean,uuid,uuid,text) to authenticated, service_role;
revoke all on function app.my_payment_proofs(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function app.my_payment_proofs(uuid,uuid) to authenticated, service_role;
revoke all on function app.payment_proof_counts(uuid) from public, anon, authenticated, service_role;
grant execute on function app.payment_proof_counts(uuid) to authenticated, service_role;
revoke all on function app.payment_proof_queue(uuid) from public, anon, authenticated, service_role;
grant execute on function app.payment_proof_queue(uuid) to authenticated, service_role;
revoke all on function app.proof_files_due_soon(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function app.proof_files_due_soon(uuid,integer) to authenticated;
revoke all on function app.proof_lookalikes(uuid,bigint,text,date,text,uuid) from public, anon, authenticated, service_role;
grant execute on function app.proof_lookalikes(uuid,bigint,text,date,text,uuid) to authenticated, service_role;
revoke all on function app.proof_retention_preview(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function app.proof_retention_preview(uuid,integer) to authenticated;
revoke all on function app.reconcile_candidates(uuid) from public, anon, authenticated, service_role;
grant execute on function app.reconcile_candidates(uuid) to authenticated, service_role;
revoke all on function app.reject_payment_proof(uuid,text) from public, anon, authenticated, service_role;
grant execute on function app.reject_payment_proof(uuid,text) to authenticated, service_role;
revoke all on function app.remove_payment_evidence_file(uuid,text) from public, anon, authenticated, service_role;
grant execute on function app.remove_payment_evidence_file(uuid,text) to authenticated;
revoke all on function app.set_proof_policy(uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function app.set_proof_policy(uuid,jsonb,text) to authenticated, service_role;
revoke all on function app.store_order_pledge(uuid) from public, anon, authenticated, service_role;
grant execute on function app.store_order_pledge(uuid) to authenticated, service_role;
revoke all on function app.submit_payment_proof(uuid,uuid,text,bigint,date,text,text,uuid[],text,uuid,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function app.submit_payment_proof(uuid,uuid,text,bigint,date,text,text,uuid[],text,uuid,jsonb,text) to authenticated, service_role;
revoke all on function app.unbanked_lookalikes(uuid,bigint,date) from public, anon, authenticated, service_role;
revoke all on function app.withdraw_payment_proof(uuid) from public, anon, authenticated, service_role;
grant execute on function app.withdraw_payment_proof(uuid) to authenticated, service_role;
