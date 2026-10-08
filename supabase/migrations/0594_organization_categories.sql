-- 0594 · Organization categories, database part 1 of 3 (docs/ORGANIZATION_CATEGORIES_PLAN.md, "PR 1";
-- owner accepted the plan 2026-10-06, all ten recommended answers, 2026-10-07).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   An organization now has a CATEGORY: Jain Center, Chamber of commerce, Non-profit (not faith-based) or
--   Faith-based non-profit (other faiths). The category decides which modules the organization can have at
--   all. JSH and every existing community become "Jain Center" through the column default, and Jain Center
--   has all 18 modules "default_on", which the module functions below turn into exactly today's rule
--   ("no center_modules row means on"). Only Jain Center is active: the other three can be chosen only by
--   Community Connect and only for a sandbox, to preview them. Nothing changes for any community that is
--   already running.
--
-- SECTIONS (the access-rule changes are marked ACCESS and listed in the pull request for the owner to approve
-- one by one; section G is last so it can be dropped on its own)
--   A  The three catalogs: organization_categories, category_modules, category_paths (reference data, read only)
--   B  centers.category_key (default 'jain_center'), its insert rule, the tradition rule
--   C  Creating and promoting an organization carries its category (platform_create_sandbox, promotion)
--   D  Words and Setup: the dietary seed, the Setup checklist texts, category_profile, module_states
--   E  ACCESS 1  The three module functions know the category (the spine every module table's RLS and RPC guard use)
--   F  ACCESS 2  Who may set or change a category (guard trigger, set_center_category, preview, request category)
--   G  ACCESS 3  A person's path (person_profile_details.path_key): who reads and writes it, and its audit mask
set client_min_messages = warning;

-- ════════════════════════════════════════════════════════════════════════════
-- A · The three catalogs
-- ════════════════════════════════════════════════════════════════════════════

-- The named words of a category (plan §3.1.3). The database checks the keys so the apps and the worker can rely on
-- them: exactly these nine, each a non-empty string, except that the practice tab, the school and the learning path
-- may be JSON null (the category has no such thing).
create or replace function app.category_terms_ok(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select case when p is not null and jsonb_typeof(p) = 'object' then (
           (select count(*) from jsonb_object_keys(p)) = 9
           and not exists (select 1 from jsonb_object_keys(p) k
                            where k <> all (array['greeting','practice_tab','give_tab','family_tab','store','school','learning','place','assistant_context']))
           and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) not in ('string', 'null'))
           and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) = 'null' and e.key <> all (array['practice_tab','school','learning']))
           and not exists (select 1 from jsonb_each(p) e where jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') = '')
         ) else false end
$$;

create table if not exists app.organization_categories (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label          text not null check (char_length(btrim(label)) between 1 and 80),
  description    text not null default '',
  faith_based    boolean not null,
  -- true only for Jain Center: centers.tradition and the shared Jain library apply
  uses_tradition boolean not null default false,
  -- the sign-up question that asks a person's path; null means the category asks none
  path_label     text check (path_label is null or char_length(btrim(path_label)) between 1 and 120),
  terms          jsonb not null,
  -- whether the category can be chosen for a new (live) organization. An inactive one can be chosen only by
  -- Community Connect, for a sandbox, to preview it (centers_category_rules).
  active         boolean not null default false,
  sort           int not null default 0,
  constraint organization_categories_terms_ok check (app.category_terms_ok(terms))
);
comment on table app.organization_categories is
  'The kinds of organization (0594, docs/ORGANIZATION_CATEGORIES_PLAN.md). Platform data: written only by migrations, read by everyone (the member app needs it before sign-in). Only an active category can be chosen for a live organization.';
comment on column app.organization_categories.terms is
  'The category''s named words (greeting, practice_tab, give_tab, family_tab, store, school, learning, place, assistant_context); the keys are checked by app.category_terms_ok. JSON null = the category has no such thing.';

insert into app.organization_categories (key, label, description, faith_based, uses_tradition, path_label, terms, active, sort) values
  ('jain_center', 'Jain Center', 'Jain temples, sanghs and societies', true, true, 'Which Jain tradition do you follow?',
   '{"greeting":"Jai Jinendra","practice_tab":"Jain Way","give_tab":"Give","family_tab":"Family","store":"Satvik Store","school":"Pathshala","learning":"Gyan Path","place":"derasar","assistant_context":"a Jain community"}'::jsonb,
   true, 10),
  ('chamber_of_commerce', 'Chamber of commerce', 'Chambers and business associations (usually 501(c)(6))', false, false, null,
   '{"greeting":"Welcome","practice_tab":null,"give_tab":"Pay","family_tab":"My business","store":"Store","school":null,"learning":null,"place":"office","assistant_context":"a chamber of commerce"}'::jsonb,
   false, 20),
  ('nonprofit_secular', 'Non-profit (not faith-based)', 'Community, cultural and service non-profits', false, false, null,
   '{"greeting":"Welcome","practice_tab":null,"give_tab":"Give","family_tab":"Family","store":"Store","school":null,"learning":null,"place":"office","assistant_context":"a non-profit organization"}'::jsonb,
   false, 30),
  ('faith_other', 'Faith-based non-profit (other faiths)', 'Churches, Hindu temples, gurdwaras, mosques and other faiths', true, false, null,
   '{"greeting":"Welcome","practice_tab":"Learn","give_tab":"Give","family_tab":"Family","store":"Store","school":"Religious school","learning":"Learning path","place":"place of worship","assistant_context":"a faith community"}'::jsonb,
   false, 40)
on conflict (key) do nothing;

-- The modules of each category (plan §3.1.2): one row per category and module.
--   default_on     on unless the organization switches it off (today's rule)
--   default_off    off until the organization switches it on
--   not_available  never on, hidden everywhere, not even offered as a switch
-- label / description: the category's own name for the module ("Religious school" for Pathshala).
create table if not exists app.category_modules (
  category_key text not null references app.organization_categories(key),
  module_key   text not null references app.modules(key),
  availability text not null check (availability in ('default_on', 'default_off', 'not_available')),
  label        text check (label is null or char_length(btrim(label)) between 1 and 60),
  description  text check (description is null or char_length(btrim(description)) between 1 and 400),
  primary key (category_key, module_key)
);
comment on table app.category_modules is
  'Which modules a category has (0594): default_on = on unless switched off (the 0101 rule), default_off = off until switched on, not_available = never. Every category has a row for every module; core modules are always default_on. Written only by migrations.';

-- A core module is never off, in any category. (The test also checks a row exists for every module and that an
-- available module never depends on one that is not.)
create or replace function app.category_modules_check() returns trigger
language plpgsql set search_path = app, public, extensions as $$
begin
  if new.availability <> 'default_on' and exists (select 1 from app.modules m where m.key = new.module_key and m.core) then
    raise exception 'The % module is part of the core platform, so every category has it on.', new.module_key;
  end if;
  return new;
end $$;
drop trigger if exists category_modules_check on app.category_modules;
create trigger category_modules_check before insert or update on app.category_modules
  for each row execute function app.category_modules_check();

-- The 4 x 18 matrix of plan §3.1.2. Jain Center: everything default_on (today). Chamber of commerce and
-- Non-profit: never Bolis or My Jain Way, Pathshala or Gyan Path; Store and Niva start off. Faith-based (other):
-- never Bolis or My Jain Way; Pathshala ("Religious school"), Gyan Path ("Learning path"), Store and Niva start off.
-- (Labh joins as its own module in database part 2.)
insert into app.category_modules (category_key, module_key, availability, label)
select k.key, m.key,
       case
         when k.key = 'jain_center' then 'default_on'
         when m.key in ('bolis', 'jain_way') then 'not_available'
         when m.key in ('pathshala', 'gyan_path') then case when k.key = 'faith_other' then 'default_off' else 'not_available' end
         when m.key in ('store', 'niva') then 'default_off'
         else 'default_on'
       end,
       case
         when k.key = 'jain_center' then null
         when m.key = 'giving' and k.key = 'chamber_of_commerce' then 'Dues & payments'
         when m.key = 'store' then 'Store'
         when m.key = 'pathshala' and k.key = 'faith_other' then 'Religious school'
         when m.key = 'gyan_path' and k.key = 'faith_other' then 'Learning path'
         else null
       end
  from app.organization_categories k cross join app.modules m
on conflict (category_key, module_key) do nothing;

-- A person's own path inside the community (plan §3.4): two levels, a branch and then a path. A person may stop
-- at the branch. `tradition` maps a community's default tradition (centers.tradition) to a path.
create table if not exists app.category_paths (
  category_key text not null references app.organization_categories(key),
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,59}$'),
  label        text not null check (char_length(btrim(label)) between 1 and 80),
  parent_key   text,
  tradition    app.tradition,
  aliases      text[] not null default '{}',
  sort         int not null default 0,
  active       boolean not null default true,
  primary key (category_key, key),
  constraint category_paths_parent_fk foreign key (category_key, parent_key) references app.category_paths (category_key, key),
  constraint category_paths_not_own_parent check (parent_key is distinct from key)
);
comment on table app.category_paths is
  'The person-level paths of a category (0594, plan §3.4). Written only by migrations (adding a path later is one row). A person''s answer is app.person_profile_details.path_key.';

