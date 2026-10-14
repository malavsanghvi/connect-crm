-- 0813: close the community table (docs/COMMUNITY_PUBLIC_DATA.md). Owner decision 2026-10-14 ("do it"); it was drafted as
-- 0615 (PR #115) and is renumbered because main had moved on. Phones read the community through 0614's functions since
-- connect-mobile 1.14.1 (PR #83; the app is at 1.19.0): an older build fails to open a community as a guest once this is in.
-- To undo it, run the rollback in docs/COMMUNITY_PUBLIC_DATA.md (one paste).
--
-- Before: anyone (not signed in) read the whole row, `rules` / `branding` / `feature_flags` included, of every active or
-- onboarding community; any signed-in person read every such row.
-- After:
--   1. A guest (anon) reads the table's plain columns only (id, slug, name, short_name, tradition, time_zone, country,
--      state_region, currency, status, environment, category_key) and only of ACTIVE communities. `rules`, `branding`,
--      `feature_flags`, `sandbox_for` and the timestamps are not granted to anon at all.
--   2. A signed-in person reads from the table only the communities they are linked to (app.linked_to_center: member
--      login, active staff role of any scope, owner), active or onboarding; a platform admin reads every row
--      (centers_platform_all, unchanged). Everyone else gets the public part through app.community_public (0614). Row
--      security cannot hide columns, so this row narrowing is what stops a signed-in outsider reading the full settings of
--      every active community; the portal and the member app keep reading `rules` as members/staff of their own community.
--   3. app.community_open (0614): active communities for everyone; an onboarding one only when linked; every community
--      for a platform admin. The 0614 readers follow it.
--   4. app.access_center_open (0586), which feature_access_for_me, category_profile, member_experience, resolve_template
--      and can_use_feature (inside the content policies) ask: the same rule (an onboarding community is no longer open to
--      guests or strangers), and a member of the community stays open as before.
--   5. org_leaders_public_read (0180) read app.centers as the caller: it now asks app.community_open (security definer),
--      so the narrowed table does not hide the leaders of an active community from a signed-in outsider.
--
-- Inventory, redone against everything up to 0800 (2026-10-14) of what reads app.centers AS THE CALLING ROLE, i.e. not
-- inside a security definer function (those run as the table owner, which row security does not apply to):
--   * Policies on any table whose USING / WITH CHECK selects from app.centers: only org_leaders_public_read (moved above)
--     and the table's own four (centers_admin_update and centers_platform_all, unchanged; the two new ones below). No
--     policy calls a security invoker function that reads it. No policy is built by a helper that reads it.
--   * Security invoker functions: app.sync_during_action_due / app.sync_event_during_dates (0004; triggers on actions and
--     events that read time_zone; fired by people who work in that community, who are linked, or by definer functions);
--     app.event_summary (0653), app.giving_pledges_behind / giving_household_summary / giving_unmatched_bank_lines /
--     giving_zelle_waiting (0656, 0742), app.store_sales_summary (0670), app.reports_tz and the six reports_* that call it
--     (0672): they read time_zone and run for staff or members of the community, who are linked; app.platform_waiting and
--     app.platform_community_summary (0673): platform admins only (the function refuses anyone else first, and a platform
--     admin passes centers_platform_all); app.niva_answer_from / niva_search_tsquery / niva_live_ref_current /
--     niva_center_day_start (0573-0575): execute revoked from anon and authenticated, called only inside definer functions.
--     (app.merge_people / merge_households and their previews, and app.demo_keep_tables, only contain the WORD "centers".)
--   * Views: app.automation_backlog (0623) reads it, but a view runs with its owner's rights; platform admins only.
--   * Non-definer triggers on other tables: the two above. Column grants: the anon grant of 0010, replaced below.
--   * Clients: see "Inventory" in docs/COMMUNITY_PUBLIC_DATA.md (the portal, the member app, the event-day app, the
--     background service and the end-to-end flows).

-- ── 3. Who may see a community ────────────────────────────────────────────────
create or replace function app.community_open(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.centers c
                  where c.id = p_center
                    and (c.status = 'active'
                         or app.is_platform_admin()
                         or (c.status = 'onboarding' and app.linked_to_center(c.id))))
$$;

-- ── 4. The access areas' "is this community open" ─────────────────────────────
create or replace function app.access_center_open(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.centers c
                  where c.id = p_center and (app.community_open(c.id) or app.is_member_of(p_center)))
$$;

-- ── 1 and 2. The table ────────────────────────────────────────────────────────
drop policy if exists centers_public_read on app.centers;
drop policy if exists centers_guest_read on app.centers;
drop policy if exists centers_linked_read on app.centers;
create policy centers_guest_read on app.centers for select to anon using (status = 'active');
create policy centers_linked_read on app.centers for select to authenticated
  using (status in ('active', 'onboarding') and app.linked_to_center(id));
-- centers_admin_update and centers_platform_all (0010) are unchanged.

revoke select on app.centers from anon;
grant select (id, slug, name, short_name, tradition, time_zone, country, state_region, currency, status, environment, category_key)
  on app.centers to anon;

-- ── 5. Public leaders ─────────────────────────────────────────────────────────
drop policy if exists org_leaders_public_read on app.org_leaders;
create policy org_leaders_public_read on app.org_leaders for select to anon, authenticated
  using (show_publicly and app.community_open(center_id));
