-- 0782 (NEEDS OWNER OK): edit and delete a pledge.
--   A. app.edit_pledge: amount up and down, one audit entry with the reason, before and after; the status follows the amount
--   B. The amount never goes below what is paid; exactly what is paid closes the pledge; a paid pledge keeps its amount
--   C. The due date: the same rules as app.set_pledge_due_on, in the same sheet
--   D. What it is for: a campaign brings its fund, a fund alone, general; archived, own-screen, other-community and retired choices are
--      refused; money applied or an opportunity locks it
--   E. Details: dedication, recognition name, anonymous, who pledged (an adult of the household, never a child); allowed on a paid pledge
--   F. Locks: a pledge from another screen, in QuickBooks, with a write-off waiting, or closed
--   G. Who: giving.manage only, in the pledge's own community, Giving on, a reason; an unchanged form changes nothing and leaves no entry
--   H. app.delete_pledge: the pledge is Cancelled with the reason in History; what must not go is refused with a sentence; an opportunity is freed
--   I. app.pledge_edit_state: what the sheet reads
--   J. Grants and the activity catalog
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
  perform set_config('request.headers', '{"x-client-app":"portal","x-client-screen":"/households"}', true);
end $$;
create or replace function pg_temp.ed(p_user uuid, p_center uuid, p_pledge uuid, p_changes jsonb, p_reason text default 'Family asked to change it')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.edit_pledge(p_center, p_pledge, p_changes, p_reason);
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;
create or replace function pg_temp.del(p_user uuid, p_center uuid, p_pledge uuid, p_reason text default 'Recorded twice by mistake')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.delete_pledge(p_center, p_pledge, p_reason);
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;
create or replace function pg_temp.st(p_user uuid, p_center uuid, p_pledge uuid)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.claims(p_user);
  set local role authenticated;
  r := app.pledge_edit_state(p_center, p_pledge);
  reset role;
  return r;
exception when others then
  reset role;
  raise;
end $$;

\set c '''18200000-0000-4000-8000-0000000000c1'''
\set d '''18200000-0000-4000-8000-0000000000d1'''
\set tara '''18200000-0000-4000-8000-0000000000a1'''
\set vina '''18200000-0000-4000-8000-0000000000a2'''
\set zed '''18200000-0000-4000-8000-0000000000a5'''
\set h1 '''18200000-0000-4000-8000-000000000201'''
\set h3 '''18200000-0000-4000-8000-000000000203'''
\set rahul '''18200000-0000-4000-8000-000000000101'''
\set mirap '''18200000-0000-4000-8000-000000000102'''
\set kid '''18200000-0000-4000-8000-000000000103'''
\set outsider '''18200000-0000-4000-8000-000000000104'''
\set f1 '''18200000-0000-4000-8000-000000000401'''
\set f2 '''18200000-0000-4000-8000-000000000402'''
\set f3 '''18200000-0000-4000-8000-000000000403'''
\set fd '''18200000-0000-4000-8000-000000000404'''
\set camp '''18200000-0000-4000-8000-000000000501'''
\set auct '''18200000-0000-4000-8000-000000000502'''
\set arch '''18200000-0000-4000-8000-000000000503'''
\set campd '''18200000-0000-4000-8000-000000000504'''
\set camp2 '''18200000-0000-4000-8000-000000000505'''
\set opp '''18200000-0000-4000-8000-000000000601'''
\set p1 '''18200000-0000-4000-8000-000000000301'''
\set p2 '''18200000-0000-4000-8000-000000000302'''
\set p3 '''18200000-0000-4000-8000-000000000303'''
\set p4 '''18200000-0000-4000-8000-000000000304'''
\set p5 '''18200000-0000-4000-8000-000000000305'''
\set p6 '''18200000-0000-4000-8000-000000000306'''
\set p7 '''18200000-0000-4000-8000-000000000307'''
\set p8 '''18200000-0000-4000-8000-000000000308'''
\set p9 '''18200000-0000-4000-8000-000000000309'''
\set p10 '''18200000-0000-4000-8000-00000000030a'''
\set p11 '''18200000-0000-4000-8000-00000000030b'''

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into app.centers (id, slug, name, short_name, time_zone) values
  (:c, 'g182-temple', 'G182 Temple', 'G182', 'America/Chicago'),
  (:d, 'g182-other', 'G182 Other Temple', 'G182B', 'America/Chicago');
