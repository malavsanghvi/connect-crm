-- 0871 (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md §4.5, A36-A38, A41): evidence retention.
--   A. Which files are due     B. The worker's list and who may call it     C. Removing a file keeps a tombstone
--   D. Legal hold              E. The Settings preview
-- Everything runs in one transaction that is rolled back, in its own communities.
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
create or replace function pg_temp.assert_state(stmt text, state text, label text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % (no error was raised)', label;
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
create or replace function pg_temp.as_none() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '', true);
end $$;
-- Fixed ids: id(1..) communities, id(11..) households, id(21..) people, id(31..) pledges, id(100+n) payments, id(200+n) proofs, id(300+n) files.
create or replace function pg_temp.id(n int) returns uuid language sql as $$ select ('87100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.yr() returns int language sql as $$ select extract(year from (now() at time zone 'America/Chicago')::date)::int $$;
-- A payment received on June 1 of (this year - p_back), allocated to the given pledges (100 cents each).
create or replace function pg_temp.pay(p_n int, p_center uuid, p_hh uuid, p_back int, p_pledges uuid[] default '{}') returns void language plpgsql as $$
declare k uuid;
begin
  insert into app.payments (id, center_id, household_id, amount_cents, method, provider, received_on)
  values (pg_temp.id(100 + p_n), p_center, p_hh, 100 * greatest(coalesce(array_length(p_pledges, 1), 1), 1), 'check', 'offline', make_date(pg_temp.yr() - p_back, 6, 1));
  foreach k in array p_pledges loop
    insert into app.payment_allocations (center_id, payment_id, pledge_id, amount_cents) values (p_center, pg_temp.id(100 + p_n), k, 100);
  end loop;
end $$;
-- A proof; the payment (when approved or merged) is id(100 + p_n).
create or replace function pg_temp.proof(p_n int, p_center uuid, p_hh uuid, p_status text, p_paid_on date, p_decided_ago interval, p_pay int default null) returns void language plpgsql as $$
begin
  insert into app.payment_proofs (id, center_id, household_id, method, amount_cents, paid_on, status, decided_at, payment_id)
  values (pg_temp.id(200 + p_n), p_center, p_hh, 'check', 100, p_paid_on, p_status, case when p_decided_ago is null then null else now() - p_decided_ago end,
          case when p_pay is null then null else pg_temp.id(100 + p_pay) end);
end $$;
-- A file of a proof (p_proof = n) or of a payment (p_pay = n) or both (what approving does).
create or replace function pg_temp.file(p_n int, p_center uuid, p_hh uuid, p_proof int default null, p_pay int default null, p_visible boolean default true) returns void language plpgsql as $$
begin
  insert into app.payment_proof_files (id, center_id, proof_id, payment_id, household_id, storage_path, content_type, bytes, sha256, member_visible)
  values (pg_temp.id(300 + p_n), p_center, case when p_proof is null then null else pg_temp.id(200 + p_proof) end,
          case when p_pay is null then null else pg_temp.id(100 + p_pay) end, p_hh,
          p_center || '/' || p_hh || '/' || pg_temp.id(300 + p_n) || '.jpg', 'image/jpeg', 2000 + p_n,
          md5('871' || p_n::text) || md5(p_n::text || '871'), p_visible);
end $$;
-- The ids of the files the worker is told to remove, in the two test communities.
create or replace function pg_temp.due_ids() returns text language sql as $$
  select coalesce(string_agg(right(d.file_id::text, 3), ',' order by d.file_id), '') from app.proof_files_due(1000) d
   where d.center_id in (pg_temp.id(1), pg_temp.id(2))
$$;

begin;
grant connect_worker to postgres;   -- the tests switch to connect_worker; a hosted postgres holds ADMIN on it but not SET
select pg_temp.yr() as yr \gset

-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  (pg_temp.id(21), 'olga@ret871.test'), (pg_temp.id(22), 'tara@ret871.test'), (pg_temp.id(23), 'ref@ret871.test');
insert into app.centers (id, slug, name, short_name, time_zone, currency) values
  (pg_temp.id(1), 'ret871', 'Retention 871', 'R871', 'America/Chicago', 'USD'),
  (pg_temp.id(2), 'ret871-b', 'Retention 871 B', 'R871B', 'America/Chicago', 'USD');
-- Community B keeps its proofs 3 years; community A uses the default 7.
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"payments":{"proofs":{"retention_years":3}}}'::jsonb where id = pg_temp.id(2);
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at) values
  (pg_temp.id(1), 'giving', true, 'test', now()), (pg_temp.id(1), 'giving_proofs', true, 'test', now()),
  (pg_temp.id(2), 'giving', true, 'test', now()), (pg_temp.id(2), 'giving_proofs', true, 'test', now())
  on conflict (center_id, module_key) do update set granted = excluded.granted;
