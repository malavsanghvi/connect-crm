-- 0776 (GV-U slice B; NEEDS OWNER OK): uploading pledges from a spreadsheet.
--   A. Which households a file's values name: every kind of identifier, an ID two households share, a name only when no identifier
--      matched, merged households left out, no member list; who may look
--   B. An upload is recorded: each row a manual pledge with the day it was pledged, the due date (given, or the default from that
--      day), the reason and the row's note in its audit entry, the key upl:<upload>:<row>; the upload row
--   C. Once: the same confirmation returns the same upload; the same confirmation for different rows is refused
--   D. All or nothing: a refused row (a child named as the pledger) records nothing, and says which row
--   E. Repeats: a row like a pledge already recorded (or an earlier row of the same file) is refused unless "Record anyway"
--   F. What it refuses: a finance volunteer, another community's household, Giving off, Opportunities off, an own-flow campaign,
--      more than 500 rows, no rows, no reason
--   G. Cancelling an upload: giving.manage, a reason in every audit entry, nothing deleted; refused once money is applied
--   H. A non-faith community in another currency; who reads the uploads
--   I. Grants, the module map and the activity catalog
-- The whole test is one transaction that is rolled back at the end, so nothing it creates is seen by the tests that run after it.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.claims(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2',
    'amr', json_build_array(json_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving/pledges/upload"}', true);
end $$;
create or replace function pg_temp.up(p_user uuid, p_center uuid, p_key text, p_rows jsonb, p_reason text default 'Pledge cards from the dinner',
                                      p_sha text default repeat('a', 64))
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.record_pledge_upload(p_center, p_key, 'pledges.csv', p_sha, p_reason, p_rows);
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;
create or replace function pg_temp.hh(p_user uuid, p_center uuid, p_values text[]) returns setof record language plpgsql as $$
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  return query select g.input, g.match_kind, g.household_id from app.giving_upload_households(p_center, p_values) g;
  reset role;
exception when others then
  reset role;
  raise;
end $$;
create or replace function pg_temp.cancel(p_user uuid, p_center uuid, p_upload uuid, p_reason text default 'Wrong file uploaded') returns jsonb
language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.cancel_pledge_upload(p_center, p_upload, p_reason);
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;
create or replace function pg_temp.seen(p_user uuid) returns integer language plpgsql as $$
declare n integer;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  select count(*) into n from app.giving_uploads;
  reset role;
  return n;
exception when others then
  reset role;
  raise;
end $$;
create or replace function pg_temp.direct(p_user uuid, p_center uuid) returns void language plpgsql as $$
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  insert into app.giving_uploads (center_id, kind, idempotency_key, reason, row_count, total_cents)
    values (p_center, 'pledges', 'direct-176-0001', 'by hand', 1, 1);
  reset role;
exception when others then
  reset role;
  raise;
end $$;
-- One upload row, as the review sends it.
create or replace function pg_temp.r(p_row integer, p_household uuid, p_amount bigint, p_pledged date default null, p_due date default null,
                                     p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('row', p_row, 'household_id', p_household, 'amount_cents', p_amount, 'pledged_on', p_pledged, 'due_on', p_due) || p_extra
$$;

\set c '''17600000-0000-4000-8000-0000000000c1'''
\set d '''17600000-0000-4000-8000-0000000000d1'''
\set np '''17600000-0000-4000-8000-0000000000e1'''
\set tara '''17600000-0000-4000-8000-0000000000a1'''
\set vina '''17600000-0000-4000-8000-0000000000a2'''
\set mira '''17600000-0000-4000-8000-0000000000a4'''
\set zed '''17600000-0000-4000-8000-0000000000a5'''
\set nora '''17600000-0000-4000-8000-0000000000a6'''
\set h1 '''17600000-0000-4000-8000-000000000201'''
\set h2 '''17600000-0000-4000-8000-000000000202'''
\set h3 '''17600000-0000-4000-8000-000000000203'''
\set hold '''17600000-0000-4000-8000-000000000204'''
\set hd '''17600000-0000-4000-8000-000000000205'''
\set hn '''17600000-0000-4000-8000-000000000206'''
\set rahul '''17600000-0000-4000-8000-000000000101'''
\set mirap '''17600000-0000-4000-8000-000000000102'''
\set kid '''17600000-0000-4000-8000-000000000103'''
\set kiran '''17600000-0000-4000-8000-000000000104'''
\set asha '''17600000-0000-4000-8000-000000000105'''
\set noor '''17600000-0000-4000-8000-000000000106'''
\set dev '''17600000-0000-4000-8000-000000000107'''
\set f1 '''17600000-0000-4000-8000-000000000401'''
\set fn '''17600000-0000-4000-8000-000000000402'''
\set camp '''17600000-0000-4000-8000-000000000501'''
\set auct '''17600000-0000-4000-8000-000000000502'''
\set opp '''17600000-0000-4000-8000-000000000601'''

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values
  (:c, 'g176-temple', 'G176 Temple', 'G176', 'America/Chicago'),
  (:d, 'g176-other', 'G176 Other Temple', 'G176B', 'America/Chicago');
insert into app.centers (id, slug, name, short_name, environment, category_key, status, time_zone, currency)
  values (:np, 'g176-food-bank-sandbox', 'G176 Food Bank', 'G176F', 'sandbox', 'nonprofit_secular', 'onboarding', 'Europe/London', 'GBP');
insert into auth.users (id, email) values (:tara, 'tara@g176.test'), (:vina, 'vina@g176.test'), (:mira, 'mira@g176.test'),
  (:zed, 'zed@g176.test'), (:nora, 'nora@g176.test');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth, member_number) values
  (:rahul, :c, 'Rahul', 'Shah', null, '1980-04-02', 'M-1761'),
  (:mirap, :c, 'Mira', 'Shah', 'mira@g176.test', '1982-06-11', 'M-1762'),
  (:kid, :c, 'Kavi', 'Shah', null, (now() - interval '10 years')::date, 'M-1763'),
  (:kiran, :c, 'Kiran', 'Mehta', null, null, 'M-1764'),
  (:asha, :c, 'Asha', 'Patel', null, '1975-01-01', 'M-1765'),
  (:noor, :np, 'Noor', 'Haddad', null, '1985-03-03', 'M-1766'),
  (:dev, :c, 'Dev', 'Rao', null, '1990-02-02', 'M-1767');
-- The community's own member ID for Dev, recorded before Dev joined a household: the ID itself carries no household.
insert into app.external_ids (center_id, person_id, kind, system, value) values (:c, :dev, 'org_member', 'register', '1777');
insert into app.households (id, center_id, display_name, household_number) values
  (:h1, :c, 'Shah family', 'H-1761'), (:h2, :c, 'Mehta family', 'H-1762'), (:h3, :c, 'Patel family', 'H-1763'),
  (:hd, :d, 'Other family', 'H-1764'), (:hn, :np, 'Haddad household', 'H-1765');
insert into app.households (id, center_id, display_name, household_number, merged_into_id) values (:hold, :c, 'Old Shah record', 'H-1769', :h1);
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :rahul, :c, 'primary', true), (:h1, :mirap, :c, 'spouse', false), (:h1, :kid, :c, 'child', false),
  (:h2, :kiran, :c, 'primary', true), (:h3, :asha, :c, 'primary', true), (:hn, :noor, :np, 'primary', true),
  (:h2, :dev, :c, 'parent', false);
insert into app.external_ids (center_id, household_id, kind, system, value) values
  (:c, :h1, 'crm', 'neon', 'NEON-55'),
  (:c, :h2, 'accounting', 'quickbooks', 'QB-1187'),
  (:c, :h1, 'bank_payer', 'chase', 'SHAH OR PATEL'),
  (:c, :h3, 'bank_payer', 'chase', 'SHAH OR PATEL'),
  (:c, :hold, 'crm', 'neon', 'NEON-OLD');
insert into app.center_users (center_id, user_id, person_id, is_default) values (:c, :mira, :mirap, false);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :tara, 'treasurer'), (:c, :vina, 'finance_volunteer'), (:d, :zed, 'treasurer'), (:np, :nora, 'treasurer');
insert into app.funds (id, center_id, key, name, active) values (:f1, :c, 'building', 'Building fund', true), (:fn, :np, 'meals', 'Meals', true);
insert into app.campaigns (id, center_id, fund_id, name, kind, status) values
  (:camp, :c, :f1, 'New hall', 'construction', 'published'),
  (:auct, :c, null, 'Festival auction', 'boli', 'published');
