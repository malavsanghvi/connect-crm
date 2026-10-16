-- 0874: staff-attached evidence on a payment, the pledge timeline, the orphan upload list for the daily job.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'FAIL: %', label; end if; raise notice 'PASS: %', label; end $$;
create or replace function pg_temp.assert_raises(stmt text, expect text, label text) returns void language plpgsql as $$
begin
  execute stmt; raise exception 'FAIL: % (no error was raised)', label;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/giving"}', true);
  set local role authenticated;
end $$;
create or replace function pg_temp.today() returns date language sql as $$ select (now() at time zone 'America/Chicago')::date $$;
create or replace function pg_temp.u(k text) returns uuid language sql as $$ select current_setting('t.' || k)::uuid $$;
-- The timeline as "kind:event" words, in order.
create or replace function pg_temp.tl(p_pledge uuid) returns text language sql as $$
  select string_agg(e ->> 'kind' || coalesce(':' || (e ->> 'event'), ''), ' > ' order by n)
    from jsonb_array_elements(app.pledge_timeline(p_pledge)) with ordinality t(e, n)
$$;
\set c '''00000000-0000-4000-8000-000000087401'''
\set h1 '''87400000-0000-4000-8000-0000000000a1'''
\set h2 '''87400000-0000-4000-8000-0000000000a2'''
\set mina '''87400000-0000-4000-8000-000000000001'''
\set zed '''87400000-0000-4000-8000-000000000002'''
\set tara '''87400000-0000-4000-8000-000000000005'''
\set vol '''87400000-0000-4000-8000-000000000006'''
\set pmina '''87400000-0000-4000-8000-000000000101'''
\set pzed '''87400000-0000-4000-8000-000000000102'''
\set acct '''87400000-0000-4000-8000-0000000003b1'''
\set l1 '''87400000-0000-4000-8000-0000000004a1'''
\set pq1 '''87400000-0000-4000-8000-0000000002a1'''
\set pq2 '''87400000-0000-4000-8000-0000000002a2'''
\set pq3 '''87400000-0000-4000-8000-0000000002a3'''
\set pq4 '''87400000-0000-4000-8000-0000000002a4'''
\set pl1 '''87400000-0000-4000-8000-0000000001a1'''
\set pl2 '''87400000-0000-4000-8000-0000000001a2'''
\set pl3 '''87400000-0000-4000-8000-0000000001a3'''
\set pl4 '''87400000-0000-4000-8000-0000000001a4'''
begin;
grant connect_worker to postgres;   -- the tests switch to connect_worker; a hosted postgres holds ADMIN on it but not SET
select set_config('t.c', :c, false), set_config('t.h1', :h1, false), set_config('t.pl1', :pl1, false), set_config('t.pl2', :pl2, false),
       set_config('t.pl3', :pl3, false), set_config('t.pl4', :pl4, false), set_config('t.pq3', :pq3, false);
insert into auth.users (id, email) values (:mina, 'mina@gap874.test'), (:zed, 'zed@gap874.test'), (:tara, 'tara@gap874.test'), (:vol, 'vol@gap874.test');
insert into app.centers (id, slug, name, short_name, time_zone, currency) values (:c, 'gap874', 'Gap 874', 'G874', 'America/Chicago', 'USD');
insert into app.center_module_grants (center_id, module_key, granted, reason, granted_at) values
  (:c, 'giving', true, 'test', now()), (:c, 'giving_proofs', true, 'test', now()), (:c, 'giving_bank', true, 'test', now())
  on conflict (center_id, module_key) do update set granted = true;
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Rao family'), (:h2, :c, 'Zed family');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:pmina, :c, 'Mina', 'Rao', '1980-01-01'), (:pzed, :c, 'Zed', 'Khan', '1981-01-01');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values (:h1, :pmina, :c, 'primary', true), (:h2, :pzed, :c, 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values (:c, :mina, :pmina), (:c, :zed, :pzed);
insert into app.role_grants (center_id, user_id, role_key) values (:c, :tara, 'treasurer'), (:c, :vol, 'finance_volunteer');
insert into app.center_payment_methods (center_id, method, accepted) values (:c, 'check', true) on conflict (center_id, method) do update set accepted = true;
insert into app.bank_accounts (id, center_id, name, institution, last4) values (:acct, :c, 'Operating', 'Chase', '4608');
insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, dedication) values
  (:pl1, :c, :h1, 'general', 100000, now() - interval '10 days', 'Big pledge'),
  (:pl2, :c, :h1, 'general', 20000, now() - interval '9 days', 'Small pledge, goes to the bank'),
  (:pl3, :c, :h1, 'general', 5000, now() - interval '8 days', 'Taken back'),
  (:pl4, :c, :h1, 'general', 7000, now() - interval '7 days', 'Not accepted');