insert into app.households (id, center_id, display_name) values (pg_temp.id(11), pg_temp.id(1), 'Rao family'), (pg_temp.id(12), pg_temp.id(2), 'Shah family');
insert into app.center_owners (center_id, user_id) values (pg_temp.id(1), pg_temp.id(21));
insert into app.role_grants (center_id, user_id, role_key) values (pg_temp.id(1), pg_temp.id(22), 'treasurer');

-- Pledges (their final / not-final marks are set last, after the payments: the allocations recompute the status by themselves)
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, dedication) values
  (pg_temp.id(31), pg_temp.id(1), pg_temp.id(11), 'general', 100000, now() - interval '9 years', 'A: Bank reconciled'),
  (pg_temp.id(32), pg_temp.id(1), pg_temp.id(11), 'general', 100000, now() - interval '9 years', 'B: still open'),
  (pg_temp.id(33), pg_temp.id(1), pg_temp.id(11), 'general', 100000, now() - interval '9 years', 'C: written off'),
  (pg_temp.id(34), pg_temp.id(1), pg_temp.id(11), 'general', 100000, now() - interval '9 years', 'D: cancelled'),
  (pg_temp.id(35), pg_temp.id(2), pg_temp.id(12), 'general', 100000, now() - interval '9 years', 'E: Bank reconciled');

-- 1  approved proof, paid 8 years ago, its pledge final                                  -> due (301)  and a staff file on the same payment -> due (302)
select pg_temp.pay(1, pg_temp.id(1), pg_temp.id(11), 8, array[pg_temp.id(31)]);
select pg_temp.proof(1, pg_temp.id(1), pg_temp.id(11), 'approved', make_date(:yr - 8, 6, 1), interval '8 years', 1);
select pg_temp.file(1, pg_temp.id(1), pg_temp.id(11), 1, 1);
select pg_temp.file(2, pg_temp.id(1), pg_temp.id(11), null, 1, false);
update app.payment_proof_files set uploaded_by = pg_temp.id(23) where id = pg_temp.id(301);
-- 3  paid 7 years ago: the clock ends Dec 31 of this year                                -> not due (303)
select pg_temp.pay(3, pg_temp.id(1), pg_temp.id(11), 7, array[pg_temp.id(31)]);
select pg_temp.file(3, pg_temp.id(1), pg_temp.id(11), null, 3, false);
-- 4  paid 8 years ago, but its pledge is still open                                      -> not due (304)
select pg_temp.pay(4, pg_temp.id(1), pg_temp.id(11), 8, array[pg_temp.id(32)]);
select pg_temp.proof(4, pg_temp.id(1), pg_temp.id(11), 'approved', make_date(:yr - 8, 6, 1), interval '8 years', 4);
select pg_temp.file(4, pg_temp.id(1), pg_temp.id(11), 4, 4);
-- 5  its pledges were written off and cancelled                                          -> due (305)
select pg_temp.pay(5, pg_temp.id(1), pg_temp.id(11), 8, array[pg_temp.id(33), pg_temp.id(34)]);
select pg_temp.file(5, pg_temp.id(1), pg_temp.id(11), null, 5, false);
-- 6  a refund was asked for and is not recorded yet                                      -> not due (306)
select pg_temp.pay(6, pg_temp.id(1), pg_temp.id(11), 8, array[pg_temp.id(31)]);
update app.payments set refund_approved_by = pg_temp.id(23), refund_requested_cents = 100 where id = pg_temp.id(106);
select pg_temp.file(6, pg_temp.id(1), pg_temp.id(11), null, 6, false);
-- 7  the provider reported a refund that is flagged                                      -> not due (307)
select pg_temp.pay(7, pg_temp.id(1), pg_temp.id(11), 8, array[pg_temp.id(31)]);
insert into app.payment_refunds (center_id, payment_id, source, provider, amount_cents, provider_ref, status)
  values (pg_temp.id(1), pg_temp.id(107), 'provider_dashboard', 'stripe', 100, 're_871_flagged', 'flagged');
