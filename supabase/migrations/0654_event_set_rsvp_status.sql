-- 0654: a staff member's change to an RSVP is one step, not two (docs/ADMIN_REDESIGN.md "Make multi-step writes all-or-nothing":
-- "staff RSVP edits can half finish").
--
-- The Events screen's RSVP buttons (and the command events.set_rsvp_status behind them, which Niva and the palette use too) changed an
-- RSVP's status in one statement and then, in a second statement, the status of the people on it who had not arrived. If the second
-- failed the family's RSVP said one thing and its people another. app.event_set_rsvp_status does both in the same transaction: either
-- both change or neither does.
--
-- It is SECURITY INVOKER: the same row-level security as the two statements it replaces (event staff and this event's lead can update
-- rsvps and attendees; nobody else can), and the same audit rows, written as the signed-in person. It returns false when the caller
-- cannot change that RSVP (no row matched), so the screen says "you can't change this RSVP" as it always did. confirmed_at and
-- cancelled_at are stamped as before; people who have already been checked in keep their status.
set client_min_messages = warning;

create or replace function app.event_set_rsvp_status(p_event uuid, p_rsvp uuid, p_status app.rsvp_status) returns boolean
language plpgsql security invoker set search_path = app, public, extensions as $$
declare
  v_now timestamptz := now();
  v_rows integer;
begin
  update app.rsvps
     set status = p_status,
         confirmed_at = case when p_status = 'confirmed' then v_now else confirmed_at end,
         cancelled_at = case when p_status = 'cancelled' then v_now else cancelled_at end
   where id = p_rsvp and event_id = p_event;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;
  -- Keep people who have not arrived in step with their household's RSVP.
  update app.attendees set status = p_status where rsvp_id = p_rsvp and checked_in_at is null;
  return true;
end $$;

comment on function app.event_set_rsvp_status(uuid, uuid, app.rsvp_status) is
  '0654: change an RSVP''s status and the status of the people on it who have not arrived, in one transaction. Security invoker; false when the caller may not change that RSVP.';

revoke execute on function app.event_set_rsvp_status(uuid, uuid, app.rsvp_status) from public, anon;
grant execute on function app.event_set_rsvp_status(uuid, uuid, app.rsvp_status) to authenticated, service_role;