-- ═══ A. Staff attach a file to a payment ═══════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:tara);
select app.record_offline_payment(:h1, 10000, 'check'::app.payment_method, pg_temp.today() - 3, null, '101') as pay1 \gset
select set_config('t.pay1', :'pay1', false);
select pg_temp.as_user(:vol);
select app.record_offline_payment(:h1, 5000, 'check'::app.payment_method, pg_temp.today() - 3, null, '102') as pay2 \gset
select set_config('t.pay2', :'pay2', false);
select pg_temp.as_user(:tara);
select (app.attach_payment_evidence(:'pay1'::uuid, :c::text || '/staff/' || :'pay1' || '/check-1.jpg', 'image/jpeg', 150000, repeat('a', 64))) ->> 'id' as f1 \gset
select set_config('t.f1', :'f1', false);
reset role;
select pg_temp.assert((select proof_id is null and payment_id = :'pay1'::uuid and not member_visible and household_id = :h1 and deleted_at is null and uploaded_by = :tara
                                and storage_path = :c::text || '/staff/' || :'pay1' || '/check-1.jpg' and content_type = 'image/jpeg' and bytes = 150000
                         from app.payment_proof_files where id = :'f1'),
                      'A · a treasurer attaches a photo of the check: kept with the payment, no proof, never shown to the family, by whom');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'payment_proof_files' and record_id = :'f1') >= 1, 'A · attaching is written to the audit log');

select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', :c::text || '/staff/' || :'pay2' || '/x.jpg'), 'right place', 'A · the path must name this payment');
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', '00000000-0000-4000-8000-000000000999/staff/' || :'pay1' || '/x.jpg'), 'right place', 'A · ... and this community');
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', :c::text || '/' || :h1::text || '/' || :'pay1' || '/x.jpg'), 'right place', 'A · ... in the staff folder');
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/../x.jpg'), 'right place', 'A · a path that climbs out is refused');
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/a/b.jpg'), 'right place', 'A · one name, no sub-folders');
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'text/html', 100)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/x.html'), 'photo', 'A · only photos and PDFs');
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/png', 10485761)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/x.png'), '10 MB', 'A · at most 10 MB');
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/png', 0)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/x.png'), '10 MB', 'A · not empty');
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/png', 100, 'xyz')$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/x.png'), 'fingerprint', 'A · a malformed hash is refused');
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/check-1.jpg'), 'already attached', 'A · the same file twice');
select pg_temp.assert_raises($q$select app.attach_payment_evidence('00000000-0000-4000-8000-000000000998', 'x/staff/y/z.jpg', 'image/jpeg', 100)$q$, 'not found', 'A · a payment that does not exist');
-- five live staff files at most
select app.attach_payment_evidence(:'pay1'::uuid, :c::text || '/staff/' || :'pay1' || '/f' || n || '.jpg', 'image/jpeg', 1000 + n) from generate_series(2, 5) n;
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/f6.jpg'), 'up to 5', 'A · up to 5 files per payment');

-- who may
select pg_temp.as_user(:vol);
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/vol.jpg'), 'needs giving.record_offline', 'A · a finance volunteer cannot attach to a payment someone else recorded');
select (app.attach_payment_evidence(:'pay2'::uuid, :c::text || '/staff/' || :'pay2' || '/receipt.pdf', 'application/pdf', 5000)) ->> 'id' as f_vol \gset
select pg_temp.assert(:'f_vol' is not null, 'A · ... but can attach to a payment they recorded');
select pg_temp.as_user(:mina);
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/mina.jpg'), 'giving.record_offline', 'A · a family member cannot attach to their own payment');
select pg_temp.assert((select count(*) from app.payment_proof_files where payment_id = pg_temp.u('pay1')) = 0, 'A · and cannot see the staff files of their payment');
select pg_temp.as_user(:tara);
select pg_temp.assert((select count(*) from app.payment_proof_files where payment_id = pg_temp.u('pay1')) = 5, 'A · staff see them');
-- the module switch
reset role;
update app.center_module_grants set granted = false where center_id = :c and module_key = 'giving_proofs';
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($q$select app.attach_payment_evidence(%L, %L, 'image/jpeg', 100)$q$, :'pay1', :c::text || '/staff/' || :'pay1' || '/off.jpg'), 'Payment confirmations', 'A · with Payment confirmations off nothing can be attached');
reset role;
update app.center_module_grants set granted = true where center_id = :c and module_key = 'giving_proofs';