insert into auth.users (id, email) values (:tara, 'tara@g182.test'), (:vina, 'vina@g182.test'), (:zed, 'zed@g182.test');
insert into app.people (id, center_id, first_name, last_name, email, date_of_birth) values
  (:rahul, :c, 'Rahul', 'Shah', null, '1980-04-02'),
  (:mirap, :c, 'Mira', 'Shah', null, '1982-06-11'),
  (:kid, :c, 'Kavi', 'Shah', null, (now() - interval '10 years')::date),
  (:outsider, :c, 'Omar', 'Outsider', null, '1975-01-01');
insert into app.households (id, center_id, display_name) values (:h1, :c, 'Shah family'), (:h3, :d, 'Other family');
insert into app.household_members (household_id, person_id, center_id, role, is_primary, left_at) values
  (:h1, :rahul, :c, 'primary', true, null),
  (:h1, :mirap, :c, 'spouse', false, null),
  (:h1, :kid, :c, 'child', false, null);
insert into app.role_grants (center_id, user_id, role_key) values
  (:c, :tara, 'treasurer'), (:c, :vina, 'finance_volunteer'), (:d, :zed, 'treasurer');
insert into app.funds (id, center_id, key, name, active) values
  (:f1, :c, 'building', 'Building fund', true), (:f2, :c, 'general', 'General fund', true), (:f3, :c, 'old', 'Old fund', false),
  (:fd, :d, 'building', 'Other building fund', true);
insert into app.campaigns (id, center_id, fund_id, name, kind, status) values
  (:camp, :c, :f1, 'New hall', 'construction', 'published'),
  (:auct, :c, null, 'Festival auction', 'boli', 'published'),
  (:arch, :c, null, 'Old appeal', 'general', 'archived'),
  (:campd, :d, null, 'Other appeal', 'general', 'published'),
  (:camp2, :c, null, 'Spring appeal', 'general', 'published');
insert into app.opportunities (id, center_id, campaign_id, name, amount_cents, quantity_available, status)
  values (:opp, :c, :camp, 'Name a classroom', 250000, 1, 'open');
select (now() at time zone 'America/Chicago')::date as today \gset

insert into app.pledges (id, center_id, household_id, source, amount_cents) values
  (:p1, :c, :h1, 'general', 50000),                                                       -- plain, editable
  (:p8, :c, :h1, 'general', 9000),                                                        -- to delete
  (:p9, :d, :h3, 'general', 15000);                                                       -- another community's
insert into app.pledges (id, center_id, household_id, source, amount_cents, paid_cents, status) values
  (:p2, :c, :h1, 'general', 20000, 8000, 'partially_paid'),                               -- part paid
  (:p10, :c, :h1, 'general', 30000, 5000, 'partially_paid');                              -- part paid, to try deleting
insert into app.pledges (id, center_id, household_id, source, amount_cents) values
  (:p3, :c, :h1, 'rsvp_commitment', 10000);                                               -- belongs to an event registration
insert into app.pledges (id, center_id, household_id, source, amount_cents, crm_external_id) values
  (:p4, :c, :h1, 'general', 30000, 'qbo:Invoice:1043');                                   -- brought in from a QuickBooks invoice
insert into app.pledges (id, center_id, household_id, source, amount_cents, written_off_by, write_off_reason) values
  (:p5, :c, :h1, 'general', 4000, :tara, 'Moved away');                                   -- a write-off waits for its second person
insert into app.pledges (id, center_id, household_id, source, amount_cents, paid_cents, status, closed_at) values
  (:p6, :c, :h1, 'general', 6000, 6000, 'paid', now());                                   -- paid
insert into app.pledges (id, center_id, household_id, source, amount_cents, opportunity_id) values
  (:p7, :c, :h1, 'general', 250000, :opp);                                                -- part of an opportunity
insert into app.pledges (id, center_id, household_id, source, amount_cents, written_off_by, written_off_second_approver, write_off_reason, status, closed_at)
  values (:p11, :c, :h1, 'general', 7000, :tara, :vina, 'Hardship', 'written_off', now());

