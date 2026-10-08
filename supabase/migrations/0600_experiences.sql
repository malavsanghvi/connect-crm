-- 0600 · Experiences: the kind of organization is DATA (docs/ORGANIZATION_CATEGORIES_PLAN.md, owner direction 2026-10-08).
--
-- WHAT THIS DOES, IN PLAIN WORDS
--   0594 gave every organization a CATEGORY (Jain Center, Chamber of commerce, Non-profit, Faith-based). The owner now calls
--   it an EXPERIENCE: the one choice Community Connect makes when it creates an organization, after which the modules,
--   the wording, the Setup checklist, the demo data and the member app all follow. The tables keep their names
--   (organization_categories, category_modules, category_paths); screens say "kind of organization".
--
--   An experience is rows, not code:
--     the catalog row        organization_categories (+ family_key, inherits_from, wording_pack, wording)
--     its module defaults    category_modules
--     its words              terms (nine named words) + wording (extra overlay strings) + wording_pack (which built-in
--                            pack of the member app and the portal to start from; several experiences share one)
--     its Setup wording      setup_step_wording
--     its dietary extras     category_dietary_options
--     what it shows          category_keys on roles, notification_topics, access_features, setup_steps
--   Adding one later is one call, app.add_experience(...), that starts from an experience it inherits from (modules, words,
--   what it shows) and changes only what differs. Nothing in the apps has to be forked: the apps read the experience
--   from the database.
--
--   A two-step picker: Faith-based > tradition family (Jain, Hindu, Christian, Muslim, ...) > specific experience, or
--   Chamber of commerce / Community organization (the neutral one) directly. app.list_experiences() feeds it, before login.
--
--   ONE read for the member app: app.member_experience(community, known_stamp) answers, for a signed-in member and for a
--   guest, the experience, its words, which modules exist and are on, what the administrator set up, what the member may
--   use, and a stamp that changes whenever any of that changes.
--
--   JSH is untouched: it stays a Jain Center, Jain Center keeps every module and word, and every change below reduces to
--   today's answer for it (test 90 compares them). Only Jain Center is active. The three new experiences (Swaminarayan
--   Temple, Church, Mosque) are INACTIVE, here only to prove the mechanism: their words need review by someone from that
--   faith before they are switched on.
--
-- SECTIONS (the access-rule changes are marked ACCESS and listed in the pull request for the owner)
--   A  Families and the experience columns, the experience rules
--   B  Catalog tags (what each experience shows), Setup wording, dietary extras
--   C  The experiences: the four existing, relabelled and completed; add_experience; three inactive ones
--   D  list_experiences (the picker, callable before login)
--   E  ACCESS 1  The access areas follow the experience (feature_access_for_me, access_settings, can_use_feature)
--   F  Setup checklist and dietary seed follow the experience
--   G  member_experience (the one read for the member app) and the stamp
--   H  Requests and sandboxes: the applicant's stated kind, one choice to create a sandbox
set client_min_messages = warning;

-- ════════════════════════════════════════════════════════════════════════════
-- A · Families and the experience columns
-- ════════════════════════════════════════════════════════════════════════════

-- A tradition family groups the specific experiences of a faith for the picker (Hindu > Swaminarayan Temple). A family
-- with no experience is never shown; a new experience under a new family needs its family row first.
create table if not exists app.experience_families (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label       text not null check (char_length(btrim(label)) between 1 and 60),
  description text not null default '',
  faith_based boolean not null,
  sort        int not null default 0
);
comment on table app.experience_families is
  'Tradition families for the two-step picker (0600): Faith-based > family > experience. Platform data: written only by migrations, read by everyone (the Request access page needs it before sign-in).';

insert into app.experience_families (key, label, description, faith_based, sort) values
  ('jain',        'Jain',        'Jain temples, sanghs and societies',          true, 10),
  ('hindu',       'Hindu',       'Hindu temples and sampradayas',               true, 20),
  ('christian',   'Christian',   'Churches of every denomination',              true, 30),
  ('muslim',      'Muslim',      'Mosques and Islamic centers',                 true, 40),
  ('sikh',        'Sikh',        'Gurdwaras',                                   true, 50),
  ('buddhist',    'Buddhist',    'Buddhist temples and centers',                true, 60),
  ('jewish',      'Jewish',      'Synagogues and Jewish centers',               true, 70),
  ('other_faith', 'Other faith', 'Any other faith community',                   true, 90)
on conflict (key) do nothing;

