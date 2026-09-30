-- 0543: cancelling an RSVP whose pledge was (partly) paid. No refund (owner decision 2026-09-30: Community
-- Connect does not refund to cards from the member app); the money stays with the organization as CREDIT on the
-- household's account, and the treasurer decides what to do with it.
--
--   Credit is not a new balance: it is the part of a payment that no pledge holds (payment amount, less what
--   was refunded, less its allocations). Cancelling a paid pledge releases its allocations, so that part
--   becomes credit; nothing is deleted from payments.
--   app.household_credit(household)        what the household has in credit
--   app.cancel_my_rsvp (replaced)          cancelling the pledge also releases what was paid toward it
--   app.rsvp_credit_releases               one row per release, waiting for the TREASURER (owner decision 2026-09-30:
--                                          credit is never applied to pledges automatically; it is a Home task
--                                          for giving.manage, who applies it with the existing tools)
--   app.resolve_rsvp_credit(id, note)      the treasurer marks a release handled
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

create table if not exists app.rsvp_credit_releases (
  id            uuid primary key default gen_random_uuid(),
  center_id     uuid not null references app.centers(id) on delete cascade,
  household_id  uuid not null references app.households(id),
  rsvp_id       uuid not null references app.rsvps(id),
  pledge_id     uuid not null references app.pledges(id),
  released_cents bigint not null check (released_cents > 0),
  status        text not null default 'pending' check (status in ('pending', 'handled')),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  handled_by    uuid references auth.users(id),
  handled_at    timestamptz,
  handled_note  text
);
create index if not exists rsvp_credit_releases_pending_idx on app.rsvp_credit_releases (center_id) where status = 'pending';
insert into app.module_tables (table_name, module_key) values ('rsvp_credit_releases', 'giving') on conflict (table_name) do update set module_key = excluded.module_key;
drop trigger if exists audit_rsvp_credit_releases on app.rsvp_credit_releases;
create trigger audit_rsvp_credit_releases after insert or update or delete on app.rsvp_credit_releases for each row execute function app.audit_row();
alter table app.rsvp_credit_releases enable row level security;
drop policy if exists rsvp_credit_releases_read on app.rsvp_credit_releases;
create policy rsvp_credit_releases_read on app.rsvp_credit_releases for select to authenticated
  using (app.has_permission(center_id, 'giving.view') or app.has_permission(center_id, 'giving.manage') or app.has_permission(center_id, 'giving.approve'));
drop policy if exists module_switch on app.rsvp_credit_releases;
create policy module_switch on app.rsvp_credit_releases as restrictive for all to public
  using ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])))
  with check ((select app.is_platform_admin()) or center_id is null or not (center_id = any ((select app.module_off_centers('giving'))::uuid[])));
revoke all on app.rsvp_credit_releases from public, anon, authenticated, connect_worker;
grant select on app.rsvp_credit_releases to authenticated;
grant all on app.rsvp_credit_releases to service_role;

drop function if exists app.cancel_my_rsvp(uuid, boolean);
create or replace function app.cancel_my_rsvp(p_rsvp uuid, p_cancel_pledge boolean default false, p_release_credit boolean default false)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
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
    if p_cancel_pledge and p.status in ('open', 'partially_paid', 'paid') and (p.paid_cents = 0 or p_release_credit) then
      -- Money already paid moves to credit ONLY when the member asked for that; otherwise the pledge (and its payment) stay.
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
end $$;
grant execute on function app.cancel_my_rsvp(uuid, boolean, boolean) to authenticated;

create or replace function app.resolve_rsvp_credit(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.rsvp_credit_releases;
begin
  select * into c from app.rsvp_credit_releases where id = p_id for update;
  if c.id is null then raise exception 'That credit was not found.' using errcode = '22023'; end if;
  perform app.assert_module_enabled(c.center_id, 'giving');
  if not app.has_permission(c.center_id, 'giving.manage') then raise exception 'Handling credit needs giving.manage.' using errcode = '42501'; end if;
  if c.status = 'handled' then return; end if;
  perform app.set_audit_context('Treasurer handled the credit released by a cancelled RSVP pledge');
  update app.rsvp_credit_releases set status = 'handled', handled_by = auth.uid(), handled_at = now(), handled_note = nullif(trim(p_note), '') where id = c.id;
end $$;
grant execute on function app.resolve_rsvp_credit(uuid, text) to authenticated;
