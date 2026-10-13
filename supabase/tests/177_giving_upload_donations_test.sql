-- 0777 (GV-U slice C; NEEDS OWNER OK): uploading donations (offline payments) from a spreadsheet.
--   A. The repeat check the review asks the database: same household, amount, day and method, or the same check number; failed,
--      voided and refunded payments do not count; who may ask
--   B. An upload is recorded: each row an offline payment through app.record_offline_payment_once, applied exactly as the review
--      showed (or a general gift), the reason and the row's note in its audit entry, the key upl:<upload>:<row>; the upload row
--   C. Once: the same confirmation returns the same upload; the same confirmation for different rows is refused
--   D. All or nothing: a refused row (a date in the future) records nothing, and says which row
--   E. Repeats: a row like a payment already recorded, a check number already used, an earlier row of the file; "Record anyway"
--   F. A finance volunteer records but does not apply; what it refuses: a member, another community's household, a card gift, a
--      pledge that changed since the review, more than 500 rows, no reason, Giving off
--   G. A donations upload is never cancelled (a refund fixes a wrong row)
--   H. A food bank in pounds
--   I. No receipt is emailed by the upload; grants and the activity catalog
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
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving/payments/upload"}', true);
end $$;
create or replace function pg_temp.up(p_user uuid, p_center uuid, p_key text, p_rows jsonb, p_reason text default 'Sunday collection checks')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.record_donation_upload(p_center, p_key, 'gifts.csv', repeat('b', 64), p_reason, p_rows);
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;
create or replace function pg_temp.rep(p_user uuid, p_center uuid, p_rows jsonb) returns setof record language plpgsql as $$
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  return query select g.row_no, g.receipt_number, g.received_on from app.giving_upload_payment_repeats(p_center, p_rows) g;
  reset role;
exception when others then
  reset role;
  raise;
end $$;
create or replace function pg_temp.cancel(p_user uuid, p_center uuid, p_upload uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.cancel_pledge_upload(p_center, p_upload, 'Wrong file');
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;
-- One upload row, as the review sends it.
create or replace function pg_temp.r(p_row integer, p_household uuid, p_amount bigint, p_method text, p_on date, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('row', p_row, 'household_id', p_household, 'amount_cents', p_amount, 'method', p_method, 'received_on', p_on) || p_extra
$$;

\set c '''17700000-0000-4000-8000-0000000000c1'''
\set d '''17700000-0000-4000-8000-0000000000d1'''
\set np '''17700000-0000-4000-8000-0000000000e1'''
\set tara '''17700000-0000-4000-8000-0000000000a1'''
\set vina '''17700000-0000-4000-8000-0000000000a2'''
\set mira '''17700000-0000-4000-8000-0000000000a4'''
\set zed '''17700000-0000-4000-8000-0000000000a5'''
\set nora '''17700000-0000-4000-8000-0000000000a6'''
\set h1 '''17700000-0000-4000-8000-000000000201'''
\set h2 '''17700000-0000-4000-8000-000000000202'''
\set h3 '''17700000-0000-4000-8000-000000000203'''
\set hd '''17700000-0000-4000-8000-000000000205'''
\set hn '''17700000-0000-4000-8000-000000000206'''
\set rahul '''17700000-0000-4000-8000-000000000101'''
\set mirap '''17700000-0000-4000-8000-000000000102'''
\set kiran '''17700000-0000-4000-8000-000000000104'''
\set asha '''17700000-0000-4000-8000-000000000105'''
\set noor '''17700000-0000-4000-8000-000000000106'''
\set pl1 '''17700000-0000-4000-8000-000000000301'''
\set pl2 '''17700000-0000-4000-8000-000000000302'''
\set pl3 '''17700000-0000-4000-8000-000000000303'''
\set old1 '''17700000-0000-4000-8000-000000000401'''
\set old2 '''17700000-0000-4000-8000-000000000402'''
\set old3 '''17700000-0000-4000-8000-000000000403'''

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values
  (:c, 'g177-temple', 'G177 Temple', 'G177', 'America/Chicago'),
  (:d, 'g177-other', 'G177 Other Temple', 'G177B', 'America/Chicago');
insert into app.centers (id, slug, name, short_name, environment, category_key, status, time_zone, currency)
  values (:np, 'g177-food-bank-sandbox', 'G177 Food Bank', 'G177F', 'sandbox', 'nonprofit_secular', 'onboarding', 'Europe/London', 'GBP');
insert into auth.users (id, email) values (:tara, 'tara@g177.test'), (:vina, 'vina@g177.test'), (:mira, 'mira@g177.test'),
  (:zed, 'zed@g177.test'), (:nora, 'nora@g177.test');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  (:rahul, :c, 'Rahul', 'Shah', null, '1980-04-02'), (:mirap, :c, 'Mira', 'Shah', 'mira@g177.test', '1982-06-11'),
  (:kiran, :c, 'Kiran', 'Mehta', null, null), (:asha, :c, 'Asha', 'Patel', null, '1975-01-01'), (:noor, :np, 'Noor', 'Haddad', null, '1985-03-03');
insert into app.households (id, center_id, display_name) values
  (:h1, :c, 'Shah family'), (:h2, :c, 'Mehta family'), (:h3, :c, 'Patel family'), (:hd, :d, 'Other family'), (:hn, :np, 'Haddad household');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (:h1, :rahul, :c, 'primary', true), (:h1, :mirap, :c, 'spouse', false), (:h2, :kiran, :c, 'primary', true),
  (:h3, :asha, :c, 'primary', true), (:hn, :noor, :np, 'primary', true);
insert into app.center_users (center_id, user_id, person_id, is_default) values (:c, :mira, :mirap, false);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :tara, 'treasurer'), (:c, :vina, 'finance_volunteer'), (:d, :zed, 'treasurer'), (:np, :nora, 'treasurer');
select (now() at time zone 'America/Chicago')::date as today \gset
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at) values
  (:pl1, :c, :h1, 'general', 50000, now() - interval '40 days'),
  (:pl2, :c, :h2, 'general', 30000, now() - interval '20 days'),
  (:pl3, :c, :h3, 'general', 10000, now() - interval '10 days');