-- ═══ B. Taking a staff file back ═══════════════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:vol);
select pg_temp.assert_raises(format($q$select app.remove_payment_evidence_file(%L, 'Wrong check photo')$q$, :'f_vol'), 'giving.manage', 'B · removing needs giving.manage');
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($q$select app.remove_payment_evidence_file(%L, 'x')$q$, :'f1'), 'Say why', 'B · a reason is needed');
-- the family's own proof file is not removable here
select pg_temp.as_user(:mina);
select app.submit_payment_proof(:c, :h1, 'check', 5000, pg_temp.today(), '900', null, array[:pl3]::uuid[], 'open_pledges', null,
        jsonb_build_array(jsonb_build_object('path', :c::text || '/' || :h1::text || '/' || :pq3::text || '/a.jpg', 'content_type', 'image/jpeg', 'bytes', 900)), 'key-874-0003');
select pg_temp.as_user(:tara);
select id as famfile from app.payment_proof_files where proof_id = :pq3 limit 1 \gset
select pg_temp.assert_raises(format($q$select app.remove_payment_evidence_file(%L, 'Not needed any more')$q$, :'famfile'), 'staff attached', 'B · a family proof file cannot be removed here');
-- the legal hold stops it
reset role;
update app.centers set rules = coalesce(rules, '{}'::jsonb) || '{"payments":{"proofs":{"legal_hold":true}}}'::jsonb where id = :c;
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($q$select app.remove_payment_evidence_file(%L, 'Wrong check photo')$q$, :'f1'), 'legal hold', 'B · not while the legal hold is on');
reset role;
update app.centers set rules = rules #- '{payments,proofs,legal_hold}' where id = :c;
select pg_temp.as_user(:tara);
select (app.remove_payment_evidence_file(:'f1'::uuid, 'Photo of the wrong check')) ->> 'storage_path' as removed_path \gset
reset role;
select pg_temp.assert(:'removed_path' = :c::text || '/staff/' || :'pay1' || '/check-1.jpg', 'B · the caller gets the path to delete');
select pg_temp.assert((select deleted_at is not null and deleted_reason = 'Photo of the wrong check' from app.payment_proof_files where id = :'f1'), 'B · the row stays as a tombstone with the reason');
select pg_temp.assert((select count(*) from app.audit_log where record_table = 'payment_proof_files' and record_id = :'f1' and reason = 'Photo of the wrong check') >= 1, 'B · removing is audited with the reason');
select pg_temp.as_user(:tara);
select pg_temp.assert_raises(format($q$select app.remove_payment_evidence_file(%L, 'Photo of the wrong check')$q$, :'f1'), 'already removed', 'B · twice is refused');
select pg_temp.assert((select app.attach_payment_evidence(pg_temp.u('pay1'), pg_temp.u('c')::text || '/staff/' || pg_temp.u('pay1') || '/f6.jpg', 'image/jpeg', 100) is not null),
                      'B · a removed file no longer counts toward the 5');

-- ═══ C. The pledge timeline ════════════════════════════════════════════════════════════════════════════════════════════════
-- pl2: a proof, a question, a reply, approved with the bank line (so the pledge ends Bank reconciled)
select pg_temp.as_user(:mina);
select app.submit_payment_proof(:c, :h1, 'check', 20000, pg_temp.today(), '555', null, array[:pl2]::uuid[], 'open_pledges', null,
        jsonb_build_array(jsonb_build_object('path', :c::text || '/' || :h1::text || '/' || :pq2::text || '/a.jpg', 'content_type', 'image/jpeg', 'bytes', 900)), 'key-874-0002');
