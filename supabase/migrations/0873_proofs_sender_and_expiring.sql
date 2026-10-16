-- 0873 · Payment proofs, two small gaps: who sent the proof, and a notice before files are removed
-- (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §4.5, scenarios A36-A38).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   1. Every card in the treasury queue also says who sent the proof ("Sent by Mina Rao"), so the team does not have to open the
--      household to find out which adult submitted it. The name is the submitting person's first and last name; it is empty when the
--      sender is not known (a proof entered by staff, or a person who has since been removed).
--   2. app.proof_files_due_soon(center, days) tells staff how many evidence files become due for removal in the next N days and
--      the first day that happens, so the Home screen and Settings > Storage can say so BEFORE the daily job removes them.
--
-- ONE RULE, NOT TWO: the "is this file due?" rule stays in app._proof_files_due (0871). It gains a fifth parameter, p_ahead_days
-- (default 0 = today, so every 0871 caller behaves exactly as before), which asks the same question as of a later day, and a
-- sixth output column due_on, the first day the file is due. Changing the output columns needs a drop, then the same grants.
--
-- THE LEGAL HOLD: while it is on, nothing is removed. proof_files_due_soon still counts the files (so Settings can say "on hold")
-- and returns legal_hold; the Home task is not shown under a hold.
--
-- ROLLBACK: restore app._proof_files_due and app.payment_proof_queue from 0871 / 0866 and drop app.proof_files_due_soon.
set client_min_messages = warning;

-- ── 1. The rule, as of today or a later day ──────────────────────────────────────────────────────────────────────────────────
drop function if exists app._proof_files_due(uuid, uuid, int, boolean);
create or replace function app._proof_files_due(p_center uuid default null, p_file uuid default null,
                                                p_years int default null, p_ignore_hold boolean default false,
                                                p_ahead_days int default 0)
returns table (file_id uuid, center_id uuid, storage_path text, member_visible boolean, reason text, due_on date)
language sql stable security definer set search_path = app, public, extensions as $$
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
              then case b.proof_status when 'rejected' then 'Proof not accepted: kept 13 months, then removed'
                                       else 'Proof taken back by the family: kept 13 months, then removed' end
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
$$;
revoke all on function app._proof_files_due(uuid, uuid, int, boolean, int) from public, anon, authenticated, service_role;

-- ── 2. The notice before removal ─────────────────────────────────────────────────────────────────────────────────────────────
-- Files that are not due today but become due within p_days (1 to 365, default 30). Staff who record payments or manage giving, and
-- settings.manage. The legal hold is reported, not applied, like the years preview (0871).
create or replace function app.proof_files_due_soon(p_center uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_days int := greatest(1, least(coalesce(p_days, 30), 365)); v_count int; v_soonest date;
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not (app._proof_staff(p_center) or app.has_permission(p_center, 'settings.manage')) then
    raise exception 'Seeing which proofs are about to be removed needs giving.record_offline, giving.manage or settings.manage.'
      using errcode = '42501';
  end if;
  with already as (select d.file_id from app._proof_files_due(p_center, null, null, true, 0) d)
  select count(*), min(n.due_on) into v_count, v_soonest
    from app._proof_files_due(p_center, null, null, true, v_days) n
   where n.file_id not in (select file_id from already);
  return jsonb_build_object('count', v_count, 'soonest_on', v_soonest, 'days', v_days,
                            'legal_hold', coalesce((app.proof_policy(p_center) ->> 'legal_hold')::boolean, false));
end $$;
revoke execute on function app.proof_files_due_soon(uuid, int) from public, anon;
grant execute on function app.proof_files_due_soon(uuid, int) to authenticated;

-- ── 3. The queue card says who sent it ───────────────────────────────────────────────────────────────────────────────────────
-- Body of app.payment_proof_queue exactly as in 0866, plus 'sent_by'.
create or replace function app.payment_proof_queue(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_pol jsonb := app.proof_policy(p_center); v_limit bigint := coalesce((v_pol ->> 'second_approver_over_cents')::bigint, 0);
        v_wait int := coalesce((v_pol ->> 'reply_wait_days')::int, 14);
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not (app._proof_staff(p_center) or app.has_permission(p_center, 'giving.view')) then
    raise exception 'Seeing payment proofs needs giving.view or giving.record_offline.' using errcode = '42501';
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
end $$;
