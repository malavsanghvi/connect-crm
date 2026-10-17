-- 0752 and 0753: the Marketplace catalog, requests, "tell me when it is ready", the Marketplace read and Weaver's switch.
--   A. The shape: the catalog (read by every signed-in person, written by no one), its copy (no placeholders; only
--      CatchTheMatch has a price; WeCare and CatchTheMatch not built yet), the requests and interest tables (RLS, no direct
--      writes, audited, core platform, kept by a sandbox reset), the functions' privileges.
--   B. The read: each product's state for a Jain Center and for a chamber sandbox (included, on, available, not built; the
--      iWeaver trial), what it needs (on or off, required or not), where a grant came from.
--   C. The community: request with a note, the plain refusals, cancel, "tell me when it is ready"; a member and another
--      community's administrator see nothing.
--   D. Pause and resume are the community's own module switch (app.set_module_enabled).
--   E. Weaver: the open requests; turning a product on (a fresh 2FA check, a reason, a module it needs must be on) marks the
--      request done and emails the requester; turning it off; the audit log in words; nobody else can do any of it.
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
create or replace function pg_temp.st(p_center uuid, p_key text) returns text language sql as $$
  select s.state from app.marketplace_states(p_center) s where s.key = p_key
$$;

\set c '''16100000-0000-4000-8000-0000000000c1'''
\set oc '''16100000-0000-4000-8000-0000000000c2'''
\set plat '''16100000-0000-4000-8000-000000000001'''
\set admin '''16100000-0000-4000-8000-000000000002'''
\set member '''16100000-0000-4000-8000-000000000003'''
\set otheradmin '''16100000-0000-4000-8000-000000000004'''
\set chadmin '''16100000-0000-4000-8000-000000000005'''
\set p_admin '''16100000-0000-4000-8000-0000000000a1'''
\set p_member '''16100000-0000-4000-8000-0000000000a2'''
\set h1 '''16100000-0000-4000-8000-0000000000b1'''
\set admin2 '''16100000-0000-4000-8000-000000000006'''
\set chm '''16100000-0000-4000-8000-0000000000c3'''

-- 0898 marks DonorDelight built. This test is about the not-built path ("Tell me when it is ready"), so inside this rolled-back transaction the card
-- goes back to the state 0752 gave it. (Moving a product to not_built sends nothing: the ready notice fires only from not_built to available.)
update app.marketplace_products set status = 'not_built' where key = 'care';

-- ══ A. The shape ═════════════════════════════════════════════════════════════
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'app.marketplace_products'::regclass)
                      and has_table_privilege('authenticated', 'app.marketplace_products', 'select')
                      and not has_table_privilege('authenticated', 'app.marketplace_products', 'insert')
                      and not has_table_privilege('authenticated', 'app.marketplace_products', 'update')
                      and not has_table_privilege('anon', 'app.marketplace_products', 'select')
                      and exists (select 1 from app.module_tables where table_name = 'marketplace_products' and module_key is null),
  'A · the catalog is read by every signed-in person and written by no one through the API; it is core platform data');
select pg_temp.assert((select array_agg(key || '=' || coalesce(module_key, '-') || ':' || status order by sort) from app.marketplace_products)
                        = array['giving=giving:available', 'events=events:available', 'comms=comms:available', 'accounting=accounting:available',
                                'ai=ai:available', 'store=store:available', 'market=market:available', 'care=care:not_built', 'matching=matching:not_built',
                                'website=website:available', 'channels=channels:available', 'gala=-:not_built'],
  'A · twelve products, each keyed by its module (Gala has none yet); WeCare, CatchTheMatch and Gala are not built yet (the Community Market, 0830, is available)');
