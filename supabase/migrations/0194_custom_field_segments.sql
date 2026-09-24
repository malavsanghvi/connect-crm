-- Onboarding · o-import: custom fields as segment filters.
--
-- An audience may carry "custom_fields": [{entity: people|households, key, value}].
-- A household matches when its own value (households) or a current member's
-- value (people) equals the given one. Only active fields marked searchable
-- count, so a staff-only detail nobody chose to filter on is never a segment.
-- Everything else is 0104's segment_recipient_count unchanged (same OR-ed
-- segments, same adult / email / opt-in / consent rules).

create or replace function app.segment_recipient_count(p_center uuid, p_audience jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app', 'public', 'extensions'
AS $function$
declare v_n int; a jsonb := coalesce(p_audience, '{}'::jsonb);
begin
  perform app.assert_module_enabled(p_center, 'comms');
  if not app.has_permission(p_center, 'comms.send') then raise exception 'not allowed to preview recipients'; end if;
  select count(distinct h.id) into v_n
    from app.households h
   where h.center_id = p_center and h.merged_into_id is null
     and (
       (coalesce((a->>'all_members')::boolean, false) and exists (
          select 1 from app.memberships m where m.household_id = h.id and m.status = 'active'))
       or (a ? 'zone_ids' and h.zone_id::text in (select jsonb_array_elements_text(a->'zone_ids')))
       or (a ? 'pathshala_class_ids' and exists (
          select 1 from app.pathshala_enrollments e where e.household_id = h.id and e.status in ('placed','active','waitlisted')
            and e.class_id::text in (select jsonb_array_elements_text(a->'pathshala_class_ids'))))
       or (a ? 'event_id' and exists (
          select 1 from app.rsvps r where r.household_id = h.id and r.event_id = (a->>'event_id')::uuid
            and (not a ? 'rsvp_statuses' or r.status::text in (select jsonb_array_elements_text(a->'rsvp_statuses')))))
       or (a ? 'membership_tiers' and exists (
          select 1 from app.memberships m where m.household_id = h.id and m.status = 'active'
            and m.tier::text in (select jsonb_array_elements_text(a->'membership_tiers'))))
       or (jsonb_typeof(a->'custom_fields') = 'array' and exists (
          select 1 from jsonb_array_elements(a->'custom_fields') f
            join app.custom_field_definitions d on d.center_id = p_center and d.entity = f->>'entity' and d.key = f->>'key'
                                               and d.searchable and d.status = 'active'
           where (d.entity = 'households' and h.custom -> d.key = f->'value')
              or (d.entity = 'people' and exists (
                    select 1 from app.household_members hm2 join app.people p2 on p2.id = hm2.person_id
                     where hm2.household_id = h.id and hm2.left_at is null and p2.merged_into_id is null
                       and p2.custom -> d.key = f->'value'))))
     )
     and exists (
       select 1 from app.household_members hm join app.people p on p.id = hm.person_id
        where hm.household_id = h.id and hm.left_at is null
          and not p.is_deceased and p.merged_into_id is null
          and coalesce(p.email::text, '') <> ''
          and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
          and coalesce((select o.opted_in from app.channel_optins o where o.person_id = p.id and o.channel = 'email'
                         order by o.recorded_at desc limit 1), false)
          and coalesce((select cs.granted from app.consents cs where cs.person_id = p.id and cs.kind = 'marketing_email'
                         order by cs.recorded_at desc limit 1), true));
  return v_n;
end $function$;
