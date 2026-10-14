-- 0760-0763 (WeCare slice 2, docs/WECARE.md sections 3 and 5.1-5.2): who sees a household's care record, relationship
-- owners, the care profile and care notes.
--   A. The shape: four tables with RLS, mapped to care, audited with audit_private_row, a restrictive module_switch, no
--      direct writes; every WeCare function runs as the definer with the pinned search path and none of them, nor any
--      WeCare policy, uses has_permission or is_platform_admin; the private helpers are not callable.
--   B. Relationship owners: care.manage only; WeCare holders only; two different people; clearing; the picker.
--   C. Who sees what: the owner, a care lead, a care.view holder (who also writes), a relationship owner and the backup
--      (their households only); a platform admin holding "*" and a support grant opening WeCare settings see nothing,
--      through the functions or by reading the tables; people.view alone sees nothing; another community sees nothing.
--   D. Needs an owner: an owner whose role ended loses the household, and the household shows "needs an owner".
--   E. The care profile: its choices, the community's own languages, the contact is an adult of the household, do not
--      ask with rest-until, unknown fields.
--   F. Care notes: adults only, the author corrects, the author or a manager archives, nothing deleted.
--   G. Audit and reads: who, when and which columns, never the words; kept from platform admins and audit.view alone;
--      every read logged without names.
--   H. Care records stay with their family: deleting a household or a person they name is refused in plain words
--      (directly, by a platform admin, and when undoing an import); merging two households or two person records moves
--      them; Demo data counts show care rows only to the owner or a WeCare manager.
--   I. WeCare paused or not granted: nothing, through the functions or the tables.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '', true);
end $$;
-- A session with an authenticator check passed a minute ago. Merging households and undoing an import no longer ask for one (0787); harmless.
create or replace function pg_temp.claims_up(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60)))::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;

\set c1 '''16400000-0000-4000-8000-0000000000c1'''
\set c2 '''16400000-0000-4000-8000-0000000000c2'''
\set owner '''16400000-0000-4000-8000-000000000001'''
\set plat '''16400000-0000-4000-8000-000000000002'''
\set sup '''16400000-0000-4000-8000-000000000003'''
\set lead '''16400000-0000-4000-8000-000000000004'''
\set viewer '''16400000-0000-4000-8000-000000000005'''
\set rel '''16400000-0000-4000-8000-000000000006'''
\set rel2 '''16400000-0000-4000-8000-000000000007'''
\set clerk '''16400000-0000-4000-8000-000000000008'''
\set other '''16400000-0000-4000-8000-000000000009'''
\set leaver '''16400000-0000-4000-8000-00000000000a'''
\set auditor '''16400000-0000-4000-8000-00000000000b'''
\set h1 '''16400000-0000-4000-8000-0000000000b1'''
\set h2 '''16400000-0000-4000-8000-0000000000b2'''
\set h3 '''16400000-0000-4000-8000-0000000000b3'''
\set pa '''16400000-0000-4000-8000-0000000000a1'''
\set pb '''16400000-0000-4000-8000-0000000000a2'''
\set pk '''16400000-0000-4000-8000-0000000000a3'''
\set pc '''16400000-0000-4000-8000-0000000000a4'''
\set pd '''16400000-0000-4000-8000-0000000000a5'''
\set leavergrant '''16400000-0000-4000-8000-0000000000d1'''

-- ══ A. The shape ═════════════════════════════════════════════════════════════
select pg_temp.assert((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'app' and c.relname in ('care_owners', 'care_profiles', 'care_notes', 'care_touches')
                          and c.relrowsecurity) = 4
                      and (select count(*) from app.module_tables
                            where table_name in ('care_owners', 'care_profiles', 'care_notes', 'care_touches') and module_key = 'care') = 4
                      and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
                            where c.relname in ('care_owners', 'care_profiles', 'care_notes', 'care_touches')
                              and t.tgname = 'audit_' || c.relname and t.tgfoid = 'app.audit_private_row'::regproc) = 4
                      and (select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
                            where c.relname in ('care_owners', 'care_profiles', 'care_notes', 'care_touches')
                              and p.polname = 'module_switch' and not p.polpermissive) = 4,
  'A · the four WeCare tables have RLS, belong to care, are audited with audit_private_row and have a restrictive module_switch');
select pg_temp.assert(not exists (select 1 from unnest(array['care_owners', 'care_profiles', 'care_notes', 'care_touches']) t
                                   where has_table_privilege('authenticated', 'app.' || t, 'insert')
                                      or has_table_privilege('authenticated', 'app.' || t, 'update')
                                      or has_table_privilege('authenticated', 'app.' || t, 'delete')
                                      or not has_table_privilege('authenticated', 'app.' || t, 'select')
                                      or has_table_privilege('anon', 'app.' || t, 'select')),
  'A · signed-in callers read the tables under RLS and write them only through the functions; guests get nothing');