-- Payments already recorded: a check, a failed one, a refunded one.
insert into app.payments (id, center_id, household_id, amount_cents, method, status, provider, received_on, check_number, receipt_number) values
  (:old1, :c, :h2, 7500, 'check', 'captured', 'offline', :'today'::date - 3, '1044', 'R-177-1'),
  (:old2, :c, :h3, 2000, 'cash', 'failed', 'offline', :'today'::date - 3, null, 'R-177-2'),
  (:old3, :c, :h3, 3000, 'cash', 'refunded', 'offline', :'today'::date - 3, null, 'R-177-3');

-- ═══════════════════════════════════════════════════════════════════════════
-- A. The repeat check
-- ═══════════════════════════════════════════════════════════════════════════
create temp table reps as
  select * from pg_temp.rep(:tara, :c, jsonb_build_array(
    pg_temp.r(2, :h2, 7500, 'check', :'today'::date - 3),
    pg_temp.r(3, :h2, 100, 'check', :'today'::date, jsonb_build_object('check_number', '1044')),
    pg_temp.r(4, :h3, 2000, 'cash', :'today'::date - 3),
    pg_temp.r(5, :h3, 3000, 'cash', :'today'::date - 3),
    pg_temp.r(6, :h2, 7500, 'cash', :'today'::date - 3))) as t(row_no integer, receipt_number text, received_on date);
select pg_temp.assert((select receipt_number = 'R-177-1' from reps where row_no = 2), 'A: the same household, amount, day and method is a repeat');
select pg_temp.assert((select receipt_number = 'R-177-1' from reps where row_no = 3), 'A: a check number already used by the household is a repeat');
select pg_temp.assert(not exists (select 1 from reps where row_no in (4, 5)), 'A: a failed or refunded payment does not count');
select pg_temp.assert(not exists (select 1 from reps where row_no = 6), 'A: another method is not a repeat');
select pg_temp.assert((select count(*) = 1 from pg_temp.rep(:vina, :c, jsonb_build_array(pg_temp.r(2, :h2, 7500, 'check', :'today'::date - 3))) as t(a integer, b text, c date)),
  'A: a finance volunteer can ask too (they cannot read others'' payments themselves)');
