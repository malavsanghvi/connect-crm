-- Onboarding Wave D · stream o-platform-setup: who saved what in the platform
-- setup wizard. Platform admins are Community Connect staff and often not a
-- person in any organization, so the wizard names them by their sign-in email.
-- Platform admins only; it lists platform admins only.
set client_min_messages = warning;

create or replace function app.platform_admin_directory()
returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  perform app.assert_platform_admin('see who the platform admins are');
  return query
    select a.user_id, u.email::text from app.accounts a join auth.users u on u.id = a.user_id
     where a.is_platform_admin order by u.email;
end $$;

revoke execute on function app.platform_admin_directory() from public, anon, authenticated, service_role;
grant execute on function app.platform_admin_directory() to authenticated;