select pg_temp.file(7, pg_temp.id(1), pg_temp.id(11), null, 7, false);
-- 8  not accepted 14 months ago -> due (308); 9  not accepted 12 months ago -> not due (309); 10  taken back 14 months ago -> due (310)
select pg_temp.proof(8, pg_temp.id(1), pg_temp.id(11), 'rejected', current_date - 400, interval '14 months');
select pg_temp.file(8, pg_temp.id(1), pg_temp.id(11), 8);
select pg_temp.proof(9, pg_temp.id(1), pg_temp.id(11), 'rejected', current_date - 400, interval '12 months');
select pg_temp.file(9, pg_temp.id(1), pg_temp.id(11), 9);
select pg_temp.proof(10, pg_temp.id(1), pg_temp.id(11), 'withdrawn', current_date - 400, interval '14 months');
select pg_temp.file(10, pg_temp.id(1), pg_temp.id(11), 10);
-- 11 a proof still waiting for the treasury team, paid 9 years ago                       -> never due (311)
select pg_temp.proof(11, pg_temp.id(1), pg_temp.id(11), 'submitted', make_date(:yr - 9, 6, 1), null);
select pg_temp.file(11, pg_temp.id(1), pg_temp.id(11), 11);
-- 12 merged onto a payment that credited no pledge (none counts as final)                -> due (312)
select pg_temp.pay(12, pg_temp.id(1), pg_temp.id(11), 8);
select pg_temp.proof(12, pg_temp.id(1), pg_temp.id(11), 'merged', make_date(:yr - 8, 6, 1), interval '8 years', 12);
select pg_temp.file(12, pg_temp.id(1), pg_temp.id(11), 12, 12);
-- 13 approved, paid to a final pledge, but its soft credit also pointed at an open pledge -> not due (313)
select pg_temp.pay(13, pg_temp.id(1), pg_temp.id(11), 8, array[pg_temp.id(31)]);
select pg_temp.proof(13, pg_temp.id(1), pg_temp.id(11), 'approved', make_date(:yr - 8, 6, 1), interval '8 years', 13);
insert into app.soft_credits (center_id, proof_id, pledge_id, amount_cents, state) values (pg_temp.id(1), pg_temp.id(213), pg_temp.id(32), 100, 'converted');
select pg_temp.file(13, pg_temp.id(1), pg_temp.id(11), 13, 13);
-- 14 paid 6 years ago (a family photo and a staff file); 15 paid 5 years ago: due only if the years are shortened (314, 315, 316)
select pg_temp.pay(14, pg_temp.id(1), pg_temp.id(11), 6, array[pg_temp.id(31)]);
select pg_temp.proof(14, pg_temp.id(1), pg_temp.id(11), 'approved', make_date(:yr - 6, 6, 1), interval '6 years', 14);
select pg_temp.file(14, pg_temp.id(1), pg_temp.id(11), 14, 14);
select pg_temp.file(15, pg_temp.id(1), pg_temp.id(11), null, 14, false);
select pg_temp.pay(15, pg_temp.id(1), pg_temp.id(11), 5, array[pg_temp.id(31)]);
select pg_temp.file(16, pg_temp.id(1), pg_temp.id(11), null, 15, false);
-- Community B keeps 3 years: paid 5 years ago -> due (321); paid 3 years ago -> not due (322)
select pg_temp.pay(21, pg_temp.id(2), pg_temp.id(12), 5, array[pg_temp.id(35)]);
select pg_temp.file(21, pg_temp.id(2), pg_temp.id(12), null, 21, false);
select pg_temp.pay(22, pg_temp.id(2), pg_temp.id(12), 3, array[pg_temp.id(35)]);
select pg_temp.file(22, pg_temp.id(2), pg_temp.id(12), null, 22, false);

