-- 0685_community_languages.sql (which languages a community speaks, readable by the people who write to its members)
--
-- A community chooses its languages in Setup > Profile (org_profiles.languages, 0180, order = its preference). That table is
-- readable only by people who manage settings, but the people who draft a reminder, write a newsletter, edit a person or build
-- the website draft need the list to write in each of the community's languages. This function hands back that one list, to
-- anyone linked to the community (a member, staff, the owner, a platform admin: app.linked_to_center, 0614), and to nobody else
-- (a guest, or someone from another community, gets null). It reads nothing else from the profile. English is the answer when
-- the community has not chosen yet.

create or replace function app.community_languages(p_center uuid) returns text[]
language sql stable security definer set search_path = app, public, extensions as $$
  select case when app.linked_to_center(p_center)
              then coalesce(nullif((select p.languages from app.org_profiles p where p.center_id = p_center), '{}'::text[]), array['en']::text[])
         end
$$;
comment on function app.community_languages(uuid) is
  'The languages a community speaks (org_profiles.languages, preferred first; {en} when unset) for anyone linked to it; null for everyone else.';

revoke all on function app.community_languages(uuid) from public, anon;
grant execute on function app.community_languages(uuid) to authenticated, service_role;
