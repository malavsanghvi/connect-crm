-- 0756 · Only Weaver changes a community's status (onboarding, active, suspended, exited).
--
-- WHY
--   0755 lets Niva for admins answer on the onboarding pages without iWeaver while a community is onboarding (AI used in
--   onboarding stays core), and it reads that from app.centers.status. But a community's settings managers may update their
--   own row (centers_admin_update, 0010; the table's UPDATE grant, 0001), status included, so a live community could set
--   itself back to 'onboarding' and use the chat on Weaver's AI keys without iWeaver. The status also decides who can find a
--   community (centers_public_read) and protects a live organization from demo data (0500).
--
-- HOW STATUS CHANGES TODAY (kept working)
--   * A new community gets its status when it is created: by a platform admin (Platform › New center, 'onboarding'; the
--     console), by the sandbox functions a platform admin or a sandbox code starts (0201, 0502, 0594, 0600: 'onboarding'),
--     and by the background service's promotion copy (0203: 'onboarding'). This migration does not touch inserts.
--   * Afterwards only platform admins change it (centers_platform_all), and jobs and migrations, which run with no
--     signed-in person. No function a community's own staff can call changes it.
--
-- WHAT THIS DOES
--   app.centers_guard_status (BEFORE UPDATE, the pattern of 0160's centers_guard_environment): a signed-in caller who is not a
--   platform admin can never change a community's status, through the API or through any function. Everything else a
--   settings manager may change on the row stays as it was. Test 162.

create or replace function app.centers_guard_status() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null and not app.is_platform_admin() then
    raise exception 'Only the Weaver team can change whether a community is onboarding, live, suspended or exited.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke execute on function app.centers_guard_status() from public, anon, authenticated;

drop trigger if exists centers_guard_status on app.centers;
create trigger centers_guard_status before update on app.centers
  for each row execute function app.centers_guard_status();

comment on column app.centers.status is
  'onboarding, active, suspended or exited. Set when the community is created; afterwards only platform admins (and jobs) change it (0756). While onboarding, AI used in onboarding works without iWeaver (0755).';
