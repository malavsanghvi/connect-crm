-- Household change requests (0018) had a table and RLS but no way to decide one:
-- a member's "Add a family member" / relationship-change request from onboarding
-- or the Family tab landed in app.household_change_requests and just sat there --
-- no admin screen read the table and no function ever moved a request off 'open'.
-- Found live: two family members added during onboarding were invisible on both
-- ends (connect-crm had no page for the table at all; connect-mobile only showed
-- pending requests inside the one-time onboarding screen, not the ongoing Family
-- tab). This migration adds the decision function connect-crm's new review page
-- calls; a companion connect-mobile change adds the pending list to the Family tab.
set client_min_messages = warning;

-- security invoker + explicit has_permission check, matching app.staff_add_person
-- (0030) -- so this runs as the deciding admin and the existing audit_row triggers
-- on household_change_requests / people / household_members record them as such.
create or replace function app.decide_household_change_request(
  p_request uuid, p_decision text, p_role app.person_role_in_household default null, p_reason text default null
) returns uuid
language plpgsql security invoker set search_path = app, public, extensions as $$
declare r app.household_change_requests; v_person uuid; v_details jsonb; v_dob date;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'Choose approve or reject'; end if;
  select * into r from app.household_change_requests where id = p_request;
  if r.id is null then raise exception 'That request was not found'; end if;
  if not app.has_permission(r.center_id, 'people.manage') then
    raise exception 'Deciding a family change request needs the people.manage permission';
  end if;
  if r.status <> 'open' then raise exception 'That request was already decided'; end if;

  if p_decision = 'reject' then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give a reason -- it is kept for the household''s record'; end if;
    update app.household_change_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), reason = trim(p_reason)
      where id = p_request;
    return null;
  end if;

  v_details := r.details;
  if r.kind = 'add_member' then
    if p_role is null or p_role = 'primary' then
      raise exception 'Choose the person''s relationship to the household (not primary) before approving';
    end if;
    if coalesce(trim(v_details->>'first_name'), '') = '' or coalesce(trim(v_details->>'last_name'), '') = '' then
      raise exception 'The request is missing a first or last name';
    end if;
    if v_details ? 'dob' and v_details->>'dob' is not null then
      v_dob := (v_details->>'dob')::date;
      if v_dob > current_date then raise exception 'The date of birth on the request is in the future'; end if;
    end if;
    insert into app.people (center_id, first_name, last_name, date_of_birth)
      values (r.center_id, trim(v_details->>'first_name'), trim(v_details->>'last_name'), v_dob)
      returning id into v_person;
    insert into app.household_members (household_id, person_id, center_id, role, is_primary, joined_at)
      values (r.household_id, v_person, r.center_id, p_role, false, current_date);
  elsif r.kind = 'change_relationship' then
    if p_role is null or p_role = 'primary' then raise exception 'Choose the new relationship (not primary) before approving'; end if;
    if not (v_details ? 'person_id') then raise exception 'The request has no person to update'; end if;
    v_person := (v_details->>'person_id')::uuid;
    update app.household_members set role = p_role
      where household_id = r.household_id and person_id = v_person and left_at is null;
    if not found then raise exception 'That person is no longer in the household'; end if;
  else
    raise exception 'This kind of request (%) is not supported yet -- make the change directly on the household', r.kind;
  end if;

  update app.household_change_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), reason = nullif(trim(coalesce(p_reason, '')), '')
    where id = p_request;
  return v_person;
end $$;

grant execute on function app.decide_household_change_request(uuid, text, app.person_role_in_household, text) to authenticated;
