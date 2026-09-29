-- 0525/0526: recurring_gifts.opportunity_id, an opportunity's recurring eligibility + confirmation
-- template, app.run_recurring_gift_cycle, and active/visible_from/visible_until on campaigns and
-- opportunities.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create or replace function pg_temp.sign_out() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email, phone) values
  ('42000000-0000-4000-8000-000000000001', 'admin42@example.com', null),
  ('42000000-0000-4000-8000-000000000002', 'asha42@example.com', null);
insert into app.centers (id, slug, name, short_name, state_region, status) values
  ('42000000-0000-4000-8000-0000000000c1', 'orbit42', 'Orbit Test Community', 'OTC', 'TX', 'active');
insert into app.role_grants (center_id, user_id, role_key) values
  ('42000000-0000-4000-8000-0000000000c1', '42000000-0000-4000-8000-000000000001', 'center_admin');
insert into app.households (id, center_id, display_name) values
  ('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000c1', 'Shah household');
insert into app.people (id, center_id, first_name, last_name, email) values
  ('42000000-0000-4000-8000-0000000000a2', '42000000-0000-4000-8000-0000000000c1', 'Asha', 'Shah', 'asha42@example.com');
insert into app.household_members (household_id, person_id, center_id, role, is_primary) values
  ('42000000-0000-4000-8000-0000000000a1', '42000000-0000-4000-8000-0000000000a2', '42000000-0000-4000-8000-0000000000c1', 'primary', true);
insert into app.center_users (center_id, user_id, person_id) values
  ('42000000-0000-4000-8000-0000000000c1', '42000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-0000000000a2');
insert into app.funds (id, center_id, key, name) values
  ('42000000-0000-4000-8000-0000000000f1', '42000000-0000-4000-8000-0000000000c1', 'general', 'General fund');
insert into app.campaigns (id, center_id, fund_id, name, kind, status) values
  ('42000000-0000-4000-8000-00000000c2c2', '42000000-0000-4000-8000-0000000000c1', '42000000-0000-4000-8000-0000000000f1', 'Annual appeal', 'general', 'published');
insert into app.opportunities (id, center_id, campaign_id, name, status) values
  ('42000000-0000-4000-8000-00000000e1e1', '42000000-0000-4000-8000-0000000000c1', '42000000-0000-4000-8000-00000000c2c2', 'Monthly seva', 'open');
insert into app.message_templates (center_id, key, channel, language, subject, body) values
  (null, 'opp_recurring_confirm', 'email', 'en', 'Thank you for your {{frequency}} gift',
   'Your {{amount}} gift to {{opportunity_name}} is confirmed. Next gift: {{next_date}}.');

-- ── An opportunity cannot be made recurring without allow_recurring ─────────
begin;
select pg_temp.sign_in('42000000-0000-4000-8000-000000000002');
select pg_temp.assert_raises(
  $$select app.create_recurring_gift('42000000-0000-4000-8000-0000000000a1', null, null, 2100, 'monthly', current_date + 1, 'until_stopped', null, null, null, '42000000-0000-4000-8000-00000000e1e1')$$,
  'cannot be made recurring', 'an opportunity with allow_recurring=false refuses a recurring gift');
commit;

-- ── The DB-level guard: allow_recurring needs both a frequency and a template ──
select pg_temp.assert_raises(
  $$update app.opportunities set allow_recurring = true where id = '42000000-0000-4000-8000-00000000e1e1'$$,
  'violates check constraint', 'allow_recurring cannot be turned on with no frequencies and no template');

select pg_temp.assert_raises(
  $$update app.opportunities set allow_recurring = true, recurring_frequencies = array['monthly'], notification_template_key = 'no_such_template' where id = '42000000-0000-4000-8000-00000000e1e1'$$,
  'template that exists', 'allow_recurring is refused when the chosen template does not exist');

update app.opportunities set allow_recurring = true, recurring_frequencies = array['monthly'], notification_template_key = 'opp_recurring_confirm'
 where id = '42000000-0000-4000-8000-00000000e1e1';
select pg_temp.assert((select allow_recurring from app.opportunities where id = '42000000-0000-4000-8000-00000000e1e1') = true,
  'a real frequency and an existing template turn allow_recurring on');

-- ── create_recurring_gift: the chosen frequency must be one the opportunity offers ──
begin;
select pg_temp.sign_in('42000000-0000-4000-8000-000000000002');
select pg_temp.assert_raises(
  $$select app.create_recurring_gift('42000000-0000-4000-8000-0000000000a1', null, null, 2100, 'weekly', current_date + 1, 'until_stopped', null, null, null, '42000000-0000-4000-8000-00000000e1e1')$$,
  'not offered', 'a frequency the opportunity does not offer is refused');

select app.create_recurring_gift('42000000-0000-4000-8000-0000000000a1', null, null, 2100, 'monthly', current_date + 1, 'until_stopped', null, null, null, '42000000-0000-4000-8000-00000000e1e1') as gift1 \gset
commit;
select pg_temp.assert((select opportunity_id from app.recurring_gifts where id = :'gift1'::uuid) = '42000000-0000-4000-8000-00000000e1e1'::uuid,
  'the new recurring gift links back to the opportunity');