-- ═══════════════════════════════════════════════════════════════════════════
-- A. The amount, up and down
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.ed(:tara, :c, :p1, '{"amount_cents": 75000}')::text as a1 \gset
select pg_temp.assert(((:'a1'::jsonb)->>'changed')::boolean and (:'a1'::jsonb)->'fields' = '["amount"]'::jsonb
                      and ((:'a1'::jsonb)->>'amount_cents')::bigint = 75000 and ((:'a1'::jsonb)->>'was_amount_cents')::bigint = 50000
                      and (select amount_cents = 75000 and status = 'open' from app.pledges where id = :p1),
  'A: a treasurer raises a pledge; the answer says what it was and what it is');
select pg_temp.assert((select count(*) = 1 and bool_and(reason = 'Family asked to change it'
                                                       and (before->>'amount_cents')::bigint = 50000 and (after->>'amount_cents')::bigint = 75000)
                         from app.audit_log where record_table = 'pledges' and record_id = :p1 and action = 'pledges.update'),
  'A: one History entry, with the reason, the old amount and the new one');
select pg_temp.ed(:tara, :c, :p1, '{"amount_cents": 40000}', 'Entered wrongly')::text as a2 \gset
select pg_temp.assert(((:'a2'::jsonb)->>'changed')::boolean and (select amount_cents = 40000 from app.pledges where id = :p1),
  'A: and lowers it again (giving.manage, up or down, no second person)');
select pg_temp.assert((select count(*) = 2 from app.audit_log where record_table = 'pledges' and record_id = :p1 and action = 'pledges.update'),
  'A: each change is its own History entry');

-- ═══════════════════════════════════════════════════════════════════════════
-- B. Never below what is paid
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p2, '{"amount_cents": 5000}'),
  'already paid', 'B: an amount below what is paid is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, '{"amount_cents": 0}'),
  'greater than zero', 'B: zero is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, '{"amount_cents": "lots"}'),
  'greater than zero', 'B: not a number is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, '{"amount_cents": 999999999999999}'),
  'greater than zero', 'B: an absurd amount is refused');
select pg_temp.ed(:tara, :c, :p2, '{"amount_cents": 8000}')::text as b1 \gset
select pg_temp.assert((:'b1'::jsonb)->>'status' = 'paid'
                      and (select status = 'paid' and closed_at is not null and amount_cents = 8000 from app.pledges where id = :p2),
  'B: an amount equal to what is paid closes the pledge as paid');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p2, '{"amount_cents": 12000}'),
  'is paid, so it stays', 'B: a paid pledge keeps its amount');
-- Raising a part-paid pledge keeps it part paid.
select pg_temp.ed(:tara, :c, :p10, '{"amount_cents": 45000}')::text as b2 \gset
select pg_temp.assert((:'b2'::jsonb)->>'status' = 'partially_paid' and (select status = 'partially_paid' and closed_at is null from app.pledges where id = :p10),
  'B: raising a part-paid pledge keeps it part paid and open');

-- ═══════════════════════════════════════════════════════════════════════════
-- C. The due date
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.ed(:tara, :c, :p1, jsonb_build_object('due_on', (:'today'::date + 90)))::text as c1 \gset
select pg_temp.assert(((:'c1'::jsonb)->>'changed')::boolean and (select due_on = :'today'::date + 90 from app.pledges where id = :p1),
  'C: the due date changes in the same sheet');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, jsonb_build_object('due_on', (:'today'::date - 4000))::text),
  'ten years', 'C: more than ten years away is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, jsonb_build_object('due_on', (:'today'::date - 1))::text),
  'before the day it was pledged', 'C: a due date before the day it was pledged is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, '{"due_on": "2026-13-45"}'),
  'as a date', 'C: not a date is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, '{"due_on": null}'),
  'choose the due date', 'C: a due date cannot be emptied');

-- ═══════════════════════════════════════════════════════════════════════════
-- D. What it is for
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.ed(:tara, :c, :p1, format('{"campaign_id": "%s", "fund_id": null}', :camp)::jsonb)::text as d1 \gset
select pg_temp.assert((select campaign_id = :camp::uuid and fund_id = :f1::uuid from app.pledges where id = :p1)
                      and (:'d1'::jsonb)->'fields' = '["what it is for"]'::jsonb,
  'D: a campaign brings its own fund');