select pg_temp.assert(not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                                   where c.relname in ('care_owners', 'care_profiles', 'care_notes', 'care_touches')
                                     and (pg_get_expr(p.polqual, p.polrelid) ilike '%has_permission%'
                                          or pg_get_expr(p.polqual, p.polrelid) ilike '%is_platform_admin%'
                                          or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ilike '%is_platform_admin%')),
  'A · no WeCare policy uses has_permission or is_platform_admin');
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and (p.proname like 'care\_%' or p.proname like '\_care\_%'
                              or p.proname in ('set_care_owner', 'save_care_profile', 'add_care_note', 'edit_care_note',
                                               'archive_care_note', 'log_care_touch', 'void_care_touch'))
                          and p.proname not in ('care_can', 'care_amounts_can', 'care_settings_can')) >= 25
                      and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                       where n.nspname = 'app' and (p.proname like 'care\_%' or p.proname like '\_care\_%'
                                             or p.proname in ('set_care_owner', 'save_care_profile', 'add_care_note', 'edit_care_note',
                                                              'archive_care_note', 'log_care_touch', 'void_care_touch'))
                                         and p.proname not in ('care_can', 'care_amounts_can', 'care_settings_can')
                                         and (not p.prosecdef
                                              or array_to_string(p.proconfig, ',') not like '%search_path=app, public, extensions%'
                                              or p.prosrc ilike '%has_permission%' or p.prosrc ilike '%is_platform_admin%')),
  'A · every WeCare function of 0760-0763 runs as the definer with the pinned search path, and none uses has_permission or is_platform_admin');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._care_holder(uuid, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._care_household_or_raise(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._care_owner_card(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._care_household_head(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.care_row_household()', 'execute')
                      and has_function_privilege('authenticated', 'app.care_household_card(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.set_care_owner(uuid, uuid, uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.care_household_card(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.care_households(uuid, text, text, int, int)', 'execute'),
  'A · the helpers are private; the reads and writes are for signed-in callers only');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:owner, 'owner164@c1.test'), (:plat, 'plat164@weaver.test'), (:sup, 'sup164@weaver.test'), (:lead, 'lead164@c1.test'),
  (:viewer, 'viewer164@c1.test'), (:rel, 'rel164@c1.test'), (:rel2, 'rel2164@c1.test'), (:clerk, 'clerk164@c1.test'),
  (:other, 'other164@c2.test'), (:leaver, 'leaver164@c1.test'), (:auditor, 'auditor164@c1.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true), (:sup, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
-- A non-profit (WeCare is "Donor care" there) and a second community without WeCare.
-- (Sandboxes: a kind that is not switched on yet can be chosen for a sandbox only.)
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, category_key, environment) values
  (:c1, 'care164', 'Food Bank 164', 'F164', 'TX', 'active', 'America/Chicago', 'nonprofit_secular', 'sandbox'),
  (:c2, 'care164b', 'Club 164', 'K164', 'TX', 'active', 'America/Chicago', 'nonprofit_secular', 'sandbox');
insert into app.org_profiles (center_id, languages) values (:c1, array['en', 'es']);
insert into app.center_owners (center_id, user_id) values (:c1, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason) values (:c1, 'care', true, 'Test 164: WeCare');
-- Roles for this test only: care.view without care.manage; people.view only; audit.view and people.view.
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('care_viewer_164', 'center', 'Care viewer 164', 'center', 'Test 164', '["care.view"]'),
  ('people_viewer_164', 'center', 'People viewer 164', 'center', 'Test 164', '["people.view"]'),
  ('auditor_164', 'center', 'Auditor 164', 'center', 'Test 164', '["audit.view","people.view"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values
  (:c1, :plat, 'platform_owner', 'platform', 'Test 164: the platform owner role (holds "*")'),
  (:c1, :lead, 'care_lead', 'center', 'Test 164'), (:c1, :viewer, 'care_viewer_164', 'center', 'Test 164'),
  (:c1, :rel, 'relationship_owner', 'center', 'Test 164'), (:c1, :rel2, 'relationship_owner', 'center', 'Test 164'),
  (:c1, :clerk, 'people_viewer_164', 'center', 'Test 164'), (:c1, :auditor, 'auditor_164', 'center', 'Test 164'),
  (:c2, :other, 'care_lead', 'center', 'Test 164: the other community');
insert into app.role_grants (id, center_id, user_id, role_key, scope_kind, reason) values
  (:leavergrant, :c1, :leaver, 'relationship_owner', 'center', 'Test 164: will end');
insert into app.support_grants (center_id, grantee_user_id, granted_by, expires_at, reason, areas) values
  (:c1, :sup, :owner, now() + interval '2 days', 'Test 164: WeCare settings', array['care.settings']);
insert into app.households (id, center_id, display_name) values
  (:h1, :c1, 'Rivera164, Ana'), (:h2, :c1, 'Okafor164, Chidi'), (:h3, :c2, 'Other164, Olu');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pa, :c1, 'Ana', 'Rivera164', date '1980-01-01'), (:pb, :c1, 'Ben', 'Rivera164', date '1979-02-02'),
  (:pk, :c1, 'Kai', 'Rivera164', (current_date - interval '9 years')::date),
  (:pc, :c1, 'Chidi', 'Okafor164', date '1975-03-03'), (:pd, :c2, 'Olu', 'Other164', date '1970-04-04');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :pa, :c1, 'primary', true), (:h1, :pb, :c1, 'spouse', false), (:h1, :pk, :c1, 'child', false),
  (:h2, :pc, :c1, 'primary', true), (:h3, :pd, :c2, 'primary', true);
select pg_temp.assert(app.module_enabled(:c1, 'care') and not app.module_enabled(:c2, 'care')
                      and app._module_label(:c1, 'care') = 'Donor care',
  'Fixtures · WeCare is on in the first community only, named Donor care for a non-profit');

-- ══ B. Relationship owners ═══════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:viewer);
select pg_temp.assert_raises(format($$select app.set_care_owner(%L, %L, %L)$$, :h1, :rel, :rel2),
  'Only someone who manages', 'B · a care.view holder cannot choose owners');
