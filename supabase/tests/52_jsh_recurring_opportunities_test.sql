-- 0563: "Make this recurring" switched on for the JSH sandbox's giving opportunities.
-- The seed function acts on a sandbox only, switches on only never-configured opportunities (monthly, quarterly,
-- yearly + the recurring_gift_confirmation template), is idempotent and not callable over the API; and a member of
-- the sandbox can then make an opportunity recurring through the real app.create_recurring_gift.
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
create or replace function pg_temp.sign_in(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- ── Fixtures ───────────────────────────────────────────────────────────────
\set sbx '''52000000-0000-4000-8000-0000000000c1'''
\set prod '''52000000-0000-4000-8000-0000000000c2'''
\set mom '''52000000-0000-4000-8000-000000000001'''
\set p_mom '''52000000-0000-4000-8000-0000000000a1'''
\set h1 '''52000000-0000-4000-8000-0000000000b1'''

insert into auth.users (id, email) values (:mom, 'mom52@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, environment) values
  (:sbx, 'sandbox52', 'Sandbox 52 Community', 'S52', 'TX', 'active', 'sandbox'),
  (:prod, 'prod52', 'Production 52 Community', 'P52', 'TX', 'active', 'production');
insert into app.households (id, center_id, display_name) values (:h1, :sbx, 'Shah household 52');
insert into app.people (id, center_id, first_name, last_name, date_of_birth) values (:p_mom, :sbx, 'Mira', 'Shah', date '1980-01-01');
insert into app.household_members (household_id, person_id, center_id, role) values (:h1, :p_mom, :sbx, 'primary');
insert into app.center_users (center_id, user_id, person_id) values (:sbx, :mom, :p_mom);

-- The seeded JSH giving opportunities (0513) in both organizations: 6 open-amount gifts and 4 tiered sponsorships, all off.
select app.seed_jsh_giving(:sbx);
select app.seed_jsh_giving(:prod);
select pg_temp.assert((select count(*) from app.opportunities where center_id = :sbx) = 10
                      and not exists (select 1 from app.opportunities where center_id in (:sbx, :prod) and allow_recurring),
  'the seeded opportunities start with recurring off');
-- One the office already configured by hand (a yearly-only choice, not switched on): it must be left as it is.
update app.opportunities set recurring_frequencies = array['yearly']::text[] where center_id = :sbx and name = 'Anukampa gift';

-- ── Who may run it, and where ──────────────────────────────────────────────
select pg_temp.assert(not has_function_privilege('authenticated', 'app.seed_jsh_recurring_opportunities(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.seed_jsh_recurring_opportunities(uuid)', 'execute')
                      and has_function_privilege('service_role', 'app.seed_jsh_recurring_opportunities(uuid)', 'execute'),
  'only the service role can run the seed; signed-in and anonymous callers cannot');
select pg_temp.assert((select app.seed_jsh_recurring_opportunities(:prod)) = '{"template_added": 0, "opportunities_enabled": 0, "skipped": "not a sandbox"}'::jsonb
                      and not exists (select 1 from app.opportunities where center_id = :prod and (allow_recurring or notification_template_key is not null))
                      and not exists (select 1 from app.message_templates where center_id = :prod),
  'a production organization is refused and nothing changes');
select pg_temp.assert((select app.seed_jsh_recurring_opportunities('52000000-0000-4000-8000-0000000000ff'))
                      = '{"template_added": 0, "opportunities_enabled": 0, "skipped": "no such organization"}'::jsonb,
  'an organization that does not exist is refused');

-- ── What it does, once ─────────────────────────────────────────────────────
select pg_temp.assert((select app.seed_jsh_recurring_opportunities(:sbx)) = '{"template_added": 1, "opportunities_enabled": 9}'::jsonb,
  'the sandbox gets the template and 9 of its 10 opportunities switched on');
select pg_temp.assert((select app.seed_jsh_recurring_opportunities(:sbx)) = '{"template_added": 0, "opportunities_enabled": 0}'::jsonb,
  'running it again changes nothing');
select pg_temp.assert((select count(*) from app.opportunities
                        where center_id = :sbx and allow_recurring and recurring_frequencies = array['monthly', 'quarterly', 'yearly']::text[]
                          and notification_template_key = 'recurring_gift_confirmation') = 9,
  'nine opportunities offer monthly, quarterly and yearly with the confirmation template');
select pg_temp.assert((select count(*) from app.opportunities where center_id = :sbx and kind = 'amount' and allow_recurring) = 5
                      and (select count(*) from app.opportunities where center_id = :sbx and kind = 'tier' and allow_recurring) = 4,
  'open-amount and tiered opportunities both get it');
select pg_temp.assert((select not allow_recurring and recurring_frequencies = array['yearly']::text[] and notification_template_key is null
                         from app.opportunities where center_id = :sbx and name = 'Anukampa gift'),
  'an opportunity the office had already configured is left as it was');
select pg_temp.assert(not exists (select 1 from app.opportunities where center_id = :sbx and 'weekly' = any(recurring_frequencies)),
  'weekly is not offered');

-- ── The template ───────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) from app.message_templates where center_id = :sbx and key = 'recurring_gift_confirmation' and channel = 'email' and language = 'en') = 1,
  'one email template for the organization');
select pg_temp.assert((select subject like '%{{frequency}}%' and subject like '%{{opportunity_name}}%'
                              and body like '%{{amount}}%' and body like '%{{frequency}}%' and body like '%{{next_date}}%' and body like '%{{opportunity_name}}%'
                              and body like '%{{center_name}}%'
                         from app.message_templates where center_id = :sbx and key = 'recurring_gift_confirmation'),
  'the template uses the fields the recurring cycle fills in (amount, frequency, next date, opportunity name) and the center name');
select pg_temp.assert(not exists (select 1 from regexp_matches((select body || coalesce(subject, '') from app.message_templates where center_id = :sbx and key = 'recurring_gift_confirmation'), '\{\{(?!amount\}\}|frequency\}\}|next_date\}\}|opportunity_name\}\}|center_name\}\})', 'g')),
  'the template uses no field the cycle does not fill in');

-- ── A member makes an opportunity recurring ────────────────────────────────
select id as opp_ok from app.opportunities where center_id = :sbx and name = 'Jiv Daya gift' \gset
select id as opp_off from app.opportunities where center_id = :sbx and name = 'Anukampa gift' \gset
begin;
select pg_temp.sign_in(:mom);
select app.create_recurring_gift(:h1, null, null, 2100, 'monthly', current_date + 1, 'until_stopped', null, null, null, :'opp_ok'::uuid) as rg \gset
select pg_temp.assert_raises($$select app.create_recurring_gift('52000000-0000-4000-8000-0000000000b1', null, null, 2100, 'weekly', current_date + 1, 'until_stopped', null, null, null, '$$ || :'opp_ok' || $$'::uuid)$$,
  'that frequency is not offered', 'a frequency the office did not offer is refused');
select pg_temp.assert_raises($$select app.create_recurring_gift('52000000-0000-4000-8000-0000000000b1', null, null, 2100, 'monthly', current_date + 1, 'until_stopped', null, null, null, '$$ || :'opp_off' || $$'::uuid)$$,
  'cannot be made recurring', 'an opportunity the office has not switched on cannot be made recurring');
commit;
select pg_temp.assert((select opportunity_id = :'opp_ok'::uuid and amount_cents = 2100 and frequency = 'monthly' and status = 'pending_payment_method' and household_id = :h1
                         from app.recurring_gifts where id = :'rg'::uuid),
  'a member made Jiv Daya recurring: monthly, linked to the opportunity, waiting for a payment method (never charged before one exists)');