-- The final / not-final marks (set last: a payment or allocation change recomputes them)
update app.pledges set reconciled_at = now(), reconciled_kind = 'bank' where id in (pg_temp.id(31), pg_temp.id(35));
update app.pledges set status = 'written_off', written_off_by = pg_temp.id(21), written_off_second_approver = pg_temp.id(22) where id = pg_temp.id(33);
update app.pledges set status = 'cancelled' where id = pg_temp.id(34);

-- ═══════════════════════════════════════════════════════════════════════════════
-- A + B. The worker's list: only the worker may ask, and it is exactly the files whose conditions all hold
select pg_temp.assert_raises($$select * from app.proof_files_due(10)$$, 'background service', 'B · the plain database owner is not the worker');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.proof_files_due(int)', 'execute')
                  and not has_function_privilege('anon', 'app.proof_files_due(int)', 'execute')
                  and not has_function_privilege('authenticated', 'app.proof_file_removed(uuid, text)', 'execute')
                  and not has_function_privilege('anon', 'app.proof_file_removed(uuid, text)', 'execute')
                  and (not exists (select 1 from pg_roles where rolname = 'service_role')
                       or (not has_function_privilege('service_role', 'app.proof_files_due(int)', 'execute')
                           and not has_function_privilege('service_role', 'app.proof_file_removed(uuid, text)', 'execute')))
                  and has_function_privilege('connect_worker', 'app.proof_files_due(int)', 'execute')
                  and has_function_privilege('connect_worker', 'app.proof_file_removed(uuid, text)', 'execute'),
                      'B · only the background service can list or remove: no member, no signed-in staff, no service key');
select pg_temp.as_user(pg_temp.id(21));
select pg_temp.assert_raises($$select * from app.proof_files_due(10)$$, 'permission denied', 'B · not even the owner of the community can list the files to remove');
select pg_temp.assert_raises($$select app.proof_file_removed(pg_temp.id(301), 'x')$$, 'permission denied', 'B · nor mark one removed');
select pg_temp.as_none();
set local role connect_worker;
select pg_temp.due_ids() as due1 \gset
select string_agg(right(d.file_id::text, 3) || '=' || d.reason, ' | ' order by d.file_id) as reasons from app.proof_files_due(1000) d where d.center_id in (pg_temp.id(1), pg_temp.id(2)) \gset
reset role;
select pg_temp.assert(:'due1' = '301,302,305,308,310,312,321', 'A · due: 301 approved proof, 302 staff file, 305 written-off/cancelled pledges, 308 not accepted, 310 taken back, 312 no pledge, 321 community B (3 years). Got ' || :'due1');
select pg_temp.assert(position('303' in :'due1') = 0, 'A · paid 7 years ago: the clock ends Dec 31 of this year, so not yet (303)');
select pg_temp.assert(position('304' in :'due1') = 0 and position('313' in :'due1') = 0, 'A · not while a pledge it supports is not final (304; 313 through its soft credit)');
select pg_temp.assert(position('306' in :'due1') = 0 and position('307' in :'due1') = 0, 'A · not while a refund is open (306 asked for, 307 flagged from the provider)');
select pg_temp.assert(position('309' in :'due1') = 0 and position('308' in :'due1') > 0 and position('310' in :'due1') > 0,
                      'A41 · a proof not accepted stays 12 months, is removed after 14; a taken-back one too');
select pg_temp.assert(position('311' in :'due1') = 0, 'A · a proof still waiting for the treasury team is never removed (311)');
select pg_temp.assert(position('322' in :'due1') = 0 and position('314' in :'due1') = 0 and position('316' in :'due1') = 0,
                      'A · each community uses its own years: 322 (3 years, paid 3 years ago) and 314-316 (7 years) wait');