select pg_temp.assert(pg_temp.tl(pg_temp.u('pl2')) = 'pledged > proof:submitted', 'C · a pledge with a proof waiting: pledged, then the proof sent');
select pg_temp.as_user(:tara);
select app.ask_proof_question(:pq2, 'Which bank is the check from?');
select pg_temp.as_user(:mina);
select app.answer_proof_question(:pq2, 'Chase.', '[]'::jsonb);
reset role;
insert into app.bank_transactions (id, center_id, bank_account_id, posted_on, amount_cents, description, channel, fingerprint)
  values (:l1, :c, :acct, pg_temp.today(), 20000, 'CHECK 555 DEPOSITED', 'check', 'fp-874-1');
select pg_temp.as_user(:tara);
select app.approve_payment_proof(:pq2, null, null, null, 'looks right', null, null, :l1);
select pg_temp.assert(pg_temp.tl(pg_temp.u('pl2')) = 'pledged > proof:submitted > proof:question > proof:reply > proof:approved > payment > reconciled',
                      'C · pledged, sent, question, reply, approved, the payment, bank reconciled: in that order. Got ' || coalesce(pg_temp.tl(pg_temp.u('pl2')), 'null'));
select pg_temp.assert((select e ->> 'text' from jsonb_array_elements(app.pledge_timeline(pg_temp.u('pl2'))) e where e ->> 'event' = 'question') = 'The treasury team asks: Which bank is the check from?'
                      and (select (e ->> 'amount_cents')::bigint from jsonb_array_elements(app.pledge_timeline(pg_temp.u('pl2'))) e where e ->> 'kind' = 'payment') = 20000
                      and (select e ->> 'receipt_number' is not null from jsonb_array_elements(app.pledge_timeline(pg_temp.u('pl2'))) e where e ->> 'kind' = 'payment')
                      and (select e ->> 'reconciled_kind' from jsonb_array_elements(app.pledge_timeline(pg_temp.u('pl2'))) e where e ->> 'kind' = 'reconciled') = 'bank',
                      'C · the entries carry the family''s words, the amount, the receipt and how it was reconciled');
-- the family's adults read it; another family does not
select pg_temp.as_user(:mina);
select pg_temp.assert(pg_temp.tl(pg_temp.u('pl2')) like 'pledged > proof:submitted%', 'C · the household''s adults read the timeline');
select pg_temp.as_user(:zed);
select pg_temp.assert_raises(format($q$select app.pledge_timeline(%L)$q$, :pl2), 'access', 'C · another family gets "You don''t have access to this area"');
select pg_temp.assert_raises($q$select app.pledge_timeline('00000000-0000-4000-8000-000000000997')$q$, 'not found', 'C · a pledge that does not exist');
-- taken back, and not accepted
select pg_temp.as_user(:tara);
select pg_temp.assert(pg_temp.tl(pg_temp.u('pl3')) = 'pledged > proof:submitted', 'C · pl3 waits');
select pg_temp.as_user(:mina);
select app.withdraw_payment_proof(:pq3);
select pg_temp.assert(pg_temp.tl(pg_temp.u('pl3')) = 'pledged > proof:submitted > proof:withdrawn', 'C · a proof taken back is on the timeline');
select app.submit_payment_proof(:c, :h1, 'check', 7000, pg_temp.today(), '556', null, array[:pl4]::uuid[], 'open_pledges', null,
        jsonb_build_array(jsonb_build_object('path', :c::text || '/' || :h1::text || '/' || :pq4::text || '/a.jpg', 'content_type', 'image/jpeg', 'bytes', 900)), 'key-874-0004');
select pg_temp.as_user(:tara);
select app.reject_payment_proof(:pq4, 'The photo is of a different check.');
select pg_temp.assert(pg_temp.tl(pg_temp.u('pl4')) = 'pledged > proof:submitted > proof:rejected', 'C · a proof not accepted is on the timeline');
-- only the listed events; a cancelled-pledge note is one of them; a pledge with nothing else shows just that it was made
reset role;
insert into app.payment_proof_events (center_id, proof_id, kind, body) values
  (:c, :pq4, 'first_approved', 'First approval given.'), (:c, :pq4, 'pledge_cancelled', 'The registration was cancelled.');
select pg_temp.as_user(:tara);
select pg_temp.assert(pg_temp.tl(pg_temp.u('pl4')) like '%proof:rejected%proof:pledge_cancelled' and pg_temp.tl(pg_temp.u('pl4')) not like '%first_approved%',
                      'C · the listed events only: pledge_cancelled shows, first_approved does not. Got ' || pg_temp.tl(pg_temp.u('pl4')));
