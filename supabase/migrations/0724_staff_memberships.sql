-- 0724 · Staff memberships from the person slide-over (People redesign, docs/PEOPLE_REDESIGN.md section 4, "Memberships").
--
-- !! READ THIS FIRST — WHAT THIS ADDS, AND WHAT IT SKIPS !!
--   Owner decision 2026-10-13: staff who hold BOTH people.approve AND people.manage may
--     (1) change a family's tier                (already exists: app.change_household_tier, unchanged here),
--     (2) edit the start date, end date and note of an existing membership, with a reason,
--     (3) assign a NEW membership with NO fee recorded,
--     (4) assign a NEW membership AND record its fee as an open pledge, exactly as an approved application does.
--
--   A STAFF-ASSIGNED MEMBERSHIP SKIPS THE EXECUTIVE COMMITTEE STEP. It is ACTIVE AT ONCE for every tier, INCLUDING LIFE.
--   An application for a Life membership (or for a type with ec_approval_required) still needs the Executive Committee through
--   app.membership_applications (0017 / 0501); NONE of that applies here, because no application exists. This is the owner's
--   explicit choice. The safeguards are: the two permissions together (the same gate as the tier change), a reason that is
--   required on every call, and the audit log (every row written carries the caller, the reason and the old and new values).
--
-- THE TWO FUNCTIONS (both SECURITY DEFINER, search_path = app, public, extensions)
--   app.staff_update_membership(membership, starts_on, ends_on, notes, reason)         edits ONLY starts_on, ends_on and notes
--   app.staff_assign_membership(household, holder, type, starts_on, ends_on, reason, record_fee)  returns the new membership id
--
-- WHY SECURITY DEFINER
--   Today the memberships table is writable by anyone holding people.manage alone (memberships_staff_write, 0010), and the pledge a
--   fee needs is written by the approval trigger as the table owner. These functions are the ONLY path that needs BOTH
--   permissions, so they cannot be SECURITY INVOKER (people.manage alone would be enough for the table, people.approve for
--   nothing). Each does its own checks FIRST and in this order: the row's own community, people.approve AND people.manage in
--   THAT community (platform admins pass has_permission, as everywhere), the Membership module, a non-empty reason. Nothing is
--   read from or written to another community. EXECUTE goes to `authenticated` only: not to anon, not to service_role, not to
--   the worker (there is deliberately NO `grant execute on all functions in schema app to service_role` in this file).
--
-- THE RULES THIS FILE DECIDES (from the existing data model; no new status, no new table, no new permission)
--   "Live" means what the rest of the system already means (app.household_active_tier, 0586 access levels, the Pathshala trigger):
--   status = 'active' AND (ends_on is null OR ends_on >= today). Nothing in the system flips an expired membership's status by
--   itself (there is no lapse job); a yearly membership simply stops counting after its end date.
--   "Today" is the community's own date (centers.time_zone), not the database's.
--
--   EDIT (staff_update_membership)
--     * Only starts_on, ends_on and notes change. Never tier, status, type, household, holder, fee or pledge.
--     * ends_on >= starts_on. The note is kept as given (blank clears it), at most 1000 characters. The reason is at most 500.
--     * Nothing to change is refused (so the audit log never fills with no-op edits).
--     * An ACTIVE membership has started, so its start date cannot move into the future.
--     * An ACTIVE membership cannot be given an end date in the past. That would silently end it, which is what Change tier
--       (or an end date of today) is for: "today" keeps it live through today and it stops counting after, the same way a
--       tier change ends the old membership (ends_on = today). The status is NEVER touched here.
--     * An ENDED or LAPSED membership keeps an end date, and that date cannot be in the future.
--     * A membership of a fixed-term type (period_months set, e.g. a yearly one) cannot have its end date cleared: that would make
--       it a lifetime membership without a Life tier decision. Use Change tier.
--     * An ACTIVE membership may not overlap another ACTIVE one of the same family. Sharing a single boundary day is fine (a tier
--       change ends the old membership today and starts the new one today).
--     * Only a value that is being CHANGED is checked against "today" (a membership imported with an odd date can still have its
--       note corrected).
--
--   ASSIGN (staff_assign_membership)
--     * The family must exist and not be merged. The holder, when given, must be a CURRENT, ADULT (app.person_is_minor), living
--       member of THAT family; a child is never the holder. No holder (null) is allowed, as it is for imported memberships.
--     * The type must belong to the family's community and be active; the tier comes from the type.
--     * The family must have NO live membership. (Changing the tier of a family that has one is app.change_household_tier.)
--       A membership that is active in status but past its end date is not live: it is marked 'lapsed' (its own end date kept),
--       the way the data already says "it ran out and was not renewed" (0312, the import's Expired -> lapsed), so that at most one
--       row is 'active' per family. This is the only status written, and only on such expired rows.
--     * The new membership is 'active' at once, starts today or earlier (never in the future), and ends on the given date or, when
--       none is given and the type has a period (period_months), start + period_months months, exactly as the approval path
--       counts from its start. An end date that has already passed is refused. granted_by = the caller; notes = 'Assigned by
--       staff: <reason>'.
--     * FEE. When record_fee is true AND the type's fee_cents > 0 AND Pledges & donations is on, ONE open pledge is created the
--       way app.grant_membership_on_approval() (0130) creates it: source 'membership_fee', source_ref_id = the membership,
--       amount_cents = the type's fee_cents (integer cents), status 'open', due_on = current_date + 30, pledged_by_person_id =
--       the holder (else the family's primary adult), created_by = the caller; the membership's fee_pledge_id points at it.
--       When record_fee is true but there is no fee, or Pledges & donations is off, NO pledge is created and the call does not
--       fail: with a fee and the module off the note says so, in the approval path's own words ("fee of 500.00 not recorded:
--       Pledges & donations is switched off"). The caller sees what happened in memberships.fee_pledge_id (null = no pledge).
--       When record_fee is false, or null, NO pledge is ever created.
--
--   AUDIT. Both call app.set_audit_context(reason) before writing, so every row they touch (memberships, the pledge, and the
--   rows marked lapsed) carries that reason through the table audit triggers (0102), with the caller as the actor.
--
-- KEPT AS THEY ARE: the Pathshala trigger pathshala_membership_active (0591) fires on the insert / the ends_on update these functions
-- make (a family's membership becoming live lifts its learners' membership holds); app.change_household_tier still works after.
-- Idempotent: create or replace.

-- ---------------------------------------------------------------------------------------------------------------------------
-- Edit the dates and note of a membership.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function app.staff_update_membership(
  p_membership uuid, p_starts_on date, p_ends_on date, p_notes text, p_reason text
) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_center uuid;
  v_m app.memberships;
  v_type app.membership_types;
  v_o app.memberships;
  v_tz text;
  v_today date;
  v_reason text := app.audit_clean_reason(p_reason);
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  -- 1. The row's own community, then the two permissions in THAT community.
  select m.center_id into v_center from app.memberships m where m.id = p_membership;
  if v_center is null then
    raise exception 'That membership was not found' using errcode = '22023';
  end if;
  if auth.uid() is null or not app.has_permission(v_center, 'people.approve') or not app.has_permission(v_center, 'people.manage') then
    raise exception 'Editing a membership needs the people.approve and people.manage permissions' using errcode = 'insufficient_privilege';
  end if;
  -- 2. The Membership module.
  perform app.assert_module_enabled(v_center, 'membership');
  -- 3. A reason, always.
  if v_reason is null then
    raise exception 'Say why the membership is being changed; the reason is kept in the audit log' using errcode = '22023';
  end if;
  if char_length(btrim(p_reason)) > 500 then
    raise exception 'The reason is too long (500 characters at most)' using errcode = '22023';
  end if;

  select * into v_m from app.memberships where id = p_membership for update;
  select * into v_type from app.membership_types where id = v_m.membership_type_id;
  select coalesce(nullif(btrim(c.time_zone), ''), 'UTC') into v_tz from app.centers c where c.id = v_center;
  v_today := (now() at time zone v_tz)::date;

  -- 4. The dates and the note.
  if p_starts_on is null then
    raise exception 'Choose the date the membership starts' using errcode = '22023';
  end if;
  if p_starts_on < date '1900-01-01' or p_starts_on > date '2200-12-31'
     or (p_ends_on is not null and (p_ends_on < date '1900-01-01' or p_ends_on > date '2200-12-31')) then
    raise exception 'Check the dates: they must fall between the years 1900 and 2200' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < p_starts_on then
    raise exception 'The end date cannot be before the start date' using errcode = '22023';
  end if;
  if char_length(coalesce(v_notes, '')) > 1000 then
    raise exception 'The note is too long (1,000 characters at most)' using errcode = '22023';
  end if;
  if p_starts_on is not distinct from v_m.starts_on and p_ends_on is not distinct from v_m.ends_on
     and v_notes is not distinct from nullif(btrim(coalesce(v_m.notes, '')), '') then
    raise exception 'Nothing was changed: the dates and the note are the same as before' using errcode = '22023';
  end if;

  -- 5. What the membership's status allows. Only a value that is being changed is checked.
  if v_m.status = 'active' then
    if p_starts_on is distinct from v_m.starts_on and p_starts_on > v_today then
      raise exception 'An active membership has already started, so it cannot start in the future. Choose today or an earlier date' using errcode = '22023';
    end if;
    if p_ends_on is distinct from v_m.ends_on and p_ends_on is not null and p_ends_on < v_today then
      raise exception 'An active membership cannot be given an end date in the past. To end it today, choose today as the end date: it counts until the end of today. To move the family to a different tier, use Change tier' using errcode = '22023';
    end if;
  elsif v_m.status in ('ended', 'lapsed') then
    if p_ends_on is null then
      raise exception 'This membership has ended, so it keeps an end date' using errcode = '22023';
    end if;
    if p_ends_on is distinct from v_m.ends_on and p_ends_on > v_today then
      raise exception 'An ended membership cannot end in the future' using errcode = '22023';
    end if;
  end if;
  if p_ends_on is null and v_m.ends_on is not null and v_type.period_months is not null and v_m.status <> 'ended' and v_m.status <> 'lapsed' then
    raise exception 'This kind of membership runs for a set period, so it needs an end date. To make a family a lifetime member, use Change tier' using errcode = '22023';
  end if;

  -- 6. Two active memberships of one family may not overlap (a shared boundary day is fine).
  if v_m.status = 'active' and (p_starts_on is distinct from v_m.starts_on or p_ends_on is distinct from v_m.ends_on) then
    select o.* into v_o from app.memberships o
     where o.household_id = v_m.household_id and o.id <> v_m.id and o.status = 'active'
       and o.starts_on < coalesce(p_ends_on, 'infinity'::date) and p_starts_on < coalesce(o.ends_on, 'infinity'::date)
     order by o.starts_on desc limit 1;
    if v_o.id is not null then
      raise exception 'This family has another active % membership (from % to %) that overlaps those dates. To replace a membership, use Change tier; two active memberships cannot overlap',
        initcap(v_o.tier::text), to_char(v_o.starts_on, 'FMMon FMDD, YYYY'),
        case when v_o.ends_on is null then 'no end date' else to_char(v_o.ends_on, 'FMMon FMDD, YYYY') end using errcode = '22023';
    end if;
  end if;

  -- 7. Write: ONLY the three columns, under the reason.
  perform app.set_audit_context(v_reason);
  update app.memberships set starts_on = p_starts_on, ends_on = p_ends_on, notes = v_notes where id = v_m.id;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Assign a new membership to a family. ACTIVE AT ONCE, NO EXECUTIVE COMMITTEE STEP (owner decision 2026-10-13), a reason always.
-- Returns the new membership's id; read memberships.fee_pledge_id afterwards to know whether a fee pledge was recorded.
-- ---------------------------------------------------------------------------------------------------------------------------
create or replace function app.staff_assign_membership(
  p_household uuid, p_person uuid, p_type uuid, p_starts_on date, p_ends_on date, p_reason text, p_record_fee boolean
) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare
  v_center uuid;
  v_merged uuid;
  v_type app.membership_types;
  v_live app.memberships;
  v_tz text;
  v_today date;
  v_start date;
  v_end date;
  v_reason text := app.audit_clean_reason(p_reason);
  v_note text;
  v_giving boolean;
  v_pledge_by uuid;
  v_membership uuid;
  v_pledge uuid;
begin
  -- 1. The family's own community, then the two permissions in THAT community.
  select h.center_id, h.merged_into_id into v_center, v_merged from app.households h where h.id = p_household;
  if v_center is null then
    raise exception 'That household was not found' using errcode = '22023';
  end if;
  if auth.uid() is null or not app.has_permission(v_center, 'people.approve') or not app.has_permission(v_center, 'people.manage') then
    raise exception 'Assigning a membership needs the people.approve and people.manage permissions' using errcode = 'insufficient_privilege';
  end if;
  -- 2. The Membership module.
  perform app.assert_module_enabled(v_center, 'membership');
  -- 3. A reason, always.
  if v_reason is null then
    raise exception 'Say why the membership is being assigned; the reason is kept in the audit log' using errcode = '22023';
  end if;
  if char_length(btrim(p_reason)) > 500 then
    raise exception 'The reason is too long (500 characters at most)' using errcode = '22023';
  end if;

  -- 4. The family, the type and the holder (all inside the one community).
  if v_merged is not null then
    raise exception 'That household was merged into another household. Assign the membership to that one instead' using errcode = '22023';
  end if;
  -- Serialise two assignments to one family, so that two staff members cannot both pass the "no live membership" check.
  perform 1 from app.households h where h.id = p_household for update;
  select * into v_type from app.membership_types t where t.id = p_type and t.center_id = v_center and t.active;
  if v_type.id is null then
    raise exception 'That membership type was not found, or it is not offered any more' using errcode = '22023';
  end if;
  if p_person is not null then
    if not exists (select 1 from app.household_members hm join app.people p on p.id = hm.person_id
                    where hm.household_id = p_household and hm.person_id = p_person and hm.left_at is null
                      and p.center_id = v_center and p.merged_into_id is null) then
      raise exception 'The holder must be a current member of this household' using errcode = '22023';
    end if;
    if exists (select 1 from app.people p where p.id = p_person and p.is_deceased) then
      raise exception 'A person recorded as deceased cannot hold a membership' using errcode = '22023';
    end if;
    if app.person_is_minor(p_person) then
      raise exception 'A child cannot be the holder of a membership. Choose an adult of the family' using errcode = '22023';
    end if;
  end if;

  -- 5. The dates, in the community's own today. Active at once, so it cannot start in the future.
  select coalesce(nullif(btrim(c.time_zone), ''), 'UTC') into v_tz from app.centers c where c.id = v_center;
  v_today := (now() at time zone v_tz)::date;
  v_start := coalesce(p_starts_on, v_today);
  if v_start > v_today then
    raise exception 'A membership assigned by staff is active at once, so it cannot start in the future. Choose today or an earlier date' using errcode = '22023';
  end if;
  if v_start < date '1900-01-01' or (p_ends_on is not null and (p_ends_on < date '1900-01-01' or p_ends_on > date '2200-12-31')) then
    raise exception 'Check the dates: they must fall between the years 1900 and 2200' using errcode = '22023';
  end if;
  v_end := coalesce(p_ends_on, case when v_type.period_months is not null then (v_start + make_interval(months => v_type.period_months))::date end);
  if v_end is not null and v_end < v_start then
    raise exception 'The end date cannot be before the start date' using errcode = '22023';
  end if;
  if v_end is not null and v_end < v_today then
    raise exception 'That end date has already passed, so the membership would be over as soon as it begins. Choose a later end date' using errcode = '22023';
  end if;

  -- 6. Not when the family already has a live membership: the tier change is the way to change it.
  select m.* into v_live from app.memberships m
   where m.household_id = p_household and m.status = 'active' and (m.ends_on is null or m.ends_on >= v_today)
   order by app.tier_rank(m.tier) desc, m.starts_on desc limit 1;
  if v_live.id is not null then
    raise exception 'This family already has an active % membership (since %). To move it to a different tier, use Change tier; to correct its dates, edit the membership',
      initcap(v_live.tier::text), to_char(v_live.starts_on, 'FMMon FMDD, YYYY') using errcode = '22023';
  end if;

  -- 7. Write, under the reason. Rows that are 'active' but past their end date are marked lapsed (their own end date stays).
  perform app.set_audit_context(v_reason);
  update app.memberships set status = 'lapsed' where household_id = p_household and status = 'active';

  v_note := 'Assigned by staff: ' || btrim(p_reason);
  v_giving := app.module_enabled(v_center, 'giving');
  if coalesce(p_record_fee, false) and v_type.fee_cents > 0 and not v_giving then
    v_note := v_note || ' · fee of ' || to_char(v_type.fee_cents / 100.0, 'FM999,999,990.00') || ' not recorded: Pledges & donations is switched off';
  end if;

  insert into app.memberships (center_id, household_id, person_id, membership_type_id, tier, status, starts_on, ends_on, granted_by, notes)
  values (v_center, p_household, p_person, v_type.id, v_type.tier, 'active', v_start, v_end, auth.uid(), v_note)
  returning id into v_membership;

  -- 8. The fee, only when asked for, only when there is one, only with Pledges & donations on: the same pledge the approval path makes.
  if coalesce(p_record_fee, false) and v_type.fee_cents > 0 and v_giving then
    v_pledge_by := coalesce(p_person,
      (select hm.person_id from app.household_members hm
        where hm.household_id = p_household and hm.is_primary and hm.left_at is null limit 1));
    insert into app.pledges (center_id, household_id, pledged_by_person_id, source, source_ref_id, amount_cents, status, due_on, created_by)
    values (v_center, p_household, v_pledge_by, 'membership_fee', v_membership, v_type.fee_cents, 'open', current_date + 30, auth.uid())
    returning id into v_pledge;
    update app.memberships set fee_pledge_id = v_pledge where id = v_membership;
  end if;
  return v_membership;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- Who may call them: signed-in people only (they are then checked inside). Not anon, not the service key, not the worker.
-- ---------------------------------------------------------------------------------------------------------------------------
revoke execute on function app.staff_update_membership(uuid, date, date, text, text),
  app.staff_assign_membership(uuid, uuid, uuid, date, date, text, boolean) from public, anon, service_role;
grant execute on function app.staff_update_membership(uuid, date, date, text, text),
  app.staff_assign_membership(uuid, uuid, uuid, date, date, text, boolean) to authenticated;

comment on function app.staff_update_membership(uuid, date, date, text, text) is
  'Edits ONLY the start date, end date and note of a membership. Needs people.approve AND people.manage in the membership''s community, the Membership module and a reason; audited. Never changes tier, status, type, household, fee or pledge.';
comment on function app.staff_assign_membership(uuid, uuid, uuid, date, date, text, boolean) is
  'Assigns a new membership to a family: ACTIVE AT ONCE for every tier including life, with NO Executive Committee step (owner decision 2026-10-13). Needs people.approve AND people.manage, the Membership module and a reason; audited. Optionally records the fee as an open membership_fee pledge exactly as app.grant_membership_on_approval does.';

-- ---------------------------------------------------------------------------------------------------------------------------
-- Activity: the portal's two screen actions, in the allowlist (like 0720 and 0722). The tier change keeps its existing key
-- (people.update_household).
-- ---------------------------------------------------------------------------------------------------------------------------
select app.activity_register(v.k, 'action', 'portal', v.l, v.e)
  from (values
    ('people.edit_membership',   'Edit the dates or note of a membership', 'household'),
    ('people.assign_membership', 'Assign a membership to a family',        'household')
  ) as v(k, l, e);