insert into app.opportunities (id, center_id, campaign_id, name, amount_cents, quantity_available, status)
  values (:opp, :c, :camp, 'Name a classroom', 250000, 5, 'open');
select (now() at time zone 'America/Chicago')::date as today \gset

-- ═══════════════════════════════════════════════════════════════════════════
-- A. Which households
-- ═══════════════════════════════════════════════════════════════════════════
create temp table hits as
  select * from pg_temp.hh(:tara, :c, array['H-1761', 'M-1764', 'NEON-55', 'QB-1187', 'SHAH OR PATEL', 'Patel', 'NEON-OLD', 'nobody at all', ' ',
                                            '1777', 'Kavi'])
    as t(input text, match_kind text, household_id uuid);
select pg_temp.assert((select household_id = :h1 and match_kind = 'connect_household' from hits where input = 'H-1761'),
  'A: the community''s household number names its household');
select pg_temp.assert((select household_id = :h2 from hits where input = 'M-1764'), 'A: a member''s number names that member''s household');
select pg_temp.assert((select household_id = :h1 and match_kind = 'crm' from hits where input = 'NEON-55'), 'A: the old CRM''s ID names its household');
select pg_temp.assert((select household_id = :h2 and match_kind = 'accounting' from hits where input = 'QB-1187'), 'A: the QuickBooks customer names its household');
select pg_temp.assert((select count(distinct household_id) = 2 and bool_and(match_kind = 'bank_payer') from hits where input = 'SHAH OR PATEL'),
  'A: a bank payer name two households share gives both (the person picks)');
