-- 0740: platform grants for every non-core module (docs/GIVING_REDESIGN.md section 11.2, slice M1).
--   A. The shape: the grants table (RLS on, nobody writes it directly, audited, core platform), the private helpers, the
--      sandbox reset keeps the grants and promotion copies them, module_states has the new columns.
--   B. Grandfathering: no existing community lost a module it had switched on itself.
--   C. A chamber of commerce (not faith-based): a module its kind starts off waits for Weaver; its administrator cannot switch
--      it on ("Weaver has not enabled ..."); only a platform admin grants, with a reason and a fresh 2FA check, audited;
--      the community pauses and resumes what is granted; a revoke hides it whatever the community's switch says, and a new
--      grant brings back the community's own choice. Who reads the grants.
--   D. Dependencies are evaluated: a community pauses Giving in one step while Bolis and Accounting are on; they are off
--      (rows hidden, RPCs say why) and come back as they were; a revoke of Giving does the same.
--   E. The preview of a change of kind says when a module would wait for Weaver.
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
create or replace function pg_temp.hint_of(stmt text) returns text language plpgsql as $$
declare v text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_hint;
  return v;
end $$;
-- Sign in as a user; a fresh 2FA check (aal2 and a totp step a minute ago) when asked.
create or replace function pg_temp.claims(p_user uuid, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
  perform set_config('request.headers', '', true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;

\set plat '''15000000-0000-4000-8000-000000000001'''
\set chadmin '''15000000-0000-4000-8000-000000000002'''
\set chmember '''15000000-0000-4000-8000-000000000003'''
\set jadmin '''15000000-0000-4000-8000-000000000004'''
\set otheradmin '''15000000-0000-4000-8000-000000000005'''
\set chm '''15000000-0000-4000-8000-0000000000c1'''
\set jc '''15000000-0000-4000-8000-0000000000c2'''
\set oc '''15000000-0000-4000-8000-0000000000c3'''
\set h_chm '''15000000-0000-4000-8000-0000000000b1'''
\set p_chm '''15000000-0000-4000-8000-0000000000a1'''
\set boli '''15000000-0000-4000-8000-0000000000e1'''
\set storecat '''15000000-0000-4000-8000-0000000000e2'''

-- ══ A. The shape ═════════════════════════════════════════════════════════════
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.center_module_grants'::regclass)
                      and not has_table_privilege('authenticated', 'app.center_module_grants', 'insert')
                      and not has_table_privilege('authenticated', 'app.center_module_grants', 'update')
                      and not has_table_privilege('authenticated', 'app.center_module_grants', 'delete')
                      and not has_table_privilege('anon', 'app.center_module_grants', 'select')
                      and has_table_privilege('authenticated', 'app.center_module_grants', 'select'),
  'A · the grants table has RLS, signed-in people may only read it (through its policy), guests not at all');
select pg_temp.assert(exists (select 1 from pg_trigger t where t.tgrelid = 'app.center_module_grants'::regclass
                                and t.tgname = 'audit_center_module_grants' and not t.tgisinternal)
                      and exists (select 1 from app.module_tables where table_name = 'center_module_grants' and module_key is null),
  'A · every change of a grant is audited, and the table is core platform (never switched off)');
select pg_temp.assert('center_module_grants' <> all (app.demo_clear_tables())
                      and 'center_modules' <> all (app.demo_clear_tables())
                      and 'center_module_grants' = any (app.promotion_config_tables())
                      and array_position(app.promotion_config_tables(), 'center_module_grants') = array_position(app.promotion_config_tables(), 'center_modules') + 1,
  'A · a sandbox reset keeps the grants, and promotion copies them right after the community''s own switches');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._module_chain(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._module_granted(uuid, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._module_self_on(uuid, text, text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._module_label(uuid, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.set_module_grant(uuid, text, boolean, text)', 'execute')
                      and not has_function_privilege('anon', 'app.set_module_grant(uuid, text, boolean, text)', 'execute')
                      and not has_function_privilege('anon', 'app.module_states(uuid)', 'execute'),
  'A · the helpers are private; set_module_grant and module_states are for signed-in callers (who are checked inside)');
select pg_temp.assert((select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('set_module_grant', '_module_chain', '_module_granted', '_module_self_on',
                                                                  '_module_label', 'module_enabled', 'module_off_centers',
                                                                  'assert_module_enabled', 'set_module_enabled', 'module_states')),
  'A · every function of 0740 runs as the definer with the pinned search path');
select pg_temp.assert(app._module_chain('bolis') = array['giving', 'bolis'] and app._module_chain('people') = '{}'
                      and app._module_chain('niva') = array['content', 'niva'] and app._module_chain('nope') = '{}',
  'A · a module''s chain is itself and the non-core modules it needs, in catalog order (People is core, so never part of it)');

-- ══ B. Grandfathering ════════════════════════════════════════════════════════
-- Every community that existed before this test: a module it had switched on itself, where its kind starts the module off,
-- has a grant (the 0594 rule would otherwise have turned it off).
select pg_temp.assert(not exists (
    select 1 from app.center_modules x
      join app.centers c on c.id = x.center_id
      left join app.category_modules cm on cm.category_key = c.category_key and cm.module_key = x.module_key
     where x.enabled and cm.availability = 'default_off'
       and not exists (select 1 from app.center_module_grants g where g.center_id = x.center_id and g.module_key = x.module_key and g.granted)),
  'B · no community lost a module it had switched on itself');
select pg_temp.assert(not exists (select 1 from app.center_module_grants g join app.modules m on m.key = g.module_key where m.core),
  'B · no core module has a grant row (core is always on)');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:plat, 'plat150@platform.test'), (:chadmin, 'chadmin150@chamber.test'), (:chmember, 'chmember150@chamber.test'),
  (:jadmin, 'jadmin150@temple.test'), (:otheradmin, 'other150@club.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('15000000-0000-4000-8000-0000000000f1', :plat, 'Phone', 'totp', 'verified');
-- A chamber of commerce (not faith-based; its kind starts Store and Niva off), a Jain Center (every module starts on) and a
-- third community whose administrator must see nothing of the others.
insert into app.centers (id, slug, name, environment, category_key, status)
values (:chm, 'chm150-sandbox', 'Chamber 150', 'sandbox', 'chamber_of_commerce', 'onboarding');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:jc, 'jc150', 'Temple 150', 'T150', 'TX', 'active', 'America/Chicago'),
  (:oc, 'oc150', 'Other Club 150', 'O150', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:chm, :chadmin, 'center_admin', 'module grants test 150'), (:jc, :jadmin, 'center_admin', 'module grants test 150'),
  (:oc, :otheradmin, 'center_admin', 'module grants test 150');
insert into app.households (id, center_id, display_name) values (:h_chm, :chm, 'Member150, Cam');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_chm, :chm, 'Cam', 'Member150', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h_chm, :p_chm, :chm, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:chm, :chmember, :p_chm);
insert into app.store_categories (id, center_id, name) values (:storecat, :chm, 'Chamber store category 150');
insert into app.bolis (id, center_id, name, kind) values (:boli, :jc, 'Temple boli 150', 'digital');
select pg_temp.assert((select category_key from app.centers where id = :jc) = 'jain_center'
                      and not exists (select 1 from app.center_module_grants where center_id in (:chm, :jc, :oc)),
  'Fixtures · a new community has no grant rows: its kind''s default decides');

-- ══ C. A chamber of commerce ═════════════════════════════════════════════════
set role authenticated;
select pg_temp.claims(:chadmin, true);
select pg_temp.assert(not app.module_enabled(:chm, 'store') and app.module_enabled(:chm, 'giving') and app.module_enabled(:chm, 'events')
                      and (select count(*) from app.store_categories where center_id = :chm) = 0,
  'C · Store starts off for a chamber (not granted); the modules its kind starts on are on');
select pg_temp.assert((select not granted and not enabled and not paused and switchable and availability = 'default_off' and grant_reason is null
                         from app.module_states(:chm) where key = 'store')
                      and (select granted and enabled and not paused and label = 'Dues & payments' from app.module_states(:chm) where key = 'giving')
                      and (select granted and enabled and core from app.module_states(:chm) where key = 'people')
                      and (select not granted and not enabled from app.module_states(:chm) where key = 'bolis'),
  'C · module_states says Store is not granted, Giving (the chamber''s "Dues & payments") is, People is core, Bolis is not offered');
select pg_temp.assert_raises(format($$select app.set_module_enabled(%L, 'store', true, 'Open a store')$$, :chm),
  'Weaver has not enabled Store for this community', 'C · the chamber''s administrator cannot switch on a module Weaver has not enabled');
select pg_temp.assert(pg_temp.hint_of(format($$select app.set_module_enabled(%L, 'store', true, 'Open a store')$$, :chm)) = 'Ask Weaver to enable it.',
  'C · and is told who can');
select pg_temp.assert_raises(format($$select app.set_module_enabled(%L, 'store', false, 'Close it')$$, :chm),
  'so it is off already', 'C · nor switch it "off": it is off already');
select pg_temp.assert_raises(format($$select app.assert_module_enabled(%L, 'store')$$, :chm),
  'Weaver has not enabled Store for this community', 'C · the module''s functions refuse with the same sentence');
select pg_temp.assert_raises(format($$select app.assert_module_enabled(%L, 'bolis')$$, :chm),
  'Bolis is not part of a Chamber of commerce organization', 'C · a module the kind does not offer keeps its 0594 sentence');
select pg_temp.assert_raises(format($$select app.set_module_grant(%L, 'store', true, 'I would like a store')$$, :chm),
  'Only the Weaver team', 'C · a community''s administrator cannot grant');
select pg_temp.assert_raises(format($$insert into app.center_module_grants (center_id, module_key, granted, reason) values (%L, 'store', true, 'x')$$, :chm),
  'permission denied', 'C · nor write the grants table directly');
select pg_temp.assert((select count(*) from app.center_modules where center_id = :chm) = 0,
  'C · every refusal wrote nothing');
-- Not signed in, a platform admin without the fresh 2FA check, and the platform admin's own mistakes.
select pg_temp.no_claims();
select pg_temp.assert_raises(format($$select app.set_module_grant(%L, 'store', true, 'Job')$$, :chm),
  'Only the Weaver team', 'C · nobody signed in cannot grant');
select pg_temp.claims(:plat, false);
select pg_temp.assert_raises(format($$select app.set_module_grant(%L, 'store', true, 'The chamber asked for a store')$$, :chm),
  'fresh 2FA check', 'C · a platform admin needs a fresh 2FA check');
select pg_temp.claims(:plat, true);
select pg_temp.assert_raises(format($$select app.set_module_grant(%L, 'store', true, '   ')$$, :chm),
  'Give a reason for enabling Store', 'C · a reason is required');
select pg_temp.assert_raises(format($$select app.set_module_grant(%L, 'people', false, 'No people')$$, :chm),
  'part of the core platform', 'C · a core module cannot be disabled');
select pg_temp.assert_raises(format($$select app.set_module_grant(%L, 'bolis', true, 'Bolis please')$$, :chm),
  'not part of a Chamber of commerce organization, so it cannot be enabled', 'C · a module the kind does not offer cannot be enabled');
select pg_temp.assert_raises(format($$select app.set_module_grant(%L, 'nope', true, 'What')$$, :chm),
  'no module called', 'C · an unknown module is refused');
select pg_temp.assert_raises(format($$select app.set_module_grant(%L, 'giving', true, 'Again')$$, :chm),
  'already enabled', 'C · a grant that changes nothing is refused (the kind already grants Giving)');
-- Granted: on at once, readable, audited.
select pg_temp.assert((app.set_module_grant(:chm, 'store', true, 'The chamber asked for a store') - 'label')
                        = jsonb_build_object('module', 'store', 'granted', true, 'paused', false, 'enabled', true),
  'C · a platform admin grants Store: it is on at once');
select pg_temp.assert(app.module_enabled(:chm, 'store') and not (:chm::uuid = any (app.module_off_centers('store')))
                      and (select granted and enabled and not paused and granted_by = :plat and grant_reason = 'The chamber asked for a store'
                             from app.module_states(:chm) where key = 'store'),
  'C · module_enabled, module_off_centers and module_states agree, with who granted it and why');
select pg_temp.assert(exists (select 1 from app.audit_log a where a.record_table = 'center_module_grants' and a.center_id = :chm
                                and a.record_id = :chm || ':store' and a.actor_user_id = :plat
                                and a.reason = 'The chamber asked for a store' and a.after->>'granted' = 'true'),
  'C · the grant is in the audit log with its reason and who made it');
select pg_temp.assert_raises(format($$select app.set_module_grant(%L, 'store', true, 'Again')$$, :chm),
  'Store is already enabled', 'C · granting it again changes nothing and says so');
-- Who reads the grants.
select pg_temp.claims(:chadmin, true);
select pg_temp.assert((select count(*) from app.center_module_grants where center_id = :chm) = 1
                      and (select count(*) from app.store_categories where center_id = :chm) = 1
                      and (select enabled from app.my_modules(:chm) where key = 'store'),
  'C · the chamber''s administrator reads its grant, and Store''s rows; my_modules says on');
select pg_temp.claims(:chmember, true);
select pg_temp.assert((select count(*) from app.center_module_grants) = 0 and (select enabled from app.my_modules(:chm) where key = 'store')
                      and not (select enabled from app.my_modules(:chm) where key = 'niva'),
  'C · a member reads no grants, but my_modules tells the app what is on (Store) and off (Niva, never granted)');
select pg_temp.claims(:otheradmin, true);
select pg_temp.assert((select count(*) from app.center_module_grants where center_id = :chm) = 0,
  'C · another community''s administrator reads nothing of the chamber''s grants');
select pg_temp.assert_raises(format($$select * from app.module_states(%L)$$, :chm), 'have access to this community''s modules',
  'C · nor its module states');
-- The community pauses and resumes what is granted.
select pg_temp.claims(:chadmin, true);
select app.set_module_enabled(:chm, 'store', false, 'Closed for the winter');
select pg_temp.assert(not app.module_enabled(:chm, 'store') and :chm::uuid = any (app.module_off_centers('store'))
                      and (select count(*) from app.store_categories where center_id = :chm) = 0
                      and (select granted and paused and not enabled and changed_by = :chadmin from app.module_states(:chm) where key = 'store'),
  'C · the chamber pauses Store: off, its rows hidden, still granted');
select pg_temp.assert_raises(format($$select app.assert_module_enabled(%L, 'store')$$, :chm),
  'module is switched off for this community', 'C · a paused module keeps the 0594 sentence');
select app.set_module_enabled(:chm, 'store', true, 'Open again');
select pg_temp.assert(app.module_enabled(:chm, 'store') and (select count(*) from app.store_categories where center_id = :chm) = 1,
  'C · and resumes it');
-- A revoke wins over the community's switch; a new grant brings back the community's own choice.
select app.set_module_enabled(:chm, 'store', false, 'Closed again');
select pg_temp.claims(:plat, true);
select pg_temp.assert((app.set_module_grant(:chm, 'store', false, 'The trial ended') - 'label')
                        = jsonb_build_object('module', 'store', 'granted', false, 'paused', true, 'enabled', false),
  'C · Weaver disables Store');
select pg_temp.claims(:chadmin, true);
select pg_temp.assert_raises(format($$select app.set_module_enabled(%L, 'store', true, 'Open please')$$, :chm),
  'Weaver has not enabled Store', 'C · the chamber cannot switch a disabled module back on');
select pg_temp.claims(:plat, true);
select app.set_module_grant(:chm, 'store', true, 'Trial extended');
select pg_temp.assert(not app.module_enabled(:chm, 'store')
                      and (select granted and paused and not enabled from app.module_states(:chm) where key = 'store'),
  'C · enabled again, Store stays paused: the community''s own switch was kept');
select pg_temp.claims(:chadmin, true);
select app.set_module_enabled(:chm, 'store', true, 'Open for the trial');
select pg_temp.assert(app.module_enabled(:chm, 'store'), 'C · and the chamber switches it on when it wants');
-- A platform admin cannot use the community's switch to get round the grant either.
select pg_temp.claims(:plat, true);
select pg_temp.assert_raises(format($$select app.set_module_enabled(%L, 'niva', true, 'Turn it on')$$, :chm),
  'Weaver has not enabled Niva', 'C · a platform admin also has to grant first; the switch is the community''s');
select pg_temp.assert(app.assert_module_enabled(:chm, 'niva'), 'C · platform admins still pass the module functions, as in RLS');

-- ══ D. Dependencies are evaluated ════════════════════════════════════════════
select pg_temp.claims(:jadmin, true);
select pg_temp.assert(app.module_enabled(:jc, 'giving') and app.module_enabled(:jc, 'bolis') and app.module_enabled(:jc, 'accounting')
                      and (select count(*) from app.bolis where center_id = :jc) = 1,
  'D · a Jain Center starts with Giving, Bolis and Accounting on');
select app.set_module_enabled(:jc, 'giving', false, 'Giving moves to the new system');
select pg_temp.assert(not app.module_enabled(:jc, 'giving') and not app.module_enabled(:jc, 'bolis') and not app.module_enabled(:jc, 'accounting')
                      and :jc::uuid = any (app.module_off_centers('bolis')) and :jc::uuid = any (app.module_off_centers('accounting'))
                      and (select count(*) from app.bolis where center_id = :jc) = 0,
  'D · the community pauses Giving in ONE step while Bolis and Accounting are on: all three are off and Bolis'' rows are hidden');
select pg_temp.assert((select not enabled and not paused and granted and waiting_for = array['giving'] from app.module_states(:jc) where key = 'bolis')
                      and (select not enabled and paused and waiting_for = '{}' from app.module_states(:jc) where key = 'giving')
                      and (select not enabled from app.my_modules(:jc) where key = 'accounting'),
  'D · module_states says Bolis is not paused itself but waits for Giving; my_modules reports Accounting off');
select pg_temp.assert_raises(format($$select app.assert_module_enabled(%L, 'bolis')$$, :jc),
  'Bolis is off because', 'D · a Bolis function says it is off because of Giving');
select pg_temp.assert(pg_temp.hint_of(format($$select app.assert_module_enabled(%L, 'bolis')$$, :jc)) = 'Settings › Modules shows why.',
  'D · and where to look');
select app.set_module_enabled(:jc, 'bolis', false, 'Bolis on paper this year');
select app.set_module_enabled(:jc, 'bolis', true, 'Bolis back');
select pg_temp.assert(not app.module_enabled(:jc, 'bolis'),
  'D · switching Bolis on while Giving is paused is allowed and changes nothing until Giving is on');
select app.set_module_enabled(:jc, 'giving', true, 'Back on');
select pg_temp.assert(app.module_enabled(:jc, 'giving') and app.module_enabled(:jc, 'bolis') and app.module_enabled(:jc, 'accounting')
                      and not (:jc::uuid = any (app.module_off_centers('bolis')))
                      and (select count(*) from app.bolis where center_id = :jc) = 1,
  'D · Giving back on brings Bolis and Accounting back as they were');
select pg_temp.claims(:plat, true);
select app.set_module_grant(:jc, 'giving', false, 'Test: Giving disabled by Weaver');
select pg_temp.assert(not app.module_enabled(:jc, 'bolis') and not app.module_enabled(:jc, 'accounting')
                      and (select waiting_for = array['giving'] and granted and not paused from app.module_states(:jc) where key = 'accounting'),
  'D · Weaver disabling Giving turns its dependants off too, and they keep their own grant and switch');
select app.set_module_grant(:jc, 'giving', true, 'Test: Giving enabled again');
select pg_temp.assert(app.module_enabled(:jc, 'bolis') and app.module_enabled(:jc, 'accounting'),
  'D · and enabling it again brings them back');

-- ══ E. The preview of a change of kind ═══════════════════════════════════════
select app.category_change_preview(:jc, 'chamber_of_commerce') as preview \gset
select pg_temp.assert((select h->>'text' from jsonb_array_elements(:'preview'::jsonb->'hidden') h where h->>'module' = 'niva')
                        = 'Niva assistant: nothing is stored yet, so nothing is hidden; Weaver can enable it again.'
                      and (select h->>'becomes' from jsonb_array_elements(:'preview'::jsonb->'hidden') h where h->>'module' = 'store') = 'off',
  'E · as a chamber, the Jain Center''s Niva and Store would wait for Weaver (no grant: the chamber''s kind starts them off)');
select app.category_change_preview(:chm, 'nonprofit_secular') as preview2 \gset
select pg_temp.assert(not exists (select 1 from jsonb_array_elements(:'preview2'::jsonb->'hidden') h where h->>'module' = 'store'),
  'E · the chamber''s granted Store stays on under another kind that starts it off (Weaver''s grant is kept)');

reset role;
select pg_temp.no_claims();
rollback;
\echo 'PASS: module grants tests'
