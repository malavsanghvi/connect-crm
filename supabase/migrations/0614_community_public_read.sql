-- 0614: the public part of a community, read through purpose-built functions (docs/COMMUNITY_PUBLIC_DATA.md).
--
-- Why: app.centers is readable by anyone (policy centers_public_read and the anon grant, 0010), so a visitor who is
-- not signed in can read the whole settings bag (`rules`: staff security settings, onboarding provenance, the
-- payments settings), `branding` and `feature_flags` of every active or onboarding community, and any signed-in
-- person can read every such row. The installed member apps read the table directly, so the table cannot be closed
-- until they have updated. This migration only ADDS the path the apps and the portal move to:
--
--   app.linked_to_center(center)        is the caller linked to the community: a member login (center_users), an
--                                       active staff role (role_grants, any scope; not one still pending approval),
--                                       its owner (center_owners), or a platform admin.
--   app.community_open(center)          may the caller see the community at all. Here: exactly the rows the table
--                                       shows today (active or onboarding; every row for a platform admin), so this
--                                       migration changes nothing anyone sees. Migration 0615 (the lockdown, which
--                                       waits for the owner) narrows it to active, or onboarding when linked.
--   app.community_public(slug)          one community by its web name   } the community row: the full rules, branding
--   app.community_public_by_id(id)      one community by its id         } and feature_flags for a linked caller;
--                                                                         for anyone else only the allowlisted keys
--   app.communities_public_list()       the "choose your organization" list: active communities, no settings at all.
--
-- The allowlists (default deny: a key not named here is never shown to a caller who is not linked):
--   rules     identifiers.org_member_label, identifiers.org_household_label, home.shortcuts,
--             points.anumodana_points, points.support_points, points.day_complete_bonus, points.gyan_practice_daily_cap,
--             store.gift_pack_cents
--             (every key the member app reads; none of them is private)
--   branding  the brand kit and the organization's public contact details (logo, mark, colours, fonts, wordmark,
--             website, map, address, phone, links, dashboard address)
--   feature_flags  none (the member app does not read them; the portal reads them as staff)
--
-- app.member_experience (0600), callable before sign-in, handed a guest the whole `branding`: it now hands a caller who
-- is not linked the allowlisted branding only (the rest of its answer was already public: the experience catalog,
-- home shortcuts and the two identifier labels). category_profile, feature_access_for_me and list_experiences return
-- catalog and access-ladder data only, no community settings, and are unchanged.

