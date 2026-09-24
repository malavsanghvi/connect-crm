-- 0030_people_admin.sql
-- People module actions that change more than one row and must be all or
-- nothing: add a person to a household, make an adult the primary of their
-- own household, move a person between households, change a household's
-- membership tier, and merge duplicate people or households.
--
-- Every function here is SECURITY INVOKER: the caller's row-level security
-- still applies to every read and write (no policy is loosened and no new
-- permission key is introduced). The explicit has_permission() checks only
-- turn a silent "0 rows changed" into a plain-English refusal. The audit
-- triggers on households, people, household_members and memberships (0011)
-- record every row these functions touch.

-- ---------------------------------------------------------------------------
-- Add a person to a household (people.manage).
-- ---------------------------------------------------------------------------
create or replace function app.staff_add_person(
  p_household uuid, p_first text, p_last text, p_role app.person_role_in_household,
  p_dob date default null, p_gender text default null, p_email text default null, p_phone text default null
) returns uuid
language plpgsql security invoker set search_path = app, public, extensions as $$
declare v_center uuid; v_person uuid;
begin
  select center_id into v_center from app.households where id = p_household and merged_into_id is null;
  if v_center is null then raise exception 'That household was not found, or it was merged into another household'; end if;
  if not app.has_permission(v_center, 'people.manage') then
    raise exception 'Adding people needs the people.manage permission';
  end if;
  if coalesce(trim(p_first), '') = '' or coalesce(trim(p_last), '') = '' then
    raise exception 'A first and last name are required';
  end if;
  if p_role = 'primary' then
    raise exception 'A new person joins as spouse, child, parent, sibling or other. Use "Make primary of own household" for a new primary member';
  end if;
  if p_dob is not null and p_dob > current_date then raise exception 'The date of birth is in the future'; end if;
  insert into app.people (center_id, first_name, last_name, date_of_birth, gender, email, phone_e164)
    values (v_center, trim(p_first), trim(p_last), p_dob, nullif(trim(p_gender), ''), nullif(trim(p_email), ''), nullif(trim(p_phone), ''))
    returning id into v_person;
  insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
    values (p_household, v_person, v_center, p_role, false, current_date);
  return v_person;
end $$;

-- ---------------------------------------------------------------------------
-- Make an adult the primary of a new household of their own (people.manage).
-- They stay a member of the family household; the new household starts as a
-- community member household in the same zone.
-- ---------------------------------------------------------------------------
create or replace function app.make_primary_of_own_household(p_person uuid) returns uuid
language plpgsql security invoker set search_path = app, public, extensions as $$
declare p app.people; v_family uuid; v_zone uuid; v_household uuid;
begin
  select * into p from app.people where id = p_person;
  if p.id is null then raise exception 'That person was not found'; end if;
  if p.merged_into_id is not null then raise exception 'That person record was merged into another record'; end if;
  if not app.has_permission(p.center_id, 'people.manage') then
    raise exception 'Creating a household needs the people.manage permission';
  end if;
  if p.date_of_birth is not null and p.date_of_birth > (current_date - interval '18 years')::date then
    raise exception '% is under 18, so cannot be the primary member of a household', p.first_name;
  end if;
  if exists (select 1 from app.household_members hm join app.households h on h.id = hm.household_id
             where hm.person_id = p_person and hm.is_primary and hm.left_at is null and h.merged_into_id is null) then
    raise exception '% is already the primary member of a household', p.first_name;
  end if;
  select hm.household_id, h.zone_id into v_family, v_zone
    from app.household_members hm join app.households h on h.id = hm.household_id
    where hm.person_id = p_person and hm.left_at is null and h.merged_into_id is null
    order by hm.joined_at nulls last limit 1;
  insert into app.households (center_id, display_name, zone_id)
    values (p.center_id, p.last_name || ', ' || coalesce(nullif(p.preferred_name, ''), p.first_name), v_zone)
    returning id into v_household;
  insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
    values (v_household, p_person, p.center_id, 'primary', true, current_date);
  insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on, granted_by, notes)
    select p.center_id, v_household, p_person, mt.id, 'community', 'active', current_date, auth.uid(),
           'Own household created by staff' || case when v_family is not null then '; stays in the family household' else '' end
    from app.membership_types mt where mt.center_id = p.center_id and mt.tier = 'community'
    order by mt.active desc, mt.key limit 1;
  return v_household;
end $$;

