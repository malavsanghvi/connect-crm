-- 0750 and 0751: the Marketplace products as modules (docs/MARKETPLACE_PACKS.md, docs/WECARE.md, docs/CATCH_THE_MATCH.md).
--   A. The catalog: five neutral keys with brand labels, off for every kind (P5: the 0594 trigger would have made them on for a
--      Jain Center), WeCare named by the kind, Niva behind iWeaver, trials marked by a column, the helpers private.
--   B. Grandfathering by ACTUAL use, replayed on test communities: a Niva question, Niva for admins on, Niva switched on or
--      paused by the community, AI flyer art (a finished job, an event) in the last 90 days; older use, no use; a WhatsApp
--      account; a website draft; a sandbox WITH use (the permanent grant: use beats sandbox status). The check compares with
--      the intended new state (Niva off exactly where no AI was used), records who loses Niva, and fails closed when anything
--      else would differ.
--   C. The sandbox trial (sandboxes with no use): _marketplace_sandbox_trial for an existing sandbox; a person's grant is never
--      a trial; real promotions (worker_promote_sandbox, promotion_copy_table): a sandbox with no use loses its trial in
--      production (the owner is emailed in plain words), a sandbox with use keeps iWeaver; an in-place go-live the same way;
--      the product history names a promotion's copies.
--   D. The gates: Niva is off wherever iWeaver is; the website draft functions need WeaverSite; the WhatsApp Business
--      functions and the send-time check need Weaver Connect; the tables belong to their product; WhatsApp group links stay
--      in Communications.
-- Nothing here relies on the seed community's own grant. Everything runs in one transaction that is rolled back.
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
grant connect_worker to postgres;

\set FIVE 'array[''ai'', ''website'', ''channels'', ''care'', ''matching'']'
\set FIX 'array[''gq160'', ''gd160'', ''gc160'', ''ga160'', ''gj160'', ''go160'', ''gx160'', ''gp160'', ''gw160'', ''gs160'', ''gb160-sandbox'']'
\set g_q '''16000000-0000-4000-8000-0000000000c1'''
\set g_admin '''16000000-0000-4000-8000-0000000000c2'''
\set g_chose '''16000000-0000-4000-8000-0000000000c3'''
\set g_art '''16000000-0000-4000-8000-0000000000c4'''
\set g_job '''16000000-0000-4000-8000-0000000000c5'''
\set g_old '''16000000-0000-4000-8000-0000000000c6'''
\set g_none '''16000000-0000-4000-8000-0000000000c7'''
\set g_paused '''16000000-0000-4000-8000-0000000000c8'''
\set g_wa '''16000000-0000-4000-8000-0000000000ca'''
\set g_site '''16000000-0000-4000-8000-0000000000cb'''
\set g_sbx '''16000000-0000-4000-8000-0000000000cc'''
\set sbx_a '''16000000-0000-4000-8000-0000000000d1'''
\set sbx_p '''16000000-0000-4000-8000-0000000000d2'''
\set sbx_c '''16000000-0000-4000-8000-0000000000d3'''
\set admin '''16000000-0000-4000-8000-000000000001'''
\set owner '''16000000-0000-4000-8000-000000000002'''
\set plat '''16000000-0000-4000-8000-000000000003'''

-- ══ A. The catalog ═══════════════════════════════════════════════════════════
select pg_temp.assert((select array_agg(key || '=' || label || ':' || array_to_string(depends_on, ',') order by sort)
                         from app.modules where key = any (:FIVE))
                        = array['ai=iWeaver:', 'website=WeaverSite:people', 'channels=Weaver Connect:comms', 'care=DonorDelight:people',
                                'matching=CatchTheMatch:giving']
                      and not exists (select 1 from app.modules where key = any (:FIVE) and core),
  'A · five products join the catalog with neutral keys and brand labels, none core, each needing what the plan says');
