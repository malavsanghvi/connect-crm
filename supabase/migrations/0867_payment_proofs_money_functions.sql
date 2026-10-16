-- 0867 · Payment proofs, step 4 of 4: the existing money functions learn about soft credit, and the double-count guard.
--
--   allocate_payment / preview_allocation   a pledge's open part is amount - paid - SOFT CREDIT: new money can never take what a waiting proof covers
--   household_card                          "open pledge $" leaves soft credit out (owner rule 2026-10-15: Open balance = amount - paid - soft credit)
--   can_read_object / can_write_object      the payment-evidence bucket: the family's adults and the treasury team read; the family writes its own folder
--   _pledge_locks / pledges guard           a pledge with a proof waiting cannot be edited, deleted, written off or cancelled
--   cancel_my_rsvp                          cancelling releases the soft credit and tells the treasury team the money is unplaced
--   confirm_bank_match                      I3: a bank line never creates a payment while an unbanked payment or a waiting proof of the SAME family
--                                           and amount exists, unless the treasurer types why it is a separate gift (SQLSTATE CCDUP, as G6 before)
--   attach_bank_line_to_payment             any offline method except cash (cash banks in a deposit); the bank settles the payment, no pledge changes
set client_min_messages = warning;

CREATE OR REPLACE FUNCTION app.allocate_payment(p_payment uuid, p_pledge_ids uuid[] DEFAULT NULL::uuid[], p_apply boolean DEFAULT false)
 RETURNS TABLE(pledge_id uuid, amount_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare v_center uuid; v_household uuid; v_remaining bigint; r record; v_take bigint;
begin
  select center_id, household_id,
         amount_cents - donor_covered_fee_cents - coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.payment_id = p_payment),0)
    into v_center, v_household, v_remaining from app.payments where id = p_payment;
  perform app.assert_module_enabled(v_center, 'giving');
  if v_remaining is null or v_remaining <= 0 then return; end if;
  for r in
    select p.id, p.amount_cents - p.paid_cents - p.soft_credit_cents as open_cents
    from app.pledges p
    where p.center_id = v_center and p.household_id = v_household
      and p.status in ('open','partially_paid')
      and (p_pledge_ids is null or p.id = any(p_pledge_ids))
    order by case when p_pledge_ids is not null then array_position(p_pledge_ids, p.id) end, p.pledged_at
  loop
    exit when v_remaining <= 0;
    v_take := least(r.open_cents, v_remaining);
    if v_take > 0 then
      pledge_id := r.id; amount_cents := v_take;
      if p_apply then
        insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents, chosen_by_donor)
        values (v_center, p_payment, r.id, v_take, p_pledge_ids is not null);
      end if;
      return next;
      v_remaining := v_remaining - v_take;
    end if;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION app.preview_allocation(p_household uuid, p_amount_cents bigint, p_pledge_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(pledge_id uuid, pledge_number text, amount_cents bigint, closes boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  with h as (select center_id from app.households where id = p_household
             and app.assert_module_enabled(center_id, 'giving')
             and (app.has_permission(center_id, 'giving.record_offline') or app.has_permission(center_id, 'giving.view')
                  or app.adult_of_household(center_id, id))),
  open as (
    select p.id, p.pledge_number, p.amount_cents - p.paid_cents - p.soft_credit_cents as open_cents,
           coalesce(array_position(p_pledge_ids, p.id), 0) as pick, p.pledged_at
      from app.pledges p, h
     where p.household_id = p_household and p.status in ('open','partially_paid')
       and (p_pledge_ids is null or p.id = any(p_pledge_ids))
  ),
  ordered as (
    select *, sum(open_cents) over (order by pick, pledged_at rows between unbounded preceding and current row) as running
      from open
  )
  select id, pledge_number,
         least(open_cents, greatest(0, p_amount_cents - (running - open_cents))),
         p_amount_cents >= running
    from ordered
   where running - open_cents < p_amount_cents
   order by pick, pledged_at
$function$;

CREATE OR REPLACE FUNCTION app.household_card(p_household uuid)
 RETURNS TABLE(household_id uuid, household_name text, household_number text, org_household_id text, members text, primary_member text, primary_org_member_id text, zone text, city text, last_gift_on date, open_pledge_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
  select h.id, h.display_name, h.household_number,
         (select e.value from app.external_ids e where e.household_id = h.id and e.kind = 'org_household'
            and e.valid_to is null order by e.is_primary desc, e.created_at limit 1),
         (select string_agg(coalesce(p.preferred_name, p.first_name), ', ' order by hm.is_primary desc, p.date_of_birth nulls last)
            from app.household_members hm join app.people p on p.id = hm.person_id
           where hm.household_id = h.id and hm.left_at is null),
         (select p.first_name || ' ' || p.last_name from app.household_members hm join app.people p on p.id = hm.person_id
           where hm.household_id = h.id and hm.is_primary and hm.left_at is null limit 1),
         (select e.value from app.household_members hm join app.external_ids e on e.person_id = hm.person_id and e.kind = 'org_member'
           where hm.household_id = h.id and hm.is_primary and hm.left_at is null and e.valid_to is null limit 1),
         z.name, h.city,
         case when g.giving_on then (select max(pay.received_on) from app.payments pay where pay.household_id = h.id) end,
         case when g.giving_on then (select coalesce(sum(pl.amount_cents - pl.paid_cents - pl.soft_credit_cents), 0) from app.pledges pl
                               where pl.household_id = h.id and pl.status in ('open','partially_paid')) end
  from app.households h
  left join app.zones z on z.id = h.zone_id
  cross join lateral (select app.module_enabled(h.center_id, 'giving') or app.is_platform_admin() as giving_on) g
  where h.id = p_household
    and (app.has_permission(h.center_id, 'people.view') or app.has_permission(h.center_id, 'giving.view')
         or app.has_permission(h.center_id, 'giving.record_offline') or app.in_my_household(h.center_id, h.id))
$function$;

CREATE OR REPLACE FUNCTION app.can_read_object(bucket text, name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
-- $1/$2: the contract names the arguments bucket and name, which read badly next to columns.
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2); v_ok boolean;
begin
  if b = 'branding' then return c is not null; end if;
  if c is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) in ('events', 'flyer-art')
               then app.module_enabled(c, 'events') or app.is_platform_admin()
               else app.storage_module_on(b, c) end) then return false; end if;
  v_ok := case b
    when 'content'       then app.is_member_of(c) or app.event_flyer_is_public(n)
    when 'photos'        then app.has_permission(c, 'content.manage')
                              or (app.is_member_of(c) and (
                                    (auth.uid() is not null and app.storage_segment(n, 3) like auth.uid()::text || '-%')
                                    or exists (select 1 from app.photos p
                                                where p.center_id = c and p.status = 'approved'
                                                  and p.storage_path in (n, 'photos/' || n))))
    when 'store'         then app.is_member_of(c)
    when 'statements'    then app.has_permission(c, 'giving.view')
                              or (s2 is not null and app.adult_of_household(c, s2))
    when 'recordings'    then s2 is not null and (app.can_act_for_person(c, s2) or app.teaches_person(c, s2))
    when 'homework'      then s2 is not null and auth.uid() is not null and app.storage_segment_uuid(n, 3) is not null
                              and exists (select 1 from app.gyan_submissions s
                                           where s.id = app.storage_segment_uuid(n, 3) and s.center_id = c and s.person_id = s2)
                              and app.gyan_submission_readable(app.storage_segment_uuid(n, 3))
                              and (app.gyan_can_act_for(c, s2)
                                   or exists (select 1 from app.gyan_submission_files f
                                               where f.submission_id = app.storage_segment_uuid(n, 3) and f.storage_path = n and f.deleted_at is null))
    when 'payment-evidence' then app.has_permission(c, 'giving.view') or app.has_permission(c, 'giving.record_offline')
                              or app.has_permission(c, 'giving.manage') or (s2 is not null and app.adult_of_household(c, s2))
    when 'imports'       then app.has_permission(c, 'people.manage') or app.has_permission(c, 'giving.manage')
                              or app.has_permission(c, 'accounting.manage') or app.has_permission(c, 'settings.manage')
    when 'org-documents' then app.is_center_owner(c) or app.is_platform_admin()
    when 'exports'       then auth.uid() is not null and s2 = auth.uid()
    else false
  end;
  if v_ok is not true then return false; end if;
  -- 0589: the virus check. Off and monitor deny nothing (this is the one lookup they cost).
  if app.upload_scan_mode() <> 'enforce' or not (b = any (app.storage_scan_buckets())) then return true; end if;
  if app.upload_scan_state(b, n) = 'infected' then return false; end if;
  if app.upload_scan_held(b, n) then
    return case b when 'homework'   then app.gyan_can_act_for(c, s2)
                  when 'recordings' then app.can_act_for_person(c, s2)
                  else false end;
  end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION app.can_write_object(bucket text, name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare b text := $1; n text := $2; c uuid := app.storage_center($2); s2 uuid := app.storage_segment_uuid($2, 2);
begin
  if c is null or auth.uid() is null or not exists (select 1 from app.centers where id = c) then return false; end if;
  if not (case when b = 'content' and app.storage_segment(n, 2) in ('events', 'flyer-art')
               then app.module_enabled(c, 'events') or app.is_platform_admin()
               else app.storage_module_on(b, c) end) then return false; end if;
  -- The AI art library: only layer names, only the library's writers (content.manage included).
  if b = 'content' and app.storage_segment(n, 2) = 'flyer-art' then
    return app.flyer_art_name_ok(n) and app.flyer_art_writer(c);
  end if;
  return case b
    when 'branding'      then app.has_permission(c, 'settings.manage')
    when 'content'       then app.has_permission(c, 'content.manage')
                              or (app.storage_segment(n, 2) = 'events' and app.storage_segment_uuid(n, 3) is not null
                                  and exists (select 1 from app.events ev
                                               where ev.id = app.storage_segment_uuid(n, 3) and ev.center_id = c)
                                  and (app.has_permission(c, 'events.manage') or app.has_scoped_role(c, app.storage_segment_uuid(n, 3), 'event_lead')))
    when 'photos'        then app.has_permission(c, 'content.manage')
                              or (app.is_member_of(c) and s2 is not null
                                  and app.storage_segment(n, 3) like auth.uid()::text || '-%')
    when 'store'         then app.has_permission(c, 'store.manage')
    when 'statements'    then app.has_permission(c, 'giving.manage')
    when 'recordings'    then s2 is not null and app.can_act_for_person(c, s2)
    when 'homework'      then s2 is not null and app.gyan_homework_path_ok(n)
                              and app.gyan_submission_writable(c, s2, app.storage_segment_uuid(n, 3))
    when 'payment-evidence' then (s2 is not null and app.adult_of_household(c, s2) and app.storage_segment_uuid(n, 3) is not null)
                              or (app.storage_segment(n, 2) = 'staff' and (app.has_permission(c, 'giving.record_offline') or app.has_permission(c, 'giving.manage')))
    when 'imports'       then app.has_permission(c, 'people.manage') or app.has_permission(c, 'giving.manage')
                              or app.has_permission(c, 'accounting.manage') or app.has_permission(c, 'settings.manage')
    when 'org-documents' then app.is_center_owner(c)
    when 'exports'       then s2 = auth.uid() and app.is_member_of(c)
    else false
  end;
end $function$;

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
    v_due := v_ref || ' has a payment proof waiting for the treasury team. Verify or reject the proof first.';
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
end $function$;

CREATE OR REPLACE FUNCTION app.cancel_my_rsvp(p_rsvp uuid, p_cancel_pledge boolean DEFAULT false, p_release_credit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare r app.rsvps; p app.pledges; v_cancelled boolean := false; v_released bigint := 0;
begin
  select * into r from app.rsvps where id = p_rsvp for update;
  if r.id is null then raise exception 'RSVP not found'; end if;
  perform app.assert_module_enabled(r.center_id, 'events');
  if not app.adult_of_household(r.center_id, r.household_id) then raise exception 'only an adult of the household can cancel'; end if;
  if r.status = 'cancelled' then return jsonb_build_object('rsvp_cancelled', true, 'pledge_cancelled', false, 'paid_cents', 0, 'credit_cents', 0); end if;
  perform app.set_audit_context(case when p_cancel_pledge then 'Member cancelled the RSVP and its donation commitment in the app; money paid held as credit only if the member asked'
                                     else 'Member cancelled the RSVP in the app and kept the donation commitment' end);
  update app.rsvps set status = 'cancelled', cancelled_at = now() where id = r.id;
  update app.attendees set status = 'cancelled', ticket_revoked = true where rsvp_id = r.id and checked_in_at is null;
  if r.commitment_pledge_id is not null then
    select * into p from app.pledges where id = r.commitment_pledge_id for update;
    if p_cancel_pledge and p.status in ('open', 'partially_paid', 'paid', 'soft_credit') and (p.paid_cents = 0 or p_release_credit) then
      -- Money already paid moves to credit ONLY when the member asked for that; otherwise the pledge (and its payment) stay.
      -- A proof waiting on this pledge: release its soft credit and tell the treasury team the money is unplaced.
      with rel as (update app.soft_credits set state = 'released' where pledge_id = p.id and state = 'active' returning proof_id, amount_cents),
           g as (select proof_id, sum(amount_cents) as amt from rel group by proof_id),
           u as (update app.payment_proofs pr set excess_cents = pr.excess_cents + g.amt from g where pr.id = g.proof_id returning pr.id)
      insert into app.payment_proof_events (center_id, proof_id, kind, body)
        select r.center_id, u.id, 'pledge_cancelled', 'The registration was cancelled, so the pledge it covered was cancelled. The treasury team will decide what to do with the money you sent.' from u;
      select coalesce(sum(amount_cents), 0) into v_released from app.payment_allocations where pledge_id = p.id;
      delete from app.payment_allocations where pledge_id = p.id;
      update app.pledges set status = 'cancelled', closed_at = now(), paid_cents = 0 where id = p.id;
      v_cancelled := true;
      if v_released > 0 then
        insert into app.rsvp_credit_releases (center_id, household_id, rsvp_id, pledge_id, released_cents, created_by)
          values (r.center_id, r.household_id, r.id, p.id, v_released, auth.uid());
      end if;
    end if;
  end if;
  return jsonb_build_object('rsvp_cancelled', true, 'pledge_cancelled', v_cancelled, 'paid_cents', coalesce(p.paid_cents, 0), 'credit_cents', v_released);
end $function$;

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
                         case v_dup_kind when 'proof' then 'Approve that proof with this bank line' else 'Attach this bank line to that payment so the gift is not counted twice' end),
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
end $function$;

CREATE OR REPLACE FUNCTION app.attach_bank_line_to_payment(p_txn uuid, p_payment uuid, p_report uuid DEFAULT NULL::uuid, p_learn_payer boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare t app.bank_transactions; p app.payments; r app.payment_reports;
begin
  select * into t from app.bank_transactions where id = p_txn for update;
  if t.id is null then raise exception 'That bank line was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(t.center_id, 'giving');
  perform app.assert_module_enabled(t.center_id, 'giving_bank');
  if not (app.has_permission(t.center_id, 'giving.record_offline') or app.has_permission(t.center_id, 'giving.manage')) then
    raise exception 'Attaching a bank line to a payment needs giving.record_offline or giving.manage.' using errcode = '42501';
  end if;
  if t.status = 'matched' then raise exception 'That bank line is already matched.' using errcode = '22023'; end if;
  if t.status not in ('unmatched','suggested') then
    raise exception 'Only an unmatched bank line can be attached to a payment.' using errcode = '22023';
  end if;
  if t.is_batch_deposit then
    raise exception 'This is a deposit of several checks — match it to the recorded payments instead.' using errcode = '22023';
  end if;
  if t.amount_cents <= 0 then raise exception 'Only incoming money can be attached to a payment.' using errcode = '22023'; end if;
  select * into p from app.payments where id = p_payment for update;
  if p.id is null or p.center_id <> t.center_id then raise exception 'That payment was not found.' using errcode = '22023'; end if;
  if coalesce(p.provider, '') <> 'offline' then
    raise exception 'Only a payment recorded by hand can be attached to a bank line.' using errcode = '22023';
  end if;
  if p.method not in ('zelle','ach','check','stock','daf','matching_gift','other') then
    raise exception 'Cash is matched in a deposit or an offering count. Any other payment recorded by hand can be attached to its bank line.'
      using errcode = '22023';
  end if;
  if p.status not in ('captured','pending_clearing','settled') then
    raise exception 'That payment is % and cannot be attached to a bank line.', replace(p.status::text, '_', ' ') using errcode = '22023';
  end if;
  if p.amount_cents <> t.amount_cents then
    raise exception 'The payment is % but the bank line is %; they must be the same.',
      to_char(p.amount_cents / 100.0, 'FM$999,999,990.00'), to_char(t.amount_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  if p.deposit_bank_transaction_id is not null then
    raise exception 'That payment is already attached to a bank line.' using errcode = '22023';
  end if;
  if p_report is not null then
    select * into r from app.payment_reports where id = p_report for update;
    if r.id is null or r.center_id <> t.center_id then raise exception 'That Zelle report was not found.' using errcode = '22023'; end if;
    if r.household_id <> p.household_id then raise exception 'That Zelle report is from another family.' using errcode = '22023'; end if;
    if r.status not in ('reported','unmatched') then
      raise exception 'That Zelle report is already %; attach the line without it.', r.status using errcode = '22023';
    end if;
    if r.amount_cents <> t.amount_cents then
      raise exception 'The report says % but the bank line is %; attach without the report, then reject or withdraw it.',
        to_char(r.amount_cents / 100.0, 'FM$999,999,990.00'), to_char(t.amount_cents / 100.0, 'FM$999,999,990.00') using errcode = '22023';
    end if;
    if exists (select 1 from app.payment_reports o where o.payment_id = p.id and o.id <> r.id) then
      raise exception 'That payment is already linked to another report; attach the line without this one.' using errcode = '22023';
    end if;
  end if;

  perform app.set_audit_default_reason('Bank line attached to the Zelle or ACH payment already recorded by hand (G6)');
  update app.payments set deposit_bank_transaction_id = t.id, status = 'settled' where id = p.id;
  update app.bank_transactions set status = 'matched', matched_household_id = p.household_id, payment_id = p.id,
         matched_by = auth.uid(), matched_at = now()
   where id = t.id;
  if p_learn_payer and t.payer_name is not null and t.originator_kind is null then
    insert into app.external_ids (center_id, household_id, person_id, kind, system, value, label, source, confidence, created_by,
                                  times_matched, last_matched_at)
      values (t.center_id, p.household_id, null, 'bank_payer',
              coalesce((select lower(institution) from app.bank_accounts where id = t.bank_account_id), 'bank'),
              t.payer_name, initcap(coalesce(t.channel, 'bank')) || ' payer name', 'learned', 0.9, auth.uid(), 1, now())
    on conflict (center_id, household_id, system, normalized) where kind = 'bank_payer'
      do update set times_matched = app.external_ids.times_matched + 1, last_matched_at = now(),
                    confidence = least(1, coalesce(app.external_ids.confidence, 0.9) + 0.02);
  end if;
  -- One QuickBooks Deposit (undeposited funds -> bank), as match_deposit does for a check batch. A
  -- payment that never posted (history, or before the QuickBooks go-live date) has nothing to deposit.
  if app.payment_posts_to_qbo(p.id) then
    insert into app.ledger_postings (center_id, idempotency_key, source_table, source_id, txn_type, amount_cents, period_month, triggered_by)
    values (t.center_id, 'deposit:' || t.id, 'bank_transactions', t.id, 'payout_deposit', t.amount_cents,
            date_trunc('month', t.posted_on)::date, auth.uid())
    on conflict (center_id, idempotency_key) do nothing;
  end if;
  if r.id is not null then
    update app.payment_reports set status = 'matched', bank_transaction_id = t.id, payment_id = p.id,
           matched_by = auth.uid(), matched_at = now()
     where id = r.id;
  end if;
  -- A report linked to this payment earlier (link_payment_report) now learns its bank line.
  update app.payment_reports set bank_transaction_id = t.id
   where payment_id = p.id and status = 'matched' and bank_transaction_id is null
     and not exists (select 1 from app.payment_reports o where o.bank_transaction_id = t.id);
  return p.id;
end $function$;


-- Unbanked money of a family that a bank line may duplicate: payments recorded by hand with no bank line yet, and proofs still waiting.
create or replace function app.unbanked_lookalikes(p_household uuid, p_amount_cents bigint, p_on date)
returns table (kind text, id uuid, label text, on_date date)
language sql stable security definer set search_path = app, public, extensions as $$
  select 'payment', p.id, 'a payment' || coalesce(' (receipt ' || p.receipt_number || ')', '') || ' from ' || to_char(p.received_on, 'FMMonth FMDD'), p.received_on
    from app.payments p
   where p.household_id = p_household and p.amount_cents = p_amount_cents and p.provider = 'offline'
     and p.deposit_bank_transaction_id is null and p.status in ('captured','pending_clearing')
     and p.received_on between p_on - 45 and p_on + 3
  union all
  select 'proof', q.id, 'a payment proof sent ' || to_char(q.created_at, 'FMMonth FMDD'), q.paid_on
    from app.payment_proofs q
   where q.household_id = p_household and q.amount_cents = p_amount_cents and q.status in ('submitted','needs_info')
     and q.paid_on between p_on - 45 and p_on + 3
$$;
revoke all on function app.unbanked_lookalikes(uuid, bigint, date) from public, anon, authenticated;

-- A pledge with a proof waiting cannot be written off or cancelled behind the proof's back.
create or replace function app._pledge_soft_guard() returns trigger language plpgsql
set search_path = app, public, extensions as $$
begin
  if new.status in ('written_off','cancelled') and old.status is distinct from new.status then
    raise exception 'A payment proof is waiting on this pledge. Verify or reject the proof first.' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists pledges_soft_guard on app.pledges;
create trigger pledges_soft_guard before update of status on app.pledges
  for each row when (old.soft_credit_cents > 0 or old.status::text = 'soft_credit') execute function app._pledge_soft_guard();
