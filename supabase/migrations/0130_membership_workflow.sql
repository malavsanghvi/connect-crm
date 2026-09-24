-- Wave 3 (stream w-people) · the new-member workflow, end to end.
--
-- Before this migration a member could not apply from the app (applications
-- were only ever seeded), and an approved application recorded the decision
-- only: no membership row, no fee. This adds:
--
--   app.find_membership_reference(center, type, contact)
--       The applicant names their reference by the reference's email, mobile
--       or member number (exact match only: nobody can browse who the members
--       are or which tier they hold). Returns the name to confirm, and whether
--       that person can be a reference for this membership type, with the
--       reason in plain English when not.
--   app.submit_membership_application(center, type, reference, note)
--       Applies the current rules (membership_types + centers.rules.membership):
--       adult of the household, no open application, not already at this tier
--       or higher, reference outside the household with an active membership at
--       the type's reference_tier_min or higher, the reference's yearly cap,
--       the prior-yearly months for Life, the expiry window.
--   app.my_membership_application(center)
--       The household's latest application for the member app (status only;
--       the reference's private reason is never returned).
--   trigger membership_applications_zz_grant
--       When an application becomes approved, creates the active membership
--       (period from the type), ends the household's previous active one, and,
--       when the type has a fee, records it as an open membership-fee pledge
--       (fee_pledge_id) — card payment is not connected, so the fee is owed,
--       never charged. Fires after membership_applications_approval (names sort
--       alphabetically), which still enforces reference/center/EC.
--
-- No new tables, permissions or policies. Every function keeps
-- search_path = app, public, extensions and asserts the Membership module.

create or replace function app.tier_rank(p_tier app.membership_tier) returns integer
language sql immutable set search_path = app, public, extensions as $$
  select case p_tier when 'community' then 1 when 'yearly' then 2 when 'life' then 3 else 0 end
$$;

-- The household's current active tier (null when none).
create or replace function app.household_active_tier(p_household uuid) returns app.membership_tier
language sql stable security definer set search_path = app, public, extensions as $$
  select m.tier from app.memberships m
   where m.household_id = p_household and m.status = 'active'
     and (m.ends_on is null or m.ends_on >= current_date)
   order by app.tier_rank(m.tier) desc limit 1
$$;

-- The caller's household in this center (their primary one first).
create or replace function app.my_primary_household(p_center uuid) returns uuid
language sql stable security definer set search_path = app, public, extensions as $$
  select hm.household_id from app.household_members hm
    join app.households h on h.id = hm.household_id and h.merged_into_id is null
   where hm.center_id = p_center and hm.person_id = app.my_person_id(p_center) and hm.left_at is null
   order by hm.is_primary desc, hm.joined_at nulls last limit 1
$$;