select pg_temp.assert((select count(*) = 1 and bool_and(household_id = :h3 and match_kind = 'name') from hits where input = 'Patel'),
  'A: a name no identifier matches is found by name only (match_kind name: always a pick)');
select pg_temp.assert(not exists (select 1 from hits where input in ('NEON-OLD', 'nobody at all', ' ', '')),
  'A: a merged household, an unknown value and a blank give nothing');
select pg_temp.assert((select count(*) = 1 and bool_and(household_id = :h2 and match_kind = 'org_member')
                         from hits where input = '1777')
                      and (select household_id is null from app.external_ids where value = '1777'),
  'A: a person''s own member ID names the household the person is in now, even when the ID was recorded before they joined it');
select pg_temp.assert(not exists (select 1 from hits where input = 'Kavi'),
  'A: a child''s name never finds a household (the name search reads adults only)');
select pg_temp.assert(not exists (select 1 from information_schema.routines r join information_schema.parameters p on p.specific_name = r.specific_name
                                   where r.routine_schema = 'app' and r.routine_name = 'giving_upload_households' and p.parameter_name = 'members'),
  'A: the answer never carries the member list (a child''s name stays out of Giving)');
select pg_temp.assert_raises(format($$select * from pg_temp.hh(%L, %L, array['H-1761']) as t(a text, b text, c uuid)$$, :mira, :c),
  'permission to upload', 'A: a member cannot look households up for an upload');
select pg_temp.assert((select count(*) = 1 from pg_temp.hh(:vina, :c, array['H-1761']) as t(a text, b text, c uuid)),
  'A: a finance volunteer (giving.record_offline) can, for a donations upload');