select pg_temp.assert((select array_agg(key order by sort) from app.marketplace_products where included) = array['giving', 'events', 'comms', 'store']
                      and not exists (select 1 from app.marketplace_products where not included and key <> 'matching' and price_text <> 'Price not set yet')
                      and (select price_text from app.marketplace_products where key = 'matching')
                          = '10% of each match you receive, never more than $500 a match. Nothing if no match arrives.'
                      and not exists (select 1 from app.marketplace_products
                                       where concat_ws(' ', name, line, array_to_string(gets, ' '), members_line, data_line, price_text,
                                                       price_short, on_note, off_note) ~ '\[|\]')
                      and not exists (select 1 from app.marketplace_products where target_quarter is not null),
  'A · no price is set except CatchTheMatch''s; no placeholder anywhere; no target quarter until the owner sets one');
select pg_temp.assert_raises($$insert into app.marketplace_products (key, module_key, name, mark, line, status) values ('bad161', null, 'Bad', 'B', 'x', 'available')$$,
  'check', 'A · a product with no module can only be "not built yet"');
select pg_temp.assert((select bool_and(relrowsecurity) from pg_class where oid in ('app.marketplace_requests'::regclass, 'app.marketplace_interest'::regclass))
                      and not has_table_privilege('authenticated', 'app.marketplace_requests', 'insert')
                      and not has_table_privilege('authenticated', 'app.marketplace_requests', 'update')
                      and not has_table_privilege('authenticated', 'app.marketplace_interest', 'insert')
                      and not has_table_privilege('anon', 'app.marketplace_requests', 'select')
                      and (select count(*) from app.module_tables where table_name in ('marketplace_requests', 'marketplace_interest') and module_key is null) = 2
                      and (select count(*) from pg_trigger where tgname in ('audit_marketplace_requests', 'audit_marketplace_interest', 'audit_marketplace_products')
                             and tgfoid = 'app.audit_row'::regproc and not tgisinternal) = 3,
  'A · requests and interest: RLS on, nobody writes them directly, core platform, every change audited');
select pg_temp.assert('marketplace_requests' <> all (app.demo_clear_tables()) and 'marketplace_interest' <> all (app.demo_clear_tables())
                      and 'center_module_grants' <> all (app.demo_clear_tables()) and 'payment_reports' = any (app.demo_clear_tables())
                      and 'marketplace_requests' <> all (app.promotion_config_tables()),
  'A · a sandbox reset keeps requests and interest (as it keeps grants); a promotion does not copy them');
select pg_temp.assert((select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
                                       and p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('marketplace_states', 'marketplace_request', 'marketplace_request_cancel',
                                                                  'marketplace_notify_me', 'marketplace_open_requests',
                                                                  'marketplace_set_product', 'marketplace_audit'))
                      and not has_function_privilege('authenticated', 'app._marketplace_person(uuid, uuid, boolean)', 'execute')
                      and not has_function_privilege('authenticated', 'app._marketplace_settings_manager(uuid, text)', 'execute'),
  'A · the functions are for signed-in callers (checked inside), run as the definer with the pinned search path; the helpers are private');

-- ══ Fixtures ═════════════════════════════════════════════════════════════════
insert into auth.users (id, email) values
  (:plat, 'plat161@platform.test'), (:admin, 'sam161@temple.test'), (:member, 'mira161@temple.test'),
  (:otheradmin, 'other161@club.test'), (:chadmin, 'chet161@chamber.test'), (:admin2, 'ravi161@temple.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status) values
  ('16100000-0000-4000-8000-0000000000f1', :plat, 'Phone', 'totp', 'verified');
insert into app.centers (id, slug, name, short_name, state_region, status, time_zone) values
  (:c, 'mk161', 'Temple 161', 'T161', 'TX', 'active', 'America/Chicago'),
  (:oc, 'mk161b', 'Other Club 161', 'O161', 'TX', 'active', 'America/Chicago');
insert into app.role_grants (center_id, user_id, role_key, reason) values
  (:c, :admin, 'center_admin', 'marketplace test 161'), (:oc, :otheradmin, 'center_admin', 'marketplace test 161');
-- A second administrator, after Sam (who became the owner as the first one).
insert into app.role_grants (center_id, user_id, role_key, reason) values (:c, :admin2, 'center_admin', 'marketplace test 161');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Kumar161, Sam');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:p_admin, :c, 'Sam', 'Kumar161', date '1975-01-01'), (:p_member, :c, 'Mira', 'Kumar161', date '1978-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :p_admin, :c, 'primary', true), (:h1, :p_member, :c, 'spouse', false);
insert into app.center_users (center_id, user_id, person_id) values (:c, :admin, :p_admin), (:c, :member, :p_member);
-- A chamber sandbox (so it starts with the iWeaver trial, 0750).
insert into app.centers (id, slug, name, environment, category_key, status)
values (:chm, 'chm161-sandbox', 'Chamber 161', 'sandbox', 'chamber_of_commerce', 'onboarding');

