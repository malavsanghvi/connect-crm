-- 0862 (build slice 1 of docs/PAYMENT_ADDONS.md, part two): cover the card fee, the fee rates, the quote, the checkout, the recording.
--   A. The formula: the table of section 5.2 and the brute-force invariant (the organization is never short, at most 1 cent over)
--   B. The fee rates: insert-only, set by a platform admin only, an organization's own rate, the staff view
--   C. Nothing on: the quote and the checkout behave exactly as before (the old seven-argument call), refusals in plain words
--   D. The organization's switch (the lock of 0410 is lifted: Stripe only, with a reason, audited)
--   E. Fee-cover through the quote and the checkout: which payments, which methods, who, other kinds of community, a paused Card
--   F. The Chip In through the quote and the checkout: the yearly limit across checkouts, the lock, release, sandbox test rows
--   G. Recording: the total and the application fee are checked, the gift alone is applied, the ledger is collected, QuickBooks
--   H. Credit and the payments report are unchanged by a covered fee
--   I. Who reads and writes what (the RLS matrix of 6.7), the grants, and offline rows forced to zero extras
-- Everything runs in one transaction that is rolled back, in its own communities and with its own people.
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
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '{"x-client-app":"member","x-client-screen":"/pay"}', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- The money line of a quote or a checkout, as text: gift/fee/chip -> org charge -> total.
create or replace function pg_temp.line(j jsonb) returns text language sql immutable as $$
  select (j->>'gift_cents') || '/' || (j->>'covered_fee_cents') || '/' || (j->>'chip_in_cents') || ' -> ' || coalesce(j->>'org_charge_cents', j->>'amount_cents') || ' -> ' || (j->>'total_cents')
$$;

grant connect_worker to postgres;
\set c '''00000000-0000-4000-8000-000000008621'''
\set s '''00000000-0000-4000-8000-000000008622'''
\set pp '''00000000-0000-4000-8000-000000008623'''
\set cad '''00000000-0000-4000-8000-000000008624'''
\set off '''00000000-0000-4000-8000-000000008625'''
\set h1 '''86200000-0000-4000-8000-0000000000a1'''
\set h2 '''86200000-0000-4000-8000-0000000000a2'''
\set hs '''86200000-0000-4000-8000-0000000000a3'''
\set hp '''86200000-0000-4000-8000-0000000000a4'''
\set hc '''86200000-0000-4000-8000-0000000000a5'''
\set ho '''86200000-0000-4000-8000-0000000000a6'''
\set mina '''86200000-0000-4000-8000-000000000001'''
\set raj '''86200000-0000-4000-8000-000000000002'''
\set teen '''86200000-0000-4000-8000-000000000003'''
\set tara '''86200000-0000-4000-8000-000000000004'''
\set olga '''86200000-0000-4000-8000-000000000005'''
\set nina '''86200000-0000-4000-8000-000000000006'''
\set plat '''86200000-0000-4000-8000-000000000007'''
\set sam '''86200000-0000-4000-8000-000000000008'''
\set pat '''86200000-0000-4000-8000-000000000009'''
\set cam '''86200000-0000-4000-8000-00000000000a'''
\set oli '''86200000-0000-4000-8000-00000000000b'''
\set pmina '''86200000-0000-4000-8000-000000000101'''
\set praj '''86200000-0000-4000-8000-000000000102'''
\set pteen '''86200000-0000-4000-8000-000000000103'''
\set pnina '''86200000-0000-4000-8000-000000000106'''
\set psam '''86200000-0000-4000-8000-000000000108'''
\set ppat '''86200000-0000-4000-8000-000000000109'''
\set pcam '''86200000-0000-4000-8000-00000000010a'''
\set poli '''86200000-0000-4000-8000-00000000010b'''

begin;
-- ── Fixtures: five communities, their people, Stripe (or PayPal) connected, and a platform admin ──
insert into auth.users (id, email) values
  (:mina, 'mina@fee862.test'), (:raj, 'raj@fee862.test'), (:teen, 'teen@fee862.test'), (:tara, 'tara@fee862.test'),
  (:olga, 'olga@fee862.test'), (:nina, 'nina@fee862.test'), (:plat, 'plat@fee862.test'), (:sam, 'sam@fee862.test'),
  (:pat, 'pat@fee862.test'), (:cam, 'cam@fee862.test'), (:oli, 'oli@fee862.test');
insert into app.accounts (user_id, is_platform_admin) values (:plat, true)
  on conflict (user_id) do update set is_platform_admin = excluded.is_platform_admin;
insert into app.centers (id, slug, name, short_name, time_zone, currency) values
  (:c, 'fee862', 'Fee 862 Temple', 'F862', 'America/Chicago', 'USD'),
  (:s, 'fee862-sandbox', 'Fee 862 Sandbox', 'S862', 'America/Chicago', 'USD'),
  (:pp, 'fee862-paypal', 'Fee 862 PayPal', 'P862', 'America/Chicago', 'USD'),
  (:cad, 'fee862-cad', 'Fee 862 Canada', 'C862', 'America/Toronto', 'CAD'),
  (:off, 'fee862-offline', 'Fee 862 Offline', 'O862', 'America/Chicago', 'USD');
