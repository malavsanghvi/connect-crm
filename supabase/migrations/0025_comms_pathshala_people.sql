-- 0025_comms_pathshala_people.sql
-- Prototype parity: communications, Pathshala and People.
--   16. comms_campaigns.name / opened_count (recipients_count exists since 0008);
--       app.segment_recipient_count for the live recipient preview
--   17. app.pathshala_term_stats
--   18. app.people_list and app.directory_listing

-- ---------------------------------------------------------------------------
-- 16. Communications
-- ---------------------------------------------------------------------------
alter table app.comms_campaigns add column name text;
alter table app.comms_campaigns add column opened_count integer;
comment on column app.comms_campaigns.name is 'Internal name shown in the campaign list (title is what recipients see).';

-- Households an audience reaches by email: households with at least one adult
-- (18+ or no date of birth) who has an email address and has not unsubscribed
-- (latest email opt-in record is not an opt-out, and no withdrawn
-- marketing_email consent). Audience keys (OR-ed, like surveys):
--   all_members (households with an active membership of any tier) · zone_ids[] ·
--   pathshala_class_ids[] · event_id (+ rsvp_statuses[]) · membership_tiers[]
create or replace function app.segment_recipient_count(p_center uuid, p_audience jsonb) returns integer
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_n int; a jsonb := coalesce(p_audience, '{}'::jsonb);
begin
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
     )
     and exists (
       select 1 from app.household_members hm join app.people p on p.id = hm.person_id
        where hm.household_id = h.id and hm.left_at is null
          and not p.is_deceased and p.merged_into_id is null
          and coalesce(p.email::text, '') <> ''
          and (p.date_of_birth is null or p.date_of_birth <= current_date - interval '18 years')
          and coalesce((select o.opted_in from app.channel_optins o where o.person_id = p.id and o.channel = 'email'
                         order by o.recorded_at desc limit 1), true)
          and coalesce((select cs.granted from app.consents cs where cs.person_id = p.id and cs.kind = 'marketing_email'
                         order by cs.recorded_at desc limit 1), true));
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 17. Pathshala term stats (principal / Pathshala staff)
--   students    = placed or active enrollments
--   waitlisted  = waitlisted enrollments
--   teachers    = distinct teachers, assistants and substitutes on the term's classes
--   background_checks_expiring = those teachers whose latest check has expired or
--                                expires within 60 days, or who have none
--   attendance_percent = present or late / all marked, across the term's sessions
--   signoffs_waiting   = Gyan Path sign-offs requested by the term's students
-- ---------------------------------------------------------------------------
create or replace function app.pathshala_term_stats(p_term uuid)
returns table (students int, waitlisted int, teachers int, background_checks_expiring int, attendance_percent int, signoffs_waiting int)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t app.pathshala_terms;
begin
  select * into t from app.pathshala_terms where id = p_term;
  if t.id is null then raise exception 'term not found'; end if;
  if not (app.has_permission(t.center_id, 'pathshala.view') or app.has_permission(t.center_id, 'pathshala.manage')) then
    raise exception 'not allowed to see Pathshala numbers';
  end if;
  return query
  with tt as (
    select distinct pt.person_id from app.pathshala_teachers pt join app.pathshala_classes c on c.id = pt.class_id where c.term_id = p_term
  )
  select
    (select count(*)::int from app.pathshala_enrollments e where e.term_id = p_term and e.status in ('placed','active')),
    (select count(*)::int from app.pathshala_enrollments e where e.term_id = p_term and e.status = 'waitlisted'),
    (select count(*)::int from tt),
    (select count(*)::int from tt where coalesce(
        (select bc.expires_on from app.background_checks bc where bc.person_id = tt.person_id and bc.status = 'clear'
          order by bc.cleared_on desc nulls last, bc.created_at desc limit 1), current_date) < current_date + 60),
    (select case when count(*) = 0 then null
                 else round(100.0 * count(*) filter (where pa.status in ('present','late')) / count(*))::int end
       from app.pathshala_attendance pa join app.pathshala_sessions s on s.id = pa.session_id
       join app.pathshala_classes c on c.id = s.class_id where c.term_id = p_term),
    (select count(*)::int from app.gyan_signoffs g where g.status = 'requested' and exists (
        select 1 from app.pathshala_enrollments e where e.term_id = p_term and e.student_person_id = g.person_id
          and e.status in ('placed','active')));
end $$;