-- Extra overlay strings for the member app and the portal: dictionary key -> text, at most 400 keys, each value 1 to 400
-- characters. The nine named words of 0594 stay in `terms`.
create or replace function app.wording_ok(p jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select case when p is not null and jsonb_typeof(p) = 'object' then (
           (select count(*) from jsonb_object_keys(p)) <= 400
           and not exists (select 1 from jsonb_each(p) e
                            where jsonb_typeof(e.value) <> 'string'
                               or char_length(e.key) > 120
                               or char_length(btrim(e.value #>> '{}')) not between 1 and 400)
         ) else false end
$$;

alter table app.organization_categories add column if not exists family_key text references app.experience_families(key);
alter table app.organization_categories add column if not exists inherits_from text references app.organization_categories(key);
alter table app.organization_categories add column if not exists lineage text[] not null default '{}';
alter table app.organization_categories add column if not exists wording_pack text not null default 'neutral'
  check (wording_pack ~ '^[a-z][a-z0-9_]{1,39}$');
alter table app.organization_categories add column if not exists wording jsonb not null default '{}'::jsonb;
alter table app.organization_categories add column if not exists library_pack text
  check (library_pack is null or library_pack ~ '^[a-z][a-z0-9_]{1,39}$');
comment on column app.organization_categories.library_pack is
  'Which shared library the experience gets (0600): the shared lessons, practices, calendar and sources tagged with the same library_pack. Null = none. Jain Center: jain. Several experiences can share one pack. The shared rows are tagged by migration 0601.';
comment on column app.organization_categories.family_key is
  'The tradition family the experience sits under in the picker (0600). Required for a faith-based experience.';
comment on column app.organization_categories.inherits_from is
  'The experience this one was started from (0600, app.add_experience). Provenance, and the line along which what an experience shows is inherited (lineage).';
comment on column app.organization_categories.lineage is
  'This experience first, then the one it inherits from, and so on (0600). Kept by a trigger. A catalog tag (category_keys) names an experience and applies to everything that inherits from it.';
comment on column app.organization_categories.wording_pack is
  'Which built-in wording pack the member app and the portal start from (0600): jain, chamber, neutral or faith. Several experiences share one. An unknown pack is read as neutral.';
comment on column app.organization_categories.wording is
  'Extra overlay strings (0600), dictionary key -> text, applied over the wording pack. Empty for Jain Center.';

-- A family and the experiences under it are both faith-based or neither; lineage is kept here.
create or replace function app.categories_experience_rules() returns trigger
language plpgsql set search_path = app, public, extensions as $$
declare v_parent text[]; v_faith boolean;
begin
  if new.family_key is not null then
    select f.faith_based into v_faith from app.experience_families f where f.key = new.family_key;
    if v_faith is distinct from new.faith_based then
      raise exception 'The family "%" and the experience "%" must both be faith-based, or neither.', new.family_key, new.key
        using errcode = '23514';
    end if;
  end if;
  if new.inherits_from is null then
    new.lineage := array[new.key];
  else
    select p.lineage into v_parent from app.organization_categories p where p.key = new.inherits_from;
    if v_parent is null or cardinality(v_parent) = 0 then
      raise exception 'There is no experience called "%" to inherit from.', new.inherits_from using errcode = '23503';
    end if;
    if new.key = any (v_parent) then
      raise exception 'An experience cannot inherit from itself or from one of its own children.' using errcode = '23514';
    end if;
    new.lineage := array[new.key] || v_parent;
  end if;
  return new;
end $$;
drop trigger if exists categories_experience_rules on app.organization_categories;
create trigger categories_experience_rules before insert or update on app.organization_categories
  for each row execute function app.categories_experience_rules();
revoke execute on function app.categories_experience_rules() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- B · Catalog tags, Setup wording, dietary extras
-- ════════════════════════════════════════════════════════════════════════════

-- Empty = every experience; otherwise the experiences named here and every experience that inherits from one of them.
alter table app.roles add column if not exists category_keys text[] not null default '{}';
alter table app.notification_topics add column if not exists category_keys text[] not null default '{}';
alter table app.access_features add column if not exists category_keys text[] not null default '{}';
alter table app.setup_steps add column if not exists category_keys text[] not null default '{}';
comment on column app.roles.category_keys is
  'The experiences that show this role (0600). Empty = every experience. Names an experience and everything that inherits from it. The Settings › Roles page lists a role only for an organization whose experience is named (app.catalog_shows).';
comment on column app.notification_topics.category_keys is
  'The experiences that show this notification topic (0600). Empty = every experience. app.member_experience(...).topics lists the keys an organization shows.';
comment on column app.access_features.category_keys is
  'The experiences that have this access area (0600). Empty = every experience. feature_access_for_me, access_settings and can_use_feature leave out an area the organization''s experience does not have.';
comment on column app.setup_steps.category_keys is
  'The experiences that have this Setup step (0600). Empty = every experience. setup_checklist leaves out a step the organization''s experience does not have (a step of a module the experience does not have is still shown as skipped).';

-- Does a catalog row with these tags show for this experience?
create or replace function app.catalog_shows(p_keys text[], p_category text) returns boolean
language sql stable security definer set search_path = app, public, extensions as $$
  select coalesce(cardinality(p_keys), 0) = 0
      or exists (select 1 from app.organization_categories k where k.key = p_category and k.lineage && p_keys)
$$;
grant execute on function app.catalog_shows(text[], text) to anon, authenticated, service_role;
revoke execute on function app.catalog_shows(text[], text) from public;

-- The tags of the catalogs (plan §3.1.1). A Jain Center shows everything (its rows are tagged or empty, never missing).
--   roles          the religious coordinator and the Pathshala roles belong to the kinds of organization that have those
--                  things (Jain Center, faith communities); the boli recorder is Jain only
--   topics         Pathshala updates: Jain Center and faith communities; temple timings and My Jain Way: Jain Center
--   access areas   live darshan, virtual puja and today's timings: Jain Center; Gyan Path lessons: Jain Center and faith communities
-- Idempotent. Called once here and by seed.sql: a new database loads roles and topics from the seed AFTER the migrations,
-- so the tags are applied again there (the same pattern as app.apply_gyan_content_pack).
create or replace function app.experience_apply_tags() returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  update app.roles r set category_keys = v.keys
    from (values ('boli_recorder',         array['jain_center']),
                 ('religious_coordinator', array['jain_center', 'faith_other']),
                 ('pathshala_principal',   array['jain_center', 'faith_other']),
                 ('pathshala_committee',   array['jain_center', 'faith_other']),
                 ('teacher',               array['jain_center', 'faith_other'])) as v(key, keys)
   where r.key = v.key and r.category_keys is distinct from v.keys;
  update app.notification_topics t set category_keys = v.keys
    from (values ('pathshala', array['jain_center', 'faith_other']),
                 ('timings',   array['jain_center']),
                 ('jain_way',  array['jain_center'])) as v(key, keys)
   where t.key = v.key and t.category_keys is distinct from v.keys;
  update app.access_features f set category_keys = v.keys
    from (values ('darshan', array['jain_center']),
                 ('puja',    array['jain_center']),
                 ('timings', array['jain_center']),
                 ('learn',   array['jain_center', 'faith_other'])) as v(key, keys)
   where f.key = v.key and f.category_keys is distinct from v.keys;
end $$;
revoke execute on function app.experience_apply_tags() from public, anon, authenticated;
grant execute on function app.experience_apply_tags() to service_role;

-- Words the Setup checklist uses for an experience in place of the catalog's (the catalog is written for a house of worship
-- that keeps Jain timings and bolis). A null column keeps the catalog's text. Read through the experience's lineage.
create table if not exists app.setup_step_wording (
  category_key text not null references app.organization_categories(key),
  step_key     text not null references app.setup_steps(key) on update cascade,
  title        text,
  description  text,
  help         text,
  done_means   text,
  owner_role   text,
  primary key (category_key, step_key)
);
comment on table app.setup_step_wording is
  'An experience''s own words for a Setup step (0600). A null column keeps the catalog''s text. Written only by migrations.';

-- Extra dietary choices an experience seeds for a new organization, besides the common ones (vegetarian, vegan,
-- gluten-free, nut allergy, diabetic, other). Read through the experience's lineage.
create table if not exists app.category_dietary_options (
  category_key text not null references app.organization_categories(key),
  key          text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text not null check (char_length(btrim(label)) between 1 and 60),
  sort         integer not null default 50,
  primary key (category_key, key)
);
comment on table app.category_dietary_options is
  'Dietary choices an experience adds to a new organization''s list (0600), on top of the common ones. Jain Center: "Jain (no root vegetables)". Written only by migrations.';

insert into app.category_dietary_options (category_key, key, label, sort) values
  ('jain_center', 'jain', 'Jain (no root vegetables)', 3)
on conflict (category_key, key) do nothing;

-- Reference data like the other catalogs: read by everyone, written by nobody through the API, audited, core platform.
alter table app.experience_families enable row level security;
alter table app.setup_step_wording enable row level security;
alter table app.category_dietary_options enable row level security;
drop policy if exists experience_families_read on app.experience_families;
create policy experience_families_read on app.experience_families for select to anon, authenticated using (true);
drop policy if exists setup_step_wording_read on app.setup_step_wording;
create policy setup_step_wording_read on app.setup_step_wording for select to authenticated using (true);
drop policy if exists category_dietary_options_read on app.category_dietary_options;
create policy category_dietary_options_read on app.category_dietary_options for select to anon, authenticated using (true);
revoke all on app.experience_families, app.setup_step_wording, app.category_dietary_options from public, anon, authenticated;
grant select on app.experience_families, app.category_dietary_options to anon, authenticated;
grant select on app.setup_step_wording to authenticated;
grant all on app.experience_families, app.setup_step_wording, app.category_dietary_options to service_role;
drop trigger if exists audit_experience_families on app.experience_families;
create trigger audit_experience_families after insert or update or delete on app.experience_families
  for each row execute function app.audit_row('key');
drop trigger if exists audit_setup_step_wording on app.setup_step_wording;
create trigger audit_setup_step_wording after insert or update or delete on app.setup_step_wording
  for each row execute function app.audit_row('category_key', 'step_key');
drop trigger if exists audit_category_dietary_options on app.category_dietary_options;
create trigger audit_category_dietary_options after insert or update or delete on app.category_dietary_options
  for each row execute function app.audit_row('category_key', 'key');
insert into app.module_tables (table_name, module_key)
values ('experience_families', null), ('setup_step_wording', null), ('category_dietary_options', null)
on conflict (table_name) do update set module_key = excluded.module_key;

-- ════════════════════════════════════════════════════════════════════════════
-- C · The experiences
-- ════════════════════════════════════════════════════════════════════════════
do $$ begin perform app.set_audit_context('Experiences: the kind of organization is data (migration 0600)'); end $$;

-- The four existing rows, completed. Jain Center is untouched except for its family and wording pack.
update app.organization_categories set family_key = 'jain', wording_pack = 'jain', library_pack = 'jain' where key = 'jain_center';
update app.organization_categories set wording_pack = 'chamber' where key = 'chamber_of_commerce';
-- The neutral experience: any group that is not a house of worship. Inactive, so renaming it changes nothing for anyone.
update app.organization_categories
   set label = 'Community organization',
       description = 'Clubs, associations, non-profits and any other group that is not a house of worship',
       wording_pack = 'neutral',
       terms = terms || jsonb_build_object('assistant_context', 'a community organization')
 where key = 'nonprofit_secular';
-- The generic faith: a house of worship that has no kind of its own in the list yet. Under "Other faith" in the picker.
update app.organization_categories
   set label = 'Faith community',
       description = 'A church, temple, gurdwara, mosque or other house of worship that has no kind of its own in the list yet',
       family_key = 'other_faith', wording_pack = 'faith'
 where key = 'faith_other';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'organization_categories_wording_ok') then
    alter table app.organization_categories add constraint organization_categories_wording_ok check (app.wording_ok(wording));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organization_categories_faith_needs_family') then
    alter table app.organization_categories add constraint organization_categories_faith_needs_family
      check (not faith_based or family_key is not null);
  end if;
end $$;

select app.experience_apply_tags();

-- Adding an experience (migrations only): the catalog row starts from the experience it inherits from (its words, wording
-- pack, overlay, family, whether it asks a path) with the overrides given; its modules start as the parent's (the
-- fail-closed trigger of 0594 has already given every module a row); what it shows (tags), its Setup wording and its
-- dietary extras are read along its lineage, so they follow with no copying. The module names for the Pathshala, Gyan Path
-- and the Store follow the words the experience gives them. Inactive unless asked: a new experience is first previewed in a
-- sandbox.
create or replace function app.add_experience(
  p_key text, p_label text, p_description text, p_inherits_from text, p_family_key text, p_sort integer,
  p_terms jsonb default '{}'::jsonb, p_wording jsonb default '{}'::jsonb, p_active boolean default false)
returns void language plpgsql security definer set search_path = app, public, extensions as $$
declare p app.organization_categories; v_terms jsonb;
begin
  select * into p from app.organization_categories where key = p_inherits_from;
  if p.key is null then
    raise exception 'There is no experience called "%" to start from.', p_inherits_from;
  end if;
  v_terms := p.terms || coalesce(p_terms, '{}'::jsonb);
  insert into app.organization_categories (key, label, description, faith_based, uses_tradition, path_label, terms, active, sort,
                                           family_key, inherits_from, wording_pack, wording, library_pack)
  values (p_key, p_label, coalesce(p_description, ''), p.faith_based, p.uses_tradition, p.path_label, v_terms,
          coalesce(p_active, false), p_sort, coalesce(p_family_key, p.family_key), p.key, p.wording_pack,
          p.wording || coalesce(p_wording, '{}'::jsonb), p.library_pack);
  update app.category_modules c
     set availability = pc.availability, label = pc.label, description = pc.description
    from app.category_modules pc
   where pc.category_key = p.key and c.category_key = p_key and c.module_key = pc.module_key;
  if p_terms ? 'school' and p_terms->>'school' is not null then
    update app.category_modules set label = p_terms->>'school' where category_key = p_key and module_key = 'pathshala';
  end if;
  if p_terms ? 'learning' and p_terms->>'learning' is not null then
    update app.category_modules set label = p_terms->>'learning' where category_key = p_key and module_key = 'gyan_path';
  end if;
  if p_terms ? 'store' and p_terms->>'store' is not null then
    update app.category_modules set label = p_terms->>'store' where category_key = p_key and module_key = 'store';
  end if;
end $$;
revoke execute on function app.add_experience(text, text, text, text, text, integer, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function app.add_experience(text, text, text, text, text, integer, jsonb, jsonb, boolean) to service_role;

-- Three inactive experiences, to prove the mechanism. THEIR WORDS NEED REVIEW by someone from that faith before they are
-- switched on (greetings, the school, the learning path, the place of worship, dietary choices).
select app.add_experience('swaminarayan_temple', 'Swaminarayan Temple', 'Swaminarayan mandirs and satsang centers',
  'faith_other', 'hindu', 41,
  '{"greeting":"Jai Swaminarayan","place":"mandir","assistant_context":"a Swaminarayan community"}'::jsonb)
 where not exists (select 1 from app.organization_categories where key = 'swaminarayan_temple');
select app.add_experience('church', 'Church', 'Churches of any denomination',
  'faith_other', 'christian', 42,
  '{"school":"Sunday school","learning":"Faith formation","place":"church","assistant_context":"a church community"}'::jsonb)
 where not exists (select 1 from app.organization_categories where key = 'church');
select app.add_experience('mosque', 'Mosque', 'Mosques and Islamic centers',
  'faith_other', 'muslim', 43,
  '{"school":"Weekend school","place":"mosque","assistant_context":"a mosque community"}'::jsonb)
 where not exists (select 1 from app.organization_categories where key = 'mosque');

insert into app.category_dietary_options (category_key, key, label, sort) values
  ('swaminarayan_temple', 'satvik', 'Satvik (no onion or garlic)', 3),
  ('mosque',              'halal',  'Halal', 3)
on conflict (category_key, key) do nothing;

-- Setup wording for the experiences that are not Jain (the catalog mentions navkarsi, bolis, tithi days and the religious
-- coordinator). Jain Center keeps the catalog's text.
insert into app.setup_step_wording (category_key, step_key, title, description, help, done_means, owner_role)
select v.category_key, v.step_key, v.title, v.description, v.help, v.done_means, v.owner_role
  from (values
  ('chamber_of_commerce', 'org.legal_identity', null, null,
     'We check the EIN against the IRS exempt-organization list. A chamber of commerce usually holds a 501(c)(6) determination letter: upload that. Community Connect reviews the documents.', null, null),
  ('chamber_of_commerce', 'org.profile', null, null,
     'The map pin''s latitude and longitude place your organization on the map. Members see the profile in the app.', null, null),
  ('chamber_of_commerce', 'org.modules', null, 'Choose which of the modules offered to a chamber of commerce to use.', null, null, null),
  ('chamber_of_commerce', 'org.rules', null, 'Walk through the rules with their defaults: membership, dues and payments, store, events and RSVP.', null, null, null),
  ('chamber_of_commerce', 'svc.other', null, 'A background-check provider, a live link to the old CRM.', null, null, null),
  ('chamber_of_commerce', 'hist.other', null, 'Past memberships, attendance and store orders.', null, null, null),
  ('chamber_of_commerce', 'niva.train', null, null, null, null, 'Communications officer'),
  ('nonprofit_secular', 'org.legal_identity', null, null,
     'We check the EIN against the IRS exempt-organization list. Community Connect reviews the documents.', null, null),
  ('nonprofit_secular', 'org.profile', null, null,
     'The map pin''s latitude and longitude place your organization on the map. Members see the profile in the app.', null, null),
  ('nonprofit_secular', 'org.modules', null, 'Choose which of the modules offered to your organization to use.', null, null, null),
  ('nonprofit_secular', 'org.rules', null, 'Walk through the rules with their defaults: membership, giving, store, events and RSVP.', null, null, null),
  ('nonprofit_secular', 'svc.other', null, 'A background-check provider, a live link to the old CRM.', null, null, null),
  ('nonprofit_secular', 'hist.other', null, 'Past memberships, attendance and store orders.', null, null, null),
  ('nonprofit_secular', 'niva.train', null, null, null, null, 'Communications officer'),
  ('faith_other', 'org.profile', null, null,
     'The map pin''s latitude and longitude place your organization on the map. Members see the profile in the app.', null, null),
  ('faith_other', 'org.modules', null, 'Choose which of the modules offered to a faith community to use.', null, null, null),
  ('faith_other', 'org.rules', null, 'Walk through the rules with their defaults: membership, giving, store, lunch and RSVP, points.', null, null, null),
  ('faith_other', 'svc.other', null, 'A background-check provider, a live link to the old CRM.', null, null, null),
  ('faith_other', 'hist.other', null, 'Past memberships, attendance and store orders.', null, null, null)
  ) as v(category_key, step_key, title, description, help, done_means, owner_role)
 where exists (select 1 from app.setup_steps s where s.key = v.step_key)
on conflict (category_key, step_key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- D · The picker, callable before login
-- ════════════════════════════════════════════════════════════════════════════
-- One row per experience, in picker order: faith-based first (by family, then experience), then the others. `sort` is the
-- position in this answer (1, 2, 3 ...), so the picker can group consecutive rows. Only active experiences, unless the
-- caller is a platform admin (who may also choose an inactive one, for a sandbox, to preview it).
--   Step 1  Faith-based (when any row has faith_based) | each row that is not faith-based (Chamber of commerce, ...)
--   Step 2  (faith-based only) the family: family_key / family_label
--   Step 3  (faith-based only) the experience: key / label / description
create or replace function app.list_experiences()
returns table (key text, label text, description text, family_key text, family_label text, faith_based boolean,
               active boolean, sort integer)
language sql stable security definer set search_path = app, public, extensions as $$
  select x.key, x.label, x.description, x.family_key, x.family_label, x.faith_based, x.active, x.pos::integer
    from (select k.key, k.label, k.description, k.family_key, f.label as family_label, k.faith_based, k.active,
                 row_number() over (order by (not k.faith_based), f.sort nulls last, k.sort, k.key) as pos
            from app.organization_categories k
            left join app.experience_families f on f.key = k.family_key
           where k.active or app.is_platform_admin()) x
   order by x.pos
$$;
revoke execute on function app.list_experiences() from public;
grant execute on function app.list_experiences() to anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- E · ACCESS 1 · the access areas follow the experience
-- ════════════════════════════════════════════════════════════════════════════
-- 0586's three functions with one more condition: an area the organization's experience does not have is left out
-- (feature_access_for_me, access_settings) and is closed (can_use_feature, which the live-darshan policy of the content
-- table calls). Jain Center has every area, so for JSH and every existing community the answers are the same.

create or replace function app.can_use_feature(p_center uuid, p_feature text) returns boolean
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare f app.access_features; v_min integer; v_rank integer;
begin
  select * into f from app.access_features where key = p_feature;
  if f.key is null or p_center is null then return false; end if;
  if not app.catalog_shows(f.category_keys, app.center_category(p_center)) then return false; end if;
  if f.module_key is not null and not app.module_enabled(p_center, f.module_key) then return false; end if;
  select m.rank into v_min from app.feature_min_level(p_center, f.key) m;
  v_min := coalesce(v_min, case f.default_level when 'public' then 0 else 10 end);
  if v_min <= 0 then                                   -- open to everyone: no membership lookup needed
    return app.access_center_open(p_center);
  end if;
  select a.rank into v_rank from app.my_access(p_center) a;
  return coalesce(v_rank, 0) >= v_min;
end $$;

create or replace function app.feature_access_for_me(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare me record; f record; v_out jsonb := '{}'::jsonb; v_on boolean; v_ok boolean; v_reason text;
        v_min_key text; v_min_label text; v_min_rank integer; v_cat text;
begin
  if p_center is null or not app.access_center_open(p_center) then
    raise exception 'That community was not found.';
  end if;
  v_cat := app.center_category(p_center);
  select * into me from app.my_access(p_center);
  for f in select * from app.access_features a where app.catalog_shows(a.category_keys, v_cat) order by a.sort, a.key loop
    select m.key, m.label, m.rank into v_min_key, v_min_label, v_min_rank from app.feature_min_level(p_center, f.key) m;
    if v_min_key is null then
      -- the community's ladder is missing (it should not be): the catalog default, by the platform's own names
      v_min_key := f.default_level;
      v_min_label := case f.default_level when 'community' then 'Community member' else 'Public' end;
      v_min_rank := case f.default_level when 'community' then 10 else 0 end;
    end if;
    v_on := f.module_key is null or app.module_enabled(p_center, f.module_key);
    v_ok := v_on and me.rank >= v_min_rank;
    v_reason := case when not v_on then 'module_off'
                     when v_ok then null
                     when not me.signed_in then 'sign_in'
                     else 'level' end;
    v_out := v_out || jsonb_build_object(f.key, jsonb_build_object(
               'allowed', v_ok, 'reason', v_reason,
               'min_level', jsonb_build_object('key', v_min_key, 'label', v_min_label, 'rank', v_min_rank)));
  end loop;
  return jsonb_build_object('level', jsonb_build_object('key', me.key, 'label', me.label, 'rank', me.rank),
                            'signed_in', me.signed_in, 'features', v_out);
end $$;

create or replace function app.access_settings(p_center uuid) returns jsonb
language plpgsql stable security definer set search_path = app, public, extensions as $$
declare v_cat text;
begin
  if p_center is null or not exists (select 1 from app.centers where id = p_center) then
    raise exception 'That community was not found.';
  end if;
  if not (app.has_permission(p_center, 'settings.manage') or app.is_platform_admin()) then
    raise exception 'Seeing who can use each area needs the settings.manage permission.' using errcode = 'insufficient_privilege';
  end if;
  v_cat := app.center_category(p_center);
  return jsonb_build_object(
    'levels', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', l.key, 'label', l.label, 'rank', l.rank, 'kind', l.kind,
                 'tiers', coalesce(to_jsonb(l.tiers::text[]), '[]'::jsonb),
                 'membership_type_keys', coalesce(to_jsonb(l.membership_type_keys), '[]'::jsonb),
                 'locked', l.kind <> 'membership') order by l.rank)
                 from app.access_levels l where l.center_id = p_center), '[]'::jsonb),
    'features', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', f.key, 'label', f.label, 'description', f.description,
                 'default_level', f.default_level, 'floor_level', f.floor_level,
                 'level_key', coalesce((select m.key from app.feature_min_level(p_center, f.key) m), f.default_level),
                 'enforced_by', f.enforced_by, 'module_key', f.module_key,
                 'module_on', f.module_key is null or app.module_enabled(p_center, f.module_key)) order by f.sort, f.key)
                 from app.access_features f where app.catalog_shows(f.category_keys, v_cat)), '[]'::jsonb),
    'membership_types', coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name, 'tier', t.tier, 'active', t.active)
                                                   order by t.active desc, t.tier, t.name)
                                    from app.membership_types t where t.center_id = p_center), '[]'::jsonb));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- F · Setup checklist and dietary seed follow the experience