-- The Jain Center list (plan §3.4.1, decision C7). The spelling is "Shwetambar"; the other spellings are found by
-- search (aliases). "terapanthi" in centers.tradition reads as the Shwetambar Terapanth (finding F8); a branch row
-- comes first for "digambar".
insert into app.category_paths (category_key, key, label, parent_key, tradition, aliases, sort) values
  ('jain_center', 'shwetambar',             'Shwetambar (not sure which)', null,         null,                       '{Swetambar,Shvetambar,Svetambara}', 10),
  ('jain_center', 'shwetambar_murtipujak',  'Murtipujak (Derawasi)',       'shwetambar', 'shvetambar_murtipujak',    '{Deravasi,Mandirmargi}',            11),
  ('jain_center', 'shwetambar_sthanakvasi', 'Sthanakvasi',                 'shwetambar', 'sthanakvasi',              '{Sthanakwasi}',                     12),
  ('jain_center', 'shwetambar_terapanth',   'Terapanth',                   'shwetambar', 'terapanthi',               '{Terapanthi}',                      13),
  ('jain_center', 'digambar',               'Digambar (not sure which)',   null,         'digambar',                 '{Digamber}',                        20),
  ('jain_center', 'digambar_bispanthi',     'Bispanthi',                   'digambar',   'digambar',                 '{Beespanthi,Bisapanthi}',           21),
  ('jain_center', 'digambar_terapanth',     'Terapanth',                   'digambar',   'digambar',                 '{Terapanthi}',                      22),
  ('jain_center', 'digambar_taranpanth',    'Taranpanth',                  'digambar',   'digambar',                 '{"Taran Panth"}',                   23),
  ('jain_center', 'other',                  'Another path',                null,         null,                       '{}',                                90),
  ('jain_center', 'not_sure',               'Not sure, or more than one',  null,         null,                       '{}',                                99)
on conflict (category_key, key) do nothing;

-- Reference data: read by everyone, guests included (the member app needs it before sign-in); nobody writes it
-- through the API. Core platform tables (no module switch), audited like every table.
alter table app.organization_categories enable row level security;
alter table app.category_modules enable row level security;
alter table app.category_paths enable row level security;
drop policy if exists organization_categories_read on app.organization_categories;
create policy organization_categories_read on app.organization_categories for select to anon, authenticated using (true);
drop policy if exists category_modules_read on app.category_modules;
create policy category_modules_read on app.category_modules for select to anon, authenticated using (true);
drop policy if exists category_paths_read on app.category_paths;
create policy category_paths_read on app.category_paths for select to anon, authenticated using (true);
revoke all on app.organization_categories, app.category_modules, app.category_paths from public, anon, authenticated;
grant select on app.organization_categories, app.category_modules, app.category_paths to anon, authenticated;
grant all on app.organization_categories, app.category_modules, app.category_paths to service_role;

drop trigger if exists audit_organization_categories on app.organization_categories;
create trigger audit_organization_categories after insert or update or delete on app.organization_categories
  for each row execute function app.audit_row('key');
drop trigger if exists audit_category_modules on app.category_modules;
create trigger audit_category_modules after insert or update or delete on app.category_modules
  for each row execute function app.audit_row('category_key', 'module_key');
drop trigger if exists audit_category_paths on app.category_paths;
create trigger audit_category_paths after insert or update or delete on app.category_paths
  for each row execute function app.audit_row('category_key', 'key');
