-- Demo sign-in · the public list of demo people offers only the featured roles, in two areas (owner decision 2026-10-14):
--   "Non-profit operational roles": the community's administrator, treasurer, membership coordinator, event lead and teacher
--   "Community roles":              the family's main adult, shown as "Community member · Adult"
--
--   app.demo_featured_roles()   the ONE place the featured list lives: role, area, order, and the words to show when they differ from the
--                               role's name. To change who is offered (for example to offer the family's other adults instead of the
--                               main adult), change this list and nothing else.
--   app.demo_choices()          0679's public list, except that it offers only those roles, each person with the `area` they belong to,
--                               ordered by area and then by the list's order. A community with none of a role simply lacks it. Each
--                               community also carries its public `id` and `slug` (invented, public data only) so the member app can
--                               open it as a guest, with no sign-in, before anyone chooses a person (0816 lets a guest read it).
--
-- Nothing else changes. Every demo community keeps one demo person per role (app.demo_missing_roles still requires it), every person
-- keeps their sign-in, and app.worker_demo_begin still starts a session for any of them: this is only what the public list offers.
set client_min_messages = warning;

create or replace function app.demo_featured_roles() returns table (role_key text, area text, sort int, label text)
language sql immutable set search_path = app, public, extensions as $$
  select f.role_key, f.area, f.sort, f.label
    from (values
      ('center_admin',            'operations', 10, null::text),
      ('treasurer',               'operations', 20, null),
      ('membership_coordinator',  'operations', 30, null),
      ('event_lead',              'operations', 40, null),
      ('teacher',                 'operations', 50, null),
      ('primary_adult',           'community',  60, 'Community member · Adult')
    ) as f(role_key, area, sort, label)
$$;
comment on function app.demo_featured_roles() is
  'The demo people the public list offers (app.demo_choices): role key, area (operations | community), order, and the label to show instead of the role''s name. The only place the list lives.';

-- Used by app.demo_choices (security definer); nobody else needs to call it.
revoke execute on function app.demo_featured_roles() from public, anon, authenticated;

-- The public list: who can I be? Only the featured demo people that already have a sign-in. Role, name, a sentence about them and their
-- area; never an address, never an id of a real thing. Each community says its own id and slug (the demo community's, which are public
-- anyway). (0679's body; create or replace keeps its grants: anon and authenticated.)
create or replace function app.demo_choices() returns jsonb
language sql stable security definer set search_path = app, public, extensions as $$
  select jsonb_build_object(
    'enabled', app.demo_signin_enabled(),
    'communities', coalesce((
      select jsonb_agg(q.x order by q.x ->> 'kind')
        from (select jsonb_build_object(
                'kind', c.rules ->> 'demo_kind', 'name', c.name, 'id', c.id, 'slug', c.slug::text,
                'people', (select jsonb_agg(jsonb_build_object('id', d.id, 'role', coalesce(f.label, d.headline), 'name', d.display_name,
                                                               'story', d.story, 'area', f.area)
                                            order by (f.area = 'community'), f.sort, d.display_name)
                             from app.demo_personas d
                             join app.demo_auth_users a on a.email = d.email
                             join app.demo_featured_roles() f on f.role_key = d.role_key
                            where d.center_id = c.id)) as x
                from app.centers c where app.is_demo_center(c.id) and c.environment = 'sandbox') q
       where jsonb_typeof(q.x -> 'people') = 'array'), '[]'::jsonb))
$$;