select pg_temp.claims(:rel);
select pg_temp.assert_raises(format($$select app.set_care_owner(%L, %L, null)$$, :h1, :rel),
  'You don''t have access to this area', 'B · nor can a relationship owner (who does not see the household yet)');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format($$select app.set_care_owner(%L, %L, null)$$, :h1, :rel),
  'You don''t have access to this area', 'B · nor a platform admin holding "*"');
select pg_temp.claims(:lead);
select pg_temp.assert_raises(format($$select app.set_care_owner(%L, %L, %L)$$, :h1, :rel, :rel),
  'different person', 'B · the backup is a different person');
select pg_temp.assert_raises(format($$select app.set_care_owner(%L, %L, null)$$, :h1, :clerk),
  'cannot be a relationship owner', 'B · the owner holds a WeCare key (people.view is not enough)');
select pg_temp.assert_raises(format($$select app.set_care_owner(%L, %L, null)$$, :h1, :plat),
  'cannot be a relationship owner', 'B · a platform admin can never be one');
select pg_temp.assert_raises(format($$select app.set_care_owner(%L, %L, %L)$$, :h1, :rel, :clerk),
  'cannot be a backup', 'B · so does the backup');
select pg_temp.assert_raises(format($$select app.set_care_owner(%L, null, %L)$$, :h1, :rel2),
  'relationship owner first', 'B · a backup needs an owner');
select pg_temp.assert((select bool_and(x.user_id in (:owner, :lead, :viewer, :rel, :rel2, :leaver)) and count(*) = 6
                         and bool_or(x.user_id = :lead and x.level = 'manage') and bool_or(x.user_id = :viewer and x.level = 'view')
                         and bool_or(x.user_id = :rel and x.level = 'own')
                         from app.care_holders(:c1) x),
  'B · the picker lists the community''s WeCare holders with their level, never a platform admin or people.view alone');
select app.set_care_owner(:h1, :rel, :rel2, 'Ana asked for Rel') as card \gset
select pg_temp.assert((:'card'::jsonb)->'owner'->>'user_id' = :rel and (:'card'::jsonb)->'backup'->>'user_id' = :rel2
                      and not ((:'card'::jsonb)->>'needs_owner')::boolean and ((:'card'::jsonb)->'owner'->>'holds')::boolean,
  'B · a care lead chooses the owner and the backup');
select app.set_care_owner(:h2, :leaver, null) as card2 \gset
select pg_temp.claims(:viewer);
select pg_temp.assert_raises($$select * from app.care_holders('16400000-0000-4000-8000-0000000000c1')$$,
  'access', 'B · only a manager sees the picker');

-- ══ C. Who sees what ═════════════════════════════════════════════════════════
select pg_temp.claims(:owner);
select pg_temp.assert(app.care_household_can(:h1) and app.care_household_can(:h2) and not app.care_household_can(:h3),
  'C · the owner sees every household of their community, not another community''s');
select pg_temp.claims(:viewer);
select pg_temp.assert(app.care_household_can(:h1) and app.care_household_can(:h2)
                      and (select count(*) from app.care_owners) = 2,
  'C · a care.view holder sees every household, and reads the owners under RLS');
select pg_temp.claims(:rel);
select pg_temp.assert(app.care_household_can(:h1) and not app.care_household_can(:h2)
                      and (select count(*) from app.care_owners) = 1,
  'C · a relationship owner sees only their own household');
select pg_temp.claims(:rel2);
select pg_temp.assert(app.care_household_can(:h1) and not app.care_household_can(:h2),
  'C · the backup sees the household exactly as the owner does');
select pg_temp.assert_raises(format($$select app.care_household_card(%L)$$, :h2),
  'You don''t have access to this area', 'C · and nothing of another household');
