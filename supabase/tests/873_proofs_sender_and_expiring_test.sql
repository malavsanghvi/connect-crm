-- 0873: the sender's name on the queue card, and the notice before proof files become due for removal.
--   A. Who sent it (payment_proof_queue.sent_by)   B. Files that become due soon, by the retention rule   C. Not accepted proofs and the legal hold
--   D. Who may ask      E. The daily job's own rule is unchanged (today's due list)
-- Everything runs in one transaction that is rolled back, in its own communities.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt; raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if sqlstate <> state then raise exception 'FAIL: % (got % "%")', label, sqlstate, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/settings/storage"}', true);
  set local role authenticated;
end $$;
-- Fixed ids: id(1..) communities, id(11..) households, id(21..) users/people, id(31..) pledges, id(100+n) payments, id(200+n) proofs, id(300+n) files.
create or replace function pg_temp.id(n int) returns uuid language sql as $$ select ('87300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.yr() returns int language sql as $$ select extract(year from (now() at time zone 'America/Chicago')::date)::int $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Chicago')::date $$;
-- A payment received on June 1 of (this year - p_back), allocated to the given pledges (100 cents each), and a staff file on it.
create or replace function pg_temp.pay_file(p_n int, p_center uuid, p_hh uuid, p_back int, p_pledges uuid[] default '{}') returns void language plpgsql as $$
declare k uuid;
begin
  insert into app.payments (id, center_id, household_id, amount_cents, method, provider, received_on)
  values (pg_temp.id(100 + p_n), p_center, p_hh, 100 * greatest(coalesce(array_length(p_pledges, 1), 1), 1), 'check', 'offline', make_date(pg_temp.yr() - p_back, 6, 1));
  foreach k in array p_pledges loop
    insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents) values (p_center, pg_temp.id(100 + p_n), k, 100);
  end loop;
  insert into app.payment_proof_files (id, center_id, payment_id, household_id, storage_path, content_type, bytes, sha256, member_visible)
  values (pg_temp.id(300 + p_n), p_center, pg_temp.id(100 + p_n), p_hh, p_center || '/' || p_hh || '/' || pg_temp.id(300 + p_n) || '.jpg', 'image/jpeg', 2000 + p_n,
          md5('873' || p_n::text) || md5(p_n::text || '873'), false);
end $$;
create or replace function pg_temp.u(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;

begin;
select pg_temp.yr() as yr \gset
-- Days from today until the first day a payment of (this year - 7) is due: Jan 1 of next year.
select (make_date(:yr, 12, 31) - pg_temp.today()) + 1 as n \gset

-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  (pg_temp.id(21), 'olga@sx873.test'), (pg_temp.id(22), 'tara@sx873.test'), (pg_temp.id(23), 'mina@sx873.test'), (pg_temp.id(24), 'amy@sx873.test');
insert into app.centers (id, slug, name, short_name, time_zone, currency) values
  (pg_temp.id(1), 'sx873-a', 'Soon 873 A', 'S873A', 'America/Chicago', 'USD'),
  (pg_temp.id(2), 'sx873-b', 'Soon 873 B', 'S873B', 'America/Chicago', 'USD'),
  (pg_temp.id(3), 'sx873-c', 'Soon 873 C', 'S873C', 'America/Chicago', 'USD');
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at)
  select c, m, true, 'test', now() from unnest(array[pg_temp.id(1), pg_temp.id(2), pg_temp.id(3)]) c, unnest(array['giving', 'giving_proofs']) m
  on conflict (center_id, module_key) do update set granted = true;
insert into app.households (id, center_id, display_name) values
  (pg_temp.id(11), pg_temp.id(1), 'Rao family'), (pg_temp.id(12), pg_temp.id(2), 'Shah family'), (pg_temp.id(13), pg_temp.id(3), 'Iyer family');
insert into app.center_owners (center_id, user_id) values (pg_temp.id(1), pg_temp.id(21)), (pg_temp.id(2), pg_temp.id(21)), (pg_temp.id(3), pg_temp.id(21));
insert into app.role_grants (center_id, user_id, role_key) values (pg_temp.id(1), pg_temp.id(22), 'treasurer'), (pg_temp.id(3), pg_temp.id(22), 'treasurer');
-- A member of community A who holds no role at all
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values
  (pg_temp.id(23), pg_temp.id(3), 'Mina', 'Iyer', '1980-01-01'), (pg_temp.id(24), pg_temp.id(1), 'Amy', 'Rao', '1982-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  (pg_temp.id(13), pg_temp.id(23), pg_temp.id(3), 'primary', true), (pg_temp.id(11), pg_temp.id(24), pg_temp.id(1), 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (pg_temp.id(3), pg_temp.id(23), pg_temp.id(23)), (pg_temp.id(1), pg_temp.id(24), pg_temp.id(24));
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, dedication) values
  (pg_temp.id(31), pg_temp.id(1), pg_temp.id(11), 'general', 100000, now() - interval '9 years', 'A: still open'),
  (pg_temp.id(33), pg_temp.id(3), pg_temp.id(13), 'general', 100000, now() - interval '10 days', 'C: open');
