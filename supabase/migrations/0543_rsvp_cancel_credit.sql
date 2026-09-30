-- 0543: cancelling an RSVP whose pledge was (partly) paid. No refund (owner decision 2026-09-30: Community
-- Connect does not refund to cards from the member app); the money stays with the organization as CREDIT on the
-- household's account, and the family may apply it to its other open pledges.
--
--   Credit is not a new balance: it is the part of a payment that no pledge holds (payment amount, less what
--   was refunded, less its allocations). Cancelling a paid pledge releases its allocations, so that part
--   becomes credit; nothing is deleted from payments.
--   app.household_credit(household)        what the household has in credit
--   app.cancel_my_rsvp (replaced)          cancelling the pledge also releases what was paid toward it
--   app.apply_my_credit(household, pledges) the family chooses open pledges of its own to apply credit to
set client_min_messages = warning;

create or replace function app.household_credit(p_household uuid) returns bigint
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_credit bigint;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then return 0; end if;
  if not app.adult_of_household(v_center, p_household) then raise exception 'only an adult of the household can see its credit'; end if;
  select coalesce(sum(greatest(p.amount_cents - p.refunded_cents - coalesce(a.alloc, 0), 0)), 0) into v_credit
    from app.payments p
    left join lateral (select sum(amount_cents) as alloc from app.payment_allocations where payment_id = p.id) a on true
   where p.household_id = p_household and p.status in ('captured', 'settled', 'pending_clearing', 'partially_refunded');
  return v_credit;
end $$;
grant execute on function app.household_credit(uuid) to authenticated;

create or replace function app.cancel_my_rsvp(p_rsvp uuid, p_cancel_pledge boolean default false)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.rsvps; p app.pledges; v_cancelled boolean := false; v_released bigint := 0;
begin
  select * into r from app.rsvps where id = p_rsvp for update;
  if r.id is null then raise exception 'RSVP not found'; end if;
  perform app.assert_module_enabled(r.center_id, 'events');
  if not app.adult_of_household(r.center_id, r.household_id) then raise exception 'only an adult of the household can cancel'; end if;
  if r.status = 'cancelled' then return jsonb_build_object('rsvp_cancelled', true, 'pledge_cancelled', false, 'paid_cents', 0, 'credit_cents', 0); end if;
  perform app.set_audit_context(case when p_cancel_pledge then 'Member cancelled the RSVP and its donation commitment in the app; money paid stays as credit'
                                     else 'Member cancelled the RSVP in the app and kept the donation commitment' end);
  update app.rsvps set status = 'cancelled', cancelled_at = now() where id = r.id;
  update app.attendees set status = 'cancelled', ticket_revoked = true where rsvp_id = r.id and checked_in_at is null;
  if r.commitment_pledge_id is not null then
    select * into p from app.pledges where id = r.commitment_pledge_id for update;
    if p_cancel_pledge and p.status in ('open', 'partially_paid', 'paid') then
      select coalesce(sum(amount_cents), 0) into v_released from app.payment_allocations where pledge_id = p.id;
      delete from app.payment_allocations where pledge_id = p.id;
      update app.pledges set status = 'cancelled', closed_at = now(), paid_cents = 0 where id = p.id;
      v_cancelled := true;
    end if;
  end if;
  return jsonb_build_object('rsvp_cancelled', true, 'pledge_cancelled', v_cancelled, 'paid_cents', coalesce(p.paid_cents, 0), 'credit_cents', v_released);
end $$;
grant execute on function app.cancel_my_rsvp(uuid, boolean) to authenticated;

create or replace function app.apply_my_credit(p_household uuid, p_pledge_ids uuid[]) returns bigint
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_center uuid; v_before bigint; v_after bigint; pay record;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then raise exception 'household not found'; end if;
  perform app.assert_module_enabled(v_center, 'giving');
  if not app.adult_of_household(v_center, p_household) then raise exception 'only an adult of the household can apply its credit'; end if;
  if coalesce(array_length(p_pledge_ids, 1), 0) = 0 then raise exception 'choose the pledges to apply the credit to'; end if;
  if exists (select 1 from unnest(p_pledge_ids) as u(pid) where not exists (
       select 1 from app.pledges x where x.id = u.pid and x.household_id = p_household and x.center_id = v_center and x.status in ('open', 'partially_paid'))) then
    raise exception 'only open pledges of your own household can receive credit';
  end if;
  v_before := app.household_credit(p_household);
  perform app.set_audit_context('Member applied account credit to open pledges in the app');
  for pay in
    select p.id from app.payments p
     where p.household_id = p_household and p.status in ('captured', 'settled', 'pending_clearing', 'partially_refunded')
       and p.amount_cents - p.refunded_cents > coalesce((select sum(amount_cents) from app.payment_allocations where payment_id = p.id), 0)
     order by p.received_on, p.created_at
  loop
    perform app.allocate_payment(pay.id, p_pledge_ids, true);
  end loop;
  v_after := app.household_credit(p_household);
  return v_before - v_after;
end $$;
grant execute on function app.apply_my_credit(uuid, uuid[]) to authenticated;