insert into app.module_tables (table_name, module_key)
values ('organization_categories', null), ('category_modules', null), ('category_paths', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ════════════════════════════════════════════════════════════════════════════
-- B · The organization's category
-- ════════════════════════════════════════════════════════════════════════════
-- Not in centers.rules, which a community admin can replace wholesale. The column default fills JSH and every
-- existing community in this very statement (the catalog above already has 'jain_center'); no other row changes.
alter table app.centers add column if not exists category_key text not null default 'jain_center'
  references app.organization_categories(key);
comment on column app.centers.category_key is
  'The organization''s category (0594). Chosen when the sandbox is created; changed only through app.set_center_category (a platform admin, a fresh 2FA check, a reason); read like every centers column.';

-- Two rules that need no signed-in person to bypass them:
--  1. A new organization gets an ACTIVE category, or any category when it is a sandbox (Community Connect chooses
--     an inactive category to preview it; only platform admins create sandboxes, directly or by approving a request).
--  2. For a category that does not use a tradition, centers.tradition is 'other' (the value that exists and is never
--     offered), so even an old app build's tradition filter hides the shared Jain library.
-- The guard for CHANGING the category is in section F (ACCESS 2), with the function that is allowed to.
create or replace function app.centers_category_rules() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare k app.organization_categories;
begin
  select * into k from app.organization_categories where key = new.category_key;
  if k.key is null then
    raise exception 'There is no organization category called "%".', new.category_key using errcode = '23503';
  end if;
  if tg_op = 'INSERT' and not k.active and new.environment is distinct from 'sandbox' then
    raise exception 'The % category is not switched on yet. It can only be chosen for a sandbox, to preview it.', k.label
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and new.category_key is distinct from old.category_key
     and auth.uid() is not null
     and coalesce(current_setting('app.category_change', true), '') is distinct from txid_current()::text then
    raise exception 'An organization''s category can only be changed by Community Connect, with a reason and a fresh 2FA check (Platform › the organization › Category).'
      using errcode = 'insufficient_privilege';
  end if;
  if not k.uses_tradition and (tg_op = 'INSERT' or new.category_key is distinct from old.category_key
                               or new.tradition is distinct from old.tradition) then
    new.tradition := 'other';
  end if;
  return new;
end $$;
drop trigger if exists centers_category_rules on app.centers;
create trigger centers_category_rules before insert or update of category_key, tradition on app.centers
  for each row execute function app.centers_category_rules();
revoke execute on function app.centers_category_rules() from public, anon, authenticated;

-- The request form's category: chosen by Community Connect before approving (app.set_access_request_category).
alter table app.access_requests add column if not exists category_key text references app.organization_categories(key);
comment on column app.access_requests.category_key is
  'The category Community Connect chose for the organization when approving this request (0594). Null = Jain Center, as before. The applicant''s own "Kind of organization" (org_type) stays a hint.';

-- The two internal readers every function below uses.
create or replace function app.center_category(p_center uuid) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select c.category_key from app.centers c where c.id = p_center
$$;

-- The category's row for a module; a missing row (or no such center) is 'default_on', which keeps the 0101 contract
-- ("no row means on"). A null center is never switched off, as in module_enabled.
create or replace function app.module_availability(p_center uuid, p_module text) returns text
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce((select cm.availability from app.centers c
                     join app.category_modules cm on cm.category_key = c.category_key and cm.module_key = p_module
                    where c.id = p_center), 'default_on')
$$;
revoke execute on function app.center_category(uuid), app.module_availability(uuid, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- C · Creating and promoting an organization carries its category
-- ════════════════════════════════════════════════════════════════════════════

-- 0502's shared center creation (same signature) reading the category: from the platform admin's own choice when the
-- console creates the sandbox (onboarding.category_key), else from the access request being redeemed
-- (onboarding.request_id, which redeem_sandbox_code already passes, so it needs no change), else Jain Center.
-- The category is a column, never kept in rules.
create or replace function app._create_sandbox_center(p_base_slug text, p_name text, p_state text, p_city text,
                                                      p_website text, p_onboarding jsonb) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare v_slug text := lower(btrim(coalesce(p_base_slug, ''))); v_center uuid; v_category text;
        v_request uuid := case when p_onboarding->>'request_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                               then (p_onboarding->>'request_id')::uuid end;
begin
  if v_slug !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' or v_slug like '%--%' then
    raise exception 'Choose a web name of 2 to 40 lowercase letters, numbers and single dashes, for example "jain-center-dallas".';
  end if;
  if v_slug ~ '-sandbox$' then raise exception 'Choose the name without "-sandbox"; it is added for you.'; end if;
  if exists (select 1 from app.centers x where lower(x.slug::text) in (v_slug, v_slug || '-sandbox')) then
    raise exception 'The web name "%" is already taken. Choose another.', v_slug;
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Enter the organization''s name.'; end if;
  v_category := coalesce(nullif(btrim(p_onboarding->>'category_key'), ''),
                         (select r.category_key from app.access_requests r where r.id = v_request),
                         'jain_center');
  if not exists (select 1 from app.organization_categories k where k.key = v_category) then
    raise exception 'Choose the category of the organization.';
  end if;
  insert into app.centers (slug, name, state_region, status, environment, category_key, rules)
  values (v_slug || '-sandbox', btrim(p_name), nullif(btrim(coalesce(p_state, '')), ''), 'onboarding', 'sandbox', v_category,
          jsonb_build_object('security', jsonb_build_object('require_2fa_for_staff', true),
                             'onboarding', jsonb_build_object('production_slug', v_slug)
                                           || (coalesce(p_onboarding, '{}'::jsonb) - 'category_key')))
  returning id into v_center;
  insert into app.org_profiles (center_id, legal_name, website, registered_address)
  values (v_center, btrim(p_name), nullif(btrim(coalesce(p_website, '')), ''),
          case when nullif(btrim(coalesce(p_city, '')), '') is null then null
               else jsonb_build_object('city', btrim(p_city), 'state', nullif(btrim(coalesce(p_state, '')), '')) end)
  on conflict (center_id) do nothing;
  return v_center;
end $$;

-- 0502's console action with a last argument, p_category_key. The old 10-argument function is dropped so the API
-- sees one function: a call with ten arguments (the portal's button today) resolves to this one and the default
-- keeps it working until the portal asks for the category (portal part 1). Everything else is 0502 word for word.
drop function if exists app.platform_create_sandbox(text, text, text, text, text, text, text, text, text, text);
create or replace function app.platform_create_sandbox(
  p_name text, p_slug text, p_org_type text, p_city text, p_state text,
  p_owner_first_name text, p_owner_last_name text, p_owner_email text, p_reason text, p_link_base text default null,
  p_category_key text default 'jain_center')
returns jsonb language plpgsql security definer set search_path = app, public, extensions as $$
declare v_base text := regexp_replace(lower(btrim(coalesce(p_slug, ''))), '-sandbox$', '');
        v_email text := lower(nullif(btrim(p_owner_email), '')); v_first text := nullif(btrim(p_owner_first_name), '');
        v_last text := nullif(btrim(p_owner_last_name), ''); v_reason text := app.audit_clean_reason(p_reason);
        v_center uuid; v_token text; v_inv uuid; v_exp timestamptz; v_link text; v_mail jsonb; v_slug text;
        v_base_url text := nullif(regexp_replace(btrim(coalesce(p_link_base, '')), '/+$', ''), '');
        v_category text := nullif(btrim(coalesce(p_category_key, '')), '');
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can create a sandbox directly.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(p_org_type, '') not in ('temple','community_center','other_nonprofit') then
    raise exception 'Choose the kind of organization: temple, community center or other non-profit.';
  end if;
  if v_category is null or not exists (select 1 from app.organization_categories k where k.key = v_category) then
    raise exception 'Choose the category of the organization: Jain Center, Chamber of commerce, Non-profit (not faith-based) or Faith-based non-profit (other faiths).';
  end if;
  if length(btrim(coalesce(p_city, ''))) < 1 or length(btrim(coalesce(p_state, ''))) < 2 then raise exception 'Enter the city and state.'; end if;
  if v_first is null then raise exception 'Enter the owner''s first name.'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter the owner''s email address.'; end if;
  if v_reason is null then raise exception 'Give a reason for creating this sandbox. It goes in the audit log.'; end if;
  if v_base_url is not null and v_base_url !~ '^https?://[A-Za-z0-9.:\-\[\]]+$' then
    raise exception 'The portal address for the invitation link is not valid (%).', p_link_base;
  end if;
  if (select lower(email) from auth.users where id = auth.uid()) = v_email then
    raise exception 'Invite the organization''s owner, not yourself: the owner must be a different person from the Community Connect admin who creates the sandbox.';
  end if;
  perform app.assert_step_up('platform.create_sandbox');
  perform app.set_audit_context(v_reason);

  v_center := app._create_sandbox_center(v_base, p_name, upper(btrim(p_state)), p_city, null,
                jsonb_build_object('source', 'platform_admin', 'created_by', auth.uid(), 'org_type', p_org_type,
                                   'owner_email', v_email, 'category_key', v_category));
  v_slug := v_base || '-sandbox';

  v_token := app.new_invitation_token();
  v_exp := now() + interval '14 days';
  insert into app.staff_invitations (center_id, email, first_name, last_name, role_keys, invited_by, token_hash, expires_at, makes_owner)
  values (v_center, v_email, v_first, v_last, array['center_admin'], auth.uid(), app.invitation_token_hash(v_token), v_exp, true)
  returning id into v_inv;
  v_link := coalesce(v_base_url, '') || '/invite/' || v_token;
  v_mail := app.platform_send_message(v_email, 'staff_invitation',
              jsonb_build_object('inviter', 'Community Connect', 'center_name', btrim(p_name),
                                 'roles', 'owner and administrator', 'link', v_link, 'invite_path', '/invite/' || v_token,
                                 'expires_on', to_char(v_exp at time zone 'UTC', 'FMMonth FMDD, YYYY')),
              'notification');
  return jsonb_build_object('center_id', v_center, 'slug', v_slug, 'invitation_id', v_inv, 'token', v_token,
                            'expires_at', v_exp, 'email_status', app.message_status_text(v_mail));
end $$;
revoke execute on function app.platform_create_sandbox(text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function app.platform_create_sandbox(text, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- 0500's promotion request, plus: a sandbox whose category is not active yet cannot go live (it is a preview).
create or replace function app.promote_sandbox(p_sandbox uuid, p_slug text, p_reason text) returns uuid
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; g app.golive_requests; v_slug text := lower(btrim(coalesce(p_slug, ''))); v_id uuid; v_job bigint;
        v_in_place boolean; v_demo text; v_cat app.organization_categories;
begin
  if auth.uid() is null or not app.is_center_owner(p_sandbox) then
    raise exception 'Only the owner of this sandbox can promote it to production.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.centers where id = p_sandbox for update;
  if c.environment <> 'sandbox' then raise exception 'Only a sandbox can be promoted. This organization is already in production.'; end if;
  if c.sandbox_for is not null then raise exception 'This sandbox has already been promoted.'; end if;
  select * into v_cat from app.organization_categories where key = c.category_key;
  if v_cat.key is null or not v_cat.active then
    raise exception '% is a preview of the % category, which is not switched on yet, so it cannot go live. Ask Community Connect.',
      c.name, coalesce(v_cat.label, c.category_key);
  end if;
  if exists (select 1 from app.sandbox_promotions where sandbox_id = p_sandbox and status = 'queued') then
    raise exception 'A promotion of this sandbox is already running.';
  end if;
  select * into g from app.golive_requests where center_id = p_sandbox and status = 'approved' order by requested_at desc limit 1;
  if g.id is null then raise exception 'Community Connect must approve go-live (two approvals) before the sandbox can be promoted.'; end if;
  if app.audit_clean_reason(p_reason) is null then raise exception 'Give a reason for the promotion. It goes in the audit log.'; end if;
  v_in_place := app.promotes_in_place(p_sandbox);
  if v_in_place then
    -- The organization keeps its web name; a different one is not offered.
    if v_slug <> '' and v_slug <> lower(c.slug::text) then
      raise exception '% goes live under its own web name "%", keeping all its records. Leave the web name as it is.', c.name, c.slug;
    end if;
    v_slug := lower(c.slug::text);
    select d.status into v_demo from app.center_demo_state d where d.center_id = p_sandbox;
    if coalesce(v_demo, 'empty') <> 'empty' then
      raise exception 'Demo data is loaded in %. Going live in place would turn it into real records. Clear it first (Setup › Demo data) — clearing removes everything the organization entered.', c.name;
    end if;
  else
    if v_slug !~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$' or v_slug like '%--%' or v_slug ~ '-sandbox$' then
      raise exception 'Choose the production web name: 2 to 40 lowercase letters, numbers and single dashes, without "-sandbox".';
    end if;
    if exists (select 1 from app.centers x where lower(x.slug::text) = v_slug) then
      raise exception 'The web name "%" is already taken. Choose another.', v_slug;
    end if;
  end if;
  perform app.assert_step_up('platform.promote');
  perform app.set_audit_context(p_reason);
  insert into app.sandbox_promotions (sandbox_id, golive_id, slug, reason, requested_by)
  values (p_sandbox, g.id, v_slug, app.audit_clean_reason(p_reason), auth.uid()) returning id into v_id;
  v_job := app.enqueue_job(p_sandbox, 'platform.promote', jsonb_build_object('promotion_id', v_id, 'in_place', v_in_place), now(), 3);
  update app.sandbox_promotions set job_id = v_job where id = v_id;
  return v_id;
end $$;

-- 0500's dispatcher with one change on the COPY route: 0203's copy inserts the production row listing its columns one
-- by one, so the new row starts as a Jain Center; the category is set from the sandbox right after, so a promoted
-- chamber never comes back as a Jain Center. The copy also seeded the Jain dietary option (the row was a Jain Center
-- for a moment): nobody can have chosen it yet, so it is removed again for any other category. In place (JSH) keeps
-- the row, so keeps its category.
create or replace function app.worker_promote_sandbox(p_promotion uuid) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.sandbox_promotions; s app.centers; v_demo text; v_result jsonb; v_prod uuid;
begin
  perform app.assert_worker();
  perform set_config('app.client_app', 'job', true);
  select * into p from app.sandbox_promotions where id = p_promotion for update;
  if p.id is null then raise exception 'Promotion % was not found.', p_promotion; end if;
  if p.status = 'done' then return coalesce(p.result, '{}'::jsonb); end if;
  select * into s from app.centers where id = p.sandbox_id for update;
  if not app.promotes_in_place(s.id) then
    v_result := app._worker_promote_sandbox_copy(p_promotion);
    v_prod := case when v_result->>'production_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   then (v_result->>'production_id')::uuid end;
    if v_prod is not null and s.category_key is distinct from (select x.category_key from app.centers x where x.id = v_prod) then
      update app.centers set category_key = s.category_key where id = v_prod;
      if s.category_key <> 'jain_center' then
        delete from app.dietary_options where center_id = v_prod and key = 'jain';
      end if;
    end if;
    return v_result;
  end if;

  -- In place: the organization itself becomes production. Nothing is copied or removed.
  if s.environment <> 'sandbox' then raise exception 'Center % is not a sandbox.', s.slug; end if;
  if s.sandbox_for is not null then raise exception 'Sandbox % was already promoted.', s.slug; end if;
  if not exists (select 1 from app.golive_requests g where g.id = p.golive_id and g.status = 'approved') then
    raise exception 'The go-live approval for this promotion is no longer in place.';
  end if;
  select d.status into v_demo from app.center_demo_state d where d.center_id = s.id;
  if coalesce(v_demo, 'empty') <> 'empty' then
    raise exception 'Demo data was loaded in % after the promotion was requested. Clear it, then ask the owner to promote again.', s.name;
  end if;
  perform app.set_audit_context('Promotion in place (' || s.slug || '): ' || p.reason);
  update app.centers
     set environment = 'production',
         rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{onboarding}',
                           coalesce(rules->'onboarding', '{}'::jsonb)
                             || jsonb_build_object('promoted_in_place_at', now(), 'promotion_id', p.id))
   where id = s.id;
  update app.golive_requests set status = 'live' where center_id = s.id and status = 'approved';
  v_result := jsonb_build_object('production_id', s.id, 'slug', s.slug, 'in_place', true, 'tables', '[]'::jsonb,
                                 'staff_reinvited', 0,
                                 'note', 'Every record was kept. Services connected in test mode stay in test mode until they are switched to live.');
  update app.sandbox_promotions
     set status = 'done', production_id = s.id, finished_at = now(), last_error = null, result = v_result
   where id = p.id;
  return v_result;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- D · Words and Setup
-- ════════════════════════════════════════════════════════════════════════════

-- 0546's seed, with the Jain option only for a Jain Center (the other options are every community's).
-- Existing communities keep their list: a community may have edited it and members may have chosen "jain".
create or replace function app.seed_default_dietary_options() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.dietary_options (center_id, key, label, sort)
  select new.id, v.key, v.label, v.sort
    from (values ('vegetarian', 'Vegetarian', 1), ('vegan', 'Vegan', 2), ('jain', 'Jain (no root vegetables)', 3),
                 ('gluten_free', 'Gluten-free', 4), ('nut_allergy', 'Nut allergy', 5), ('diabetic', 'Diabetic', 6),
                 ('other', 'Other', 99)) as v(key, label, sort)
   where v.key <> 'jain' or new.category_key = 'jain_center'
  on conflict (center_id, key) do nothing;
  return new;
end $$;

-- Setup's "Choose modules" step says which set the organization has when it has not chosen yet. For a category with
-- the full set (Jain Center) the answer is exactly as before: only the sentence changes, and only when the category
-- does not have every module on.
do $$ begin
  if to_regprocedure('app._setup_auto_status_before_0594(uuid,boolean)') is null then
    alter function app.setup_auto_status(uuid, boolean) rename to _setup_auto_status_before_0594;
  end if;
end $$;
create or replace function app.setup_auto_status(p_center uuid, p_with_readiness boolean default true) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v jsonb; v_cat app.organization_categories;
begin
  v := app._setup_auto_status_before_0594(p_center, p_with_readiness);
  select k.* into v_cat from app.centers c join app.organization_categories k on k.key = c.category_key where c.id = p_center;
  if v_cat.key is not null
     and exists (select 1 from app.category_modules cm where cm.category_key = v_cat.key and cm.availability <> 'default_on')
     and v #>> '{org.modules,detail}' = 'Every module is on (the default)' then
    v := jsonb_set(v, '{org.modules,detail}', to_jsonb('The ' || v_cat.label || ' set of modules (the default)'::text));
  end if;
  return v;
end $$;
revoke execute on function app.setup_auto_status(uuid, boolean), app._setup_auto_status_before_0594(uuid, boolean)
  from public, anon, authenticated;

-- 0302's checklist, with one sentence changed: a step of a module the category does not have is skipped with
-- "Not part of a <category> organization." (a module the organization switched off, or has not switched on yet, says
-- what it said before).
create or replace function app.setup_checklist(p_center uuid)
returns table (step_key text, stage int, sort int, title text, description text, help text, done_means text, route text,
               owner_role text, module_key text, required boolean, auto boolean, manual boolean,
               status text, computed_status text, stored_status text, detail text,
               owner_person_id uuid, owner_name text, due_on date, notes text, completed_by uuid, completed_at timestamptz,
               updated_at timestamptz)
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_auto jsonb; v_cat text;
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'You don''t have access to this community''s setup (it needs settings.manage or the owner).' using errcode = '42501';
  end if;
  v_auto := app.setup_auto_status(p_center);
  select k.label into v_cat from app.centers c join app.organization_categories k on k.key = c.category_key where c.id = p_center;
  return query
  select s.key, s.stage, s.sort, s.title, s.description, s.help, s.done_means, s.route, s.owner_role, s.module_key,
         s.required, s.auto, s.manual,
         case
           when s.module_key is not null and not app.module_enabled(p_center, s.module_key) then 'skipped'
           when v_auto->s.key->>'status' = 'done' then 'done'
           when not s.manual then coalesce(v_auto->s.key->>'status', 'not_started')
           when s.live and coalesce(v_auto->s.key->>'status', 'not_started') <> 'not_started' then v_auto->s.key->>'status'
           when s.live and cs.status = 'done' then coalesce(v_auto->s.key->>'status', 'not_started')
           when cs.status is not null and cs.status <> 'not_started' then cs.status
           else coalesce(v_auto->s.key->>'status', 'not_started') end,
         v_auto->s.key->>'status',
         cs.status,
         case when s.module_key is not null and not app.module_enabled(p_center, s.module_key)
              then case when app.module_availability(p_center, s.module_key) = 'not_available'
                        then 'Not part of a ' || coalesce(v_cat, 'this') || ' organization.'
                        else 'The ' || m.label || ' module is switched off.' end
              else v_auto->s.key->>'detail' end,
         cs.owner_person_id,
         case when pe.id is null then null else coalesce(nullif(pe.preferred_name, ''), pe.first_name) || ' ' || pe.last_name end,
         cs.due_on, cs.notes, cs.completed_by, cs.completed_at, cs.updated_at
    from app.setup_steps s
    left join app.center_setup_steps cs on cs.center_id = p_center and cs.step_key = s.key
    left join app.people pe on pe.id = cs.owner_person_id
    left join app.modules m on m.key = s.module_key
   order by s.stage, s.sort;
end $$;

-- What the apps ask once per community, with or without a session (plan §3.8):
--   { "category": {key, label, faith_based, uses_tradition, path_label, terms},
--     "modules":  { "<module_key>": {availability, label} },      the category's rows (not the community's own switches)
--     "paths":    [ {key, label, parent, sort} ],                 [] when the category asks no path
--     "default_path": a path key or null }                        the community's default tradition as a path
-- "That community was not found." for an unknown community or one not open to the caller (the 0586 rule).
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
    'default_path', v_default);
end $$;

-- Settings › Modules (plan §3.3): every module with the category's availability next to the organization's own
-- switch, so the page no longer has to read center_modules itself. Settings managers and platform admins.
create or replace function app.module_states(p_center uuid)
returns table (key text, label text, description text, core boolean, depends_on text[], sort int, availability text,
               enabled boolean, switchable boolean, changed_by uuid, changed_at timestamptz, reason text)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'You don''t have access to this community''s modules (it needs settings.manage).' using errcode = 'insufficient_privilege';
  end if;
  return query
  select m.key, coalesce(cm.label, m.label), coalesce(cm.description, m.description), m.core, m.depends_on, m.sort,
         coalesce(cm.availability, 'default_on'),
         m.core or app.module_enabled(p_center, m.key),
         (not m.core) and coalesce(cm.availability, 'default_on') <> 'not_available',
         x.changed_by, x.changed_at, x.reason
    from app.modules m
    left join app.category_modules cm on cm.category_key = app.center_category(p_center) and cm.module_key = m.key
    left join app.center_modules x on x.center_id = p_center and x.module_key = m.key
   order by m.sort, m.key;
end $$;

grant execute on function app.category_profile(uuid) to anon, authenticated;
revoke execute on function app.category_profile(uuid) from public;
revoke execute on function app.module_states(uuid) from public, anon;
grant execute on function app.module_states(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- E · ACCESS 1 · the module functions know the category
-- ════════════════════════════════════════════════════════════════════════════
-- These three (and set_module_enabled) are the one place that decides whether a module is on for a community. Every
-- module table's restrictive module_switch policy, every module RPC guard, the storage buckets, Setup's "skipped",
-- Niva's live facts, the access areas and the Gyan Path helper policies call them, so teaching them the category is
-- the whole enforcement: no table and no policy changes.
--
-- Jain Center (and any community whose category row for a module is missing) takes the ELSE branch of each, which is
-- 0101's rule word for word, so for every existing community the answers are identical (test 79 compares them with
-- 0101's definitions over every community, every module and every module table).

create or replace function app.module_enabled(p_center uuid, p_module text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select case app.module_availability(p_center, p_module)
           when 'not_available' then false
           when 'default_off' then exists (select 1 from app.center_modules
                                            where center_id = p_center and module_key = p_module and enabled)
           else not exists (select 1 from app.center_modules
                             where center_id = p_center and module_key = p_module and not enabled)
         end
$$;

-- Centers where the module is off: the 0101 set (a switch flipped off), plus every center whose category does not
-- have the module, plus every center whose category has it off until switched on and that has not switched it on.
-- One set query, evaluated once per statement (the policies call it as an InitPlan).
create or replace function app.module_off_centers(p_module text) returns uuid[]
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(array_agg(c.id), '{}')
    from app.centers c
    left join app.category_modules cm on cm.category_key = c.category_key and cm.module_key = p_module
   where case coalesce(cm.availability, 'default_on')
           when 'not_available' then true
           when 'default_off' then not exists (select 1 from app.center_modules x
                                                where x.center_id = c.id and x.module_key = p_module and x.enabled)
           else exists (select 1 from app.center_modules x
                         where x.center_id = c.id and x.module_key = p_module and not x.enabled)
         end
$$;

-- For RPCs: raises in plain English when the module is off. 0101's sentence for a switch; for a module the category
-- does not have: "<Module> is not part of a <Category> organization." Platform admins pass, as they do in RLS.
create or replace function app.assert_module_enabled(p_center uuid, p_module text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
begin
  if app.module_enabled(p_center, p_module) or app.is_platform_admin() then return true; end if;
  if app.module_availability(p_center, p_module) = 'not_available' then
    raise exception '% is not part of a % organization.',
      coalesce((select cm.label from app.category_modules cm where cm.category_key = app.center_category(p_center) and cm.module_key = p_module),
               (select label from app.modules where key = p_module), p_module),
      coalesce((select k.label from app.organization_categories k where k.key = app.center_category(p_center)), 'this')
      using errcode = 'insufficient_privilege', hint = 'Community Connect can change an organization''s category.';
  end if;
  raise exception 'The % module is switched off for this community.',
    coalesce((select label from app.modules where key = p_module), p_module)
    using errcode = 'insufficient_privilege', hint = 'An administrator can switch it on in Settings › Modules.';
end $$;

-- 0101's switch, plus: a module the category does not have cannot be switched on. Switching a module that starts off
-- (default_off) on writes an "on" row, exactly the upsert it always made.
create or replace function app.set_module_enabled(p_center uuid, p_module text, p_enabled boolean, p_reason text)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare m app.modules; v_names text;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Switching modules on or off needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  select * into m from app.modules where key = p_module;
  if m.key is null then raise exception 'There is no module called "%".', p_module; end if;
  if p_enabled is null then raise exception 'Choose whether to switch the % module on or off.', m.label; end if;
  if app.audit_clean_reason(p_reason) is null then
    raise exception 'Give a reason for switching the % module %. It goes in the audit log.', m.label,
      case when p_enabled then 'on' else 'off' end;
  end if;
  if p_enabled and app.module_availability(p_center, p_module) = 'not_available' then
    raise exception '% is not part of a % organization, so it cannot be switched on.',
      coalesce((select cm.label from app.category_modules cm where cm.category_key = app.center_category(p_center) and cm.module_key = p_module), m.label),
      coalesce((select k.label from app.organization_categories k where k.key = app.center_category(p_center)), 'this')
      using errcode = 'insufficient_privilege', hint = 'Community Connect can change an organization''s category.';
  end if;
  -- One switch at a time per community, so two admins cannot race a dependency.
  perform pg_advisory_xact_lock(hashtextextended('app.center_modules:' || p_center::text, 0));

  if not p_enabled then
    if m.core then
      raise exception 'The % module is part of the core platform and cannot be switched off.', m.label;
    end if;
    select string_agg(d.label, ', ' order by d.sort) into v_names
      from app.modules d
     where p_module = any(d.depends_on) and (d.core or app.module_enabled(p_center, d.key));
    if v_names is not null then
      raise exception 'The % module cannot be switched off while % %. %',
        m.label, v_names,
        case when v_names like '%,%' then 'are on and depend on it' else 'is on and depends on it' end,
        case when v_names like '%,%' then 'Switch those off first.' else 'Switch that off first.' end;
    end if;
  else
    select string_agg(d.label, ', ' order by d.sort) into v_names
      from app.modules d
     where d.key = any(m.depends_on) and not d.core and not app.module_enabled(p_center, d.key);
    if v_names is not null then
      raise exception 'The % module needs % switched on first.', m.label, v_names;
    end if;
  end if;

  perform app.set_audit_context(p_reason);
  insert into app.center_modules (center_id, module_key, enabled, changed_by, changed_at, reason)
  values (p_center, p_module, p_enabled, auth.uid(), now(), app.audit_clean_reason(p_reason))
  on conflict (center_id, module_key) do update
    set enabled = excluded.enabled, changed_by = excluded.changed_by, changed_at = excluded.changed_at, reason = excluded.reason;
end $$;
-- my_modules(center) is not redefined: it calls module_enabled, so a module the category does not have comes back
-- enabled = false (the installed apps already hide it), with the same signature and the same rows.

-- ════════════════════════════════════════════════════════════════════════════
-- F · ACCESS 2 · who may set or change a category
-- ════════════════════════════════════════════════════════════════════════════
-- (The guard itself is in the trigger centers_category_rules of section B: it refuses every change of category_key
-- except one made by app.set_center_category below, or by a job or migration with no signed-in user, so a platform
-- admin's direct table update and a settings manager's are both refused and the reason and the 2FA check cannot be
-- skipped.)

-- The counts of one module's records in one community, per table (only the tables that have rows). Used by the
-- preview. Core tables are not part of a module and are never listed.
create or replace function app._module_records(p_center uuid, p_module text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare t record; n bigint; v jsonb := '{}'::jsonb;
begin
  for t in
    select mt.table_name
      from app.module_tables mt
      join pg_class c on c.relname = mt.table_name and c.relkind in ('r', 'p')
      join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'app'
     where mt.module_key = p_module
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'center_id' and not a.attisdropped)
     order by mt.table_name
  loop
    execute format('select count(*) from app.%I where center_id = $1', t.table_name) into n using p_center;
    if n > 0 then v := v || jsonb_build_object(t.table_name, n); end if;
  end loop;
  return v;
end $$;

-- The tradition a Jain-like category last had, from the audit log, for when an organization comes back to one
-- (the tradition is set to 'other' while it is in a category that does not use one).
create or replace function app._tradition_to_restore(p_center uuid) returns app.tradition
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v text;
begin
  select a.before->>'tradition' into v
    from app.audit_log a
   where a.center_id = p_center and a.action = 'category.changed'
     and exists (select 1 from app.organization_categories k where k.key = a.before->>'category' and k.uses_tradition)
   order by a.id desc limit 1;
  if v is null or v = 'other' then return null; end if;
  return v::app.tradition;
exception when others then
  return null;
end $$;

-- What a change of category will do, in plain English, before anyone makes it (platform admins):
--   hidden     modules that are on now and will not be (their records stay, hidden by the same rules as a switched-off module)
--   available  modules that are off or not available now and will be on or switchable
--   summary    the sentences to read out
-- Nothing is changed.
create or replace function app.category_change_preview(p_center uuid, p_category text) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare c app.centers; cur app.organization_categories; nxt app.organization_categories; m record;
        v_before text; v_after text; v_hidden jsonb := '[]'::jsonb; v_avail jsonb := '[]'::jsonb; v_lines text[] := '{}';
        v_rec jsonb; v_total bigint; v_parts text[]; v_text text; v_unchanged int := 0; v_paths bigint; v_trad text;
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can preview a change of category.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.centers where id = p_center;
  if c.id is null then raise exception 'That community was not found.'; end if;
  select * into nxt from app.organization_categories where key = p_category;
  if nxt.key is null then raise exception 'Choose one of the organization categories.'; end if;
  select * into cur from app.organization_categories where key = c.category_key;

  for m in
    select mo.key, mo.core, mo.label as base_label, coalesce(cm.availability, 'default_on') as after_avail,
           coalesce(cm.label, mo.label) as after_label, app.module_availability(p_center, mo.key) as before_avail
      from app.modules mo
      left join app.category_modules cm on cm.category_key = nxt.key and cm.module_key = mo.key
     order by mo.sort, mo.key
  loop
    v_before := case when m.before_avail = 'not_available' then 'never'
                     when m.core or app.module_enabled(p_center, m.key) then 'on' else 'off' end;
    v_after := case m.after_avail
                 when 'not_available' then 'never'
                 when 'default_off' then case when exists (select 1 from app.center_modules x where x.center_id = p_center and x.module_key = m.key and x.enabled)
                                              then 'on' else 'off' end
                 else case when exists (select 1 from app.center_modules x where x.center_id = p_center and x.module_key = m.key and not x.enabled)
                           then 'off' else 'on' end
               end;
    if cur.key = nxt.key then v_after := v_before; end if;
    if v_before = 'on' and v_after <> 'on' then
      v_rec := app._module_records(p_center, m.key);
      select coalesce(sum(e.value::bigint), 0), coalesce(array_agg(e.value || ' in ' || replace(e.key, '_', ' ') order by e.value::bigint desc, e.key), '{}')
        into v_total, v_parts from jsonb_each_text(v_rec) e;
      v_text := m.base_label || ': ' ||
        case when v_total = 0 then 'nothing is stored yet, so nothing is hidden'
             else v_total || case when v_total = 1 then ' record' else ' records' end || ' will be hidden, not deleted (' || array_to_string(v_parts, ', ') || ')' end ||
        case when v_after = 'off' then '; it can be switched on again in Settings › Modules' else '' end || '.';
      v_hidden := v_hidden || jsonb_build_array(jsonb_build_object('module', m.key, 'label', m.base_label, 'becomes', v_after,
                                                                   'records', v_total, 'tables', v_rec, 'text', v_text));
      v_lines := v_lines || v_text;
    elsif v_before <> 'on' and v_after <> 'never' and (v_after = 'on' or v_before = 'never') then
      v_text := m.after_label || ': ' ||
        case when v_after = 'on' then 'will be on' else 'becomes available and starts off; it can be switched on in Settings › Modules' end || '.';
      v_avail := v_avail || jsonb_build_array(jsonb_build_object('module', m.key, 'label', m.after_label, 'becomes', v_after, 'text', v_text));
      v_lines := v_lines || v_text;
    else
      v_unchanged := v_unchanged + 1;
    end if;
  end loop;

  select count(*) into v_paths from app.person_profile_details d where d.center_id = p_center and d.path_key is not null;
  v_trad := case when not nxt.uses_tradition then 'other'
                 when c.tradition = 'other' then coalesce(app._tradition_to_restore(p_center)::text, 'other')
                 else c.tradition::text end;
  if cur.key <> nxt.key then
    v_lines := v_lines || 'Words, tabs and shared libraries follow the new category on the next app refresh.'::text;
    if v_paths > 0 and not nxt.uses_tradition then
      v_lines := v_lines || (v_paths || case when v_paths = 1 then ' person''s' else ' people''s' end || ' path stays stored and is ignored.');
    end if;
    if v_trad is distinct from c.tradition::text then
      v_lines := v_lines || ('The community''s default tradition becomes "' || v_trad || '".');
    end if;
    v_lines := v_lines || 'Nothing is deleted; changing back restores it.'::text;
  end if;

  return jsonb_build_object(
    'center_id', c.id, 'center_name', c.name,
    'from', jsonb_build_object('key', cur.key, 'label', cur.label),
    'to', jsonb_build_object('key', nxt.key, 'label', nxt.label, 'active', nxt.active),
    'changed', cur.key <> nxt.key,
    'hidden', v_hidden, 'available', v_avail, 'unchanged', v_unchanged,
    'tradition', jsonb_build_object('before', c.tradition, 'after', v_trad),
    'paths_kept', v_paths,
    'summary', to_jsonb(v_lines));
end $$;

-- A platform email the owner gets when the category changes (platform default template, like 0220's).
insert into app.message_templates (center_id, key, channel, language, subject, body)
select null, v.key, v.channel::app.channel, 'en', v.subject, v.body
  from (values
  ('category_changed', 'email', 'The category of {{center_name}} was changed to {{new_category}}',
   E'Hello,\n\nCommunity Connect changed the category of {{center_name}} from {{old_category}} to {{new_category}}.\n\nReason: {{reason}}\n\n{{changes}}\n\nNothing was deleted. If this was not expected, reply to this email.\n\nThe Community Connect team')
  ) as v(key, channel, subject, body)
 where not exists (select 1 from app.message_templates t
                    where t.center_id is null and t.key = v.key and t.channel = v.channel::app.channel and t.language = 'en');

-- The only way to change an organization's category (plan §3.2): a platform admin, a fresh 2FA check, a reason; audited
-- (the row change plus one category.changed entry with before, after and what was hidden); the owner is emailed.
-- Modules the new category does not have are off at once (data kept); modules it adds follow its defaults unless the
-- organization had its own switch; shared libraries, words and layout follow on the next app refresh; people's paths
-- from the old category stay stored but are ignored. An inactive category can be chosen only for a sandbox.
create or replace function app.set_center_category(p_center uuid, p_category text, p_reason text) returns jsonb
language plpgsql security definer set search_path = app, public, extensions as $$
declare c app.centers; cur app.organization_categories; nxt app.organization_categories;
        v_reason text := app.audit_clean_reason(p_reason); v_preview jsonb; v_now app.tradition; v_prev app.tradition;
        v_owner text; v_mail jsonb; v_changes text;
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can change an organization''s category.' using errcode = 'insufficient_privilege';
  end if;
  select * into c from app.centers where id = p_center for update;
  if c.id is null then raise exception 'That community was not found.'; end if;
  select * into nxt from app.organization_categories where key = p_category;
  if nxt.key is null then raise exception 'Choose one of the organization categories.'; end if;
  select * into cur from app.organization_categories where key = c.category_key;
  if cur.key = nxt.key then
    raise exception '% is already a % organization. There is nothing to change.', c.name, cur.label;
  end if;
  if not nxt.active and c.environment <> 'sandbox' then
    raise exception 'The % category is not switched on yet, so it can only be chosen for a sandbox, to preview it. % is not a sandbox.', nxt.label, c.name;
  end if;
  if v_reason is null then
    raise exception 'Give a reason for changing the category. It goes in the audit log and in the email to the owner.';
  end if;
  perform app.assert_step_up('platform.category');
  v_preview := app.category_change_preview(p_center, p_category);

  perform app.set_audit_context(v_reason);
  perform set_config('app.category_change', txid_current()::text, true);
  update app.centers set category_key = nxt.key where id = p_center;
  perform set_config('app.category_change', '', true);
  -- Back in a category that uses a tradition: the one the organization had before, when it is known.
  if nxt.uses_tradition then
    select tradition into v_now from app.centers where id = p_center;
    if v_now = 'other' then
      v_prev := app._tradition_to_restore(p_center);
      if v_prev is not null then update app.centers set tradition = v_prev where id = p_center; end if;
    end if;
  end if;

  perform app.log_audit(p_center, 'category.changed', 'centers', p_center::text,
    jsonb_build_object('category', cur.key, 'tradition', c.tradition),
    jsonb_build_object('category', nxt.key, 'tradition', (select x.tradition from app.centers x where x.id = p_center),
                       'hidden', coalesce((select jsonb_agg(h->>'module') from jsonb_array_elements(v_preview->'hidden') h), '[]'::jsonb),
                       'available', coalesce((select jsonb_agg(h->>'module') from jsonb_array_elements(v_preview->'available') h), '[]'::jsonb)),
    v_reason);

  select lower(u.email) into v_owner from app.center_owners o join auth.users u on u.id = o.user_id where o.center_id = p_center;
  if v_owner is null then
    v_mail := jsonb_build_object('status', 'no_owner');
  else
    select coalesce(string_agg(h->>'text', E'\n' order by h->>'module'), '') into v_changes from jsonb_array_elements(v_preview->'hidden') h;
    v_mail := app.platform_send_message(v_owner, 'category_changed',
                jsonb_build_object('center_name', c.name, 'old_category', cur.label, 'new_category', nxt.label, 'reason', v_reason,
                                   'changes', case when v_changes = '' then 'No module was hidden.' else 'What is now hidden:' || E'\n' || v_changes end),
                'notification');
  end if;
  return v_preview || jsonb_build_object('email_status', app.message_status_text(v_mail));
end $$;

-- Community Connect chooses the category on the access request before approving it. Until the sandbox is created from
-- the request; afterwards the organization's own page (set_center_category) is the way.
create or replace function app.set_access_request_category(p_request uuid, p_category text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
declare r app.access_requests; k app.organization_categories;
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can choose the category of a request.' using errcode = 'insufficient_privilege';
  end if;
  select * into r from app.access_requests where id = p_request for update;
  if r.id is null then raise exception 'That request was not found.'; end if;
  select * into k from app.organization_categories where key = p_category;
  if k.key is null then raise exception 'Choose one of the organization categories.'; end if;
  if r.status = 'declined' then raise exception 'This request was declined, so its category cannot be changed.'; end if;
  if exists (select 1 from app.sandbox_codes sc where sc.request_id = r.id and sc.redeemed_at is not null) then
    raise exception 'A sandbox was already created from this request. Change the organization''s category from its own page instead.';
  end if;
  perform app.set_audit_context('Category of the request from ' || r.org_legal_name || ': ' || k.label);
  update app.access_requests set category_key = k.key where id = p_request;
end $$;

revoke execute on function app._module_records(uuid, text), app._tradition_to_restore(uuid) from public, anon, authenticated;
revoke execute on function app.category_change_preview(uuid, text), app.set_center_category(uuid, text, text),
  app.set_access_request_category(uuid, text) from public, anon;
grant execute on function app.category_change_preview(uuid, text), app.set_center_category(uuid, text, text),
  app.set_access_request_category(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- G · ACCESS 3 · a person's path (the last section; it can be dropped on its own)
-- ════════════════════════════════════════════════════════════════════════════
-- app.person_profile_details.path_key: per person, per community (a person row belongs to one community). It inherits
-- 0546's rules unchanged, because it is a column of that table: read by the person, the adults of their household and
-- staff with people.view or people.manage; written by the person or a household adult; a child's own login reads it
-- but cannot write it (a parent sets it); no staff write. Never in the directory, never shown to teachers or other
-- members (they have no policy on this table). Not on people: the member app loads the whole people row of its member,
-- and people rows are read by household members, class rosters and Pathshala staff through several policies.
alter table app.person_profile_details add column if not exists path_key text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'person_profile_details_path_key_shape') then
    alter table app.person_profile_details add constraint person_profile_details_path_key_shape
      check (path_key is null or path_key ~ '^[a-z][a-z0-9_]{0,59}$');
  end if;
end $$;
comment on column app.person_profile_details.path_key is
  'The person''s own path inside the community''s category (0594), a key of app.category_paths. Optional; a key from an earlier category stays stored and is ignored. Masked in the audit log.';

-- 0546's checks, plus the path: when it is set or changed it must be an active path of the community's category, in
-- plain English. A stale key (from an earlier category) that is not being changed does not block saving other details.
create or replace function app.person_profile_details_check() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.people; v_cat app.organization_categories;
begin
  select * into p from app.people where id = new.person_id;
  if p.id is null then raise exception 'That person was not found.' using errcode = '23503'; end if;
  if tg_op = 'UPDATE' and new.person_id is distinct from old.person_id then
    raise exception 'These details belong to one person and cannot be moved to another.' using errcode = '23514';
  end if;
  -- The row always belongs to the person's own community, whatever the caller sent.
  new.center_id := p.center_id;

  new.dietary_other := nullif(btrim(new.dietary_other), '');
  new.emergency_contact_name := nullif(btrim(new.emergency_contact_name), '');
  new.emergency_contact_relationship := nullif(btrim(new.emergency_contact_relationship), '');
  new.emergency_contact_phone := nullif(btrim(new.emergency_contact_phone), '');
  new.path_key := nullif(btrim(new.path_key), '');
  -- Each dietary choice once, in the order given.
  new.dietary := coalesce((select array_agg(k order by first_pos)
                             from (select k, min(pos) as first_pos from unnest(new.dietary) with ordinality as t(k, pos) group by k) s),
                          '{}'::text[]);

  if new.anniversary is not null then
    if p.date_of_birth is not null and p.date_of_birth > current_date - interval '18 years' then
      raise exception 'A wedding anniversary can only be recorded for an adult.' using errcode = '23514';
    end if;
    if new.anniversary > current_date then
      raise exception 'The wedding anniversary cannot be in the future.' using errcode = '23514';
    end if;
    if p.date_of_birth is not null and new.anniversary <= p.date_of_birth then
      raise exception 'The wedding anniversary has to be after the birth date. Check the year.' using errcode = '23514';
    end if;
  end if;
  if new.dietary_other is not null and not ('other' = any (new.dietary)) then
    raise exception 'Choose "Other" under dietary needs to add a note of your own.' using errcode = '23514';
  end if;
  if (new.emergency_contact_name is null) <> (new.emergency_contact_phone is null)
     or (new.emergency_contact_relationship is not null and new.emergency_contact_name is null) then
    raise exception 'An emergency contact needs both a name and a mobile number. Fill in both, or leave the emergency contact blank.' using errcode = '23514';
  end if;
  if new.emergency_contact_phone is not null and new.emergency_contact_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'The emergency contact''s mobile number must include the country code, for example +17135550142.' using errcode = '23514';
  end if;
  if new.path_key is not null and (tg_op = 'INSERT' or new.path_key is distinct from old.path_key) then
    select k.* into v_cat from app.centers c join app.organization_categories k on k.key = c.category_key where c.id = new.center_id;
    if v_cat.path_label is null then
      raise exception 'This community does not ask which path a member follows.' using errcode = '23514';
    end if;
    if not exists (select 1 from app.category_paths cp where cp.category_key = v_cat.key and cp.key = new.path_key and cp.active) then
      raise exception 'That is not one of the paths this community offers. Choose one from the list.' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then new.created_at := now(); end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- The audit log records THAT the path changed, not the answer (a religious affiliation is sensitive, like dietary
-- needs). 0589's definition (which already carries 0590's assistance_note clause, copied from feat/pathshala-db1) plus
-- path_key. Anyone who changes app.audit_mask again must start from the latest definition: 0594 (this file), then any later:
--   0102   date_of_birth and the secrets / tokens
--   0546   the emergency contact's name and number, both dietary fields
--   0545   staged_rows (the uploaded rows, personal data) and merge_answers (they grow with the file)
--   0573   niva_tsv (derived search vector, dropped rather than masked)
--   0578   result.image_b64 (AI flyer art bytes in app.jobs.result)
--   0587   text_answer, parent_note, review_note (homework), and the file name of a homework part's storage_path
--   0589   the file name of a homework file in a row that names its bucket (app.upload_scans)
--   0590   assistance_note (Pathshala fee assistance)
--   0594   path_key (a person's own path)
create or replace function app.audit_mask(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null then null else
    j - 'date_of_birth' - 'provider_ref' - 'fee_authorization_ref' - 'secret_ref' - 'niva_tsv'
      || case when j ? 'date_of_birth' then jsonb_build_object('date_of_birth', '***') else '{}'::jsonb end
      || case when j->>'ticket_token' is not null then jsonb_build_object('ticket_token', '***') else '{}'::jsonb end
      || case when j->>'attendance_token' is not null then jsonb_build_object('attendance_token', '***') else '{}'::jsonb end
      || case when j->>'token' is not null then jsonb_build_object('token', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_name' is not null then jsonb_build_object('emergency_contact_name', '***') else '{}'::jsonb end
      || case when j->>'emergency_contact_phone' is not null then jsonb_build_object('emergency_contact_phone', '***') else '{}'::jsonb end
      || case when j->>'dietary_other' is not null then jsonb_build_object('dietary_other', '***') else '{}'::jsonb end
      || case when j->'dietary' is not null and j->'dietary' <> '[]'::jsonb and j->'dietary' <> 'null'::jsonb
              then jsonb_build_object('dietary', '***') else '{}'::jsonb end
      || case when j ? 'staged_rows' then jsonb_build_object('staged_rows', '***') else '{}'::jsonb end
      || case when j ? 'merge_answers' then jsonb_build_object('merge_answers', '***') else '{}'::jsonb end
      || case when jsonb_typeof(j->'result') = 'object' and (j->'result') ? 'image_b64'
              then jsonb_build_object('result', (j->'result') || jsonb_build_object('image_b64', '***')) else '{}'::jsonb end
      || case when j->>'text_answer' is not null
              then jsonb_build_object('text_answer', '*** (' || char_length(j->>'text_answer') || ' characters)') else '{}'::jsonb end
      || case when j->>'parent_note' is not null
              then jsonb_build_object('parent_note', '*** (' || char_length(j->>'parent_note') || ' characters)') else '{}'::jsonb end
      || case when j->>'review_note' is not null
              then jsonb_build_object('review_note', '*** (' || char_length(j->>'review_note') || ' characters)') else '{}'::jsonb end
      || case when j->>'storage_path' ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[^/]+$'
              then jsonb_build_object('storage_path', regexp_replace(j->>'storage_path', '[^/]+$', '***')) else '{}'::jsonb end
      || case when coalesce(j->>'bucket_id', j->>'bucket') = 'homework'
                   and j->>'name' ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){3}[^/]+$'
              then jsonb_build_object('name', regexp_replace(j->>'name', '[^/]+$', '***')) else '{}'::jsonb end
      || case when j->>'assistance_note' is not null
              then jsonb_build_object('assistance_note', '*** (' || char_length(j->>'assistance_note') || ' characters)') else '{}'::jsonb end
      || case when j->>'path_key' is not null then jsonb_build_object('path_key', '***') else '{}'::jsonb end
  end
$$;

grant execute on all functions in schema app to service_role;