select app.care_households(:c1, 'all') as mine \gset
select pg_temp.assert((:'mine'::jsonb)->>'filter' = 'mine' and ((:'mine'::jsonb)->>'total')::int = 1
                      and (:'mine'::jsonb)->'rows'->0->'household'->>'id' = :h1
                      and not ((:'mine'::jsonb)->'can'->>'all')::boolean
                      and (:'mine'::jsonb)->'counts'->>'needs_owner' is null,
  'C · asking for all households, a care.own holder gets only their own');
select pg_temp.claims(:plat);
select pg_temp.assert(not app.care_household_can(:h1)
                      and (select count(*) from app.care_owners) = 0 and (select count(*) from app.care_profiles) = 0
                      and (select count(*) from app.care_notes) = 0 and (select count(*) from app.care_touches) = 0,
  'C · a platform admin holding "*" sees no household and reads no row');
select pg_temp.assert_raises(format($$select app.care_household_card(%L)$$, :h1),
  'You don''t have access to this area', 'C · the card refuses a platform admin');
select pg_temp.assert_raises(format($$select app.care_households(%L, 'all')$$, :c1),
  'You don''t have access to this area', 'C · so does the list');
select pg_temp.claims(:sup);
select pg_temp.assert(app.care_settings_can(:c1) and not app.care_household_can(:h1)
                      and (select count(*) from app.care_owners) = 0,
  'C · a support grant that opens WeCare settings opens no care record (W8)');
select pg_temp.assert_raises(format($$select app.care_household_card(%L)$$, :h1),
  'You don''t have access to this area', 'C · nor the card');
select pg_temp.claims(:clerk);
select pg_temp.assert(not app.care_household_can(:h1) and (select count(*) from app.care_owners) = 0,
  'C · people.view alone sees nothing of WeCare');
select pg_temp.claims(:other);
select pg_temp.assert(not app.care_household_can(:h1) and not app.care_household_can(:h3),
  'C · a care lead of another community sees nothing here, nor in a community without WeCare');
select pg_temp.assert_raises(format($$select app.care_households(%L, 'all')$$, :c2),
  'is not on for this community', 'C · and is told WeCare is not on there');

-- ══ D. Needs an owner ════════════════════════════════════════════════════════
select pg_temp.claims(:leaver);
select pg_temp.assert(app.care_household_can(:h2), 'D · an owner sees their household while they hold the role');
reset role;
select pg_temp.no_claims();
update app.role_grants set status = 'revoked' where id = :leavergrant;
set role authenticated;
select pg_temp.claims(:leaver);
select pg_temp.assert(not app.care_household_can(:h2) and (select count(*) from app.care_owners) = 0,
  'D · once the role ends, the household is closed to them');
select pg_temp.claims(:lead);
select app.care_household_card(:h2) as card3 \gset
select app.care_households(:c1, 'needs_owner') as needs \gset
select pg_temp.assert(((:'card3'::jsonb)->'owners'->>'needs_owner')::boolean
                      and not ((:'card3'::jsonb)->'owners'->'owner'->>'holds')::boolean
                      and (:'card3'::jsonb)->'owners'->'owner'->>'user_id' = :leaver
                      and ((:'needs'::jsonb)->>'total')::int = 1 and (:'needs'::jsonb)->'rows'->0->'household'->>'id' = :h2
                      and ((:'needs'::jsonb)->'counts'->>'all')::int = 2,
  'D · the household shows "needs an owner" and keeps its history (the former owner is still named)');
select app.set_care_owner(:h2, :rel, null) as card4 \gset
select pg_temp.assert(not ((:'card4'::jsonb)->>'needs_owner')::boolean, 'D · a new owner takes it over');
select app.set_care_owner(:h2, null, null) as card5 \gset
select pg_temp.assert(((:'card5'::jsonb)->>'needs_owner')::boolean and (:'card5'::jsonb)->'owner' = 'null'::jsonb,
  'D · clearing the owners leaves the household needing one');

-- ══ E. The care profile ══════════════════════════════════════════════════════
select pg_temp.claims(:rel);
select app.save_care_profile(:h1, jsonb_build_object('thanks', 'call', 'recognition', 'anonymous', 'channel', 'phone',
                                                     'language', 'ES', 'contact_person_id', :pb)) as prof \gset
