-- 0816 · A demo community is open to guests (people who are not signed in) while the demo is on, and only then.
--
-- WHY. "Try the demo" in the member app starts with a look around the demo community as a guest, with no sign-in (Home with the
-- public events, the guide, the store), and only then offers "Be someone in the demo". The demo communities are sandboxes (status
-- 'onboarding'). A guest may read an active or onboarding community today, but the same rule must also (a) stay true when the open
-- rule is narrowed to active communities (connect-crm PR 115, "community table lockdown", which will call app.demo_public_open), and
-- (b) hide the demo from guests again as soon as the demo switch (Platform › Setup › Demo sign-in) is off, like everything else the
-- switch controls.
--
--   app.demo_public_open(center)      true for a demo community (flagged demo, a sandbox, still onboarding or active) while the demo is
--                                     switched on. The ONE question "may a guest see this demo community now?".
--   app.demo_closed_to_guests(center) true for a demo community that guests may not see now (the switch is off). False for every other
--                                     community, so a gate can say "and not demo_closed_to_guests" and change nothing for them.
--
-- Redefined from their latest bodies, with the one added condition (a demo community is let in only while the demo is on):
--   app.community_open(center)        0614: the 0614 readers (community_public, community_public_by_id) and everything that asks
--                                     "may the caller see this community at all"
--   app.access_center_open(center)    0586: feature_access_for_me, can_use_feature, category_profile, member_experience, resolve_template
--   app.public_org_profile(center)    0180: the public profile
--   policy centers_public_read        0010: the community row, for the members of old app builds that still read the table
--   policy org_leaders_public_read    0180: the public leaders
-- Added (additive; they only narrow what a guest reads, never widen it): a restrictive SELECT policy for the role anon on each table
-- the guest look-around reads, so the rows of a demo community are not readable by a guest while the demo is off (by id, the id is public).
--
-- GUESTS NEVER WRITE. No insert, update or delete policy or grant is touched. RSVP, give and shop stay as they are (the app sends a
-- guest to sign in). A signed-in person is not affected by the restrictive policies (they are for anon only).
--
-- NOT COVERED (unchanged: they never looked at the status of the community, so they work for the demo community as they always did
-- and are not hidden when the demo is off): the shared catalogs and calendars (gyan_*, practices, pathshala tracks and levels, calendar
-- layers, entries and tithis), the media library functions (media_library, random_media, media_item), storage object reads by path,
-- notification topics, and the guest reads of signed-in people who are not linked (the policies "to authenticated").
set client_min_messages = warning;

-- ── The two questions ────────────────────────────────────────────────────────
create or replace function app.demo_public_open(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(
    p_center is not null
    and app.is_demo_center(p_center)
    and exists (select 1 from app.centers c where c.id = p_center and c.environment = 'sandbox' and c.status in ('active', 'onboarding'))
    and app.demo_signin_enabled(),
    false)
$$;
comment on function app.demo_public_open(uuid) is
  'May a guest (not signed in) see this demo community now? True for a flagged demo sandbox that is onboarding or active while the demo is switched on (0816). The gates that decide whether a guest may open a community call this.';

create or replace function app.demo_closed_to_guests(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(app.is_demo_center(p_center) and not app.demo_public_open(p_center), false)
$$;
comment on function app.demo_closed_to_guests(uuid) is
  'True for a demo community that guests may not see now (the demo is switched off); false for every other community and for null (0816). Used as "and not app.demo_closed_to_guests(id)" so a gate changes nothing for other communities.';

-- Policies call these as the person reading, so they need the grant (the answers are public: the demo list says the same).
revoke execute on function app.demo_public_open(uuid), app.demo_closed_to_guests(uuid) from public;
grant execute on function app.demo_public_open(uuid), app.demo_closed_to_guests(uuid) to anon, authenticated, service_role;

-- ── May the caller see this community at all (0614's body) ───────────────────
-- Active or onboarding, or any status for a platform admin; a demo community only while the demo is on (unless the caller is a platform admin).
create or replace function app.community_open(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.centers c
                  where c.id = p_center
                    and ((c.status in ('active', 'onboarding') and not app.demo_closed_to_guests(c.id)) or app.is_platform_admin()))
$$;

-- ── Which communities the access areas open (0586's body) ────────────────────
create or replace function app.access_center_open(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.centers c
                  where c.id = p_center
                    and ((c.status in ('active', 'onboarding') and not app.demo_closed_to_guests(c.id)) or app.is_member_of(p_center)))
$$;

-- ── The public profile (0180's body) ─────────────────────────────────────────
create or replace function app.public_org_profile(p_center uuid)
returns table (center_id uuid, legal_name text, mission text, about text, website text, social jsonb,
               public_email text, public_phone text, office_hours text, latitude numeric, longitude numeric,
               languages text[], verified_nonprofit boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select p.center_id, p.legal_name, p.mission, p.about, p.website, p.social,
         p.public_email::text, p.public_phone, p.office_hours, p.latitude, p.longitude, p.languages,
         p.verification_status = 'verified'
    from app.org_profiles p join app.centers c on c.id = p.center_id
   where p.center_id = p_center and c.status in ('active','onboarding') and not app.demo_closed_to_guests(c.id)
$$;

-- ── The community row, for old app builds that read the table (0010's policy) ──
drop policy if exists centers_public_read on app.centers;
create policy centers_public_read on app.centers for select to anon, authenticated
  using (status in ('active','onboarding') and not app.demo_closed_to_guests(id));

-- ── The public leaders (0180's policy) ───────────────────────────────────────
drop policy if exists org_leaders_public_read on app.org_leaders;
create policy org_leaders_public_read on app.org_leaders for select to anon, authenticated
  using (show_publicly and exists (select 1 from app.centers c where c.id = center_id and c.status in ('active','onboarding')
                                                                  and not app.demo_closed_to_guests(c.id)));

-- ── What a guest reads of a community, hidden for a demo community while the demo is off ──
-- Restrictive: it is ANDed with the permissive policies each table already has (events_public_read, guide_public, store_items_public,
-- ...), so it can only take rows away from the role anon. A row with no community (a shared catalog row) is never affected.
do $$
declare t text;
begin
  foreach t in array array[
    'events', 'guide_sections', 'store_items', 'store_categories', 'pickup_windows', 'content_items', 'photo_albums',
    'daily_timings', 'role_roster', 'campaigns', 'opportunities', 'membership_types'
  ] loop
    execute format('drop policy if exists demo_guest_gate on app.%I', t);
    execute format('create policy demo_guest_gate on app.%I as restrictive for select to anon using (not app.demo_closed_to_guests(center_id))', t);
  end loop;
end $$;
