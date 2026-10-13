-- 0750 and 0751: the Marketplace products as modules (docs/MARKETPLACE_PACKS.md, docs/WECARE.md, docs/CATCH_THE_MATCH.md).
--   A. The catalog: five neutral keys with brand labels, off for every kind (P5: the 0594 trigger would have made them on for a
--      Jain Center), WeCare named by the kind, Niva behind iWeaver, the helpers private.
--   B. Grandfathering by use, replayed on test communities: Niva on, Niva paused, AI flyer art in the last 90 days (a finished
--      job, or an event's AI flyer), art older than that, a WhatsApp account, a website draft, nothing. What each community
--      sees is the same before and after (the old modules), and each new module is on exactly where it was granted.
--   C. The sandbox trial of iWeaver: a new sandbox starts with it; it never reaches production (a copied trial row arrives off,
--      a sandbox that goes live in place has it turned off), and the finished promotion emails the owner.
--   D. The gates: Niva is off wherever iWeaver is; the website draft functions need WeaverSite; the WhatsApp Business
--      functions and the send-time check need CommunityConnect; the tables belong to their product; WhatsApp group links stay
--      in Communications.
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
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
grant connect_worker to postgres;

\set FIVE 'array[''ai'', ''website'', ''channels'', ''care'', ''matching'']'
\set g_niva '''16000000-0000-4000-8000-0000000000c1'''
\set g_paused '''16000000-0000-4000-8000-0000000000c2'''
\set g_art '''16000000-0000-4000-8000-0000000000c3'''
\set g_job '''16000000-0000-4000-8000-0000000000c4'''
\set g_old '''16000000-0000-4000-8000-0000000000c5'''
\set g_wa '''16000000-0000-4000-8000-0000000000c6'''
\set g_site '''16000000-0000-4000-8000-0000000000c7'''
\set g_none '''16000000-0000-4000-8000-0000000000c8'''
\set sbx '''16000000-0000-4000-8000-0000000000d1'''
\set sbx2 '''16000000-0000-4000-8000-0000000000d2'''
\set prodcopy '''16000000-0000-4000-8000-0000000000d3'''
\set admin '''16000000-0000-4000-8000-000000000001'''
\set owner '''16000000-0000-4000-8000-000000000002'''

-- ══ A. The catalog ═══════════════════════════════════════════════════════════
select pg_temp.assert((select array_agg(key || '=' || label || ':' || array_to_string(depends_on, ',') order by sort)
                         from app.modules where key = any (:FIVE))
                        = array['ai=iWeaver:', 'website=WeaverSite:people', 'channels=CommunityConnect:comms', 'care=WeCare:people',
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
select pg_temp.assert(not has_function_privilege('authenticated', 'app._marketplace_grandfather()', 'execute')
                      and not has_function_privilege('authenticated', 'app._marketplace_sandbox_trial()', 'execute')
                      and not has_function_privilege('anon', 'app._ai_trial_reason()', 'execute')
                      and (select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'app' and p.proname in ('_marketplace_grandfather', '_marketplace_sandbox_trial', 'centers_ai_trial',
                                                                      'center_module_grants_trial_rule', 'centers_ai_trial_end',
                                                                      'sandbox_promotions_trial_notice')),
  'A · the helpers are private and run as the definer with the pinned search path');
select pg_temp.assert(exists (select 1 from app.center_module_grants g where g.center_id = '00000000-0000-4000-8000-000000000001' and g.module_key = 'ai' and g.granted)
                      and app.module_enabled('00000000-0000-4000-8000-000000000001', 'niva'),
  'A · the seed community (which uses Niva) holds iWeaver, so its Niva stays on');

-- ══ B. Grandfathering by use ═════════════════════════════════════════════════
-- Eight communities (Jain Centers: Niva starts on for that kind). Three have Niva disabled by Weaver, so only flyer art
-- can grandfather iWeaver for them.
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:g_niva,   'gn160', 'Niva 160',   'GN', 'TX', 'active', 'America/Chicago'),
  (:g_paused, 'gp160', 'Paused 160', 'GP', 'TX', 'active', 'America/Chicago'),
  (:g_art,    'ga160', 'Art 160',    'GA', 'TX', 'active', 'America/Chicago'),
  (:g_job,    'gj160', 'Job 160',    'GJ', 'TX', 'active', 'America/Chicago'),
  (:g_old,    'go160', 'Old 160',    'GO', 'TX', 'active', 'America/Chicago'),
  (:g_wa,     'gw160', 'WhatsApp 160', 'GW', 'TX', 'active', 'America/Chicago'),
  (:g_site,   'gs160', 'Site 160',   'GS', 'TX', 'active', 'America/Chicago'),
  (:g_none,   'gx160', 'None 160',   'GX', 'TX', 'active', 'America/Chicago');
insert into app.center_module_grants (center_id, module_key, granted, reason) values
  (:g_art, 'niva', false, 'Test 160: Niva disabled'), (:g_job, 'niva', false, 'Test 160: Niva disabled'),
  (:g_old, 'niva', false, 'Test 160: Niva disabled'), (:g_none, 'niva', false, 'Test 160: Niva disabled');
insert into app.center_modules (center_id, module_key, enabled, reason) values (:g_paused, 'niva', false, 'Test 160: paused');
insert into app.events (id, center_id, name, status, audience, confidential, flyer_source, flyer_generated_at) values
  ('16000000-0000-4000-8000-0000000000e1', :g_art, 'Art 160 event', 'published', 'public', false, 'ai', now() - interval '30 days'),
  ('16000000-0000-4000-8000-0000000000e2', :g_old, 'Old 160 event', 'published', 'public', false, 'ai', now() - interval '120 days');
insert into app.jobs (center_id, kind, payload, status, finished_at) values
  (:g_job, 'events.generate_flyer', '{}', 'done', now() - interval '10 days'),
  (:g_old, 'events.generate_flyer', '{}', 'done', now() - interval '120 days'),
  (:g_none, 'events.generate_flyer', '{}', 'failed', now() - interval '1 day');
insert into app.whatsapp_accounts (center_id, display_name, status) values (:g_wa, 'WhatsApp 160', 'pending_meta');
insert into app.sites (center_id, name) values (:g_site, 'Site 160');
select pg_temp.assert(not exists (select 1 from app.center_module_grants where center_id in (:g_niva, :g_paused, :g_art, :g_job, :g_old, :g_wa, :g_site, :g_none)
                                     and module_key = any (:FIVE)),
  'B · a community created after 0750 holds none of the products: every kind starts them off');

-- What each community saw under the rules before 0750 (Niva needing Content only), for the snapshot only.
savepoint before_0750;
update app.modules set depends_on = '{content}' where key = 'niva';
select coalesce(array_agg(x order by x), '{}') as on_before from unnest(app._module_on_snapshot()) x
 where split_part(x, ':', 1) in (:g_niva, :g_paused, :g_art, :g_job, :g_old, :g_wa, :g_site, :g_none) \gset
rollback to savepoint before_0750;
select pg_temp.assert((:g_niva || ':niva') = any (:'on_before'::text[]) and not ((:g_paused || ':niva') = any (:'on_before'::text[]))
                      and not ((:g_art || ':niva') = any (:'on_before'::text[])),
  'B · before 0750, Niva was on in the first community, paused in the second, disabled in the flyer-art ones');
select pg_temp.assert(not app.module_enabled(:g_niva, 'niva'),
  'B · without iWeaver, Niva would now be off: the grandfathering is what keeps it');

select app._marketplace_grandfather() as added \gset
select pg_temp.assert((select array_agg(c.slug::text || ':' || g.module_key order by c.slug, g.module_key)
                         from app.center_module_grants g join app.centers c on c.id = g.center_id
                        where g.center_id in (:g_niva, :g_paused, :g_art, :g_job, :g_old, :g_wa, :g_site, :g_none)
                          and g.module_key = any (:FIVE) and g.granted)
                        = array['ga160:ai', 'gj160:ai', 'gn160:ai', 'gp160:ai', 'gs160:ai', 'gs160:website', 'gw160:ai', 'gw160:channels']
                      and :'added'::int >= 8,
  'B · iWeaver where Niva is on or paused or AI art was made in 90 days, CommunityConnect where a WhatsApp account exists, WeaverSite where a draft exists, nothing else');
select pg_temp.assert((select reason like 'Grandfathered (0750): Niva was on%' and granted_by is null from app.center_module_grants where center_id = :g_paused and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750): AI flyer art%' from app.center_module_grants where center_id = :g_art and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750): AI flyer art%' from app.center_module_grants where center_id = :g_job and module_key = 'ai')
                      and (select reason like 'Grandfathered (0750)%WhatsApp Business account%' from app.center_module_grants where center_id = :g_wa and module_key = 'channels')
                      and (select reason like 'Grandfathered (0750)%website draft%' from app.center_module_grants where center_id = :g_site and module_key = 'website'),
  'B · each grant says why, with no person behind it');
select pg_temp.assert(coalesce((select array_agg(x order by x) from unnest(app._module_snapshot_diff(:'on_before'::text[])) x
                                 where split_part(x, ':', 1) in ('gn160', 'gp160', 'ga160', 'gj160', 'go160', 'gw160', 'gs160', 'gx160')
                                   and split_part(split_part(x, ': ', 2), ' ', 1) <> all (:FIVE)), '{}') = '{}',
  'B · every module that existed before is on and off exactly as before, in every one of the eight communities');
select pg_temp.assert(app.module_enabled(:g_niva, 'niva') and not app.module_enabled(:g_paused, 'niva')
                      and app.module_enabled(:g_paused, 'ai') and not app.module_enabled(:g_old, 'ai')
                      and app.module_enabled(:g_wa, 'channels') and app.module_enabled(:g_site, 'website')
                      and not app.module_enabled(:g_none, 'website') and not app.module_enabled(:g_none, 'channels')
                      and not app.module_enabled(:g_none, 'care') and not app.module_enabled(:g_none, 'matching'),
  'B · Niva stays on, a paused Niva stays paused (and comes back when resumed), and each product is on only where it was granted');
update app.center_modules set enabled = true, reason = 'Test 160: resumed' where center_id = :g_paused and module_key = 'niva';
select pg_temp.assert(app.module_enabled(:g_paused, 'niva'), 'B · resuming the paused Niva brings it back (owner answer 1)');
select pg_temp.assert(app._marketplace_grandfather() = 0, 'B · running it again adds nothing');

-- ══ C. The sandbox trial ═════════════════════════════════════════════════════
insert into auth.users (id, email) values (:admin, 'admin160@club.test'), (:owner, 'owner160@club.test');
insert into app.centers (id, slug, name, environment, category_key, status) values
  (:sbx, 'sbx160-sandbox', 'Sandbox 160', 'sandbox', 'jain_center', 'onboarding'),
  (:sbx2, 'sbx160b-sandbox', 'Sandbox 160 B', 'sandbox', 'jain_center', 'onboarding');
select pg_temp.assert((select granted and granted_by is null and reason = app._ai_trial_reason() from app.center_module_grants where center_id = :sbx and module_key = 'ai')
                      and app.module_enabled(:sbx, 'ai') and app.module_enabled(:sbx, 'niva')
                      and not exists (select 1 from app.center_module_grants where center_id = :sbx and module_key <> 'ai'),
  'C · a new sandbox starts with the iWeaver trial (and only that), so Niva works there as it does for every prospect');
-- Promotion copies the grants (0740): the copied trial row arrives at the production community turned off, saying why.
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:prodcopy, 'prod160', 'Production 160', 'P160', 'TX', 'onboarding', 'America/Chicago');
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by, granted_at)
select :prodcopy, g.module_key, g.granted, g.reason, g.granted_by, g.granted_at from app.center_module_grants g where g.center_id = :sbx;
select pg_temp.assert((select not granted and reason = app._ai_trial_ended_reason() from app.center_module_grants where center_id = :prodcopy and module_key = 'ai')
                      and not app.module_enabled(:prodcopy, 'ai') and not app.module_enabled(:prodcopy, 'niva')
                      and app._ai_trial_ended_reason() like '%can request iWeaver in Settings › Marketplace.',
  'C · a copied trial never reaches production: it arrives off, and its reason says iWeaver can be requested in the Marketplace');