-- ═══════════════════════════════════════════════════════════════════════════
-- B. An upload is recorded
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.up(:tara, :c, 'upl-176-b-0001', jsonb_build_array(
  pg_temp.r(2, :h1, 50000, :'today'::date - 5, :'today'::date + 60, jsonb_build_object('pledged_by_person_id', :rahul, 'note', 'card 14')),
  pg_temp.r(3, :h2, 12550, :'today'::date - 5, null, jsonb_build_object('fund_id', :f1)),
  pg_temp.r(4, :h3, 250000, null, null, jsonb_build_object('opportunity_id', :opp, 'dedication', 'In memory of Ba'))))::text as b1 \gset
select (:'b1'::jsonb)->>'upload_id' as u1 \gset
select pg_temp.assert(((:'b1'::jsonb)->>'count')::int = 3 and ((:'b1'::jsonb)->>'total_cents')::bigint = 312550
                      and not ((:'b1'::jsonb)->>'replayed')::boolean and jsonb_array_length((:'b1'::jsonb)->'pledges') = 3,
  'B: three rows, one upload, the total in cents');
select pg_temp.assert((select count(*) = 3 and bool_and(source = 'manual' and status = 'open' and paid_cents = 0)
                         from app.pledges where idempotency_key like 'upl:' || :'u1' || ':%'),
  'B: each row is a manual pledge, open and unpaid, keyed upl:<upload>:<row>');
select pg_temp.assert((select (pledged_at at time zone 'America/Chicago')::date = :'today'::date - 5 and due_on = :'today'::date + 60
                              and pledged_by_person_id = :rahul
                         from app.pledges where idempotency_key = 'upl:' || :'u1' || ':2'),
  'B: row 2 keeps its day, its due date and the adult who pledged');
select pg_temp.assert((select due_on = :'today'::date - 5 + 30 and fund_id = :f1 and campaign_id is null
                         from app.pledges where idempotency_key = 'upl:' || :'u1' || ':3'),
  'B: row 3 without a due date is due 30 days after the day it was pledged (the community''s default)');
select pg_temp.assert((select opportunity_id = :opp and campaign_id = :camp and fund_id = :f1 and dedication = 'In memory of Ba'
                              and (pledged_at at time zone 'America/Chicago')::date = :'today'::date
                         from app.pledges where idempotency_key = 'upl:' || :'u1' || ':4'),
  'B: row 4 for an opportunity brings its campaign and fund; no day means today');
select pg_temp.assert((select reason = 'Pledge cards from the dinner · card 14' from app.audit_log
                        where record_table = 'pledges' and action = 'pledges.insert'
                          and record_id = (select id::text from app.pledges where idempotency_key = 'upl:' || :'u1' || ':2')),
  'B: the audit entry carries the reason and the row''s note (the family''s History shows it)');
select pg_temp.assert((select kind = 'pledges' and row_count = 3 and total_cents = 312550 and created_by = :tara::uuid and file_name = 'pledges.csv'
                              and reason = 'Pledge cards from the dinner'
                         from app.giving_uploads where id = :'u1'::uuid),
  'B: the upload row: kind, rows, total, who, the file and the reason');
select pg_temp.assert((select reason = 'Upload: Pledge cards from the dinner' from app.audit_log
                        where record_table = 'giving_uploads' and action = 'giving_uploads.insert' and record_id = :'u1'),
  'B: the upload row''s own audit entry carries the reason');
select pg_temp.assert(not exists (select 1 from app.ledger_postings lp where lp.center_id = :c), 'B: a pledge is not cash: nothing goes to the books');

-- ═══════════════════════════════════════════════════════════════════════════
-- C. Once
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.up(:tara, :c, 'upl-176-b-0001', jsonb_build_array(
  pg_temp.r(2, :h1, 50000, :'today'::date - 5, :'today'::date + 60, jsonb_build_object('pledged_by_person_id', :rahul, 'note', 'card 14')),
  pg_temp.r(3, :h2, 12550, :'today'::date - 5, null, jsonb_build_object('fund_id', :f1)),
  pg_temp.r(4, :h3, 250000, null, null, jsonb_build_object('opportunity_id', :opp, 'dedication', 'In memory of Ba'))))::text as c1 \gset
