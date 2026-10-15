-- 0850: the Marketplace product called CommunityConnect is called Weaver Connect (owner, 2026-10-15). Only the words changed: the
-- module key `channels`, its dependency, its tables and its switches are what they were.
--   A. The catalog: the module, the Marketplace card and everything else a person can read from a catalog say Weaver Connect; the other
--      four products keep their names; nothing in the catalog tables, the global templates, the Setup steps or the topics still says
--      the old name
--   B. The key did not change (module, product, tables, Setup step)
--   C. What the screens read: Settings › Marketplace (a community's administrator), Platform › Communities › Products (Weaver) and
--      Settings › Modules
--   D. The sentences: the module-off refusals and the send-time reason in the message log; no function says the old name in a string
--   E. Weaver turns the product on: the answer, the email to the owner and the audit log say Weaver Connect; the send-time check lets a
--      WhatsApp message through once it is on
--   F. A second run changes nothing, and the old name, when it appears again, is renamed again
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

\set c '''85000000-0000-4000-8000-0000000000c1'''
\set plat '''85000000-0000-4000-8000-000000000001'''
\set admin '''85000000-0000-4000-8000-000000000002'''
\set p_admin '''85000000-0000-4000-8000-0000000000a1'''
\set h1 '''85000000-0000-4000-8000-0000000000b1'''

-- ══ A. The catalog ═══════════════════════════════════════════════════════════
select pg_temp.assert((select label = 'Weaver Connect' and not core and depends_on = '{comms}' from app.modules where key = 'channels')
                      and not exists (select 1 from app.modules where label ilike '%communityconnect%' or label ilike '%community connect%'),
  'A · the module `channels` is called Weaver Connect, still needs Communications, and no module label carries the old name');
select pg_temp.assert((select array_agg(key || '=' || label order by sort) from app.modules
                        where key = any (array['ai', 'website', 'channels', 'care', 'matching']))
                        = array['ai=iWeaver', 'website=WeaverSite', 'channels=Weaver Connect', 'care=WeCare', 'matching=CatchTheMatch'],
  'A · the other four Marketplace modules keep their names');
select pg_temp.assert((select name = 'Weaver Connect' and mark = 'WCo' and module_key = 'channels' and status = 'available'
                         from app.marketplace_products where key = 'channels')
                      and (select array_agg(key || '=' || name || ':' || mark order by sort) from app.marketplace_products
                            where key = any (array['ai', 'website', 'care', 'matching']))
                          = array['ai=iWeaver:iW', 'care=WeCare:WC', 'matching=CatchTheMatch:CT', 'website=WeaverSite:WS'],
  'A · the Marketplace card is Weaver Connect with the badge WCo (it was CC); the other four cards are unchanged');
select pg_temp.assert(not exists (select 1 from app.marketplace_products p where to_jsonb(p)::text ~ 'CommunityConnect')
                      and not exists (select 1 from app.category_modules c where to_jsonb(c)::text ~ 'CommunityConnect')
                      and not exists (select 1 from app.message_templates t where to_jsonb(t)::text ~ 'CommunityConnect')
                      and not exists (select 1 from app.setup_steps s where to_jsonb(s)::text ~ 'CommunityConnect')
                      and not exists (select 1 from app.notification_topics n where to_jsonb(n)::text ~ 'CommunityConnect')
                      and not exists (select 1 from app.organization_categories k where to_jsonb(k)::text ~ 'CommunityConnect')
                      and not exists (select 1 from app.demo_packs d where to_jsonb(d)::text ~ 'CommunityConnect'),
  'A · no catalog row, template, Setup step, topic, experience or demo pack carries the old spelling');

-- ══ B. The key did not change ════════════════════════════════════════════════
select pg_temp.assert((select count(*) from app.modules where key = 'channels') = 1
                      and exists (select 1 from app.marketplace_products where key = 'channels' and module_key = 'channels')
                      and (select array_agg(table_name || '=' || module_key order by table_name) from app.module_tables
                            where table_name in ('whatsapp_accounts', 'whatsapp_template_submissions', 'whatsapp_groups', 'whatsapp_join_requests'))
                          = array['whatsapp_accounts=channels', 'whatsapp_groups=comms', 'whatsapp_join_requests=comms', 'whatsapp_template_submissions=channels']
                      and (select module_key from app.setup_steps where key = 'svc.whatsapp') = 'channels'
                      and (select availability from app.category_modules where category_key = 'jain_center' and module_key = 'channels') = 'default_off',
  'B · the key is still `channels`: the module, the product, the WhatsApp Business tables, the Setup step and the kind''s default (off) are what they were');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values (:plat, 'plat850@platform.test'), (:admin, 'sam850@temple.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('85000000-0000-4000-8000-0000000000f1', :plat, 'Phone', 'totp', 'verified');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone, rules) values
  (:c, 'wc850', 'Temple 850', 'T850', 'TX', 'active', 'America/Chicago', '{}');
insert into app.role_grants (center_id, user_id, role_key, reason) values (:c, :admin, 'center_admin', 'weaver connect test 850');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Kumar850, Sam');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_admin, :c, 'Sam', 'Kumar850', date '1975-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h1, :p_admin, :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :admin, :p_admin);

-- ══ C. What the screens read ═════════════════════════════════════════════════
select pg_temp.claims(:admin);
select pg_temp.assert((select name = 'Weaver Connect' and module_label = 'Weaver Connect' and mark = 'WCo' and module_key = 'channels' and state = 'available'
                         from app.marketplace_states(:c) where key = 'channels'),
  'C · Settings › Marketplace: the card reads Weaver Connect (the kind''s own name for the module is the same), badge WCo, available to request');
select pg_temp.assert((select label from app.module_states(:c) where key = 'channels') = 'Weaver Connect'
                      and (select label from app.my_modules(:c) where key = 'channels') = 'Weaver Connect',
  'C · Settings › Modules (module_states) and the portal''s module list (my_modules) read Weaver Connect');
select pg_temp.assert((select count(*) from app.marketplace_states(:c) s
                        where s.name ilike '%communityconnect%' or s.module_label ilike '%communityconnect%'
                           or exists (select 1 from jsonb_array_elements(s.needs) e where e->>'label' ilike '%communityconnect%')) = 0,
  'C · no card, module name or "needs" line on the Marketplace read carries the old name');
select pg_temp.no_claims();
select pg_temp.claims(:plat);
select pg_temp.assert((select name = 'Weaver Connect' and module_label = 'Weaver Connect' from app.marketplace_states(:c) where key = 'channels'),
  'C · Platform › Communities › Products (Weaver''s view of a community) reads Weaver Connect too');
select pg_temp.no_claims();

-- ══ D. The sentences ═════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select app.assert_module_enabled(%L, 'channels')$$, :c),
  'Weaver has not enabled Weaver Connect for this community.', 'D · where it is not on, the refusal names Weaver Connect');
