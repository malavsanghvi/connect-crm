-- 0565: a parent can only ask for a Pathshala place for a child of their own household (finding F1 of
-- docs/PATHSHALA_REGISTRATION_PLAN.md; owner approved the fix 2026-10-01).
--
-- enrollments_household_insert (0010) let any adult of a household insert an enrollment request naming ANY person as the
-- student, and left the fee pledge, the waiver consent, who registered and when to the caller. The member app only ever
-- sends the term, the household, the child, the requested level, status 'requested', registered_by = the signed-in user and
-- a note (connect-mobile src/lib/api/gyan.ts requestEnrollment), so the rule now allows exactly that:
--   * the student is a CURRENT member of that household, in the same community;
--   * the term is open (registration or active, as the app offers) and, like the requested level when given, belongs
--     to the same community;
--   * still status 'requested' with no class and no placement;
--   * no fee pledge and no waiver consent attached by the member (the office or a database function does that);
--   * registered_by is the caller, and registered_at is now (the column default), not a back-dated time.
-- Staff (pathshala.manage), imports and the demo pack are unchanged: they insert through their own policies or as the
-- database owner. Existing rows are not touched.
set client_min_messages = warning;

drop policy if exists enrollments_household_insert on app.pathshala_enrollments;
create policy enrollments_household_insert on app.pathshala_enrollments for insert to authenticated
  with check (
    app.adult_of_household(center_id, household_id)
    and status = 'requested' and class_id is null and placed_at is null
    and fee_pledge_id is null and waiver_consent_id is null
    and registered_by = (select auth.uid())
    and registered_at = now()
    and exists (select 1 from app.household_members hm
                 where hm.household_id = pathshala_enrollments.household_id
                   and hm.person_id = pathshala_enrollments.student_person_id
                   and hm.center_id = pathshala_enrollments.center_id
                   and hm.left_at is null)
    and exists (select 1 from app.pathshala_terms t
                 where t.id = pathshala_enrollments.term_id and t.center_id = pathshala_enrollments.center_id
                   and t.status in ('registration', 'active'))
    and (requested_level_id is null
         or exists (select 1 from app.pathshala_levels l
                     where l.id = pathshala_enrollments.requested_level_id and l.center_id = pathshala_enrollments.center_id))
  );
comment on policy enrollments_household_insert on app.pathshala_enrollments is
  'A household adult asks for a place for a current member of that household (0565): status requested, no class, no placement, no fee pledge or waiver attached, registered by the caller, at the time of the insert; an open term (registration or active) and a level of the same community.';