insert into app.center_payment_methods (center_id, method, accepted) values (pg_temp.id(3), 'check', true) on conflict (center_id, method) do update set accepted = true;
select set_config('t.c1', pg_temp.id(1)::text, false), set_config('t.c2', pg_temp.id(2)::text, false), set_config('t.c3', pg_temp.id(3)::text, false);

-- ── A. Who sent it ───────────────────────────────────────────────────────────
-- Community C: a proof Mina submits herself, and one entered with no sender at all.
select pg_temp.as_user(pg_temp.id(23));
select app.submit_payment_proof(pg_temp.id(3), pg_temp.id(13), 'check', 20000, pg_temp.today(), '555', null, null, 'open_pledges', null,
        jsonb_build_array(jsonb_build_object('path', pg_temp.id(3)::text || '/' || pg_temp.id(13)::text || '/' || pg_temp.id(203)::text || '/a.jpg', 'content_type', 'image/jpeg', 'bytes', 900)),
        'key-873-0001');
reset role;
insert into app.payment_proofs (id, center_id, household_id, method, amount_cents, paid_on, status)
  values (pg_temp.id(204), pg_temp.id(3), pg_temp.id(13), 'check', 5000, pg_temp.today(), 'submitted');
select pg_temp.as_user(pg_temp.id(22));
select pg_temp.assert(jsonb_array_length(app.payment_proof_queue(pg_temp.id(3))) = 2, 'A · both proofs are in the queue');
select pg_temp.assert((select c ->> 'sent_by' from jsonb_array_elements(app.payment_proof_queue(pg_temp.id(3))) c where c ->> 'id' = pg_temp.id(204)::text) is null
                  and (select c ? 'sent_by' from jsonb_array_elements(app.payment_proof_queue(pg_temp.id(3))) c where c ->> 'id' = pg_temp.id(204)::text),
                      'A · a proof with no known sender carries sent_by as null');
select pg_temp.assert((select count(*) from jsonb_array_elements(app.payment_proof_queue(pg_temp.id(3))) c where c ->> 'sent_by' = 'Mina Iyer') = 1,
                      'A · the card of the proof Mina submitted says "Mina Iyer"');
select pg_temp.assert((select bool_and(c ? 'household' and c ? 'lookalikes' and c ? 'bank_lines' and c ? 'age_days') from jsonb_array_elements(app.payment_proof_queue(pg_temp.id(3))) c),
                      'A · the rest of each card is unchanged');

-- ── B. Files that become due soon ────────────────────────────────────────────
reset role;
select pg_temp.pay_file(1, pg_temp.id(1), pg_temp.id(11), 7);                                   -- paid 7 years ago, nothing open: due Jan 1 next year
select pg_temp.pay_file(2, pg_temp.id(1), pg_temp.id(11), 7, array[pg_temp.id(31)]);            -- same, but its pledge is still open: held back
select pg_temp.pay_file(3, pg_temp.id(1), pg_temp.id(11), 8);                                   -- paid 8 years ago: already due today, the daily job's
select pg_temp.pay_file(4, pg_temp.id(1), pg_temp.id(11), 6);                                   -- paid 6 years ago: due a year later than the first
select pg_temp.as_user(pg_temp.id(22));
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(1), :n) ->> 'count')::int = 1
                  and (app.proof_files_due_soon(pg_temp.id(1), :n) ->> 'soonest_on')::date = make_date(:yr + 1, 1, 1)
                  and (app.proof_files_due_soon(pg_temp.id(1), :n) ->> 'legal_hold')::boolean = false,
                      'B · one file becomes due by Jan 1 of next year (the open pledge, the overdue file and the later file are not counted)');
select pg_temp.assert(:n = 1 or ((app.proof_files_due_soon(pg_temp.id(1), :n - 1) ->> 'count')::int = 0
                                 and app.proof_files_due_soon(pg_temp.id(1), :n - 1) -> 'soonest_on' = 'null'::jsonb),
                      'B · one day short of that, nothing is counted and soonest_on is null');
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(1), 365) ->> 'count')::int in (1, 2), 'B · a year ahead counts the files that fall in range (the 6 year old file only near the start of the year)');
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(1)) ->> 'days')::int = 30, 'B · the default window is 30 days');
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(1), 100000) ->> 'days')::int = 365 and (app.proof_files_due_soon(pg_temp.id(1), 0) ->> 'days')::int = 1,
                      'B · the window is kept between 1 and 365 days');
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(3), 30) ->> 'count')::int = 0, 'B · another community''s files are not counted');