select pg_temp.assert(not exists (select 1 from app.category_modules where module_key = any (:FIVE) and availability <> 'default_off')
                      and (select count(*) from app.category_modules where module_key = any (:FIVE))
                          = 5 * (select count(*) from app.organization_categories),
  'A · every kind of organization starts each of them off (P5), the Jain Center included');
select pg_temp.assert(not exists (
    select 1 from app.category_modules cm join app.organization_categories k on k.key = cm.category_key
     where cm.module_key = 'care' and cm.label is distinct from case when k.faith_based then 'Member care' else 'Donor care' end)
                      and (select label from app.category_modules where category_key = 'jain_center' and module_key = 'care') = 'Member care'
                      and (select label from app.category_modules where category_key = 'chamber_of_commerce' and module_key = 'care') = 'Donor care',
  'A · WeCare is "Member care" for a faith kind and "Donor care" for every other kind, from the kind''s own data');
select pg_temp.assert((select depends_on from app.modules where key = 'niva') = '{content,ai}'
                      and app._module_chain('niva') = array['content', 'niva', 'ai'],
  'A · Niva needs iWeaver: its chain is Content, Niva and iWeaver');
select pg_temp.assert(exists (select 1 from pg_attribute where attrelid = 'app.center_module_grants'::regclass and attname = 'is_trial'
                                and atttypid = 'boolean'::regtype and attnotnull and not attisdropped),
  'A · a trial is marked by a column (is_trial), never by its reason');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._marketplace_grandfather()', 'execute')
                      and not has_function_privilege('authenticated', 'app._marketplace_sandbox_trial()', 'execute')
                      and not has_function_privilege('authenticated', 'app._marketplace_ai_use(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app._marketplace_0750_problems(text[])', 'execute')
                      and not has_function_privilege('anon', 'app._ai_trial_reason()', 'execute')
                      and (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'app' and p.proname in ('_marketplace_grandfather', '_marketplace_sandbox_trial', '_marketplace_ai_use',
                                                                      '_marketplace_open_sandbox', '_marketplace_0750_problems',
                                                                      '_marketplace_record_niva_off', 'centers_ai_trial',
                                                                      'center_module_grants_trial_rule', 'center_module_grants_trial_mark',
                                                                      'centers_ai_trial_end', 'sandbox_promotions_trial_notice')),
  'A · the helpers are private and run as the definer with the pinned search path');

-- ══ B. Grandfathering by actual use ══════════════════════════════════════════
-- Eleven communities. All are Jain Centers, so Niva starts on for each by its kind: the kind's default is not use.
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, rules) values
  (:g_q,      'gq160', 'Question 160', 'GQ', 'TX', 'active', 'America/Chicago', '{}'),
  (:g_admin,  'gd160', 'Admin Niva 160', 'GD', 'TX', 'active', 'America/Chicago', '{"assistant":{"enabled":true}}'),
  (:g_chose,  'gc160', 'Chose Niva 160', 'GC', 'TX', 'active', 'America/Chicago', '{}'),
  (:g_art,    'ga160', 'Art 160',    'GA', 'TX', 'active', 'America/Chicago', '{}'),
  (:g_job,    'gj160', 'Job 160',    'GJ', 'TX', 'active', 'America/Chicago', '{}'),
  (:g_old,    'go160', 'Old 160',    'GO', 'TX', 'active', 'America/Chicago', '{}'),
  (:g_none,   'gx160', 'None 160',   'GX', 'TX', 'active', 'America/Chicago', '{}'),
  (:g_paused, 'gp160', 'Paused 160', 'GP', 'TX', 'active', 'America/Chicago', '{}'),
  (:g_wa,     'gw160', 'WhatsApp 160', 'GW', 'TX', 'active', 'America/Chicago', '{}'),
  (:g_site,   'gs160', 'Site 160',   'GS', 'TX', 'active', 'America/Chicago', '{}');
insert into app.centers (id, slug, name, environment, category_key, status) values
  (:g_sbx, 'gb160-sandbox', 'Sandbox 160', 'sandbox', 'jain_center', 'onboarding');