select pg_temp.assert_raises(format($$select * from pg_temp.rep(%L, %L, '[]'::jsonb) as t(a integer, b text, c date)$$, :mira, :c),
  'permission to record payments', 'A: a member cannot ask');

-- ═══════════════════════════════════════════════════════════════════════════
-- B. An upload is recorded
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.up(:tara, :c, 'don-177-b-0001', jsonb_build_array(
  pg_temp.r(2, :h1, 20000, 'check', :'today'::date - 1, jsonb_build_object('check_number', '2001', 'note', 'envelope 7', 'envelope_number', '7',
            'allocations', jsonb_build_array(jsonb_build_object('pledge_id', :pl1, 'amount_cents', 20000, 'pledge_amount_cents', 50000, 'pledge_paid_cents', 0)))),
  pg_temp.r(3, :h2, 1500, 'cash', :'today'::date, jsonb_build_object('memo', 'For: Building fund')),
  pg_temp.r(4, :h1, 35000, 'zelle', :'today'::date, jsonb_build_object('memo', 'Ref ZL-99',
            'allocations', jsonb_build_array(jsonb_build_object('pledge_id', :pl1, 'amount_cents', 30000, 'pledge_amount_cents', 50000, 'pledge_paid_cents', 20000)))))
)::text as b1 \gset
select (:'b1'::jsonb)->>'upload_id' as u1 \gset
select pg_temp.assert(((:'b1'::jsonb)->>'count')::int = 3 and ((:'b1'::jsonb)->>'total_cents')::bigint = 56500
                      and ((:'b1'::jsonb)->>'not_applied')::int = 0 and not ((:'b1'::jsonb)->>'replayed')::boolean,
  'B: three rows, one upload, the total in cents, everything the review applied was applied');
select pg_temp.assert((select count(*) = 3 and bool_and(provider = 'offline' and status = 'captured' and recorded_by = :tara::uuid)
                         from app.payments where idempotency_key like 'upl:' || :'u1' || ':%'),
  'B: each row is an offline payment recorded by the treasurer, keyed upl:<upload>:<row>');
select pg_temp.assert((select method = 'check' and check_number = '2001' and envelope_number = '7' and received_on = :'today'::date - 1
                         from app.payments where idempotency_key = 'upl:' || :'u1' || ':2'),
  'B: row 2 keeps its method, check number, envelope and day');
select pg_temp.assert((select status = 'paid' and paid_cents = 50000 from app.pledges where id = :pl1)
                      and (select count(*) = 2 from app.payment_allocations a join app.payments p on p.id = a.payment_id
                            where p.idempotency_key like 'upl:' || :'u1' || ':%' and a.pledge_id = :pl1),
  'B: rows 2 and 4 applied to the same pledge, one after the other, exactly as the review showed: it is paid');
select pg_temp.assert((select memo = 'For: Building fund' from app.payments where idempotency_key = 'upl:' || :'u1' || ':3')
                      and not exists (select 1 from app.payment_allocations a join app.payments p on p.id = a.payment_id
                                       where p.idempotency_key = 'upl:' || :'u1' || ':3'),
  'B: row 3 is a general gift, not applied, with what it was for in the memo');
select pg_temp.assert((select reason = 'Sunday collection checks · envelope 7' from app.audit_log
                        where record_table = 'payments' and action = 'payments.insert'
                          and record_id = (select id::text from app.payments where idempotency_key = 'upl:' || :'u1' || ':2')),
  'B: the payment''s audit entry carries the reason and the row''s note');
select pg_temp.assert((select kind = 'payments' and row_count = 3 and total_cents = 56500 and created_by = :tara::uuid from app.giving_uploads where id = :'u1'::uuid),
  'B: the upload row: kind payments, rows, total, who');

