-- Duplicate-account guard for family onboarding.
--
-- Found live risk: a member adding a family member (household_change_requests
-- kind=add_member) only ever captured first/last/relationship/dob -- never a
-- phone or email for the person being added. That meant:
--   1. Once approved, the new person row had no contact info on file, so
--      app.find_my_family (0011) could never match them if they later signed
--      up themselves -- they would create a second, disconnected household.
--   2. While the request sat pending (no person row exists yet at all), the
--      person it names had literally nothing to match against if they signed
--      up in the meantime.
-- This migration: captures phone/email on the add-member request, persists
-- them onto the person at approval, and adds hard duplicate checks (by exact
-- phone/email, or by exact name+DOB when no contact was given) at both
-- request time and self-onboarding time -- the two places a duplicate
-- household or person could be created.
set client_min_messages = warning;

-- ---------------------------------------------------------------------------
-- 1. Request to add a family member, now with dedupe (replaces the mobile
--    app's direct insert into household_change_requests for kind=add_member).
-- ---------------------------------------------------------------------------
create or replace function app.request_add_family_member(
  p_household uuid, p_first text, p_last text, p_relationship text default null,
  p_dob date default null, p_phone text default null, p_email text default null
) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_center uuid; v_phone text; v_email citext;
  v_match_household uuid; v_same_household boolean; v_id uuid;
begin
  select center_id into v_center from app.households where id = p_household;
  if v_center is null then raise exception 'That household was not found'; end if;
  if not app.adult_of_household(v_center, p_household) then
    raise exception 'Only an adult in this household can ask to add a family member';
  end if;
  if coalesce(trim(p_first), '') = '' or coalesce(trim(p_last), '') = '' then
    raise exception 'Please enter their first and last name';
  end if;
  v_phone := nullif(trim(coalesce(p_phone, '')), '');
  v_email := nullif(trim(coalesce(p_email, '')), '')::citext;

  -- Already an active member somewhere at this center (by contact, or by
  -- exact name+DOB when no contact was given -- the only case we can check).
  select hm.household_id into v_match_household
  from app.people p
  join app.household_members hm on hm.person_id = p.id and hm.left_at is null
  where p.center_id = v_center and p.merged_into_id is null and not p.is_deceased
    and ((v_phone is not null and p.phone_e164 = v_phone)
      or (v_email is not null and p.email = v_email)
      or (v_phone is null and v_email is null and p_dob is not null
          and lower(p.first_name) = lower(trim(p_first)) and lower(p.last_name) = lower(trim(p_last))
          and p.date_of_birth = p_dob))
  limit 1;
  if v_match_household is not null then
    v_same_household := v_match_household = p_household;
    raise exception '%', case when v_same_household
      then trim(p_first) || ' is already a member of this household'
      else 'Someone matching this name and contact info is already on file in another household here -- please contact the office instead of sending this request'
    end;
  end if;

  -- An open add_member request already names this person (anywhere at this
  -- center -- another family member may have asked first).
  select hcr.household_id into v_match_household
  from app.household_change_requests hcr
  where hcr.center_id = v_center and hcr.status = 'open' and hcr.kind = 'add_member'
    and ((v_phone is not null and hcr.details->>'phone' = v_phone)
      or (v_email is not null and lower(hcr.details->>'email') = lower(v_email::text))
      or (v_phone is null and v_email is null and p_dob is not null
          and lower(hcr.details->>'first_name') = lower(trim(p_first))
          and lower(hcr.details->>'last_name') = lower(trim(p_last))
          and (hcr.details->>'dob')::date = p_dob))
  limit 1;
  if v_match_household is not null then
    v_same_household := v_match_household = p_household;
    raise exception '%', case when v_same_household
      then 'There is already a pending request to add ' || trim(p_first) || ' -- no need to send it twice'
      else 'A request to add someone matching this name and contact info is already waiting on the office, from another household -- please contact the office instead of sending this request'
    end;
  end if;

  insert into app.household_change_requests (center_id, household_id, requested_by, kind, status, details)
    values (v_center, p_household, auth.uid(), 'add_member', 'open',
      jsonb_strip_nulls(jsonb_build_object(
        'first_name', trim(p_first), 'last_name', trim(p_last), 'relationship', nullif(trim(coalesce(p_relationship, '')), ''),
        'dob', p_dob, 'phone', v_phone, 'email', v_email)))
    returning id into v_id;
  return v_id;
end $$;

grant execute on function app.request_add_family_member(uuid, text, text, text, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. "Someone already asked to add you" -- checked by the signed-in user's
--    own verified email/phone against open add_member requests, so onboarding
--    can offer this instead of "start a new household" (app.find_my_family's
--    sibling for the not-yet-a-person-record case).
-- ---------------------------------------------------------------------------
create or replace function app.find_pending_family_add_requests(p_center uuid)
returns table (request_id uuid, household_name text, requested_by_name text, first_name text, last_name text, requested_at timestamptz)
language plpgsql stable security definer set search_path = app, public as $$
declare v_email citext; v_phone text;
begin
  select u.email::citext, u.phone into v_email, v_phone from auth.users u where u.id = auth.uid();
  if v_email is null and v_phone is null then return; end if;
  return query
    select hcr.id, h.display_name, coalesce(p2.first_name || ' ' || p2.last_name, 'A household member'),
           hcr.details->>'first_name', hcr.details->>'last_name', hcr.created_at
    from app.household_change_requests hcr
    join app.households h on h.id = hcr.household_id
    left join app.center_users cu on cu.user_id = hcr.requested_by and cu.center_id = hcr.center_id
    left join app.people p2 on p2.id = cu.person_id
    where hcr.center_id = p_center and hcr.status = 'open' and hcr.kind = 'add_member'
      and ((v_email is not null and lower(hcr.details->>'email') = lower(v_email::text))
        or (v_phone is not null and hcr.details->>'phone' = '+' || ltrim(v_phone, '+')))
    order by hcr.created_at;
end $$;

grant execute on function app.find_pending_family_add_requests(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_my_household: refuse "this isn't my family, start new" when a
--    pending add_member request already names this verified email/phone.
-- ---------------------------------------------------------------------------
create or replace function app.create_my_household(p_center uuid, p_first text, p_last text) returns uuid
language plpgsql security definer set search_path = app, public as $$
declare v_person uuid; v_household uuid; v_email text; v_phone text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from app.center_users where center_id = p_center and user_id = auth.uid()) then
    raise exception 'already linked to a household at this center';
  end if;
  select email, phone into v_email, v_phone from auth.users where id = auth.uid();
  if exists (
    select 1 from app.household_change_requests hcr
    where hcr.center_id = p_center and hcr.status = 'open' and hcr.kind = 'add_member'
      and ((v_email is not null and lower(hcr.details->>'email') = lower(v_email))
        or (v_phone is not null and hcr.details->>'phone' = '+' || ltrim(v_phone, '+')))
  ) then
    raise exception 'A family member already asked to add you to their household -- that request is waiting on the office. Please wait for it, or contact the office if this is not right, instead of starting a new profile';
  end if;
  insert into app.people (center_id, first_name, last_name, email, phone_e164)
    values (p_center, p_first, p_last, v_email, case when v_phone is not null then '+' || ltrim(v_phone,'+') end)
    returning id into v_person;
  insert into app.households (center_id, display_name) values (p_center, p_last || ' family') returning id into v_household;
  insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (v_household, v_person, p_center, 'primary', true);
  insert into app.accounts (user_id) values (auth.uid()) on conflict do nothing;
  insert into app.center_users (center_id, user_id, person_id) values (p_center, auth.uid(), v_person);
  insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status)
    select p_center, v_household, v_person, mt.id, 'community', 'active'
    from app.membership_types mt where mt.center_id = p_center and mt.tier = 'community' limit 1;
  -- Flag for the membership coordinator's "new household" review queue.
  insert into app.merge_candidates (center_id, kind, left_id, right_id, score, status)
    select p_center, 'person', v_person, p.id, 0.5, 'open'
    from app.people p where p.center_id = p_center and p.id <> v_person
      and lower(p.last_name) = lower(p_last) and lower(p.first_name) = lower(p_first);
  return v_household;
end $$;

-- ---------------------------------------------------------------------------
-- 4. decide_household_change_request: persist the phone/email captured on an
--    add_member request onto the new person (closes the loop so future sign-
--    ins match them), and refuse to approve into a duplicate created since
--    the request was sent.
-- ---------------------------------------------------------------------------
create or replace function app.decide_household_change_request(
  p_request uuid, p_decision text, p_role app.person_role_in_household default null, p_reason text default null
) returns uuid
language plpgsql security invoker set search_path = app, public, extensions as $$
declare r app.household_change_requests; v_person uuid; v_details jsonb; v_dob date; v_phone text; v_email citext;
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
    v_phone := nullif(v_details->>'phone', '');
    v_email := nullif(v_details->>'email', '')::citext;
    if (v_phone is not null or v_email is not null) and exists (
      select 1 from app.people p
      join app.household_members hm on hm.person_id = p.id and hm.left_at is null
      where p.center_id = r.center_id and p.merged_into_id is null and not p.is_deceased
        and ((v_phone is not null and p.phone_e164 = v_phone) or (v_email is not null and p.email = v_email))
    ) then
      raise exception 'Someone matching this phone or email is already on file at this center -- check the directory before approving, this may be a duplicate';
    end if;
    insert into app.people (center_id, first_name, last_name, date_of_birth, phone_e164, email)
      values (r.center_id, trim(v_details->>'first_name'), trim(v_details->>'last_name'), v_dob, v_phone, v_email)
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