-- ---------------------------------------------------------------------------
-- Move a person from one household to another (people.manage). Pledges,
-- payments and memberships stay with the household they were made for.
-- ---------------------------------------------------------------------------
create or replace function app.move_person_household(
  p_person uuid, p_from uuid, p_to uuid, p_role app.person_role_in_household default 'other'
) returns void
language plpgsql security invoker set search_path = app, public, extensions as $$
declare v_center uuid; v_link app.household_members; v_to app.households; v_others int;
begin
  select center_id into v_center from app.people where id = p_person and merged_into_id is null;
  if v_center is null then raise exception 'That person was not found, or the record was merged'; end if;
  if not app.has_permission(v_center, 'people.manage') then
    raise exception 'Moving people between households needs the people.manage permission';
  end if;
  if p_from = p_to then raise exception 'Choose a different household to move to'; end if;
  select * into v_link from app.household_members where household_id = p_from and person_id = p_person and left_at is null;
  if v_link.person_id is null then raise exception 'That person is not a current member of the household being left'; end if;
  select * into v_to from app.households where id = p_to;
  if v_to.id is null or v_to.center_id <> v_center then raise exception 'The destination household was not found'; end if;
  if v_to.merged_into_id is not null then raise exception 'The destination household was merged into another household'; end if;
  if p_role = 'primary' then
    raise exception 'A moved person joins as spouse, child, parent, sibling or other; the destination keeps its primary member';
  end if;
  if v_link.is_primary then
    select count(*) into v_others from app.household_members
      where household_id = p_from and person_id <> p_person and left_at is null;
    if v_others > 0 then
      raise exception 'This person is the primary member of the household they are leaving, which still has % other member(s). Make someone else the primary first', v_others;
    end if;
  end if;
  update app.household_members set left_at = current_date, is_primary = false
    where household_id = p_from and person_id = p_person;
  insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
    values (p_to, p_person, v_center, p_role, false, current_date)
    on conflict (household_id, person_id) do update
      set left_at = null, role = excluded.role, is_primary = false, joined_at = current_date;
end $$;

-- ---------------------------------------------------------------------------
-- Change a household's membership tier directly (people.approve, and the
-- memberships write policy needs people.manage). Normally a tier changes
-- through an application with a reference; this is the staff correction.
-- The current active membership ends today and a new one starts today. No
-- fee pledge is created.
-- ---------------------------------------------------------------------------
create or replace function app.change_household_tier(p_household uuid, p_tier app.membership_tier, p_reason text)
returns uuid
language plpgsql security invoker set search_path = app, public, extensions as $$
declare h app.households; v_current app.membership_tier; v_type uuid; v_primary uuid; v_id uuid;
begin
  select * into h from app.households where id = p_household;
  if h.id is null or h.merged_into_id is not null then raise exception 'That household was not found, or it was merged'; end if;
  if not app.has_permission(h.center_id, 'people.approve') or not app.has_permission(h.center_id, 'people.manage') then
    raise exception 'Changing a membership tier needs the people.approve and people.manage permissions';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason for the tier change (it goes in the audit log)'; end if;
  select tier into v_current from app.memberships
    where household_id = p_household and status = 'active' order by starts_on desc limit 1;
  if v_current = p_tier then raise exception 'The household already holds an active % membership', p_tier; end if;
  select id into v_type from app.membership_types where center_id = h.center_id and tier = p_tier order by active desc, key limit 1;
  if v_type is null then raise exception 'No % membership type is set up for this center', p_tier; end if;
  select person_id into v_primary from app.household_members
    where household_id = p_household and is_primary and left_at is null limit 1;
  update app.memberships set status = 'ended', ends_on = current_date
    where household_id = p_household and status = 'active';
  insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on, granted_by, notes)
    values (h.center_id, p_household, v_primary, v_type, p_tier, 'active', current_date, auth.uid(),
            'Tier changed by staff: ' || trim(p_reason))
    returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Merge a duplicate PERSON into the record that is kept (people.manage).
--   * p_take lists profile fields to copy from the duplicate onto the kept
--     record (only the names in the allow-list below).
--   * The duplicate's current household links move to the kept record.
--   * Identifiers and held memberships the caller may change move too; the
--     rest of the history (pledges, payments, audit) stays on the duplicate,
--     which is marked merged_into_id = kept.
--   * The record that signs in to the app must be the one kept.
-- ---------------------------------------------------------------------------
create or replace function app.merge_people(p_keep uuid, p_drop uuid, p_take text[] default '{}')
returns void
language plpgsql security invoker set search_path = app, public, extensions as $$
declare k app.people; d app.people; f text; l app.household_members;
  v_allowed text[] := array['first_name','last_name','preferred_name','date_of_birth','gender','email','phone_e164','profession','employer'];