insert into app.messages (id, center_id, to_address, channel, body, purpose, status) values
  ('85000000-0000-4000-8000-0000000000a1', :c, '+17135550850', 'whatsapp', 'Hello', 'receipt', 'queued');
set local role connect_worker;
select pg_temp.assert((app.worker_message_to_send('85000000-0000-4000-8000-0000000000a1')->>'skip')
                        = 'Not sent: WhatsApp messages are part of Weaver Connect, which is not on for this community.',
  'D · a queued WhatsApp message where the product is off is recorded as not sent, with the reason in the new name');
reset role;
-- The text of the functions without their comments (a comment is shown to no one): no function says the old name in a string.
select pg_temp.assert((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname in ('app', 'public') and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'CommunityConnect') = 0
                      and (select regexp_replace(prosrc, '--[^\n]*', '', 'g') like '%part of Weaver Connect, which is not on for this community.%'
                             from pg_proc where oid = 'app.worker_message_to_send(uuid)'::regprocedure),
  'D · no function carries the old spelling in what it says, and the send-time function says Weaver Connect');

-- ══ E. Weaver turns the product on ═══════════════════════════════════════════
select pg_temp.claims(:plat, true);
select app.marketplace_set_product(:c, 'channels', true, 'WhatsApp account approved') as on1 \gset
select pg_temp.assert(((:'on1'::jsonb)->>'enabled')::boolean and (:'on1'::jsonb)->>'name' = 'Weaver Connect' and (:'on1'::jsonb)->>'product' = 'channels'
                      and (:'on1'::jsonb)->>'email_status' = 'queued'
                      and (select count(*) from app.messages where template_key = 'marketplace_product_on' and to_address = 'sam850@temple.test'
                              and subject = 'Weaver Connect is on for Temple 850'
                              and body like '%Weaver turned on Weaver Connect for your community, Temple 850.%') = 1,
  'E · turning it on answers with the new name under the same key, and the owner''s email says Weaver Connect');
select pg_temp.assert(exists (select 1 from app.marketplace_audit(:c) where what = 'plat850@platform.test turned on Weaver Connect'),
  'E · the audit log says, in words, that Weaver turned on Weaver Connect');
select pg_temp.no_claims();
select pg_temp.assert(app.module_enabled(:c, 'channels'),
  'E · the module is on under its key `channels`');
set local role connect_worker;
select pg_temp.assert((app.worker_message_to_send('85000000-0000-4000-8000-0000000000a1')->>'skip') is null,
  'E · once it is on, the send-time check lets the WhatsApp message through');
reset role;

-- ══ F. A second run changes nothing; the old name, when it appears again, is renamed ═══
select app.set_audit_context('test 850');
\ir ../migrations/0850_weaver_connect_label.sql
select pg_temp.assert((select label from app.modules where key = 'channels') = 'Weaver Connect'
                      and (select name || ':' || mark from app.marketplace_products where key = 'channels') = 'Weaver Connect:WCo'
                      and (select label from app.modules where key = 'ai') = 'iWeaver',
  'F · running the migration again changes nothing');
update app.modules set label = 'CommunityConnect' where key = 'channels';
update app.marketplace_products set name = 'CommunityConnect', mark = 'CC' where key = 'channels';
\ir ../migrations/0850_weaver_connect_label.sql
select pg_temp.assert((select label from app.modules where key = 'channels') = 'Weaver Connect'
                      and (select name || ':' || mark from app.marketplace_products where key = 'channels') = 'Weaver Connect:WCo'
                      and (select label from app.modules where key = 'website') = 'WeaverSite'
                      and (select name from app.marketplace_products where key = 'care') = 'WeCare'
                      and (select depends_on from app.modules where key = 'channels') = '{comms}',
  'F · the exact old name is renamed again (label, card name, badge), and nothing else is touched');

rollback;