select pg_temp.assert((:'prof'::jsonb)->>'thanks' = 'call' and (:'prof'::jsonb)->>'recognition' = 'anonymous'
                      and (:'prof'::jsonb)->>'language' = 'es' and (:'prof'::jsonb)->>'contact_name' = 'Ben Rivera164'
                      and not ((:'prof'::jsonb)->>'do_not_ask')::boolean and not ((:'prof'::jsonb)->>'resting')::boolean,
  'E · the owner saves the profile; the language is kept in the community''s spelling');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, '{"language":"fr"}')$$, :h1),
  'community''s languages (en, es)', 'E · only the community''s own languages');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, jsonb_build_object('contact_person_id', %L::text))$$, :h1, :pk),
  'under 18', 'E · the contact is never a child');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, jsonb_build_object('contact_person_id', %L::text))$$, :h1, :pc),
  'not in this household', 'E · the contact is someone of the household');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, '{"thanks":"gift"}')$$, :h1),
  'how they like to be thanked', 'E · thanks is one of the five');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, '{"channel":"fax"}')$$, :h1),
  'WhatsApp or post', 'E · so is the channel');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, '{"wealth":"high"}')$$, :h1),
  'has no field "wealth"', 'E · and nothing else can be stored');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, jsonb_build_object('rest_until', (current_date - 3)::text))$$, :h1),
  'in the past', 'E · a rest ends today or later');
select app.save_care_profile(:h1, jsonb_build_object('rest_until', (current_date + 30)::text)) as rest \gset
select pg_temp.assert(((:'rest'::jsonb)->>'do_not_ask')::boolean and ((:'rest'::jsonb)->>'resting')::boolean
                      and (:'rest'::jsonb)->>'rest_until' = (current_date + 30)::text and (:'rest'::jsonb)->>'thanks' = 'call',
  'E · a rest-until date means do not ask until then; the other fields stay');
select app.save_care_profile(:h1, '{"do_not_ask":false}') as norest \gset
select pg_temp.assert(not ((:'norest'::jsonb)->>'do_not_ask')::boolean and (:'norest'::jsonb)->'rest_until' = 'null'::jsonb,
  'E · do not ask: no ends the rest');
select app.save_care_profile(:h1, '{"do_not_ask":true}') as dna \gset
select pg_temp.assert(((:'dna'::jsonb)->>'resting')::boolean and (:'dna'::jsonb)->'rest_until' = 'null'::jsonb,
  'E · do not ask without a date holds until someone changes it');
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, '{"thanks":"card"}')$$, :h2),
  'You don''t have access to this area', 'E · not another household''s profile');
select pg_temp.claims(:viewer);
select pg_temp.assert(app.save_care_profile(:h2, '{"thanks":"card","channel":"post"}')->>'thanks' = 'card',
  'E · a care.view holder writes profiles too (owner decision 2026-10-13)');
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format($$select app.save_care_profile(%L, '{"thanks":"none"}')$$, :h1),
  'You don''t have access to this area', 'E · a platform admin cannot write one');
select pg_temp.claims(:lead);
select app.care_households(:c1, 'resting') as resting \gset
select pg_temp.assert(((:'resting'::jsonb)->>'total')::int = 1 and (:'resting'::jsonb)->'rows'->0->'household'->>'id' = :h1,
  'E · the list shows the households resting');
select pg_temp.claims(:rel);
select app.care_households(:c1, 'resting') as rel_resting \gset
select app.care_households(:c1, 'mine', 'rivera164') as rel_found \gset
select app.care_households(:c1, 'mine', 'okafor164') as rel_other \gset
select app.care_households(:c1, 'mine', null, 50, 5) as rel_offset \gset
select pg_temp.assert(((:'rel_resting'::jsonb)->>'total')::int = 1 and (:'rel_resting'::jsonb)->'rows'->0->'household'->>'id' = :h1
                      and ((:'rel_found'::jsonb)->>'total')::int = 1
                      and ((:'rel_other'::jsonb)->>'total')::int = 0
                      and ((:'rel_offset'::jsonb)->>'total')::int = 1 and jsonb_array_length((:'rel_offset'::jsonb)->'rows') = 0,
  'E · a care.own holder: resting, search and paging stay inside their own households');

-- ══ F. Care notes ════════════════════════════════════════════════════════════
select pg_temp.claims(:rel);
select app.add_care_note(:h1, '  Ana prefers mornings; Ben is recovering from surgery.  ', :pa) as note1 \gset
select pg_temp.assert((select body from app.care_notes where id = :'note1') = 'Ana prefers mornings; Ben is recovering from surgery.',
  'F · the owner adds a note (trimmed) and reads it back under RLS');
select pg_temp.assert_raises(format($$select app.add_care_note(%L, 'About Kai', %L)$$, :h1, :pk),
  'under 18', 'F · a note is never about a child');
select pg_temp.assert_raises(format($$select app.add_care_note(%L, '   ')$$, :h1), 'Write the note first', 'F · an empty note');
select pg_temp.assert_raises(format($$select app.add_care_note(%L, repeat('x', 2001))$$, :h1), 'at most 2,000', 'F · a long note');
select pg_temp.claims(:viewer);
select app.add_care_note(:h1, 'Thank-you card sent by the board.') as note2 \gset
select pg_temp.assert_raises(format($$select app.edit_care_note(%L, 'Changed')$$, :'note1'),
  'Only the person who wrote', 'F · only the author corrects a note');
select pg_temp.assert_raises(format($$select app.archive_care_note(%L)$$, :'note1'),
  'Only the person who wrote a note, or someone who manages Donor care', 'F · nor archives someone else''s (without managing WeCare)');