begin
  if p_keep = p_drop then raise exception 'Choose two different records to merge'; end if;
  select * into k from app.people where id = p_keep;
  select * into d from app.people where id = p_drop;
  if k.id is null or d.id is null then raise exception 'One of the two records was not found'; end if;
  if k.center_id <> d.center_id then raise exception 'The two records belong to different centers'; end if;
  if not app.has_permission(k.center_id, 'people.manage') then raise exception 'Merging records needs the people.manage permission'; end if;
  if k.merged_into_id is not null or d.merged_into_id is not null then raise exception 'One of the two records was already merged'; end if;
  if exists (select 1 from app.center_users where person_id = p_drop) then
    if exists (select 1 from app.center_users where person_id = p_keep) then
      raise exception 'Both records sign in to the app, so they cannot be merged here. Ask the platform team to merge the two sign-ins first';
    end if;
    raise exception 'The duplicate signs in to the app. Keep that record instead (swap which record is kept)';
  end if;

  foreach f in array coalesce(p_take, '{}') loop
    if not f = any(v_allowed) then raise exception 'The field "%" cannot be copied in a merge', f; end if;
    execute format('update app.people set %1$I = (select %1$I from app.people where id = $1) where id = $2', f) using p_drop, p_keep;
  end loop;

  for l in select * from app.household_members where person_id = p_drop and left_at is null loop
    insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
      values (l.household_id, p_keep, l.center_id, l.role, l.is_primary, coalesce(l.joined_at, current_date))
      on conflict (household_id, person_id) do update
        set left_at = null, is_primary = app.household_members.is_primary or excluded.is_primary;
    update app.household_members set left_at = current_date, is_primary = false
      where household_id = l.household_id and person_id = p_drop;
  end loop;

  update app.external_ids set person_id = p_keep where person_id = p_drop;
  update app.memberships set person_id = p_keep where person_id = p_drop;
  update app.people set merged_into_id = p_keep where id = p_drop;
  update app.merge_candidates set status = 'merged', resolved_by = auth.uid(), resolved_at = now()
    where kind = 'person' and status = 'open'
      and ((left_id = p_keep and right_id = p_drop) or (left_id = p_drop and right_id = p_keep));
end $$;

-- ---------------------------------------------------------------------------
-- Merge a duplicate HOUSEHOLD into the one that is kept (people.manage).
-- Current members move to the kept household. Pledges, payments and
-- memberships stay on the duplicate (its history page says where it went):
-- moving money records between households is an owner decision.
-- ---------------------------------------------------------------------------
create or replace function app.merge_households(p_keep uuid, p_drop uuid) returns void
language plpgsql security invoker set search_path = app, public, extensions as $$
declare k app.households; d app.households; l app.household_members; v_keep_has_primary boolean;
begin
  if p_keep = p_drop then raise exception 'Choose two different households to merge'; end if;
  select * into k from app.households where id = p_keep;
  select * into d from app.households where id = p_drop;
  if k.id is null or d.id is null then raise exception 'One of the two households was not found'; end if;
  if k.center_id <> d.center_id then raise exception 'The two households belong to different centers'; end if;
  if not app.has_permission(k.center_id, 'people.manage') then raise exception 'Merging households needs the people.manage permission'; end if;
  if k.merged_into_id is not null or d.merged_into_id is not null then raise exception 'One of the two households was already merged'; end if;

  select exists (select 1 from app.household_members where household_id = p_keep and is_primary and left_at is null)
    into v_keep_has_primary;
  for l in select * from app.household_members where household_id = p_drop and left_at is null loop
    insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
      values (p_keep, l.person_id, l.center_id,
              case when l.role = 'primary' and v_keep_has_primary then 'other'::app.person_role_in_household else l.role end,
              l.is_primary and not v_keep_has_primary, coalesce(l.joined_at, current_date))
      on conflict (household_id, person_id) do update set left_at = null;
    update app.household_members set left_at = current_date, is_primary = false
      where household_id = p_drop and person_id = l.person_id;
  end loop;

  update app.households set merged_into_id = p_keep where id = p_drop;
  update app.merge_candidates set status = 'merged', resolved_by = auth.uid(), resolved_at = now()
    where kind = 'household' and status = 'open'
      and ((left_id = p_keep and right_id = p_drop) or (left_id = p_drop and right_id = p_keep));
end $$;

grant execute on function app.staff_add_person(uuid, text, text, app.person_role_in_household, date, text, text, text) to authenticated;
grant execute on function app.make_primary_of_own_household(uuid) to authenticated;
grant execute on function app.move_person_household(uuid, uuid, uuid, app.person_role_in_household) to authenticated;
grant execute on function app.change_household_tier(uuid, app.membership_tier, text) to authenticated;
grant execute on function app.merge_people(uuid, uuid, text[]) to authenticated;
grant execute on function app.merge_households(uuid, uuid) to authenticated;