insert into app.niva_conversations (center_id, question, created_at) values
  (:g_q, 'When is the temple open?', now() - interval '10 days'),
  (:g_old, 'When is the temple open?', now() - interval '120 days'),
  (:g_sbx, 'When is the temple open?', now() - interval '1 day');
insert into app.center_modules (center_id, module_key, enabled, reason) values
  (:g_chose, 'niva', true, 'Test 160: switched on by the community'),
  (:g_paused, 'niva', false, 'Test 160: paused');
insert into app.events (id, center_id, name, status, audience, confidential, flyer_source, flyer_generated_at) values
  ('16000000-0000-4000-8000-0000000000e1', :g_art, 'Art 160 event', 'published', 'public', false, 'ai', now() - interval '30 days'),
  ('16000000-0000-4000-8000-0000000000e2', :g_old, 'Old 160 event', 'published', 'public', false, 'ai', now() - interval '120 days');
insert into app.jobs (center_id, kind, payload, status, finished_at) values
  (:g_job, 'events.generate_flyer', '{}', 'done', now() - interval '10 days'),
  (:g_old, 'events.generate_flyer', '{}', 'done', now() - interval '120 days'),
  (:g_none, 'events.generate_flyer', '{}', 'failed', now() - interval '1 day');
insert into app.whatsapp_accounts (center_id, display_name, status) values (:g_wa, 'WhatsApp 160', 'pending_meta');
insert into app.sites (center_id, name) values (:g_site, 'Site 160');
select pg_temp.assert(not exists (select 1 from app.center_module_grants g join app.centers c on c.id = g.center_id
                                   where c.slug = any (:FIX) and g.module_key = any (:FIVE) and not (c.slug = 'gb160-sandbox' and g.is_trial)),
  'B · a community created after 0750 holds none of the products; a new sandbox holds only the iWeaver trial');
-- As before 0750, when no community held a row for any of the products.
delete from app.center_module_grants where center_id = :g_sbx and module_key = 'ai';

-- What each community saw under the rules before 0750 (Niva needing Content only), for the snapshot only.
savepoint before_0750;
update app.modules set depends_on = '{content}' where key = 'niva';
select app._module_on_snapshot() as on_before \gset
rollback to savepoint before_0750;
select pg_temp.assert((select count(*) from unnest(:'on_before'::text[]) x
                        where x in (:g_q || ':niva', :g_none || ':niva', :g_wa || ':niva', :g_old || ':niva', :g_sbx || ':niva')) = 5
                      and not ((:g_paused || ':niva') = any (:'on_before'::text[])),
  'B · before 0750, Niva was on in each of them by the kind''s default, except where the community paused it');
select pg_temp.assert(coalesce((select array_agg(x order by x) from unnest(app._marketplace_0750_problems(:'on_before'::text[])) x
                                 where split_part(x, ':', 1) = any (:FIX)), '{}')
                        = array['ga160: ai would be off', 'ga160: niva would be off', 'gb160-sandbox: ai would be off', 'gb160-sandbox: niva would be off',
                                'gc160: ai would be off', 'gc160: niva would be off', 'gd160: ai would be off', 'gd160: niva would be off',
                                'gj160: ai would be off', 'gj160: niva would be off', 'gp160: ai would be off',
                                'gq160: ai would be off', 'gq160: niva would be off', 'gs160: website would be off', 'gw160: channels would be off'],
  'B · without grants, the check names in words every community that would not be as intended (it fails closed)');

select app._marketplace_grandfather() as added \gset
select pg_temp.assert((select array_agg(c.slug::text || ':' || g.module_key || case when g.is_trial then ' (trial)' else '' end
                                        order by c.slug, g.module_key)
                         from app.center_module_grants g join app.centers c on c.id = g.center_id
                        where c.slug = any (:FIX) and g.module_key = any (:FIVE) and g.granted)
                        = array['ga160:ai', 'gb160-sandbox:ai', 'gc160:ai', 'gd160:ai', 'gj160:ai', 'gp160:ai', 'gq160:ai', 'gs160:website', 'gw160:channels']
                      and :'added'::int >= 9,
  'B · iWeaver only where AI was used (a question, Niva for admins, Niva switched on or paused, flyer art), a sandbox with use included (permanent, not a trial), never by the kind''s default or old use; Weaver Connect and WeaverSite where used');
