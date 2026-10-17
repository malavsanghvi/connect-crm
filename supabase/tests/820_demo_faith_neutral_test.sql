-- 0820 (owner decision 2026-10-15, "make everything in the Demo app neutral"): the faith demo community is not any one faith.
--   A. The pack: version 4, the Faith community kind, 25 demo people, no tradition's word in anything a person reads
--   B. A new faith demo: the kind, its modules, its words (a Learning Center), no Jain choice, no bolis, no boli recorder; the same money;
--      the Patni family's three children enrolled in the class Anita Bhandari teaches (the youngest placed by the office: his age is outside the class's band)
--   C. Nothing a visitor reads names a tradition: every row of the community, the demo people's stories, the featured roles
--   D. The community that exists is aligned in place (same id, same QuickBooks setup, same demo people), and a reset keeps it so (0785 still holds)
--   E. Who may call what; a community that is not a demo is refused; the club demo is untouched
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
-- Rows the pack says a table gets, against the rows the community really has (empty text = all the same).
create or replace function pg_temp.pack_vs_rows(p_center uuid, p_pack text) returns text language plpgsql as $$
declare r record; n bigint; bad text := '';
begin
  for r in
    select o->>'t' as t, sum(case when o ? 'rows' then jsonb_array_length(o->'rows') else 1 end) as want
      from app.demo_packs p, jsonb_each(p.content->'steps') s, jsonb_array_elements(s.value) o
     where p.key = p_pack and o ? 't' group by 1 order by 1
  loop
    -- gyan_levels and gyan_steps carry no center_id (they belong to a goal of the community): counted through the goal, as app.demo_counts_raw does
    execute format('select count(*) from app.%I x where %s', r.t,
                   case r.t when 'gyan_levels' then 'x.goal_id in (select g.id from app.gyan_goals g where g.center_id = $1)'
                            when 'gyan_steps' then 'x.level_id in (select l.id from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id = $1)'
                            else 'x.center_id = $1' end) into n using p_center;
    if n <> r.want then bad := bad || r.t || ' (' || n || ' instead of ' || r.want || ') '; end if;
  end loop;
  return bad;
end $$;

-- The words of a tradition that a house of worship for no one faith must not speak (the same list as the pack builder,
-- supabase/scripts/build-demo-packs.mjs). A "machine token" (no spaces and no capitals: a key, an enum value, an id) is the platform's own
-- and is not read by anyone, so it is not looked at. The one deliberate exception (owner, 2026-10-15): a course may be about Jainism, so the
-- name of that one class, "Introduction to Jainism · Room B", is allowed (and nothing else).
create or replace function pg_temp.banned() returns text language sql immutable as $$
  select '\y(jain\w*|jinendra|derasar|puja\w*|pujan\w*|aarti|tithi|darshan\w*|tapasvi\w*|bahuman|labh|bolis?|seva|pathshala\w*|gyan\w*|sangh\w*|paryushan|mahavir|swadhyay|satsang\w*|pachchakhan|navkar\w*|swamivatsalya|mohanthal|kaju|farsi|chakri|dhokli|bhojanshala|diwali|mithai|namkeen|pandit|rangoli|diyas?|satvik|temples?|mandir|church|mosque|synagogue|gurdwara|tirthankar\w*|samayik|pratikraman|ashtaprakari|porisi|garba|stavan\w*|bhandar|in honor of ba)\y'::text