-- ---------------------------------------------------------------------------
-- 18. People list (people.view) and directory listing
-- ---------------------------------------------------------------------------
-- One row per person (their primary household), with the total match count for
-- paging. Dates of birth of minors are masked (age is still shown).
-- p_search matches name, email, phone digits, member number or household number/name.
create or replace function app.people_list(p_center uuid, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns table (person_id uuid, first_name text, last_name text, preferred_name text, email text, phone_e164 text,
               member_number text, household_id uuid, household_label text, household_number text, relationship text,
               age int, date_of_birth date, is_minor boolean, on_app boolean, is_verified boolean, total_count bigint)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare q text := nullif(trim(coalesce(p_search, '')), ''); v_digits text;
begin
  if not (app.has_permission(p_center, 'people.view') or app.has_permission(p_center, 'people.manage')) then
    raise exception 'not allowed to see people';
  end if;
  v_digits := regexp_replace(coalesce(q, ''), '[^0-9]', '', 'g');
  return query
  with rows as (
    select p.id, p.first_name, p.last_name, p.preferred_name, p.email::text as email, p.phone_e164, p.member_number,
           hh.household_id, hh.display_name, hh.household_number, hh.role,
           date_part('year', age(current_date, p.date_of_birth))::int as age_years, p.date_of_birth,
           p.is_verified, exists (select 1 from app.center_users cu where cu.person_id = p.id) as on_app
      from app.people p
      left join lateral (
        select hm.household_id, h.display_name, h.household_number, hm.role::text as role
          from app.household_members hm join app.households h on h.id = hm.household_id
         where hm.person_id = p.id and hm.left_at is null
         order by hm.is_primary desc, hm.joined_at nulls last limit 1) hh on true
     where p.center_id = p_center and p.merged_into_id is null
       and (q is null
            or (p.first_name || ' ' || p.last_name) ilike '%' || q || '%'
            or coalesce(p.preferred_name, '') ilike '%' || q || '%'
            or coalesce(p.email::text, '') ilike '%' || q || '%'
            or coalesce(p.member_number, '') ilike '%' || q || '%'
            or coalesce(hh.household_number, '') ilike '%' || q || '%'
            or coalesce(hh.display_name, '') ilike '%' || q || '%'
            or (length(v_digits) >= 4 and regexp_replace(coalesce(p.phone_e164, ''), '[^0-9]', '', 'g') like '%' || v_digits || '%'))
  )
  select r.id, r.first_name, r.last_name, r.preferred_name, r.email, r.phone_e164, r.member_number,
         r.household_id, r.display_name, r.household_number, r.role, r.age_years,
         case when r.age_years is not null and r.age_years < 18 then null else r.date_of_birth end,
         coalesce(r.age_years < 18, false), r.on_app, r.is_verified, count(*) over ()
    from rows r
   order by lower(r.last_name), lower(r.first_name), r.id
   limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Directory and expertise: people who opted in (household directory, expertise,
-- or "contact me as a new member"). Members of the center see verified people
-- (same rule as app.directory); people.view holders also see unverified ones.
create or replace function app.directory_listing(p_center uuid)
returns table (person_id uuid, name text, household_id uuid, household_label text, zone text, profession text,
               directory_opt_in boolean, expertise_opt_in boolean, expertise_tags text[], expertise_headline text,
               new_member_contact_opt_in boolean, is_verified boolean)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_staff boolean;
begin
  v_staff := app.has_permission(p_center, 'people.view') or app.has_permission(p_center, 'people.manage');
  if not (v_staff or app.is_member_of(p_center)) then raise exception 'the directory is for members'; end if;
  return query
  select p.id, coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name, h.id, h.display_name, z.name, p.profession,
         coalesce(h.directory_opt_in, false), p.expertise_opt_in, p.expertise_tags, p.expertise_headline,
         p.new_member_contact_opt_in, p.is_verified
    from app.people p
    left join lateral (
      select h2.* from app.household_members hm join app.households h2 on h2.id = hm.household_id
       where hm.person_id = p.id and hm.left_at is null
       order by hm.is_primary desc, hm.joined_at nulls last limit 1) h on true
    left join app.zones z on z.id = h.zone_id
   where p.center_id = p_center and p.merged_into_id is null and not p.is_deceased
     and (coalesce(h.directory_opt_in, false) or p.expertise_opt_in or p.new_member_contact_opt_in)
     and (p.is_verified or v_staff)
   order by lower(p.last_name), lower(p.first_name);
end $$;

revoke execute on function app.segment_recipient_count(uuid, jsonb), app.pathshala_term_stats(uuid),
  app.people_list(uuid, text, integer, integer), app.directory_listing(uuid) from public, anon;
grant execute on function app.segment_recipient_count(uuid, jsonb), app.pathshala_term_stats(uuid),
  app.people_list(uuid, text, integer, integer), app.directory_listing(uuid) to authenticated;
grant execute on all functions in schema app to service_role;