select pg_temp.assert((select reason like 'Grandfathered (0750): Niva answered questions%' and granted_by is null and not is_trial
                         from app.center_module_grants where center_id = :g_q and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750): Niva for admins%' from app.center_module_grants where center_id = :g_admin and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750): this community had switched Niva on or paused it itself%' from app.center_module_grants where center_id = :g_chose and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750): this community had switched Niva on or paused it itself%' from app.center_module_grants where center_id = :g_paused and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750): Niva answered questions%' and not is_trial and granted_by is null
                             from app.center_module_grants where center_id = :g_sbx and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750): AI flyer art%' from app.center_module_grants where center_id = :g_art and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750): AI flyer art%' from app.center_module_grants where center_id = :g_job and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750)%WhatsApp Business account%' from app.center_module_grants where center_id = :g_wa and module_key = 'channels')
                      and (select reason like 'Grandfathered (0750)%website draft%' from app.center_module_grants where center_id = :g_site and module_key = 'website'),
  'B · each grant says which use kept it, with no person behind it');
select pg_temp.assert(coalesce((select array_agg(x order by x) from unnest(app._marketplace_0750_problems(:'on_before'::text[])) x
                                 where split_part(x, ':', 1) = any (:FIX)), '{}') = '{}',
  'B · and now every one of them is as intended: Niva off exactly where no AI was used, everything else as before');
select pg_temp.assert(app.module_enabled(:g_q, 'niva') and app.module_enabled(:g_admin, 'niva') and app.module_enabled(:g_chose, 'niva')
                      and app.module_enabled(:g_sbx, 'niva')
                      and not app.module_enabled(:g_none, 'niva') and not app.module_enabled(:g_old, 'niva')
                      and not app.module_enabled(:g_wa, 'niva') and not app.module_enabled(:g_paused, 'niva') and app.module_enabled(:g_paused, 'ai')
                      and app.module_enabled(:g_wa, 'channels') and app.module_enabled(:g_site, 'website')
                      and not app.module_enabled(:g_none, 'website') and not app.module_enabled(:g_none, 'channels')
                      and not app.module_enabled(:g_none, 'care') and not app.module_enabled(:g_none, 'matching'),
  'B · Niva stays on where AI was used (the sandbox with use too), stays paused where the community paused it, and goes off where only the kind''s default had it on');
update app.center_modules set enabled = true, reason = 'Test 160: resumed' where center_id = :g_paused and module_key = 'niva';
select pg_temp.assert(app.module_enabled(:g_paused, 'niva'),
  'B · a Niva the community had paused comes back when it resumes it (its explicit choice earned the grant)');
update app.center_modules set enabled = false, reason = 'Test 160: paused again' where center_id = :g_paused and module_key = 'niva';
-- Who loses Niva is recorded, one audit entry per community, and named.
select app._marketplace_record_niva_off(:'on_before'::text[]) as niva_off \gset
select pg_temp.assert((select array_agg(x order by x) from unnest(:'niva_off'::text[]) x where x = any (:FIX)) = array['go160', 'gs160', 'gw160', 'gx160']
                      and (select count(*) from app.audit_log where center_id = :g_none and action = 'marketplace.niva_off'
                              and reason like 'Niva needs iWeaver since the Marketplace packs (0750)%') = 1
                      and not exists (select 1 from app.audit_log where center_id in (:g_q, :g_sbx, :g_paused) and action = 'marketplace.niva_off'),
  'B · the communities whose Niva goes off are named and each gets an audit entry saying why; nobody else does');