-- ═══════════════════════════════════════════════════════════════════════════
-- C. Once
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.up(:tara, :c, 'don-177-b-0001', jsonb_build_array(
  pg_temp.r(2, :h1, 20000, 'check', :'today'::date - 1), pg_temp.r(3, :h2, 1500, 'cash', :'today'::date), pg_temp.r(4, :h1, 35000, 'zelle', :'today'::date))
)::text as c1 \gset
select pg_temp.assert(((:'c1'::jsonb)->>'replayed')::boolean and jsonb_array_length((:'c1'::jsonb)->'payments') = 3
                      and (select count(*) = 3 from app.payments where idempotency_key like 'upl:' || :'u1' || ':%'),
  'C: the same confirmation again returns the same upload and records nothing more');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-b-0001', jsonb_build_array(pg_temp.r(2, %L, 999, 'cash', %L)))$$, :tara, :c, :h1, :'today'),
  'different upload', 'C: the same confirmation for different rows is refused');

-- ═══════════════════════════════════════════════════════════════════════════
-- D. All or nothing
-- ═══════════════════════════════════════════════════════════════════════════
select count(*) as before_d from app.payments where center_id = :c \gset
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-d-0001', jsonb_build_array(pg_temp.r(2, %L, 1100, 'cash', %L), pg_temp.r(3, %L, 1200, 'cash', %L)))$$,
                                    :tara, :c, :h2, :'today', :h3, :'today'::date + 2),
  'Row 3: The received date must be a real date', 'D: a date in the future refuses the upload, naming the row');
select pg_temp.assert((select count(*) = :before_d from app.payments where center_id = :c)
                      and not exists (select 1 from app.giving_uploads where idempotency_key = 'don-177-d-0001'),
  'D: nothing was recorded: not row 2, not the upload');

-- ═══════════════════════════════════════════════════════════════════════════
-- E. Repeats
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-e-0001', jsonb_build_array(pg_temp.r(5, %L, 7500, 'check', %L)))$$, :tara, :c, :h2, :'today'::date - 3),
  'Row 5: this looks like a repeat of receipt R-177-1', 'E: a row like a payment already recorded is refused');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-e-0002', jsonb_build_array(pg_temp.r(5, %L, 900, 'check', %L, jsonb_build_object('check_number', '1044'))))$$, :tara, :c, :h2, :'today'),
  'Row 5: this looks like a repeat', 'E: a check number the household already used is refused');
select pg_temp.up(:tara, :c, 'don-177-e-0003', jsonb_build_array(pg_temp.r(5, :h2, 7500, 'check', :'today'::date - 3, jsonb_build_object('repeat_ok', true))))::text as e3 \gset
select pg_temp.assert(((:'e3'::jsonb)->>'count')::int = 1, 'E: with "Record anyway" it is recorded');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-e-0004', jsonb_build_array(pg_temp.r(2, %L, 444, 'cash', %L), pg_temp.r(3, %L, 444, 'cash', %L)))$$,
                                    :tara, :c, :h3, :'today', :h3, :'today'),
  'Row 3: this looks like a repeat', 'E: an earlier row of the same file counts as recorded');

-- ═══════════════════════════════════════════════════════════════════════════
-- F. A finance volunteer, and what it refuses
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.up(:vina, :c, 'don-177-f-0001', jsonb_build_array(
  pg_temp.r(2, :h2, 10000, 'check', :'today'::date, jsonb_build_object('check_number', '3001',
            'allocations', jsonb_build_array(jsonb_build_object('pledge_id', :pl2, 'amount_cents', 10000, 'pledge_amount_cents', 30000, 'pledge_paid_cents', 0))))),
  'Collection counted on Sunday')::text as f1 \gset
