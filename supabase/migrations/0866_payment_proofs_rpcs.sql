-- 0866 · Payment proofs, step 3 of 4: the functions (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §4).
--
--   member (an adult of the family)       submit_payment_proof · withdraw_payment_proof · answer_proof_question · my_payment_proofs
--   treasury team (giving.record_offline  payment_proof_queue · payment_proof_counts · approve_payment_proof · reject_payment_proof
--   or giving.manage)                     ask_proof_question · proof_lookalikes
--   anyone who may see the pledge         pledge_evidence (the proofs connected to a pledge, in any status and year)
--   admin (settings.manage)               set_proof_policy
--
-- A proof credits nobody: submit writes soft credits only (no payment, allocation, receipt, QuickBooks row, total). Approve records
-- the payment exactly once (idempotency key 'proof:<id>') and allocates it to the same pledges in the same order. Nobody verifies a
-- proof from their own household; above an organization-set amount a second person with giving.approve must also approve.
set client_min_messages = warning;

-- ── Notices ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('proof_approved', 'push', 'Your payment was checked', 'Your {{amount}} payment ({{method}}) is recorded and your pledges are paid. Receipt {{receipt}}.'),
  ('proof_approved', 'email', 'Your payment to {{center_name}} was checked', E'Your {{amount}} payment ({{method}}) is recorded and your pledges are paid. Receipt {{receipt}}.\n\nYou can open your proof from the pledge in the app.'),
  ('proof_rejected', 'push', 'Your payment proof was not accepted', 'The treasury team could not accept your {{amount}} proof: {{reason}} Your pledges are open again. You can send a new proof.'),
  ('proof_rejected', 'email', 'Your payment proof to {{center_name}} was not accepted', E'The treasury team could not accept your {{amount}} proof: {{reason}}\n\nYour pledges are open again. You can send a new proof in the app.'),
  ('proof_question', 'push', 'The treasury team has a question', 'About your {{amount}} proof: {{question}}'),
  ('proof_question', 'email', 'A question about your payment proof to {{center_name}}', E'About your {{amount}} proof: {{question}}\n\nYour pledges stay as Soft credit while you answer, in the app.')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

create or replace function app._proof_notice(p_proof uuid, p_template text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare pr app.payment_proofs; v_vars jsonb; v_email text; ch text; v_queued int := 0; v_failed int := 0; v_receipt text;
begin
  select * into pr from app.payment_proofs where id = p_proof;
  if pr.id is null or pr.submitted_by is null then return jsonb_build_object('queued', 0, 'failed', 0); end if;
  if to_regprocedure('app.enqueue_message(uuid,text,text,text,jsonb,text)') is null then
    return jsonb_build_object('queued', 0, 'failed', 1);
  end if;
  select receipt_number into v_receipt from app.payments where id = pr.payment_id;
  v_vars := jsonb_build_object('amount', to_char(coalesce(pr.approved_amount_cents, pr.amount_cents) / 100.0, 'FM$999,999,990.00'),
                               'method', replace(pr.method::text, '_', ' '), 'reason', coalesce(p_reason, pr.decision_reason, ''),
                               'question', coalesce(pr.question, ''), 'receipt', coalesce(v_receipt, ''),
                               'person_id', coalesce(pr.submitted_by_person::text, ''));
  select nullif(btrim(p.email::text), '') into v_email from app.people p where p.id = pr.submitted_by_person;
  foreach ch in array array['push','email'] loop
    continue when ch = 'email' and v_email is null;
    begin
      perform app.enqueue_message(pr.center_id, ch, case ch when 'push' then pr.submitted_by::text else v_email end,
                                  p_template, v_vars, 'notification');
      v_queued := v_queued + 1;
    exception when others then v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('queued', v_queued, 'failed', v_failed);
end $$;

-- ── Readers: one proof as JSON ───────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app._proof_json(p_proof uuid, p_staff boolean default false) returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'id', pr.id, 'center_id', pr.center_id, 'household_id', pr.household_id, 'status', pr.status, 'entry', pr.entry,
    'method', pr.method, 'amount_cents', pr.amount_cents, 'paid_on', pr.paid_on, 'reference', pr.reference, 'note', pr.note,
    'created_at', pr.created_at, 'question', pr.question, 'decision_reason', pr.decision_reason, 'excess_cents', pr.excess_cents,
    'approved_amount_cents', pr.approved_amount_cents, 'payment_id', pr.payment_id, 'is_test', pr.is_test,
    'covered', coalesce((select jsonb_agg(jsonb_build_object('pledge_id', sc.pledge_id, 'pledge_number', pl.pledge_number,
                           'title', coalesce(pl.dedication, (select c.name from app.campaigns c where c.id = pl.campaign_id), initcap(replace(pl.source::text, '_', ' '))),
                           'amount_cents', sc.amount_cents, 'pledge_amount_cents', pl.amount_cents, 'state', sc.state) order by sc.position)
                          from app.soft_credits sc join app.pledges pl on pl.id = sc.pledge_id where sc.proof_id = pr.id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'storage_path', f.storage_path, 'content_type', f.content_type,
                           'bytes', f.bytes, 'removed', f.deleted_at is not null, 'created_at', f.created_at) order by f.created_at)
                         from app.payment_proof_files f where f.proof_id = pr.id and (p_staff or f.member_visible)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'body', e.body, 'created_at', e.created_at) order by e.created_at)
                          from app.payment_proof_events e where e.proof_id = pr.id), '[]'::jsonb))
  from app.payment_proofs pr where pr.id = p_proof