select pg_temp.assert((select campaign_id from app.recurring_gifts where id = :'gift1'::uuid) = '42000000-0000-4000-8000-00000000c2c2'::uuid,
  'the campaign is derived from the opportunity');

-- ── run_recurring_gift_cycle: worker-only (granted to connect_worker, not authenticated) ──
begin;
select pg_temp.sign_in('42000000-0000-4000-8000-000000000002');
select pg_temp.assert_raises($$select app.run_recurring_gift_cycle('42000000-0000-4000-8000-000000000000'::uuid)$$,
  'permission denied', 'a signed-in member cannot call run_recurring_gift_cycle directly');
commit;
select pg_temp.sign_out();

-- ── run_recurring_gift_cycle: creates the pledge, advances the date, sends the confirmation ──
update app.recurring_gifts set status = 'active', next_charge_on = current_date where id = :'gift1'::uuid;
select app.run_recurring_gift_cycle(:'gift1'::uuid) as pledge1 \gset
select pg_temp.assert((select source from app.pledges where id = :'pledge1'::uuid) = 'recurring', 'the cycle records a pledge with source=recurring');
select pg_temp.assert((select source_ref_id from app.pledges where id = :'pledge1'::uuid) = :'gift1'::uuid, 'the pledge traces back to the recurring gift');
select pg_temp.assert((select opportunity_id from app.pledges where id = :'pledge1'::uuid) = '42000000-0000-4000-8000-00000000e1e1'::uuid, 'the pledge carries the opportunity id');
select pg_temp.assert((select amount_cents from app.pledges where id = :'pledge1'::uuid) = 2100, 'the pledge amount matches the recurring gift');
select pg_temp.assert((select next_charge_on from app.recurring_gifts where id = :'gift1'::uuid) = (current_date + interval '1 month')::date,
  'a monthly gift advances next_charge_on by one month');
select pg_temp.assert((select status from app.recurring_gifts where id = :'gift1'::uuid) = 'active', 'the gift stays active (until_stopped)');
select pg_temp.assert(exists (
    select 1 from app.messages where template_key = 'opp_recurring_confirm' and to_address = 'asha42@example.com' and channel = 'email'
  ), 'the opportunity''s confirmation template was queued to the household''s primary member');

-- ── end_kind = count: the gift cancels after its last cycle ─────────────────
insert into app.recurring_gifts (id, center_id, household_id, person_id, campaign_id, fund_id, opportunity_id, amount_cents,
                                 frequency, status, starts_on, next_charge_on, end_kind, end_count)
  values ('42000000-0000-4000-8000-00000000e2e2', '42000000-0000-4000-8000-0000000000c1', '42000000-0000-4000-8000-0000000000a1',
          '42000000-0000-4000-8000-0000000000a2', '42000000-0000-4000-8000-00000000c2c2', '42000000-0000-4000-8000-0000000000f1',
          '42000000-0000-4000-8000-00000000e1e1', 5100, 'monthly', 'active', current_date, current_date, 'count', 1);
select app.run_recurring_gift_cycle('42000000-0000-4000-8000-00000000e2e2') as pledge2 \gset
select pg_temp.assert((select status from app.recurring_gifts where id = '42000000-0000-4000-8000-00000000e2e2') = 'cancelled',
  'a count=1 gift cancels itself after its one and only cycle');
select pg_temp.assert((select next_charge_on from app.recurring_gifts where id = '42000000-0000-4000-8000-00000000e2e2') is null,
  'a cancelled gift has no next charge date');

-- ── Active/visible: an inactive opportunity is hidden from members, visible to staff ──
update app.opportunities set active = false where id = '42000000-0000-4000-8000-00000000e1e1';
begin;
select pg_temp.sign_in('42000000-0000-4000-8000-000000000002');
select pg_temp.assert((select count(*) from app.opportunities where id = '42000000-0000-4000-8000-00000000e1e1') = 0,
  'an inactive opportunity is invisible to a member');
select pg_temp.assert_raises(
  $$select app.create_recurring_gift('42000000-0000-4000-8000-0000000000a1', null, null, 2100, 'monthly', current_date + 1, 'until_stopped', null, null, null, '42000000-0000-4000-8000-00000000e1e1')$$,
  'not currently available', 'a recurring gift cannot be started against an inactive opportunity');
commit;
begin;
select pg_temp.sign_in('42000000-0000-4000-8000-000000000001');
select pg_temp.assert((select count(*) from app.opportunities where id = '42000000-0000-4000-8000-00000000e1e1') = 1,
  'an admin (giving.view via center_admin) still sees an inactive opportunity to manage it');
commit;
update app.opportunities set active = true where id = '42000000-0000-4000-8000-00000000e1e1';

-- ── visible_from in the future hides a campaign from members ────────────────
update app.campaigns set visible_from = now() + interval '1 day' where id = '42000000-0000-4000-8000-00000000c2c2';
begin;
select pg_temp.sign_in('42000000-0000-4000-8000-000000000002');
select pg_temp.assert((select count(*) from app.campaigns where id = '42000000-0000-4000-8000-00000000c2c2') = 0,
  'a campaign scheduled to become visible tomorrow is not visible to a member today');
commit;
update app.campaigns set visible_from = null where id = '42000000-0000-4000-8000-00000000c2c2';
