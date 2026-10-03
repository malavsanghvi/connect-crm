-- 0580–0581 (payments plan PR 2): the payment plugin catalog, per-organization enablement kept in
-- step with the existing processor and method rows, the write-through switches, the derived
-- status, the validation messages, what members may see (one entry per connected processor, Zelle
-- rehearsal in a sandbox), RLS, audit, the demo keep list and the function properties.
-- Everything runs in one transaction on a fresh organization and is rolled back at the end.
\set ON_ERROR_STOP 1
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then
    raise exception 'FAIL: % (got "%")', label, sqlerrm;
  end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 3600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;
-- The stored rows agree with the derived state.
create or replace function pg_temp.in_step(p_center uuid) returns boolean language sql as $$
  select count(*) = 12 and bool_and(cpp.enabled = app.payment_plugin_enabled(p_center, cpp.plugin_key)
                                    and cpp.mode = app.payment_plugin_mode(p_center, cpp.plugin_key)
                                    and cpp.status = app.payment_plugin_status(p_center, cpp.plugin_key))
    from app.center_payment_plugins cpp where cpp.center_id = p_center
$$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;
create or replace function pg_temp.st(p_center uuid, p_key text) returns text language sql as $$
  select status from app.center_payment_plugins where center_id = p_center and plugin_key = p_key
$$;
grant connect_worker to postgres;

