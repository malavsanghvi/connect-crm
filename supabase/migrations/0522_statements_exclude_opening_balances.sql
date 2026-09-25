-- Wave F · stream f-money · 3 of 3: year-end statements leave out
-- opening-balance lines (owner decision 2026-09-25, second batch).
--
-- An opening-balance line (payments.is_opening_balance, 0413) is what the old
-- system says was paid on a pledge before the imported payment history begins.
-- It is not a gift received on its date, so:
--   * app.year_end_statement(household, year) — the one source for a year-end
--     (tax) statement and its tax-deductible total — lists the year's gifts
--     WITHOUT opening-balance lines, and says separately what it left out and
--     why;
--   * an opening-balance line never gets a receipt: receipt_sent_at stays empty
--     (constraint, checked for new and changed rows);
--   * the household's giving history still shows the line, labelled
--     "Opening balance" (portal Payments tab).
-- Money rules are unchanged: allocations, balances and QuickBooks posting
-- (opening balances are historical and never post, 0413) stay as they were.
set client_min_messages = warning;

alter table app.payments drop constraint if exists payments_opening_balance_no_receipt;
alter table app.payments add constraint payments_opening_balance_no_receipt
  check (not is_opening_balance or receipt_sent_at is null) not valid;

-- The statuses whose money counts as given (net of refunds), as the member app counts them.
create or replace function app.statement_counted_status(p_status app.payment_status) returns boolean
language sql immutable set search_path = app, public, extensions as $$
  select p_status in ('captured','pending_clearing','settled','partially_refunded')
$$;

-- Readable by the household's adults (like app.statements) and giving staff.
create or replace function app.year_end_statement(p_household uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_lines jsonb; v_total bigint; v_n int; v_ob_total bigint; v_ob_n int;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then raise exception 'That household was not found.'; end if;
  if not (app.adult_of_household(v_center, p_household)
          or app.has_permission(v_center, 'giving.view') or app.has_permission(v_center, 'giving.manage')) then
    raise exception 'Seeing this household''s year-end statement needs an adult of the household, giving.view or giving.manage.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_year is null or p_year < 1990 or p_year > 2200 then raise exception 'Choose a tax year.'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', p.id, 'receipt_number', p.receipt_number, 'received_on', p.received_on, 'method', p.method,
           'amount_cents', p.amount_cents, 'refunded_cents', p.refunded_cents, 'given_cents', p.amount_cents - p.refunded_cents,
           'receipt_name', p.receipt_name, 'joint_receipt', p.joint_receipt)
         order by p.received_on, p.receipt_number), '[]'::jsonb),
         coalesce(sum(p.amount_cents - p.refunded_cents), 0), count(*)
    into v_lines, v_total, v_n
    from app.payments p
   where p.household_id = p_household and p.center_id = v_center
     and p.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
     and app.statement_counted_status(p.status)
     and not p.is_opening_balance;

  select coalesce(sum(p.amount_cents - p.refunded_cents), 0), count(*) into v_ob_total, v_ob_n
    from app.payments p
   where p.household_id = p_household and p.center_id = v_center
     and p.received_on between make_date(p_year, 1, 1) and make_date(p_year, 12, 31)
     and app.statement_counted_status(p.status)
     and p.is_opening_balance;

  return jsonb_build_object(
    'household_id', p_household, 'tax_year', p_year,
    'lines', v_lines, 'gift_count', v_n, 'total_cents', v_total,
    'left_out', jsonb_build_object(
      'opening_balance_count', v_ob_n, 'opening_balance_cents', v_ob_total,
      'reason', case when v_ob_n > 0 then
        'Opening-balance lines are left out: they record what was paid on a pledge before the imported payment history begins, not gifts received in ' || p_year || '. They still show in the household''s giving history.'
      end));
end $$;

revoke execute on function app.year_end_statement(uuid, int) from public, anon;
grant execute on function app.year_end_statement(uuid, int), app.statement_counted_status(app.payment_status) to authenticated;
