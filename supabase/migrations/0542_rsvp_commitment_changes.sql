-- 0542: changing an RSVP that already carries a donation commitment.
--
--   app.raise_rsvp_commitment  people were added to an RSVP: the family's existing pledge goes up by the
--                              amount for the added people (per person x added, or a lump sum). A fully
--                              paid pledge reopens as partially paid; nothing already paid changes.
--   app.cancel_my_rsvp         the family cancels the RSVP and says whether the unpaid pledge goes with it.
--                              Only an open pledge with nothing paid is cancelled here. A pledge that has
--                              been paid (in whole or part) is never cancelled by this function: money
--                              already received is handled as a refund by the office (see docs/BACKLOG.md B23).
-- Both are for an adult of the household and leave an audit reason.
set client_min_messages = warning;

create or replace function app.raise_rsvp_commitment(p_rsvp uuid, p_add_cents bigint, p_mode text default 'per_person')
returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.rsvps; p app.pledges;
begin
  select * into r from app.rsvps where id = p_rsvp for update;
  if r.id is null then raise exception 'RSVP not found'; end if;
  perform app.assert_module_enabled(r.center_id, 'events');
  perform app.assert_module_enabled(r.center_id, 'giving');
  if not app.adult_of_household(r.center_id, r.household_id) then raise exception 'only an adult of the household can change the commitment'; end if;
  if r.status = 'cancelled' then raise exception 'this RSVP is cancelled'; end if;
  if coalesce(p_add_cents, 0) <= 0 then raise exception 'enter an amount greater than zero'; end if;
  if r.commitment_pledge_id is null then raise exception 'this RSVP has no donation commitment to add to'; end if;
  select * into p from app.pledges where id = r.commitment_pledge_id for update;
  if p.status in ('cancelled', 'written_off') then raise exception 'the donation commitment for this RSVP is closed'; end if;
  perform app.set_audit_context('Member added people to the RSVP in the app and raised the donation commitment');
  update app.pledges set amount_cents = amount_cents + p_add_cents where id = p.id;
  perform app.recompute_pledge_status(p.id);
  update app.rsvps set commitment_mode = coalesce(nullif(p_mode, ''), commitment_mode) where id = r.id;
  return p.id;
end $$;
grant execute on function app.raise_rsvp_commitment(uuid, bigint, text) to authenticated;

create or replace function app.cancel_my_rsvp(p_rsvp uuid, p_cancel_pledge boolean default false)
returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.rsvps; p app.pledges; v_cancelled boolean := false;
begin
  select * into r from app.rsvps where id = p_rsvp for update;
  if r.id is null then raise exception 'RSVP not found'; end if;
  perform app.assert_module_enabled(r.center_id, 'events');
  if not app.adult_of_household(r.center_id, r.household_id) then raise exception 'only an adult of the household can cancel'; end if;
  if r.status = 'cancelled' then return jsonb_build_object('rsvp_cancelled', true, 'pledge_cancelled', false, 'paid_cents', 0); end if;
  perform app.set_audit_context(case when p_cancel_pledge then 'Member cancelled the RSVP and its donation commitment in the app'
                                     else 'Member cancelled the RSVP in the app and kept the donation commitment' end);
  update app.rsvps set status = 'cancelled', cancelled_at = now() where id = r.id;
  update app.attendees set status = 'cancelled', ticket_revoked = true where rsvp_id = r.id and checked_in_at is null;
  if r.commitment_pledge_id is not null then
    select * into p from app.pledges where id = r.commitment_pledge_id for update;
    if p_cancel_pledge and p.paid_cents = 0 and p.status = 'open' then
      update app.pledges set status = 'cancelled', closed_at = now() where id = p.id;
      v_cancelled := true;
    end if;
  end if;
  return jsonb_build_object('rsvp_cancelled', true, 'pledge_cancelled', v_cancelled, 'paid_cents', coalesce(p.paid_cents, 0));
end $$;
grant execute on function app.cancel_my_rsvp(uuid, boolean) to authenticated;