-- ══ B. The read ══════════════════════════════════════════════════════════════
select pg_temp.claims(:admin);
select pg_temp.assert((select array_agg(key || '=' || state order by sort) from app.marketplace_states(:c))
                        = array['giving=included', 'events=included', 'comms=included', 'accounting=on', 'ai=available', 'store=included', 'market=available',
                                'care=not_built', 'matching=not_built', 'website=available', 'channels=available', 'gala=not_built'],
  'B · a Jain Center: Giving, Events, Communications and the Store included; Accounting on; the six products off until requested or built (the Community Market, 0830, among them)');
select pg_temp.assert((select source = 'kind_default' and granted and enabled and granted_at is null from app.marketplace_states(:c) where key = 'accounting')
                      and (select source = 'none' and not granted and not enabled from app.marketplace_states(:c) where key = 'website')
                      and (select module_label = 'Member care' and name = 'DonorDelight' from app.marketplace_states(:c) where key = 'care')
                      and (select module_key is null and source = 'none' and not enabled from app.marketplace_states(:c) where key = 'gala'),
  'B · where each grant came from (the kind''s default, none), the kind''s own name beside the product''s');
select pg_temp.assert((select needs = '[{"module": "comms", "label": "Communications", "on": true, "required": true},
                                        {"module": "events", "label": "Events & RSVP (for Facebook and Instagram)", "on": true, "required": false}]'::jsonb
                         from app.marketplace_states(:c) where key = 'channels')
                      and (select price_short from app.marketplace_states(:c) where key = 'matching') = '10%, max $500 a match'
                      and (select price_short from app.marketplace_states(:c) where key = 'website') = 'Price not set yet',
  'B · what a product needs, on or off for the community, and whether it must be on first; the short price on the card');
select pg_temp.no_claims();
select pg_temp.claims(:plat);
select pg_temp.assert((select array_agg(key || '=' || state order by sort) from app.marketplace_states(:chm) where key in ('ai', 'store', 'giving'))
                        = array['giving=included', 'ai=on', 'store=available']
                      and (select source from app.marketplace_states(:chm) where key = 'ai') = 'trial',
  'B · a chamber sandbox: iWeaver on as a trial, the Store (which its kind starts off) available to request');
select pg_temp.no_claims();

-- ══ C. The community ═════════════════════════════════════════════════════════
select pg_temp.claims(:admin);
select pg_temp.assert_raises(format($$select app.marketplace_request(%L, 'website', '  ')$$, :c),
  'Say what your community will use WeaverSite for. A sentence is enough.', 'C · a request needs a note');
select pg_temp.assert_raises(format($$select app.marketplace_request(%L, 'care', 'Our donors')$$, :c),
  'DonorDelight is not built yet, so it cannot be requested', 'C · a product that is not built yet cannot be requested');
select pg_temp.assert_raises(format($$select app.marketplace_request(%L, 'giving', 'More giving')$$, :c),
  'Giving is already on for your community.', 'C · nor one that is already on');
select pg_temp.assert_raises(format($$select app.marketplace_request(%L, 'nope', 'x')$$, :c),
  'There is no product called "nope".', 'C · nor one that does not exist');