\set plg '''00000000-0000-4000-8000-000000006601'''
\set plgb '''00000000-0000-4000-8000-000000006602'''
-- Users: 01 Ami (center admin: integrations.manage), 02 Tanu (treasurer: giving.manage), 03 Mira (adult
-- member, Doshi family), 04 Kavi (Mira's child, 12), 05 Vik (finance volunteer: giving.record_offline only).
-- Another organization (plg66b) has 06 Bela (its treasurer) and 07 Nik (a member), for the isolation checks.

-- ── The catalog ──────────────────────────────────────────────────────────────
select pg_temp.assert((select array_agg(key order by sort) from app.payment_plugins)
                      = array['card','apple_pay','google_pay','bank_debit','paypal','zelle','check','cash','ach_wire','stock','daf','matching_gift'],
  'the catalog has the twelve plugins, in order');
select pg_temp.assert((select bool_and(processor_method = any (app.processor_methods(provider))) from app.payment_plugins where provider is not null)
                      and (select count(*) from app.payment_plugins where family = 'provider_checkout') = 5,
  'the five provider plugins each name one of their processor''s methods');
select pg_temp.assert((select bool_and(depends_on = '{card}') from app.payment_plugins where key in ('apple_pay','google_pay','bank_debit'))
                      and (select records_as = '{ach}' and processor_method = 'ach' from app.payment_plugins where key = 'bank_debit')
                      and (select records_as = '{paypal,venmo,card}' from app.payment_plugins where key = 'paypal'),
  'Apple Pay, Google Pay and ACH ride on Card; ACH records as ach; PayPal records PayPal, Venmo and cards');
select pg_temp.assert((select legacy_method = 'zelle' and family = 'reported_transfer' and sandbox_behavior = 'rehearsal' from app.payment_plugins where key = 'zelle')
                      and (select legacy_method = 'ach' and label = 'ACH and wire' from app.payment_plugins where key = 'ach_wire'),
  'Zelle is a reported transfer with a sandbox rehearsal; ACH and wire is the offline ach method');
select pg_temp.assert((select array_agg(f->>'key' order by f->>'key') from app.payment_plugins, jsonb_array_elements(config_fields) f
                        where key = 'zelle' and (f->>'sensitive')::boolean) = array['name','recipient'],
  'the Zelle address and the name shown in Zelle are marked sensitive (payee fields)');

begin;
-- ── A fresh organization ─────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('66000000-0000-4000-8000-000000000001', 'admin66@plg.example'),
  ('66000000-0000-4000-8000-000000000002', 'treasurer66@plg.example'),
  ('66000000-0000-4000-8000-000000000003', 'mira66@plg.example'),
  ('66000000-0000-4000-8000-000000000004', 'kavi66@plg.example'),
  ('66000000-0000-4000-8000-000000000005', 'vik66@plg.example'),
  ('66000000-0000-4000-8000-000000000006', 'bela66@plg.example'),
  ('66000000-0000-4000-8000-000000000007', 'nik66@plg.example');
insert into app.centers (id, slug, name, short_name) values (:plg, 'plg66', 'Plugin Test Temple', 'PTT');
insert into app.centers (id, slug, name, short_name) values (:plgb, 'plg66b', 'Other Test Temple', 'OTT');
select pg_temp.assert((select count(*) = 12 and bool_and(not enabled and status = 'off') from app.center_payment_plugins where center_id = :plg)
                      and (select count(*) = 12 from app.center_payment_plugins where center_id = :plgb),
  'a new center gets its twelve plugin rows at once, all off (the centers insert trigger)');
insert into app.households (id, center_id, display_name) values ('66000000-0000-4000-8000-0000000000a1', :plg, 'Doshi family');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  ('66000000-0000-4000-8000-0000000000b6', :plgb, 'Bela', 'Bursar', 'bela66@plg.example', '1970-01-01'),
  ('66000000-0000-4000-8000-0000000000b7', :plgb, 'Nik', 'Member', 'nik66@plg.example', '1985-01-01'),
  ('66000000-0000-4000-8000-0000000000b1', :plg, 'Ami', 'Admin', 'admin66@plg.example', '1975-01-01'),
  ('66000000-0000-4000-8000-0000000000b2', :plg, 'Tanu', 'Treasurer', 'treasurer66@plg.example', '1972-01-01'),
  ('66000000-0000-4000-8000-0000000000b3', :plg, 'Mira', 'Doshi', 'mira66@plg.example', '1982-05-05'),
  ('66000000-0000-4000-8000-0000000000b4', :plg, 'Kavi', 'Doshi', 'kavi66@plg.example', current_date - interval '12 years'),
  ('66000000-0000-4000-8000-0000000000b5', :plg, 'Vik', 'Volunteer', 'vik66@plg.example', '1990-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('66000000-0000-4000-8000-0000000000a1', '66000000-0000-4000-8000-0000000000b3', :plg, 'primary', true),
  ('66000000-0000-4000-8000-0000000000a1', '66000000-0000-4000-8000-0000000000b4', :plg, 'child', false);
insert into app.center_users (center_id, user_id, person_id) values
  (:plgb, '66000000-0000-4000-8000-000000000006', '66000000-0000-4000-8000-0000000000b6'),
  (:plgb, '66000000-0000-4000-8000-000000000007', '66000000-0000-4000-8000-0000000000b7'),
  (:plg, '66000000-0000-4000-8000-000000000001', '66000000-0000-4000-8000-0000000000b1'),
  (:plg, '66000000-0000-4000-8000-000000000002', '66000000-0000-4000-8000-0000000000b2'),
  (:plg, '66000000-0000-4000-8000-000000000003', '66000000-0000-4000-8000-0000000000b3'),
  (:plg, '66000000-0000-4000-8000-000000000004', '66000000-0000-4000-8000-0000000000b4'),
  (:plg, '66000000-0000-4000-8000-000000000005', '66000000-0000-4000-8000-0000000000b5');
insert into app.role_grants (center_id, user_id, role_key, scope_kind, scope_id) values
  (:plg, '66000000-0000-4000-8000-000000000001', 'center_admin', 'center', null),
  (:plg, '66000000-0000-4000-8000-000000000002', 'treasurer', 'center', null),
  (:plg, '66000000-0000-4000-8000-000000000005', 'finance_volunteer', 'center', null),
  (:plgb, '66000000-0000-4000-8000-000000000006', 'treasurer', 'center', null);

-- ── The backfill keeps today's behaviour ─────────────────────────────────────
-- Legacy rows as they were before 0580: Stripe takes card and Apple Pay, Zelle is accepted.
select app.payment_processor_ensure(:plg, 'stripe');
update app.center_payment_processors set methods = '{card,apple_pay}' where center_id = :plg and processor = 'stripe';
insert into app.center_payment_methods (center_id, method, accepted, instructions, sort)
values (:plg, 'zelle', true, '{"recipient":"give@plg.example","name":"Plugin Test Temple"}', 3);
delete from app.center_payment_plugins where center_id = :plg;
-- The migration's backfill, exactly.
do $$ begin perform app.payment_plugins_refresh(c.id) from app.centers c; end $$;
select pg_temp.assert(not exists (select 1 from app.centers c
                                   where (select count(*) from app.center_payment_plugins p where p.center_id = c.id) <> 12),
  'after the backfill every center has one row per plugin (12)');
select pg_temp.assert((select array_agg(plugin_key order by plugin_key) from app.center_payment_plugins where center_id = :plg and enabled)
                      = array['apple_pay','card','zelle'],
  'backfill: Stripe {card, apple_pay} turns Card and Apple Pay on, accepted Zelle turns Zelle on; Google Pay and ACH stay off');
update app.center_payment_processors set methods = '{ach,apple_pay,card}' where center_id = :plg and processor = 'stripe';
select pg_temp.assert((select enabled from app.center_payment_plugins where center_id = :plg and plugin_key = 'bank_debit'),
  'ACH (bank_debit) is on only when ach is in the Stripe methods (the trigger keeps the row in step)');
select pg_temp.assert(pg_temp.in_step(:plg), 'the stored rows agree with the derived state');
-- Back to nothing, for the rest of the test.
update app.center_payment_processors set methods = '{}' where center_id = :plg and processor = 'stripe';
delete from app.center_payment_methods where center_id = :plg;
select pg_temp.assert((select count(*) from app.center_payment_plugins where center_id = :plg and enabled) = 0 and pg_temp.in_step(:plg),
  'removing the legacy rows turns the plugins off again (rows updated by the triggers)');
-- Running the backfill again changes nothing (rows are updated only when a value changed).
select count(*) as n_audit from app.audit_log \gset
do $$ begin perform app.payment_plugins_refresh(c.id) from app.centers c; end $$;
select pg_temp.assert((select count(*) from app.audit_log) = :n_audit and pg_temp.in_step(:plg),
  'the backfill is idempotent: running it again writes no audit rows and changes no row');

-- Method lists the old screen could save without the processor's main method.
select app.payment_processor_ensure(:plg, 'paypal');
update app.center_payment_processors set methods = '{apple_pay}' where center_id = :plg and processor = 'stripe';
update app.center_payment_processors set methods = '{venmo}' where center_id = :plg and processor = 'paypal';
select pg_temp.assert((select count(*) from app.center_payment_plugins where center_id = :plg and enabled) = 0,
  'before the fix-up a wallet without Card, or Venmo without PayPal, shows every switch off');
-- The migration's fix-up, exactly.
do $$ begin
  update app.center_payment_processors
     set methods = (select array_agg(distinct m order by m) from unnest(methods || array['card']) m)
   where processor = 'stripe' and not ('card' = any (methods)) and methods && array['apple_pay','google_pay'];
  update app.center_payment_processors
     set methods = (select array_agg(distinct m order by m) from unnest(methods || array['paypal']) m)
   where processor = 'paypal' and not ('paypal' = any (methods)) and cardinality(methods) > 0;
end $$;
select pg_temp.assert((select methods = '{apple_pay,card}' from app.center_payment_processors where center_id = :plg and processor = 'stripe')
                      and (select methods = '{paypal,venmo}' from app.center_payment_processors where center_id = :plg and processor = 'paypal')
                      and (select array_agg(plugin_key order by plugin_key) from app.center_payment_plugins where center_id = :plg and enabled)
                          = array['apple_pay','card','paypal'] and pg_temp.in_step(:plg),
  'the fix-up lists Card for a wallet-only Stripe and PayPal for a Venmo-only PayPal (what the checkout already offered); the switches then say so');
update app.center_payment_processors set methods = '{ach}' where center_id = :plg and processor = 'stripe';
do $$ begin
  update app.center_payment_processors
     set methods = (select array_agg(distinct m order by m) from unnest(methods || array['card']) m)
   where processor = 'stripe' and not ('card' = any (methods)) and methods && array['apple_pay','google_pay'];
end $$;
select pg_temp.assert((select methods = '{ach}' from app.center_payment_processors where center_id = :plg and processor = 'stripe'),
  'an ACH-only Stripe list is left as it is (Card is not added behind the organization''s back)');

-- Connecting gives an emptied method list its starting method back (set_payment_plugin can leave one empty).
update app.center_payment_processors set methods = '{}' where center_id = :plg and processor = 'stripe';
update app.center_payment_processors set methods = '{}' where center_id = :plg and processor = 'paypal';
select app.payment_processor_ensure(:plg, 'stripe');
select app.payment_processor_ensure(:plg, 'paypal');
select pg_temp.assert((select methods = '{card}' from app.center_payment_processors where center_id = :plg and processor = 'stripe')
                      and (select methods = '{paypal}' from app.center_payment_processors where center_id = :plg and processor = 'paypal')
                      and pg_temp.in_step(:plg),
  'app.payment_processor_ensure gives an emptied Stripe or PayPal list its starting method back, and the plugin rows follow');
update app.center_payment_processors set methods = '{apple_pay,card}' where center_id = :plg and processor = 'stripe';
select app.payment_processor_ensure(:plg, 'stripe');
select pg_temp.assert((select methods = '{apple_pay,card}' from app.center_payment_processors where center_id = :plg and processor = 'stripe'),
  'and leaves a list that has methods exactly as it is');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.payment_processor_ensure(uuid,text)', 'execute')
                      and not has_function_privilege('anon', 'app.payment_processor_ensure(uuid,text)', 'execute'),
  'payment_processor_ensure is still not callable over the API');
-- Back to nothing, for the rest of the test.
delete from app.center_payment_processors where center_id = :plg and processor = 'paypal';
update app.center_payment_processors set methods = '{}' where center_id = :plg and processor = 'stripe';
select pg_temp.assert((select count(*) from app.center_payment_plugins where center_id = :plg and enabled) = 0 and pg_temp.in_step(:plg),
  'back to nothing for the rest of the test');

-- ── Who may see and change ───────────────────────────────────────────────────
select pg_temp.claims('66000000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.assert_state($$select app.payment_plugin_settings('00000000-0000-4000-8000-000000006601')$$, '42501',
  'staff without giving or integrations (a finance volunteer) cannot read the plugin settings');
select pg_temp.assert_state($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'check', true, null, null, null, 'x')$$, '42501',
  'nor change them');
