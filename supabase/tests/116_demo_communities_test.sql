-- 0627–0629 (B88): the two demo communities — create, the data they hold, one demo person per role, reset.
--   A. The packs   B. Who may create and reset   C. The faith community   D. The non-faith community
--   E. Nothing real in them, nothing of JSH touched   F. Reset: the same data again, idempotent, refused for anything else
-- Everything runs in one transaction that is rolled back, so no demo community is left behind for the tests that follow.
\set ON_ERROR_STOP 1
begin;
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
create or replace function pg_temp.claims(p_user text, p_step_up boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user, 'role', 'authenticated', 'aal', case when p_step_up then 'aal2' else 'aal1' end,
    'amr', case when p_step_up
                then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 600),
                                       jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 60))
                else jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', extract(epoch from now())::bigint - 60)) end)::text, true);
end $$;
create or replace function pg_temp.no_claims() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '', true); end $$;
-- What differs between two {table: rows} answers, as text (empty = nothing).
create or replace function pg_temp.diff(a jsonb, b jsonb) returns text language sql as $$
  select coalesce(string_agg(x.k || ' ' || coalesce(a->>x.k, '0') || ' -> ' || coalesce(b->>x.k, '0'), ', ' order by x.k), '')
    from (select jsonb_object_keys(coalesce(a, '{}'::jsonb) || coalesce(b, '{}'::jsonb)) as k) x
   where coalesce(a->>x.k, '0') <> coalesce(b->>x.k, '0')
$$;
-- Rows the pack says a table gets, against the rows the community really has (empty text = all the same).
create or replace function pg_temp.pack_vs_rows(p_center uuid, p_pack text) returns text language plpgsql as $$
declare r record; n bigint; bad text := '';
begin
  for r in
    select o->>'t' as t, sum(case when o ? 'rows' then jsonb_array_length(o->'rows') else 1 end) as want
      from app.demo_packs p, jsonb_each(p.content->'steps') s, jsonb_array_elements(s.value) o
     where p.key = p_pack and o ? 't' group by 1 order by 1
  loop
    execute format('select count(*) from app.%I where center_id = $1', r.t) into n using p_center;
    if n <> r.want then bad := bad || r.t || ' (' || n || ' instead of ' || r.want || ') '; end if;
  end loop;
  return bad;
