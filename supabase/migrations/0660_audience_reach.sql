-- 0660: app.audience_reach, the per-channel numbers behind a message's audience preview (B90 phase 4, Messages).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   The compose form already shows one number, "Recipients" (app.segment_recipient_count, 0025 to 0401): the households that have
--   at least one adult who accepts email. Before a message is scheduled, the person (or Niva, for the person) also needs to know
--   how many ADULTS would be reached by email, by text and by WhatsApp, and how many cannot be reached on any of the three.
--   This function says so. It is the same idea as app.event_reminder_audience (0653), for any audience the compose form builds
--   (all members, life members, zones, Pathshala classes, the RSVPs of an event) instead of one event's RSVPs.
--
--   Counts only: it never returns a name, an address or a phone number. Adults only (decision D2): a child is never counted
--   and a child's opt-in is never read. The latest opt-in of each person and channel wins (an opt-out after an opt-in counts as
--   out), an address must be on file, and a person who withdrew consent for that channel (marketing_email, sms, whatsapp: the
--   latest answer, "yes" when nobody has answered) is left out, as app.segment_recipient_count already does for email.
--
-- WHAT IT DOES NOT DO
--   * It changes nothing: no table, column, policy, grant on a table or permission. STABLE, SECURITY INVOKER (the default):
--     row-level security applies, so it only counts rows the caller may read. A role that may send messages but may not see
--     people (the communications officer) gets { people_visible: false } and nulls, never zeros; the app then shows only the
--     authoritative "Recipients" number from segment_recipient_count and says why the rest is missing. Showing the full
--     breakdown to that role would need a SECURITY DEFINER variant, which is an access decision for the owner and is NOT made here.
--   * Custom-field segments are not resolved here (they read staff-only values); when the audience uses one,
--     custom_fields_not_counted is true and the app says the breakdown leaves that choice out.
--   * Push is not counted (a device is not a consent record); quiet hours are worked out by the app from the community's rules.
--
-- The households are resolved with the same conditions as app.segment_recipient_count (all members = an active membership, a
-- zone, a Pathshala class with a placed, active or waitlisted enrolment, an event with the chosen RSVP statuses, membership tiers).
-- Hosted Supabase: search_path = app, public, extensions.

create or replace function app.audience_reach(p_center uuid, p_audience jsonb) returns jsonb
language plpgsql stable security invoker set search_path = app, public, extensions as $$
declare
  aud jsonb := case when jsonb_typeof(p_audience) = 'object' then p_audience else '{}'::jsonb end;
  v_people_ok boolean;
  v_custom boolean;
  v_households integer := 0;
  v_adults integer := 0;
  v_email integer := 0;
  v_sms integer := 0;
  v_wa integer := 0;
  v_none integer := 0;
begin
  if p_center is null then return null; end if;
  if not app.has_permission(p_center, 'comms.send') then return null; end if;
  v_people_ok := app.has_permission(p_center, 'people.view') or app.has_permission(p_center, 'people.manage');
  v_custom := coalesce(jsonb_typeof(aud->'custom_fields') = 'array' and jsonb_array_length(aud->'custom_fields') > 0, false);

  if not v_people_ok then
    return jsonb_build_object('people_visible', false, 'custom_fields_not_counted', v_custom,
                              'households', null, 'adults', null, 'email', null, 'sms', null, 'whatsapp', null, 'no_channel', null);
  end if;

  with hh as (
    select h.id
      from app.households h
     where h.center_id = p_center and h.merged_into_id is null
       and (
         (coalesce((aud->>'all_members')::boolean, false) and exists (
            select 1 from app.memberships m where m.household_id = h.id and m.status = 'active'))
         or (aud ? 'zone_ids' and h.zone_id::text in (select jsonb_array_elements_text(aud->'zone_ids')))
         or (aud ? 'pathshala_class_ids' and exists (
            select 1 from app.pathshala_enrollments e where e.household_id = h.id and e.status in ('placed', 'active', 'waitlisted')
              and e.class_id::text in (select jsonb_array_elements_text(aud->'pathshala_class_ids'))))
         or (aud ? 'event_id' and exists (
            select 1 from app.rsvps r where r.household_id = h.id and r.event_id = (aud->>'event_id')::uuid
              and (not aud ? 'rsvp_statuses' or r.status::text in (select jsonb_array_elements_text(aud->'rsvp_statuses')))))
         or (aud ? 'membership_tiers' and exists (
            select 1 from app.memberships m where m.household_id = h.id and m.status = 'active'
              and m.tier::text in (select jsonb_array_elements_text(aud->'membership_tiers'))))
       )
  ), adults as (
    select distinct p.id as person_id
      from hh
      join app.household_members hm on hm.household_id = hh.id and hm.left_at is null
      join app.people p on p.id = hm.person_id
     where not p.is_deceased and p.merged_into_id is null
       and ((p.date_of_birth is not null and p.date_of_birth <= current_date - interval '18 years')
            or (p.date_of_birth is null and hm.role in ('primary', 'spouse', 'parent')))
  ), latest as (
    select distinct on (o.person_id, o.channel) o.person_id, o.channel::text as channel, o.opted_in, o.address
      from app.channel_optins o
     where o.person_id in (select person_id from adults)
     order by o.person_id, o.channel, o.recorded_at desc
  ), reach as (
    select l.person_id, l.channel
      from latest l
     where l.opted_in and coalesce(l.address, '') <> '' and l.channel in ('email', 'sms', 'whatsapp')
       and coalesce((select cs.granted from app.consents cs
                      where cs.person_id = l.person_id
                        and cs.kind = case l.channel when 'email' then 'marketing_email' else l.channel end
                      order by cs.recorded_at desc limit 1), true)
  )
  select (select count(*) from hh),
         (select count(*) from adults),
         (select count(*) from reach where channel = 'email'),
         (select count(*) from reach where channel = 'sms'),
         (select count(*) from reach where channel = 'whatsapp'),
         (select count(*) from adults ad where not exists (select 1 from reach r2 where r2.person_id = ad.person_id))
    into v_households, v_adults, v_email, v_sms, v_wa, v_none;

  return jsonb_build_object('people_visible', true, 'custom_fields_not_counted', v_custom,
                            'households', v_households, 'adults', v_adults, 'email', v_email, 'sms', v_sms, 'whatsapp', v_wa, 'no_channel', v_none);
end $$;

comment on function app.audience_reach(uuid, jsonb) is
  '0660: who a message to this audience (the compose form''s JSON) would reach by channel: matched households, adults, adults opted in to email, text and WhatsApp, adults reachable on none. Counts only, adults only (D2). Security invoker: a role that cannot see people gets people_visible=false and nulls, not zeros. Custom-field segments are not resolved (custom_fields_not_counted). Push is not counted.';

revoke execute on function app.audience_reach(uuid, jsonb) from public, anon;
grant execute on function app.audience_reach(uuid, jsonb) to authenticated, service_role;