-- ════════════════════════════════════════════════════════════════════════════

-- 0594's checklist, plus: a step the organization's experience does not have (category_keys) is left out, and the words come
-- from setup_step_wording along the experience's lineage when it has its own.
create or replace function app.setup_checklist(p_center uuid)
returns table (step_key text, stage int, sort int, title text, description text, help text, done_means text, route text,
               owner_role text, module_key text, required boolean, auto boolean, manual boolean,
               status text, computed_status text, stored_status text, detail text,
               owner_person_id uuid, owner_name text, due_on date, notes text, completed_by uuid, completed_at timestamptz,
               updated_at timestamptz)
language plpgsql stable security definer set search_path = app, public, extensions as $$
#variable_conflict use_column
declare v_auto jsonb; v_cat text; v_catkey text; v_lineage text[];
begin
  if not app.setup_can_manage(p_center) then
    raise exception 'You don''t have access to this community''s setup (it needs settings.manage or the owner).' using errcode = '42501';
  end if;
  v_auto := app.setup_auto_status(p_center);
  select k.label, k.key, k.lineage into v_cat, v_catkey, v_lineage
    from app.centers c join app.organization_categories k on k.key = c.category_key where c.id = p_center;
  return query
  select s.key, s.stage, s.sort, coalesce(ow.title, s.title), coalesce(ow.description, s.description), coalesce(ow.help, s.help),
         coalesce(ow.done_means, s.done_means), s.route, coalesce(ow.owner_role, s.owner_role), s.module_key,
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
    left join lateral (
      select w.title, w.description, w.help, w.done_means, w.owner_role
        from app.setup_step_wording w
        join unnest(v_lineage) with ordinality as l(lkey, pos) on l.lkey = w.category_key
       where w.step_key = s.key
       order by l.pos
       limit 1) ow on true
   where app.catalog_shows(s.category_keys, v_catkey)
   order by s.stage, s.sort;