-- Fail-closed: a state that is not the intended one stops the migration, in words.
savepoint mismatch;
update app.center_module_grants set granted = false where center_id = :g_q and module_key = 'ai';
insert into app.center_modules (center_id, module_key, enabled, reason) values (:g_none, 'events', false, 'Test 160: a mismatch');
select pg_temp.assert((select array_agg(x order by x) from unnest(app._marketplace_0750_problems(:'on_before'::text[])) x
                        where split_part(x, ':', 1) = any (:FIX))
                        = array['gq160: ai would be off', 'gq160: niva would be off', 'gx160: events would be off'],
  'B · forced mismatches (iWeaver lost where used, Events changed elsewhere) are each named, so 0750 would stop');
rollback to savepoint mismatch;
select pg_temp.assert(app._marketplace_grandfather() = 0, 'B · running the grandfathering again adds nothing');

-- ══ C. The sandbox trial ═════════════════════════════════════════════════════
insert into auth.users (id, email) values (:admin, 'admin160@club.test'), (:owner, 'owner160@club.test'), (:plat, 'plat160@weaver.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, environment, category_key, status) values
  (:sbx_a, 'sbxa160-sandbox', 'Sandbox A 160', 'sandbox', 'jain_center', 'onboarding'),
  (:sbx_p, 'sbxp160-sandbox', 'Sandbox P 160', 'sandbox', 'jain_center', 'onboarding');
select pg_temp.assert((select granted and is_trial and granted_by is null and reason = app._ai_trial_reason()
                         from app.center_module_grants where center_id = :sbx_a and module_key = 'ai')
                      and app.module_enabled(:sbx_a, 'ai') and app.module_enabled(:sbx_a, 'niva'),
  'C · a new sandbox starts with the iWeaver trial, so Niva works there as it does for every prospect');
-- _marketplace_sandbox_trial for sandboxes that existed before: an open one gets the trial, a promoted one and production do not.
delete from app.center_module_grants where center_id in (:sbx_a, :sbx_p) and module_key = 'ai';
update app.centers set sandbox_for = :g_none where id = :sbx_p;
select app._marketplace_sandbox_trial() as trials \gset
select pg_temp.assert(:'trials'::int >= 1
                      and (select is_trial and granted from app.center_module_grants where center_id = :sbx_a and module_key = 'ai')
                      and not exists (select 1 from app.center_module_grants where center_id = :sbx_p and module_key = 'ai')
                      and not exists (select 1 from app.center_module_grants where center_id = :g_none and module_key = 'ai')
                      and app._marketplace_sandbox_trial() = 0,
  'C · an existing open sandbox gets the trial; a promoted sandbox and a production community do not; running it again adds nothing');
-- A person's grant is never a trial.
update app.center_module_grants set granted_by = :plat, reason = 'Weaver turned it on', granted_at = now()
 where center_id = :sbx_a and module_key = 'ai';
select pg_temp.assert((select not is_trial from app.center_module_grants where center_id = :sbx_a and module_key = 'ai'),
  'C · once a platform admin makes the grant, it is no longer a trial (and so it would carry over)');

-- A real promotion by copy (worker_promote_sandbox, promotion_copy_table): the sandbox has its trial and a grant Weaver made.
insert into app.centers (id, slug, name, short_name, environment, category_key, status) values
  (:sbx_c, 'prodc160-sandbox', 'Copy Temple 160', 'CT160', 'sandbox', 'jain_center', 'onboarding');
insert into app.center_owners (center_id, user_id) values (:sbx_c, :owner);
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by)
values (:sbx_c, 'website', true, 'Test 160: Weaver turned on WeaverSite', :plat);
insert into app.golive_requests (id, center_id, requested_by, status, first_approver, first_approved_at, second_approver, second_approved_at)
values ('16000000-0000-4000-8000-0000000000f1', :sbx_c, :owner, 'approved', :plat, now(), :admin, now());
select pg_temp.assert((select is_trial and granted from app.center_module_grants where center_id = :sbx_c and module_key = 'ai'),
  'C · the sandbox to promote holds the trial');