reset role;
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert(not exists (select 1 from app.center_payment_plugins), 'a plain member reads no center_payment_plugins rows');
select pg_temp.assert((select count(*) from app.payment_plugins) = 12, 'every signed-in user reads the catalog');
select pg_temp.assert_raises($$select app.payment_plugin_settings('00000000-0000-4000-8000-000000006601')$$,
  'Seeing the payment settings needs', 'a member cannot read the plugin settings');
select pg_temp.assert_raises($$select app.payment_plugin_status('00000000-0000-4000-8000-000000006601', 'card')$$,
  'permission denied', 'the internal status function is not callable over the API');
reset role;

-- ── Isolation between organizations ──────────────────────────────────────────
-- plg66b accepts checks. Each organization's people reach only their own organization's plugins.
insert into app.center_payment_methods (center_id, method, accepted, instructions, sort)
values (:plgb, 'check', true, '{"payee":"Other Test Temple","address":"2 Other Rd, Austin TX"}', 1);
select pg_temp.assert(not has_table_privilege('anon', 'app.payment_plugins', 'select') and not has_table_privilege('anon', 'app.center_payment_plugins', 'select')
                      and not has_table_privilege('authenticated', 'app.payment_plugins', 'insert')
                      and not has_table_privilege('authenticated', 'app.payment_plugins', 'update')
                      and not has_table_privilege('authenticated', 'app.center_payment_plugins', 'insert')
                      and not has_table_privilege('authenticated', 'app.center_payment_plugins', 'update')
                      and not has_table_privilege('authenticated', 'app.center_payment_plugins', 'delete')
                      and has_table_privilege('authenticated', 'app.payment_plugins', 'select')
                      and has_table_privilege('authenticated', 'app.center_payment_plugins', 'select'),
  'anon reads neither table; signed-in users may only select (writes go through the functions)');
select pg_temp.claims('66000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert(not exists (select 1 from app.center_payment_plugins where center_id = :plgb)
                      and (select count(*) from app.center_payment_plugins where center_id = :plg) = 12,
  'a treasurer reads her own organization''s plugin rows and none of another organization''s');
select pg_temp.assert_state($$select app.payment_plugin_settings('00000000-0000-4000-8000-000000006602')$$, '42501',
  'she cannot read another organization''s plugin settings');
select pg_temp.assert_state($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006602', 'cash', true, '{"where":"x"}', null, null, 'x')$$, '42501',
  'nor change them');
select pg_temp.assert_raises($$select app.member_payment_methods('00000000-0000-4000-8000-000000006602')$$, 'Only members of this community',
  'nor read how its members give');
reset role;
select pg_temp.claims('66000000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.assert(exists (select 1 from app.center_payment_plugins where center_id = :plgb) and not exists (select 1 from app.center_payment_plugins where center_id = :plg),
  'the other organization''s treasurer reads only its own rows');
select pg_temp.assert((select p->>'enabled' = 'true' and p#>>'{config,payee}' = 'Other Test Temple'
                         from jsonb_array_elements(app.payment_plugin_settings(:plgb)->'plugins') p where p->>'key' = 'check'),
  'and its own settings, with its own instructions');
select pg_temp.assert_state($$select app.payment_plugin_settings('00000000-0000-4000-8000-000000006601')$$, '42501', 'but not ours');
select pg_temp.assert_state($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'check', false, null, null, null, 'x')$$, '42501', 'and cannot change ours');
reset role;
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert_raises($$select app.member_payment_methods('00000000-0000-4000-8000-000000006602')$$, 'Only members of this community',
  'a member of one organization cannot ask how another organization''s members give');