select pg_temp.assert(position('301=Kept 7 years after the end of ' || (:yr - 8) in :'reasons') > 0 and position('308=Confirmation not accepted' in :'reasons') > 0
                      and position('310=Confirmation taken back' in :'reasons') > 0 and position('321=Kept 3 years' in :'reasons') > 0,
                      'A · each file is listed with its plain-English reason');

-- A refund that was recorded no longer holds the evidence (payment 106: refunded)
update app.payments set refunded_cents = 100, refund_second_approver = pg_temp.id(22) where id = pg_temp.id(106);
set local role connect_worker;
select pg_temp.due_ids() as due1b \gset
reset role;
select pg_temp.assert(position('306' in :'due1b') > 0, 'A · once the refund is recorded, the evidence is no longer held for it');
update app.payments set refunded_cents = 0, refund_second_approver = null where id = pg_temp.id(106);

-- ═══════════════════════════════════════════════════════════════════════════════
-- C. Removing a file keeps a tombstone (A36)
select pg_temp.assert_raises($$select app.proof_file_removed(pg_temp.id(301), 'x')$$, 'background service', 'C · the plain database owner cannot mark a file removed');
set local role connect_worker;
select pg_temp.assert_raises($$select app.proof_file_removed(pg_temp.id(303), 'too early')$$, 'not due', 'C · a file that is not due is refused (clock)');
select pg_temp.assert_raises($$select app.proof_file_removed(pg_temp.id(304), 'too early')$$, 'not due', 'C · a file that is not due is refused (pledge not final)');
select pg_temp.assert_raises($$select app.proof_file_removed(pg_temp.id(311), 'too early')$$, 'not due', 'C · a proof still waiting is refused');
select pg_temp.assert_raises($$select app.proof_file_removed(pg_temp.id(999), 'nothing')$$, 'not found', 'C · an unknown file is refused');
select app.proof_file_removed(pg_temp.id(301), null);
select app.proof_file_removed(pg_temp.id(308), 'Retention: custom words');
reset role;
select deleted_at as when1 from app.payment_proof_files where id = pg_temp.id(301) \gset
set local role connect_worker;
select app.proof_file_removed(pg_temp.id(301), 'again');   -- a retried job: nothing changes
select pg_temp.due_ids() as due2 \gset
reset role;
select pg_temp.assert((select deleted_at = :'when1'::timestamptz and deleted_reason like 'Kept 7 years after the end of %' from app.payment_proof_files where id = pg_temp.id(301)),
                      'C · the file is stamped removed with the reason; a retry changes nothing');
select pg_temp.assert((select deleted_reason = 'Retention: custom words' from app.payment_proof_files where id = pg_temp.id(308)), 'C · the worker may state its own reason');
select pg_temp.assert((select sha256 = md5('871' || '1') || md5('1' || '871') and bytes = 2001 and content_type = 'image/jpeg' and uploaded_by = pg_temp.id(23)
                              and storage_path is not null and proof_id = pg_temp.id(201) and payment_id = pg_temp.id(101)
                         from app.payment_proof_files where id = pg_temp.id(301)),
                      'C · the tombstone keeps the hash, size, type, who sent it and where it belonged');
select pg_temp.assert(position('301' in :'due2') = 0 and position('308' in :'due2') = 0 and position('302' in :'due2') > 0, 'C · a removed file is no longer listed; the others still are');
select pg_temp.assert((select count(*) from app.audit_log where center_id = pg_temp.id(1) and action = 'storage.retention_delete'
                          and record_id = 'payment-evidence/' || (select storage_path from app.payment_proof_files where id = pg_temp.id(301))
                          and (after is null) and before ->> 'bucket' = 'payment-evidence') = 1,
                      'C · one storage.retention_delete audit entry per removed file, none for the retry');
select pg_temp.assert((select count(*) from app.payments where id = pg_temp.id(101)) = 1 and (select count(*) from app.payment_proofs where id = pg_temp.id(201)) = 1
                      and (select count(*) from app.payment_allocations where payment_id = pg_temp.id(101)) = 1,
                      'C · the payment, the proof and the allocation stay');