select pg_temp.ed(:tara, :c, :p1, format('{"campaign_id": null, "fund_id": "%s"}', :f2)::jsonb)::text as d2 \gset
select pg_temp.assert((select campaign_id is null and fund_id = :f2::uuid from app.pledges where id = :p1), 'D: a fund alone');
select pg_temp.ed(:tara, :c, :p1, format('{"campaign_id": "%s", "fund_id": null}', :camp2)::jsonb)::text as d3 \gset
select pg_temp.assert((select campaign_id = :camp2::uuid and fund_id is null from app.pledges where id = :p1),
  'D: a campaign with no fund of its own leaves the fund empty when the sheet sends it empty');
select pg_temp.ed(:tara, :c, :p1, '{"campaign_id": null, "fund_id": null}')::text as d4 \gset
select pg_temp.assert((select campaign_id is null and fund_id is null from app.pledges where id = :p1), 'D: back to a general pledge');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, format('{"campaign_id": "%s"}', :arch)),
  'archived', 'D: an archived campaign is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, format('{"campaign_id": "%s"}', :auct)),
  'own screen', 'D: a campaign that takes its pledges from its own screen is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, format('{"campaign_id": "%s"}', :campd)),
  'not found in this community', 'D: another community''s campaign is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, format('{"campaign_id": null, "fund_id": "%s"}', :fd)),
  'not found in this community', 'D: another community''s fund is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, format('{"campaign_id": null, "fund_id": "%s"}', :f3)),
  'no longer in use', 'D: a retired fund is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, format('{"campaign_id": "%s", "fund_id": "%s"}', :camp, :f2)),
  'own fund', 'D: a campaign and a different fund together are refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p10, format('{"campaign_id": null, "fund_id": "%s"}', :f2)),
  'already applied', 'D: money already applied locks what the pledge is for');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p7, format('{"campaign_id": null, "fund_id": "%s"}', :f2)),
  'part of an opportunity', 'D: a pledge that is part of an opportunity keeps what it is for');

-- ═══════════════════════════════════════════════════════════════════════════
-- E. Details
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.ed(:tara, :c, :p1, format('{"dedication": "In memory of Ba", "recognition_name": "The Shah family", "anonymous": true, "pledged_by_person_id": "%s"}', :rahul)::jsonb)::text as e1 \gset
select pg_temp.assert((select dedication = 'In memory of Ba' and recognition_name = 'The Shah family' and anonymous and pledged_by_person_id = :rahul::uuid
                         from app.pledges where id = :p1)
                      and (:'e1'::jsonb)->'fields' = '["dedication", "recognition name", "anonymous", "who pledged"]'::jsonb,
  'E: dedication, recognition name, anonymous and who pledged change together, in one entry');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, format('{"pledged_by_person_id": "%s"}', :kid)),
  'adult of this household', 'E: a child is never the one who pledged');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, format('{"pledged_by_person_id": "%s"}', :outsider)),
  'adult of this household', 'E: someone outside the household is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, jsonb_build_object('dedication', repeat('x', 201))::text),
  '200 characters', 'E: a dedication over 200 characters is refused');
select pg_temp.ed(:tara, :c, :p1, '{"dedication": " ", "recognition_name": null, "anonymous": false, "pledged_by_person_id": null}')::text as e2 \gset
select pg_temp.assert((select dedication is null and recognition_name is null and not anonymous and pledged_by_person_id is null from app.pledges where id = :p1),
  'E: empty values clear them; no one named means the household');
select pg_temp.ed(:tara, :c, :p6, '{"dedication": "Thank you"}')::text as e3 \gset
select pg_temp.assert((select dedication = 'Thank you' from app.pledges where id = :p6), 'E: a paid pledge''s dedication can still be corrected');
select pg_temp.ed(:tara, :c, :p11, '{"recognition_name": "A friend"}')::text as e4 \gset
select pg_temp.assert((select recognition_name = 'A friend' from app.pledges where id = :p11), 'E: so can a written-off pledge''s recognition name');

-- ═══════════════════════════════════════════════════════════════════════════
-- F. Locks
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p3, '{"amount_cents": 12000}'),
  'comes from an event registration', 'F: a pledge from an event registration keeps its amount (change it there)');
select pg_temp.ed(:tara, :c, :p3, jsonb_build_object('due_on', (:'today'::date + 45)))::text as f1 \gset
select pg_temp.assert(((:'f1'::jsonb)->>'changed')::boolean, 'F: but its due date can change');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p4, '{"amount_cents": 31000}'),
  'in quickbooks', 'F: a pledge brought in from a QuickBooks invoice keeps its amount until the books change');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p4, format('{"campaign_id": "%s"}', :camp2)),
  'in quickbooks', 'F: and what it is for');