update app.centers set environment = 'sandbox' where id = :s;
update app.centers set rules = jsonb_build_object('payments', jsonb_build_object('offline_only', true)) where id = :off;
insert into app.households (id, center_id, display_name) values
  (:h1, :c, 'Rao family'), (:h2, :c, 'Shah family'), (:hs, :s, 'Sandbox family'), (:hp, :pp, 'PayPal family'),
  (:hc, :cad, 'Canada family'), (:ho, :off, 'Offline family');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (:pmina, :c, 'Mina', 'Rao', '1980-01-01'), (:praj, :c, 'Raj', 'Rao', '1979-01-01'),
  (:pteen, :c, 'Teen', 'Rao', current_date - interval '12 years'), (:pnina, :c, 'Nina', 'Shah', '1985-01-01'),
  (:psam, :s, 'Sam', 'Box', '1985-01-01'), (:ppat, :pp, 'Pat', 'Pal', '1985-01-01'),
  (:pcam, :cad, 'Cam', 'Ads', '1985-01-01'), (:poli, :off, 'Oli', 'Off', '1985-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :pmina, :c, 'primary', true), (:h1, :praj, :c, 'spouse', false), (:h1, :pteen, :c, 'child', false),
  (:h2, :pnina, :c, 'primary', true), (:hs, :psam, :s, 'primary', true), (:hp, :ppat, :pp, 'primary', true),
  (:hc, :pcam, :cad, 'primary', true), (:ho, :poli, :off, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  (:c, :mina, :pmina), (:c, :raj, :praj), (:c, :teen, :pteen), (:c, :nina, :pnina), (:s, :sam, :psam),
  (:pp, :pat, :ppat), (:cad, :cam, :pcam), (:off, :oli, :poli);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer');
insert into app.center_owners (center_id, user_id) values (:c, :olga);
insert into app.integration_connections (center_id, provider, status, external_account_id, display_name, settings)
select x.id, 'stripe', 'connected', 'acct_862' || x.n, 'Stripe', '{"mode":"live"}'::jsonb
  from (values (:c::uuid, 'c'), (:s::uuid, 's'), (:cad::uuid, 'k'), (:off::uuid, 'o')) x(id, n)
on conflict (center_id, provider) do update set status = 'connected', external_account_id = excluded.external_account_id;
insert into app.integration_connections (center_id, provider, status, external_account_id, display_name, settings)
values (:pp, 'paypal', 'connected', 'MERCH862', 'PayPal', '{"mode":"live","connect_method":"partner"}'::jsonb)
on conflict (center_id, provider) do update set status = 'connected', external_account_id = excluded.external_account_id;
insert into app.center_payment_processors (center_id, processor, connection_id, is_default, methods, status)
select ic.center_id, ic.provider, ic.id, true, case ic.provider when 'stripe' then array['card','ach','apple_pay','google_pay'] else array['paypal'] end,
       case when ic.center_id = :s then 'test' else 'live' end
  from app.integration_connections ic where ic.center_id in (:c, :s, :pp, :cad, :off) and ic.provider in ('stripe','paypal')
on conflict (center_id, processor) do update set connection_id = excluded.connection_id, is_default = true, status = excluded.status, methods = excluded.methods;
-- Pledges of the Rao family (c): gifts, a labh, dues, a ticket, and a store pledge; and one gift pledge in each other community.
insert into app.pledges (id, center_id, household_id, pledged_by_person_id, source, amount_cents, pledged_at) values
  ('86200000-0000-4000-8000-0000000000b1', :c, :h1, :pmina, 'general', 20000, now() - interval '10 days'),
  ('86200000-0000-4000-8000-0000000000b2', :c, :h1, :pmina, 'labh', 5000, now() - interval '9 days'),
  ('86200000-0000-4000-8000-0000000000b3', :c, :h1, :pmina, 'general', 40000, now() - interval '8 days'),
  ('86200000-0000-4000-8000-0000000000b4', :c, :h1, :pmina, 'membership_fee', 6000, now() - interval '30 days'),
  ('86200000-0000-4000-8000-0000000000b5', :c, :h1, :pmina, 'rsvp_commitment', 3000, now() - interval '7 days'),
  ('86200000-0000-4000-8000-0000000000b6', :c, :h1, :pmina, 'store', 1000, now() - interval '6 days'),
  ('86200000-0000-4000-8000-0000000000b7', :c, :h1, :pmina, 'general', 100000, now() - interval '5 days'),
  ('86200000-0000-4000-8000-0000000000b8', :s, :hs, :psam, 'general', 20000, now() - interval '1 day'),
  ('86200000-0000-4000-8000-0000000000b9', :pp, :hp, :ppat, 'general', 20000, now() - interval '1 day'),
  ('86200000-0000-4000-8000-0000000000ba', :cad, :hc, :pcam, 'general', 20000, now() - interval '1 day'),
  ('86200000-0000-4000-8000-0000000000bb', :c, :h2, :pnina, 'general', 20000, now() - interval '1 day');
\set g1 '''86200000-0000-4000-8000-0000000000b1'''
\set lab '''86200000-0000-4000-8000-0000000000b2'''
\set g3 '''86200000-0000-4000-8000-0000000000b3'''
\set dues '''86200000-0000-4000-8000-0000000000b4'''
\set tix '''86200000-0000-4000-8000-0000000000b5'''
\set stp '''86200000-0000-4000-8000-0000000000b6'''
\set g7 '''86200000-0000-4000-8000-0000000000b7'''

-- ═════════════════════════════════════════════════════════════════════════════
-- A. The formula (docs/PAYMENT_ADDONS.md §5.2): so the organization nets exactly the gift
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(app._fee_class('card') = 'card' and app._fee_class('Apple_Pay') = 'card' and app._fee_class('google_pay') = 'card'
                      and app._fee_class('ach') = 'ach' and app._fee_class('paypal') is null and app._fee_class(null) is null,
  'A · cards and wallets are the card class, bank debit its own; anything else has no class');
-- The table of §5.2 (card 2.9% + 30 cents; bank debit 0.8% capped at $5.00). F, then Stripe's fee on the whole charge.
select pg_temp.assert(app._fee_cover(290, 30, null, 10000) = 330 and app._fee_charge(290, 30, null, 10000 + 330) = 330,
  'A · card, cover, $100.00 gift: F $3.30, charge $103.30, Stripe takes $3.30');
select pg_temp.assert(app._fee_cover(290, 30, null, 10000 + 500) = 345 and app._fee_charge(290, 30, null, 10000 + 500 + 345) = 345,
  'A · card, cover, $100.00 gift and a $5.00 Chip In: F $3.45, charge $108.45, Stripe takes $3.45');
select pg_temp.assert(app._fee_charge(290, 30, null, 10000) = 320 and app._fee_charge(290, 30, null, 10500) = 335
                      and (500 - (app._fee_charge(290, 30, null, 10500) - app._fee_charge(290, 30, null, 10000))) = 485,
  'A · card, no cover, Chip In: Stripe takes $3.35 instead of $3.20 and Weaver absorbs the extra $0.15 (application fee $4.85)');
select pg_temp.assert(app._fee_cover(80, 0, 500, 10000) = 81 and app._fee_charge(80, 0, 500, 10000 + 81) = 81,
  'A · bank debit, cover, $100.00: F $0.81');
select pg_temp.assert(app._fee_cover(80, 0, 500, 100000 + 500) = 500 and app._fee_charge(80, 0, 500, 100000 + 500 + 500) = 500,
  'A · bank debit, cover, $1,000.00 and a $5.00 Chip In: the fee is capped at $5.00');
select pg_temp.assert(app._fee_charge(290, 30, null, 0) = 30 and app._fee_charge(290, 30, null, 50) = 31 and app._fee_charge(80, 0, 500, 10000000) = 500,
  'A · the fee on a $0.50 charge is 1 cent and 30 more, and a fee never goes past its cap');
-- The invariant, brute force: every gift from $0.50 to $300.00 with a Chip In of $0, $1, $2, $5 and $10, both rates. The
-- organization is never short, and never more than 1 cent over.
select pg_temp.assert((select count(*) = 0
                         from generate_series(50, 30000) g
                         cross join (values (0), (100), (200), (500), (1000)) ci(c)
                         cross join (values (290, 30, null::integer), (80, 0, 500)) r(bps, fixed, cap)
                         cross join lateral (select app._fee_cover(r.bps, r.fixed, r.cap, g + ci.c) as f) x
                        where app._fee_charge(r.bps, r.fixed, r.cap, g + ci.c + x.f) > x.f
                           or x.f - app._fee_charge(r.bps, r.fixed, r.cap, g + ci.c + x.f) > 1),
  'A · brute force: for every gift from $0.50 to $300.00 with a Chip In of $0, $1, $2, $5 or $10, on both rates, the organization is never short and at most 1 cent over');
select pg_temp.assert((select count(*) = 0
                         from generate_series(30001, 200000, 7) g
                         cross join (values (0), (500), (1000)) ci(c)
                         cross join lateral (select app._fee_cover(80, 0, 500, g + ci.c) as f) x
                        where app._fee_charge(80, 0, 500, g + ci.c + x.f) > x.f
                           or x.f - app._fee_charge(80, 0, 500, g + ci.c + x.f) > 1),
  'A · and on bank debit across the $5.00 cap (gifts up to $2,000.00)');
select pg_temp.assert_raises($$select app._fee_cover(290, 30, null, -1)$$, 'not valid', 'A · a negative amount is refused');

-- ═════════════════════════════════════════════════════════════════════════════
-- B. The fee rates: one place, insert-only, set by a platform admin only
-- ═════════════════════════════════════════════════════════════════════════════
select id as card_rate from app.payment_fee_rates where center_id is null and method_class = 'card' \gset
select pg_temp.assert((select count(*) = 2 and bool_and(center_id is null) from app.payment_fee_rates where center_id is null and method_class in ('card','ach'))
                      and (select bps = 290 and fixed_cents = 30 and cap_cents is null from app.payment_fee_rates where center_id is null and method_class = 'card')
                      and (select bps = 80 and fixed_cents = 0 and cap_cents = 500 from app.payment_fee_rates where center_id is null and method_class = 'ach'),
  'B · the platform defaults are Stripe''s US rates: card 2.9% + 30 cents, bank debit 0.8% capped at $5.00, each with its source');
select pg_temp.assert((select bool_and(char_length(source_note) > 20 and effective_from <= now()) from app.payment_fee_rates where center_id is null),
  'B · each default carries a dated source note and is already in effect');
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select pg_temp.assert((app.fee_estimate(:c, 'card', 10000)->>'fee_cents')::int = 330 and (app.fee_estimate(:c, 'card', 10000)->>'charge_cents')::int = 10330
                      and app.fee_estimate(:c, 'card', 10000)->>'method_class' = 'card' and (app.fee_estimate(:c, 'card', 10000)->>'estimate')::boolean
                      and not (app.fee_estimate(:c, 'card', 10000)#>>'{rate,custom}')::boolean,
  'B · a member asks the database for the card fee on $100.00: $3.30, charge $103.30, an estimate on the standard rate');
select pg_temp.assert((app.fee_estimate(:c, 'apple_pay', 10000)->>'fee_cents')::int = 330 and (app.fee_estimate(:c, 'google_pay', 10000)->>'fee_cents')::int = 330
                      and (app.fee_estimate(:c, 'ach', 10000)->>'fee_cents')::int = 81,
  'B · wallets are cards ($3.30) and bank debit is $0.81');
select pg_temp.assert_raises($$select app.fee_estimate('00000000-0000-4000-8000-000000008621', 'paypal', 10000)$$, 'card or bank account', 'B · PayPal has no estimate');
select pg_temp.assert_raises($$select app.fee_estimate('00000000-0000-4000-8000-000000008621', 'card', 49)$$, 'between $0.50', 'B · under $0.50 is refused');
select pg_temp.assert_state($$select app.fee_estimate('00000000-0000-4000-8000-000000008622', 'card', 10000)$$, '42501', 'B · and so is a community the member does not belong to');
select pg_temp.as_none();
select pg_temp.assert_state($$select app.fee_estimate('00000000-0000-4000-8000-000000008621', 'card', 10000)$$, '42501', 'B · signed out: refused');

-- Only a platform admin adds a rate, with a source and a reason; nothing is ever changed or removed.
select pg_temp.as_user('86200000-0000-4000-8000-000000000004');
select pg_temp.assert_state($$select app.platform_set_fee_rate('00000000-0000-4000-8000-000000008624', 'card', 220, 30, null, 'My own rate', 'I would like to')$$, '42501',
  'B · the treasurer cannot set a rate');
select pg_temp.as_user('86200000-0000-4000-8000-000000000005');
select pg_temp.assert_state($$select app.platform_set_fee_rate('00000000-0000-4000-8000-000000008624', 'card', 220, 30, null, 'My own rate', 'Owner')$$, '42501',
  'B · nor the organization''s owner: an organization cannot lower its own estimate');
select pg_temp.assert_raises($$insert into app.payment_fee_rates (center_id, method_class, bps, source_note) values ('00000000-0000-4000-8000-000000008624', 'card', 1, 'x')$$,
  'permission denied', 'B · nor write the table directly');
select pg_temp.as_user('86200000-0000-4000-8000-000000000007');
select pg_temp.assert_raises($$select app.platform_set_fee_rate('00000000-0000-4000-8000-000000008624', 'paypal', 220, 30, null, 'Letter', 'x')$$, 'card or bank debit', 'B · only card or bank debit');
select pg_temp.assert_raises($$select app.platform_set_fee_rate('00000000-0000-4000-8000-000000008624', 'card', 1001, 30, null, 'Letter', 'x')$$, 'between 0% and 10%', 'B · a percentage over 10% is refused');
select pg_temp.assert_raises($$select app.platform_set_fee_rate('00000000-0000-4000-8000-000000008624', 'card', 220, 101, null, 'Letter', 'x')$$, 'between $0.00 and $1.00', 'B · a fixed part over $1.00 is refused');
select pg_temp.assert_raises($$select app.platform_set_fee_rate('00000000-0000-4000-8000-000000008624', 'ach', 80, 0, 100001, 'Letter', 'x')$$, 'cap is between', 'B · a cap over $1,000.00 is refused');
select pg_temp.assert_raises($$select app.platform_set_fee_rate('00000000-0000-4000-8000-000000008624', 'card', 220, 30, null, '  ', 'x')$$, 'where this rate comes from', 'B · a source is required');
select pg_temp.assert_raises($$select app.platform_set_fee_rate('00000000-0000-4000-8000-000000008624', 'card', 220, 30, null, 'Letter', ' ')$$, 'say why', 'B · and a reason');
select pg_temp.assert_raises($$select app.platform_set_fee_rate('00000000-0000-4000-8000-0000000086ff', 'card', 220, 30, null, 'Letter', 'x')$$, 'not found', 'B · and a community that exists');
select app.platform_set_fee_rate(:cad, 'card', 220, 30, null, 'Approved nonprofit pricing, letter of 2026-11-02', 'The organization asked for its nonprofit rate') as rate1 \gset
select pg_temp.assert((:'rate1'::jsonb->>'bps')::int = 220 and (:'rate1'::jsonb->>'center_id')::uuid = :cad::uuid, 'B · a platform admin adds an organization''s own card rate');
select pg_temp.assert((select a.action = 'payment_fee_rates.insert' and a.module = 'giving' and a.reason = 'The organization asked for its nonprofit rate'
                              and a.actor_user_id = '86200000-0000-4000-8000-000000000007' and a.center_id = :cad::uuid
                         from app.audit_log a where a.record_table = 'payment_fee_rates' and a.record_id = (:'rate1'::jsonb->>'id') order by a.id desc limit 1),
  'B · and it is audited: who, the reason, the module and the organization');
select pg_temp.assert((select count(*) = 3 from app.payment_fee_rates), 'B · a platform admin reads the rate table');
select pg_temp.as_user('86200000-0000-4000-8000-00000000000a');
select pg_temp.assert((app.fee_estimate(:cad, 'card', 10000)->>'fee_cents')::int = 256 and (app.fee_estimate(:cad, 'card', 10000)#>>'{rate,custom}')::boolean
                      and (app.fee_estimate(:cad, 'ach', 10000)->>'fee_cents')::int = 81 and not (app.fee_estimate(:cad, 'ach', 10000)#>>'{rate,custom}')::boolean,
  'B · that organization''s estimate follows its own card rate ($2.56 on $100.00) and the standard bank-debit rate');
select pg_temp.assert(not exists (select 1 from app.payment_fee_rates), 'B · the member reads no rate row');
select pg_temp.as_none();
select pg_temp.assert_raises($$update app.payment_fee_rates set bps = 1 where center_id is null and method_class = 'card'$$, 'never changed or removed', 'B · a rate is never changed (not even by the database owner)');
select pg_temp.assert_raises($$delete from app.payment_fee_rates where center_id is null and method_class = 'card'$$, 'never changed or removed', 'B · or removed');
-- A rate dated in the future is not in effect yet.
insert into app.payment_fee_rates (center_id, method_class, bps, fixed_cents, cap_cents, effective_from, source_note)
values (:cad, 'ach', 500, 0, null, now() + interval '1 day', 'Starts tomorrow');
select pg_temp.as_user('86200000-0000-4000-8000-00000000000a');
select pg_temp.assert((app.fee_estimate(:cad, 'ach', 10000)->>'fee_cents')::int = 81, 'B · a rate dated tomorrow is not used today');
select pg_temp.as_none();
-- What the organization's staff see.
select pg_temp.as_user('86200000-0000-4000-8000-000000000004');
select pg_temp.assert((app.payment_fee_rates_for(:c)#>>'{card,bps}')::int = 290 and not (app.payment_fee_rates_for(:c)#>>'{card,custom}')::boolean
                      and (app.payment_fee_rates_for(:c)#>>'{ach,cap_cents}')::int = 500 and not (app.payment_fee_rates_for(:c)::text ~ 'set_by'),
  'B · the treasurer reads the rates her members'' estimate follows (and not who set them)');
select pg_temp.assert_raises($$select app.payment_fee_rates_for('00000000-0000-4000-8000-000000008624')$$, 'needs integrations.view', 'B · and not another organization''s');
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.payment_fee_rates_for('00000000-0000-4000-8000-000000008621')$$, 'needs integrations.view', 'B · a member cannot');
select pg_temp.as_none();

-- ═════════════════════════════════════════════════════════════════════════════
-- C. Nothing on: the quote and the checkout behave exactly as before
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(not exists (select 1 from app.center_payment_processors where center_id in (:c, :s, :pp, :cad, :off) and donor_covers_fee_allowed)
                      and not exists (select 1 from app.chip_in_settings where center_id in (:c, :s, :pp, :cad, :off)),
  'C · no organization covers fees and no platform setting exists');
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges') as q0 \gset
select pg_temp.assert((:'q0'::jsonb->>'ok')::boolean and pg_temp.line(:'q0'::jsonb) = '10000/0/0 -> 10000 -> 10000' and jsonb_array_length(:'q0'::jsonb->'lines') = 1
                      and not (:'q0'::jsonb#>>'{fee_cover,offered}')::boolean and :'q0'::jsonb#>>'{fee_cover,reason}' = 'switched_off'
                      and not (:'q0'::jsonb#>>'{chip_in,offered}')::boolean and :'q0'::jsonb#>>'{chip_in,reason}' = 'switched_off'
                      and (:'q0'::jsonb#>>'{methods,card}')::boolean and (:'q0'::jsonb#>>'{methods,ach}')::boolean and :'q0'::jsonb->>'mode' = 'live',
  'C · with nothing switched on the quote offers nothing and the total is the gift');
-- An app that sends none of the new fields: the same seven arguments as before.
select app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge') as ck0 \gset
select pg_temp.assert((:'ck0'::jsonb->>'amount_cents')::int = 10000 and (:'ck0'::jsonb->>'total_cents')::int = 10000 and (:'ck0'::jsonb->>'gift_cents')::int = 10000
                      and (:'ck0'::jsonb->>'covered_fee_cents')::int = 0 and (:'ck0'::jsonb->>'chip_in_cents')::int = 0 and (:'ck0'::jsonb->>'application_fee_cents')::int = 0
                      and :'ck0'::jsonb->>'account_id' = 'acct_862c' and :'ck0'::jsonb->>'mode' = 'live' and :'ck0'::jsonb->>'pay_method' is null
                      and (:'ck0'::jsonb->>'restrict_to_method')::boolean = false and :'ck0'::jsonb->>'session_minutes' is null,
  'C · an app that knows nothing of the new fields gets exactly the old checkout: the gift, the same total, no extras');
select pg_temp.assert((select k.amount_cents = 10000 and k.gift_cents = 10000 and k.total_cents = 10000 and k.covered_fee_cents = 0 and k.chip_in_cents = 0
                              and k.application_fee_cents = 0 and k.pay_method is null and k.fee_rate_id is null and k.status = 'created'
                         from app.payment_checkouts k where k.id = (:'ck0'::jsonb->>'checkout_id')::uuid),
  'C · the checkout row carries the gift, no fee, no Chip In (gift and total are derived)');
select pg_temp.assert(not exists (select 1 from app.chip_in_ledger), 'C · and no Chip In ledger row exists');
select pg_temp.assert((select count(*) = 1 from app.payment_checkouts where household_id = :h1), 'C · one checkout so far');
-- Asking for an extra that is not on is refused in plain words, and nothing is created.
select pg_temp.assert_state($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', true)$$, 'CCFEE',
  'C · asking to cover the fee while the organization has not allowed it: refused (CCFEE)');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', true)$$,
  'F862 does not take a covered card fee on this kind of payment', 'C · in the organization''s name');
select pg_temp.assert_state($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', false, 500)$$, 'CCCHP',
  'C · asking for a Chip In while the platform asks nothing: refused (CCCHP)');
select pg_temp.assert((select count(*) = 1 from app.payment_checkouts where household_id = :h1) and not exists (select 1 from app.chip_in_ledger),
  'C · none of the refusals created a checkout or a reservation');
select app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', null, true, 500) as q0b \gset
select pg_temp.assert(not (:'q0b'::jsonb->>'ok')::boolean and :'q0b'::jsonb#>>'{refusals,0,code}' = 'fee_cover_not_offered' and :'q0b'::jsonb#>>'{refusals,1,code}' = 'chip_in_not_offered'
                      and pg_temp.line(:'q0b'::jsonb) = '10000/0/0 -> 10000 -> 10000',
  'C · the quote lists both refusals and leaves the extras out of the numbers');
-- The total the member saw.
select pg_temp.assert((app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge', p_expected_total_cents => 10000)->>'total_cents')::int = 10000,
  'C · the expected total, when it matches, is accepted');
select pg_temp.assert_state($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', p_expected_total_cents => 10345)$$, 'CCTOT',
  'C · a total the member did not see is refused (CCTOT)');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', p_expected_total_cents => 10345)$$,
  'The total changed from $103.45 to $100.00', 'C · with both amounts in the message');
-- The rest of the old rules are untouched.
select pg_temp.as_user('86200000-0000-4000-8000-000000000003');
select pg_temp.assert_raises($$select app.payment_addons_quote('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, null, 'other')$$, 'only an adult', 'C · a child cannot ask for a quote either');
select pg_temp.as_user('86200000-0000-4000-8000-000000000006');
select pg_temp.assert_raises($$select app.payment_addons_quote('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, null, 'other')$$, 'only an adult', 'C · nor another family''s adult');
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select pg_temp.assert_raises($$select app.payment_addons_quote('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 49, null, 'other')$$, 'at least $0.50', 'C · under $0.50: the old message');
select pg_temp.assert_raises($$select app.payment_addons_quote('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, null, 'bogus')$$, 'Unknown checkout context', 'C · an unknown context: the old message');
select pg_temp.assert_raises($$select app.payment_addons_quote('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000bb']::uuid[], 'pledges')$$, 'not an open pledge of this family', 'C · another family''s pledge: the old message');
select pg_temp.assert_raises($$select app.payment_addons_quote('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, null, 'other', 'paypal')$$, 'card or bank account', 'C · a method that is neither card nor bank account');
select pg_temp.as_none();

-- ═════════════════════════════════════════════════════════════════════════════
-- D. The organization's switch: the lock of 0410 is lifted (Stripe only, owner/treasurer, with a reason, audited)
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.assert(not exists (select 1 from pg_constraint where conname = 'center_payment_processors_no_donor_fee'), 'D · the check constraint that kept it off is gone');
select pg_temp.assert_raises($$update app.center_payment_processors set donor_covers_fee_allowed = true where center_id = '00000000-0000-4000-8000-000000008623' and processor = 'paypal'$$,
  'center_payment_processors_fee_cover_stripe_only', 'D · and the table itself never lets it be on for PayPal');
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select pg_temp.assert_state($$select app.set_payment_processor('00000000-0000-4000-8000-000000008621', 'stripe', array['card','ach','apple_pay','google_pay'], null, true, 'I would like to')$$, '42501',
  'D · a member cannot switch it on');
select pg_temp.as_user('86200000-0000-4000-8000-000000000004');
select pg_temp.assert_raises($$select app.set_payment_processor('00000000-0000-4000-8000-000000008621', 'stripe', array['card','ach','apple_pay','google_pay'], null, true, ' ')$$, 'say why', 'D · a reason is required');
select pg_temp.assert_raises($$select app.set_payment_processor('00000000-0000-4000-8000-000000008621', 'paypal', array['paypal'], null, true, 'Let donors cover it')$$, 'not available with paypal', 'D · PayPal is refused in plain words');
select app.set_payment_processor(:c, 'stripe', array['card','ach','apple_pay','google_pay'], null, true, 'Let donors cover the card fee');
select pg_temp.as_none();
select pg_temp.assert((select donor_covers_fee_allowed from app.center_payment_processors where center_id = :c and processor = 'stripe'),
  'D · the treasurer (giving.manage) switches it on for Stripe, with a reason');
select pg_temp.assert((select a.reason = 'Let donors cover the card fee' and a.module = 'giving' and a.action = 'center_payment_processors.update'
                              and (a.before->>'donor_covers_fee_allowed') = 'false' and (a.after->>'donor_covers_fee_allowed') = 'true'
                              and a.actor_user_id = '86200000-0000-4000-8000-000000000004'
                         from app.audit_log a where a.record_table = 'center_payment_processors' and a.center_id = :c order by a.id desc limit 1),
  'D · and it is audited: old and new value, the reason, who');
select pg_temp.as_user('86200000-0000-4000-8000-000000000005');
select app.set_payment_processor(:c, 'stripe', array['card','ach','apple_pay','google_pay'], null, false, 'Turn it off for now');
select pg_temp.as_none();
select pg_temp.assert(not (select donor_covers_fee_allowed from app.center_payment_processors where center_id = :c and processor = 'stripe'), 'D · the owner switches it off again');
select pg_temp.as_user('86200000-0000-4000-8000-000000000005');
select app.set_payment_processor(:c, 'stripe', array['card','ach','apple_pay','google_pay'], null, true, 'Ask donors again');
select pg_temp.as_none();
-- The sandbox and the Canadian community choose it too (a superuser write stands for their treasurer here).
update app.center_payment_processors set donor_covers_fee_allowed = true where center_id in (:s, :cad, :off) and processor = 'stripe';

-- ═════════════════════════════════════════════════════════════════════════════
-- E. Cover the card fee, through the quote and the checkout
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges') as e0 \gset
select pg_temp.assert((:'e0'::jsonb#>>'{fee_cover,offered}')::boolean and :'e0'::jsonb#>>'{fee_cover,reason}' is null and not (:'e0'::jsonb#>>'{fee_cover,selected}')::boolean
                      and (:'e0'::jsonb#>>'{fee_cover,rate,bps}')::int = 290 and pg_temp.line(:'e0'::jsonb) = '10000/0/0 -> 10000 -> 10000',
  'E · once the organization allows it the box is offered, unchecked, with the rate it estimates by; the total is still the gift');
select app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', null, true) as e1 \gset
select pg_temp.assert((:'e1'::jsonb->>'ok')::boolean and pg_temp.line(:'e1'::jsonb) = '10000/330/0 -> 10330 -> 10330' and :'e1'::jsonb->>'pay_method' = 'card'
                      and (:'e1'::jsonb->>'restrict_to_method')::boolean and jsonb_array_length(:'e1'::jsonb->'lines') = 2,
  'E · ticking the box on a $100.00 gift: $3.30, $103.30 to the organization, the card method chosen and the session restricted to it');
select pg_temp.assert(:'e1'::jsonb#>>'{lines,1,key}' = 'covered_fee' and :'e1'::jsonb#>>'{lines,1,label}' = 'Card fee you chose to cover'
                      and (:'e1'::jsonb#>>'{lines,1,cents}')::int = 330 and (:'e1'::jsonb->>'application_fee_cents')::int = 0,
  'E · the lines say what the member sees');
select pg_temp.assert((:'e1'::jsonb->>'fee_rate_id')::uuid = :'card_rate'::uuid,
  'E · and the rate row it used is recorded');
select app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', 'ach', true) as e2 \gset
select pg_temp.assert(pg_temp.line(:'e2'::jsonb) = '10000/81/0 -> 10081 -> 10081' and :'e2'::jsonb->>'pay_method' = 'ach'
                      and :'e2'::jsonb#>>'{lines,1,label}' = 'Bank debit fee you chose to cover',
  'E · by bank debit the fee is $0.81 and the line says so');
select pg_temp.assert(pg_temp.line(app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', 'card', true)) = '10000/330/0 -> 10330 -> 10330'
                      and pg_temp.line(app.payment_addons_quote(:c, :h1, 10000, array[:lab]::uuid[], 'labh', null, true)) = '10000/330/0 -> 10330 -> 10330',
  'E · a labh is a gift too');
-- Which payments may carry it (§4.3): gifts only.
select pg_temp.assert(app.payment_addons_quote(:c, :h1, 3000, array[:dues]::uuid[], 'pledges', null, true)#>>'{refusals,0,reason}' = 'not_a_gift'
                      and app.payment_addons_quote(:c, :h1, 3000, array[:tix]::uuid[], 'rsvp_later', null, true)#>>'{refusals,0,reason}' = 'not_a_gift'
                      and app.payment_addons_quote(:c, :h1, 3000, array[:g1, :dues]::uuid[], 'pledges', null, true)#>>'{refusals,0,reason}' = 'not_a_gift'
                      and app.payment_addons_quote(:c, :h1, 1000, array[:stp]::uuid[], 'pledges', null, true)#>>'{refusals,0,reason}' = 'store'
                      and app.payment_addons_quote(:c, :h1, 1000, array[:g1]::uuid[], 'store', null, true)#>>'{refusals,0,reason}' = 'store'
                      and app.payment_addons_quote(:c, :h1, 10000, null, 'other', null, true)#>>'{refusals,0,reason}' = 'no_pledge'
                      and (app.payment_addons_quote(:c, :h1, 3000, array[:dues]::uuid[], 'pledges')#>>'{fee_cover,reason}') = 'not_a_gift',
  'E · dues, tickets, a mixed payment, the store and a payment that names no pledge cannot carry a covered fee; the database says why');
select pg_temp.assert(app.payment_addons_quote(:c, :h1, 3000, array[:dues]::uuid[], 'pledges', null, true) #>> '{refusals,0,message}' = 'F862 does not take a covered card fee on this kind of payment.'
                      and pg_temp.line(app.payment_addons_quote(:c, :h1, 3000, array[:dues]::uuid[], 'pledges', null, true)) = '3000/0/0 -> 3000 -> 3000',
  'E · in the organization''s name, and the refused fee is not in the numbers');
-- The method must be one the organization offers.
select pg_temp.as_none();
update app.center_payment_processors set methods = array['card','apple_pay'] where center_id = :c and processor = 'stripe';
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select pg_temp.assert(app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', 'ach', true)#>>'{refusals,0,code}' = 'method_not_offered'
                      and not (app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges')#>>'{methods,ach}')::boolean,
  'E · a bank debit the organization does not offer through Stripe is refused');
select pg_temp.as_none();
update app.center_payment_processors set methods = array['card','ach','apple_pay','google_pay'] where center_id = :c and processor = 'stripe';

-- The checkout.
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge', true, 0, null, 10330) as ckc \gset
select pg_temp.assert((:'ckc'::jsonb->>'amount_cents')::int = 10330 and (:'ckc'::jsonb->>'gift_cents')::int = 10000 and (:'ckc'::jsonb->>'covered_fee_cents')::int = 330
                      and (:'ckc'::jsonb->>'total_cents')::int = 10330 and :'ckc'::jsonb->>'pay_method' = 'card' and (:'ckc'::jsonb->>'restrict_to_method')::boolean
                      and jsonb_array_length(:'ckc'::jsonb->'lines') = 2,
  'E · the checkout with the fee covered: the organization''s charge is gift + fee, the card is charged the same, restricted to the chosen method');
select pg_temp.assert((select k.amount_cents = 10330 and k.gift_cents = 10000 and k.covered_fee_cents = 330 and k.chip_in_cents = 0 and k.total_cents = 10330
                              and k.pay_method = 'card' and k.fee_rate_id = :'card_rate'::uuid
                         from app.payment_checkouts k where k.id = (:'ckc'::jsonb->>'checkout_id')::uuid),
  'E · the row stores it all, and the rate row it used');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', true, 0, null, 10340)$$,
  'The total changed from $103.40 to $103.30', 'E · if the fee moved while the member looked, the checkout says so and charges nothing');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 3000, array['86200000-0000-4000-8000-0000000000b4']::uuid[], null, 'pledges', 'Dues', true)$$,
  'does not take a covered card fee', 'E · dues cannot carry it, and the checkout says so');
select app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge', true, 0, 'ach', 10081) as cka \gset
select pg_temp.assert((:'cka'::jsonb->>'amount_cents')::int = 10081 and :'cka'::jsonb->>'pay_method' = 'ach' and (:'cka'::jsonb->>'covered_fee_cents')::int = 81,
  'E · the bank-debit checkout is $100.81');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 99990000, array['86200000-0000-4000-8000-0000000000b7']::uuid[], null, 'pledges', 'Huge', true)$$,
  'limited to $1,000,000', 'E · a gift near the $1,000,000 limit cannot be pushed over it by the fee');
-- Others in the family and outside it.
select pg_temp.as_user('86200000-0000-4000-8000-000000000002');
select pg_temp.assert((app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge', true)->>'covered_fee_cents')::int = 330, 'E · the other adult of the family may too');
select pg_temp.as_user('86200000-0000-4000-8000-000000000003');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', true)$$, 'only an adult', 'E · the child cannot');
-- Staff paying for a family are offered neither extra.
select pg_temp.as_user('86200000-0000-4000-8000-000000000004');
select pg_temp.assert(not (app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'portal')#>>'{fee_cover,offered}')::boolean
                      and app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'portal')#>>'{fee_cover,reason}' = 'not_family'
                      and app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'portal')#>>'{chip_in,reason}' = 'not_family',
  'E · the treasurer paying for a family is offered neither extra');
select pg_temp.assert_state($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'portal', 'Pledge', true)$$, 'CCFEE',
  'E · and a staff-made checkout cannot carry a covered fee');
select pg_temp.assert((app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'portal', 'Pledge')->>'total_cents')::int = 10000, 'E · it is still made, plain');
-- Other kinds of community.
select pg_temp.as_user('86200000-0000-4000-8000-000000000009');
select pg_temp.assert(app.payment_addons_quote(:pp, :hp, 10000, array['86200000-0000-4000-8000-0000000000b9']::uuid[], 'pledges', null, true)#>>'{refusals,0,message}' = 'The card fee can be covered only when paying with Stripe.'
                      and app.payment_addons_quote(:pp, :hp, 10000, array['86200000-0000-4000-8000-0000000000b9']::uuid[], 'pledges')#>>'{fee_cover,reason}' = 'not_stripe'
                      and app.payment_addons_quote(:pp, :hp, 10000, array['86200000-0000-4000-8000-0000000000b9']::uuid[], 'pledges', null, false, 500)#>>'{refusals,0,message}' = 'A Chip In can be added only when paying with Stripe.',
  'E · with PayPal as the way to pay neither extra is offered, in plain words');
select pg_temp.assert((app.create_checkout(:pp, :hp, 10000, array['86200000-0000-4000-8000-0000000000b9']::uuid[], null, 'pledges', 'Pledge')->>'processor') = 'paypal',
  'E · and a PayPal checkout is made as before');
select pg_temp.as_user('86200000-0000-4000-8000-00000000000a');
select pg_temp.assert(app.payment_addons_quote(:cad, :hc, 10000, array['86200000-0000-4000-8000-0000000000ba']::uuid[], 'pledges', null, true)#>>'{refusals,0,reason}' = 'not_usd',
  'E · a community that does not use US dollars is offered neither extra');
select pg_temp.as_user('86200000-0000-4000-8000-00000000000b');
select pg_temp.assert(app.payment_addons_quote(:off, :ho, 10000, null, 'other')#>>'{fee_cover,reason}' = 'no_online', 'E · an offline-only community has nothing online to add to');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008625', '86200000-0000-4000-8000-0000000000a6', 10000, null, null, 'other', 'Gift')$$, 'offline payments only', 'E · and still refuses a checkout');
select pg_temp.as_none();
-- A paused Card way to pay: no covered fee is offered, and no checkout starts.
insert into app.payment_plugin_suspensions (plugin_key, target_center, reason, suspended_by) values ('card', :c, 'test 862', :plat);
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select pg_temp.assert(app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges')#>>'{fee_cover,reason}' = 'paused', 'E · while Card is paused the fee is not offered');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge')$$, 'has paused', 'E · and no checkout starts');
select pg_temp.as_none();
update app.payment_plugin_suspensions set lifted_at = now(), lifted_by = :plat, lift_reason = 'test 862 over' where target_center = :c and lifted_at is null;
-- The sandbox checks out in test mode.
select pg_temp.as_user('86200000-0000-4000-8000-000000000008');
select pg_temp.assert(app.payment_addons_quote(:s, :hs, 10000, array['86200000-0000-4000-8000-0000000000b8']::uuid[], 'pledges', null, true)->>'mode' = 'test'
                      and (app.create_checkout(:s, :hs, 10000, array['86200000-0000-4000-8000-0000000000b8']::uuid[], null, 'pledges', 'Pledge', true)->>'mode') = 'test',
  'E · a sandbox quotes and checks out in test mode');
select pg_temp.as_none();

-- ═════════════════════════════════════════════════════════════════════════════
-- F. The optional Chip In, through the quote and the checkout: the limit, the lock, the release
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user('86200000-0000-4000-8000-000000000007');
select app.platform_set_chip_in(:c, 5000, array[200,500,1000]::bigint[], true, 'Go-live gate passed (test 862)') as set_c \gset
select app.platform_set_chip_in(:s, 5000, array[200,500,1000]::bigint[], true, 'Sandbox rehearsal (test 862)') as set_s \gset
select pg_temp.as_none();
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges') as f0 \gset
select pg_temp.assert((:'f0'::jsonb#>>'{chip_in,offered}')::boolean and (:'f0'::jsonb#>>'{chip_in,left_cents}')::int = 5000 and (:'f0'::jsonb#>>'{chip_in,yearly_limit_cents}')::int = 5000
                      and :'f0'::jsonb#>'{chip_in,suggested_cents}' = '[200,500,1000]'::jsonb and (:'f0'::jsonb#>>'{chip_in,max_other_cents}')::int = 5000
                      and pg_temp.line(:'f0'::jsonb) = '10000/0/0 -> 10000 -> 10000',
  'F · once the platform asks, the quote offers the Chip In (suggestions, "Other" up to what is left) and adds nothing to the total');
select app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', null, false, 500) as f1 \gset
select pg_temp.assert(pg_temp.line(:'f1'::jsonb) = '10000/0/500 -> 10000 -> 10500' and (:'f1'::jsonb->>'application_fee_cents')::int = 485 and :'f1'::jsonb->>'pay_method' = 'card'
                      and not (:'f1'::jsonb->>'restrict_to_method')::boolean and :'f1'::jsonb#>>'{lines,1,key}' = 'chip_in'
                      and :'f1'::jsonb#>>'{lines,1,label}' = 'Chip In to Weaver (optional)',
  'F · a $5.00 Chip In without the fee: the organization is charged the gift, the card $105.00, and Weaver takes $4.85 (it absorbs the extra card fee)');
select app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', null, true, 500) as f2 \gset
select pg_temp.assert(pg_temp.line(:'f2'::jsonb) = '10000/345/500 -> 10345 -> 10845' and (:'f2'::jsonb->>'application_fee_cents')::int = 500 and jsonb_array_length(:'f2'::jsonb->'lines') = 3,
  'F · with the fee covered too: $3.45, charge $108.45, and Weaver keeps the whole $5.00');
select pg_temp.assert(pg_temp.line(app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', 'ach', false, 500)) = '10000/0/500 -> 10000 -> 10500'
                      and (app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', 'ach', false, 500)->>'application_fee_cents')::int = 500 - (80 * 10500 + 5000) / 10000 + (80 * 10000 + 5000) / 10000,
  'F · by bank debit the extra fee Weaver absorbs is the bank-debit one');
-- Every kind of payment may carry a Chip In, except the store and a staff-made one (§4.3).
select pg_temp.assert((app.payment_addons_quote(:c, :h1, 3000, array[:dues]::uuid[], 'pledges', null, false, 200)->>'ok')::boolean
                      and (app.payment_addons_quote(:c, :h1, 3000, array[:tix]::uuid[], 'rsvp_later', null, false, 200)->>'ok')::boolean
                      and (app.payment_addons_quote(:c, :h1, 10000, null, 'other', null, false, 200)->>'ok')::boolean
                      and app.payment_addons_quote(:c, :h1, 1000, array[:stp]::uuid[], 'pledges', null, false, 200)#>>'{refusals,0,reason}' = 'store'
                      and app.payment_addons_quote(:c, :h1, 1000, null, 'store', null, false, 200)#>>'{refusals,0,reason}' = 'store',
  'F · dues, tickets and plain gifts may carry a Chip In; the store may not');
select pg_temp.assert(app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', null, false, 99)#>>'{refusals,0,message}' = 'A Chip In is at least $1.00.'
                      and app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges', null, false, 5001)#>>'{refusals,0,message}' = 'A Chip In can be at most $50.00 more this year.',
  'F · under $1.00 and over what is left are refused in plain words');

-- The checkout reserves the Chip In in the same transaction.
select app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge', false, 500, null, 10500) as ck1 \gset
select pg_temp.assert((:'ck1'::jsonb->>'amount_cents')::int = 10000 and (:'ck1'::jsonb->>'chip_in_cents')::int = 500 and (:'ck1'::jsonb->>'application_fee_cents')::int = 485
                      and (:'ck1'::jsonb->>'total_cents')::int = 10500 and (:'ck1'::jsonb->>'session_minutes')::int = 60 and :'ck1'::jsonb->>'pay_method' = 'card',
  'F · the checkout: the organization''s charge is the gift, the card is charged $105.00, the session lasts an hour');
select pg_temp.assert((select l.status = 'reserved' and l.mode = 'live' and l.chip_in_cents = 500 and l.application_fee_cents = 485
                              and l.account_person_id = '86200000-0000-4000-8000-000000000101' and l.household_id = :h1::uuid
                              and l.calendar_year = extract(year from now() at time zone 'America/Chicago')::int
                              and l.expires_at > now() + interval '25 hours' and l.expires_at < now() + interval '27 hours' and l.payment_id is null
                         from app.chip_in_ledger l where l.checkout_id = (:'ck1'::jsonb->>'checkout_id')::uuid),
  'F · the ledger holds a reserved row: Mina''s login, this year, live, $5.00, expiring in 26 hours');
select pg_temp.assert((select count(*) >= 1 from pg_locks where locktype = 'advisory' and coalesce(pid, pg_backend_pid()) = pg_backend_pid() and granted),
  'F · and the per-account lock is held until the end of the transaction');
select app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge', true, 500, 'card', 10845) as ck2 \gset
select pg_temp.assert((:'ck2'::jsonb->>'amount_cents')::int = 10345 and (:'ck2'::jsonb->>'covered_fee_cents')::int = 345 and (:'ck2'::jsonb->>'application_fee_cents')::int = 500
                      and (:'ck2'::jsonb->>'total_cents')::int = 10845,
  'F · with the fee covered too: $103.45 to the organization, $108.45 on the card, $5.00 to Weaver');
select app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge', true, 500, 'ach', 10585) as ck3 \gset
select pg_temp.assert((select l.expires_at > now() + interval '13 days' and l.expires_at < now() + interval '15 days'
                         from app.chip_in_ledger l where l.checkout_id = (:'ck3'::jsonb->>'checkout_id')::uuid),
  'F · a bank-debit Chip In stays reserved for 14 days (it can take days to settle)');
-- 1,500 is reserved. The limit across checkouts, in the order they were started.
select pg_temp.assert((app.my_chip_in_offer(:c)->>'used_cents')::int = 1500 and (app.my_chip_in_offer(:c)->>'left_cents')::int = 3500
                      and app.my_chip_in_offer(:c)->'suggested_cents' = '[200,500,1000]'::jsonb,
  'F · three reservations of $5.00 each use $15.00 of the $50.00; the offer shows $35.00 left');
select pg_temp.assert_state($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', false, 3600)$$, 'CCLIM',
  'F · a fourth that would pass the limit is refused (CCLIM)');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', false, 3600)$$,
  'A Chip In can be at most $35.00 more this year.', 'F · with what is left in the message');
select pg_temp.assert((select count(*) = 3 from app.chip_in_ledger where account_person_id = '86200000-0000-4000-8000-000000000101'), 'F · and reserved nothing');
select app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge', false, 3500) as ck4 \gset
select pg_temp.assert((app.my_chip_in_offer(:c)->>'left_cents')::int = 0 and not (app.my_chip_in_offer(:c)->>'ask')::boolean and app.my_chip_in_offer(:c)->>'reason' = 'limit_reached',
  'F · an exact fit is allowed, and then nothing more is asked this year');
select pg_temp.assert_state($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', false, 100)$$, 'CCLIM',
  'F · at the limit even $1.00 is refused');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', false, 100)$$,
  'You have reached this year''s Chip In limit.', 'F · in plain words');
select pg_temp.assert(not (app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges')#>>'{chip_in,offered}')::boolean
                      and app.payment_addons_quote(:c, :h1, 10000, array[:g1]::uuid[], 'pledges')#>>'{chip_in,reason}' = 'limit_reached',
  'F · and the quote stops offering it');
select pg_temp.assert((app.create_checkout(:c, :h1, 10000, array[:g1]::uuid[], null, 'pledges', 'Pledge')->>'total_cents')::int = 10000,
  'F · a payment with no Chip In is still welcome at the limit');
-- Releasing: the provider refused, the member walked away, the session expired.
select app.fail_checkout((:'ck4'::jsonb->>'checkout_id')::uuid, 'The provider refused the checkout.');
select pg_temp.assert((select status = 'released' from app.chip_in_ledger where checkout_id = (:'ck4'::jsonb->>'checkout_id')::uuid)
                      and (app.my_chip_in_offer(:c)->>'left_cents')::int = 3500 and (app.my_chip_in_offer(:c)->>'ask')::boolean,
  'F · a checkout the provider refused gives its $35.00 back at once');
select pg_temp.as_none();
set local role connect_worker;
select app.worker_checkout_closed((:'ck3'::jsonb->>'checkout_id')::uuid, 'expired', 'The session expired.');
select app.worker_checkout_closed((:'ck3'::jsonb->>'checkout_id')::uuid, 'expired', 'The session expired.');
reset role;
select pg_temp.assert((select status = 'released' and released_at is not null from app.chip_in_ledger where checkout_id = (:'ck3'::jsonb->>'checkout_id')::uuid)
                      and (select status = 'expired' from app.payment_checkouts where id = (:'ck3'::jsonb->>'checkout_id')::uuid)
                      and app.chip_in_used_cents(:c, :pmina, app.chip_in_year(:c), 'live') = 1000,
  'F · the expired event releases a reservation (twice is the same as once): $10.00 is left in use');
-- Others have their own allowance; staff and children are not asked.
select pg_temp.as_user('86200000-0000-4000-8000-000000000002');
select pg_temp.assert((app.my_chip_in_offer(:c)->>'used_cents')::int = 0 and (app.my_chip_in_offer(:c)->>'left_cents')::int = 5000
                      and (app.create_checkout(:c, :h1, 10000, array[:g3]::uuid[], null, 'pledges', 'Pledge', false, 1000)->>'chip_in_cents')::int = 1000,
  'F · the allowance is per login: Raj has all $50.00 and uses $10.00 of it');
select pg_temp.as_user('86200000-0000-4000-8000-000000000004');
select pg_temp.assert_state($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'portal', 'Pledge', false, 200)$$, 'CCCHP',
  'F · a staff-made checkout cannot carry a Chip In (CCCHP)');
select pg_temp.as_user('86200000-0000-4000-8000-000000000003');
select pg_temp.assert_raises($$select app.create_checkout('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 10000, array['86200000-0000-4000-8000-0000000000b1']::uuid[], null, 'pledges', 'Pledge', false, 200)$$, 'only an adult', 'F · the child cannot');
select pg_temp.as_none();
-- The platform can switch asking off: nothing more is asked, and a request is refused.
select pg_temp.as_user('86200000-0000-4000-8000-000000000007');
select app.platform_set_chip_in(:c, 5000, array[200,500,1000]::bigint[], false, 'Paused (test 862)') as off_c \gset
select pg_temp.as_user('86200000-0000-4000-8000-000000000006');
select pg_temp.assert(app.payment_addons_quote(:c, :h2, 10000, array['86200000-0000-4000-8000-0000000000bb']::uuid[], 'pledges')#>>'{chip_in,reason}' = 'switched_off'
                      and app.payment_addons_quote(:c, :h2, 10000, array['86200000-0000-4000-8000-0000000000bb']::uuid[], 'pledges', null, false, 200)#>>'{refusals,0,reason}' = 'switched_off',
  'F · with asking switched off by the platform the quote offers nothing and a request is refused');
select pg_temp.as_user('86200000-0000-4000-8000-000000000007');
select app.platform_set_chip_in(:c, 5000, array[200,500,1000]::bigint[], true, 'Resumed (test 862)') as on_c \gset
select pg_temp.as_none();
-- A sandbox enforces the limit among its own test rows, and test rows never reduce a live allowance.
select pg_temp.as_user('86200000-0000-4000-8000-000000000008');
select app.create_checkout(:s, :hs, 10000, array['86200000-0000-4000-8000-0000000000b8']::uuid[], null, 'pledges', 'Pledge', false, 500) as cks \gset
select pg_temp.as_none();
select pg_temp.assert((select l.mode = 'test' and l.status = 'reserved' from app.chip_in_ledger l where l.checkout_id = (:'cks'::jsonb->>'checkout_id')::uuid)
                      and app.chip_in_used_cents(:s, :psam, app.chip_in_year(:s), 'live') = 0
                      and app.chip_in_used_cents(:s, :psam, app.chip_in_year(:s), 'test') = 500,
  'F · a sandbox member''s Chip In is a test-mode row and counts toward no live allowance');
select pg_temp.as_user('86200000-0000-4000-8000-000000000008');
select pg_temp.assert_state($$select app.create_checkout('00000000-0000-4000-8000-000000008622', '86200000-0000-4000-8000-0000000000a3', 10000, array['86200000-0000-4000-8000-0000000000b8']::uuid[], null, 'pledges', 'Pledge', false, 4600)$$, 'CCLIM',
  'F · but the sandbox still shows the limit working among its own test rows');
select pg_temp.as_none();

-- ═════════════════════════════════════════════════════════════════════════════
-- G. Recording the payment: the total, the application fee, the gift-only allocation, the ledger, QuickBooks
-- ═════════════════════════════════════════════════════════════════════════════
-- Checkouts to pay (fresh pledges, so no pledge is used up): plain, cover, chip, both.
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select app.create_checkout(:c, :h1, 10000, array[:g3]::uuid[], null, 'pledges', 'Plain gift') as ga \gset
select app.create_checkout(:c, :h1, 10000, array[:g3]::uuid[], null, 'pledges', 'Covered gift', true, 0, 'card', 10330) as gb \gset
select app.create_checkout(:c, :h1, 10000, array[:g7]::uuid[], null, 'pledges', 'Gift and Chip In', false, 500, 'card', 10500) as gc \gset
select app.create_checkout(:c, :h1, 10000, array[:g7]::uuid[], null, 'pledges', 'Covered gift and Chip In', true, 500, 'card', 10845) as gd \gset
select app.create_checkout(:c, :h1, 12000, array[:lab]::uuid[], null, 'labh', 'Labh, more than the pledge', true, 0, 'card', 12390) as ge \gset
select app.create_checkout(:c, :h1, 10000, array[:g7]::uuid[], null, 'pledges', 'Covered, wrong total', true, 0, 'card', 10330) as gm1 \gset
select app.create_checkout(:c, :h1, 10000, array[:g7]::uuid[], null, 'pledges', 'Chip In, wrong fee', false, 200, 'card') as gm2 \gset
select app.create_checkout(:c, :h1, 10000, array[:g7]::uuid[], null, 'pledges', 'Plain, unexpected fee') as gm3 \gset
select app.create_checkout(:c, :h1, 10000, array[:g7]::uuid[], null, 'pledges', 'Chip In, paid after release', false, 300, 'card') as gr \gset
select pg_temp.as_none();
select pg_temp.assert((:'ge'::jsonb->>'amount_cents')::int = 12390 and (:'ge'::jsonb->>'covered_fee_cents')::int = 390 and (:'ge'::jsonb->>'total_cents')::int = 12390,
  'G · a $120.00 labh gift with the fee covered: $3.90, $123.90');

-- The recorder checks what the provider says against the checkout, and records nothing that differs.
set local role connect_worker;
select pg_temp.assert_raises($$select app.worker_record_online_payment('$$ || (:'gb'::jsonb->>'checkout_id') || $$'::uuid, 'pi_862_bad1', 10000, 320, 'card')$$,
  'Not recorded', 'G · a covered-fee checkout paid at the gift alone (a different total) is not recorded');
select pg_temp.assert_raises($$select app.worker_record_online_payment('$$ || (:'gm2'::jsonb->>'checkout_id') || $$'::uuid, 'pi_862_bad2', 10200, 320, 'card')$$,
  'application fee of <NULL> cents', 'G · a Chip In checkout with no application fee reported is not recorded');
select pg_temp.assert_raises($$select app.worker_record_online_payment('$$ || (:'gm2'::jsonb->>'checkout_id') || $$'::uuid, 'pi_862_bad3', 10200, 320, 'card', null, 0)$$,
  'application fee of 0 cents', 'G · nor with the wrong application fee');
select pg_temp.assert_raises($$select app.worker_record_online_payment('$$ || (:'gm3'::jsonb->>'checkout_id') || $$'::uuid, 'pi_862_bad4', 10000, 320, 'card', null, 50)$$,
  'which asked for none', 'G · nor a plain checkout that comes back with an application fee');
select pg_temp.assert_raises($$select app.worker_record_online_payment('$$ || (:'gm1'::jsonb->>'checkout_id') || $$'::uuid, 'pi_862_bad5', 10450, 320, 'card')$$,
  'Not recorded', 'G · and a total above what the checkout asked for');
reset role;

-- Recording, one payment of each kind. p_amount_cents is what the provider charged in total; the last argument is the application fee.
set local role connect_worker;
select app.worker_record_online_payment((:'ga'::jsonb->>'checkout_id')::uuid, 'pi_862_a', 10000, 320, 'card', 'Visa 4242') as ra \gset
select app.worker_record_online_payment((:'gb'::jsonb->>'checkout_id')::uuid, 'pi_862_b', 10330, 330, 'card') as rb \gset
select app.worker_record_online_payment((:'gc'::jsonb->>'checkout_id')::uuid, 'pi_862_c', 10500, 335, 'card', null, 485) as rc \gset
select app.worker_record_online_payment((:'gd'::jsonb->>'checkout_id')::uuid, 'pi_862_d', 10845, 345, 'card', null, 500) as rd \gset
select app.worker_record_online_payment((:'ge'::jsonb->>'checkout_id')::uuid, 'pi_862_e', 12390, 390, 'card') as re \gset
reset role;
select pg_temp.assert(not (:'ra'::jsonb->>'duplicate')::boolean and not (:'rb'::jsonb->>'duplicate')::boolean and not (:'rc'::jsonb->>'duplicate')::boolean
                      and not (:'rd'::jsonb->>'duplicate')::boolean and (:'rd'::jsonb->>'chip_in_cents')::int = 500 and (:'rd'::jsonb->>'covered_fee_cents')::int = 345
                      and (:'rd'::jsonb->>'gift_cents')::int = 10000,
  'G · the worker records all five');
-- The old six-argument call still works for a plain checkout: the payment is exactly what it always was.
select pg_temp.assert((select p.amount_cents = 10000 and p.gift_cents = 10000 and p.donor_covered_fee_cents = 0 and p.chip_in_cents = 0 and p.application_fee_cents = 0
                              and p.charged_cents = 10000 and p.fee_cents = 320 and p.method = 'card' and p.status = 'captured' and p.provider = 'stripe'
                              and p.payer_person_id = '86200000-0000-4000-8000-000000000101' and p.receipt_number is not null
                         from app.payments p where p.provider_ref = 'pi_862_a'),
  'G · a plain payment is recorded as before: the gift, no fee covered, no Chip In');
-- Cover only: the organization is paid gift + fee; the fee is not pledge money.
select pg_temp.assert((select p.amount_cents = 10330 and p.gift_cents = 10000 and p.donor_covered_fee_cents = 330 and p.chip_in_cents = 0 and p.charged_cents = 10330
                              and p.fee_cents = 330
                         from app.payments p where p.provider_ref = 'pi_862_b')
                      and (select sum(a.amount_cents) = 10000 from app.payment_allocations a join app.payments p on p.id = a.payment_id where p.provider_ref = 'pi_862_b'),
  'G · cover only: amount $103.30, of which $3.30 covered fee; Stripe''s own fee $3.30 recorded; only the $100.00 gift is applied to the pledge');
-- Chip In only: beside the payment, never inside it.
select pg_temp.assert((select p.amount_cents = 10000 and p.donor_covered_fee_cents = 0 and p.chip_in_cents = 500 and p.application_fee_cents = 485 and p.charged_cents = 10500
                              and p.fee_cents = 335
                         from app.payments p where p.provider_ref = 'pi_862_c')
                      and (select sum(a.amount_cents) = 10000 from app.payment_allocations a join app.payments p on p.id = a.payment_id where p.provider_ref = 'pi_862_c'),
  'G · Chip In only: the organization''s payment is $100.00; the $5.00 and Weaver''s $4.85 sit beside it; Stripe''s fee $3.35 is only Stripe''s');
select pg_temp.assert((select p.amount_cents = 10345 and p.gift_cents = 10000 and p.donor_covered_fee_cents = 345 and p.chip_in_cents = 500 and p.application_fee_cents = 500
                              and p.charged_cents = 10845 and p.fee_cents = 345
                         from app.payments p where p.provider_ref = 'pi_862_d')
                      and (select sum(a.amount_cents) = 10000 from app.payment_allocations a join app.payments p on p.id = a.payment_id where p.provider_ref = 'pi_862_d'),
  'G · both: $103.45 to the organization ($3.45 of it the covered fee), $5.00 and Weaver''s $5.00 beside it, $108.45 charged, $100.00 applied');
-- A gift larger than the pledge: the pledge takes what it can, the rest of the GIFT is unapplied, and the fee is neither.
select pg_temp.assert((select p.amount_cents = 12390 and p.donor_covered_fee_cents = 390 from app.payments p where p.provider_ref = 'pi_862_e')
                      and (select sum(a.amount_cents) = 5000 from app.payment_allocations a join app.payments p on p.id = a.payment_id where p.provider_ref = 'pi_862_e'),
  'G · a $120.00 gift against a $50.00 labh: $50.00 is applied, $70.00 is unapplied, and the $3.90 fee is neither');
select pg_temp.assert((select paid_cents = 20000 from app.pledges where id = :g3::uuid) and (select status = 'partially_paid' from app.pledges where id = :g3::uuid),
  'G · the pledges moved by the gifts only (g3: two payments of $100.00)');
-- The ledger: collected, in the same transaction as the payment.
select pg_temp.assert((select l.status = 'collected' and l.payment_id = (select id from app.payments where provider_ref = 'pi_862_c') and l.application_fee_cents = 485 and l.collected_at is not null
                         from app.chip_in_ledger l where l.checkout_id = (:'gc'::jsonb->>'checkout_id')::uuid)
                      and (select l.status = 'collected' and l.application_fee_cents = 500 from app.chip_in_ledger l where l.checkout_id = (:'gd'::jsonb->>'checkout_id')::uuid)
                      and not exists (select 1 from app.chip_in_ledger l where l.checkout_id in ((:'ga'::jsonb->>'checkout_id')::uuid, (:'gb'::jsonb->>'checkout_id')::uuid, (:'ge'::jsonb->>'checkout_id')::uuid)),
  'G · each Chip In is collected with its payment; payments without one have no ledger row');
-- QuickBooks sees only what the organization receives: the payment and Stripe's fee, never the Chip In.
select pg_temp.assert((select count(*) = 2 and sum(l.amount_cents) filter (where l.txn_type = 'donation_card') = 10345 and sum(l.amount_cents) filter (where l.txn_type = 'processor_fee') = 345
                         from app.ledger_postings l where l.source_id = (select id from app.payments where provider_ref = 'pi_862_d')),
  'G · QuickBooks gets the $103.45 payment and Stripe''s $3.45 fee, and nothing for the Chip In (the books and the deposit match)');
select pg_temp.assert((select a.client_app = 'job' and a.reason = 'Paid online · Stripe pi_862_d' and a.module = 'giving'
                         from app.audit_log a where a.action = 'payments.insert' and a.after->>'chip_in_cents' = '500' order by a.id desc limit 1),
  'G · the payment is audited as the background service, with the provider reference');
select pg_temp.assert((select s.detail->>'chip_in_cents' = '500' and s.detail->>'covered_fee_cents' = '345' and s.detail->>'total_cents' = '10845'
                         from app.sync_log s where s.external_ref = 'pi_862_d' order by s.id desc limit 1),
  'G · and the sync log says what it carried');
-- The same webhook twice is one payment.
set local role connect_worker;
select app.worker_record_online_payment((:'gd'::jsonb->>'checkout_id')::uuid, 'pi_862_d', 10845, 345, 'card', null, 500) as rd2 \gset
reset role;
select pg_temp.assert((:'rd2'::jsonb->>'duplicate')::boolean and (select count(*) = 1 from app.payments where provider_ref = 'pi_862_d')
                      and (select count(*) = 1 from app.chip_in_ledger where checkout_id = (:'gd'::jsonb->>'checkout_id')::uuid and status = 'collected'),
  'G · a second webhook for the same payment is a duplicate: still one payment and one collected Chip In');
-- A Chip In checkout whose reservation was released (the session expired) and whose money arrives anyway is collected.
set local role connect_worker;
select app.worker_checkout_closed((:'gr'::jsonb->>'checkout_id')::uuid, 'expired', 'The session expired.');
reset role;
select pg_temp.assert((select status = 'released' from app.chip_in_ledger where checkout_id = (:'gr'::jsonb->>'checkout_id')::uuid), 'G · the expired session released the reservation');
set local role connect_worker;
select app.worker_record_online_payment((:'gr'::jsonb->>'checkout_id')::uuid, 'pi_862_r', 10300, 329, 'card', null, 291) as rr \gset
reset role;
select pg_temp.assert((select l.status = 'collected' and l.payment_id is not null from app.chip_in_ledger l where l.checkout_id = (:'gr'::jsonb->>'checkout_id')::uuid)
                      and (select status = 'paid' from app.payment_checkouts where id = (:'gr'::jsonb->>'checkout_id')::uuid),
  'G · money that arrives after the session expired is still recorded, and its Chip In counts');
set local role connect_worker;
select app.worker_checkout_closed((:'ga'::jsonb->>'checkout_id')::uuid, 'expired', 'late');
reset role;
select pg_temp.assert((select status = 'paid' from app.payment_checkouts where id = (:'ga'::jsonb->>'checkout_id')::uuid), 'G · a paid checkout is never closed afterwards');
-- A sandbox payment is a test-mode payment and a test-mode Chip In.
set local role connect_worker;
select app.worker_record_online_payment((:'cks'::jsonb->>'checkout_id')::uuid, 'pi_862_test', 10500, 335, 'card', null, 485) as rt \gset
reset role;
select pg_temp.assert((select p.memo like '%test mode%' and p.chip_in_cents = 500 from app.payments p where p.provider_ref = 'pi_862_test')
                      and (select l.mode = 'test' and l.status = 'collected' from app.chip_in_ledger l where l.checkout_id = (:'cks'::jsonb->>'checkout_id')::uuid),
  'G · a sandbox payment is marked test mode, and so is its Chip In');

-- A covered fee is never pledge money, whoever tries to apply it.
select pg_temp.assert_raises($$insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents)
  values ('00000000-0000-4000-8000-000000008621', (select id from app.payments where provider_ref = 'pi_862_b'), '86200000-0000-4000-8000-0000000000b7', 1)$$,
  'not pledge money', 'G · a script cannot apply even one cent more than the gift of a payment that carries a covered fee');
select pg_temp.assert((select count(*) = 0 from app.allocate_payment((select id from app.payments where provider_ref = 'pi_862_b'), null, true)),
  'G · and the allocator, asked again, places nothing: the gift is fully applied');
select pg_temp.assert((select coalesce(sum(amount_cents), 0) = 7000 from app.allocate_payment((select id from app.payments where provider_ref = 'pi_862_e'), array[:g7]::uuid[], false)),
  'G · it offers exactly the $70.00 (the amount less the $3.90 fee less the $50.00 already applied)');

-- ═════════════════════════════════════════════════════════════════════════════
-- H. Credit and reports: a covered fee is neither credit nor "not applied"
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select pg_temp.assert(app.household_credit(:h1) = 7000,
  'H · the family''s credit is the $70.00 of the labh gift beyond its pledge: the covered fees ($3.30, $3.45, $3.90) are not credit');
select pg_temp.as_none();
select app.reports_payments_summary(:c, current_date - 1, current_date + 1, 'fund') as rep \gset
select pg_temp.assert((:'rep'::jsonb#>>'{totals,received_cents}')::int = 63065 and (:'rep'::jsonb#>>'{totals,payments}')::int = 6
                      and (select sum((g->>'received_cents')::bigint) from jsonb_array_elements(:'rep'::jsonb->'groups') g) = 63065,
  'H · by fund, the lines add up to what was received ($630.65), covered fees included');
select pg_temp.assert((select (g->>'received_cents')::int = 7000 and (g->>'payments')::int = 1 and g->>'label' = 'Not applied to a pledge'
                         from jsonb_array_elements(:'rep'::jsonb->'groups') g where g->>'key' = 'unallocated')
                      and (select (g->>'received_cents')::int = 1065 and (g->>'payments')::int = 3 and g->>'label' = 'Card fees covered by donors'
                            from jsonb_array_elements(:'rep'::jsonb->'groups') g where g->>'key' = 'covered_fee'),
  'H · "Not applied to a pledge" is the $70.00 only; the three covered fees ($10.65) have their own line');
select app.reports_payments_summary(:c, current_date - 1, current_date + 1, 'method') as rep2 \gset
select pg_temp.assert(jsonb_array_length(:'rep2'::jsonb->'groups') = 1 and (:'rep2'::jsonb#>>'{groups,0,received_cents}')::int = 63065,
  'H · by method nothing changes: cards received $630.65');
select pg_temp.assert(pg_get_functiondef('app.pathshala_late_payment_trigger()'::regprocedure) like '%donor_covered_fee_cents%',
  'H · the Pathshala late-payment credit also leaves a covered fee out');

-- ═════════════════════════════════════════════════════════════════════════════
-- I. Who reads and writes what, the grants, and offline rows forced to zero extras
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user('86200000-0000-4000-8000-000000000001');
select pg_temp.assert((select chip_in_cents = 500 and application_fee_cents = 485 and gift_cents = 10000 and charged_cents = 10500 from app.payments where provider_ref = 'pi_862_c'),
  'I · an adult of the family reads the new columns of her own payment');
select pg_temp.assert(app.checkout_status((:'gd'::jsonb->>'checkout_id')::uuid)->>'status' = 'paid'
                      and (app.checkout_status((:'gd'::jsonb->>'checkout_id')::uuid)->>'total_cents')::int = 10845
                      and (app.checkout_status((:'gd'::jsonb->>'checkout_id')::uuid)->>'chip_in_cents')::int = 500
                      and (app.checkout_status((:'gd'::jsonb->>'checkout_id')::uuid)->>'gift_cents')::int = 10000,
  'I · the thank-you screen''s status carries the gift, the covered fee, the Chip In and the total');
select pg_temp.assert_raises($$insert into app.payment_checkouts (center_id, household_id, processor, mode, context, amount_cents, for_label)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 'stripe', 'live', 'other', 5000, 'x')$$,
  'permission denied', 'I · nobody writes a checkout directly');
select pg_temp.as_user('86200000-0000-4000-8000-000000000002');
select pg_temp.assert((select count(*) = 1 from app.payments where provider_ref = 'pi_862_c'), 'I · so does the other adult');
select pg_temp.as_user('86200000-0000-4000-8000-000000000003');
select pg_temp.assert(not exists (select 1 from app.payments where center_id = :c::uuid), 'I · the child reads no payment');
select pg_temp.as_user('86200000-0000-4000-8000-000000000006');
select pg_temp.assert(not exists (select 1 from app.payments where household_id = :h1::uuid), 'I · another family reads none of it');
select pg_temp.as_user('86200000-0000-4000-8000-000000000004');
select pg_temp.assert((select count(*) = 1 and bool_and(chip_in_cents = 500) from app.payments where provider_ref = 'pi_862_c'),
  'I · the treasurer reads it too (as an information line: not hers, not in her totals)');
-- Staff cannot write the extras on a payment (the guard), though they can edit the rest.
select pg_temp.assert_state($$update app.payments set chip_in_cents = 0 where provider_ref = 'pi_862_c'$$, '42501', 'I · the treasurer cannot change a Chip In on a payment');
select pg_temp.assert_state($$update app.payments set donor_covered_fee_cents = 331 where provider_ref = 'pi_862_b'$$, '42501', 'I · nor a covered fee');
select pg_temp.assert_state($$update app.payments set charged_cents = 1 where provider_ref = 'pi_862_b'$$, '42501', 'I · nor the amount charged');
select pg_temp.assert_state($$update app.payments set provider_refunded_cents = 5 where provider_ref = 'pi_862_b'$$, '42501', 'I · nor what Stripe refunded');
select pg_temp.assert_raises($$insert into app.payments (center_id, household_id, amount_cents, method, provider, status, received_on, recorded_by, chip_in_cents)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 1000, 'check', 'offline', 'captured', current_date, '86200000-0000-4000-8000-000000000004', 100)$$,
  'written only when a Stripe payment is recorded', 'I · an offline payment recorded by staff cannot carry a Chip In (the insert policy lets staff insert it directly)');
update app.payments set memo = 'Receipt sent by hand' where provider_ref = 'pi_862_b';
select pg_temp.as_none();
select pg_temp.assert((select memo = 'Receipt sent by hand' from app.payments where provider_ref = 'pi_862_b'), 'I · the rest of a payment is edited as before');
-- Offline, bank, PayPal and imported payments are forced to zero extras by the table itself.
select pg_temp.assert_raises($$insert into app.payments (center_id, household_id, amount_cents, method, provider, status, received_on, chip_in_cents)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 1000, 'check', 'offline', 'captured', current_date, 100)$$,
  'payments_addons_stripe_only', 'I · offline: no Chip In');
select pg_temp.assert_raises($$insert into app.payments (center_id, household_id, amount_cents, method, provider, status, received_on, donor_covered_fee_cents)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 1000, 'zelle', 'bank', 'settled', current_date, 30)$$,
  'payments_addons_stripe_only', 'I · bank: no covered fee');
select pg_temp.assert_raises($$insert into app.payments (center_id, household_id, amount_cents, method, provider, provider_ref, status, received_on, chip_in_cents, application_fee_cents)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 1000, 'paypal', 'paypal', 'pp_862', 'captured', current_date, 200, 100)$$,
  'payments_addons_stripe_only', 'I · PayPal: no application fee');
select pg_temp.assert_raises($$insert into app.payments (center_id, household_id, amount_cents, method, provider, status, received_on, charged_cents)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 1000, 'check', 'offline', 'captured', current_date, 1000)$$,
  'payments_addons_stripe_only', 'I · nor an amount charged');
select pg_temp.assert_raises($$insert into app.payments (center_id, household_id, amount_cents, method, provider, provider_ref, status, received_on, donor_covered_fee_cents)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 1000, 'card', 'stripe', 'pi_862_x1', 'captured', current_date, 1000)$$,
  'payments_addons_check', 'I · a covered fee as large as the payment is impossible');
select pg_temp.assert_raises($$insert into app.payments (center_id, household_id, amount_cents, method, provider, provider_ref, status, received_on, chip_in_cents, charged_cents)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 1000, 'card', 'stripe', 'pi_862_x2', 'captured', current_date, 200, 1100)$$,
  'payments_addons_check', 'I · the amount charged is always the payment plus the Chip In');
select pg_temp.assert_raises($$insert into app.payments (center_id, household_id, amount_cents, method, provider, provider_ref, status, received_on, chip_in_cents, application_fee_cents)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 1000, 'card', 'stripe', 'pi_862_x3', 'captured', current_date, 200, 201)$$,
  'payments_addons_check', 'I · and Weaver''s application fee is never more than the Chip In');
select pg_temp.assert_raises($$insert into app.payment_checkouts (center_id, household_id, processor, mode, context, amount_cents, for_label, chip_in_cents)
  values ('00000000-0000-4000-8000-000000008623', '86200000-0000-4000-8000-0000000000a4', 'paypal', 'live', 'other', 5000, 'x', 200)$$,
  'payment_checkouts_addons_check', 'I · a PayPal checkout cannot carry a Chip In');
select pg_temp.assert_raises($$insert into app.payment_checkouts (center_id, household_id, processor, mode, context, amount_cents, for_label, covered_fee_cents)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 'stripe', 'live', 'other', 5000, 'x', 5000)$$,
  'payment_checkouts_addons_check', 'I · nor a covered fee as large as the charge');
select pg_temp.assert_raises($$insert into app.payment_checkouts (center_id, household_id, processor, mode, context, amount_cents, for_label, pay_method)
  values ('00000000-0000-4000-8000-000000008621', '86200000-0000-4000-8000-0000000000a1', 'stripe', 'live', 'other', 5000, 'x', 'wire')$$,
  'payment_checkouts_pay_method_check', 'I · or a method that is neither card nor bank debit');
select pg_temp.assert((select a.attgenerated = 's' from pg_attribute a where a.attrelid = 'app.payments'::regclass and a.attname = 'gift_cents')
                      and (select bool_and(a.attgenerated = 's') from pg_attribute a where a.attrelid = 'app.payment_checkouts'::regclass and a.attname in ('gift_cents','total_cents')),
  'I · gift and total are derived columns, so they can never disagree with the amounts they come from');

-- Overloads and who can call what.
select pg_temp.assert((select count(*) = 1 from pg_proc where pronamespace = 'app'::regnamespace and proname = 'create_checkout')
                      and (select count(*) = 1 from pg_proc where pronamespace = 'app'::regnamespace and proname = 'worker_record_online_payment')
                      and to_regprocedure('app.create_checkout(uuid,uuid,bigint,uuid[],text,text,text)') is null
                      and to_regprocedure('app.worker_record_online_payment(uuid,text,bigint,bigint,text,text)') is null,
  'I · the old create_checkout and worker recorder are gone: one form of each, so PostgREST has nothing to choose between');
select pg_temp.assert(has_function_privilege('authenticated', 'app.payment_addons_quote(uuid,uuid,bigint,uuid[],text,text,boolean,bigint,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.fee_estimate(uuid,text,bigint)', 'execute')
                      and has_function_privilege('authenticated', 'app.create_checkout(uuid,uuid,bigint,uuid[],text,text,text,boolean,bigint,text,bigint)', 'execute')
                      and has_function_privilege('authenticated', 'app.platform_set_fee_rate(uuid,text,integer,integer,integer,text,text)', 'execute')
                      and has_function_privilege('authenticated', 'app.payment_fee_rates_for(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.payment_addons_quote(uuid,uuid,bigint,uuid[],text,text,boolean,bigint,text)', 'execute')
                      and not has_function_privilege('anon', 'app.fee_estimate(uuid,text,bigint)', 'execute')
                      and not has_function_privilege('anon', 'app.create_checkout(uuid,uuid,bigint,uuid[],text,text,text,boolean,bigint,text,bigint)', 'execute')
                      and not has_function_privilege('anon', 'app.platform_set_fee_rate(uuid,text,integer,integer,integer,text,text)', 'execute')
                      and has_function_privilege('connect_worker', 'app.worker_record_online_payment(uuid,text,bigint,bigint,text,text,bigint)', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_record_online_payment(uuid,text,bigint,bigint,text,text,bigint)', 'execute')
                      and not has_function_privilege('anon', 'app.worker_record_online_payment(uuid,text,bigint,bigint,text,text,bigint)', 'execute')
                      and not has_function_privilege('authenticated', 'app._addons_compute(uuid,uuid,bigint,uuid[],text,text,text,boolean,bigint)', 'execute')
                      and not has_function_privilege('authenticated', 'app._fee_cover(integer,integer,integer,bigint)', 'execute')
                      and not has_function_privilege('authenticated', 'app._fee_rate(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app._checkout_processor(uuid,text)', 'execute'),
  'I · the apps call the quote, the estimate and the checkout; the internals and the recorder are not on the API');
select pg_temp.assert((select bool_and('search_path=app, public, extensions' = any (p.proconfig))
                         from pg_proc p where p.pronamespace = 'app'::regnamespace
                          and p.proname in ('_fee_class','_fee_charge','_fee_cover','_fee_rate','fee_estimate','platform_set_fee_rate','payment_fee_rates_for',
                                            'pledge_source_is_gift','_checkout_processor','_addons_compute','payment_addons_quote','create_checkout',
                                            'worker_record_online_payment','worker_checkout_closed','worker_checkout_json','fail_checkout','checkout_status',
                                            'set_payment_processor','allocate_payment','household_credit','payments_addons_guard','payment_allocation_gift_guard',
                                            'payment_fee_rates_insert_only','pathshala_late_payment_trigger'))
                      and (select bool_and(p.prosecdef) from pg_proc p where p.pronamespace = 'app'::regnamespace
                            and p.proname in ('_fee_rate','fee_estimate','platform_set_fee_rate','payment_fee_rates_for','_checkout_processor','_addons_compute',
                                              'payment_addons_quote','create_checkout','worker_record_online_payment','payment_allocation_gift_guard')),
  'I · every function added or replaced pins the search path (pgcrypto-safe) and the ones that read protected tables are security definer');
select pg_temp.assert('payment_fee_rates' = any (app.demo_keep_tables()) and 'chip_in_settings' = any (app.demo_keep_tables())
                      and 'payment_fee_rates' <> all (app.demo_clear_tables()) and 'payment_checkouts' = any (app.demo_clear_tables()) and 'chip_in_ledger' = any (app.demo_clear_tables()),
  'I · a demo reset keeps the rates and the platform''s setting and clears checkouts and the Chip In ledger');
select pg_temp.assert((select tgfoid = 'app.audit_row'::regproc from pg_trigger where tgrelid = 'app.payment_fee_rates'::regclass and tgname = 'audit_payment_fee_rates')
                      and (select module_key = 'giving' from app.module_tables where table_name = 'payment_fee_rates')
                      and exists (select 1 from pg_policy p where p.polrelid = 'app.payment_fee_rates'::regclass and p.polname = 'module_switch' and not p.polpermissive),
  'I · the rate table is audited, belongs to Giving and has the module switch');
rollback;