select app.marketplace_request(:c, 'website', 'We want our events and giving pages on our own website.') as req \gset
select pg_temp.assert((:'req'::jsonb)->>'status' = 'open'
                      and (select state = 'requested' and request_note = 'We want our events and giving pages on our own website.'
                                  and requested_by_name = 'Sam K.' and requested_at is not null
                             from app.marketplace_states(:c) where key = 'website'),
  'C · a settings manager requests WeaverSite with a note; the card says Requested, by whom and when');
select pg_temp.assert_raises(format($$select app.marketplace_request(%L, 'website', 'Again')$$, :c),
  'WeaverSite is already requested.', 'C · one open request per product');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'marketplace_requests' and action = 'marketplace_requests.insert'
                         and center_id = :c and actor_user_id = :admin and reason like 'Requested WeaverSite: We want%') = 1,
  'C · the request is in the audit log, with who and the note');
select app.marketplace_request_cancel(:c, 'website') as cancelled \gset
select pg_temp.assert((:'cancelled'::jsonb)->>'status' = 'cancelled' and pg_temp.st(:c, 'website') = 'available',
  'C · the request can be cancelled; the card goes back to Available');
select pg_temp.assert_raises(format($$select app.marketplace_request_cancel(%L, 'website')$$, :c),
  'There is no open request for WeaverSite to cancel.', 'C · cancelling twice says there is nothing to cancel');
select app.marketplace_request(:c, 'website', 'Our events and giving pages on our own website.') as req2 \gset
select app.marketplace_notify_me(:c, 'care') as told \gset
select pg_temp.assert((:'told'::jsonb)->>'notified_at' is not null and pg_temp.st(:c, 'care') = 'notified'
                      and (app.marketplace_notify_me(:c, 'care')->>'notified_at') = (:'told'::jsonb)->>'notified_at'
                      and (select count(*) from app.marketplace_interest where center_id = :c and product_key = 'care') = 1,
  'C · "Tell me when it is ready": counted once per community, and the card says so');
select pg_temp.assert_raises(format($$select app.marketplace_notify_me(%L, 'website')$$, :c),
  'WeaverSite is ready now. Request it instead.', 'C · a built product is requested, not waited for');
set local role authenticated;
select pg_temp.assert((select count(*) from app.marketplace_requests where center_id = :c) = 2
                      and (select count(*) from app.marketplace_interest where center_id = :c) = 1,
  'C · the community''s settings manager reads its requests and interest');
select pg_temp.claims(:member);
select pg_temp.assert((select count(*) from app.marketplace_requests) = 0 and (select count(*) from app.marketplace_interest) = 0
                      and (select count(*) from app.marketplace_products) = 12,
  'C · a member reads the catalog but no requests');
select pg_temp.assert_raises(format($$select app.marketplace_request(%L, 'ai', 'Please')$$, :c),
  'Requesting a product needs the settings.manage permission.', 'C · a member cannot request a product (it needs settings.manage)');
select pg_temp.assert_raises(format($$select * from app.marketplace_states(%L)$$, :c),
  'have access to this community''s Marketplace', 'C · nor read the Marketplace');
select pg_temp.claims(:otheradmin);
select pg_temp.assert((select count(*) from app.marketplace_requests where center_id = :c) = 0,
  'C · another community''s administrator reads nothing of this community''s requests');
select pg_temp.assert_raises(format($$select app.marketplace_request_cancel(%L, 'website')$$, :c),
  'needs the settings.manage permission', 'C · nor cancels them');
reset role;
select pg_temp.no_claims();