end $$;
-- Rows of table p_t that point (through column p_col) at a row of p_ref that belongs to another community.
create or replace function pg_temp.strays(p_center uuid, p_t text, p_col text, p_ref text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from app.%I x join app.%I y on y.id = x.%I where x.center_id = $1 and y.center_id <> $1', p_t, p_ref, p_col) into n using p_center;
  return n;
end $$;
create or replace function pg_temp.hash_ids(p_center uuid, p_t text) returns text language plpgsql as $$
declare h text;
begin
  execute format('select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from app.%I where center_id = $1', p_t) into h using p_center;
  return h;
end $$;

\set admin '''11600000-0000-4000-8000-0000000000a1'''
\set plain '''11600000-0000-4000-8000-0000000000a2'''
\set jsh '''00000000-0000-4000-8000-000000000001'''

select pg_temp.no_claims();
insert into auth.users (id, email) values (:admin, 'admin116@platform.test'), (:plain, 'plain116@else.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin, true) on conflict (user_id) do update set is_platform_admin = true;
insert into app.accounts (user_id) values (:plain) on conflict do nothing;

select (select count(*) from app.people where center_id = :jsh) as jp, (select count(*) from app.households where center_id = :jsh) as jh,
       (select count(*) from app.pledges where center_id = :jsh) as jpl, (select count(*) from app.payments where center_id = :jsh) as jpay,
       (select count(*) from app.events where center_id = :jsh) as jev, (select count(*) from app.centers) as centers_before,
       (select count(*) from auth.users) as users_before \gset

-- ── A. The packs ─────────────────────────────────────────────────────────────
select pg_temp.assert((select count(*) = 2 and bool_and(not active) and bool_and(content is not null) and bool_and(version = 1)
                         from app.demo_packs where key in ('demo_faith_jain_v1', 'demo_neutral_club_v1')),
  'both packs are in the catalog as data, and are not offered on Setup > Demo');
select pg_temp.assert((select content->'center'->>'kind' = 'faith' and content->'center'->>'category_key' = 'jain_center'
                         and content->'center'->>'name' = 'Sunrise Jain Temple (Demo)' from app.demo_packs where key = 'demo_faith_jain_v1')
                      and (select content->'center'->>'kind' = 'neutral' and content->'center'->>'category_key' = 'nonprofit_secular'
                         and content->'center'->>'name' = 'Lakeside Neighbors Club (Demo)' from app.demo_packs where key = 'demo_neutral_club_v1'),
  'the faith pack is a Jain Center, the other a non-faith non-profit, with the names the owner chose');
select pg_temp.assert(app.demo_persona_domain() = 'demo.weaverams.org', 'the demo e-mail domain is the reserved one');
select pg_temp.assert(app.demo_id('11600000-0000-4000-8000-000000000001', 'x') = app.demo_id('11600000-0000-4000-8000-000000000001', 'x')
                      and (select count(*) from app.demo_personas) = 0,
  'record ids are stable, and no demo person exists before a community is made');

-- ── B. Who may create ────────────────────────────────────────────────────────
select pg_temp.assert(not has_function_privilege('anon', 'app.create_demo_community(text)', 'execute')
                      and not has_function_privilege('anon', 'app.reset_demo_community(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.create_demo_community(text)', 'execute')
                      and not has_function_privilege('connect_worker', 'app.create_demo_community(text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.demo_populate(uuid, text, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.demo_load_pack(uuid, text, uuid)', 'execute')
                      and not has_function_privilege('authenticated', 'app.worker_demo_reset_due(boolean, interval)', 'execute'),
  'only the platform console can create or reset; the loader and the nightly check are not callable by users');
select pg_temp.claims(:plain, true);
select pg_temp.assert_raises($$select app.create_demo_community('faith')$$, 'Only the Community Connect team', 'a signed-in person who is not on the platform team cannot create a demo community');
select pg_temp.no_claims();
select pg_temp.assert_raises($$select app.create_demo_community('faith')$$, 'Only the Community Connect team', 'nobody signed in cannot create one');
select pg_temp.claims(:admin, true);
select pg_temp.assert_raises($$select app.create_demo_community('bogus')$$, 'Choose which demo community', 'an unknown kind is refused in plain words');
select pg_temp.assert_raises($$select app.create_demo_community(null)$$, 'Choose which demo community', 'and so is no kind');

-- ── C. The faith community ───────────────────────────────────────────────────
select app.create_demo_community('faith') as r \gset
select (:'r'::jsonb)->>'center_id' as fc, (:'r'::jsonb)->>'created' as fc_created \gset
select pg_temp.assert(:'fc_created' = 'true', 'creating the faith community says it was created');
select pg_temp.assert((select c.environment = 'sandbox' and c.category_key = 'jain_center' and c.name = 'Sunrise Jain Temple (Demo)'
                              and c.status = 'onboarding' and c.rules->'demo' = 'true'::jsonb and c.rules->>'demo_kind' = 'faith'
                              and c.rules->>'demo_pack' = 'demo_faith_jain_v1' and app.is_demo_center(c.id)
                         from app.centers c where c.id = :'fc'),
  'it is a SANDBOX flagged as a demo (never live), in the Jain Center category, named as the owner asked');
select pg_temp.assert((select status = 'loaded' and pack_key = 'demo_faith_jain_v1' and requested_by = :admin and last_error is null
                              and (detail->>'personas')::int = 26 from app.center_demo_state where center_id = :'fc'),
  'the demo state says the pack is loaded, by whom, and how many demo people were made');
select pg_temp.assert(pg_temp.pack_vs_rows(:'fc', 'demo_faith_jain_v1') = '', 'every table holds exactly the rows the pack says');
select pg_temp.assert((select count(*) from app.households where center_id = :'fc') between 11 and 14
                      and (select count(*) from app.people where center_id = :'fc') between 28 and 36
                      and (select count(*) from app.people where center_id = :'fc' and date_of_birth > app.demo_today(:'fc') - interval '18 years') between 4 and 12
                      and (select count(*) from app.people where center_id = :'fc' and date_of_birth <= app.demo_today(:'fc') - interval '18 years') >= 20,
  'about 12 households and 30 people: adults plus a few children');
select pg_temp.assert((select count(*) >= 10 from app.pledges where center_id = :'fc') and (select count(*) >= 8 from app.payments where center_id = :'fc')
                      and (select count(*) >= 3 from app.events where center_id = :'fc') and (select count(*) >= 10 from app.rsvps where center_id = :'fc')
                      and (select count(*) > (select count(*) from app.rsvps where center_id = :'fc') from app.attendees where center_id = :'fc')
                      and (select count(*) >= 4 from app.store_items where center_id = :'fc') and (select count(*) >= 3 from app.store_orders where center_id = :'fc')
                      and (select count(*) >= 2 from app.alerts where center_id = :'fc') and (select count(*) >= 2 from app.comms_campaigns where center_id = :'fc')
                      and (select count(*) >= 3 from app.volunteer_groups where center_id = :'fc')
                      and (select count(*) >= 1 from app.pathshala_terms where center_id = :'fc') and (select count(*) >= 3 from app.pathshala_levels where center_id = :'fc')
                      and (select count(*) >= 3 from app.pathshala_classes where center_id = :'fc') and (select count(*) >= 5 from app.pathshala_enrollments where center_id = :'fc'),
  'pledges, payments, events with RSVPs and tickets, a store, notices, volunteer groups and a Pathshala term with enrolled children');
select pg_temp.assert((select count(*) = 26 from app.demo_personas where center_id = :'fc')
                      and (select count(*) = 26 from app.roles r where r.tier <> 'platform' and app.catalog_shows(r.category_keys, app.center_category(:'fc')))
                      and app.demo_missing_roles(:'fc') = '{}'::text[],
  'one demo person for every role of a Jain Center''s role catalog (26), none missing');
select pg_temp.assert((select count(*) = count(distinct role_key) and count(*) = count(distinct person_id) and count(*) = count(distinct email) from app.demo_personas where center_id = :'fc'),
  'each demo person has one role, one person and one e-mail');
select pg_temp.assert(exists (select 1 from app.demo_personas where center_id = :'fc' and role_key = 'center_admin')
                      and exists (select 1 from app.demo_personas where center_id = :'fc' and role_key = 'treasurer')
                      and exists (select 1 from app.demo_personas where center_id = :'fc' and role_key = 'membership_coordinator')
                      and exists (select 1 from app.demo_personas where center_id = :'fc' and role_key = 'event_lead')
                      and exists (select 1 from app.demo_personas where center_id = :'fc' and role_key = 'content_editor')
                      and exists (select 1 from app.demo_personas where center_id = :'fc' and role_key = 'community_member')
                      and exists (select 1 from app.demo_personas where center_id = :'fc' and role_key = 'pathshala_principal')
                      and exists (select 1 from app.demo_personas where center_id = :'fc' and role_key = 'teacher'),
  'the administrator, treasurer, membership coordinator, event lead, content editor, member, guest, Pathshala principal and teacher are all there');
select pg_temp.assert((select bool_and(d.email like '%@demo.weaverams.org' and d.email = lower(p.email::text) and p.center_id = d.center_id
                                        and d.display_name = p.first_name || ' ' || p.last_name and d.headline = r.name
                                        and length(btrim(d.story)) > 40 and d.story like '%.' and d.story like p.first_name || ' ' || p.last_name || ' %')
                         from app.demo_personas d join app.people p on p.id = d.person_id join app.roles r on r.key = d.role_key where d.center_id = :'fc'),
  'each demo person has an e-mail on the reserved domain, their own name and one plain sentence about what the role can do');
select pg_temp.assert((select d.scope_kind = 'event' and d.scope_id in (select id from app.events where center_id = :'fc') from app.demo_personas d where d.center_id = :'fc' and d.role_key = 'event_lead')
                      and (select d.scope_kind = 'class' and d.scope_id in (select id from app.pathshala_classes where center_id = :'fc') from app.demo_personas d where d.center_id = :'fc' and d.role_key = 'teacher')
                      and (select d.scope_kind = 'zone' and d.scope_id in (select id from app.zones where center_id = :'fc') from app.demo_personas d where d.center_id = :'fc' and d.role_key = 'zone_lead')
                      and (select d.scope_kind = 'pathshala' from app.demo_personas d where d.center_id = :'fc' and d.role_key = 'pathshala_principal')
                      and (select d.scope_kind = 'center' from app.demo_personas d where d.center_id = :'fc' and d.role_key = 'treasurer'),
  'the role assignment is data: the scope a later sign-in will grant (an event, a class, a zone, the Pathshala, the whole community)');
select pg_temp.assert((select count(*) = 0 from app.role_grants where center_id = :'fc') and (select count(*) = 0 from app.center_users where center_id = :'fc')
                      and (select count(*) = 0 from app.center_owners where center_id = :'fc')
                      and (select count(*) = :users_before from auth.users) and not exists (select 1 from auth.users where email like '%@demo.weaverams.org'),
  'the demo people are login-less: no account, no sign-in and no role grant exists for them yet');
select pg_temp.assert((select count(*) = 1 from app.centers where rules->'demo' = 'true'::jsonb)
                      and (select (app.create_demo_community('faith'))->>'created') = 'false'
                      and (select count(*) = 1 from app.centers where rules->'demo' = 'true'::jsonb),
  'creating it again changes nothing and says so');

-- ── D. The non-faith community ───────────────────────────────────────────────
select app.create_demo_community('neutral') as r2 \gset
select (:'r2'::jsonb)->>'center_id' as nc \gset
select pg_temp.assert((select c.environment = 'sandbox' and c.category_key = 'nonprofit_secular' and c.name = 'Lakeside Neighbors Club (Demo)'
                              and c.rules->'demo' = 'true'::jsonb and c.rules->>'demo_kind' = 'neutral' and app.is_demo_center(c.id)
                         from app.centers c where c.id = :'nc'),
  'the neutral community is a flagged sandbox in the non-profit category');
select pg_temp.assert(pg_temp.pack_vs_rows(:'nc', 'demo_neutral_club_v1') = '', 'every table holds exactly the rows its pack says');
select pg_temp.assert((select count(*) between 11 and 14 from app.households where center_id = :'nc') and (select count(*) between 26 and 36 from app.people where center_id = :'nc')
                      and (select count(*) >= 8 from app.payments where center_id = :'nc') and (select count(*) >= 3 from app.events where center_id = :'nc')
                      and (select count(*) >= 4 from app.store_items where center_id = :'nc') and (select count(*) >= 2 from app.alerts where center_id = :'nc'),
  'about 12 households and 30 people, with giving, events, a store and notices');
select pg_temp.assert((select count(*) = 21 from app.demo_personas where center_id = :'nc')
                      and (select count(*) = 21 from app.roles r where r.tier <> 'platform' and app.catalog_shows(r.category_keys, app.center_category(:'nc')))
                      and app.demo_missing_roles(:'nc') = '{}'::text[]
                      and not exists (select 1 from app.demo_personas where center_id = :'nc'
                                       and role_key in ('boli_recorder','religious_coordinator','pathshala_principal','pathshala_committee','teacher')),
  'one demo person for every role of the non-faith catalog (21), and none for the faith-only roles');
select pg_temp.assert((select count(*) = 0 from app.pathshala_terms where center_id = :'nc') and (select count(*) = 0 from app.pathshala_enrollments where center_id = :'nc')
                      and (select count(*) = 0 from app.bolis where center_id = :'nc'),
  'no Pathshala and no bolis in the neutral community');
select pg_temp.assert((select count(*) = 47 from app.demo_personas) and (select count(distinct email) = 47 from app.demo_personas)
                      and (select count(*) = 2 from app.centers where rules->'demo' = 'true'::jsonb)
                      and (select count(*) = :centers_before + 2 from app.centers),
  'the two communities share no e-mail address, and exactly two communities were added');

-- ── E. Nothing real in them, nothing of JSH touched ──────────────────────────
select pg_temp.assert(not exists (select 1 from app.people where center_id in (:'fc', :'nc') and email is not null and email not like '%@demo.weaverams.org')
                      and not exists (select 1 from app.person_emails where center_id in (:'fc', :'nc') and email not like '%@demo.weaverams.org')
                      and not exists (select 1 from app.people where center_id in (:'fc', :'nc') and phone_e164 is not null and phone_e164 !~ '^\+131255501[0-9]{2}$')
                      and not exists (select 1 from app.people where center_id in (:'fc', :'nc') and date_of_birth is null),
  'every e-mail is on the reserved domain and every phone number is a 555-01xx fiction number');
select pg_temp.assert(not exists (select 1 from app.people where center_id in (:'fc', :'nc') and date_of_birth > app.demo_today(:'fc') - interval '18 years'
                                   and (phone_e164 is not null or profession is not null)),
  'children have no phone and no job');
select pg_temp.assert(pg_temp.strays(:'fc', 'household_members', 'household_id', 'households') = 0 and pg_temp.strays(:'fc', 'household_members', 'person_id', 'people') = 0
                      and pg_temp.strays(:'fc', 'pledges', 'household_id', 'households') = 0 and pg_temp.strays(:'fc', 'pledges', 'pledged_by_person_id', 'people') = 0
                      and pg_temp.strays(:'fc', 'payments', 'household_id', 'households') = 0 and pg_temp.strays(:'fc', 'rsvps', 'household_id', 'households') = 0
                      and pg_temp.strays(:'fc', 'attendees', 'person_id', 'people') = 0 and pg_temp.strays(:'fc', 'memberships', 'household_id', 'households') = 0
                      and pg_temp.strays(:'fc', 'store_orders', 'household_id', 'households') = 0 and pg_temp.strays(:'fc', 'pathshala_enrollments', 'student_person_id', 'people') = 0
                      and pg_temp.strays(:'fc', 'demo_personas', 'person_id', 'people') = 0
                      and pg_temp.strays(:'nc', 'pledges', 'household_id', 'households') = 0 and pg_temp.strays(:'nc', 'payments', 'household_id', 'households') = 0
                      and pg_temp.strays(:'nc', 'rsvps', 'household_id', 'households') = 0 and pg_temp.strays(:'nc', 'demo_personas', 'person_id', 'people') = 0,
  'nothing in a demo community points at a person or household of any other community');
select pg_temp.assert((select count(*) = :jp from app.people where center_id = :jsh) and (select count(*) = :jh from app.households where center_id = :jsh)
                      and (select count(*) = :jpl from app.pledges where center_id = :jsh) and (select count(*) = :jpay from app.payments where center_id = :jsh)
                      and (select count(*) = :jev from app.events where center_id = :jsh) and not app.is_demo_center(:jsh)
                      and not exists (select 1 from app.center_demo_state where center_id = :jsh),
  'JSH is untouched by creating the demo communities');
select pg_temp.assert((select bool_and(is_historical and status = 'settled' and refunded_cents = 0 and amount_cents > 0
                                        and ((provider = 'offline' and provider_ref is null) or (provider = 'stripe' and provider_ref like 'pi_test\_%')))
                         from app.payments where center_id in (:'fc', :'nc'))
                      and exists (select 1 from app.payments where center_id = :'fc' and method = 'card' and provider = 'stripe')
                      and not exists (select 1 from app.payments where center_id in (:'fc', :'nc') and method = 'card' and provider <> 'stripe')
                      and not exists (select 1 from app.center_payment_processors where center_id in (:'fc', :'nc') and status = 'live')
                      and app.payment_api_mode(:'fc', 'stripe') = 'test' and app.payment_api_mode(:'nc', 'paypal') = 'test',
  'payments are history or Stripe TEST payments (a "pi_test_" reference), whole cents, and the payment mode of a demo community is test');
select pg_temp.assert((select count(*) > 0 from app.pledges where center_id = :'fc' and status = 'paid') and (select count(*) > 0 from app.pledges where center_id = :'fc' and status = 'partially_paid')
                      and (select count(*) > 0 from app.pledges where center_id = :'fc' and status = 'open')
                      and not exists (select 1 from app.payments p where p.center_id in (:'fc', :'nc')
                                       and p.amount_cents <> (select coalesce(sum(a.amount_cents), 0) from app.payment_allocations a where a.payment_id = p.id)),
  'pledges are paid, part paid and open, and every payment is allocated to pledges in full');
select pg_temp.assert(not exists (select 1 from app.messages where center_id in (:'fc', :'nc') and status in ('sent', 'delivered')),
  'nothing in a demo community was ever sent');
select pg_temp.assert((select count(*) from app.audit_log where center_id = :'fc' and reason like 'Demo community · %') > 0
                      and not exists (select 1 from app.audit_log where center_id = :'fc' and record_table = 'people' and reason is null),
  'the load is in the audit log with its reason');

-- ── F. Reset ─────────────────────────────────────────────────────────────────
select app.demo_counts_raw(:'fc') as snap, pg_temp.hash_ids(:'fc', 'people') as h_people, pg_temp.hash_ids(:'fc', 'households') as h_hh,
       pg_temp.hash_ids(:'fc', 'pledges') as h_pl, pg_temp.hash_ids(:'fc', 'events') as h_ev, pg_temp.hash_ids(:'fc', 'demo_personas') as h_dp,
       pg_temp.hash_ids(:'nc', 'people') as n_people,
       (select md5(coalesce(string_agg(coalesce(household_number::text, '') || '/' || coalesce(member_number::text, ''), ',' order by h.id, p.id), ''))
          from app.households h left join app.household_members hm on hm.household_id = h.id left join app.people p on p.id = hm.person_id where h.center_id = :'fc') as h_numbers \gset
-- A visitor changes things in the demo: a family renamed, a person added, a pledge added, an event renamed.
select set_config('app.client_app', 'portal', true);
update app.households set display_name = 'Renamed by a visitor' where id = (select id from app.households where center_id = :'fc' order by id limit 1);
insert into app.people (center_id, first_name, last_name) values (:'fc', 'Visitor', 'Added');
update app.events set name = 'Renamed event' where id = (select id from app.events where center_id = :'fc' order by id limit 1);
delete from app.alerts where center_id = :'fc';
select pg_temp.assert((select count(*) = 35 from app.people where center_id = :'fc') and (select count(*) = 0 from app.alerts where center_id = :'fc'),
  'the visitor''s changes are in');

select pg_temp.claims(:plain, true);
select pg_temp.assert_raises(format('select app.reset_demo_community(%L)', :'fc'), 'Only the Community Connect team', 'a person who is not on the platform team cannot reset');
select pg_temp.claims(:admin, true);
select pg_temp.assert_raises(format('select app.reset_demo_community(%L)', :jsh), 'not a demo community', 'JSH cannot be reset: it is not a demo community');
select pg_temp.assert_raises($$select app.reset_demo_community('11600000-0000-4000-8000-0000000000ff')$$, 'not a demo community', 'a community that does not exist cannot be reset');
select app._create_sandbox_center('plain116', 'Plain sandbox 116', 'TX', 'Dallas', null, '{}'::jsonb) as plain_sbx \gset
select pg_temp.assert_raises(format('select app.reset_demo_community(%L)', :'plain_sbx'), 'not a demo community', 'an ordinary sandbox cannot be reset with it either');
insert into app.centers (id, slug, name, status, environment, rules)
values ('11600000-0000-4000-8000-0000000000c9', 'flagged116', 'Flagged production 116', 'active', 'production',
        jsonb_build_object('demo', true, 'demo_pack', 'demo_faith_jain_v1'));
select pg_temp.assert_raises($$select app.reset_demo_community('11600000-0000-4000-8000-0000000000c9')$$, 'only for sandboxes',
  'even a production community that carries the demo flag cannot be reset: the sandbox guard stays');
select pg_temp.assert((select count(*) = 0 from app.people where center_id = '11600000-0000-4000-8000-0000000000c9'), 'and nothing was loaded into it');

select app.reset_demo_community(:'fc') as rr \gset
select pg_temp.assert(pg_temp.diff(app.demo_counts_raw(:'fc'), :'snap'::jsonb) = '', 'after a reset every table holds the same number of rows as before: ' || pg_temp.diff(app.demo_counts_raw(:'fc'), :'snap'::jsonb));
select pg_temp.assert(pg_temp.hash_ids(:'fc', 'people') = :'h_people' and pg_temp.hash_ids(:'fc', 'households') = :'h_hh' and pg_temp.hash_ids(:'fc', 'pledges') = :'h_pl'
                      and pg_temp.hash_ids(:'fc', 'events') = :'h_ev' and pg_temp.hash_ids(:'fc', 'demo_personas') = :'h_dp',
  'with the same ids: the demo people keep their ids from night to night');
select pg_temp.assert((select md5(coalesce(string_agg(coalesce(household_number::text, '') || '/' || coalesce(member_number::text, ''), ',' order by h.id, p.id), ''))
                         from app.households h left join app.household_members hm on hm.household_id = h.id left join app.people p on p.id = hm.person_id where h.center_id = :'fc') = :'h_numbers',
  'household and member numbers start again, so the numbers are the same every night');
select pg_temp.assert(not exists (select 1 from app.households where center_id = :'fc' and display_name = 'Renamed by a visitor')
                      and not exists (select 1 from app.people where center_id = :'fc' and first_name = 'Visitor')
                      and not exists (select 1 from app.events where center_id = :'fc' and name = 'Renamed event')
                      and (select count(*) = 2 from app.alerts where center_id = :'fc'),
  'the visitor''s changes are gone and the deleted notices are back');
select pg_temp.assert(pg_temp.pack_vs_rows(:'fc', 'demo_faith_jain_v1') = '' and (select count(*) = 26 from app.demo_personas where center_id = :'fc')
                      and app.demo_missing_roles(:'fc') = '{}'::text[],
  'and the pack''s rows and all 26 demo people are there');
select pg_temp.assert((select status = 'loaded' and operation = 'reset' and last_error is null and cleared_at is not null and requested_by = :admin
                         and (detail->'cleared') is not null from app.center_demo_state where center_id = :'fc'),
  'the demo state records the reset');
select app.reset_demo_community(:'fc') as rr2 \gset
select pg_temp.assert(pg_temp.diff(app.demo_counts_raw(:'fc'), :'snap'::jsonb) = '' and pg_temp.hash_ids(:'fc', 'people') = :'h_people' and pg_temp.hash_ids(:'fc', 'demo_personas') = :'h_dp',
  'a second reset changes nothing more: it is idempotent: ' || pg_temp.diff(app.demo_counts_raw(:'fc'), :'snap'::jsonb));
select pg_temp.assert(pg_temp.hash_ids(:'nc', 'people') = :'n_people' and (select count(*) = 21 from app.demo_personas where center_id = :'nc'),
  'resetting one demo community leaves the other as it was');
select pg_temp.assert((select count(*) = :jp from app.people where center_id = :jsh) and (select count(*) = :jh from app.households where center_id = :jsh)
                      and (select count(*) = :jpl from app.pledges where center_id = :jsh) and (select count(*) = :jpay from app.payments where center_id = :jsh)
                      and (select count(*) = :jev from app.events where center_id = :jsh)
                      and (select count(*) = 0 from app.households where center_id = :'plain_sbx'),
  'JSH and every other community are untouched by the resets');
select pg_temp.assert((select count(*) > 0 from app.audit_log where center_id = :'fc' and reason like 'Demo community · reset%'),
  'the reset is in the audit log with its reason');
select pg_temp.no_claims();
select pg_temp.assert_raises(format('select app.reset_demo_community(%L)', :'fc'), 'Only the Community Connect team', 'nobody signed in cannot reset');
rollback;