select pg_temp.assert(((:'c1'::jsonb)->>'replayed')::boolean and (:'c1'::jsonb)->>'upload_id' = :'u1'
                      and jsonb_array_length((:'c1'::jsonb)->'pledges') = 3
                      and (select count(*) = 3 from app.pledges where idempotency_key like 'upl:' || :'u1' || ':%'),
  'C: the same confirmation again returns the same upload and records nothing more');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-b-0001', jsonb_build_array(pg_temp.r(2, %L, 999)))$$, :tara, :c, :h1),
  'different upload', 'C: the same confirmation for different rows is refused');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-b-0001', jsonb_build_array(
    pg_temp.r(2, %L, 50000, %L, %L, jsonb_build_object('pledged_by_person_id', %L, 'note', 'card 14')),
    pg_temp.r(3, %L, 12550, %L, null, jsonb_build_object('fund_id', %L)),
    pg_temp.r(4, %L, 250000, null, null, jsonb_build_object('opportunity_id', %L, 'dedication', 'In memory of Ba'))),
    'Pledge cards from the dinner', repeat('c', 64))$$,
    :tara, :c, :h1, :'today'::date - 5, :'today'::date + 60, :rahul, :h2, :'today'::date - 5, :f1, :h3, :opp),
  'different upload', 'C: the same confirmation with another file (its fingerprint) is refused');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-c-0002', jsonb_build_array(pg_temp.r(2, %L, 1000), pg_temp.r(2, %L, 2000)))$$, :tara, :c, :h2, :h3),
  'same row number appears twice', 'C: a row number twice is refused (it would give two rows one key and skew the total)');

-- ═══════════════════════════════════════════════════════════════════════════
-- D. All or nothing
-- ═══════════════════════════════════════════════════════════════════════════
select count(*) as before_d from app.pledges where center_id = :c \gset
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-d-0001', jsonb_build_array(
    pg_temp.r(2, %L, 1000), pg_temp.r(3, %L, 2000, null, null, jsonb_build_object('pledged_by_person_id', %L))))$$, :tara, :c, :h2, :h1, :kid),
  'Row 3: The person who pledged must be an adult', 'D: a child named as the pledger refuses the upload, naming the row (not the child)');
select pg_temp.assert((select count(*) = :before_d from app.pledges where center_id = :c)
                      and not exists (select 1 from app.giving_uploads where idempotency_key = 'upl-176-d-0001'),
  'D: nothing was recorded: not row 2, not the upload');

-- ═══════════════════════════════════════════════════════════════════════════
-- E. Repeats
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-e-0001', jsonb_build_array(pg_temp.r(7, %L, 12550, %L, null, jsonb_build_object('fund_id', %L))))$$,
                                    :tara, :c, :h2, :'today'::date - 5, :f1),
  'Row 7: this looks like a repeat', 'E: a row like a pledge already recorded (household, amount, purpose, day) is refused');
select pg_temp.up(:tara, :c, 'upl-176-e-0002', jsonb_build_array(pg_temp.r(7, :h2, 12550, :'today'::date - 5, null,
                  jsonb_build_object('fund_id', :f1, 'repeat_ok', true))))::text as e2 \gset
select pg_temp.assert(((:'e2'::jsonb)->>'count')::int = 1, 'E: with "Record anyway" it is recorded');
select pg_temp.up(:tara, :c, 'upl-176-e-0003', jsonb_build_array(pg_temp.r(2, :h2, 4000, :'today'::date - 1)))::text as e3 \gset
select pg_temp.assert(((:'e3'::jsonb)->>'count')::int = 1, 'E: the same household and amount on another day is not a repeat');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-e-0004', jsonb_build_array(pg_temp.r(2, %L, 777), pg_temp.r(3, %L, 777)))$$,
                                    :tara, :c, :h3, :h3),
  'Row 3: this looks like a repeat', 'E: an earlier row of the same file counts as recorded');