select pg_temp.ed(:tara, :c, :p4, '{"dedication": "Annual gift"}')::text as f2 \gset
select pg_temp.assert(((:'f2'::jsonb)->>'changed')::boolean, 'F: its dedication can change');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p5, '{"amount_cents": 5000}'),
  'waiting for approval', 'F: a pledge with a write-off waiting keeps its amount');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p5, jsonb_build_object('due_on', (:'today'::date + 45))::text),
  'waiting for approval', 'F: and its due date');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p11, '{"amount_cents": 8000}'),
  'written off', 'F: a written-off pledge keeps its amount');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p6, jsonb_build_object('due_on', (:'today'::date + 45))::text),
  'is paid', 'F: a paid pledge keeps its due date');

-- ═══════════════════════════════════════════════════════════════════════════
-- G. Who, and a reason
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :vina, :c, :p1, '{"amount_cents": 41000}'),
  'giving.manage', 'G: a finance volunteer cannot edit a pledge');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :zed, :d, :p1, '{"amount_cents": 41000}'),
  'different community', 'G: another community''s treasurer cannot edit it');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :d, :p1, '{"amount_cents": 41000}'),
  'different community', 'G: nor can a treasurer working in another community''s name');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p9, '{"amount_cents": 41000}'),
  'different community', 'G: and a treasurer cannot edit another community''s pledge');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L, %L)$$, :tara, :c, :p1, '{"amount_cents": 41000}', ' '),
  'say why', 'G: a reason is required');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, '{"surprise": 1}'),
  'not understood', 'G: a key the database does not know is refused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, '{}'),
  'at least one thing', 'G: nothing to change is refused');
select count(*) as before_noop from app.audit_log where record_table = 'pledges' and record_id = :p1 \gset
select pg_temp.ed(:tara, :c, :p1, '{"amount_cents": 40000}', ' ')::text as g1 \gset
select pg_temp.assert(not ((:'g1'::jsonb)->>'changed')::boolean
                      and (select count(*) = :before_noop from app.audit_log where record_table = 'pledges' and record_id = :p1),
  'G: the same values again change nothing, need no reason, and leave no History entry');
savepoint giving_off;
insert into app.center_modules (center_id, module_key, enabled, reason) values (:c, 'giving', false, 'Test 182: giving paused');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p1, '{"amount_cents": 41000}'),
  'switched off', 'G: with Giving switched off nothing changes');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :tara, :c, :p8),
  'switched off', 'G: nor is anything deleted');
rollback to savepoint giving_off;

-- ═══════════════════════════════════════════════════════════════════════════
-- H. Delete (cancel)
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.del(:tara, :c, :p8)::text as h1 \gset
select pg_temp.assert((:'h1'::jsonb)->>'status' = 'cancelled'
                      and (select status = 'cancelled' and closed_at is not null and amount_cents = 9000 from app.pledges where id = :p8),
  'H: a treasurer deletes an open pledge: it is Cancelled, and nothing is erased');
select pg_temp.assert((select count(*) = 1 and bool_and(reason = 'Recorded twice by mistake' and (after->>'status') = 'cancelled' and (before->>'status') = 'open')
                         from app.audit_log where record_table = 'pledges' and record_id = :p8 and action = 'pledges.update'),
  'H: the family''s History has the reason, what it was and what it is');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :tara, :c, :p8), 'was deleted', 'H: deleting it again says it is already deleted');
select pg_temp.assert_raises(format($$select pg_temp.ed(%L, %L, %L, %L)$$, :tara, :c, :p8, '{"dedication": "x"}'),
  'was deleted', 'H: a deleted pledge cannot be edited, not even its details');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :tara, :c, :p10), 'already applied', 'H: a pledge with money applied is not deleted');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :tara, :c, :p4), 'in quickbooks', 'H: a pledge in QuickBooks is not deleted here alone');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :tara, :c, :p3), 'comes from an event registration', 'H: a pledge from an event registration is cancelled there');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :tara, :c, :p5), 'waiting for approval', 'H: a pledge with a write-off waiting stays until it is withdrawn');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :tara, :c, :p6), 'is paid', 'H: a paid pledge stays on record');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :tara, :c, :p11), 'written off', 'H: so does a written-off one');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L, %L)$$, :tara, :c, :p1, ' '), 'say why', 'H: a reason is required');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :vina, :c, :p1), 'giving.manage', 'H: a finance volunteer cannot delete');