set local role authenticated;
select pg_temp.claims(:owner, true);
select app.promote_sandbox(:sbx_c, 'prodc160', 'Test 160: go live') as promotion \gset
reset role;
select pg_temp.no_claims();
set local role connect_worker;
select app.worker_promote_sandbox(:'promotion') as promoted \gset
reset role;
select pg_temp.no_claims();
select id as prodc from app.centers where slug = 'prodc160' \gset
select pg_temp.assert((select environment = 'production' and status = 'onboarding' from app.centers where id = :'prodc')
                      and (select not granted and is_trial and reason = app._ai_trial_ended_reason()
                             from app.center_module_grants where center_id = :'prodc' and module_key = 'ai')
                      and not app.module_enabled(:'prodc', 'ai') and not app.module_enabled(:'prodc', 'niva')
                      and (select granted and not is_trial and granted_by = :plat from app.center_module_grants where center_id = :'prodc' and module_key = 'website'),
  'C · the copy never carries the trial to production (it arrives off, saying why), while a grant Weaver made is copied');
select pg_temp.assert((select result->>'ai_trial_notice' = 'queued' from app.sandbox_promotions where id = :'promotion')
                      and (select count(*) from app.messages where template_key = 'marketplace_trial_ended' and to_address = 'owner160@club.test') = 1
                      and (select body like '%Copy Temple 160 has moved from its sandbox to production.%request it in Settings › Marketplace%'
                                  and body not like '%is live%'
                             from app.messages where template_key = 'marketplace_trial_ended' and to_address = 'owner160@club.test'),
  'C · the owner who promoted is emailed in plain words what happened (not "live": the copy starts onboarding), and the promotion records it');
select pg_temp.claims(:plat);
select pg_temp.assert(exists (select 1 from app.marketplace_audit(:'prodc') where what = 'iWeaver trial ended: the sandbox was promoted')
                      and exists (select 1 from app.marketplace_audit(:'prodc') where what = 'WeaverSite copied from the sandbox when it was promoted')
                      and not exists (select 1 from app.marketplace_audit(:'prodc') where what like '%included by a migration%'),
  'C · the product history names a promotion''s copies as such, not as a migration''s');
select pg_temp.no_claims();
-- A sandbox with use promoted by copy keeps iWeaver in production (its grant is not a trial, so it is copied as it is).
insert into app.centers (id, slug, name, short_name, environment, category_key, status) values
  ('16000000-0000-4000-8000-0000000000d4', 'produ160-sandbox', 'Use Temple 160', 'UT160', 'sandbox', 'jain_center', 'onboarding');
insert into app.center_owners (center_id, user_id) values ('16000000-0000-4000-8000-0000000000d4', :owner);
insert into app.niva_conversations (center_id, question, created_at) values ('16000000-0000-4000-8000-0000000000d4', 'Opening hours?', now() - interval '5 days');
delete from app.center_module_grants where center_id = '16000000-0000-4000-8000-0000000000d4' and module_key = 'ai';
select app._marketplace_grandfather() as added_u \gset
insert into app.golive_requests (id, center_id, requested_by, status, first_approver, first_approved_at, second_approver, second_approved_at)
values ('16000000-0000-4000-8000-0000000000f2', '16000000-0000-4000-8000-0000000000d4', :owner, 'approved', :plat, now(), :admin, now());
set local role authenticated;
select pg_temp.claims(:owner, true);
select app.promote_sandbox('16000000-0000-4000-8000-0000000000d4', 'produ160', 'Test 160: go live with use') as promotion_u \gset
reset role;
select pg_temp.no_claims();
set local role connect_worker;
select app.worker_promote_sandbox(:'promotion_u') as promoted_u \gset
reset role;
select pg_temp.no_claims();
select id as produ from app.centers where slug = 'produ160' \gset
select pg_temp.assert((select granted and not is_trial and reason like 'Grandfathered (0750): Niva answered questions%'
                         from app.center_module_grants where center_id = :'produ' and module_key = 'ai')
                      and app.module_enabled(:'produ', 'ai') and app.module_enabled(:'produ', 'niva')
                      and (select result->'ai_trial_notice' is null from app.sandbox_promotions where id = :'promotion_u')
                      and (select count(*) from app.messages where template_key = 'marketplace_trial_ended' and to_address = 'owner160@club.test') = 1,
  'C · a sandbox that used AI keeps iWeaver (and Niva) through a promotion by copy, and nobody is told of a trial ending');