end $$;

-- 0546's dietary seed, now by experience: the common choices for everyone, plus the extras of the experience and of every
-- experience it inherits from (Jain Center: "Jain (no root vegetables)", as before). Existing communities keep their list.
create or replace function app.seed_dietary_options(p_center uuid, p_category text) returns void
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  insert into app.dietary_options (center_id, key, label, sort)
  select p_center, v.key, v.label, v.sort
    from (values ('vegetarian', 'Vegetarian', 1), ('vegan', 'Vegan', 2), ('gluten_free', 'Gluten-free', 4),
                 ('nut_allergy', 'Nut allergy', 5), ('diabetic', 'Diabetic', 6), ('other', 'Other', 99)) as v(key, label, sort)
  on conflict (center_id, key) do nothing;
  insert into app.dietary_options (center_id, key, label, sort)
  select distinct on (d.key) p_center, d.key, d.label, d.sort
    from app.organization_categories k
    cross join lateral unnest(k.lineage) with ordinality as l(lkey, pos)
    join app.category_dietary_options d on d.category_key = l.lkey
   where k.key = p_category
   order by d.key, l.pos
  on conflict (center_id, key) do nothing;
end $$;
revoke execute on function app.seed_dietary_options(uuid, text) from public, anon, authenticated;
grant execute on function app.seed_dietary_options(uuid, text) to service_role;