select pg_temp.claims(:rel);
select app.edit_care_note(:'note1', 'Ana prefers mornings.');
select pg_temp.assert((select body = 'Ana prefers mornings.' and edited_at is not null from app.care_notes where id = :'note1'),
  'F · the author corrects their note');
select pg_temp.claims(:lead);
select app.archive_care_note(:'note2', 'Duplicate');
select app.care_household_card(:h1) as card6 \gset
select pg_temp.assert(((:'card6'::jsonb)->>'notes_total')::int = 1 and (:'card6'::jsonb)->'notes'->0->>'body' = 'Ana prefers mornings.'
                      and (select archived_at is not null from app.care_notes where id = :'note2')
                      and (select count(*) from app.care_notes where household_id = :h1) = 2,
  'F · a manager archives a note: it leaves the card, the row stays');
select pg_temp.assert_raises($$delete from app.care_notes$$, 'permission denied', 'F · nobody deletes notes through the API');
select pg_temp.claims(:viewer);
select pg_temp.assert_raises(format($$select app.edit_care_note(%L, 'Changed')$$, :'note2'),
  'archived', 'F · an archived note cannot be corrected, even by its author');

-- ══ G. Audit and reads ═══════════════════════════════════════════════════════
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select bool_and(l.module = 'care') and bool_and(coalesce(l.after->>'body', '***') = '***')
                              and bool_or(l.action = 'care_notes.insert') and bool_or(l.action = 'care_notes.update')
                         from app.audit_log l where l.record_table = 'care_notes' and l.center_id = :c1)
                      and (select l.after->>'thanks' = '***' and l.after->>'language' = '***' and l.module = 'care'
                             from app.audit_log l where l.record_table = 'care_profiles' and l.center_id = :c1 and l.record_id = :h1
                            order by l.id desc limit 1)
                      and exists (select 1 from app.audit_log l where l.record_table = 'care_owners' and l.record_id = :h1
                                     and l.module = 'care' and l.reason = 'Ana asked for Rel'),
  'G · every change is audited under WeCare: who, when, which row, never the words; an owner change keeps its reason');
select pg_temp.assert((select count(*) from app.audit_log l where l.center_id = :c1 and l.action = 'care.read'
                         and l.module = 'care' and l.after->>'what' in ('household', 'list')) >= 4
                      and not exists (select 1 from app.audit_log l where l.center_id = :c1 and l.action = 'care.read'
                                         and (l.after::text ilike '%Rivera164%' or l.after::text ilike '%Okafor164%')),
  'G · every card and list read is logged with what and how many rows, never a name');
set role authenticated;
select pg_temp.claims(:plat);
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c1 and module = 'care') = 0
                      and (select count(*) from app.record_history('care_notes', :'note1')) = 0,
  'G · a platform admin reads none of WeCare''s audit entries');
select pg_temp.claims(:auditor);
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c1 and module = 'care') = 0,
  'G · nor does audit.view alone');
select pg_temp.claims(:owner);
select pg_temp.assert((select count(*) from app.audit_log where center_id = :c1 and module = 'care') > 0,
  'G · the community''s owner does');

-- ══ H. Care records stay with their family ═══════════════════════════════════
\set run '''16400000-0000-4000-8000-0000000000e1'''
\set h5 '''16400000-0000-4000-8000-0000000000b5'''
\set h6 '''16400000-0000-4000-8000-0000000000b6'''
\set h7 '''16400000-0000-4000-8000-0000000000b7'''
\set h8 '''16400000-0000-4000-8000-0000000000b8'''
\set h9 '''16400000-0000-4000-8000-0000000000b9'''
\set p5 '''16400000-0000-4000-8000-0000000000a6'''
\set p6 '''16400000-0000-4000-8000-0000000000a7'''
\set p7 '''16400000-0000-4000-8000-0000000000a8'''
\set p8 '''16400000-0000-4000-8000-0000000000a9'''
\set p9 '''16400000-0000-4000-8000-0000000000aa'''
reset role;
select pg_temp.no_claims();
select pg_temp.assert_raises(format($$delete from app.households where id = %L$$, :h1),
  'This household has WeCare records, so it cannot be deleted', 'H · deleting a household with care records is refused in plain words');
select pg_temp.assert_raises(format($$delete from app.people where id = %L$$, :pb),
  'This person is named in WeCare records', 'H · so is deleting a person a care record names');
set role authenticated;
select pg_temp.claims(:plat);
select pg_temp.assert_raises(format($$delete from app.households where id = %L$$, :h1),
  'WeCare records', 'H · a platform admin, who may delete households, cannot delete this one');
