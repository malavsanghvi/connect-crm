-- 0870 · Payment proofs, store checkout: a placed store order gets a pledge, so a family that paid another way has something to send a proof
-- against (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §4.1, scenario A8; owner answer Q8).
--
--   app.store_order_pledge(order)   an adult of the order's family asks for the order's pledge: source 'store', source_ref_id = the order,
--                                   the order's total. The same call again returns the same pledge. It records no payment.
--   a cancelled order cancels its pledge when nothing is paid or soft-credited on it (otherwise the pledge stays for the treasury team).
set client_min_messages = warning;

create or replace function app.store_order_pledge(p_order uuid) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare o app.store_orders; v_pledge uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to send a payment proof.' using errcode = '42501'; end if;
  select * into o from app.store_orders where id = p_order for update;
  if o.id is null then raise exception 'That order was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(o.center_id, 'giving');
  perform app.assert_module_enabled(o.center_id, 'giving_proofs');
  if o.household_id is null or not app.adult_of_household(o.center_id, o.household_id) then
    raise exception 'Only an adult of the family that placed the order can do this.' using errcode = '42501';
  end if;
  if o.status not in ('placed', 'preparing', 'ready') then
    raise exception 'This order is % and cannot take a payment proof.', o.status using errcode = '22023';
  end if;
  if coalesce(o.total_cents, 0) <= 0 then raise exception 'This order has nothing to pay.' using errcode = '22023'; end if;
  select id into v_pledge from app.pledges where center_id = o.center_id and source = 'store' and source_ref_id = o.id and status <> 'cancelled' limit 1;
  if v_pledge is not null then return v_pledge; end if;
  insert into app.pledges (center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, dedication, created_by)
    values (o.center_id, o.household_id, app.my_person_id(o.center_id), 'store', o.id, o.total_cents, 'Store order ' || o.order_number, auth.uid())
    returning id into v_pledge;
  return v_pledge;
end $$;
revoke all on function app.store_order_pledge(uuid) from public, anon;
grant execute on function app.store_order_pledge(uuid) to authenticated, service_role;

create or replace function app._store_order_cancelled() returns trigger language plpgsql security definer
set search_path = app, public, extensions as $$
begin
  update app.pledges set status = 'cancelled', closed_at = now()
   where center_id = new.center_id and source = 'store' and source_ref_id = new.id
     and status in ('open', 'partially_paid') and paid_cents = 0 and soft_credit_cents = 0;
  return null;
end $$;
drop trigger if exists store_orders_cancel_pledge on app.store_orders;
create trigger store_orders_cancel_pledge after update of status on app.store_orders
  for each row when (new.status = 'cancelled' and old.status is distinct from 'cancelled') execute function app._store_order_cancelled();