create or replace function app.seed_default_dietary_options() returns trigger
language plpgsql security definer set search_path = app, public, extensions as $$
begin
  perform app.seed_dietary_options(new.id, new.category_key);
  return new;
end $$;

-- 0594's promotion dispatcher with one change on the COPY route: the copy starts as a Jain Center, so after the category is
-- set the Jain dietary option is removed unless the experience has it, and the experience's own extras are added.
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
  -- Re-checked here, not only when the promotion was requested: the category may have been switched off since.
  if not exists (select 1 from app.organization_categories k where k.key = s.category_key and k.active) then
    raise exception '% is a preview of a category that is not switched on yet, so it cannot go live.', s.name;
  end if;
  if not app.promotes_in_place(s.id) then
    v_result := app._worker_promote_sandbox_copy(p_promotion);
    v_prod := case when v_result->>'production_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   then (v_result->>'production_id')::uuid end;
    if v_prod is not null and s.category_key is distinct from (select x.category_key from app.centers x where x.id = v_prod) then
      update app.centers set category_key = s.category_key where id = v_prod;
      delete from app.dietary_options d
       where d.center_id = v_prod and d.key = 'jain'
         and not exists (select 1 from app.organization_categories k
                           cross join lateral unnest(k.lineage) as l(lkey)
                           join app.category_dietary_options o on o.category_key = l.lkey and o.key = 'jain'
                          where k.key = s.category_key);
      perform app.seed_dietary_options(v_prod, s.category_key);
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
-- G · The one read for the member app
-- ════════════════════════════════════════════════════════════════════════════
-- app.member_experience(community, known_stamp): callable with or without a session (the guest sees the community's choices
-- and the access of a visitor). It builds on app.category_profile (0594), app.feature_access_for_me (0586) and the module
-- functions, and adds what the administrator set up. The shape (CONTRACT in the pull request):
--   stamp        a change detector: it changes whenever anything below changes (an administrator's module switch, a change of
--                the experience, the home shortcuts, branding, access levels, the catalog's words...). Send it back as
--                known_stamp: when nothing changed the answer is just {stamp, unchanged: true, updated_at} (a few bytes).
--   updated_at   the latest time the community's own settings changed (informational)
--   center       {id, slug, name, short_name, environment, status, time_zone}
--   experience   {key, label, description, family_key, family_label, faith_based, uses_tradition, path_label, terms{9 words},
--                 wording_pack, wording{}, library_pack, inherits_from}
--   modules      {<module_key>: {availability, label, enabled, core}}   label = the experience's own name for the module;
--                enabled = on for this community now (the experience's defaults and the administrator's switch together)
--   flags        {school, learning, store, labh, bolis, niva, practice}  the questions the app asks most, as booleans
--   setup        {home_shortcuts (list or null = the app's default), branding{}, timings{enabled, has_location}, time_zone,
--                 tradition, identifiers{org_member_label, org_household_label}}
--   access       what app.feature_access_for_me answers (the areas of the experience, for this caller)
--   topics       the notification topic keys the experience shows
--   paths        the person-level paths of the experience ([] when it asks none), default_path
-- Jain Center (JSH) reads: wording_pack "jain", empty wording, every module enabled that the administrator has not switched
-- off, every access area, all ten topics.
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
    'branding', coalesce(c.branding, '{}'::jsonb),
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

-- ════════════════════════════════════════════════════════════════════════════
-- H · Requests and sandboxes: the applicant's stated kind, one choice to create a sandbox
-- ════════════════════════════════════════════════════════════════════════════

-- The kind the applicant chose on the Request access page (an active experience from app.list_experiences). Community
-- Connect can change it before approving (app.set_access_request_category writes category_key, which wins).
alter table app.access_requests add column if not exists requested_category_key text references app.organization_categories(key);
comment on column app.access_requests.requested_category_key is
  'The kind of organization the applicant chose on the Request access page (0600). The sandbox made from the request takes category_key (Community Connect''s choice) when set, else this, else Jain Center.';

-- 0594's shared center creation with one more source of the category: the applicant's own stated kind, after Community
-- Connect's choice. Same signature.
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
                         (select r.requested_category_key from app.access_requests r where r.id = v_request),
                         'jain_center');
  if not exists (select 1 from app.organization_categories k where k.key = v_category) then
    raise exception 'Choose the kind of organization.';
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

-- 0594's console action (same signature) with one choice instead of two: the kind of organization is the experience, and the
-- older "temple, community center or other non-profit" answer is worked out from it when it is left empty (a faith-based
-- experience is a temple, any other an "other non-profit"). A value given must still be one of the three.
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
        v_org_type text := nullif(btrim(coalesce(p_org_type, '')), ''); v_kind app.organization_categories;
begin
  if auth.uid() is null or not app.is_platform_admin() then
    raise exception 'Only the Community Connect team can create a sandbox directly.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_kind from app.organization_categories k where k.key = v_category;
  if v_category is null or v_kind.key is null then
    raise exception 'Choose the kind of organization.';
  end if;
  if v_org_type is null then
    v_org_type := case when v_kind.faith_based then 'temple' else 'other_nonprofit' end;
  elsif v_org_type not in ('temple','community_center','other_nonprofit') then
    raise exception 'Choose the kind of organization: temple, community center or other non-profit.';
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
                jsonb_build_object('source', 'platform_admin', 'created_by', auth.uid(), 'org_type', v_org_type,
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

-- The public request function itself (app.submit_access_request, with the kind the applicant chose from app.list_experiences())
-- is defined by migration 0612, which applies after this one and writes requested_category_key. This migration only makes sure
-- the column exists (and is read by _create_sandbox_center above), so the two do not depend on each other's order of review.