reset role;
select pg_temp.claims('66000000-0000-4000-8000-000000000007');
set local role authenticated;
select pg_temp.assert((select m->'methods' @? '$[*] ? (@.key == "check" && @.instructions.payee == "Other Test Temple")' from app.member_payment_methods(:plgb) m),
  'a member of the other organization sees how its own members give');
select pg_temp.assert_raises($$select app.member_payment_methods('00000000-0000-4000-8000-000000006601')$$, 'Only members of this community', 'and not ours');
reset role;
delete from app.center_payment_methods where center_id = :plgb;

select pg_temp.claims('66000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert((select jsonb_array_length(s->'plugins') = 12 and s->>'environment' = 'production' and (s->>'can_configure')::boolean
                              and not (s->>'can_connect')::boolean
                         from app.payment_plugin_settings(:plg) s),
  'the treasurer reads twelve plugins; may configure, may not connect');
select pg_temp.assert((select bool_and(not (p->>'enabled')::boolean and p->>'status' = 'off')
                         from jsonb_array_elements(app.payment_plugin_settings(:plg)->'plugins') p),
  'with nothing set up every plugin is off');
select pg_temp.assert((select p->>'problem' from jsonb_array_elements(app.payment_plugin_settings(:plg)->'plugins') p where p->>'key' = 'apple_pay')
                      = 'Turn Card on first.', 'Apple Pay says to turn Card on first');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'apple_pay', true, null, null, null, 'Wallets')$$,
  'Turn Card on first', 'enabling Apple Pay while Card is off is refused');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'venmo_direct', true, null, null, null, 'x')$$,
  'not a payment method Community Connect offers', 'an unknown plugin is refused');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'card', true, null, null, null, ' ')$$,
  'say why', 'a reason is required');
select pg_temp.assert_raises($$insert into app.center_payment_plugins (center_id, plugin_key, enabled) values ('00000000-0000-4000-8000-000000006601', 'cash', true)$$,
  'permission denied', 'staff cannot insert a plugin row directly');
select pg_temp.assert_raises($$update app.center_payment_plugins set enabled = true where center_id = '00000000-0000-4000-8000-000000006601'$$,
  'permission denied', 'staff cannot update plugin rows directly');

-- ── Card: write-through to the Stripe processor row ─────────────────────────
select pg_temp.assert((app.set_payment_plugin(:plg, 'card', true, null, null, null, 'Take cards'))->>'status' = 'needs_setup',
  'turning Card on writes card into the Stripe row; before connecting it needs setup');
reset role;
select pg_temp.assert((select methods = '{card}' and status = 'not_connected' from app.center_payment_processors where center_id = :plg and processor = 'stripe'),
  'Card on = card in the Stripe methods');
select pg_temp.assert((select reason = 'Take cards' and module = 'giving' and actor_user_id = '66000000-0000-4000-8000-000000000002'
                         from app.audit_log where action = 'center_payment_plugins.update' and record_id = :plg || ':card' order by id desc limit 1),
  'the plugin change is audited with the reason, module giving, by the treasurer');
select pg_temp.assert((select reason = 'Take cards' from app.audit_log where action = 'center_payment_processors.update' order by id desc limit 1),
  'the processor row written through carries the same reason');
select pg_temp.claims('66000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert((select p->>'problem' from jsonb_array_elements(app.payment_plugin_settings(:plg)->'plugins') p where p->>'key' = 'card')
                      = 'Connect Stripe first (Card › Connect).', 'Card says to connect Stripe first');
select app.set_payment_plugin(:plg, 'apple_pay', true, null, null, null, 'Apple Pay on Stripe''s page');
select pg_temp.assert((select methods from app.center_payment_processors where center_id = :plg and processor = 'stripe') = '{apple_pay,card}'
                      and (select st from pg_temp.st(:plg, 'apple_pay') st) = 'needs_setup',
  'Apple Pay on adds apple_pay to the Stripe methods; it needs setup while Card does');
-- Validation.
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'card', null, '{"statement_descriptor":"JSH<>"}', null, null, 'x')$$,
  'cannot contain', 'a statement descriptor with < > is refused');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'card', null, '{"currency":"inr"}', null, null, 'x')$$,
  'is not a Card setting', 'Card takes only the statement descriptor');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'apple_pay', null, '{"x":"y"}', null, null, 'x')$$,
  'Apple Pay has no settings of its own', 'Apple Pay has no settings');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'card', null, null, repeat('x', 41), null, 'x')$$,
  'at most 40 characters', 'the name members see is at most 40 characters');
-- Disabling Card on a processor that is not connected takes the wallets with it.
select app.set_payment_plugin(:plg, 'card', false, null, null, null, 'Not yet');
select pg_temp.assert((select methods = '{}' from app.center_payment_processors where center_id = :plg and processor = 'stripe')
                      and (select st from pg_temp.st(:plg, 'apple_pay') st) = 'off' and (select st from pg_temp.st(:plg, 'card') st) = 'off',
  'Card off on a not-connected Stripe empties the method list: Apple Pay goes off with it');
select app.set_payment_plugin(:plg, 'card', true, '{"statement_descriptor":"PTT TEMPLE"}', null, null, 'Cards again');
select app.set_payment_plugin(:plg, 'apple_pay', true, null, null, null, 'Apple Pay again');
reset role;
select pg_temp.assert((select methods = '{apple_pay,card}' and statement_descriptor = 'PTT TEMPLE' from app.center_payment_processors
                        where center_id = :plg and processor = 'stripe'), 'back on, with the statement descriptor written through');
select pg_temp.claims('66000000-0000-4000-8000-000000000002');
set local role authenticated;
select app.set_payment_plugin(:plg, 'card', null, '{"statement_descriptor":null}', null, null, 'Clear the descriptor');
reset role;
select pg_temp.assert((select statement_descriptor is null and methods = '{apple_pay,card}' from app.center_payment_processors where center_id = :plg and processor = 'stripe'),
  'a null statement descriptor in the settings clears it (the methods stay)');