-- ══ D. Pause and resume: the community's own switch ════════════════════════
-- (A module switch no longer asks for a fresh 2FA check, 0787: the Marketplace's Pause is the same switch as Settings › Modules, run here without one.)
select pg_temp.claims(:admin);
select app.set_module_enabled(:c, 'accounting', false, 'Paused in Settings › Marketplace');
select pg_temp.assert((select state = 'paused' and paused and not enabled and granted and paused_by_name = 'Sam K.'
                              and pause_reason = 'Paused in Settings › Marketplace' and paused_at is not null
                         from app.marketplace_states(:c) where key = 'accounting'),
  'D · pausing is the community''s module switch: the card says Paused, by whom, and nothing is deleted');
select pg_temp.assert_raises(format($$select app.marketplace_request(%L, 'accounting', 'Back please')$$, :c),
  'Accounting and QuickBooks is on for your community and paused. Resume it instead', 'D · a paused product is resumed, not requested');
select app.set_module_enabled(:c, 'accounting', true, 'Resumed in Settings › Marketplace');
select pg_temp.assert(pg_temp.st(:c, 'accounting') = 'on', 'D · resuming brings it back on');
select pg_temp.no_claims();

-- ══ E. Weaver ════════════════════════════════════════════════════════════════
select pg_temp.claims(:admin);
select pg_temp.assert_raises($$select * from app.marketplace_open_requests()$$, 'Only the Weaver team', 'E · only Weaver sees every community''s requests');
select pg_temp.assert_raises(format($$select app.marketplace_set_product(%L, 'website', true, 'Self-service')$$, :c),
  'Only the Weaver team can turn a product on or off', 'E · a community''s administrator cannot turn a product on');
select pg_temp.assert_raises(format($$select * from app.marketplace_audit(%L)$$, :c), 'Only the Weaver team', 'E · nor read the product history');
select pg_temp.claims(:plat);
select pg_temp.assert((select count(*) from app.marketplace_open_requests() r
                        where r.center_id = :c and r.product_key = 'website' and r.product_name = 'WeaverSite' and r.center_name = 'Temple 161'
                          and r.requested_by_name = 'Sam K.' and r.note = 'Our events and giving pages on our own website.') = 1,
  'E · Weaver sees the open request: community, product, who asked and the note');
select pg_temp.assert_raises(format($$select app.marketplace_set_product(%L, 'website', true, 'Reviewed')$$, :c),
  'fresh 2FA check', 'E · turning a product on needs a fresh 2FA check');
select pg_temp.claims(:plat, true);
select pg_temp.assert_raises(format($$select app.marketplace_set_product(%L, 'website', true, '  ')$$, :c),
  'Give a reason for turning WeaverSite on. It goes in the audit log.', 'E · and a reason');
select pg_temp.assert_raises(format($$select app.marketplace_set_product(%L, 'gala', true, 'Early')$$, :c),
  'Gala and Auctions is not built yet', 'E · a product with no module cannot be turned on');
select app.marketplace_set_product(:c, 'website', true, 'Request from Sam K., reviewed') as on1 \gset
select pg_temp.assert(((:'on1'::jsonb)->>'enabled')::boolean and ((:'on1'::jsonb)->>'request_done')::boolean
                      and (:'on1'::jsonb)->>'email_status' = 'queued' and ((:'on1'::jsonb)->>'emailed')::boolean
                      and (select status = 'done' and closed_by = :plat and closed_at is not null from app.marketplace_requests
                            where center_id = :c and product_key = 'website' and note like 'Our events%')
                      and (select count(*) from app.messages where template_key = 'marketplace_product_on' and to_address = 'sam161@temple.test'
                              and subject = 'WeaverSite is on for Temple 161'
                              and body like '%Weaver turned on WeaverSite for your community, Temple 161.%'
                              and body not like '%reviewed%' and body not like '%Reason%') = 1,
  'E · Weaver turns WeaverSite on: it is on at once, the request is done, and the person who asked is emailed in fixed words (Weaver''s reason stays in the audit log)');
select pg_temp.assert((select state = 'on' and source = 'weaver' and grant_reason = 'Request from Sam K., reviewed' and granted_by_name = 'plat161@platform.test'
                         from app.marketplace_states(:c) where key = 'website'),
  'E · the Weaver team sees who turned it on and why');
select pg_temp.claims(:admin);
select pg_temp.assert((select state = 'on' and source = 'weaver' and granted_by_name = 'Weaver' and grant_reason is null
                         from app.marketplace_states(:c) where key = 'website'),
  'E · the community sees "Weaver" turned it on, never a Weaver person''s address, and never Weaver''s internal reason');
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:c, 'comms', false, 'Test 161: Communications paused');
select pg_temp.claims(:plat, true);
select pg_temp.assert_raises(format($$select app.marketplace_set_product(%L, 'channels', true, 'WhatsApp account approved')$$, :c),
  'Communications is off for this community. Turn it on first.', 'E · a module the product needs must be on first');