-- A platform admin's own grant is never mistaken for the trial, whatever its reason says.
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  ('16000000-0000-4000-8000-0000000000d4', 'pa160', 'Admin grant 160', 'PA', 'TX', 'onboarding', 'America/Chicago');
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_by)
values ('16000000-0000-4000-8000-0000000000d4', 'ai', true, app._ai_trial_reason(), :admin);
select pg_temp.assert((select granted from app.center_module_grants where center_id = '16000000-0000-4000-8000-0000000000d4' and module_key = 'ai'),
  'C · only an iWeaver row with no person behind it is a trial');
-- A sandbox that goes live in place keeps its rows: its trial is turned off.
update app.centers set environment = 'production' where id = :sbx2;
select pg_temp.assert((select not granted and reason = app._ai_trial_ended_reason() from app.center_module_grants where center_id = :sbx2 and module_key = 'ai'),
  'C · a sandbox that goes live in place has its trial turned off');
-- The finished promotion emails the owner (and whoever asked for it), and records that it did.
insert into app.center_owners (center_id, user_id) values (:prodcopy, :owner);
insert into app.golive_requests (id, center_id, requested_by) values ('16000000-0000-4000-8000-0000000000f1', :sbx, :admin);
insert into app.sandbox_promotions (id, sandbox_id, golive_id, slug, reason, requested_by)
values ('16000000-0000-4000-8000-0000000000f2', :sbx, '16000000-0000-4000-8000-0000000000f1', 'prod160', 'Test 160', :admin);
update app.sandbox_promotions set status = 'done', production_id = :prodcopy, finished_at = now(), result = '{"in_place": false}'
 where id = '16000000-0000-4000-8000-0000000000f2';