-- ═══════════════════════════════════════════════════════════════════════════
-- F. What it refuses
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-f-0001', jsonb_build_array(pg_temp.r(2, %L, 1000)))$$, :vina, :c, :h2),
  'giving.manage', 'F: a finance volunteer cannot upload pledges');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-f-0002', jsonb_build_array(pg_temp.r(2, %L, 1000)))$$, :tara, :c, :hd),
  'Row 2: That household belongs to a different community', 'F: another community''s household is refused, by row');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-f-0003', jsonb_build_array(pg_temp.r(2, %L, 1000, null, null, jsonb_build_object('campaign_id', %L))))$$,
                                    :tara, :c, :h2, :auct),
  'its own screen', 'F: an auction''s campaign takes its pledges from its own screen');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-f-0004', (select jsonb_agg(pg_temp.r(g, %L, 100 + g)) from generate_series(2, 502) g))$$,
                                    :tara, :c, :h2),
  'at most 500 rows', 'F: more than 500 rows is refused');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-f-0005', '[]'::jsonb)$$, :tara, :c), 'no rows', 'F: no rows is refused');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-f-0006', jsonb_build_array(pg_temp.r(2, %L, 1000)), ' ')$$, :tara, :c, :h2),
  'say why', 'F: a reason is required');
savepoint giving_off;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'Test 176: giving paused');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-f-0007', jsonb_build_array(pg_temp.r(2, %L, 1000)))$$, :tara, :c, :h2),
  'switched off', 'F: with Giving switched off nothing is recorded');
rollback to savepoint giving_off;
savepoint opp_off;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving_opportunities', false, 'Test 176: no opportunities');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'upl-176-f-0008', jsonb_build_array(pg_temp.r(2, %L, 1000), pg_temp.r(3, %L, 1500, null, null, jsonb_build_object('opportunity_id', %L))))$$,
                                    :tara, :c, :h2, :h3, :opp),
  'Row 3:', 'F: with Opportunities switched off a row naming one refuses the upload');
rollback to savepoint opp_off;

-- ═══════════════════════════════════════════════════════════════════════════
-- G. Cancelling
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.up(:tara, :c, 'upl-176-g-0001', jsonb_build_array(pg_temp.r(2, :h2, 3100), pg_temp.r(3, :h3, 3200)))::text as g1 \gset
select (:'g1'::jsonb)->>'upload_id' as ug \gset
select pg_temp.assert_raises(format($$select pg_temp.cancel(%L, %L, %L)$$, :vina, :c, :'ug'), 'giving.manage', 'G: a finance volunteer cannot cancel an upload');
select pg_temp.assert_raises(format($$select pg_temp.cancel(%L, %L, %L, ' ')$$, :tara, :c, :'ug'), 'say why', 'G: a reason is required');
select pg_temp.assert_raises(format($$select pg_temp.cancel(%L, %L, %L)$$, :zed, :d, :'ug'), 'different community', 'G: another community cannot cancel it');
select pg_temp.cancel(:tara, :c, :'ug'::uuid)::text as g2 \gset
select pg_temp.assert(((:'g2'::jsonb)->>'cancelled')::int = 2
                      and (select count(*) = 2 and bool_and(status = 'cancelled' and closed_at is not null) from app.pledges where idempotency_key like 'upl:' || :'ug' || ':%')
                      and (select cancelled_at is not null and cancel_reason = 'Wrong file uploaded' and cancelled_by = :tara::uuid from app.giving_uploads where id = :'ug'::uuid),
  'G: both pledges are cancelled (not deleted) and the upload says when, who and why');
select pg_temp.assert((select count(*) = 2 and bool_and(reason = 'Upload cancelled: Wrong file uploaded') from app.audit_log
                        where record_table = 'pledges' and action = 'pledges.update'
                          and record_id in (select id::text from app.pledges where idempotency_key like 'upl:' || :'ug' || ':%')),
  'G: each pledge''s audit entry carries the reason');