select pg_temp.claims(:plat);
select pg_temp.assert(exists (select 1 from app.marketplace_audit(:'produ') where what = 'iWeaver copied from the sandbox when it was promoted'),
  'C · and the history says the grant was copied by the promotion');
select pg_temp.no_claims();
-- Going live in place: the sandbox with use keeps iWeaver; a sandbox with no use has its trial turned off.
insert into app.centers (id, slug, name, environment, category_key, status) values
  ('16000000-0000-4000-8000-0000000000d5', 'sbxn160-sandbox', 'Sandbox N 160', 'sandbox', 'jain_center', 'onboarding');
update app.centers set environment = 'production' where id in (:g_sbx, '16000000-0000-4000-8000-0000000000d5');
select pg_temp.assert((select granted and not is_trial from app.center_module_grants where center_id = :g_sbx and module_key = 'ai')
                      and app.module_enabled(:g_sbx, 'niva')
                      and (select not granted and is_trial and reason = app._ai_trial_ended_reason()
                             from app.center_module_grants where center_id = '16000000-0000-4000-8000-0000000000d5' and module_key = 'ai')
                      and not app.module_enabled('16000000-0000-4000-8000-0000000000d5', 'niva'),
  'C · going live in place: the sandbox that used AI keeps iWeaver and Niva; the one that did not has its trial turned off');

-- ══ D. The gates ═════════════════════════════════════════════════════════════
select pg_temp.assert(not app.module_enabled(:g_none, 'ai') and not app.module_enabled(:g_none, 'niva')
                      and :g_none::uuid = any (app.module_off_centers('niva'))
                      and :g_none::uuid = any (app.module_off_centers('ai')),
  'D · where iWeaver is off, Niva reads off everywhere: module_enabled (which my_modules and member_experience read, so installed apps hide it) and the policies'' set');
-- A Jain Center created now: Niva is granted by its kind, iWeaver is not.
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  ('16000000-0000-4000-8000-0000000000c9', 'gy160', 'Fresh 160', 'GY', 'TX', 'active', 'America/Chicago');
select pg_temp.assert_raises($$select app.assert_module_enabled('16000000-0000-4000-8000-0000000000c9', 'niva')$$,
  'AI features are part of iWeaver, which is not on for your community.', 'D · and the RPC guard says why in plain words (the iWeaver sentence, 0755)');

insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:g_none, :admin, 'center_admin', 'Test 160'), (:g_site, :admin, 'center_admin', 'Test 160'), (:g_wa, :admin, 'center_admin', 'Test 160');
select pg_temp.claims(:admin);
select pg_temp.assert_raises(format($$select app.site_draft_get(%L, false)$$, :g_none),
  'Weaver has not enabled WeaverSite for this community.', 'D · the website draft is refused where WeaverSite is not on');
select pg_temp.assert_raises(format($$select app.site_draft_data(%L)$$, :g_none),
  'Weaver has not enabled WeaverSite', 'D · and so is the data it is built from');
select pg_temp.assert_raises(format($$select app.site_page_set_status(%L, gen_random_uuid(), 'approved')$$, :g_none),
  'Weaver has not enabled WeaverSite', 'D · and approving a page');
select pg_temp.assert_raises(format($$select app.site_draft_save(%L, '{}'::jsonb)$$, :g_none),
  'Weaver has not enabled WeaverSite', 'D · and saving a draft');