$$;
revoke all on function app._proof_json(uuid, boolean), app._proof_notice(uuid, text, text) from public, anon, authenticated;

create or replace function app._proof_event(p_proof uuid, p_kind text, p_body text) returns void
language sql security definer set search_path = app, public, extensions as $$
  insert into app.payment_proof_events (center_id, proof_id, kind, body, actor)
  select center_id, id, p_kind, p_body, auth.uid() from app.payment_proofs where id = p_proof
$$;
revoke all on function app._proof_event(uuid, text, text) from public, anon, authenticated;

create or replace function app._proof_staff(p_center uuid) returns boolean language sql stable security definer
set search_path = app, public, extensions as $$
  select app.has_permission(p_center, 'giving.record_offline') or app.has_permission(p_center, 'giving.manage')
$$;
revoke all on function app._proof_staff(uuid) from public, anon;
grant execute on function app._proof_staff(uuid) to authenticated, service_role;

-- ── Lookalikes: money of this family that a proof (or a bank line) may duplicate ─────────────────────────────────────────────
-- certain = same method and the same check number / reference; likely = same family, amount and about the same week.
create or replace function app.proof_lookalikes(p_household uuid, p_amount_cents bigint, p_method text, p_paid_on date,
                                                p_reference text, p_exclude uuid default null) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
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
               'label', 'A proof sent ' || to_char(q.created_at, 'Mon FMDD') || ' (' || replace(q.method::text, '_', ' ') || ')',
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
end $$;
revoke all on function app.proof_lookalikes(uuid, bigint, text, date, text, uuid) from public, anon;
grant execute on function app.proof_lookalikes(uuid, bigint, text, date, text, uuid) to authenticated, service_role;

-- ── Member: send a proof ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- p_files: [{"path","content_type","bytes","sha256"}], already uploaded to payment-evidence as <center>/<household>/<proof id>/<name>.
-- Credits the family's open pledges oldest first (or only p_pledge_ids), each up to what is still uncovered. Entries tied to one
-- pledge (rsvp, store, opportunity, labh, pathshala_fee, membership) take exactly that pledge's remainder.
create or replace function app.submit_payment_proof(
  p_center uuid, p_household uuid, p_method text, p_amount_cents bigint, p_paid_on date,
  p_reference text default null, p_note text default null, p_pledge_ids uuid[] default null,
  p_entry text default 'open_pledges', p_entry_ref uuid default null, p_files jsonb default '[]'::jsonb, p_key text default null)
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_me uuid := auth.uid(); v_pol jsonb; v_today date; v_id uuid; v_existing app.payment_proofs; v_remaining bigint; r record; v_take bigint;
  v_pos int := 0; v_n int; f jsonb; v_seg text; v_tz text; v_need boolean; v_first text;
