-- Wave E · stream e-money · 4 of 5: pledge history import rules (owner decision
-- 2026-09-25 #24).
--
--   Opening balances. When a pledge was paid partly before the payment history
--   being imported begins, what was paid before it comes in as ONE historical
--   opening-balance line per pledge: a payment marked is_historical (never posted
--   to QuickBooks) and is_opening_balance, allocated to the pledge. It is created
--   after the payment history is imported (Settings › Import › the pledges import ›
--   "Bring in opening balances"): for each pledge of the run, the file's
--   "paid so far" minus what the imported payments already applied to it. Its
--   date is the day before the pledge's earliest imported payment (else the
--   pledge date). Running it again adds nothing; undoing the pledges import
--   removes the lines with it.
--
--   Written-off pledges import as written off: status written_off, closed (the
--   file's closed / written-off date, else the day of the import) and unpaid (the
--   written-off balance is never counted as paid), with who wrote it off
--   (pledges.written_off_by_name, a name from the old system — not a login) and
--   why (write_off_reason) when the file has them. It is history: an insert, so
--   the two-person rule (which guards changing a pledge to written off) and the
--   QuickBooks write-off posting (0412) do not apply. An import can never write
--   off a pledge that already exists open in Community Connect: that stays a
--   two-person write-off on the Pledges screen.
set client_min_messages = warning;

alter table app.payments add column if not exists is_opening_balance boolean not null default false;
comment on column app.payments.is_opening_balance is
  'An imported opening-balance line: what was paid on a pledge before the imported payment history begins (owner decision 2026-09-25 #24). Always historical.';
alter table app.payments drop constraint if exists payments_opening_balance_historical;
alter table app.payments add constraint payments_opening_balance_historical check (not is_opening_balance or is_historical);

alter table app.pledges add column if not exists written_off_by_name text;
alter table app.pledges drop constraint if exists pledges_written_off_by_name_len;
alter table app.pledges add constraint pledges_written_off_by_name_len
  check (written_off_by_name is null or char_length(written_off_by_name) <= 200);
comment on column app.pledges.written_off_by_name is
  'Who wrote the pledge off in the system it was imported from (a name, not a login). Written-off pledges imported as history (owner decision 2026-09-25 #24).';

-- The import may write these pledge columns now.
update app.import_entities
   set columns = (select array_agg(distinct c order by c)
                    from unnest(columns || array['write_off_reason','written_off_by_name']) c)
 where key = 'pledges';

-- ── Written-off pledges: prepared before the engine's own row logic ─────────
do $$ begin
  if to_regprocedure('app._import_apply_row_before_0413(app.import_runs,app.import_entities,app.import_rows)') is null then
    alter function app.import_apply_row(app.import_runs, app.import_entities, app.import_rows) rename to _import_apply_row_before_0413;
  end if;
end $$;
create or replace function app.import_apply_row(r app.import_runs, e app.import_entities, x app.import_rows) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_existing app.pledges; v_paid bigint;
begin
  if e.key = 'pledges' then
    if x.data->>'status' = 'written_off' then
      select * into v_existing from app.pledges
       where center_id = r.center_id and x.data ? 'crm_external_id' and crm_external_id = x.data->>'crm_external_id';
      if v_existing.id is null then
        select p.* into v_existing from app.import_keys k join app.pledges p on p.id::text = k.record_id
         where k.center_id = r.center_id and k.entity = 'pledges' and k.source_key = x.source_key;
      end if;
      if v_existing.id is not null and v_existing.status <> 'written_off' then
        raise exception 'Pledge % is already in Community Connect and not written off. An import cannot write it off: write it off on the Pledges screen (two people approve it).',
          coalesce(v_existing.pledge_number, v_existing.crm_external_id);
      end if;
      v_paid := coalesce((x.extra->>'paid_so_far')::bigint, 0);
      if v_paid >= coalesce((x.data->>'amount_cents')::bigint, 0) then
        raise exception 'A pledge that was paid in full cannot be imported as written off.';
      end if;
      if coalesce(x.data->>'closed_at', '') = '' then
        x.data := x.data || jsonb_build_object('closed_at', now());
      end if;
    elsif coalesce(x.data->>'written_off_by_name', '') <> '' or coalesce(x.data->>'write_off_reason', '') <> '' then
      -- Who / why only belong on a written-off pledge.
      x.data := x.data - 'written_off_by_name' - 'write_off_reason';
    end if;
  end if;
  return app._import_apply_row_before_0413(r, e, x);
end $$;