select pg_temp.assert(((:'f1'::jsonb)->>'not_applied')::int = 1
                      and (select paid_cents = 0 from app.pledges where id = :pl2)
                      and (select recorded_by = :vina::uuid from app.payments where idempotency_key = 'upl:' || ((:'f1'::jsonb)->>'upload_id') || ':2'),
  'F: a finance volunteer''s rows are recorded and not applied (a treasurer applies them), exactly as the Record payment sheet does');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-f-0002', jsonb_build_array(pg_temp.r(2, %L, 1000, 'cash', %L)))$$, :mira, :c, :h1, :'today'),
  'permission to record payments', 'F: a member cannot upload donations');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-f-0003', jsonb_build_array(pg_temp.r(2, %L, 1000, 'cash', %L)))$$, :tara, :c, :hd, :'today'),
  'Row 2: That household belongs to a different community', 'F: another community''s household is refused, by row');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-f-0004', jsonb_build_array(pg_temp.r(2, %L, 1000, 'card', %L)))$$, :tara, :c, :h1, :'today'),
  'Row 2: Choose check, cash, ACH, Zelle or stock', 'F: a card gift is refused (it comes through the payment provider)');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-f-0005', jsonb_build_array(pg_temp.r(2, %L, 5000, 'cash', %L, jsonb_build_object('allocations',
                                      jsonb_build_array(jsonb_build_object('pledge_id', %L, 'amount_cents', 5000, 'pledge_amount_cents', 10000, 'pledge_paid_cents', 2500))))))$$,
                                    :tara, :c, :h3, :'today', :pl3),
  'changed since you saw the card', 'F: a pledge that changed since the review refuses the row (nothing is applied on a guess)');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-f-0006', (select jsonb_agg(pg_temp.r(g, %L, 100 + g, 'cash', %L)) from generate_series(2, 502) g))$$,
                                    :tara, :c, :h2, :'today'),
  'at most 500 rows', 'F: more than 500 rows is refused');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-f-0007', jsonb_build_array(pg_temp.r(2, %L, 1000, 'cash', %L)), ' ')$$, :tara, :c, :h2, :'today'),
  'say why', 'F: a reason is required');
savepoint giving_off;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'Test 177: giving paused');
select pg_temp.assert_raises(format($$select pg_temp.up(%L, %L, 'don-177-f-0008', jsonb_build_array(pg_temp.r(2, %L, 1000, 'cash', %L)))$$, :tara, :c, :h2, :'today'),
  'switched off', 'F: with Giving switched off nothing is recorded');
rollback to savepoint giving_off;

-- ═══════════════════════════════════════════════════════════════════════════
-- G. Never cancelled
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.cancel(%L, %L, %L)$$, :tara, :c, :'u1'),
  'A donations upload cannot be cancelled', 'G: a donations upload is never cancelled: a wrong row is fixed with a refund a second person approves');

-- ═══════════════════════════════════════════════════════════════════════════
-- H. A food bank in pounds
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.up(:nora, :np, 'don-177-h-0001', jsonb_build_array(pg_temp.r(2, :hn, 2550, 'ach', (now() at time zone 'Europe/London')::date)),
                  'Bank transfers from the spring appeal')::text as h1r \gset
select pg_temp.assert(((:'h1r'::jsonb)->>'total_cents')::bigint = 2550
                      and (select method = 'ach' and amount_cents = 2550 from app.payments where id = ((:'h1r'::jsonb)->'payments'->0->>'payment_id')::uuid),
  'H: a food bank in pounds uploads the same way');

-- ═══════════════════════════════════════════════════════════════════════════
-- I. No receipt by the upload; grants; the catalog
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(current_setting('app.donation_upload', true) = 'on',
  'I: the upload marks its transaction, so the automatic receipt (0770) stays quiet unless the community asked for receipts on uploads');
select pg_temp.assert(has_function_privilege('authenticated', 'app.record_donation_upload(uuid, text, text, text, text, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.record_donation_upload(uuid, text, text, text, text, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.giving_upload_payment_repeats(uuid, jsonb)', 'execute'),
  'I: signed-in people only');
select pg_temp.assert(exists (select 1 from app.activity_catalog where key = 'giving.upload_donations'), 'I: the upload button is in the activity catalog');

rollback;