begin
  if v_me is null then raise exception 'Sign in to send a payment proof.' using errcode = '42501'; end if;
  perform app.assert_module_enabled(p_center, 'giving');
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not exists (select 1 from app.households where id = p_household and center_id = p_center) then
    raise exception 'That family was not found in this community.' using errcode = '22023';
  end if;
  if not app.adult_of_household(p_center, p_household) then
    raise exception 'Only an adult of the family can send a payment proof. Ask a parent to send it.' using errcode = '42501';
  end if;
  perform 1 from app.households where id = p_household for update;   -- two adults, one tap each: one at a time
  if p_key is not null then
    if char_length(p_key) < 8 or char_length(p_key) > 120 then
      raise exception 'The sheet sent a bad confirmation key. Close it and start again.' using errcode = '22023';
    end if;
    select * into v_existing from app.payment_proofs where center_id = p_center and idempotency_key = p_key;
    if found then
      if v_existing.household_id <> p_household or v_existing.amount_cents <> p_amount_cents then
        raise exception 'This confirmation was already used for a different proof. Close the sheet and start again.' using errcode = '23505';
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
    raise exception 'You already have 5 proofs waiting. Wait for the treasury team to check one, or take one back.' using errcode = '22023';
  end if;
  if p_entry not in ('open_pledges','rsvp','store','opportunity','labh','pathshala_fee','membership','other') then
    raise exception 'Unknown place to send a proof from.' using errcode = '22023';
  end if;
  if p_entry in ('rsvp','store','opportunity','labh','pathshala_fee','membership') and coalesce(array_length(p_pledge_ids, 1), 0) <> 1 then
    raise exception 'A proof sent from checkout covers that order''s pledge only.' using errcode = '22023';
  end if;

  v_pol := app.proof_policy(p_center);
  v_n := coalesce(jsonb_array_length(p_files), 0);
  if v_n > 5 then raise exception 'You can add up to 5 files.' using errcode = '22023'; end if;
  v_need := v_pol -> 'required_methods' ? p_method;
  if v_n = 0 and v_need then raise exception 'Add a photo or file of your receipt. A proof is needed for this way of paying.' using errcode = '22023'; end if;
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
    raise exception 'This proof was already sent. Close the sheet and look under My payment proofs.' using errcode = '23505';
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
end $$;