reset role;
select pg_temp.no_claims();
insert into app.import_runs (id, center_id, entity, tier, source, status, committed_at, file_name)
values (:run, :c1, 'households', 'records', 'csv', 'committed', now(), 'families164.csv');
insert into app.import_changes (center_id, run_id, table_name, record_id, op) values (:c1, :run, 'households', :h1, 'insert');
set role authenticated;
select pg_temp.claims_up(:owner);
select pg_temp.assert_raises(format($$select app.import_undo(%L, 'Wrong file')$$, :run),
  'This household has WeCare records, so undoing the import cannot remove it', 'H · undoing the import that added it says why it cannot');
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select status from app.import_runs where id = :run) = 'committed'
                      and exists (select 1 from app.households where id = :h1)
                      and (select count(*) from app.care_notes where household_id = :h1) = 2,
  'H · and nothing was changed');

-- Merging: h6 into h5 (h5 has a thin profile and no owner), h7 into h5 (h5 now has an owner), h8 into h9 (h9 has no profile).
insert into app.households (id, center_id, display_name) values
  (:h5, :c1, 'Keep164, Kay'), (:h6, :c1, 'Keep164, Kay (duplicate)'), (:h7, :c1, 'Keep164, K. (second duplicate)'),
  (:h8, :c1, 'Pair164, Pat (duplicate)'), (:h9, :c1, 'Pair164, Pat');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p5, :c1, 'Kay', 'Keep164', date '1970-05-05'), (:p6, :c1, 'Kim', 'Keep164', date '1972-06-06'),
  (:p7, :c1, 'Kit', 'Keep164', date '1990-07-07'), (:p8, :c1, 'Pat', 'Pair164', date '1960-08-08'),
  (:p9, :c1, 'Pam', 'Pair164', date '1961-09-09');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h5, :p5, :c1, 'primary', true), (:h6, :p6, :c1, 'primary', true), (:h7, :p7, :c1, 'primary', true),
  (:h8, :p8, :c1, 'primary', true), (:h9, :p9, :c1, 'primary', true);
set role authenticated;
select pg_temp.claims(:lead);
select app.save_care_profile(:h5, '{"thanks":"call"}');
select app.save_care_profile(:h6, jsonb_build_object('thanks', 'card', 'recognition', 'public', 'channel', 'email', 'language', 'es',
                                                     'contact_person_id', :p6, 'rest_until', (current_date + 20)::text));
select app.add_care_note(:h6, 'Kim asked to be called after six.', :p6) as note6 \gset
select app.log_care_touch(:h6, jsonb_build_object('kind', 'welcome', 'channel', 'in_person', 'person_id', :p6)) as touch6 \gset
select app.set_care_owner(:h6, :rel2, null);
select app.set_care_owner(:h7, :rel, null);
select app.save_care_profile(:h8, '{"thanks":"none","recognition":"anonymous"}');
select pg_temp.claims_up(:owner);
select app.merge_households(:h5, :h6);
select pg_temp.claims(:lead);
select pg_temp.assert((select household_id = :h5 and person_id = :p6 from app.care_notes where id = :'note6')
                      and (select household_id = :h5 and person_id = :p6 from app.care_touches where id = :'touch6'),
  'H · merging moves the notes and touches to the surviving household');
select pg_temp.assert((select thanks = 'call' and recognition = 'public' and channel = 'email' and language = 'es'
                              and contact_person_id = :p6 and do_not_ask and rest_until = current_date + 20
                         from app.care_profiles where household_id = :h5)
                      and (select thanks = 'card' from app.care_profiles where household_id = :h6),
  'H · the survivor''s profile wins and the merged one fills only its blanks (the contact moved with the family; do not ask is kept)');
select pg_temp.assert((select owner_user_id = :rel2 from app.care_owners where household_id = :h5),
  'H · the survivor had no owner, so the merged household''s owner becomes its owner');
select pg_temp.claims_up(:owner);
select app.merge_households(:h5, :h7);
select app.merge_households(:h9, :h8);
select pg_temp.claims(:lead);
select pg_temp.assert((select owner_user_id = :rel2 from app.care_owners where household_id = :h5)
                      and (select owner_user_id = :rel from app.care_owners where household_id = :h7),
  'H · a survivor that has an owner keeps it; the merged household''s row stays as history');
select pg_temp.assert((select thanks = 'none' and recognition = 'anonymous' from app.care_profiles where household_id = :h9)
                      and not exists (select 1 from app.care_profiles where household_id = :h8),
  'H · with no survivor profile, the merged household''s profile moves over');
select app.care_household_card(:h5) as card7 \gset
select pg_temp.assert((:'card7'::jsonb)->'notes'->0->>'body' = 'Kim asked to be called after six.'
                      and (:'card7'::jsonb)->'profile'->>'contact_name' = 'Kim Keep164',
  'H · the survivor''s card shows what moved');