select pg_temp.assert((select result->>'ai_trial_notice' = 'queued, queued' and result->>'in_place' = 'false'
                         from app.sandbox_promotions where id = '16000000-0000-4000-8000-0000000000f2')
                      and (select count(*) from app.messages where template_key = 'marketplace_trial_ended'
                              and to_address in ('owner160@club.test', 'admin160@club.test')) = 2
                      and (select body like '%Production 160 is live.%request it in Settings › Marketplace%'
                             from app.messages where template_key = 'marketplace_trial_ended' and to_address = 'owner160@club.test'),
  'C · when the promotion finishes, the owner and the person who promoted get an email in plain words, and the promotion records it');

-- ══ D. The gates ═════════════════════════════════════════════════════════════
select pg_temp.assert(not app.module_enabled(:g_none, 'ai') and not app.module_enabled(:g_none, 'niva')
                      and :g_none::uuid = any (app.module_off_centers('niva'))
                      and :g_none::uuid = any (app.module_off_centers('ai')),
  'D · where iWeaver is off, Niva reads off everywhere: module_enabled (which my_modules and member_experience read, so installed apps hide it) and the policies'' set');
-- A Jain Center created now: Niva is granted by its kind, iWeaver is not.
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  ('16000000-0000-4000-8000-0000000000c9', 'gy160', 'Fresh 160', 'GY', 'TX', 'active', 'America/Chicago');
select pg_temp.assert_raises($$select app.assert_module_enabled('16000000-0000-4000-8000-0000000000c9', 'niva')$$,
  'Niva assistant is off because iWeaver is off for this community.', 'D · and the RPC guard says why in plain words');

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
  'Weaver has not enabled CommunityConnect for this community.', 'D · a WhatsApp Business account needs CommunityConnect');