create or replace function app.withdraw_payment_proof(p_proof uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare pr app.payment_proofs;
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That proof was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app.adult_of_household(pr.center_id, pr.household_id) then
    raise exception 'Only an adult of the family can take a proof back.' using errcode = '42501';
  end if;
  if pr.status not in ('submitted','needs_info') then
    raise exception 'This proof was already checked, so it cannot be taken back.' using errcode = '22023';
  end if;
  update app.soft_credits set state = 'released' where proof_id = pr.id and state = 'active';
  update app.payment_proofs set status = 'withdrawn', decided_at = now() where id = pr.id;
  perform app._proof_event(pr.id, 'withdrawn', 'Taken back. Your pledges are open again.');
  return app._proof_json(pr.id);
end $$;

create or replace function app.answer_proof_question(p_proof uuid, p_message text, p_files jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare pr app.payment_proofs; f jsonb; v_have int; v_add int := coalesce(jsonb_array_length(p_files), 0);
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That proof was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app.adult_of_household(pr.center_id, pr.household_id) then
    raise exception 'Only an adult of the family can answer.' using errcode = '42501';
  end if;
  if pr.status <> 'needs_info' then raise exception 'The treasury team is not waiting for an answer on this proof.' using errcode = '22023'; end if;
  select count(*) into v_have from app.payment_proof_files where proof_id = pr.id and deleted_at is null;
  if v_have + v_add > 5 then raise exception 'A proof can have up to 5 files.' using errcode = '22023'; end if;
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
end $$;

create or replace function app.my_payment_proofs(p_center uuid, p_household uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not app.adult_of_household(p_center, p_household) then
    raise exception 'Only an adult of the family can see its payment proofs.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(app._proof_json(x.id) order by x.created_at desc)
                     from (select id, created_at from app.payment_proofs where household_id = p_household and center_id = p_center
                            order by created_at desc limit 100) x), '[]'::jsonb);
end $$;

-- ── Treasury team: the task ──────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.payment_proof_counts(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_wait int := coalesce((app.proof_policy(p_center) ->> 'reply_wait_days')::int, 14);
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not (app._proof_staff(p_center) or app.has_permission(p_center, 'giving.view')) then
    raise exception 'Seeing payment proofs needs giving.view or giving.record_offline.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'waiting', (select count(*) from app.payment_proofs where center_id = p_center and status = 'submitted'),
    'needs_info', (select count(*) from app.payment_proofs where center_id = p_center and status = 'needs_info'),
    'stale', (select count(*) from app.payment_proofs where center_id = p_center and status = 'needs_info' and question_at < now() - make_interval(days => v_wait)),
    'oldest_days', (select coalesce(max(current_date - created_at::date), 0) from app.payment_proofs where center_id = p_center and status = 'submitted'));
end $$;

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

-- ── Treasury team: decide ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.approve_payment_proof(
  p_proof uuid, p_amount_cents bigint default null, p_paid_on date default null, p_method text default null, p_note text default null,
  p_merge_payment uuid default null, p_separate_reason text default null, p_bank_txn uuid default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare pr app.payment_proofs; v_amount bigint; v_date date; v_method app.payment_method; v_pol jsonb; v_limit bigint; v_look jsonb;
        v_ids uuid[]; v_pay uuid; v_receipt text; v_notice jsonb; mp app.payments; v_bank uuid;
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That proof was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving');
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app._proof_staff(pr.center_id) then raise exception 'Verifying a payment proof needs giving.record_offline.' using errcode = '42501'; end if;
  if app.in_my_household(pr.center_id, pr.household_id) then
    raise exception 'You cannot verify a proof from your own household. Another member of the treasury team must.' using errcode = '42501';
  end if;
  if pr.status not in ('submitted','needs_info') then
    raise exception 'This proof was already % by someone else.', pr.status using errcode = '22023';
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
    perform app._proof_event(pr.id, 'merged', 'Checked. Your proof is kept with the payment already recorded' || coalesce(' (receipt ' || mp.receipt_number || ')', '') || '.');
    return jsonb_build_object('state', 'merged', 'payment_id', mp.id, 'proof', app._proof_json(pr.id, true),
                              'notice', app._proof_notice(pr.id, 'proof_approved'));
  end if;

  v_look := app.proof_lookalikes(pr.household_id, v_amount, v_method::text, v_date, pr.reference, pr.id);
  if jsonb_array_length(v_look) > 0 then
    if app.audit_clean_reason(p_separate_reason) is null then
      raise exception using errcode = 'CCDUP',
        message = 'This family already has a lookalike of this payment. Merge the proof into it as evidence, or say why this is a different gift.',
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
            left('Payment proof' || coalesce(' · ' || pr.reference, '') || coalesce(' · ' || nullif(btrim(p_note), ''), ''), 280), 'proof:' || pr.id::text)
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
end $$;

create or replace function app.reject_payment_proof(p_proof uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare pr app.payment_proofs; v_reason text := nullif(btrim(p_reason), '');
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That proof was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app._proof_staff(pr.center_id) then raise exception 'Verifying a payment proof needs giving.record_offline.' using errcode = '42501'; end if;
  if app.in_my_household(pr.center_id, pr.household_id) then
    raise exception 'You cannot verify a proof from your own household. Another member of the treasury team must.' using errcode = '42501';
  end if;
  if pr.status not in ('submitted','needs_info') then raise exception 'This proof was already % by someone else.', pr.status using errcode = '22023'; end if;
  if v_reason is null or char_length(v_reason) < 3 then raise exception 'Say why, in a few words. The family will read it.' using errcode = '22023'; end if;
  update app.soft_credits set state = 'released' where proof_id = pr.id and state = 'active';
  update app.payment_proofs set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_reason = v_reason where id = pr.id;
  perform app._proof_event(pr.id, 'rejected', 'Not accepted: ' || v_reason || ' Your pledges are open again.');
  return jsonb_build_object('state', 'rejected', 'proof', app._proof_json(pr.id, true), 'notice', app._proof_notice(pr.id, 'proof_rejected', v_reason));
end $$;

create or replace function app.ask_proof_question(p_proof uuid, p_question text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare pr app.payment_proofs; v_q text := nullif(btrim(p_question), '');
begin
  select * into pr from app.payment_proofs where id = p_proof for update;
  if pr.id is null then raise exception 'That proof was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(pr.center_id, 'giving_proofs');
  if not app._proof_staff(pr.center_id) then raise exception 'Verifying a payment proof needs giving.record_offline.' using errcode = '42501'; end if;
  if app.in_my_household(pr.center_id, pr.household_id) then
    raise exception 'You cannot verify a proof from your own household. Another member of the treasury team must.' using errcode = '42501';
  end if;
  if pr.status not in ('submitted','needs_info') then raise exception 'This proof was already % by someone else.', pr.status using errcode = '22023'; end if;
  if v_q is null or char_length(v_q) < 3 then raise exception 'Write what you need, in a few words. The family will read it.' using errcode = '22023'; end if;
  update app.payment_proofs set status = 'needs_info', question = v_q, question_at = now() where id = pr.id;
  perform app._proof_event(pr.id, 'question', 'The treasury team asks: ' || v_q);
  return jsonb_build_object('state', 'needs_info', 'proof', app._proof_json(pr.id, true), 'notice', app._proof_notice(pr.id, 'proof_question'));
end $$;

-- ── Evidence connected to a pledge, in any status and year ───────────────────────────────────────────────────────────────────
-- Linked, never copied: through the pledge's soft credits while a proof waits (or was not accepted), and through the payments
-- allocated to it. The family sees only files it sent; staff see everything. kept_until = Dec 31 of the payment year + the years.
create or replace function app.pledge_evidence(p_pledge uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare pl app.pledges; v_staff boolean; v_years int; v_hold boolean;
begin
  select * into pl from app.pledges where id = p_pledge;
  if pl.id is null then raise exception 'That pledge was not found.' using errcode = '22023'; end if;
  v_staff := app._proof_staff(pl.center_id) or app.has_permission(pl.center_id, 'giving.view');
  if not (v_staff or app.adult_of_household(pl.center_id, pl.household_id)) then
    raise exception 'You don''t have access to this area.' using errcode = '42501';
  end if;
  v_years := coalesce((app.proof_policy(pl.center_id) ->> 'retention_years')::int, 7);
  v_hold := coalesce((app.proof_policy(pl.center_id) ->> 'legal_hold')::boolean, false);
  return coalesce((
    select jsonb_agg(x.j order by x.sort_at) from (
      -- a proof that still waits, or was not accepted / taken back
      select pr.created_at as sort_at, jsonb_build_object(
          'kind', 'proof', 'proof_id', pr.id, 'payment_id', null, 'state', case pr.status when 'submitted' then 'waiting' when 'needs_info' then 'needs_info' else pr.status end,
          'covered_cents', sc.amount_cents, 'method', pr.method, 'paid_on', pr.paid_on, 'reference', pr.reference, 'reason', pr.decision_reason,
          'sent_on', pr.created_at,
          'kept_until', case when v_hold then null when pr.status in ('rejected','withdrawn') then (pr.decided_at + interval '13 months')::date
                             else make_date(extract(year from pr.paid_on)::int + v_years, 12, 31) end,
          'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'storage_path', f.storage_path, 'content_type', f.content_type,
                       'bytes', f.bytes, 'removed', f.deleted_at is not null, 'removed_on', f.deleted_at, 'removed_reason', f.deleted_reason) order by f.created_at)
                       from app.payment_proof_files f where f.proof_id = pr.id and (v_staff or f.member_visible)), '[]'::jsonb)) as j
        from app.soft_credits sc join app.payment_proofs pr on pr.id = sc.proof_id
       where sc.pledge_id = p_pledge and sc.state in ('active', 'released') and pr.status in ('submitted','needs_info','rejected','withdrawn')
         and (pr.status <> 'withdrawn' or exists (select 1 from app.payment_proof_files f where f.proof_id = pr.id and (v_staff or f.member_visible)))
      union all
      -- the payments that credited it, with the proof (or staff files) attached to the payment
      select p.received_on::timestamptz, jsonb_build_object(
          'kind', 'payment', 'proof_id', (select pp.id from app.payment_proofs pp where pp.payment_id = p.id or (pp.status = 'merged' and pp.payment_id = p.id) limit 1),
          'payment_id', p.id, 'state', case when p.reconciled_at is not null then 'reconciled' else 'paid' end,
          'covered_cents', a.amount_cents, 'method', p.method, 'paid_on', p.received_on, 'reference', p.check_number, 'receipt_number', p.receipt_number,
          'kept_until', case when v_hold then null else make_date(extract(year from p.received_on)::int + v_years, 12, 31) end,
          'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'storage_path', f.storage_path, 'content_type', f.content_type,
                       'bytes', f.bytes, 'removed', f.deleted_at is not null, 'removed_on', f.deleted_at, 'removed_reason', f.deleted_reason) order by f.created_at)
                       from app.payment_proof_files f where f.payment_id = p.id and (v_staff or f.member_visible)), '[]'::jsonb))
        from app.payment_allocations a join app.payments p on p.id = a.payment_id
       where a.pledge_id = p_pledge and p.status not in ('failed','voided')
         and exists (select 1 from app.payment_proof_files f where f.payment_id = p.id and (v_staff or f.member_visible))
    ) x), '[]'::jsonb);