select pg_temp.claims(:admin, true);
select app.set_module_enabled(:c, 'comms', true, 'Test 161: Communications back');
select pg_temp.claims(:plat, true);
select app.marketplace_set_product(:c, 'website', false, 'Trial over') as off1 \gset
select pg_temp.assert(not ((:'off1'::jsonb)->>'enabled')::boolean and not ((:'off1'::jsonb)->>'request_done')::boolean
                      and pg_temp.st(:c, 'website') = 'available'
                      and (select count(*) from app.messages where template_key = 'marketplace_product_off' and to_address = 'sam161@temple.test'
                              and subject = 'WeaverSite is off for Temple 161' and body not like '%Trial over%') = 1
                      and (:'off1'::jsonb)->>'email_status' = 'queued',
  'E · turning it off hides it again (nothing deleted), and the community''s owner (its first administrator) is emailed');
select pg_temp.assert((select count(*) from app.marketplace_audit(:c) where what like '%WeaverSite%') = 6
                      and (select count(*) from app.marketplace_audit(:c) where what = 'Sam K. requested WeaverSite') = 2
                      and exists (select 1 from app.marketplace_audit(:c) where what = 'Sam K. cancelled the request for WeaverSite')
                      and exists (select 1 from app.marketplace_audit(:c) where what = 'The request for WeaverSite was marked done')
                      and exists (select 1 from app.marketplace_audit(:c) where what = 'plat161@platform.test turned on WeaverSite')
                      and exists (select 1 from app.marketplace_audit(:c) where what = 'plat161@platform.test turned off WeaverSite'),
  'E · the audit log says, in words, every request, cancel, turn on and turn off');
select pg_temp.assert((select why from app.marketplace_audit(:c) where what = 'plat161@platform.test turned on WeaverSite') = 'Reason: Request from Sam K., reviewed'
                      and (select count(*) from app.marketplace_audit(:c) where what = 'Sam K. requested WeaverSite' and why like 'Note: %') = 2
                      and exists (select 1 from app.marketplace_audit(:c) where what = 'Sam K. paused Accounting and QuickBooks')
                      and exists (select 1 from app.marketplace_audit(:c) where what = 'Sam K. asked to be told when DonorDelight is ready'),
  'E · with the reason or the note, and the pauses and the interest too');
select pg_temp.no_claims();

-- "We will tell your admins when it is ready": a migration marks a product built, and whoever asked is emailed while they
-- still manage the community's settings. Ravi asks about CatchTheMatch, then stops being an administrator.
select pg_temp.claims(:admin2);
select app.marketplace_notify_me(:c, 'matching');
select pg_temp.no_claims();
update app.role_grants set status = 'revoked' where center_id = :c and user_id = :admin2;
update app.marketplace_products set status = 'available' where key = 'care';
update app.marketplace_products set status = 'available' where key = 'matching';
select pg_temp.assert((select told_at is not null and told_status = 'queued' from app.marketplace_interest where center_id = :c and product_key = 'care')
                      and (select count(*) from app.messages where template_key = 'marketplace_product_ready' and to_address = 'sam161@temple.test'
                              and subject = 'DonorDelight is ready') = 1,
  'F · when a product is marked built, the person who asked to be told is emailed, and the interest row records it');
select pg_temp.assert((select told_at is not null and told_status like 'no one to email%' from app.marketplace_interest where center_id = :c and product_key = 'matching')
                      and not exists (select 1 from app.messages where template_key = 'marketplace_product_ready' and to_address = 'ravi161@temple.test'),
  'F · someone who no longer manages the community''s settings is not emailed (and the row says so)');

rollback;