reset role;
select pg_temp.no_claims();
select pg_temp.assert((select count(*) from app.audit_log l where l.record_table in ('care_notes', 'care_touches', 'care_profiles', 'care_owners')
                         and l.action like '%.update' and l.module = 'care' and l.reason like 'Merged duplicate household%') >= 3
                      or (select count(*) from app.audit_log l where l.record_table in ('care_notes', 'care_touches', 'care_profiles')
                            and l.action like '%.update' and l.module = 'care'
                            and l.record_id in (:'note6', :'touch6', :h5)) >= 3,
  'H · every move is audited under WeCare');

-- Merging two person records: Quinn's duplicate record (pq) is merged into Ben's (pb), the kept one.
\set pq '''16400000-0000-4000-8000-0000000000ab'''
\set setadmin '''16400000-0000-4000-8000-00000000000c'''
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:pq, :c1, 'Ben', 'Rivera164 (duplicate)', date '1979-02-02');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h1, :pq, :c1, 'other', false);
set role authenticated;
select pg_temp.claims(:lead);
select app.save_care_profile(:h1, jsonb_build_object('contact_person_id', :pq));
select app.add_care_note(:h1, 'Ben (duplicate record) prefers texts.', :pq) as noteq \gset
select app.log_care_touch(:h1, jsonb_build_object('kind', 'check_in', 'channel', 'text', 'person_id', :pq)) as touchq \gset
select pg_temp.claims_up(:owner);
select app.merge_people(:pb, :pq);
select pg_temp.claims(:lead);
select pg_temp.assert((select person_id = :pb from app.care_notes where id = :'noteq')
                      and (select person_id = :pb from app.care_touches where id = :'touchq')
                      and (select contact_person_id = :pb from app.care_profiles where household_id = :h1)
                      and not exists (select 1 from app.care_notes where person_id = :pq)
                      and not exists (select 1 from app.care_touches where person_id = :pq),
  'H · merging two person records moves the notes, touches and the contact to the kept record');
reset role;
select pg_temp.no_claims();
select pg_temp.assert(exists (select 1 from app.audit_log l where l.module = 'care' and l.action = 'care_notes.update' and l.record_id = :'noteq'
                                 and l.before->>'person_id' = :pq and l.after->>'person_id' = :pb)
                      and exists (select 1 from app.audit_log l where l.module = 'care' and l.action = 'care_touches.update' and l.record_id = :'touchq'
                                 and l.before->>'person_id' = :pq and l.after->>'person_id' = :pb)
                      and exists (select 1 from app.audit_log l where l.module = 'care' and l.action = 'care_profiles.update' and l.record_id = :h1
                                 and l.before->>'contact_person_id' = :pq and l.after->>'contact_person_id' = :pb),
  'H · and each move is audited under WeCare');
select pg_temp.assert((select assigned_by = :lead from app.care_owners where household_id = :h5),
  'H · after a household merge the owner keeps who chose them; the merge itself is the audit entry''s actor');

-- Demo data counts (Settings > Demo data): WeCare's tables only for the owner or a WeCare manager.
insert into auth.users (id, email) values (:setadmin, 'setadmin164@c1.test');
insert into app.roles (key, tier, name, default_scope, description, permissions) values
  ('settings_admin_164', 'center', 'Settings admin 164', 'center', 'Test 164', '["settings.manage"]');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, reason) values (:c1, :setadmin, 'settings_admin_164', 'center', 'Test 164');
set role authenticated;
select pg_temp.claims(:setadmin);
select pg_temp.assert(not exists (select 1 from jsonb_object_keys(app.demo_data_counts(:c1)) k where k like 'care\_%')
                      and app.demo_data_counts(:c1) ? 'households',
  'H · settings.manage alone sees the community''s other counts, never how many care rows it holds');
select pg_temp.claims(:plat);
select pg_temp.assert(not exists (select 1 from jsonb_object_keys(app.demo_data_counts(:c1)) k where k like 'care\_%'),
  'H · nor does a platform admin');
select pg_temp.claims(:owner);
select pg_temp.assert(app.demo_data_counts(:c1) ? 'care_notes' and app.demo_data_counts(:c1) ? 'care_touches',
  'H · the community''s owner does');
reset role;
select pg_temp.no_claims();

-- ══ I. WeCare paused or not granted ══════════════════════════════════════════
reset role;
select pg_temp.no_claims();
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c1, 'care', false, 'Test 164: paused')
  on conflict (center_id, module_key) do update set enabled = false;
set role authenticated;
select pg_temp.claims(:lead);
select pg_temp.assert(not app.care_household_can(:h1) and (select count(*) from app.care_owners) = 0
                      and (select count(*) from app.care_profiles) = 0,
  'I · paused: a care lead sees nothing, through the functions or the tables');
select pg_temp.assert_raises(format($$select app.care_household_card(%L)$$, :h1),
  'is not on for this community', 'I · and is told why');
select pg_temp.claims(:owner);
select pg_temp.assert(not app.care_household_can(:h1) and (select count(*) from app.care_notes) = 0,
  'I · so does the owner');
reset role;
select pg_temp.no_claims();
rollback;
\echo 'PASS: WeCare owners, profiles and notes tests'