-- A36: the pledge says the photo was removed, when and why
select pg_temp.as_user(pg_temp.id(21));
select pg_temp.assert(jsonb_path_exists(app.pledge_evidence(pg_temp.id(31)),
                        '$[*].files[*] ? (@.id == $id && @.removed == true && @.removed_reason like_regex "^Kept 7 years" && @.removed_on != null)',
                        jsonb_build_object('id', pg_temp.id(301)::text)),
                      'A36 · the pledge shows the photo as removed, with when and why');
select pg_temp.as_none();

-- ═══════════════════════════════════════════════════════════════════════════════
-- D. Legal hold stops everything (A38)
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"payments":{"proofs":{"legal_hold":true}}}'::jsonb where id = pg_temp.id(1);
set local role connect_worker;
select pg_temp.due_ids() as due3 \gset
select pg_temp.assert_raises($$select app.proof_file_removed(pg_temp.id(302), 'x')$$, 'not due', 'D · under legal hold even a due file is refused');
reset role;
select pg_temp.assert(:'due3' = '321', 'D · legal hold stops all removal in that community, the 13 months included; the other community is unaffected. Got ' || :'due3');
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"payments":{"proofs":{"legal_hold":false}}}'::jsonb where id = pg_temp.id(1);
set local role connect_worker;
select pg_temp.due_ids() as due4 \gset
reset role;
select pg_temp.assert(position('302' in :'due4') > 0, 'D · the hold lifted: removal resumes');

-- ═══════════════════════════════════════════════════════════════════════════════
-- E. The Settings preview (A37): nothing is removed, the count is of files that would be
select pg_temp.as_user(pg_temp.id(22));
select pg_temp.assert_state($$select app.proof_retention_preview(pg_temp.id(1), 5)$$, '42501', 'E · staff without settings.manage cannot see it');
select pg_temp.as_user(pg_temp.id(21));
select pg_temp.assert_raises($$select app.proof_retention_preview(pg_temp.id(1), 2)$$, '3 to 25', 'E · fewer than 3 years is refused');
select pg_temp.assert_raises($$select app.proof_retention_preview(pg_temp.id(1), 26)$$, '3 to 25', 'E · more than 25 years is refused');
select app.proof_retention_preview(pg_temp.id(1), 5)::text as pv5 \gset
select app.proof_retention_preview(pg_temp.id(1), 3)::text as pv3 \gset
select app.proof_retention_preview(pg_temp.id(1), 10)::text as pv10 \gset
select app.proof_retention_preview(pg_temp.id(1), 7)::text as pv7 \gset
select pg_temp.as_none();
-- 5 years: paid 7 and 6 years ago become due (303 staff file, 314 family photo, 315 staff file); 316 (5 years ago) and the held ones do not
select pg_temp.assert((:'pv5'::jsonb ->> 'files')::int = 3 and (:'pv5'::jsonb ->> 'family_files')::int = 1
                      and (:'pv5'::jsonb ->> 'current_years')::int = 7 and (:'pv5'::jsonb ->> 'new_years')::int = 5,
                      'E · at 5 years 3 more files would go, 1 of them one the family can open. Got ' || :'pv5');
select pg_temp.assert((:'pv3'::jsonb ->> 'files')::int = 4 and (:'pv3'::jsonb ->> 'family_files')::int = 1, 'E · at 3 years 4 more files would go (316 too). Got ' || :'pv3');
select pg_temp.assert((:'pv10'::jsonb ->> 'files')::int = 0 and (:'pv7'::jsonb ->> 'files')::int = 0, 'E · raising the years, or keeping them, loses nothing');
select pg_temp.assert((select count(*) from app.payment_proof_files where deleted_at is not null and center_id = pg_temp.id(1)) = 2, 'E · the preview removed nothing');
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"payments":{"proofs":{"legal_hold":true}}}'::jsonb where id = pg_temp.id(1);
select pg_temp.as_user(pg_temp.id(21));
select app.proof_retention_preview(pg_temp.id(1), 5)::text as pvh \gset
select pg_temp.as_none();
select pg_temp.assert((:'pvh'::jsonb ->> 'legal_hold')::boolean and (:'pvh'::jsonb ->> 'files')::int = 3, 'E · under a legal hold the preview says so, and still counts the files');
rollback;
