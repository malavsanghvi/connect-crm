-- 0615: close the community table (docs/COMMUNITY_PUBLIC_DATA.md). NEEDS THE OWNER'S OK, and is applied only after
-- installed member apps read the community through 0614's functions (connect-mobile 1.14.1 or later, PR #83): an older app
-- fails to load a community as a guest once this is in.
--
-- Before: anyone (not signed in) read the whole row, `rules` / `branding` / `feature_flags` included, of every active or
-- onboarding community; any signed-in person read every such row.
-- After:
--   1. A guest (anon) reads the table's plain columns only (id, slug, name, short_name, tradition, time_zone, country,
--      state_region, currency, status, environment, category_key) and only of ACTIVE communities. `rules`, `branding`,
--      `feature_flags`, `sandbox_for` and the timestamps are not granted to anon at all.
--   2. A signed-in person reads from the table only the communities they are linked to (app.linked_to_center: member
--      login, active staff role, owner), active or onboarding; a platform admin reads every row (centers_platform_all,
--      unchanged). Everyone else gets the public part through app.community_public (0614). Row security cannot hide
--      columns, so this row narrowing is what stops a signed-in outsider reading the full settings of every active
--      community; the portal and the member app keep reading `rules` as members/staff of their own community.
--   3. app.community_open (0614): active communities for everyone; an onboarding one only when linked; every community
--      for a platform admin. The 0614 readers follow it.
--   4. app.access_center_open (0586), which feature_access_for_me, category_profile, member_experience and can_use_feature
--      (inside the content policies) ask: the same rule (an onboarding community is no longer open to guests), and a
--      member of the community stays open as before.
--   5. org_leaders_public_read (0180) read app.centers as the caller: it now asks app.community_open (security definer),
--      so the narrowed table does not hide the leaders of an active community from a signed-in outsider.
-- Inventory of everything that reads app.centers as the calling role (not security definer), all migrations up to 0614
-- and the open branches: the policy above (moved); app.sync_during_action_due / app.sync_event_during_dates (0004,
-- triggers on actions / events, read time_zone: fired by staff of that community, who are linked, or by definer
-- functions); app.niva_answer_from / niva_search_tsquery / niva_live_ref_current / niva_center_day_start (0573-0575:
-- execute revoked from anon and authenticated, called only inside security definer functions). No view reads it.

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