select pg_temp.assert(pg_temp.tl(pg_temp.u('pl1')) = 'pledged > payment > payment', 'C · the two checks the office recorded sit on the oldest open pledge: pledged, payment, payment. Got ' || pg_temp.tl(pg_temp.u('pl1')));reset role;insert into app.pledges (id, center_id, household_id, source, amount_cents, pledged_at, dedication) values ('87400000-0000-4000-8000-0000000001a5', :c, :h1, 'general', 1000, now() - interval '1 day', 'Nothing yet');select pg_temp.as_user(:tara);select pg_temp.assert(pg_temp.tl('87400000-0000-4000-8000-0000000001a5') = 'pledged', 'C · a pledge nothing happened to shows only that it was made');

-- ═══ D. Uploads nobody keeps ═══════════════════════════════════════════════════════════════════════════════════════════════
reset role;
select pg_temp.u('c')::text || '/' || :h1::text || '/' as pre \gset
insert into storage.objects (bucket_id, name, created_at) values
  ('payment-evidence', :'pre' || '87400000-0000-4000-8000-000000000e01/orphan-old.jpg', now() - interval '5 days'),
  ('payment-evidence', :'pre' || '87400000-0000-4000-8000-000000000e02/orphan-older.jpg', now() - interval '9 days'),
  ('payment-evidence', :'pre' || '87400000-0000-4000-8000-000000000e03/orphan-recent.jpg', now() - interval '3 hours'),
  ('payment-evidence', :'pre' || '87400000-0000-4000-8000-000000000e04/orphan-just-over.jpg', now() - interval '49 hours'),
  ('payment-evidence', :c::text || '/staff/' || :'pay1' || '/f2.jpg', now() - interval '5 days'),                       -- a live staff file: kept
  ('payment-evidence', :c::text || '/staff/' || :'pay1' || '/check-1.jpg', now() - interval '5 days'),                  -- removed by staff, bytes left: an orphan
  ('payment-evidence', :c::text || '/' || :h1::text || '/' || :pq2::text || '/a.jpg', now() - interval '5 days'),       -- a proof's file: kept
  ('content', :'pre' || 'not-ours-old.jpg', now() - interval '5 days');                                                  -- another bucket: never listed
select pg_temp.as_user(:tara);
select pg_temp.assert_raises($q$select * from app.proof_orphan_objects(10)$q$, 'permission denied', 'D · signed-in staff cannot list the orphans');
reset role;
select pg_temp.assert_raises($q$select * from app.proof_orphan_objects(10)$q$, 'background service', 'D · neither can the plain database owner');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.proof_orphan_objects(int)', 'execute') and not has_function_privilege('service_role', 'app.proof_orphan_objects(int)', 'execute')
                      and has_function_privilege('connect_worker', 'app.proof_orphan_objects(int)', 'execute'), 'D · only the background service may call it');
set local role connect_worker;
select string_agg(right(o.name, 22), ' | ' order by o.name) as orphans from app.proof_orphan_objects(1000) o where o.name like '00000000-0000-4000-8000-000000087401/%' \gset
select o.name as first_one from app.proof_orphan_objects(1) o where o.name like '00000000-0000-4000-8000-000000087401/%' limit 1 \gset
select count(*) as capped from app.proof_orphan_objects(2) \gset
reset role;
select pg_temp.assert(position('orphan-old.jpg' in :'orphans') > 0 and position('orphan-older.jpg' in :'orphans') > 0 and position('orphan-just-over.jpg' in :'orphans') > 0,
                      'D · uploads older than 48 hours that no proof keeps are listed');
select pg_temp.assert(position('orphan-recent' in :'orphans') = 0, 'D · a fresh upload (the family is still sending the proof) is left alone');
select pg_temp.assert(position('check-1.jpg' in :'orphans') > 0, 'D · bytes of a file staff removed are listed too');
select pg_temp.assert(position('f2.jpg' in :'orphans') = 0 and position('/a.jpg' in :'orphans') = 0, 'D · a file a payment or a proof keeps is never listed');
select pg_temp.assert(position('not-ours' in :'orphans') = 0, 'D · only the payment-evidence bucket');
select pg_temp.assert(:'capped'::int = 2, 'D · the limit is honoured');
select pg_temp.assert(:'first_one' like '%orphan-older.jpg', 'D · the oldest first. Got ' || :'first_one');
rollback;
