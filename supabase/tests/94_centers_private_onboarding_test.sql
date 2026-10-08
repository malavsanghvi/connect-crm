-- 0613: a community's row is readable by anyone, so the owner's e-mail, the creating admin's login id and
-- contact names / phone numbers are never kept in rules.onboarding; the settings the portal uses stay.
-- Everything runs in one transaction on fresh communities and is rolled back at the end.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

-- A · a new community never stores the private keys, and keeps the others.
insert into app.centers (id, slug, name, status, environment, rules) values
  ('94000000-0000-4000-8000-0000000000a1', 'priv94-sandbox', 'Private 94', 'onboarding', 'sandbox',
   jsonb_build_object('security', jsonb_build_object('require_2fa_for_staff', true),
     'onboarding', jsonb_build_object('production_slug', 'priv94', 'source', 'platform_admin', 'org_type', 'temple',
       'owner_email', 'owner@example.org', 'created_by', '11111111-1111-4111-8111-111111111111',
       'contact_name', 'Asha Shah', 'applicant_phone', '+15125550100', 'contact_coverage_target', 70)));
select pg_temp.assert((select not ((rules -> 'onboarding') ? 'owner_email') and not ((rules -> 'onboarding') ? 'created_by')
                              and not ((rules -> 'onboarding') ? 'contact_name') and not ((rules -> 'onboarding') ? 'applicant_phone')
                         from app.centers where id = '94000000-0000-4000-8000-0000000000a1'),
  'A · the owner e-mail, the creating admin, the contact name and the phone are not stored');
select pg_temp.assert((select rules #>> '{onboarding,production_slug}' = 'priv94' and rules #>> '{onboarding,source}' = 'platform_admin'
                              and rules #>> '{onboarding,org_type}' = 'temple' and (rules #>> '{onboarding,contact_coverage_target}')::int = 70
                              and (rules #>> '{security,require_2fa_for_staff}')::boolean
                         from app.centers where id = '94000000-0000-4000-8000-0000000000a1'),
  'A · the settings the portal uses (web name, source, kind, coverage target, staff 2FA) are kept');

-- B · a later write cannot put them back, and a normal onboarding update still works.
update app.centers set rules = jsonb_set(rules, '{onboarding,owner_email}', '"late@example.org"')
 where id = '94000000-0000-4000-8000-0000000000a1';
select pg_temp.assert((select not ((rules -> 'onboarding') ? 'owner_email') from app.centers where id = '94000000-0000-4000-8000-0000000000a1'),
  'B · writing the owner e-mail into an existing community is stripped too');
update app.centers set rules = jsonb_set(rules, '{onboarding,wizard_step}', '3')
 where id = '94000000-0000-4000-8000-0000000000a1';
select pg_temp.assert((select (rules #>> '{onboarding,wizard_step}')::int = 3 from app.centers where id = '94000000-0000-4000-8000-0000000000a1'),
  'B · the wizard step is saved as before');

-- C · the one-time clean-up removes keys already stored, keeps the rest, and is safe to repeat.
alter table app.centers disable trigger centers_strip_private_onboarding;
insert into app.centers (id, slug, name, status, environment, rules) values
  ('94000000-0000-4000-8000-0000000000a2', 'old94-sandbox', 'Old 94', 'onboarding', 'sandbox',
   jsonb_build_object('onboarding', jsonb_build_object('production_slug', 'old94', 'owner_email', 'old@example.org', 'contact_email', 'c@example.org')));
alter table app.centers enable trigger centers_strip_private_onboarding;
select pg_temp.assert((select rules #>> '{onboarding,owner_email}' = 'old@example.org' from app.centers where id = '94000000-0000-4000-8000-0000000000a2'),
  'C · (setup) a row from before the fix still holds the e-mail');
select pg_temp.assert(app.centers_scrub_private_onboarding() >= 1, 'C · the clean-up reports the community it cleaned');
select pg_temp.assert((select not ((rules -> 'onboarding') ? 'owner_email') and not ((rules -> 'onboarding') ? 'contact_email')
                              and rules #>> '{onboarding,production_slug}' = 'old94'
                         from app.centers where id = '94000000-0000-4000-8000-0000000000a2'),
  'C · the e-mails are gone and the web name is kept');
select pg_temp.assert(app.centers_scrub_private_onboarding() = 0, 'C · running it again changes nothing');

-- D · other shapes are left alone.
insert into app.centers (id, slug, name, status, environment, rules) values
  ('94000000-0000-4000-8000-0000000000a3', 'shape94-a', 'Shape 94 A', 'active', 'production', jsonb_build_object('onboarding', 'text only')),
  ('94000000-0000-4000-8000-0000000000a4', 'shape94-b', 'Shape 94 B', 'active', 'production', jsonb_build_object('home', jsonb_build_object('shortcuts', jsonb_build_array('give'))));
select pg_temp.assert((select rules -> 'onboarding' = to_jsonb('text only'::text) from app.centers where id = '94000000-0000-4000-8000-0000000000a3')
                       and (select rules ? 'onboarding' from app.centers where id = '94000000-0000-4000-8000-0000000000a4') is false
                       and (select rules #>> '{home,shortcuts,0}' = 'give' from app.centers where id = '94000000-0000-4000-8000-0000000000a4'),
  'D · a community with a non-object onboarding value, or none, is not changed');

-- E · the owner e-mail cannot be written back; and since 0615 a guest reads neither an onboarding community nor any
-- community's rules from the table (test 96).
update app.centers set rules = rules || jsonb_build_object('onboarding', (rules -> 'onboarding') || jsonb_build_object('owner_email', 'again@example.org'))
 where id = '94000000-0000-4000-8000-0000000000a1';
select pg_temp.assert((select rules #>> '{onboarding,owner_email}' is null and rules #>> '{onboarding,production_slug}' = 'priv94'
                         from app.centers where id = '94000000-0000-4000-8000-0000000000a1'),
  'E · the owner e-mail is stripped again, the web name kept');
set role anon;
select pg_temp.assert((select count(*) = 0 from app.centers where id = '94000000-0000-4000-8000-0000000000a1'),
  'E · a guest does not see the onboarding community at all (0615)');
select pg_temp.assert(not has_function_privilege('anon', 'app.centers_scrub_private_onboarding()', 'execute'),
  'E · a guest cannot run the clean-up');
reset role;

rollback;