end $$;

-- ── The organization's rules ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app.set_proof_policy(p_center uuid, p_policy jsonb, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_old jsonb := app.proof_policy(p_center); v_new jsonb; k text;
        v_allowed text[] := array['required_methods','retention_years','legal_hold','second_approver_over_cents','reply_wait_days','honour_event_entry','release_store_orders','windows'];
begin
  perform app.assert_module_enabled(p_center, 'giving_proofs');
  if not app.has_permission(p_center, 'settings.manage') then raise exception 'Changing the proof rules needs settings.manage.' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(p_policy) loop
    if not (k = any(v_allowed)) then raise exception 'Unknown setting: %.', k using errcode = '22023'; end if;
  end loop;
  v_new := v_old || p_policy;
  if (v_new ->> 'retention_years')::int not between 3 and 25 then raise exception 'Keep proofs for 3 to 25 years.' using errcode = '22023'; end if;
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
    raise exception 'The list of methods that need a proof is not valid.' using errcode = '22023';
  end if;
  if (v_new ->> 'retention_years')::int < (v_old ->> 'retention_years')::int then
    if app.audit_clean_reason(p_reason) is null then raise exception 'Say why you are shortening the years.' using errcode = '22023'; end if;
    perform app.assert_step_up('payment_proofs_retention');
  end if;
  perform app.set_audit_context(coalesce(p_reason, 'Payment proof rules changed'));
  update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}',
         coalesce(rules -> 'payments', '{}'::jsonb) || jsonb_build_object('proofs', v_new)) where id = p_center;
  return v_new;
end $$;

-- Grants: signed-in callers only; each function checks who they are.
do $$ declare fn text;
begin
  foreach fn in array array[
    'submit_payment_proof(uuid,uuid,text,bigint,date,text,text,uuid[],text,uuid,jsonb,text)', 'withdraw_payment_proof(uuid)',
    'answer_proof_question(uuid,text,jsonb)', 'my_payment_proofs(uuid,uuid)', 'payment_proof_counts(uuid)', 'payment_proof_queue(uuid)',
    'approve_payment_proof(uuid,bigint,date,text,text,uuid,text,uuid)', 'reject_payment_proof(uuid,text)', 'ask_proof_question(uuid,text)',
    'pledge_evidence(uuid)', 'set_proof_policy(uuid,jsonb,text)'] loop
    execute format('revoke all on function app.%s from public, anon', fn);
    execute format('grant execute on function app.%s to authenticated, service_role', fn);
  end loop;
end $$;
