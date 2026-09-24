-- 0010_rls.sql
-- Row-level security for every table in schema app.
--
-- Model (docs/ROLES.md): access = role + scope + relationship.
--   * Center isolation: every policy is anchored on the row's center_id.
--   * Staff access: app.has_permission(center, 'module.action') — only
--     CENTER-WIDE grants count here. Scoped grants (one event, one class,
--     one zone) are checked with app.has_scoped_role(center, scope_id, ...).
--   * Family access: households the caller belongs to; adults act for the
--     household, children only for themselves; money is adults-only.
--   * Anything not granted is denied (RLS default).
-- Permissive policies OR together, so each table gets a small set of
-- independent read/write policies.

-- Center-wide grants only (scoped grants must not leak center-wide rights).
create or replace function app.has_permission(p_center uuid, p_perm text) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.is_platform_admin()
      or exists (
        select 1 from app.role_grants g
        join app.roles r on r.key = g.role_key
        where g.center_id = p_center and g.user_id = auth.uid()
          and g.scope_kind in ('center','platform')
          and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now())
          and r.permissions ? p_perm)
$$;

-- Is this household one of mine?
create or replace function app.in_my_household(p_center uuid, p_household uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select p_household in (select app.my_household_ids(p_center))
$$;

-- Adult of this household (money, RSVPs, pledges are adults-only).
create or replace function app.adult_of_household(p_center uuid, p_household uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select app.in_my_household(p_center, p_household) and app.i_am_adult(p_center)
$$;

-- Is this person me, or (when I am an adult) someone in one of my households?
create or replace function app.can_act_for_person(p_center uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select p_person = app.my_person_id(p_center)
      or (app.i_am_adult(p_center) and exists (
            select 1 from app.household_members hm
            where hm.person_id = p_person and hm.left_at is null
              and hm.household_id in (select app.my_household_ids(p_center))))
$$;

-- Can I SEE this person (me or anyone in my households, adult or not)?
create or replace function app.same_household_person(p_center uuid, p_person uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select p_person = app.my_person_id(p_center)
      or exists (
        select 1 from app.household_members hm
        where hm.person_id = p_person and hm.left_at is null
          and hm.household_id in (select app.my_household_ids(p_center)))
$$;

-- Enable RLS everywhere in the schema.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'app' loop
    execute format('alter table app.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Helper that stamps the two standard staff policies on a table:
--   <t>_staff_read  : select for view_perm OR manage_perm holders
--   <t>_staff_write : all for manage_perm holders
create or replace function app._staff_policies(p_table text, p_view text, p_manage text) returns void
language plpgsql as $$
begin
  execute format($f$create policy %1$s_staff_read on app.%1$I for select to authenticated
    using (app.has_permission(center_id, %2$L) or app.has_permission(center_id, %3$L))$f$, p_table, p_view, p_manage);
  execute format($f$create policy %1$s_staff_write on app.%1$I for all to authenticated
    using (app.has_permission(center_id, %2$L)) with check (app.has_permission(center_id, %2$L))$f$, p_table, p_manage);
end $$;

-- Members-can-read helper
create or replace function app._member_read(p_table text, p_extra text default 'true') returns void
language plpgsql as $$
begin
  execute format($f$create policy %1$s_member_read on app.%1$I for select to authenticated
    using (app.is_member_of(center_id) and (%2$s))$f$, p_table, p_extra);
end $$;

-- ===========================================================================
-- Tenancy, identity
-- ===========================================================================
-- Centers are discoverable (center picker, guest pages); only non-secret config lives here.
create policy centers_public_read on app.centers for select to anon, authenticated using (status in ('active','onboarding'));
create policy centers_admin_update on app.centers for update to authenticated
  using (app.has_permission(id, 'settings.manage')) with check (app.has_permission(id, 'settings.manage'));
create policy centers_platform_all on app.centers for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

create policy zones_public_read on app.zones for select to anon, authenticated using (true);
select app._staff_policies('zones', 'settings.manage', 'settings.manage');

-- Households: my own, staff with people.view, zone leads for their zone.
create policy households_mine on app.households for select to authenticated
  using (app.in_my_household(center_id, id));
create policy households_adult_update on app.households for update to authenticated
  using (app.adult_of_household(center_id, id)) with check (app.adult_of_household(center_id, id));
create policy households_zone_lead on app.households for select to authenticated
  using (zone_id is not null and app.has_scoped_role(center_id, zone_id, 'zone_lead'));
select app._staff_policies('households', 'people.view', 'people.manage');

create policy people_household on app.people for select to authenticated
  using (app.same_household_person(center_id, id));
create policy people_self_or_guardian_update on app.people for update to authenticated
  using (app.can_act_for_person(center_id, id)) with check (app.can_act_for_person(center_id, id));
select app._staff_policies('people', 'people.view', 'people.manage');
-- Teachers see the students on their own class rosters (not parents' contacts:
-- parent communication goes through class announcements and the parent inbox).
create policy people_teacher_roster on app.people for select to authenticated
  using (exists (select 1 from app.pathshala_enrollments e
                 where e.student_person_id = people.id and e.class_id is not null
                   and e.status in ('placed','active','waitlisted')
                   and app.has_scoped_role(e.center_id, e.class_id, 'teacher')));
-- Pathshala principal: students and the adults of their households.
create policy people_pathshala on app.people for select to authenticated
  using (app.has_permission(center_id, 'pathshala.manage') and exists (
    select 1 from app.pathshala_enrollments e
    join app.household_members hm on hm.household_id = e.household_id
    where hm.person_id = people.id and e.center_id = people.center_id));

create policy household_members_mine on app.household_members for select to authenticated
  using (app.in_my_household(center_id, household_id));
select app._staff_policies('household_members', 'people.view', 'people.manage');

create policy accounts_self on app.accounts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and is_platform_admin = false);
create policy accounts_platform on app.accounts for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

create policy center_users_self on app.center_users for select to authenticated using (user_id = auth.uid());
select app._staff_policies('center_users', 'people.view', 'roles.manage');

create policy roles_read on app.roles for select to authenticated using (true);
create policy roles_platform on app.roles for all to authenticated
  using (app.is_platform_admin()) with check (app.is_platform_admin());

create policy role_grants_self on app.role_grants for select to authenticated using (user_id = auth.uid());
select app._staff_policies('role_grants', 'roles.manage', 'roles.manage');

create policy legal_public_read on app.legal_documents for select to anon, authenticated
  using (published_at is not null);
create policy legal_manage on app.legal_documents for all to authenticated
  using (center_id is not null and app.has_permission(center_id, 'settings.manage'))
  with check (center_id is not null and app.has_permission(center_id, 'settings.manage'));

create policy consents_own on app.consents for select to authenticated
  using (app.can_act_for_person(center_id, person_id));
create policy consents_give on app.consents for insert to authenticated
  with check (app.can_act_for_person(center_id, person_id) and given_by_user = auth.uid());
select app._staff_policies('consents', 'privacy.manage', 'privacy.manage');

-- Audit: readable by audit.view holders; written only by security-definer functions/triggers.
create policy audit_read on app.audit_log for select to authenticated
  using (app.has_permission(center_id, 'audit.view') or app.is_platform_admin());

-- ===========================================================================
-- Memberships
-- ===========================================================================
create policy membership_types_public on app.membership_types for select to anon, authenticated using (active);
select app._staff_policies('membership_types', 'people.view', 'settings.manage');

create policy memberships_mine on app.memberships for select to authenticated
  using (app.in_my_household(center_id, household_id));
select app._staff_policies('memberships', 'people.view', 'people.manage');

create policy applications_applicant on app.membership_applications for select to authenticated
  using (app.adult_of_household(center_id, household_id));
create policy applications_applicant_insert on app.membership_applications for insert to authenticated
  with check (app.adult_of_household(center_id, household_id) and status in ('draft','awaiting_reference'));
select app._staff_policies('membership_applications', 'people.view', 'people.approve');
-- References act through app.decide_reference() (0011), which exposes only name/household/tier/note.

create policy eligibility_mine on app.eligibility_snapshots for select to authenticated
  using (app.same_household_person(center_id, person_id));
select app._staff_policies('eligibility_snapshots', 'people.view', 'people.approve');

select app._staff_policies('merge_candidates', 'people.manage', 'people.manage');

-- ===========================================================================
-- Giving
-- ===========================================================================
create policy funds_member_read on app.funds for select to authenticated using (app.is_member_of(center_id) and active);
select app._staff_policies('funds', 'giving.view', 'giving.manage');

create policy campaigns_member_read on app.campaigns for select to authenticated
  using (app.is_member_of(center_id) and status in ('published','closed'));
create policy campaigns_public_read on app.campaigns for select to anon using (status = 'published');
select app._staff_policies('campaigns', 'giving.view', 'giving.manage');

create policy opportunities_member_read on app.opportunities for select to authenticated
  using (app.is_member_of(center_id) and status in ('open','taken','closed'));
create policy opportunities_public_read on app.opportunities for select to anon using (status = 'open');
select app._staff_policies('opportunities', 'giving.view', 'giving.manage');

-- Pledges: adults of the household see and create family pledges; children never see pledges.
create policy pledges_household on app.pledges for select to authenticated
  using (app.adult_of_household(center_id, household_id));
create policy pledges_household_insert on app.pledges for insert to authenticated
  with check (app.adult_of_household(center_id, household_id)
              and status = 'open' and paid_cents = 0
              and source in ('rsvp_commitment','sponsorship','pujan','labh','construction','general','pathshala_fee','membership_fee'));
create policy pledges_event_lead on app.pledges for select to authenticated
  using (source = 'rsvp_commitment' and exists (
    select 1 from app.rsvps r where r.commitment_pledge_id = pledges.id
      and app.has_scoped_role(r.center_id, r.event_id, 'event_lead')));
select app._staff_policies('pledges', 'giving.view', 'giving.manage');
create policy pledges_finance_volunteer on app.pledges for select to authenticated
  using (app.has_permission(center_id, 'giving.record_offline'));

create policy payments_household on app.payments for select to authenticated
  using (app.adult_of_household(center_id, household_id));
select app._staff_policies('payments', 'giving.view', 'giving.manage');
create policy payments_offline_insert on app.payments for insert to authenticated
  with check (app.has_permission(center_id, 'giving.record_offline') and provider = 'offline'
              and status = 'captured' and recorded_by = auth.uid());
create policy payments_offline_read on app.payments for select to authenticated
  using (app.has_permission(center_id, 'giving.record_offline') and recorded_by = auth.uid());

create policy allocations_household on app.payment_allocations for select to authenticated
  using (exists (select 1 from app.payments p where p.id = payment_id and app.adult_of_household(p.center_id, p.household_id)));
select app._staff_policies('payment_allocations', 'giving.view', 'giving.manage');

create policy recurring_household on app.recurring_gifts for all to authenticated
  using (app.adult_of_household(center_id, household_id)) with check (app.adult_of_household(center_id, household_id));
select app._staff_policies('recurring_gifts', 'giving.view', 'giving.manage');

create policy statements_household on app.statements for select to authenticated
  using (app.adult_of_household(center_id, household_id));
select app._staff_policies('statements', 'giving.view', 'giving.manage');

-- Bolis: members see non-draft bolis; entries via app.place_boli_entry().
create policy bolis_member_read on app.bolis for select to authenticated
  using (app.is_member_of(center_id) and status <> 'draft');
select app._staff_policies('bolis', 'bolis.view', 'bolis.manage');
create policy bolis_recorder_read on app.bolis for select to authenticated
  using (event_id is not null and app.has_scoped_role(center_id, event_id, 'boli_recorder'));

create policy boli_entries_mine on app.boli_entries for select to authenticated
  using (app.adult_of_household(center_id, household_id));
select app._staff_policies('boli_entries', 'bolis.view', 'bolis.manage');
create policy boli_entries_recorder on app.boli_entries for insert to authenticated
  with check (is_in_person and entered_by = auth.uid() and exists (
    select 1 from app.bolis b where b.id = boli_id and b.kind = 'in_person'
      and (app.has_permission(b.center_id, 'bolis.record')
           or (b.event_id is not null and app.has_scoped_role(b.center_id, b.event_id, 'boli_recorder')))));

select app._staff_policies('counting_sessions', 'giving.view', 'giving.record_offline');
select app._staff_policies('valuables_register', 'giving.view', 'giving.manage');

-- ===========================================================================
-- Events
-- ===========================================================================
select app._staff_policies('event_templates', 'events.view', 'events.manage');
select app._staff_policies('event_template_items', 'events.view', 'events.manage');

create policy events_member_read on app.events for select to authenticated
  using (app.is_member_of(center_id) and not confidential and status in ('published','rsvp_closed','live','completed'));
create policy events_public_read on app.events for select to anon
  using (audience in ('public','members_and_guests') and status in ('published','rsvp_closed','live'));
create policy events_lead_read on app.events for select to authenticated
  using (app.has_scoped_role(center_id, id, 'event_lead', 'checkin_volunteer', 'boli_recorder', 'kitchen_lead'));
create policy events_lead_update on app.events for update to authenticated
  using (app.has_scoped_role(center_id, id, 'event_lead')) with check (app.has_scoped_role(center_id, id, 'event_lead'));
select app._staff_policies('events', 'events.view', 'events.manage');

create policy actions_owner on app.actions for select to authenticated
  using (owner_person_id = app.my_person_id(center_id) or app.my_person_id(center_id) = any (backup_owner_ids));
create policy actions_owner_update on app.actions for update to authenticated
  using (owner_person_id = app.my_person_id(center_id)) with check (owner_person_id = app.my_person_id(center_id));
create policy actions_event_lead on app.actions for all to authenticated
  using (event_id is not null and app.has_scoped_role(center_id, event_id, 'event_lead'))
  with check (event_id is not null and app.has_scoped_role(center_id, event_id, 'event_lead'));
create policy actions_staff_read on app.actions for select to authenticated
  using ((app.has_permission(center_id, 'events.view') or app.has_permission(center_id, 'events.manage'))
         and (not confidential or app.has_permission(center_id, 'events.confidential')));
create policy actions_staff_write on app.actions for all to authenticated
  using (app.has_permission(center_id, 'events.manage') and (not confidential or app.has_permission(center_id, 'events.confidential')))
  with check (app.has_permission(center_id, 'events.manage'));

create policy rsvps_household on app.rsvps for select to authenticated
  using (household_id is not null and app.in_my_household(center_id, household_id));
create policy rsvps_household_write on app.rsvps for insert to authenticated
  with check (household_id is not null and app.adult_of_household(center_id, household_id) and source = 'app');
create policy rsvps_household_update on app.rsvps for update to authenticated
  using (household_id is not null and app.adult_of_household(center_id, household_id))
  with check (household_id is not null and app.adult_of_household(center_id, household_id));
create policy rsvps_event_staff on app.rsvps for all to authenticated
  using (app.has_scoped_role(center_id, event_id, 'event_lead', 'checkin_volunteer'))
  with check (app.has_scoped_role(center_id, event_id, 'event_lead', 'checkin_volunteer'));
select app._staff_policies('rsvps', 'events.view', 'events.manage');

create policy attendees_household on app.attendees for select to authenticated
  using (exists (select 1 from app.rsvps r where r.id = rsvp_id and r.household_id is not null and app.in_my_household(r.center_id, r.household_id)));
create policy attendees_household_write on app.attendees for all to authenticated
  using (exists (select 1 from app.rsvps r where r.id = rsvp_id and r.household_id is not null and app.adult_of_household(r.center_id, r.household_id)))
  with check (exists (select 1 from app.rsvps r where r.id = rsvp_id and r.household_id is not null and app.adult_of_household(r.center_id, r.household_id))
              and checked_in_at is null and lunch_slot_id is null);
create policy attendees_event_staff on app.attendees for all to authenticated
  using (app.has_scoped_role(center_id, event_id, 'event_lead', 'checkin_volunteer', 'kitchen_lead'))
  with check (app.has_scoped_role(center_id, event_id, 'event_lead', 'checkin_volunteer'));
select app._staff_policies('attendees', 'events.view', 'events.manage');

create policy lunch_slots_member_read on app.lunch_slots for select to authenticated using (app.is_member_of(center_id));
create policy lunch_slots_event_staff on app.lunch_slots for all to authenticated
  using (app.has_scoped_role(center_id, event_id, 'event_lead', 'kitchen_lead'))
  with check (app.has_scoped_role(center_id, event_id, 'event_lead', 'kitchen_lead'));
select app._staff_policies('lunch_slots', 'events.view', 'events.manage');

create policy scan_log_event_staff on app.scan_log for all to authenticated
  using (app.has_scoped_role(center_id, event_id, 'event_lead', 'checkin_volunteer'))
  with check (app.has_scoped_role(center_id, event_id, 'event_lead', 'checkin_volunteer') and scanned_by = auth.uid());
select app._staff_policies('scan_log', 'events.view', 'events.manage');

select app._member_read('volunteer_groups');
select app._staff_policies('volunteer_groups', 'volunteers.view', 'volunteers.manage');

create policy volunteer_interests_own on app.volunteer_interests for all to authenticated
  using (app.can_act_for_person(center_id, person_id)) with check (app.can_act_for_person(center_id, person_id));
select app._staff_policies('volunteer_interests', 'volunteers.view', 'volunteers.manage');

select app._member_read('volunteer_shifts');
create policy volunteer_shifts_lead on app.volunteer_shifts for all to authenticated
  using (app.has_scoped_role(center_id, event_id, 'event_lead')) with check (app.has_scoped_role(center_id, event_id, 'event_lead'));
select app._staff_policies('volunteer_shifts', 'volunteers.view', 'volunteers.manage');

create policy volunteer_assignments_own on app.volunteer_assignments for select to authenticated
  using (app.can_act_for_person(center_id, person_id));
create policy volunteer_assignments_own_update on app.volunteer_assignments for update to authenticated
  using (app.can_act_for_person(center_id, person_id)) with check (app.can_act_for_person(center_id, person_id));
create policy volunteer_assignments_lead on app.volunteer_assignments for all to authenticated
  using (exists (select 1 from app.volunteer_shifts s where s.id = shift_id and app.has_scoped_role(s.center_id, s.event_id, 'event_lead')))
  with check (exists (select 1 from app.volunteer_shifts s where s.id = shift_id and app.has_scoped_role(s.center_id, s.event_id, 'event_lead')));
select app._staff_policies('volunteer_assignments', 'volunteers.view', 'volunteers.manage');

create policy background_checks_own on app.background_checks for select to authenticated
  using (person_id = app.my_person_id(center_id));
select app._staff_policies('background_checks', 'safety.view', 'safety.manage');

-- ===========================================================================
-- Store
-- ===========================================================================
create policy store_categories_public on app.store_categories for select to anon, authenticated using (true);
select app._staff_policies('store_categories', 'store.view', 'store.manage');
create policy store_items_public on app.store_items for select to anon, authenticated using (status = 'active');
select app._staff_policies('store_items', 'store.view', 'store.manage');
create policy pickup_windows_public on app.pickup_windows for select to anon, authenticated using (status = 'open');
select app._staff_policies('pickup_windows', 'store.view', 'store.manage');

create policy store_orders_household on app.store_orders for select to authenticated
  using (household_id is not null and app.adult_of_household(center_id, household_id));
create policy store_orders_household_insert on app.store_orders for insert to authenticated
  with check (household_id is not null and app.adult_of_household(center_id, household_id) and status in ('cart','placed') and payment_id is null);
create policy store_orders_household_update on app.store_orders for update to authenticated
  using (household_id is not null and app.adult_of_household(center_id, household_id) and status = 'cart')
  with check (household_id is not null and app.adult_of_household(center_id, household_id) and status in ('cart','placed') and payment_id is null);
create policy store_orders_pickup on app.store_orders for select to authenticated
  using (app.has_permission(center_id, 'store.pickup') or app.has_permission(center_id, 'kitchen.view'));
create policy store_orders_pickup_update on app.store_orders for update to authenticated
  using (app.has_permission(center_id, 'store.pickup')) with check (app.has_permission(center_id, 'store.pickup'));
select app._staff_policies('store_orders', 'store.view', 'store.manage');

create policy store_lines_household on app.store_order_lines for all to authenticated
  using (exists (select 1 from app.store_orders o where o.id = order_id and o.household_id is not null and app.adult_of_household(o.center_id, o.household_id)))
  with check (exists (select 1 from app.store_orders o where o.id = order_id and o.status = 'cart' and o.household_id is not null and app.adult_of_household(o.center_id, o.household_id)));
create policy store_lines_kitchen on app.store_order_lines for select to authenticated
  using (app.has_permission(center_id, 'store.pickup') or app.has_permission(center_id, 'kitchen.view'));
select app._staff_policies('store_order_lines', 'store.view', 'store.manage');

select app._staff_policies('inventory_movements', 'store.view', 'store.manage');

-- ===========================================================================
-- Pathshala
-- ===========================================================================
select app._member_read('pathshala_terms', 'status <> ''draft''');
select app._staff_policies('pathshala_terms', 'pathshala.view', 'pathshala.manage');
create policy pathshala_tracks_public on app.pathshala_tracks for select to anon, authenticated using (true);
select app._staff_policies('pathshala_tracks', 'pathshala.view', 'pathshala.manage');
create policy pathshala_levels_public on app.pathshala_levels for select to anon, authenticated using (true);
select app._staff_policies('pathshala_levels', 'pathshala.view', 'pathshala.manage');
select app._member_read('pathshala_classes');
select app._staff_policies('pathshala_classes', 'pathshala.view', 'pathshala.manage');
select app._member_read('pathshala_teachers');
select app._staff_policies('pathshala_teachers', 'pathshala.view', 'pathshala.manage');

create policy enrollments_household on app.pathshala_enrollments for select to authenticated
  using (app.in_my_household(center_id, household_id));
create policy enrollments_household_insert on app.pathshala_enrollments for insert to authenticated
  with check (app.adult_of_household(center_id, household_id) and status = 'requested' and class_id is null);
create policy enrollments_teacher on app.pathshala_enrollments for select to authenticated
  using (class_id is not null and app.has_scoped_role(center_id, class_id, 'teacher'));
select app._staff_policies('pathshala_enrollments', 'pathshala.view', 'pathshala.manage');

create policy sessions_teacher on app.pathshala_sessions for all to authenticated
  using (app.has_scoped_role(center_id, class_id, 'teacher')) with check (app.has_scoped_role(center_id, class_id, 'teacher'));
select app._staff_policies('pathshala_sessions', 'pathshala.view', 'pathshala.manage');

create policy attendance_household on app.pathshala_attendance for select to authenticated
  using (exists (select 1 from app.pathshala_enrollments e where e.id = enrollment_id and app.in_my_household(e.center_id, e.household_id)));
create policy attendance_teacher on app.pathshala_attendance for all to authenticated
  using (exists (select 1 from app.pathshala_sessions s where s.id = session_id and app.has_scoped_role(s.center_id, s.class_id, 'teacher')))
  with check (exists (select 1 from app.pathshala_sessions s where s.id = session_id and app.has_scoped_role(s.center_id, s.class_id, 'teacher')));
select app._staff_policies('pathshala_attendance', 'pathshala.view', 'pathshala.manage');

create policy progress_household on app.pathshala_progress_reports for select to authenticated
  using (published_at is not null and exists (select 1 from app.pathshala_enrollments e where e.id = enrollment_id and app.in_my_household(e.center_id, e.household_id)));
create policy progress_teacher on app.pathshala_progress_reports for all to authenticated
  using (exists (select 1 from app.pathshala_enrollments e where e.id = enrollment_id and e.class_id is not null and app.has_scoped_role(e.center_id, e.class_id, 'teacher')))
  with check (exists (select 1 from app.pathshala_enrollments e where e.id = enrollment_id and e.class_id is not null and app.has_scoped_role(e.center_id, e.class_id, 'teacher')));
select app._staff_policies('pathshala_progress_reports', 'pathshala.view', 'pathshala.manage');

-- Class announcements: families with a student in the class (or the whole term when class is null).
create policy announcements_parents on app.class_announcements for select to authenticated
  using (published_at is not null and exists (
    select 1 from app.pathshala_enrollments e
    where e.center_id = class_announcements.center_id
      and ((class_announcements.class_id is not null and e.class_id = class_announcements.class_id)
           or (class_announcements.class_id is null and e.term_id = class_announcements.term_id))
      and app.in_my_household(e.center_id, e.household_id)));
create policy announcements_teacher on app.class_announcements for all to authenticated
  using (class_id is not null and app.has_scoped_role(center_id, class_id, 'teacher'))
  with check (class_id is not null and app.has_scoped_role(center_id, class_id, 'teacher') and author_user = auth.uid());
select app._staff_policies('class_announcements', 'pathshala.view', 'pathshala.manage');

select app._member_read('teacher_positions', 'status = ''open''');
select app._staff_policies('teacher_positions', 'pathshala.view', 'pathshala.manage');
create policy teacher_apps_own on app.teacher_applications for select to authenticated
  using (person_id is not null and person_id = app.my_person_id(center_id));
create policy teacher_apps_insert on app.teacher_applications for insert to authenticated
  with check (person_id = app.my_person_id(center_id) and outcome = 'pending');
select app._staff_policies('teacher_applications', 'pathshala.manage', 'pathshala.manage');

create policy concerns_own on app.concerns for select to authenticated
  using (submitter_person_id is not null and submitter_person_id = app.my_person_id(center_id));
create policy concerns_insert on app.concerns for insert to authenticated
  with check (app.is_member_of(center_id) and status = 'reported' and submitter_person_id = app.my_person_id(center_id));
create policy concerns_owner on app.concerns for all to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
select app._staff_policies('concerns', 'pathshala.view', 'pathshala.manage');

select app._staff_policies('resolutions', 'governance.view', 'governance.manage');
select app._staff_policies('resolution_comments', 'governance.view', 'governance.manage');
create policy resolution_comments_author on app.resolution_comments for all to authenticated
  using (author_user = auth.uid() and app.has_permission(center_id, 'governance.view'))
  with check (author_user = auth.uid() and app.has_permission(center_id, 'governance.view'));
select app._staff_policies('resolution_votes', 'governance.view', 'governance.manage');
create policy resolution_votes_own on app.resolution_votes for all to authenticated
  using (voter_user = auth.uid() and app.has_permission(center_id, 'governance.vote'))
  with check (voter_user = auth.uid() and app.has_permission(center_id, 'governance.vote'));

-- ===========================================================================
-- Content, learning, calendar
-- ===========================================================================
create policy content_published on app.content_items for select to anon, authenticated
  using (status = 'published' and (center_id is null or app.is_member_of(center_id) or kind in ('guide_page','faq')));
create policy content_editor_draft on app.content_items for all to authenticated
  using (center_id is not null and app.has_permission(center_id, 'content.draft') and status in ('draft','in_review'))
  with check (center_id is not null and app.has_permission(center_id, 'content.draft') and status in ('draft','in_review'));
create policy content_manage on app.content_items for all to authenticated
  using (center_id is not null and app.has_permission(center_id, 'content.manage'))
  with check (center_id is not null and app.has_permission(center_id, 'content.manage'));
create policy content_platform on app.content_items for all to authenticated
  using (center_id is null and app.is_platform_admin()) with check (center_id is null and app.is_platform_admin());

select app._member_read('photo_albums', 'visibility in (''public'',''members'')');
create policy photo_albums_public on app.photo_albums for select to anon using (visibility = 'public');
select app._staff_policies('photo_albums', 'content.manage', 'content.manage');
select app._member_read('photos', 'status = ''approved''');
create policy photos_uploader on app.photos for select to authenticated using (uploaded_by = auth.uid());
create policy photos_upload on app.photos for insert to authenticated
  with check (app.is_member_of(center_id) and uploaded_by = auth.uid() and status = 'pending');
select app._staff_policies('photos', 'content.manage', 'content.manage');

-- Shared catalogs (center_id null) are readable by everyone; center rows by members.
do $$
declare t text;
begin
  foreach t in array array['gyan_goals','practices','calendar_layers','calendar_entries','tithi_days'] loop
    execute format($f$create policy %1$s_read on app.%1$I for select to anon, authenticated
      using (center_id is null or app.is_member_of(center_id) or %2$s)$f$, t,
      case when t in ('calendar_layers','calendar_entries','tithi_days') then 'true' else 'false' end);
    execute format($f$create policy %1$s_manage on app.%1$I for all to authenticated
      using ((center_id is not null and app.has_permission(center_id, 'content.manage')) or app.is_platform_admin())
      with check ((center_id is not null and app.has_permission(center_id, 'content.manage')) or app.is_platform_admin())$f$, t);
  end loop;
end $$;

create policy gyan_levels_read on app.gyan_levels for select to anon, authenticated using (true);
create policy gyan_levels_manage on app.gyan_levels for all to authenticated
  using (exists (select 1 from app.gyan_goals g where g.id = goal_id and ((g.center_id is not null and app.has_permission(g.center_id, 'content.manage')) or app.is_platform_admin())))
  with check (exists (select 1 from app.gyan_goals g where g.id = goal_id and ((g.center_id is not null and app.has_permission(g.center_id, 'content.manage')) or app.is_platform_admin())));
create policy gyan_steps_read on app.gyan_steps for select to anon, authenticated using (true);
create policy gyan_steps_manage on app.gyan_steps for all to authenticated
  using (exists (select 1 from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where l.id = level_id
                 and ((g.center_id is not null and app.has_permission(g.center_id, 'content.manage')) or app.is_platform_admin())))
  with check (exists (select 1 from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where l.id = level_id
                 and ((g.center_id is not null and app.has_permission(g.center_id, 'content.manage')) or app.is_platform_admin())));

-- Personal learning data: the person, and parents for their children. Private otherwise.
create policy gyan_progress_own on app.gyan_progress for all to authenticated
  using (app.can_act_for_person(center_id, person_id)) with check (person_id = app.my_person_id(center_id));
create policy gyan_progress_teacher on app.gyan_progress for select to authenticated
  using (app.has_permission(center_id, 'pathshala.teach') or app.has_permission(center_id, 'pathshala.manage'));

create policy gyan_signoffs_own on app.gyan_signoffs for select to authenticated
  using (app.can_act_for_person(center_id, person_id));
create policy gyan_signoffs_request on app.gyan_signoffs for insert to authenticated
  with check (app.can_act_for_person(center_id, person_id) and status = 'requested' and teacher_user is null);
create policy gyan_signoffs_teacher on app.gyan_signoffs for all to authenticated
  using (app.has_permission(center_id, 'pathshala.teach') or app.has_permission(center_id, 'pathshala.manage')
         or exists (select 1 from app.pathshala_enrollments e where e.student_person_id = gyan_signoffs.person_id
                      and e.class_id is not null and app.has_scoped_role(e.center_id, e.class_id, 'teacher')))
  with check (teacher_user = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['practice_selections','practice_logs','streaks','saathi_settings'] loop
    execute format($f$create policy %1$s_own on app.%1$I for all to authenticated
      using (app.can_act_for_person(center_id, person_id)) with check (person_id = app.my_person_id(center_id))$f$, t);
  end loop;
end $$;

create policy points_own on app.points_ledger for select to authenticated using (app.can_act_for_person(center_id, person_id));

create policy anumodana_own on app.anumodana for select to authenticated
  using (from_person_id = app.my_person_id(center_id) or to_person_id = app.my_person_id(center_id));
create policy anumodana_send on app.anumodana for insert to authenticated
  with check (from_person_id = app.my_person_id(center_id) and app.same_household_person(center_id, to_person_id));

create policy daily_timings_public on app.daily_timings for select to anon, authenticated using (true);
select app._staff_policies('daily_timings', 'content.manage', 'content.manage');

-- Special days are private to the household (never staff-visible except as labh totals via reports).
create policy special_days_household on app.special_days for all to authenticated
  using (app.in_my_household(center_id, household_id)) with check (app.adult_of_household(center_id, household_id));

select app._member_read('labh_options', 'active');
select app._staff_policies('labh_options', 'giving.view', 'giving.manage');

create policy guide_public on app.guide_sections for select to anon, authenticated
  using (public or app.is_member_of(center_id));
select app._staff_policies('guide_sections', 'content.manage', 'content.manage');

create policy roster_public on app.role_roster for select to anon, authenticated using (true);
select app._staff_policies('role_roster', 'settings.manage', 'settings.manage');

create policy niva_own on app.niva_conversations for select to authenticated using (user_id = auth.uid());
create policy niva_insert on app.niva_conversations for insert to authenticated
  with check (user_id = auth.uid() and app.is_member_of(center_id));
select app._staff_policies('niva_conversations', 'content.manage', 'content.manage');

-- ===========================================================================
-- Communications
-- ===========================================================================
create policy topics_read on app.notification_topics for select to anon, authenticated using (true);

create policy prefs_own on app.notification_preferences for all to authenticated
  using (app.can_act_for_person(center_id, person_id)) with check (app.can_act_for_person(center_id, person_id));
create policy optins_own on app.channel_optins for select to authenticated using (app.can_act_for_person(center_id, person_id));
create policy optins_insert on app.channel_optins for insert to authenticated
  with check (app.can_act_for_person(center_id, person_id));
select app._staff_policies('channel_optins', 'comms.view', 'comms.send');

create policy push_devices_own on app.push_devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy templates_read on app.message_templates for select to authenticated
  using (center_id is null or app.has_permission(center_id, 'comms.send'));
create policy templates_manage on app.message_templates for all to authenticated
  using (center_id is not null and app.has_permission(center_id, 'comms.send'))
  with check (center_id is not null and app.has_permission(center_id, 'comms.send'));

create policy messages_own on app.messages for select to authenticated
  using (person_id is not null and person_id = app.my_person_id(center_id) and channel = 'in_app');
select app._staff_policies('messages', 'comms.view', 'comms.send');

create policy campaigns_archive on app.comms_campaigns for select to authenticated
  using (app.is_member_of(center_id) and status = 'sent' and kind in ('newsletter','announcement','pathshala_update','event'));
select app._staff_policies('comms_campaigns', 'comms.view', 'comms.send');
select app._staff_policies('saved_segments', 'comms.view', 'comms.send');

select app._member_read('inboxes');
select app._staff_policies('inboxes', 'comms.inbox', 'settings.manage');

create policy threads_own on app.threads for select to authenticated
  using (from_person_id is not null and from_person_id = app.my_person_id(center_id));
create policy threads_start on app.threads for insert to authenticated
  with check (from_person_id = app.my_person_id(center_id) and status = 'open' and assignee_user is null);
create policy threads_zone_lead on app.threads for all to authenticated
  using (exists (select 1 from app.inboxes i where i.id = inbox_id and i.zone_id is not null and app.has_scoped_role(i.center_id, i.zone_id, 'zone_lead')))
  with check (exists (select 1 from app.inboxes i where i.id = inbox_id and i.zone_id is not null and app.has_scoped_role(i.center_id, i.zone_id, 'zone_lead')));
select app._staff_policies('threads', 'comms.inbox', 'comms.inbox');

create policy thread_messages_own on app.thread_messages for select to authenticated
  using (exists (select 1 from app.threads t where t.id = thread_id and t.from_person_id = app.my_person_id(t.center_id)));
create policy thread_messages_reply on app.thread_messages for insert to authenticated
  with check (author_user = auth.uid() and exists (
    select 1 from app.threads t where t.id = thread_id
      and (t.from_person_id = app.my_person_id(t.center_id) or app.has_permission(t.center_id, 'comms.inbox')
           or exists (select 1 from app.inboxes i where i.id = t.inbox_id and i.zone_id is not null and app.has_scoped_role(i.center_id, i.zone_id, 'zone_lead')))));
create policy thread_messages_staff on app.thread_messages for select to authenticated
  using (exists (select 1 from app.threads t where t.id = thread_id and (app.has_permission(t.center_id, 'comms.inbox')
         or exists (select 1 from app.inboxes i where i.id = t.inbox_id and i.zone_id is not null and app.has_scoped_role(i.center_id, i.zone_id, 'zone_lead')))));

select app._member_read('whatsapp_groups', 'active');
select app._staff_policies('whatsapp_groups', 'comms.view', 'comms.send');
create policy wa_requests_own on app.whatsapp_join_requests for select to authenticated using (app.can_act_for_person(center_id, person_id));
create policy wa_requests_insert on app.whatsapp_join_requests for insert to authenticated
  with check (app.can_act_for_person(center_id, person_id) and status = 'pending');
select app._staff_policies('whatsapp_join_requests', 'comms.view', 'comms.send');

select app._member_read('surveys', 'status = ''open''');
select app._staff_policies('surveys', 'comms.view', 'comms.send');
create policy survey_responses_own on app.survey_responses for select to authenticated
  using (person_id is not null and person_id = app.my_person_id(center_id));
create policy survey_responses_insert on app.survey_responses for insert to authenticated
  with check (app.is_member_of(center_id) and (person_id is null or person_id = app.my_person_id(center_id))
              and exists (select 1 from app.surveys s where s.id = survey_id and s.status = 'open'));
select app._staff_policies('survey_responses', 'comms.view', 'comms.send');

select app._member_read('alerts', 'starts_at <= now() and (ends_at is null or ends_at > now())');
select app._staff_policies('alerts', 'comms.view', 'comms.send');

create policy data_requests_own on app.data_requests for select to authenticated using (app.can_act_for_person(center_id, person_id));
create policy data_requests_insert on app.data_requests for insert to authenticated
  with check (app.can_act_for_person(center_id, person_id) and requested_by = auth.uid() and status = 'open');
select app._staff_policies('data_requests', 'privacy.manage', 'privacy.manage');

-- ===========================================================================
-- Integrations and accounting (treasurer / center admin only)
-- ===========================================================================
select app._staff_policies('integration_connections', 'integrations.view', 'integrations.manage');
select app._staff_policies('qbo_account_mappings', 'giving.view', 'accounting.manage');
select app._staff_policies('ledger_postings', 'giving.view', 'accounting.manage');
select app._staff_policies('accounting_periods', 'giving.view', 'accounting.close');
select app._staff_policies('payouts', 'giving.view', 'accounting.manage');
select app._staff_policies('sync_log', 'integrations.view', 'integrations.manage');
select app._staff_policies('import_runs', 'integrations.view', 'integrations.manage');
-- webhook_events: service role only (no policies => no access for anon/authenticated).

-- Guests (no sign-in) may read public tables only; policies above narrow the rows.
grant select on app.centers, app.zones, app.legal_documents, app.membership_types, app.campaigns, app.opportunities,
  app.events, app.store_categories, app.store_items, app.pickup_windows, app.pathshala_tracks, app.pathshala_levels,
  app.content_items, app.photo_albums, app.gyan_goals, app.gyan_levels, app.gyan_steps, app.practices,
  app.calendar_layers, app.calendar_entries, app.tithi_days, app.daily_timings, app.guide_sections, app.role_roster,
  app.notification_topics
to anon;

-- Drop the migration-time helpers (keep the runtime ones).
drop function app._staff_policies(text, text, text);
drop function app._member_read(text, text);