select pg_temp.cancel(:tara, :c, :'ug'::uuid)::text as g3 \gset
select pg_temp.assert(((:'g3'::jsonb)->>'already')::boolean, 'G: cancelling again changes nothing');
-- Money applied to one pledge of an upload: the upload can no longer be cancelled.
select pg_temp.up(:tara, :c, 'upl-176-g-0002', jsonb_build_array(pg_temp.r(2, :h2, 4100), pg_temp.r(3, :h3, 4200)))::text as g4 \gset
select (:'g4'::jsonb)->>'upload_id' as ug2 \gset
select id as pg2 from app.pledges where idempotency_key = 'upl:' || :'ug2' || ':3' \gset
select pg_temp.claims(:tara);
set local role authenticated;
select app.record_offline_payment_once('pay-176-g-0001', :c, :h3, 1000, 'check', :'today'::date,
  jsonb_build_array(jsonb_build_object('pledge_id', :'pg2', 'amount_cents', 1000, 'pledge_amount_cents', 4200, 'pledge_paid_cents', 0)))::text as pay \gset
reset role;
select pg_temp.assert((select paid_cents = 1000 from app.pledges where id = :'pg2'::uuid), 'G: a payment was applied to a pledge of the second upload');
select pg_temp.assert_raises(format($$select pg_temp.cancel(%L, %L, %L)$$, :tara, :c, :'ug2'), 'already has money applied',
  'G: an upload with money applied to any of its pledges is not cancelled');
select pg_temp.assert((select count(*) = 2 and bool_and(status <> 'cancelled') from app.pledges where idempotency_key like 'upl:' || :'ug2' || ':%'),
  'G: nothing of it was cancelled');

-- ═══════════════════════════════════════════════════════════════════════════
-- H. A food bank in pounds; who reads the uploads
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.up(:nora, :np, 'upl-176-h-0001', jsonb_build_array(pg_temp.r(2, :hn, 2500, null, null, jsonb_build_object('fund_id', :fn))),
                  'Pledges from the spring appeal')::text as h1r \gset
select pg_temp.assert(((:'h1r'::jsonb)->>'total_cents')::bigint = 2500
                      and (select fund_id = :fn and source = 'manual' from app.pledges where id = ((:'h1r'::jsonb)->'pledges'->0->>'pledge_id')::uuid),
  'H: a food bank in pounds uploads the same way');
select pg_temp.assert(pg_temp.seen(:tara) = 5, 'H: the treasurer reads the community''s uploads');
select pg_temp.assert(pg_temp.seen(:zed) = 0, 'H: another community''s treasurer reads none of them');
select pg_temp.assert(pg_temp.seen(:mira) = 0, 'H: a member reads none');
select pg_temp.assert(pg_temp.seen(:nora) = 1, 'H: the food bank''s treasurer reads only its own');
select pg_temp.assert_raises(format($$select pg_temp.direct(%L, %L)$$, :tara, :c), 'permission denied', 'H: nobody writes an upload row directly');

-- ═══════════════════════════════════════════════════════════════════════════
-- I. Grants, the module map, the catalog
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(has_function_privilege('authenticated', 'app.record_pledge_upload(uuid, text, text, text, text, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.record_pledge_upload(uuid, text, text, text, text, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.cancel_pledge_upload(uuid, uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.giving_upload_households(uuid, text[])', 'execute'),
  'I: signed-in people only');
select pg_temp.assert((select module_key = 'giving' from app.module_tables where table_name = 'giving_uploads')
                      and (select relrowsecurity from pg_class where oid = 'app.giving_uploads'::regclass),
  'I: the uploads are Giving''s table, with row level security');
select pg_temp.assert((select count(*) = 2 from app.activity_catalog where key in ('giving.upload_pledges', 'giving.cancel_pledge_upload')),
  'I: the upload and cancel buttons are in the activity catalog');

rollback;