select pg_temp.assert_raises(format($$select app.submit_whatsapp_template(%L, 'hello', 'en', 'utility', 'Hi', 'Test')$$, :g_none),
  'Weaver has not enabled CommunityConnect', 'D · so does a WhatsApp template');
select pg_temp.assert_raises(format($$select app.send_test_message(%L, 'whatsapp', '+17135550160')$$, :g_none),
  'Weaver has not enabled CommunityConnect', 'D · and a WhatsApp test message');
select pg_temp.no_claims();
-- Send time: a WhatsApp message queued before the product went off is not sent, and says why.
insert into app.messages (id, center_id, to_address, channel, body, purpose, status) values
  ('16000000-0000-4000-8000-0000000000a1', :g_none, '+17135550160', 'whatsapp', 'Hello', 'receipt', 'queued'),
  ('16000000-0000-4000-8000-0000000000a2', :g_wa, '+17135550161', 'whatsapp', 'Hello', 'receipt', 'queued');
set local role connect_worker;
select pg_temp.assert((app.worker_message_to_send('16000000-0000-4000-8000-0000000000a1')->>'skip')
                        = 'Not sent: WhatsApp messages are part of CommunityConnect, which is not on for this community.'
                      and (app.worker_message_to_send('16000000-0000-4000-8000-0000000000a2')->>'skip') is null,
  'D · at send time a WhatsApp message needs CommunityConnect: not sent, with the reason, where it is off; sent where it is on');
reset role;

select pg_temp.assert((select array_agg(table_name || '=' || module_key order by table_name) from app.module_tables
                        where table_name in ('sites', 'site_pages', 'site_blocks', 'whatsapp_accounts', 'whatsapp_template_submissions',
                                             'whatsapp_groups', 'whatsapp_join_requests'))
                        = array['site_blocks=website', 'site_pages=website', 'sites=website', 'whatsapp_accounts=channels',
                                'whatsapp_groups=comms', 'whatsapp_join_requests=comms', 'whatsapp_template_submissions=channels'],
  'D · the website draft tables are WeaverSite''s, the WhatsApp Business tables CommunityConnect''s, and WhatsApp group links stay in Communications');
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
  'D · the WhatsApp Business Setup step follows CommunityConnect, so it is skipped where the product is off');
-- WhatsApp group links stay in Communications: a community with Communications on and no CommunityConnect still reads them.
select pg_temp.assert(app.module_enabled(:g_none, 'comms') and not (:g_none::uuid = any (app.module_off_centers('comms'))),
  'D · Communications (and so WhatsApp group links) is untouched where CommunityConnect is off');

rollback;