-- ── Who is linked to a community ──────────────────────────────────────────────
create or replace function app.linked_to_center(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select auth.uid() is not null and p_center is not null and (
       app.is_platform_admin()
    or exists (select 1 from app.center_users cu where cu.center_id = p_center and cu.user_id = auth.uid())
    or exists (select 1 from app.role_grants g where g.center_id = p_center and g.user_id = auth.uid()
                 and g.status = 'active' and g.starts_at <= now() and (g.ends_at is null or g.ends_at > now()))
    or exists (select 1 from app.center_owners o where o.center_id = p_center and o.user_id = auth.uid()))
$$;

-- ── May the caller see this community at all (0615 narrows this one function) ─
create or replace function app.community_open(p_center uuid) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select exists (select 1 from app.centers c
                  where c.id = p_center
                    and (c.status in ('active', 'onboarding') or app.is_platform_admin()))
$$;

-- ── The allowlists ────────────────────────────────────────────────────────────
-- Dotted paths into the JSON object. A path is copied only when it exists; nothing else is.
create or replace function app.community_public_rule_paths() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['identifiers.org_member_label', 'identifiers.org_household_label', 'home.shortcuts',
               'points.anumodana_points', 'points.support_points', 'points.day_complete_bonus',
               'points.gyan_practice_daily_cap', 'store.gift_pack_cents']::text[]
$$;

create or replace function app.community_public_branding_paths() returns text[]
language sql immutable set search_path = app, public, extensions as $$
  select array['colors.primary', 'colors.accent', 'primary', 'accent', 'background', 'display_font', 'body_font',
               'logo', 'logo_url', 'logo_path', 'logo_dark_url', 'logo_dark_path', 'mark_url', 'mark_path', 'wordmark',
               'website', 'map_url', 'address', 'address_note', 'place_name', 'phone', 'links', 'dashboard_url']::text[]
$$;

-- The listed paths of a JSON object, and nothing else ({} for anything that is not an object).
create or replace function app.community_pick(p_doc jsonb, p_paths text[]) returns jsonb
language plpgsql immutable set search_path = app, public, extensions as $$
declare p text; parts text[]; v jsonb; v_out jsonb := '{}'::jsonb; i integer;
begin
  if jsonb_typeof(p_doc) is distinct from 'object' then
    return '{}'::jsonb;
  end if;
  foreach p in array coalesce(p_paths, '{}'::text[]) loop
    parts := string_to_array(p, '.');
    v := p_doc #> parts;
    continue when v is null;
    -- create the parent objects first (jsonb_set only creates the last level)
    for i in 1 .. coalesce(array_length(parts, 1), 0) - 1 loop
      if jsonb_typeof(v_out #> parts[1:i]) is distinct from 'object' then
        v_out := jsonb_set(v_out, parts[1:i], '{}'::jsonb, true);
      end if;
    end loop;
    v_out := jsonb_set(v_out, parts, v, true);
  end loop;
  return v_out;
end $$;

-- ── The community row ─────────────────────────────────────────────────────────
-- One lookup behind both readers. `linked` says whether the settings are the full ones.
create or replace function app.community_public_lookup(p_id uuid, p_slug text)
returns table (id uuid, slug text, name text, short_name text, state_region text, time_zone text, tradition app.tradition,
               environment text, status text, category_key text, branding jsonb, feature_flags jsonb, rules jsonb,
               linked boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select c.id, c.slug::text, c.name, c.short_name, c.state_region, c.time_zone, c.tradition, c.environment, c.status,
         c.category_key,
         case when l.linked then c.branding else app.community_pick(c.branding, app.community_public_branding_paths()) end,
         case when l.linked then c.feature_flags else '{}'::jsonb end,
         case when l.linked then c.rules else app.community_pick(c.rules, app.community_public_rule_paths()) end,
         l.linked
    from app.centers c
    cross join lateral (select app.linked_to_center(c.id) as linked) l
   where (p_id is not null or nullif(btrim(coalesce(p_slug, '')), '') is not null)
     and (p_id is null or c.id = p_id)
     and (nullif(btrim(coalesce(p_slug, '')), '') is null or c.slug = lower(btrim(p_slug))::citext)
     and app.community_open(c.id)
$$;
revoke execute on function app.community_public_lookup(uuid, text) from public, anon, authenticated;

create or replace function app.community_public(p_slug text)
returns table (id uuid, slug text, name text, short_name text, state_region text, time_zone text, tradition app.tradition,
               environment text, status text, category_key text, branding jsonb, feature_flags jsonb, rules jsonb,
               linked boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select * from app.community_public_lookup(null, p_slug)
$$;

create or replace function app.community_public_by_id(p_id uuid)
returns table (id uuid, slug text, name text, short_name text, state_region text, time_zone text, tradition app.tradition,
               environment text, status text, category_key text, branding jsonb, feature_flags jsonb, rules jsonb,
               linked boolean)
language sql stable security definer set search_path = app, public, extensions as $$
  select * from app.community_public_lookup(p_id, null)
$$;

-- The "choose your organization" list (the member app's picker): active communities only, for everyone.
create or replace function app.communities_public_list()
returns table (id uuid, slug text, name text, short_name text, state_region text, environment text)
language sql stable security definer set search_path = app, public, extensions as $$
  select c.id, c.slug::text, c.name, c.short_name, c.state_region, c.environment
    from app.centers c
   where c.status = 'active'
   order by c.name
$$;

revoke execute on function app.community_public(text), app.community_public_by_id(uuid), app.communities_public_list(),
  app.linked_to_center(uuid), app.community_open(uuid), app.community_pick(jsonb, text[]),
  app.community_public_rule_paths(), app.community_public_branding_paths() from public;
grant execute on function app.community_public(text), app.community_public_by_id(uuid), app.communities_public_list(),
  app.linked_to_center(uuid), app.community_open(uuid) to anon, authenticated, service_role;
grant execute on function app.community_pick(jsonb, text[]), app.community_public_rule_paths(),
  app.community_public_branding_paths() to service_role;

-- ── member_experience (0600): a caller who is not linked gets the allowlisted branding only ──
-- Unchanged from 0600 except the branding line in v_setup.
create or replace function app.member_experience(p_center uuid, p_known_stamp text default null) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; k app.organization_categories; v_family text; v_prof jsonb; v_modules jsonb; v_flags jsonb; v_setup jsonb;
        v_topics jsonb; v_body jsonb; v_stamp text; v_updated timestamptz; v_labh boolean; v_shortcuts jsonb;
begin
  if p_center is null or not app.access_center_open(p_center) then
    raise exception 'That community was not found.';
  end if;
  select * into c from app.centers where id = p_center;
  select * into k from app.organization_categories where key = c.category_key;
  select f.label into v_family from app.experience_families f where f.key = k.family_key;
  v_prof := app.category_profile(p_center);

  select coalesce(jsonb_object_agg(m.key, jsonb_build_object(
           'availability', coalesce(cm.availability, 'default_on'),
           'label', coalesce(cm.label, m.label),
           'enabled', m.core or app.module_enabled(p_center, m.key),
           'core', m.core)), '{}'::jsonb)
    into v_modules
    from app.modules m
    left join app.category_modules cm on cm.category_key = k.key and cm.module_key = m.key;

  -- Labh becomes its own module in a later migration; until then it is part of Giving and only a Jain Center has it.
  v_labh := case when exists (select 1 from app.modules where key = 'labh') then app.module_enabled(p_center, 'labh')
                 else k.uses_tradition and app.module_enabled(p_center, 'giving') end;
  v_flags := jsonb_build_object(
    'school', app.module_enabled(p_center, 'pathshala'),
    'learning', app.module_enabled(p_center, 'gyan_path'),
    'store', app.module_enabled(p_center, 'store'),
    'labh', v_labh,
    'bolis', app.module_enabled(p_center, 'bolis'),
    'niva', app.module_enabled(p_center, 'niva'),
    'practice', app.module_enabled(p_center, 'jain_way'));

  v_shortcuts := case when jsonb_typeof(c.rules #> '{home,shortcuts}') = 'array' then c.rules #> '{home,shortcuts}' end;
  v_setup := jsonb_build_object(
    'home_shortcuts', v_shortcuts,
    'branding', case when app.linked_to_center(p_center) then coalesce(c.branding, '{}'::jsonb)
                     else app.community_pick(c.branding, app.community_public_branding_paths()) end,
    'timings', jsonb_build_object(
      'enabled', app.catalog_shows((select a.category_keys from app.access_features a where a.key = 'timings'), k.key),
      'has_location', exists (select 1 from app.org_profiles o where o.center_id = p_center and o.latitude is not null)),
    'time_zone', c.time_zone,
    'tradition', c.tradition,
    'identifiers', jsonb_build_object(
      'org_member_label', nullif(btrim(c.rules #>> '{identifiers,org_member_label}'), ''),
      'org_household_label', nullif(btrim(c.rules #>> '{identifiers,org_household_label}'), '')));

  select coalesce(jsonb_agg(t.key order by t.name, t.key), '[]'::jsonb) into v_topics
    from app.notification_topics t where app.catalog_shows(t.category_keys, k.key);

  v_body := jsonb_build_object(
    'center', jsonb_build_object('id', c.id, 'slug', c.slug::text, 'name', c.name, 'short_name', c.short_name,
                                 'environment', c.environment, 'status', c.status, 'time_zone', c.time_zone),
    'experience', (v_prof->'category') || jsonb_build_object(
                    'description', k.description, 'family_key', k.family_key, 'family_label', v_family,
                    'inherits_from', k.inherits_from, 'wording_pack', k.wording_pack, 'wording', k.wording,
                    'library_pack', k.library_pack),
    'modules', v_modules,
    'flags', v_flags,
    'setup', v_setup,
    'access', app.feature_access_for_me(p_center),
    'topics', v_topics,
    'paths', v_prof->'paths',
    'default_path', v_prof->'default_path');
  v_stamp := md5(v_body::text);
  v_updated := greatest(c.updated_at, coalesce((select max(x.changed_at) from app.center_modules x where x.center_id = p_center), c.updated_at));
  if p_known_stamp is not null and p_known_stamp = v_stamp then
    return jsonb_build_object('stamp', v_stamp, 'unchanged', true, 'updated_at', v_updated);
  end if;
  return v_body || jsonb_build_object('stamp', v_stamp, 'unchanged', false, 'updated_at', v_updated);
end $$;
revoke execute on function app.member_experience(uuid, text) from public;
grant execute on function app.member_experience(uuid, text) to anon, authenticated, service_role;