$$;
-- The banned words found in the display strings of a JSON document (empty text = none).
create or replace function pg_temp.hits(p_doc jsonb) returns text language sql stable as $$
  select coalesce(string_agg(distinct lower(m[1]), ', '), '')
    from (select regexp_matches(s #>> '{}', pg_temp.banned(), 'gi') as m
            from jsonb_path_query(jsonb_build_object('d', p_doc), 'strict $.**') s
           where jsonb_typeof(s) = 'string' and (s #>> '{}') !~ '^[-a-z0-9_@.+:]+$'
             and (s #>> '{}') !~ '^Introduction to Jainism( · Room [A-Z])?$') q
$$;
-- The banned words found in the rows a pack made in a demo community, table by table (empty text = none): every table the pack names, and the
-- tables its payment, RSVP and order operations fill. What the platform itself writes along the way (its own messages and the like) speaks the
-- platform's words and is not the demo's. The demo people are looked at on their own (their headline is the name of a role of the platform's
-- catalog, which every community shares).
create or replace function pg_temp.live_hits(p_center uuid, p_pack text) returns text language plpgsql as $$
declare t text; v text; r text := '';
begin
  for t in
    select q.x from (select distinct o->>'t' as x from app.demo_packs p, jsonb_each(p.content->'steps') s, jsonb_array_elements(s.value) o
                      where p.key = p_pack and o ? 't'
                     union
                     select unnest(array['payments', 'payment_allocations', 'rsvps', 'attendees', 'store_orders', 'store_order_lines'])) q
     order by q.x
  loop
    if exists (select 1 from information_schema.columns c where c.table_schema = 'app' and c.table_name = t and c.column_name = 'center_id') or t in ('gyan_levels', 'gyan_steps') then
      execute format($f$select coalesce(string_agg(distinct lower(m[1]), ', '), '')
                          from (select regexp_matches(s #>> '{}', %L, 'gi') as m
                                  from app.%I x, jsonb_path_query(to_jsonb(x), 'strict $.**') s
                                 where %s and jsonb_typeof(s) = 'string' and (s #>> '{}') !~ '^[-a-z0-9_@.+:]+$'
                                   and (s #>> '{}') !~ '^Introduction to Jainism( · Room [A-Z])?$') q$f$,
                     pg_temp.banned(), t,
                     case t when 'gyan_levels' then 'x.goal_id in (select g.id from app.gyan_goals g where g.center_id = $1)'
                            when 'gyan_steps' then 'x.level_id in (select l.id from app.gyan_levels l join app.gyan_goals g on g.id = l.goal_id where g.center_id = $1)'
                            else 'x.center_id = $1' end) into v using p_center;
      if v <> '' then r := r || t || ': ' || v || '; '; end if;
    end if;
  end loop;
  return r;
end $$;

\set admin '''82000000-0000-4000-8000-0000000000a1'''
\set conn '''82000000-0000-4000-8000-0000000000e1'''
\set jsh '''00000000-0000-4000-8000-000000000001'''

select pg_temp.no_claims();
insert into auth.users (id, email) values (:admin, 'admin820@platform.test');
insert into app.accounts (user_id, is_platform_admin) values (:admin, true) on conflict (user_id) do update set is_platform_admin = true;

-- ── A. The pack ──────────────────────────────────────────────────────────────
select pg_temp.assert((select version = 6 and not active and content is not null from app.demo_packs where key = 'demo_faith_jain_v1'),
  'A · the faith pack is at version 6 (4 in 0820, 5 in 0840, 6 in 0878), and still not offered on Setup > Demo (its key keeps its old name: an internal identifier no screen shows)');
select pg_temp.assert((select content->'center'->>'kind' = 'faith' and content->'center'->>'category_key' = 'faith_other'
                              and content->'center'->>'name' = 'Sunrise Worship Center (Demo)'
                              and content->'center'->'modules' = '["pathshala","store","gyan_path","niva"]'::jsonb
                         from app.demo_packs where key = 'demo_faith_jain_v1'),
  'A · it is the Faith community kind, and names the four modules that kind leaves for Weaver to switch on that the demo needs');
select pg_temp.assert((select jsonb_array_length(content->'personas') = 25
                              and not jsonb_path_exists(content, '$.personas[*] ? (@.role == "boli_recorder")')
                              and not jsonb_path_exists(content, '$.personas[*] ? (@.person == "kataria.sarla")')
                              and jsonb_path_exists(content, '$.steps.people[*].rows[*] ? (@.id == "@p:kataria.sarla")')
                              and not exists (select 1 from jsonb_array_elements(content->'personas') x
                                               where not exists (select 1 from app.roles r where r.key = x->>'role' and app.catalog_shows(r.category_keys, 'faith_other')))
                         from app.demo_packs where key = 'demo_faith_jain_v1'),
  'A · 25 demo people, each of a role the Faith community has; the boli recorder is gone (that kind has no bolis) and Sarla Kataria is still a person of the pack');
select pg_temp.assert((select pg_temp.hits(content) = '' and pg_temp.hits(jsonb_build_array(title, description)) = '' from app.demo_packs where key = 'demo_faith_jain_v1'),
  'A · nothing a person reads in the pack names a tradition (found: ' || (select pg_temp.hits(content) || pg_temp.hits(jsonb_build_array(title, description)) from app.demo_packs where key = 'demo_faith_jain_v1') || ')');
select pg_temp.assert(pg_temp.hits('["Visiting the temple", "Do puja", "Jai Jinendra", "Tapasvi Bahuman and Swamivatsalya", "Derasar hours", "Pathshala"]'::jsonb)
                        = 'bahuman, derasar, jinendra, pathshala, puja, swamivatsalya, tapasvi, temple',
  'A · and the check itself finds them (it is not asleep)');
select pg_temp.assert(pg_temp.hits('["pathshala_fee", "demo_faith_jain_v1", "@fund:pathshala", "pathshala"]'::jsonb) = '',
  'A · while a key, an enum value or an id is the platform''s own and is not read');

-- ── B. A new faith demo ──────────────────────────────────────────────────────
select pg_temp.claims(:admin, true);
select (app.create_demo_community('faith'))->>'center_id' as fc \gset
select (app.create_demo_community('neutral'))->>'center_id' as nc \gset
select pg_temp.no_claims();
select pg_temp.assert((select c.category_key = 'faith_other' and c.tradition::text = 'other' and c.environment = 'sandbox' and app.is_demo_center(c.id)
                              and c.rules->>'demo_pack' = 'demo_faith_jain_v1' and c.rules->>'demo_kind' = 'faith'
                         from app.centers c where c.id = :'fc'),
  'B · the faith demo is a sandbox flagged as a demo, in the Faith community category (it keeps no tradition), made from the same pack');
select pg_temp.assert((select k.terms->>'greeting' = 'Welcome' and k.terms->>'practice_tab' = 'Learning Center' and k.terms->>'school' = 'Learning Center'
                              and k.terms->>'place' = 'place of worship' and k.terms->>'store' = 'Store' and k.terms->>'learning' = 'Learning path'
                         from app.centers c join app.organization_categories k on k.key = c.category_key where c.id = :'fc'),
  'B · so its words are the platform''s neutral ones: Welcome, a Learning Center for the fourth tab and for the school, place of worship, Store');
-- What the apps read: the category profile and the member experience of the demo community (a platform admin opens it).
select pg_temp.claims(:admin, false);
select pg_temp.assert((app.category_profile(:'fc') #>> '{category,terms,practice_tab}') = 'Learning Center' and (app.category_profile(:'fc') #>> '{category,terms,school}') = 'Learning Center'
                      and (app.category_profile(:'fc') #>> '{category,terms,greeting}') = 'Welcome' and (app.category_profile(:'fc') #>> '{modules,pathshala,label}') = 'Learning Center'
                      and (app.member_experience(:'fc') #>> '{experience,terms,practice_tab}') = 'Learning Center' and (app.member_experience(:'fc') #>> '{experience,terms,school}') = 'Learning Center'
                      and (app.member_experience(:'fc') #>> '{modules,pathshala,label}') = 'Learning Center',
  'B · the demo''s category profile reads Learning Center for the fourth tab (practice_tab) and for the school, and the Pathshala module is named so: that is what the member app and the portal show');
select pg_temp.no_claims();
select pg_temp.assert(app.module_enabled(:'fc', 'pathshala') and app.module_enabled(:'fc', 'store') and app.module_enabled(:'fc', 'gyan_path') and app.module_enabled(:'fc', 'niva')
                      and (select count(*) = 4 from app.center_module_grants g where g.center_id = :'fc' and g.module_key in ('pathshala', 'store', 'gyan_path', 'niva')
                                and g.granted and g.granted_by is null and g.reason like 'Demo community:%'),
  'B · its Learning Center, store, learning path and Niva are on (Weaver''s grant, written by the pack), so every demo person has their work');
select pg_temp.assert(app.module_availability(:'fc', 'bolis') = 'not_available' and app.module_availability(:'fc', 'jain_way') = 'not_available'
                      and app.module_availability(:'fc', 'labh') = 'not_available'
                      and not app.module_enabled(:'fc', 'bolis') and not app.module_enabled(:'fc', 'jain_way') and not app.module_enabled(:'fc', 'labh'),
  'B · and it has no Bolis, no My Jain Way and no Labh: a Faith community does not have them');
select pg_temp.assert((select label from app.category_modules where category_key = 'faith_other' and module_key = 'pathshala') = 'Learning Center'
                      and (select label from app.category_modules where category_key = 'faith_other' and module_key = 'store') = 'Store',
  'B · the module names in the portal''s navigation are Learning Center and Store');
select pg_temp.assert(not exists (select 1 from app.dietary_options where center_id = :'fc' and key = 'jain')
                      and exists (select 1 from app.dietary_options where center_id = :'fc' and key = 'vegetarian'),
  'B · it offers no "Jain (no root vegetables)" dietary choice');
select pg_temp.assert((select count(*) = 25 from app.demo_personas where center_id = :'fc')
                      and (select count(*) = 25 from app.roles r where r.tier <> 'platform' and app.catalog_shows(r.category_keys, app.center_category(:'fc'))
                                                       and cardinality(app.role_private_products(r.key)) = 0 and r.key <> 'market_lead')
                      and app.demo_missing_roles(:'fc') = '{}'::text[]
                      and not exists (select 1 from app.demo_personas where center_id = :'fc' and role_key = 'boli_recorder'),
  'B · 25 demo people, one for every role of the Faith community (none missing), and no boli recorder');
select pg_temp.assert(exists (select 1 from app.people p join app.household_members hm on hm.person_id = p.id join app.households h on h.id = hm.household_id
                               where p.center_id = :'fc' and p.first_name = 'Sarla' and p.last_name = 'Kataria' and h.display_name = 'Kataria household')
                      and not exists (select 1 from app.demo_personas d join app.people p on p.id = d.person_id where d.center_id = :'fc' and p.first_name = 'Sarla'),
  'B · Sarla Kataria is still there, in the Kataria household, without a demo sign-in of her own');
select pg_temp.assert((select count(*) = 13 from app.households where center_id = :'fc') and (select count(*) = 36 from app.people where center_id = :'fc')
                      and pg_temp.pack_vs_rows(:'fc', 'demo_faith_jain_v1') = ''
                      and (select count(*) = 0 from app.bolis where center_id = :'fc') and (select count(*) = 0 from app.boli_entries where center_id = :'fc'),
  'B · the same 13 households and 36 people (34 and the two Patni children added by 0820), every table holding exactly the rows the pack says, and no boli');
select pg_temp.assert((select count(*) = 23 and sum(amount_cents) = 1061700 from app.pledges
                           where center_id = :'fc' and id not in (app.demo_id(:'fc', 'pledge:p1'), app.demo_id(:'fc', 'pledge:p2')))
                      and (select count(*) = 14 and sum(amount_cents) = 701200 from app.payments
                            where center_id = :'fc' and crm_external_id not in ('demo:p1', 'demo:p2a', 'demo:p2b'))
                      and (select count(*) = 25 and sum(amount_cents) = 1121700 from app.pledges where center_id = :'fc')
                      and (select count(*) = 17 and sum(amount_cents) = 741200 from app.payments where center_id = :'fc')
                      and (select sum(fee_cents) = 0 + 15100 + 110100 from app.membership_types where center_id = :'fc'),
  'B · the money is what it was, in whole cents, plus the Patni family''s history (0878): the earlier 14 test-mode payments of $7,012.00 and 23 pledges of $10,617.00 are untouched (the 20 of $10,217.00 and the three Patni fee pledges, $150.00, $135.00 and $115.00), the same membership fees, and the family''s two new pledges ($100.00 and $500.00) and three payments ($400.00) bring the totals to 25 pledges of $11,217.00 and 17 payments of $7,412.00');

-- The school is a "Learning Center" in a Faith community, a word of that category (platform-wide for it: there is no per-community override of a
-- kind's words). Jain Center keeps Pathshala; the experiences that started from the faith community keep the words they were given.
select pg_temp.assert((select terms->>'school' = 'Pathshala' and terms->>'practice_tab' = 'Jain Way' from app.organization_categories where key = 'jain_center')
                      and (select label is null from app.category_modules where category_key = 'jain_center' and module_key = 'pathshala')
                      and (select terms->>'school' = 'Sunday school' from app.organization_categories where key = 'church')
                      and (select terms->>'school' = 'Religious school' from app.organization_categories where key = 'swaminarayan_temple')
                      and (select count(*) = 1 from app.centers where category_key = 'faith_other'),
  'B · Jain Center keeps Pathshala, Church and Swaminarayan Temple keep their words, and the faith demo is the only community of the Faith community category');

-- The Patni household (the family of the community member persona: Tarun, the main adult, and Nisha) has all three children, Dev, Maya and Aarav,
-- enrolled in the class Anita Bhandari teaches (0820, 0840), so they are in her roster and attendance list and in the family's member app. That
-- class is the one deliberate exception to the neutral wording: a course may be about Jainism.
select h.id as patni_hh from app.households h where h.center_id = :'fc' and h.display_name = 'Patni family' \gset
select pg_temp.assert((select count(*) = 3 from app.household_members hm join app.people p on p.id = hm.person_id
                        where hm.household_id = :'patni_hh' and hm.role = 'child' and p.first_name in ('Dev', 'Maya', 'Aarav') and p.last_name = 'Patni'
                          and p.email is null and p.phone_e164 is null and p.profession is null)
                      and (select count(*) = 2 from app.household_members hm join app.people p on p.id = hm.person_id
                            where hm.household_id = :'patni_hh' and hm.role = 'child' and p.first_name in ('Dev', 'Maya')
                              and p.date_of_birth <= app.demo_today(:'fc') - interval '8 years' and p.date_of_birth > app.demo_today(:'fc') - interval '11 years')
                      and (select count(*) = 1 from app.household_members hm join app.people p on p.id = hm.person_id
                            where hm.household_id = :'patni_hh' and hm.role = 'child' and p.first_name = 'Aarav'
                              and p.date_of_birth <= app.demo_today(:'fc') - interval '5 years' and p.date_of_birth > app.demo_today(:'fc') - interval '6 years')
                      and (select count(*) = 2 from app.household_members hm join app.demo_personas d on d.person_id = hm.person_id
                            where hm.household_id = :'patni_hh' and hm.role in ('primary', 'spouse') and d.role_key in ('primary_adult', 'adult_member')),
  'B · the Patni household has three plain-named children (9, 8 and 5), besides its two demo adults (the main adult and the adult member)');
select pg_temp.assert((select count(*) = 3 from app.pathshala_enrollments e
                         join app.people st on st.id = e.student_person_id
                         join app.pathshala_classes c on c.id = e.class_id
                         join app.pathshala_teachers pt on pt.class_id = c.id
                         join app.people te on te.id = pt.person_id
                        where e.household_id = :'patni_hh' and st.first_name in ('Dev', 'Maya', 'Aarav') and e.status = 'active'
                          and c.name like 'Introduction to Jainism%' and te.first_name = 'Anita' and te.last_name = 'Bhandari'
                          and exists (select 1 from app.pathshala_terms tm where tm.id = e.term_id and tm.status = 'active'))
                      and (select count(*) = 1 from app.pathshala_classes where center_id = :'fc' and name ilike '%jain%')
                      and not exists (select 1 from app.pathshala_enrollments where center_id = :'fc' and status = 'waitlisted'),
  'B · all three are enrolled (active) in the class Anita Bhandari teaches, "Introduction to Jainism", the only class of the demo that names a tradition, and nobody is waitlisted any more');
-- The age conflict, kept in the open: the class's level is for ages 8 to 10 and Aarav is 5. The platform never places a child outside a level's age
-- band by itself (its registration sends such a child to the office); this is the office's hand placement, and the data says so. Nothing else is placed
-- outside its band.
select pg_temp.assert((select e.channel = 'office' and e.notes like '%although he is 5%' and e.notes like '%ages 8 to 10%'
                              and (select l.key = '1' from app.pathshala_levels l where l.id = e.requested_level_id)
                              and (select l2.min_age = 8 and l2.max_age = 10 from app.pathshala_classes c join app.pathshala_levels l2 on l2.id = c.level_id where c.id = e.class_id)
                         from app.pathshala_enrollments e join app.people st on st.id = e.student_person_id
                        where e.household_id = :'patni_hh' and st.first_name = 'Aarav')
                      and (select count(*) = 1 from app.pathshala_enrollments e join app.people st on st.id = e.student_person_id
                             join app.pathshala_classes c on c.id = e.class_id join app.pathshala_levels l on l.id = c.level_id
                            where e.center_id = :'fc' and e.status = 'active'
                              and ((l.min_age is not null and extract(year from age(app.demo_today(:'fc'), st.date_of_birth))::int < l.min_age)
                                   or (l.max_age is not null and extract(year from age(app.demo_today(:'fc'), st.date_of_birth))::int > l.max_age))),
  'B · Aarav (5) is there by the office''s hand: channel "office", the Level 1 his family asked for, a note that says so, and he is the only learner outside his class''s age band');
select pg_temp.assert((select count(*) = 6 from app.pathshala_enrollments e join app.demo_personas d on d.role_key = 'teacher' and d.center_id = :'fc'
                        where e.class_id = d.scope_id and e.status = 'active')
                      and (select d.scope_kind = 'class' from app.demo_personas d where d.center_id = :'fc' and d.role_key = 'teacher')
                      and (select count(*) = 1 from app.pathshala_enrollments where center_id = :'fc' and status = 'requested'),
  'B · so the teacher (whose role is for that class) has six learners in her roster, the three Patni children among them, and the principal still has Zara''s registration to place');
select pg_temp.assert((select h.address_line1 is not null and h.city = 'Lakeview' and h.state_region = 'IL' and h.postal_code is not null and h.zone_id is not null
                              and h.household_number is not null and h.directory_opt_in
                         from app.households h where h.id = :'patni_hh')
                      and (select count(*) = 2 and bool_and(p.email like '%@demo.weaverams.org' and p.phone_e164 is not null)
                           from app.household_members hm join app.people p on p.id = hm.person_id where hm.household_id = :'patni_hh' and hm.role in ('primary', 'spouse')),
  'B · the household card is complete: an address, a zone, a household number, and two adults with an address and a number to reach them');
select pg_temp.claims(:admin, false);
select pg_temp.assert((select members like '%Dev%' and members like '%Maya%' and members like '%Aarav%' and primary_member = 'Tarun Patni' and zone is not null
                              and city = 'Lakeview' and household_number is not null
                         from app.household_card(:'patni_hh')),
  'B · and app.household_card shows the family: its members including Dev, Maya and Aarav, its main adult, its zone and city');
select pg_temp.no_claims();
-- The three fee pledges by the platform's own rule (app._pathshala_price): the first child pays the fee, every later child the sibling discount off it,
-- and the family cap limits the total. Worked out here from the term's own settings, in whole cents.
select pg_temp.assert((select array_agg(pl.amount_cents order by pl.amount_cents desc) = array[
                              tm.fee_per_child_cents::bigint,
                              tm.fee_per_child_cents - round(tm.fee_per_child_cents * tm.sibling_discount_pct / 100.0)::bigint,
                              least(tm.fee_per_child_cents - round(tm.fee_per_child_cents * tm.sibling_discount_pct / 100.0)::bigint,
                                    tm.fee_per_family_cap_cents - tm.fee_per_child_cents
                                      - (tm.fee_per_child_cents - round(tm.fee_per_child_cents * tm.sibling_discount_pct / 100.0)::bigint))]
                              and sum(pl.amount_cents) = tm.fee_per_family_cap_cents
                              and count(*) = 3 and bool_and(pl.status = 'open' and pl.source = 'pathshala_fee' and pl.amount_cents > 0)
                         from app.pledges pl, app.pathshala_terms tm
                        where pl.household_id = :'patni_hh' and pl.source = 'pathshala_fee' and tm.center_id = :'fc' and tm.status = 'active'
                        group by tm.fee_per_child_cents, tm.sibling_discount_pct, tm.fee_per_family_cap_cents)
                      and (select count(*) = 3 and sum(pl.amount_cents) = 15000 + 13500 + 11500 from app.pledges pl where pl.household_id = :'patni_hh' and pl.source = 'pathshala_fee'),
  'B · and their three fee pledges are open and follow the platform''s sibling rule and the family cap: $150.00, $135.00 and $115.00, $400.00 in all, in whole cents');

-- ── C. Nothing a visitor reads names a tradition ─────────────────────────────
select pg_temp.assert(pg_temp.live_hits(:'fc', 'demo_faith_jain_v1') = '', 'C · no row the pack made in the faith demo community names a tradition (found: ' || pg_temp.live_hits(:'fc', 'demo_faith_jain_v1') || ')');
select pg_temp.assert((select coalesce(string_agg(pg_temp.hits(jsonb_build_array(display_name, story)), ''), '') from app.demo_personas where center_id = :'fc') = '',
  'C · nor does the name or the one-sentence story of any of its demo people');
select pg_temp.assert((select count(*) = 6 and bool_and(pg_temp.hits(jsonb_build_array(d.display_name, d.headline, coalesce(f.label, ''), d.story)) = '')
                         from app.demo_personas d join app.demo_featured_roles() f on f.role_key = d.role_key where d.center_id = :'fc'),
  'C · the six people the public list offers (administrator, treasurer, membership coordinator, event lead, teacher, a family''s main adult) read neutrally');
select pg_temp.assert((select pg_temp.hits(jsonb_build_array(name, short_name)) = '' and name = 'Sunrise Worship Center (Demo)' from app.centers where id = :'fc'),
  'C · and the community''s own name is the one the owner chose');

-- ── D. The community that exists is aligned in place ─────────────────────────
-- Put the faith demo back as the live one was before this change: a Jain Center, with none of the four modules granted, the Jain dietary choice
-- and a demo person's old story. Then give it a QuickBooks setup, the way 0785 / DEMO_QUICKBOOKS.md do, and align it.
select pg_temp.no_claims();
select count(*) as personas_before from app.demo_personas where center_id = :'fc' \gset
select id as gen_fund from app.funds where center_id = :'fc' and key = 'general' \gset
update app.centers set category_key = 'jain_center', tradition = 'shvetambar_murtipujak' where id = :'fc';
delete from app.center_module_grants where center_id = :'fc' and module_key in ('pathshala', 'store', 'gyan_path', 'niva');
insert into app.dietary_options (center_id, key, label, sort) values (:'fc', 'jain', 'Jain (no root vegetables)', 3) on conflict (center_id, key) do nothing;
update app.demo_personas set story = 'Bharat Kataria plans the religious calendar: bolis, pujans, the practice catalog and the approval of religious content.'
 where center_id = :'fc' and role_key = 'religious_coordinator';
insert into app.integration_connections (id, center_id, provider, status, external_account_id, display_name, settings)
values (:conn, :'fc', 'intuit_sandbox', 'connected', 'R820', 'Demo books (Intuit sandbox)',
        jsonb_build_object('mode', 'test', 'read_only', false, 'company', 'sandbox', 'basis', 'cash', 'posting', 'per_txn',
                           'go_live_date', to_char(current_date - 30, 'YYYY-MM-DD')));
insert into app.qbo_accounts (center_id, connection_id, qbo_id, name, account_type, active) values (:'fc', :conn, '1', 'Donations', 'Income', true);
insert into app.qbo_classes (center_id, connection_id, qbo_id, name, active) values (:'fc', :conn, '30', 'General fund', true);
insert into app.qbo_pull_runs (center_id, connection_id, status, finished_at) values (:'fc', :conn, 'succeeded', now());
select app._apply_account_mapping(:'fc', 'role', 'income.general', '1', 'setup');
select app._apply_account_mapping(:'fc', 'fund_class', :'gen_fund', '30', 'setup');
select pg_temp.assert((select category_key = 'jain_center' from app.centers where id = :'fc') and not exists (select 1 from app.center_module_grants where center_id = :'fc' and module_key in ('pathshala', 'store', 'gyan_path', 'niva'))
                      and exists (select 1 from app.dietary_options where center_id = :'fc' and key = 'jain')
                      and (select qbo_class_id = '30' from app.funds where id = :'gen_fund')
                      and (select count(*) = 1 from app.qbo_account_mappings where center_id = :'fc'),
  'D · the starting point: a Jain Center (every module on by default) with none of the four granted, its Jain dietary choice, an old story and a QuickBooks setup');

select app.demo_align_center(:'fc') as al \gset
select pg_temp.assert((:'al'::jsonb ->> 'category_changed')::boolean and :'al'::jsonb ->> 'from' = 'jain_center' and :'al'::jsonb ->> 'to' = 'faith_other'
                      and jsonb_array_length(:'al'::jsonb -> 'modules_granted') = 4 and (:'al'::jsonb ->> 'dietary_removed')::int = 1 and (:'al'::jsonb ->> 'stories')::int >= 1,
  'D · aligning says what it did: the category, four modules, one dietary choice, the stories');
select pg_temp.assert((select category_key = 'faith_other' and tradition::text = 'other' and rules->>'demo_pack' = 'demo_faith_jain_v1' and app.is_demo_center(id)
                         from app.centers where id = :'fc'),
  'D · the same community is now a Faith community (same id, still a flagged demo sandbox of the same pack, no tradition)');
select pg_temp.assert(app.module_enabled(:'fc', 'pathshala') and app.module_enabled(:'fc', 'store') and app.module_enabled(:'fc', 'gyan_path') and app.module_enabled(:'fc', 'niva')
                      and not app.module_enabled(:'fc', 'bolis')
                      and not exists (select 1 from app.dietary_options where center_id = :'fc' and key = 'jain'),
  'D · its four modules are granted, there are no bolis, and the Jain dietary choice is gone');
select pg_temp.assert((select story = x->>'story' and pg_temp.hits(to_jsonb(story)) = ''
                         from app.demo_personas d, app.demo_packs p, jsonb_array_elements(p.content->'personas') x
                        where d.center_id = :'fc' and d.role_key = 'religious_coordinator' and p.key = 'demo_faith_jain_v1' and x->>'role' = 'religious_coordinator'),
  'D · the demo people''s stories are the pack''s');
select pg_temp.assert(exists (select 1 from app.audit_log where center_id = :'fc' and action = 'category.changed' and after->>'category' = 'faith_other'),
  'D · the change of category is in the audit log, as set_center_category writes it');
select pg_temp.assert((select count(*) = :personas_before from app.demo_personas where center_id = :'fc')
                      and (select count(*) = 1 from app.integration_connections where id = :conn and center_id = :'fc' and status = 'connected' and external_account_id = 'R820')
                      and (select count(*) = 1 from app.qbo_account_mappings where center_id = :'fc' and purpose = 'income.general' and qbo_account_id = '1')
                      and (select qbo_class_id = '30' and qbo_class_realm = 'R820' from app.funds where id = :'gen_fund'),
  'D · the same demo people, the same QuickBooks connection, the same account mapping and the same fund class: nothing was recreated');
select app.demo_align_center(:'fc') as al2 \gset
select pg_temp.assert(not (:'al2'::jsonb ->> 'category_changed')::boolean and jsonb_array_length(:'al2'::jsonb -> 'modules_granted') = 0
                      and (:'al2'::jsonb ->> 'dietary_removed')::int = 0 and (:'al2'::jsonb ->> 'stories')::int = 0,
  'D · aligning again changes nothing');

-- A reset (a platform admin''s "Start over") loads the new words, keeps the kind, and keeps the QuickBooks setup (0785).
select pg_temp.claims(:admin, true);
select app.reset_demo_community(:'fc') as rr \gset
select pg_temp.no_claims();
select pg_temp.assert((select category_key = 'faith_other' from app.centers where id = :'fc')
                      and pg_temp.pack_vs_rows(:'fc', 'demo_faith_jain_v1') = '' and pg_temp.live_hits(:'fc', 'demo_faith_jain_v1') = ''
                      and (select count(*) = 25 from app.demo_personas where center_id = :'fc') and app.demo_missing_roles(:'fc') = '{}'::text[],
  'D · after a reset the pack''s rows and the 25 demo people are there, in the same kind, still naming no tradition');
select pg_temp.assert((select count(*) = 1 from app.integration_connections where id = :conn and center_id = :'fc')
                      and (select count(*) = 1 from app.qbo_account_mappings where center_id = :'fc' and purpose = 'income.general' and qbo_account_id = '1')
                      and (select qbo_class_id = '30' and qbo_class_realm = 'R820' from app.funds where id = :'gen_fund')
                      and (select (detail->'quickbooks'->>'restored')::int = 1 from app.center_demo_state where center_id = :'fc'),
  'D · and its QuickBooks connection, account mapping and fund class are still there (the 0785 rule still holds)');

-- The reset also brings an old-kind community into line before it loads: a community still a Jain Center with no modules, started over by
-- a platform admin (a person, not the migration), comes out a Faith community with its modules.
select pg_temp.no_claims();
update app.centers set category_key = 'jain_center', tradition = 'shvetambar_murtipujak' where id = :'fc';
delete from app.center_module_grants where center_id = :'fc' and module_key in ('pathshala', 'store', 'gyan_path', 'niva');
select pg_temp.claims(:admin, true);
select app.reset_demo_community(:'fc') as rr2 \gset
select pg_temp.no_claims();
select pg_temp.assert((select category_key = 'faith_other' and tradition::text = 'other' from app.centers where id = :'fc')
                      and app.module_enabled(:'fc', 'pathshala') and app.module_enabled(:'fc', 'store')
                      and pg_temp.pack_vs_rows(:'fc', 'demo_faith_jain_v1') = '' and pg_temp.live_hits(:'fc', 'demo_faith_jain_v1') = '',
  'D · a reset aligns the kind and the modules first, so the pack always loads into the community it describes');

-- ── E. Who may call what, and what else is untouched ─────────────────────────
select pg_temp.assert(not has_function_privilege('authenticated', 'app.demo_align_center(uuid)', 'execute')
                      and not has_function_privilege('anon', 'app.demo_align_center(uuid)', 'execute')
                      and not has_function_privilege('connect_worker', 'app.demo_align_center(uuid)', 'execute'),
  'E · aligning is not callable by users, visitors or the background service by itself (only the reset and the creation call it)');
select pg_temp.assert_raises(format('select app.demo_align_center(%L)', :jsh), 'not a demo community', 'E · a community that is not a demo is refused: JSH is never aligned');
select pg_temp.assert_raises($$select app.demo_align_center('82000000-0000-4000-8000-0000000000ff')$$, 'not a demo community', 'E · and so is one that does not exist');
select pg_temp.assert((select category_key = 'nonprofit_secular' from app.centers where id = :'nc')
                      and (select count(*) = 2 from app.center_module_grants g where g.center_id = :'nc' and g.reason like 'Demo community: its pack%' and g.module_key in ('store', 'niva'))
                      and not exists (select 1 from app.center_module_grants g where g.center_id = :'nc' and g.module_key in ('pathshala', 'gyan_path'))
                      and app.module_enabled(:'nc', 'store') and not app.module_enabled(:'nc', 'pathshala') and not app.module_enabled(:'nc', 'gyan_path')
                      and pg_temp.pack_vs_rows(:'nc', 'demo_neutral_club_v1') = '' and (select count(*) = 21 from app.demo_personas where center_id = :'nc'),
  'E · the club demo (not faith-based) is the same kind, with its 21 demo people, and its pack (version 3, 0879) switches on its shop and its assistant (the two modules it names, Weaver''s grant); it has no school: no Learning Center and no learning path (0877 adds only add-ons of modules it has)');
select pg_temp.assert((select category_key = 'jain_center' from app.centers where id = :jsh) and not app.is_demo_center(:jsh)
                      and not exists (select 1 from app.center_module_grants g where g.center_id = :jsh and g.reason like 'Demo community:%'),
  'E · and JSH is still a Jain Center, untouched');
rollback;
\echo 'PASS: the faith demo community is neutral, not any one faith'