-- ── Opening balances ─────────────────────────────────────────────────────────
-- What a pledges run would bring in: one row per pledge of the run whose file
-- "paid so far" is more than what payments already applied to it.
create or replace function app.import_opening_balance_plan(p_run uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare r app.import_runs;
begin
  r := app.import_assert_run(p_run);
  if r.entity <> 'pledges' then return jsonb_build_object('applies', false, 'rows', '[]'::jsonb); end if;
  return jsonb_build_object('applies', true, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object('row', q.row_no, 'pledge_id', q.id, 'pledge', coalesce(q.crm_external_id, q.pledge_number),
                                        'paid_so_far_cents', q.paid_so_far, 'applied_cents', q.applied, 'opening_cents', q.opening,
                                        'already', q.already) order by q.row_no)
      from (
        select x.row_no, p.id, p.crm_external_id, p.pledge_number, (x.extra->>'paid_so_far')::bigint as paid_so_far,
               coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.pledge_id = p.id), 0)::bigint as applied,
               least((x.extra->>'paid_so_far')::bigint, p.amount_cents)
                 - coalesce((select sum(a.amount_cents) from app.payment_allocations a where a.pledge_id = p.id), 0)::bigint as opening,
               exists (select 1 from app.payment_allocations a join app.payments pa on pa.id = a.payment_id
                        where a.pledge_id = p.id and pa.is_opening_balance) as already
          from app.import_rows x join app.pledges p on p.id::text = x.target_id
         where x.run_id = r.id and x.status in ('created','updated','unchanged') and x.extra ? 'paid_so_far'
           and p.status <> 'cancelled') q
     where q.opening > 0 or q.already), '[]'::jsonb));
end $$;

create or replace function app.import_pledge_opening_balances(p_run uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.import_runs; q record; p app.pledges; v_on date; v_pay text; n_added int := 0; n_already int := 0; v_total bigint := 0;
begin
  r := app.import_assert_run(p_run);
  if r.entity <> 'pledges' then raise exception 'Opening balances come from a pledges import (Import #% is %).', r.run_number, r.entity; end if;
  if r.status not in ('committed','reconciled') then raise exception 'Import #% has not finished importing yet.', r.run_number; end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Say why the opening balances are being brought in; the reason is kept in the audit log.';
  end if;
  perform app.set_audit_context(format('Opening balances · Import #%s · %s — %s', r.run_number, coalesce(r.file_name, r.entity), btrim(p_reason)),
                                r.request_id);
  perform set_config('app.client_app', 'import', true);
  for q in select * from jsonb_to_recordset(app.import_opening_balance_plan(p_run)->'rows')
             as t("row" int, pledge_id uuid, opening_cents bigint, already boolean) loop
    if q.already then n_already := n_already + 1; continue; end if;
    select * into p from app.pledges where id = q.pledge_id for update;
    select min(pa.received_on) - 1 into v_on from app.payment_allocations a join app.payments pa on pa.id = a.payment_id
     where a.pledge_id = p.id;
    v_on := coalesce(v_on, p.pledged_at::date, current_date);
    if p.pledged_at is not null and v_on < p.pledged_at::date then v_on := p.pledged_at::date; end if;
    v_pay := app.import_add(r, q."row", 'payments', jsonb_build_object(
      'center_id', r.center_id, 'household_id', p.household_id, 'payer_person_id', p.pledged_by_person_id,
      'amount_cents', q.opening_cents, 'method', 'other', 'status', 'settled', 'provider', 'offline',
      'is_historical', true, 'is_opening_balance', true, 'received_on', v_on, 'recorded_by', auth.uid(),
      'crm_external_id', left('opening:' || coalesce(p.crm_external_id, p.pledge_number, p.id::text), 200),
      'memo', left(format('Opening balance: paid on pledge %s before the imported payment history (Import #%s)',
                          coalesce(p.crm_external_id, p.pledge_number, ''), r.run_number), 500)));
    perform app.import_add_allocation(r, q."row", jsonb_build_object('center_id', r.center_id, 'payment_id', v_pay, 'pledge_id', p.id,
                                                                     'amount_cents', q.opening_cents));
    n_added := n_added + 1; v_total := v_total + q.opening_cents;
  end loop;
  return jsonb_build_object('added', n_added, 'already', n_already, 'total_cents', v_total);
end $$;

revoke execute on function app._import_apply_row_before_0413(app.import_runs, app.import_entities, app.import_rows),
  app.import_apply_row(app.import_runs, app.import_entities, app.import_rows),
  app.import_opening_balance_plan(uuid), app.import_pledge_opening_balances(uuid, text)
  from public, anon;
revoke execute on function app._import_apply_row_before_0413(app.import_runs, app.import_entities, app.import_rows),
  app.import_apply_row(app.import_runs, app.import_entities, app.import_rows) from authenticated;
grant execute on function app.import_opening_balance_plan(uuid), app.import_pledge_opening_balances(uuid, text) to authenticated, service_role;