-- Why this person can't be the reference for this type (null = they can).
create or replace function app.reference_problem(p_type app.membership_types, p_reference uuid, p_household uuid)
returns text language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_ref_household uuid; v_ref_tier app.membership_tier; v_cap integer; v_used integer;
begin
  if p_reference is null then return 'Choose a reference.'; end if;
  if exists (select 1 from app.household_members hm where hm.person_id = p_reference and hm.household_id = p_household and hm.left_at is null) then
    return 'Your reference must be someone outside your own household.';
  end if;
  select hm.household_id into v_ref_household from app.household_members hm
    join app.households h on h.id = hm.household_id and h.merged_into_id is null
   where hm.person_id = p_reference and hm.left_at is null order by hm.is_primary desc limit 1;
  v_ref_tier := app.household_active_tier(v_ref_household);
  if p_type.reference_tier_min is not null and (v_ref_tier is null or app.tier_rank(v_ref_tier) < app.tier_rank(p_type.reference_tier_min)) then
    return case p_type.reference_tier_min
      when 'life' then 'For ' || p_type.name || ', your reference must be a Life member.'
      else 'For ' || p_type.name || ', your reference must be a Yearly or Life member.' end;
  end if;
  if v_ref_tier is null then return 'Your reference must be a current member.'; end if;
  v_cap := nullif((select c.rules #>> '{membership,max_pending_sponsorships_per_year}' from app.centers c where c.id = p_type.center_id), '')::int;
  if v_cap is not null then
    select count(*) into v_used from app.membership_applications a
     where a.reference_person_id = p_reference and a.created_at >= date_trunc('year', now())
       and a.status in ('awaiting_reference','awaiting_center','awaiting_ec');
    if v_used >= v_cap then return 'This person is already the reference for as many applications as the rules allow this year. Ask someone else.'; end if;
  end if;
  return null;
end $$;

create or replace function app.find_membership_reference(p_center uuid, p_type uuid, p_contact text)
returns table (person_id uuid, name text, household_label text, eligible boolean, problem text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_type app.membership_types; v_q text := lower(trim(coalesce(p_contact, ''))); v_digits text; v_household uuid;
begin
  perform app.assert_module_enabled(p_center, 'membership');
  if app.my_person_id(p_center) is null then raise exception 'Sign in and set up your family profile before applying.'; end if;
  select * into v_type from app.membership_types t where t.id = p_type and t.center_id = p_center and t.active;
  if v_type.id is null then raise exception 'That membership type is not offered.'; end if;
  if length(v_q) < 4 then raise exception 'Enter your reference''s email, mobile number or member number.'; end if;
  v_household := app.my_primary_household(p_center);
  v_digits := regexp_replace(v_q, '\D', '', 'g');
  return query
  select p.id, coalesce(p.preferred_name, p.first_name) || ' ' || p.last_name,
         (select h.display_name from app.household_members hm join app.households h on h.id = hm.household_id
           where hm.person_id = p.id and hm.left_at is null order by hm.is_primary desc limit 1),
         app.reference_problem(v_type, p.id, v_household) is null,
         app.reference_problem(v_type, p.id, v_household)
    from app.people p
   where p.center_id = p_center and p.merged_into_id is null and not p.is_deceased
     and (lower(p.email) = v_q or lower(p.member_number) = v_q
          or exists (select 1 from app.person_emails e where e.person_id = p.id and lower(e.email) = v_q)
          or (length(v_digits) >= 10 and regexp_replace(coalesce(p.phone_e164, ''), '\D', '', 'g') like '%' || right(v_digits, 10)))
   limit 3;
end $$;

create or replace function app.submit_membership_application(p_center uuid, p_type uuid, p_reference uuid, p_note text)
returns uuid language plpgsql security definer set search_path = app, public, extensions as $$
declare v_type app.membership_types; v_me uuid; v_household uuid; v_current app.membership_tier; v_problem text;
        v_rules jsonb; v_expiry int; v_prior int; v_id uuid; v_needs_ref boolean;
begin
  perform app.assert_module_enabled(p_center, 'membership');
  v_me := app.my_person_id(p_center);
  if v_me is null then raise exception 'Sign in and set up your family profile before applying.'; end if;
  if not app.i_am_adult(p_center) then raise exception 'Membership applications are made by an adult of the family.'; end if;
  v_household := app.my_primary_household(p_center);
  if v_household is null then raise exception 'Set up your family profile before applying.'; end if;
  select * into v_type from app.membership_types t where t.id = p_type and t.center_id = p_center and t.active;
  if v_type.id is null then raise exception 'That membership type is not offered.'; end if;
  v_current := app.household_active_tier(v_household);
  if v_current is not null and app.tier_rank(v_current) >= app.tier_rank(v_type.tier) then
    raise exception 'Your family already holds % membership.', initcap(v_current::text);
  end if;
  if exists (select 1 from app.membership_applications a where a.household_id = v_household
               and a.status in ('draft','awaiting_reference','reference_declined','awaiting_center','awaiting_ec')) then
    raise exception 'Your family already has an application in progress. The membership team will be in touch.';
  end if;
  select c.rules into v_rules from app.centers c where c.id = p_center;
  v_needs_ref := v_type.reference_required and coalesce((v_rules #>> '{membership,reference_required}')::boolean, true);
  if v_needs_ref then
    v_problem := app.reference_problem(v_type, p_reference, v_household);
    if v_problem is not null then raise exception '%', v_problem; end if;
  end if;
  v_prior := coalesce(nullif(v_rules #>> '{membership,life_prior_yearly_months}', '')::int, 0);
  if v_type.tier = 'life' and v_prior > 0 and not exists (
       select 1 from app.memberships m where m.household_id = v_household and m.tier = 'yearly'
          and m.starts_on <= (current_date - make_interval(months => v_prior))::date) then
    raise exception 'Life membership needs % months of Yearly membership first.', v_prior;
  end if;
  v_expiry := coalesce(nullif(v_rules #>> '{membership,reference_expiry_days}', '')::int, 14);
  insert into app.membership_applications (center_id, applicant_person_id, household_id, membership_type_id, tier,
      reference_person_id, reference_note, reference_requested_at, reference_expires_at, fee_cents, status)
  values (p_center, v_me, v_household, v_type.id, v_type.tier,
      case when v_needs_ref then p_reference end, nullif(left(trim(coalesce(p_note, '')), 500), ''),
      case when v_needs_ref then now() end, case when v_needs_ref then now() + make_interval(days => v_expiry) end,
      v_type.fee_cents, (case when v_needs_ref then 'awaiting_reference' else 'awaiting_center' end)::app.application_status)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.my_membership_application(p_center uuid)
returns table (application_id uuid, type_name text, tier app.membership_tier, status app.application_status,
               reference_name text, reference_decision text, fee_cents integer, created_at timestamptz,
               reference_expires_at timestamptz, center_reason text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if not app.module_enabled(p_center, 'membership') then return; end if;
  return query
  select a.id, t.name, a.tier, a.status, coalesce(r.preferred_name, r.first_name) || ' ' || r.last_name,
         a.reference_decision, a.fee_cents, a.created_at, a.reference_expires_at,
         case when a.status = 'rejected' then a.center_reason end
    from app.membership_applications a
    join app.membership_types t on t.id = a.membership_type_id
    left join app.people r on r.id = a.reference_person_id
   where a.center_id = p_center and a.household_id in (select app.my_household_ids(p_center))
   order by a.created_at desc limit 1;
end $$;

-- Approval creates the membership and records the fee.
create or replace function app.grant_membership_on_approval() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_type app.membership_types; v_membership uuid; v_pledge uuid; v_note text; v_by uuid;
begin
  if new.status <> 'approved' or old.status = 'approved' or new.membership_id is not null then return new; end if;
  select * into v_type from app.membership_types where id = new.membership_type_id;
  v_by := coalesce(new.ec_decided_by, new.center_decided_by, auth.uid());
  update app.memberships set status = 'ended', ends_on = current_date
   where household_id = new.household_id and status = 'active';
  v_note := 'From application ' || upper(left(new.id::text, 8));
  insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on, ends_on, granted_by, notes)
  values (new.center_id, new.household_id, new.applicant_person_id, new.membership_type_id, new.tier, 'active', current_date,
          case when v_type.period_months is not null then (current_date + make_interval(months => v_type.period_months))::date end,
          v_by, v_note)
  returning id into v_membership;
  if new.fee_cents > 0 then
    if app.module_enabled(new.center_id, 'giving') then
      insert into app.pledges (center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, status, due_on, created_by)
      values (new.center_id, new.household_id, new.applicant_person_id, 'membership_fee', v_membership, new.fee_cents, 'open', current_date + 30, v_by)
      returning id into v_pledge;
      update app.memberships set fee_pledge_id = v_pledge where id = v_membership;
    else
      update app.memberships set notes = v_note || ' · fee of ' || to_char(new.fee_cents / 100.0, 'FM999,999,990.00')
                                 || ' not recorded: Pledges & donations is switched off' where id = v_membership;
    end if;
  end if;
  new.membership_id := v_membership;
  return new;
end $$;

drop trigger if exists membership_applications_zz_grant on app.membership_applications;
create trigger membership_applications_zz_grant before update on app.membership_applications
  for each row execute function app.grant_membership_on_approval();

revoke execute on function app.find_membership_reference(uuid, uuid, text), app.submit_membership_application(uuid, uuid, uuid, text),
  app.my_membership_application(uuid), app.reference_problem(app.membership_types, uuid, uuid),
  app.household_active_tier(uuid), app.my_primary_household(uuid), app.grant_membership_on_approval() from public, anon;
grant execute on function app.find_membership_reference(uuid, uuid, text), app.submit_membership_application(uuid, uuid, uuid, text),
  app.my_membership_application(uuid), app.tier_rank(app.membership_tier) to authenticated;
grant execute on all functions in schema app to service_role;