select pg_temp.claims('66000000-0000-4000-8000-000000000002');
set local role authenticated;
select app.set_payment_plugin(:plg, 'card', null, '{"statement_descriptor":"PTT TEMPLE"}', null, null, 'Descriptor again');
select app.set_payment_plugin(:plg, 'card', null, '{}', null, null, 'No change to the descriptor');
reset role;
select pg_temp.assert((select statement_descriptor = 'PTT TEMPLE' from app.center_payment_processors where center_id = :plg and processor = 'stripe'),
  'settings without a statement descriptor leave the saved one alone');

-- ── Offline methods: both ways ───────────────────────────────────────────────
select pg_temp.claims('66000000-0000-4000-8000-000000000002');
set local role authenticated;
select app.set_payment_method(:plg, 'check', true, '{"payee":"Plugin Test Temple","address":"1 Temple Rd, Houston TX"}', 1, 'Checks by mail');
select pg_temp.assert((select st from pg_temp.st(:plg, 'check') st) = 'live' and app.payment_plugin_settings(:plg) @? '$.plugins[*] ? (@.key == "check" && @.enabled == true)',
  'set_payment_method accepting checks turns the Check plugin on through the trigger (production: live)');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'daf', true, '{"legal_name":"PTT","ein":"12345"}', null, null, 'x')$$,
  'ein is 9 digits', 'a DAF EIN must be 9 digits');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'cash', true, null, null, null, 'x')$$,
  'Fill in "where"', 'cash cannot be turned on without saying where');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'zelle', true, '{"recipient":"not an address"}', null, null, 'x')$$,
  'email address or a US phone number', 'the Zelle recipient is an email or a US phone');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'zelle', true, '{"recipient":"give@plg.example"}', null, null, 'x')$$,
  'Add the name shown in Zelle', 'in production Zelle needs the name shown in Zelle');
select app.set_payment_plugin(:plg, 'zelle', true, '{"recipient":"give@plg.example","name":"Plugin Test Temple","memo_hint":"Your member number"}', null, null, 'Zelle');
select app.set_payment_plugin(:plg, 'check', null, null, 'Cheque', 5, 'Our members say cheque');
reset role;
select pg_temp.assert((select accepted and instructions->>'recipient' = 'give@plg.example' from app.center_payment_methods where center_id = :plg and method = 'zelle')
                      and (select st from pg_temp.st(:plg, 'zelle') st) = 'live',
  'Zelle on writes the accepted method with its instructions (production: live)');
select pg_temp.assert((select sort from app.center_payment_methods where center_id = :plg and method = 'zelle') = 3,
  'a method row made by the switch takes its usual place in the old list (Zelle third), so installed apps order it as before');
select pg_temp.assert((select sort from app.center_payment_methods where center_id = :plg and method = 'check') = 1,
  'a plugin order of 5 stays on the plugin row: the old method row keeps its own place (check 1), so installed apps list it as before');
select pg_temp.assert((select label_override = 'Cheque' and sort = 5 and changed_by = '66000000-0000-4000-8000-000000000002' and changed_at is not null
                         from app.center_payment_plugins where center_id = :plg and plugin_key = 'check')
                      and (select accepted from app.center_payment_methods where center_id = :plg and method = 'check'),
  'renaming and reordering keeps Check on and records who changed it');

-- ── Status follows the connection, the $1 test and live mode ─────────────────
select pg_temp.no_claims();
update app.center_payment_processors set status = 'pending_verification' where center_id = :plg and processor = 'stripe';
select pg_temp.assert(pg_temp.st(:plg, 'card') = 'needs_setup'
                      and app.payment_plugin_problem(:plg, 'card') like 'Stripe is still verifying%', 'while Stripe verifies, Card needs setup');
select connection_id as stripe_conn from app.center_payment_processors where center_id = :plg and processor = 'stripe' \gset
set local role connect_worker;
select app.worker_connection_connected(:'stripe_conn', 'acct_66TEST', 'PTT Stripe', null, '{"charges_enabled": true}');
reset role;
select pg_temp.assert(pg_temp.st(:plg, 'card') = 'ready' and pg_temp.st(:plg, 'apple_pay') = 'ready' and pg_temp.in_step(:plg),
  'after the worker connects Stripe (status test) Card and Apple Pay are ready to test');
select pg_temp.assert(app.payment_plugin_problem(:plg, 'card') like 'Run the $1 test%', 'Card says to run the $1 test');
select pg_temp.claims('66000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'card', false, null, null, null, 'Stop cards')$$,
  'Stripe is connected, so it needs at least one way to pay. To stop taking card payments, disconnect Stripe in the Card card.',
  'turning Card off while Stripe is connected is refused, with the way to stop');
select app.set_payment_plugin(:plg, 'apple_pay', false, null, null, null, 'Apple Pay later');
select app.set_payment_plugin(:plg, 'apple_pay', true, null, null, null, 'Apple Pay now');
select pg_temp.assert((select methods from app.center_payment_processors where center_id = :plg and processor = 'stripe') = '{apple_pay,card}',
  'a wallet can be switched off and on while Stripe stays connected');