select pg_temp.assert_raises(format($$select pg_temp.del(%L, %L, %L)$$, :zed, :d, :p1), 'different community', 'H: another community''s treasurer cannot delete it');
select pg_temp.assert((select quantity_taken = 1 and status = 'taken' from app.opportunities where id = :opp), 'H: the opportunity is taken by the pledge on it');
select pg_temp.del(:tara, :c, :p7, 'Entered for the wrong family')::text as h2 \gset
select pg_temp.assert((select quantity_taken = 0 and status = 'open' from app.opportunities where id = :opp),
  'H: deleting a pledge on an opportunity frees it');

-- ═══════════════════════════════════════════════════════════════════════════
-- I. What the sheet reads
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.st(:tara, :c, :p1)::text as i1 \gset
select pg_temp.assert((:'i1'::jsonb)->'locks' = '{"details": null, "due": null, "amount": null, "for": null, "delete": null, "qbo": null, "own": true}'::jsonb
                      and ((:'i1'::jsonb)->>'amount_cents')::bigint = 40000 and (:'i1'::jsonb)->>'pledged_on' = :'today',
  'I: a plain open pledge has nothing locked, and the day it was pledged');
select pg_temp.st(:tara, :c, :p4)::text as i2 \gset
select pg_temp.assert((:'i2'::jsonb)#>>'{locks,qbo}' = 'QuickBooks Invoice #1043' and (:'i2'::jsonb)#>>'{locks,amount}' like '%QuickBooks%'
                      and (:'i2'::jsonb)#>>'{locks,delete}' like '%QuickBooks%' and (:'i2'::jsonb)#>>'{locks,due}' is null,
  'I: a QuickBooks pledge says where, and locks amount and delete but not the due date');
select pg_temp.st(:tara, :c, :p6)::text as i3 \gset
select pg_temp.assert((:'i3'::jsonb)#>>'{locks,details}' is null and (:'i3'::jsonb)#>>'{locks,due}' like '%paid%' and (:'i3'::jsonb)#>>'{locks,delete}' like '%paid%',
  'I: a paid pledge locks everything but its details');
select pg_temp.st(:tara, :c, :p8)::text as i4 \gset
select pg_temp.assert((:'i4'::jsonb)#>>'{locks,details}' like '%deleted%', 'I: a deleted pledge locks even its details');
select pg_temp.assert_raises(format($$select pg_temp.st(%L, %L, %L)$$, :vina, :c, :p1), 'giving.manage', 'I: a finance volunteer cannot open the sheet''s data');
select pg_temp.assert_raises(format($$select pg_temp.st(%L, %L, %L)$$, :zed, :d, :p1), 'different community', 'I: nor can another community''s treasurer');

-- ═══════════════════════════════════════════════════════════════════════════
-- J. Grants and the activity catalog
-- ═══════════════════════════════════════════════════════════════════════════
select pg_temp.assert(has_function_privilege('authenticated', 'app.edit_pledge(uuid, uuid, jsonb, text)', 'execute')
                      and not has_function_privilege('anon', 'app.edit_pledge(uuid, uuid, jsonb, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.delete_pledge(uuid, uuid, text)', 'execute')
                      and not has_function_privilege('anon', 'app.delete_pledge(uuid, uuid, text)', 'execute')
                      and has_function_privilege('authenticated', 'app.pledge_edit_state(uuid, uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.pledge_edit_state(uuid, uuid)', 'execute'),
  'J: signed-in people run edit, delete and the sheet''s read; anonymous visitors do not');
select pg_temp.assert(not has_function_privilege('authenticated', 'app._pledge_locks(app.pledges)', 'execute')
                      and not has_function_privilege('anon', 'app._pledge_locks(app.pledges)', 'execute'),
  'J: the rules of what is locked run only inside the database');
select pg_temp.assert((select count(*) = 2 from app.activity_catalog where key in ('giving.edit_pledge', 'giving.delete_pledge')),
  'J: Edit pledge and Delete pledge are in the activity catalog');

rollback;