-- ── C. Not accepted proofs and the legal hold ────────────────────────────────
-- Community B: a proof not accepted 13 months less 10 days ago is removed in about 10 days.
reset role;
insert into app.payment_proofs (id, center_id, household_id, method, amount_cents, paid_on, status, decided_at)
  values (pg_temp.id(205), pg_temp.id(2), pg_temp.id(12), 'check', 100, pg_temp.today() - 400, 'rejected', now() - interval '13 months' + interval '10 days');
insert into app.payment_proof_files (id, center_id, proof_id, household_id, storage_path, content_type, bytes, sha256, member_visible)
  values (pg_temp.id(305), pg_temp.id(2), pg_temp.id(205), pg_temp.id(12), pg_temp.id(2) || '/' || pg_temp.id(12) || '/' || pg_temp.id(305) || '.jpg', 'image/jpeg', 2005,
          md5('873-5') || md5('5-873'), true);
select pg_temp.as_user(pg_temp.id(21));
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(2), 30) ->> 'count')::int = 1
                  and (app.proof_files_due_soon(pg_temp.id(2), 30) ->> 'soonest_on')::date
                      = (((select decided_at from app.payment_proofs where id = pg_temp.id(205)) + interval '13 months') at time zone 'America/Chicago')::date,
                      'C · a proof not accepted counts, and soonest_on is the day its 13 months end');
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(2), 3) ->> 'count')::int = 0, 'C · it is not counted before the window reaches that day');
reset role;
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"payments":{"proofs":{"legal_hold":true}}}'::jsonb where id = pg_temp.id(2);
select pg_temp.as_user(pg_temp.id(21));
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(2), 30) ->> 'legal_hold')::boolean = true and (app.proof_files_due_soon(pg_temp.id(2), 30) ->> 'count')::int = 1,
                      'C · under a legal hold the file is still counted and the answer says the hold is on');
reset role;
select pg_temp.assert((select count(*) from app._proof_files_due(pg_temp.id(2))) = 0, 'C · and the daily job removes nothing while the hold is on');

-- ── D. Who may ask ───────────────────────────────────────────────────────────
select pg_temp.as_user(pg_temp.id(22));
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(1), :n) ->> 'count')::int = 1, 'D · the treasurer may ask');
select pg_temp.as_user(pg_temp.id(21));
select pg_temp.assert((app.proof_files_due_soon(pg_temp.id(1), :n) ->> 'count')::int = 1, 'D · the owner (settings.manage) may ask');
select pg_temp.as_user(pg_temp.id(24));
select pg_temp.assert_state($$select app.proof_files_due_soon(pg_temp.u('c1'), 30)$$, '42501', 'D · a member with no role cannot ask');
select pg_temp.as_user(pg_temp.id(22));
select pg_temp.assert_state($$select app.proof_files_due_soon(pg_temp.u('c2'), 30)$$, '42501', 'D · a treasurer of another community cannot ask about this one');
reset role;
set local role anon;
select pg_temp.assert_state($$select app.proof_files_due_soon(pg_temp.u('c1'), 30)$$, '42501', 'D · a signed-out visitor cannot ask');
reset role;
delete from app.center_module_grants where center_id = pg_temp.id(1) and module_key = 'giving_proofs';
select pg_temp.as_user(pg_temp.id(22));
select pg_temp.assert_state($$select app.proof_files_due_soon(pg_temp.u('c1'), 30)$$, '42501', 'D · it is closed while the proofs module is off');
reset role;

-- ── E. The daily job's rule is unchanged ─────────────────────────────────────
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at) values (pg_temp.id(1), 'giving_proofs', true, 'test', now())
  on conflict (center_id, module_key) do update set granted = true;
select pg_temp.assert((select string_agg(right(d.file_id::text, 3), ',' order by d.file_id) from app._proof_files_due(pg_temp.id(1)) d) = '303',
                      'E · only the file paid 8 years ago is due today');
select pg_temp.assert((select d.due_on from app._proof_files_due(pg_temp.id(1), pg_temp.id(303)) d) = make_date(:yr - 8 + 7, 12, 31) + 1,
                      'E · the rule reports the day a file became due');
select pg_temp.assert((select count(*) from app._proof_files_due(pg_temp.id(1), null, 3)) = 3, 'E · the years override still works (3 years: the 8, 7 and 6 year old files with nothing open)');
rollback;
