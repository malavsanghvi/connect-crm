-- 0624: the member app's look and layout as DATA (master plan priority 3, backlog B89, test 101).
--
-- A "template" says which rows the Home screen shows and in what order, which tabs the bottom bar has (and what each is
-- called and drawn with), the colours, corner style and motif, and options for the widgets. It is chosen by the kind of
-- organization (organization_categories), refined by the tradition (category_paths), and adjusted by the community's
-- own administrator (centers.rules.home.template). The server merges the three layers and hands the result to the app
-- inside the two reads it already makes, so the app changes with no app update.
--
-- Shape (version 1, every key optional; the member app is built against exactly this):
--   { "version": 1,
--     "home":    { "rows": ["today", "special_days", "events", "giving", "life", "learn"] },   order = display order;
--                                                                                              a row left out is hidden
--     "tabs":    [ { "key": "index|events|give|jain-way|family", "label": text|null, "icon": text|null, "hidden": false } ],
--     "theme":   { "primary": "#RRGGBB"|null, "accent": "#RRGGBB"|null, "surface": "warm|cool|plain"|null,
--                  "radius": "soft|crisp"|null, "motif": "none"|"<a-z_ up to 24 characters>"|null },
--     "widgets": { "today": { "variant": "full|basic|service_times" } } }
-- The database checks the SHAPE only. A row id or a widget name it does not know is allowed (a newer app or template must
-- never break an older one: the app ignores what it does not know). A layer that fails the check is ignored, never an error.
--
-- How the layers combine (app.resolve_template):
--   1  the category's template (an experience that inherits from another starts from its parent's: lineage, parent first)
--   2  the template of the community's default tradition path (the same path category_profile reports as default_path)
--   3  the administrator's override, centers.rules -> home -> template
--   home.rows    replaced wholesale by the higher layer
--   tabs         merged by key, key by key (a null label/icon in a higher layer means "use the default"). A higher layer that
--                lists EVERY tab of the lower one also sets the order (a reorder); one that lists only some changes just those
--                tabs where they are
--   theme        merged key by key (a null in a higher layer clears the lower layer's value)
--   widgets      merged by widget name, then key by key inside it
-- The answer is null when no layer is set. It holds no personal data, so the guest-callable category_profile may carry it.
--
-- Parts:
--   A  the two columns and the shape check
--   B  the merge and app.resolve_template
--   C  category_profile (0594) and member_experience (0614) re-created with ONE new key, `template`; nothing else changes
--   D  the starter templates
-- No row security, grant or permission changes: platform data is still written by migrations and platform admins, the
-- administrator's override lives in centers.rules, which settings managers already write.
set client_min_messages = warning;

-- ════════════════════════════════════════════════════════════════════════════
-- A · The columns and the shape check
-- ════════════════════════════════════════════════════════════════════════════
alter table app.organization_categories add column if not exists template jsonb;
alter table app.category_paths add column if not exists template jsonb;
comment on column app.organization_categories.template is
  'The member app''s look and layout for this kind of organization (0624): home rows, tabs, theme, widget options. Shape in 0624''s header, checked by app.template_problems. Null = none; an experience that inherits from another starts from its parent''s. Written by migrations.';
comment on column app.category_paths.template is
  'A small refinement of the category''s template for people of this tradition (0624), merged over it by app.resolve_template. Null = none.';

-- What is wrong with a template? An empty list means it is fine (a null template has nothing wrong). Shape only: the known
-- top-level keys, the allowed words, colours, and lists of names. Unknown row ids and widget names are allowed on purpose.
-- Not a table check: a row that was valid when written must never become impossible to update if this function grows.
create or replace function app.template_problems(p jsonb) returns text[]
language plpgsql immutable set search_path = app, public, extensions as $$
declare
  v text[] := '{}';
  v_k text;
  v_e jsonb;
  v_t jsonb;
  v_seen text[];
  v_bad boolean;
begin
  if p is null or p = 'null'::jsonb then
    return v;
  end if;
  if jsonb_typeof(p) <> 'object' then
    return array['A template must be an object.'];
  end if;

  for v_k in select jsonb_object_keys(p) loop
    if v_k <> all (array['version', 'home', 'tabs', 'theme', 'widgets']) then
      v := array_append(v, format('"%s" is not a part of a template (it has version, home, tabs, theme and widgets).', v_k));
    end if;
  end loop;

  if p ? 'version' and p -> 'version' <> '1'::jsonb then
    v := array_append(v, 'The version must be the number 1.');
  end if;

  -- home
  if p ? 'home' then
    v_t := p -> 'home';
    if jsonb_typeof(v_t) <> 'object' then
      v := array_append(v, 'home must be an object, for example {"rows": ["today", "events"]}.');
    else
      for v_k in select jsonb_object_keys(v_t) loop
        if v_k <> 'rows' then
          v := array_append(v, format('home has no setting called "%s" (only "rows").', v_k));
        end if;
      end loop;
      if v_t ? 'rows' then
        if jsonb_typeof(v_t -> 'rows') <> 'array' then
          v := array_append(v, 'home.rows must be a list of row names.');
        else
          v_seen := '{}';
          v_bad := false;
          for v_e in select value from jsonb_array_elements(v_t -> 'rows') loop
            if jsonb_typeof(v_e) <> 'string' or (v_e #>> '{}') !~ '^[a-z][a-z0-9_]{0,39}$' then
              v_bad := true;
            elsif (v_e #>> '{}') = any (v_seen) then
              v := array_append(v, format('home.rows lists "%s" twice.', v_e #>> '{}'));
            else
              v_seen := array_append(v_seen, v_e #>> '{}');
            end if;
          end loop;
          if v_bad then
            v := array_append(v, 'Every home row must be a short lower-case name such as "events".');
          end if;
        end if;
      end if;
    end if;
  end if;

  -- tabs
  if p ? 'tabs' then
    v_t := p -> 'tabs';
    if jsonb_typeof(v_t) <> 'array' then
      v := array_append(v, 'tabs must be a list of tabs.');
    else
      v_seen := '{}';
      for v_e in select value from jsonb_array_elements(v_t) loop
        if jsonb_typeof(v_e) <> 'object' then
          v := array_append(v, 'Every tab must be an object with a "key".');
          continue;
        end if;
        if jsonb_typeof(v_e -> 'key') is distinct from 'string'
           or (v_e ->> 'key') <> all (array['index', 'events', 'give', 'jain-way', 'family']) then
          v := array_append(v, 'Every tab needs a "key" that is one of index, events, give, jain-way, family.');
        elsif (v_e ->> 'key') = any (v_seen) then
          v := array_append(v, format('The tab "%s" is listed twice.', v_e ->> 'key'));
        else
          v_seen := array_append(v_seen, v_e ->> 'key');
        end if;
        for v_k in select jsonb_object_keys(v_e) loop
          if v_k <> all (array['key', 'label', 'icon', 'hidden']) then
            v := array_append(v, format('A tab has no setting called "%s" (only key, label, icon and hidden).', v_k));
          end if;
        end loop;
        if v_e ? 'label' and jsonb_typeof(v_e -> 'label') <> 'null'
           and (jsonb_typeof(v_e -> 'label') <> 'string' or char_length(btrim(v_e ->> 'label')) not between 1 and 40) then
          v := array_append(v, 'A tab label must be 1 to 40 characters, or null to keep the default.');
        end if;
        if v_e ? 'icon' and jsonb_typeof(v_e -> 'icon') <> 'null'
           and (jsonb_typeof(v_e -> 'icon') <> 'string' or (v_e ->> 'icon') !~ '^[a-z][a-z0-9_-]{0,39}$') then
          v := array_append(v, 'A tab icon must be a short lower-case name, or null to keep the default.');
        end if;
        if v_e ? 'hidden' and jsonb_typeof(v_e -> 'hidden') <> 'boolean' then
          v := array_append(v, 'The hidden setting of a tab must be true or false.');
        end if;
      end loop;
    end if;
  end if;

  -- theme
  if p ? 'theme' then
    v_t := p -> 'theme';
    if jsonb_typeof(v_t) <> 'object' then
      v := array_append(v, 'theme must be an object.');
    else
      for v_k in select jsonb_object_keys(v_t) loop
        if v_k <> all (array['primary', 'accent', 'surface', 'radius', 'motif']) then
          v := array_append(v, format('theme has no setting called "%s" (primary, accent, surface, radius and motif).', v_k));
        end if;
      end loop;
      foreach v_k in array array['primary', 'accent'] loop
        if v_t ? v_k and jsonb_typeof(v_t -> v_k) <> 'null'
           and (jsonb_typeof(v_t -> v_k) <> 'string' or (v_t ->> v_k) !~ '^#[0-9A-Fa-f]{6}$') then
          v := array_append(v, format('theme.%s must be a colour such as #3D3BB8, or null.', v_k));
        end if;
      end loop;
      if v_t ? 'surface' and jsonb_typeof(v_t -> 'surface') <> 'null'
         and (jsonb_typeof(v_t -> 'surface') <> 'string' or (v_t ->> 'surface') <> all (array['warm', 'cool', 'plain'])) then
        v := array_append(v, 'theme.surface must be warm, cool or plain, or null.');
      end if;
      if v_t ? 'radius' and jsonb_typeof(v_t -> 'radius') <> 'null'
         and (jsonb_typeof(v_t -> 'radius') <> 'string' or (v_t ->> 'radius') <> all (array['soft', 'crisp'])) then
        v := array_append(v, 'theme.radius must be soft or crisp, or null.');
      end if;
      if v_t ? 'motif' and jsonb_typeof(v_t -> 'motif') <> 'null'
         and (jsonb_typeof(v_t -> 'motif') <> 'string' or (v_t ->> 'motif') !~ '^[a-z_]{1,24}$') then
        v := array_append(v, 'theme.motif must be "none" or a name of lower-case letters and underscores (up to 24), or null.');
      end if;
    end if;
  end if;

  -- widgets
  if p ? 'widgets' then
    v_t := p -> 'widgets';
    if jsonb_typeof(v_t) <> 'object' then
      v := array_append(v, 'widgets must be an object with one entry per widget.');
    else
      for v_k, v_e in select e.key, e.value from jsonb_each(v_t) e loop
        if v_k !~ '^[a-z][a-z0-9_]{0,39}$' then
          v := array_append(v, format('"%s" is not a valid widget name.', v_k));
        end if;
        if jsonb_typeof(v_e) <> 'object' then
          v := array_append(v, format('The settings of the widget "%s" must be an object.', v_k));
        elsif v_k = 'today' and v_e ? 'variant'
              and (jsonb_typeof(v_e -> 'variant') <> 'string'
                   or (v_e ->> 'variant') <> all (array['full', 'basic', 'service_times'])) then
          v := array_append(v, 'widgets.today.variant must be full, basic or service_times.');
        end if;
      end loop;
    end if;
  end if;

  return v;
end $$;
revoke execute on function app.template_problems(jsonb) from public, anon;
grant execute on function app.template_problems(jsonb) to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- B · Merging and app.resolve_template
-- ════════════════════════════════════════════════════════════════════════════

-- Put a higher layer over a lower one (both already checked). Internal: only resolve_template calls it.
create or replace function app.template_merge(p_base jsonb, p_over jsonb) returns jsonb
language plpgsql immutable set search_path = app, public, extensions as $$
declare r jsonb; v_w jsonb; v_tabs jsonb; v_complete boolean;
begin
  if p_over is null or jsonb_typeof(p_over) <> 'object' or p_over = '{}'::jsonb then
    return p_base;
  end if;
  r := coalesce(p_base, '{}'::jsonb) || jsonb_build_object('version', 1);

  -- home: rows are replaced wholesale (a plain object merge does exactly that)
  if p_over ? 'home' then
    r := r || jsonb_build_object('home', coalesce(r -> 'home', '{}'::jsonb) || (p_over -> 'home'));
  end if;

  -- theme: key by key; a null in the higher layer clears the lower value
  if p_over ? 'theme' then
    r := r || jsonb_build_object('theme', coalesce(r -> 'theme', '{}'::jsonb) || (p_over -> 'theme'));
  end if;

  -- widgets: by widget name, then key by key inside it
  if p_over ? 'widgets' then
    select coalesce(jsonb_object_agg(coalesce(b.key, o.key), coalesce(b.value, '{}'::jsonb) || coalesce(o.value, '{}'::jsonb)), '{}'::jsonb)
      into v_w
      from jsonb_each(coalesce(r -> 'widgets', '{}'::jsonb)) b
      full join jsonb_each(p_over -> 'widgets') o on o.key = b.key;
    r := r || jsonb_build_object('widgets', v_w);
  end if;

  -- tabs: by key, key by key. When the higher layer lists every tab of the lower one it also sets the order; otherwise
  -- the lower order stays and tabs only the higher layer knows come last.
  if p_over ? 'tabs' then
    v_complete := not exists (
      select 1 from jsonb_array_elements(coalesce(r -> 'tabs', '[]'::jsonb)) b
       where not exists (select 1 from jsonb_array_elements(p_over -> 'tabs') o where o.value ->> 'key' = b.value ->> 'key'));
    select coalesce(jsonb_agg(coalesce(b.value, '{}'::jsonb) || coalesce(o.value, '{}'::jsonb)
                              order by case when v_complete then coalesce(o.ord, 0) else coalesce(b.ord, 1000000 + o.ord) end), '[]'::jsonb)
      into v_tabs
      from jsonb_array_elements(coalesce(r -> 'tabs', '[]'::jsonb)) with ordinality as b(value, ord)
      full join jsonb_array_elements(p_over -> 'tabs') with ordinality as o(value, ord)
        on o.value ->> 'key' = b.value ->> 'key';
    r := r || jsonb_build_object('tabs', v_tabs);
  end if;

  return r;
end $$;
revoke execute on function app.template_merge(jsonb, jsonb) from public, anon, authenticated;
grant execute on function app.template_merge(jsonb, jsonb) to service_role;

-- The template one community's member app uses, or null when no layer is set. Same door as category_profile: an unknown
-- community, or one not open to the caller, is "not found". A layer that fails app.template_problems is skipped.
create or replace function app.resolve_template(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare
  c app.centers; k app.organization_categories;
  v_layers jsonb[] := '{}'; v_layer jsonb; v_key text; r jsonb;
begin
  if p_center is null or not app.access_center_open(p_center) then
    raise exception 'That community was not found.';
  end if;
  select * into c from app.centers where id = p_center;
  select * into k from app.organization_categories where key = c.category_key;

  -- 1 · the category's template, its parent's first (an experience started from another inherits what it does not change)
  for v_key in
    select x.key from unnest(case when cardinality(k.lineage) > 0 then k.lineage else array[k.key] end) with ordinality as x(key, ord)
     order by x.ord desc
  loop
    v_layers := array_append(v_layers, (select o.template from app.organization_categories o where o.key = v_key));
  end loop;

  -- 2 · the template of the community's default tradition path (the one category_profile calls default_path)
  if k.uses_tradition and k.path_label is not null then
    v_layers := array_append(v_layers, (select cp.template from app.category_paths cp
                                         where cp.category_key = k.key and cp.active and cp.tradition = c.tradition
                                         order by cp.sort, cp.key limit 1));
  end if;

  -- 3 · what the administrator set (Settings, centers.rules.home.template)
  v_layers := array_append(v_layers, c.rules #> '{home,template}');

  foreach v_layer in array v_layers loop
    if v_layer is not null and jsonb_typeof(v_layer) = 'object' and v_layer <> '{}'::jsonb
       and cardinality(app.template_problems(v_layer)) = 0 then
      r := app.template_merge(r, v_layer);
    end if;
  end loop;
  return r;
end $$;
revoke execute on function app.resolve_template(uuid) from public;
grant execute on function app.resolve_template(uuid) to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- C · The two reads the app makes carry the template
-- ════════════════════════════════════════════════════════════════════════════

-- category_profile (0594) with one more key at the end, `template` (null when nothing is set). Everything else, the
-- grants and the security are as in 0594.
--   { "category": {...}, "modules": {...}, "paths": [...], "default_path": ..., "template": {...} | null }
create or replace function app.category_profile(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; k app.organization_categories; v_default text;
begin
  if p_center is null or not app.access_center_open(p_center) then
    raise exception 'That community was not found.';
  end if;
  select * into c from app.centers where id = p_center;
  select * into k from app.organization_categories where key = c.category_key;
  if k.uses_tradition and k.path_label is not null then
    select cp.key into v_default from app.category_paths cp
     where cp.category_key = k.key and cp.active and cp.tradition = c.tradition
     order by cp.sort, cp.key limit 1;
  end if;
  return jsonb_build_object(
    'category', jsonb_build_object('key', k.key, 'label', k.label, 'faith_based', k.faith_based,
                                   'uses_tradition', k.uses_tradition, 'path_label', k.path_label, 'terms', k.terms),
    'modules', coalesce((select jsonb_object_agg(m.key, jsonb_build_object('availability', coalesce(cm.availability, 'default_on'),
                                                                           'label', cm.label))
                           from app.modules m
                           left join app.category_modules cm on cm.category_key = k.key and cm.module_key = m.key), '{}'::jsonb),
    'paths', coalesce((select jsonb_agg(jsonb_build_object('key', cp.key, 'label', cp.label, 'parent', cp.parent_key, 'sort', cp.sort)
                                        order by cp.sort, cp.key)
                         from app.category_paths cp where cp.category_key = k.key and cp.active), '[]'::jsonb),
    'default_path', v_default,
    'template', app.resolve_template(p_center));
end $$;
grant execute on function app.category_profile(uuid) to anon, authenticated, service_role;
revoke execute on function app.category_profile(uuid) from public;

-- member_experience (0614) with one more top-level key, `template` (the same value category_profile carries). Everything else
-- is as in 0614, and the stamp now also covers the template, so a changed template reaches the app on its next refresh.
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
    'default_path', v_prof->'default_path',
    'template', v_prof->'template');
  v_stamp := md5(v_body::text);
  v_updated := greatest(c.updated_at, coalesce((select max(x.changed_at) from app.center_modules x where x.center_id = p_center), c.updated_at));
  if p_known_stamp is not null and p_known_stamp = v_stamp then
    return jsonb_build_object('stamp', v_stamp, 'unchanged', true, 'updated_at', v_updated);
  end if;
  return v_body || jsonb_build_object('stamp', v_stamp, 'unchanged', false, 'updated_at', v_updated);
end $$;
revoke execute on function app.member_experience(uuid, text) from public;
grant execute on function app.member_experience(uuid, text) to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- D · The starter templates
-- ════════════════════════════════════════════════════════════════════════════
-- Row ids: today (the day's card), special_days (festival and fast days), events, giving, life (the person's own milestones
-- and notices), learn (the school and the learning path). A row whose module an organization does not have hides itself in the
-- app. Every template lists all five tabs, so a resolved list is never partial. A tab with no label/icon uses the app's
-- default (for the practice tab: the category's own word, terms.practice_tab). Motifs ready for the faiths that have no
-- experience yet: khanda (Sikh), dharma_wheel (Buddhist). No tradition path exists outside the Jain Center, so none is invented.

-- Jain Center: EXACTLY today's layout (the member app of the JSH temple must not change). The theme is all null on purpose.
update app.organization_categories set template = $t$
{"version": 1,
 "home":    {"rows": ["today", "special_days", "events", "giving", "life", "learn"]},
 "tabs":    [{"key": "index"}, {"key": "events"}, {"key": "give"}, {"key": "jain-way"}, {"key": "family"}],
 "theme":   {"primary": null, "accent": null, "surface": null, "radius": null, "motif": null},
 "widgets": {"today": {"variant": "full"}}}
$t$::jsonb where key = 'jain_center';

-- Community organization (clubs, associations, non-profits that are not a house of worship): a plain day card, no festival
-- days, no Jain Way tab, a calm teal on cool surfaces.
update app.organization_categories set template = $t$
{"version": 1,
 "home":    {"rows": ["today", "events", "giving", "life", "learn"]},
 "tabs":    [{"key": "index"}, {"key": "events"}, {"key": "give"}, {"key": "jain-way", "hidden": true}, {"key": "family"}],
 "theme":   {"accent": "#0E7C86", "surface": "cool"},
 "widgets": {"today": {"variant": "basic"}}}
$t$::jsonb where key = 'nonprofit_secular';

-- Chamber of commerce: events, dues and payments, and the member's own business; no practice tab; an indigo of its own.
-- (The day card is not on its Home; if an administrator adds it, it is the plain one.)
update app.organization_categories set template = $t$
{"version": 1,
 "home":    {"rows": ["events", "giving", "life"]},
 "tabs":    [{"key": "index"}, {"key": "events"}, {"key": "give"}, {"key": "jain-way", "hidden": true}, {"key": "family"}],
 "theme":   {"primary": "#3D3BB8"},
 "widgets": {"today": {"variant": "basic"}}}
$t$::jsonb where key = 'chamber_of_commerce';

-- Faith community (a house of worship with no kind of its own yet): the day card shows service times; the practice tab is
-- called what the category's words call it (label null).
update app.organization_categories set template = $t$
{"version": 1,
 "home":    {"rows": ["today", "events", "giving", "life", "learn"]},
 "tabs":    [{"key": "index"}, {"key": "events"}, {"key": "give"}, {"key": "jain-way", "label": null}, {"key": "family"}],
 "widgets": {"today": {"variant": "service_times"}}}
$t$::jsonb where key = 'faith_other';

-- The faith experiences that inherit from the faith community: a small overlay (warm surfaces and their motif) over their
-- parent's template, merged by app.resolve_template. Inactive until reviewed by someone of that faith (0600).
update app.organization_categories k
   set template = jsonb_build_object(
         'version', 1,
         'theme', jsonb_build_object('surface', 'warm', 'motif', v.motif),
         'widgets', jsonb_build_object('today', jsonb_build_object('variant', 'service_times')))
  from (values ('swaminarayan_temple', 'om'), ('church', 'cross'), ('mosque', 'crescent')) as v(key, motif)
 where k.key = v.key;

-- Fail the migration, not the app, if a seed is wrong.
do $$
declare r record;
begin
  for r in select 'category ' || key as what, app.template_problems(template) as problems
             from app.organization_categories where template is not null
           union all
           select 'path ' || category_key || '/' || key, app.template_problems(template)
             from app.category_paths where template is not null
  loop
    if cardinality(r.problems) > 0 then
      raise exception 'The template of % is not valid: %', r.what, r.problems[1];
    end if;
  end loop;
end $$;