reset role;
create temp table t66_test (id uuid);
grant all on t66_test to authenticated, connect_worker;
select pg_temp.claims('66000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into t66_test select (app.create_processor_test_checkout(:plg, 'stripe')->>'checkout_id')::uuid;
reset role;
set local role connect_worker;
select app.worker_record_processor_test((select id from t66_test), true, 'pi_66', 're_66', 'Charged and refunded');
reset role;
select pg_temp.assert(pg_temp.st(:plg, 'card') = 'test_passed' and pg_temp.st(:plg, 'apple_pay') = 'test_passed',
  'a passing $1 test-mode test: Card and Apple Pay test passed');

-- Members in production while Stripe is in test mode.
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert((select m->>'online_unavailable' = 'test_mode'
                              and not (m->'methods' @? '$[*] ? (@.family == "provider_checkout")')
                         from app.member_payment_methods(:plg) m),
  'production with Stripe in test mode: no card entry, online_unavailable test_mode');
select pg_temp.assert((app.member_payment_options(:plg)->>'online_unavailable') = 'test_mode', 'member_payment_options agrees (unchanged)');
select pg_temp.assert((select array_agg(e->>'key' order by (e->>'sort')::int) from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e)
                      = array['check','zelle'],
  'members see the offline methods, sorted (Cheque moved first)');
select pg_temp.assert((select e->>'label' = 'Cheque' and e->>'method' = 'check' and e#>>'{instructions,payee}' = 'Plugin Test Temple'
                         from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'check'),
  'an instructions entry carries the name members see, the method and its instructions');
select pg_temp.assert((select e->>'mode' = 'live' and e#>>'{instructions,recipient}' = 'give@plg.example' and e#>>'{instructions,name}' = 'Plugin Test Temple'
                              and e#>>'{report,confirmation}' = 'ask' and (e#>>'{report,window_days}')::int = 10
                         from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'zelle'),
  'production Zelle: the real address and name, report window 10 days, confirmation asked for');
reset role;

-- Live (owner or integrations.manage, fresh 2FA).
select pg_temp.claims('66000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select app.set_payment_mode(:plg, 'stripe', 'live', 'Go live after the pilot');
reset role;
select pg_temp.assert(pg_temp.st(:plg, 'card') = 'live' and pg_temp.st(:plg, 'apple_pay') = 'live' and pg_temp.st(:plg, 'google_pay') = 'off'
                      and (select mode from app.center_payment_plugins where center_id = :plg and plugin_key = 'card') = 'live',
  'live only with the processor live in production');
-- Community Connect holding the organization to test mode (the payments.mode entitlement) is followed too.
insert into app.center_entitlements (center_id, key, value, reason) values (:plg, 'payments.mode', '"test"', 'Held to test while the pilot runs');
select pg_temp.assert(pg_temp.st(:plg, 'card') = 'test_passed' and (select mode from app.center_payment_plugins where center_id = :plg and plugin_key = 'card') = 'test'
                      and pg_temp.in_step(:plg),
  'a payments.mode entitlement of "test" brings the stored rows back to test mode (the entitlement trigger)');
update app.center_entitlements set value = '"live"' where center_id = :plg and key = 'payments.mode';
select pg_temp.assert(pg_temp.st(:plg, 'card') = 'live' and pg_temp.in_step(:plg), 'changing the entitlement is followed');
insert into app.center_entitlements (center_id, key, value, reason) values (:plg, 'max_people', '5000', 'Unrelated limit');
delete from app.center_entitlements where center_id = :plg and key in ('payments.mode', 'max_people');
select pg_temp.assert(pg_temp.st(:plg, 'card') = 'live' and pg_temp.in_step(:plg), 'removing it is followed too; another entitlement changes nothing here');
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert((select e->>'provider' = 'stripe' and e->>'mode' = 'live' and e->'wallets' = '["apple_pay"]'::jsonb and e->'also' = '[]'::jsonb
                         from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'card')
                      and app.member_payment_methods(:plg)->>'online_unavailable' is null,
  'Card is offered: Stripe, live, with Apple Pay as its wallet');
select pg_temp.assert((app.member_payment_options(:plg)#>'{online,methods}') ? 'apple_pay',
  'member_payment_options reflects the Apple Pay switch (it reads the same Stripe methods)');
select pg_temp.assert(app.member_payment_methods(:plg)::text not like '%acct_66TEST%' and app.member_payment_methods(:plg)::text not like '%connection%',
  'no account id or connection detail reaches members');
reset role;
-- Community Connect pauses Card in the catalog (the suspend screen itself is plan PR 5).
savepoint paused;
update app.payment_plugins set status = 'suspended' where key = 'card';
select pg_temp.assert(app.payment_plugin_status(:plg, 'card') = 'suspended' and app.payment_plugin_status(:plg, 'apple_pay') = 'needs_setup'
                      and app.payment_plugin_problem(:plg, 'card') = 'Community Connect has paused Card for now.'
                      and app.payment_plugin_problem(:plg, 'apple_pay') = 'Community Connect has paused Card for now.',
  'a paused Card reads "paused"; Apple Pay, which rides on it, needs setup and says why');
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert(not (app.member_payment_methods(:plg)->'methods' @? '$[*] ? (@.key == "card")'),
  'members are not offered a paused Card');
reset role;
rollback to savepoint paused;
select pg_temp.claims('66000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.assert_raises($$select app.member_payment_methods('00000000-0000-4000-8000-000000006601')$$,
  'Only an adult of the family can pay for it', 'a child is refused');
reset role;
select pg_temp.claims('10000000-0000-4000-8000-000000000005');
set local role authenticated;
select pg_temp.assert_raises($$select app.member_payment_methods('00000000-0000-4000-8000-000000006601')$$,
  'Only members of this community', 'a member of another community is refused');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select pg_temp.assert_raises($$select app.member_payment_methods('00000000-0000-4000-8000-000000006601')$$,
  'Sign in', 'nobody signed in: refused');
reset role;

-- Offline only: no provider entries.
select pg_temp.no_claims();
update app.centers set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{payments}', coalesce(rules->'payments', '{}'::jsonb) || '{"offline_only": true}')
 where id = :plg;
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert((select m->>'online_unavailable' = 'offline_only' and not (m->'methods' @? '$[*] ? (@.family == "provider_checkout")')
                              and jsonb_array_length(m->'methods') = 2
                         from app.member_payment_methods(:plg) m), 'offline only: no provider entries, the offline ones stay');
reset role;
select pg_temp.no_claims();
update app.centers set rules = rules #- '{payments,offline_only}' where id = :plg;

-- ── A sandbox: test mode only, Zelle rehearsal, every connected processor ───
savepoint sandbox;
update app.centers set environment = 'sandbox', rules = coalesce(rules, '{}'::jsonb) || '{"payments": {"zelle": {"report_window_days": 14}}}'
 where id = :plg;
select pg_temp.assert(not exists (select 1 from app.center_payment_plugins where center_id = :plg and status = 'live') and pg_temp.in_step(:plg),
  'a sandbox never reports live (the environment trigger recomputes every row)');
select pg_temp.assert(pg_temp.st(:plg, 'card') = 'test_passed' and pg_temp.st(:plg, 'check') = 'ready',
  'in a sandbox Card shows its test-mode pass, an offline method is ready');
select pg_temp.claims('66000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select pg_temp.assert_state($$select app.set_payment_mode('00000000-0000-4000-8000-000000006601', 'stripe', 'live', 'Go live')$$,
  'CCENT', 'a sandbox still cannot switch Stripe to live (CCENT)');
reset role;
-- PayPal connected (test) next to the default Stripe: G4.
select pg_temp.no_claims();
select app.payment_processor_ensure(:plg, 'paypal');
update app.integration_connections set status = 'connected', settings = settings || '{"connect_method":"email","paypal_email":"pay@plg.example"}'
 where center_id = :plg and provider = 'paypal';
update app.center_payment_processors set status = 'test', methods = '{paypal,venmo}' where center_id = :plg and processor = 'paypal';
select pg_temp.claims('66000000-0000-4000-8000-000000000002');
set local role authenticated;
select app.set_default_payment_processor(:plg, 'stripe', 'Stripe at checkout');
select pg_temp.assert_raises($$select app.set_payment_plugin('00000000-0000-4000-8000-000000006601', 'paypal', false, null, null, null, 'No PayPal')$$,
  'disconnect PayPal in the PayPal card', 'turning PayPal off while it is connected is refused the same way');
select pg_temp.assert((select p->>'status' = 'ready' and p->>'mode' = 'test' from jsonb_array_elements(app.payment_plugin_settings(:plg)->'plugins') p
                        where p->>'key' = 'paypal'), 'PayPal is ready to test in the sandbox');
select pg_temp.assert((select p#>>'{config,recipient}' = 'give@plg.example' from jsonb_array_elements(app.payment_plugin_settings(:plg)->'plugins') p
                        where p->>'key' = 'zelle'), 'staff always see the real Zelle address');
reset role;
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert((select array_agg(e->>'key' order by (e->>'sort')::int) from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e
                        where e->>'family' = 'provider_checkout') = array['card','paypal'],
  'G4: with Stripe the default and PayPal connected, both are offered (one entry per processor)');
select pg_temp.assert((select e->>'mode' = 'test' and e->'also' = '["venmo"]'::jsonb and e->'wallets' = '[]'::jsonb
                         from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'paypal')
                      and (select e->>'mode' = 'test' from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'card'),
  'both in test mode; PayPal lists Venmo as also');
select pg_temp.assert((select e->>'mode' = 'rehearsal' and e->'instructions' = '{"name":"Sandbox: no real money moves","memo_hint":"Your member number"}'::jsonb
                              and (e#>>'{report,window_days}')::int = 14
                         from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'zelle'),
  'sandbox Zelle is a rehearsal: "Sandbox: no real money moves" and the memo hint; the report window comes from the rules');
reset role;
select pg_temp.no_claims();
update app.centers set rules = jsonb_set(rules, '{payments,zelle,report_window_days}', '100') where id = :plg;
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert((select (e#>>'{report,window_days}')::int = 30 from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'zelle'),
  'a report window above 30 days reads 30');
reset role;
select pg_temp.no_claims();
update app.centers set rules = jsonb_set(rules, '{payments,zelle,report_window_days}', '1') where id = :plg;
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert((select (e#>>'{report,window_days}')::int = 3 from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'zelle'),
  'and below 3 days reads 3 (plan PR 3''s own range)');
reset role;
select pg_temp.no_claims();
update app.centers set rules = jsonb_set(rules, '{payments,zelle,report_window_days}', '14') where id = :plg;
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert(app.member_payment_methods(:plg)::text not like '%give@plg.example%' and app.member_payment_methods(:plg)::text not like '%pay@plg.example%',
  'the real Zelle address (and the PayPal email) appear nowhere in the member answer');
select pg_temp.assert((select (e#>>'{report,available}')::boolean
                              = (to_regprocedure('app.report_payment(uuid,uuid,text,bigint,date,text,text,uuid[],text)') is not null)
                         from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'zelle'),
  'report.available says whether app.report_payment exists');
reset role;
-- With a stand-in app.report_payment of exactly that signature (and a stand-in reports table), rolled back.
savepoint stand_ins;
do $$ begin
  if to_regprocedure('app.report_payment(uuid,uuid,text,bigint,date,text,text,uuid[],text)') is null then
    execute 'create function app.report_payment(uuid, uuid, text, bigint, date, text, text, uuid[], text) returns jsonb language sql as ''select null::jsonb''';
  end if;
  if to_regclass('app.payment_reports') is null then
    execute 'create table app.payment_reports (center_id uuid, status text, is_test boolean)';
    execute 'insert into app.payment_reports values (''00000000-0000-4000-8000-000000006601'', ''matched'', true)';
  end if;
end $$;
select pg_temp.claims('66000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert((select (e#>>'{report,available}')::boolean from jsonb_array_elements(app.member_payment_methods(:plg)->'methods') e where e->>'key' = 'zelle'),
  'with app.report_payment present, report.available is true');
reset role;
select pg_temp.assert(app.payment_plugin_status(:plg, 'zelle') = 'test_passed'
                      or exists (select 1 from pg_class where relname = 'payment_reports' and relnamespace = 'app'::regnamespace
                                  and not exists (select 1 from app.payment_reports where center_id = '00000000-0000-4000-8000-000000006601')),
  'a matched rehearsal report makes sandbox Zelle "test passed"');
rollback to savepoint stand_ins;
rollback to savepoint sandbox;

-- ── payment_plugin_config_problem (mirrored in TypeScript) ───────────────────
select pg_temp.assert(app.payment_plugin_config_problem('zelle', '{"recipient":"treasurer"}', 'test') = 'The Zelle recipient is an email address or a US phone number.'
                      and app.payment_plugin_config_problem('zelle', '{}', 'test') = 'Fill in "recipient" before accepting zelle.'
                      and app.payment_plugin_config_problem('zelle', '{"recipient":"+1 713 555 0142"}', 'test') is null
                      and app.payment_plugin_config_problem('zelle', '{"recipient":"give@plg.example"}', 'live')
                          = 'Add the name shown in Zelle so members can check they are paying the right account.',
  'Zelle: recipient, a missing recipient, a phone number, and the name in live mode');
select pg_temp.assert(app.payment_plugin_config_problem('card', '{"statement_descriptor":"JAIN SOCIETY OF HOUSTON TX"}', 'test') = 'The statement descriptor can be at most 22 characters.'
                      and app.payment_plugin_config_problem('paypal', '{"statement_descriptor":"PTT TEMPLE"}', 'live') is null
                      and app.payment_plugin_config_problem('card', '{"x":"1"}', 'test') = '"x" is not a Card setting; the only one is the statement descriptor.',
  'Card and PayPal: the statement descriptor only');
select pg_temp.assert(app.payment_plugin_config_problem('daf', '{"legal_name":"PTT","ein":"12-345"}', 'test') = 'The EIN is 9 digits, written like 12-3456789.'
                      and app.payment_plugin_config_problem('matching_gift', '{"legal_name":"PTT","ein":"12-3456789"}', 'test') is null
                      and app.payment_plugin_config_problem('google_pay', '{"a":"b"}', 'test') = 'Google Pay has no settings of its own.'
                      and app.payment_plugin_config_problem('nope', '{}', 'test') = 'That is not a payment method Community Connect offers.',
  'the EIN, a plugin with no settings, an unknown plugin');

-- ── The Giving switch ────────────────────────────────────────────────────────
savepoint giving_off;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:plg, 'giving', false, 'test 0580');
select pg_temp.claims('66000000-0000-4000-8000-000000000002');
set local role authenticated;
select pg_temp.assert_raises($$select app.payment_plugin_settings('00000000-0000-4000-8000-000000006601')$$, 'switched off',
  'with Giving off the plugin settings are refused');
select pg_temp.assert(not exists (select 1 from app.center_payment_plugins where center_id = '00000000-0000-4000-8000-000000006601'),
  'with Giving off the plugin rows are hidden (module switch policy)');
reset role;
rollback to savepoint giving_off;

-- ── The demo keep list ───────────────────────────────────────────────────────
select pg_temp.assert(app.demo_keep_tables() = array[
    'centers','center_owners','role_grants','org_agreements','org_profiles','org_leaders','org_documents',
    'center_entitlements','center_modules','number_sequences','support_grants',
    'center_setup_steps','center_attestations','golive_requests','golive_approvals','sandbox_codes','sandbox_expiry_notices','center_demo_state',
    'integration_connections','integration_secrets','secret_access_log','oauth_states','webhook_events',
    'center_payment_processors','payment_processor_tests','paypal_email_verifications','center_payment_plugins',
    'email_domains','email_senders','messaging_settings','message_suppressions','texting_registrations',
    'whatsapp_accounts','whatsapp_template_submissions','sandbox_test_recipients','recipient_verifications',
    'center_domains','member_join_codes',
    'qbo_oauth_states','qbo_pull_runs','qbo_test_posts','qbo_accounts','qbo_classes','qbo_locations','qbo_items',
    'qbo_tax_codes','qbo_payment_methods','qbo_customers','qbo_transactions',
    'legal_documents','message_templates','receipt_templates','import_mappings','dietary_options',
    'audit_log','jobs']::text[],
  'demo_keep_tables is the 0546 list plus center_payment_plugins');
select pg_temp.assert('center_payment_plugins' <> all (app.demo_clear_tables()) and 'payment_plugins' <> all (app.demo_clear_tables()),
  'a demo clear keeps the plugin rows (and never touches the catalog)');
rollback;

-- ── Function properties ──────────────────────────────────────────────────────
select pg_temp.assert((select bool_and(p.prosecdef = (p.oid <> 'app.payment_plugin_config_problem(text,jsonb,text)'::regprocedure)
                                       and 'search_path=app, public, extensions' = any (p.proconfig)
                                       and not has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                        where p.oid in ('app.payment_plugin_enabled(uuid,text)'::regprocedure, 'app.payment_plugin_mode(uuid,text)'::regprocedure,
                                        'app.payment_plugin_status(uuid,text)'::regprocedure, 'app.payment_plugin_problem(uuid,text)'::regprocedure,
                                        'app.payment_plugins_refresh(uuid)'::regprocedure, 'app.payment_plugins_sync()'::regprocedure,
                                        'app.payment_plugin_entry(uuid,text)'::regprocedure, 'app.payment_plugin_settings(uuid)'::regprocedure,
                                        'app.set_payment_plugin(uuid,text,boolean,jsonb,text,integer,text)'::regprocedure,
                                        'app.payment_plugin_config_problem(text,jsonb,text)'::regprocedure,
                                        'app.member_payment_methods(uuid)'::regprocedure)),
  'every new function pins search_path = app, public, extensions, is security definer (but the immutable problem function), and anon runs none');
select pg_temp.assert(has_function_privilege('authenticated', 'app.payment_plugin_settings(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.set_payment_plugin(uuid,text,boolean,jsonb,text,integer,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.payment_plugin_config_problem(text,jsonb,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.member_payment_methods(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.payment_plugin_status(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.payment_plugin_problem(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.payment_plugins_refresh(uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.payment_plugins_sync()', 'execute')
                      and not has_function_privilege('authenticated', 'app.payment_plugin_entry(uuid,text)', 'execute'),
  'signed-in users run only the settings, the switch, the problem check and the member answer');
select pg_temp.assert((select count(*) = 6 from pg_trigger where tgname = 'payment_plugins_sync' and not tgisinternal
                         and tgrelid in ('app.center_payment_processors'::regclass, 'app.center_payment_methods'::regclass,
                                         'app.payment_processor_tests'::regclass, 'app.integration_connections'::regclass, 'app.centers'::regclass,
                                         'app.center_entitlements'::regclass)),
  'the sync trigger sits on the six tables it follows');