select pg_temp.assert((app.site_draft_get(:g_site, false)->'site'->>'name') = 'Site 160',
  'D · where WeaverSite is on (grandfathered), the draft reads as before');
select pg_temp.assert_raises(format($$select app.save_whatsapp_account(%L, null, null, 'None 160', '+1 713 555 0160', 'Test')$$, :g_none),
  'Weaver has not enabled Weaver Connect for this community.', 'D · a WhatsApp Business account needs Weaver Connect');
select pg_temp.assert_raises(format($$select app.submit_whatsapp_template(%L, 'hello', 'en', 'utility', 'Hi', 'Test')$$, :g_none),
  'Weaver has not enabled Weaver Connect', 'D · so does a WhatsApp template');
select pg_temp.assert_raises(format($$select app.send_test_message(%L, 'whatsapp', '+17135550160')$$, :g_none),
  'Weaver has not enabled Weaver Connect', 'D · and a WhatsApp test message');
select pg_temp.no_claims();
-- Send time: a WhatsApp message queued before the product went off is not sent, and says why.
insert into app.messages (id, center_id, to_address, channel, body, purpose, status) values
  ('16000000-0000-4000-8000-0000000000a1', :g_none, '+17135550160', 'whatsapp', 'Hello', 'receipt', 'queued'),
  ('16000000-0000-4000-8000-0000000000a2', :g_wa, '+17135550161', 'whatsapp', 'Hello', 'receipt', 'queued');
set local role connect_worker;
select pg_temp.assert((app.worker_message_to_send('16000000-0000-4000-8000-0000000000a1')->>'skip')
                        = 'Not sent: WhatsApp messages are part of Weaver Connect, which is not on for this community.'
                      and (app.worker_message_to_send('16000000-0000-4000-8000-0000000000a2')->>'skip') is null,
  'D · at send time a WhatsApp message needs Weaver Connect: not sent, with the reason, where it is off; sent where it is on');
reset role;

select pg_temp.assert((select array_agg(table_name || '=' || module_key order by table_name) from app.module_tables
                        where table_name in ('sites', 'site_pages', 'site_blocks', 'whatsapp_accounts', 'whatsapp_template_submissions',
                                             'whatsapp_groups', 'whatsapp_join_requests'))
                        = array['site_blocks=website', 'site_pages=website', 'sites=website', 'whatsapp_accounts=channels',
                                'whatsapp_groups=comms', 'whatsapp_join_requests=comms', 'whatsapp_template_submissions=channels'],
  'D · the website draft tables are WeaverSite''s, the WhatsApp Business tables Weaver Connect''s, and WhatsApp group links stay in Communications');
select pg_temp.assert(not exists (
    select 1 from app.module_tables mt
      join pg_class c on c.relname = mt.table_name join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'app'
      left join pg_policy p on p.polrelid = c.oid and p.polname = 'module_switch' and not p.polpermissive
     where mt.module_key in ('website', 'channels')
       and (p.oid is null or position(quote_literal(mt.module_key) in pg_get_expr(p.polqual, p.polrelid)) = 0
            or position(quote_literal(mt.module_key) in pg_get_expr(p.polwithcheck, p.polrelid)) = 0
            or position('''comms''' in pg_get_expr(p.polqual, p.polrelid)) > 0)),
  'D · each of those tables has a restrictive module_switch policy that names its own product');
select pg_temp.assert((select module_key from app.setup_steps where key = 'svc.whatsapp') = 'channels',
  'D · the WhatsApp Business Setup step follows Weaver Connect, so it is skipped where the product is off');
-- WhatsApp group links stay in Communications: a community with Communications on and no Weaver Connect still reads them.
select pg_temp.assert(app.module_enabled(:g_none, 'comms') and not (:g_none::uuid = any (app.module_off_centers('comms'))),
  'D · Communications (and so WhatsApp group links) is untouched where Weaver Connect is off');

rollback;
