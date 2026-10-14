-- 0624: the member app's look and layout as data (master plan priority 3, backlog B89).
--   A. The shape check (app.template_problems): what is accepted, what is refused; unknown row ids and widget names are fine.
--   B. The starter templates: every category has one and every one is valid; the Jain Center's is exactly today's layout.
--   C. app.resolve_template for each kind of organization: Jain Center (JSH) is the legacy layout, the neutral community,
--      the chamber, the generic faith and the faiths that inherit from it.
--   D. The reads the app makes: category_profile and member_experience carry every previous key plus `template`, a guest
--      can still call category_profile, and a changed template changes the stamp.
--   E. Merge order: category, then the tradition path, then the administrator's override; an override wins; rows are replaced
--      wholesale; tabs and theme merge key by key; a complete tab list reorders; an invalid layer is ignored, never an error.
--   F. Nothing set gives null; an invalid category layer is ignored.
--   G. Who may call what.
-- Everything runs in one transaction that is rolled back.
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
  if position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL: % (got "%")', label, sqlerrm; end if;
  raise notice 'PASS: %', label;
end $$;
-- The keys of a JSON object as one sorted comma list.
create or replace function pg_temp.keys(j jsonb) returns text language sql as $$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(j) k
$$;
-- The home rows, and the tab keys, of a template in display order.
create or replace function pg_temp.rowlist(j jsonb) returns text language sql as $$
  select coalesce(string_agg(x.r, ',' order by x.o), '') from jsonb_array_elements_text(j -> 'home' -> 'rows') with ordinality as x(r, o)
$$;
create or replace function pg_temp.tablist(j jsonb) returns text language sql as $$
  select coalesce(string_agg(x.t ->> 'key', ',' order by x.o), '') from jsonb_array_elements(j -> 'tabs') with ordinality as x(t, o)
$$;
-- Is something wrong with this template?
create or replace function pg_temp.bad(j text) returns boolean language sql as $$
  select cardinality(app.template_problems(j::jsonb)) > 0
$$;

\set jsh '''00000000-0000-4000-8000-000000000001'''
\set c_chm '''10100000-0000-4000-8000-0000000000c1'''
\set c_npo '''10100000-0000-4000-8000-0000000000c2'''
\set c_fth '''10100000-0000-4000-8000-0000000000c3'''
\set c_chr '''10100000-0000-4000-8000-0000000000c4'''
\set c_mos '''10100000-0000-4000-8000-0000000000c5'''
\set c_swm '''10100000-0000-4000-8000-0000000000c6'''
\set c_jc '''10100000-0000-4000-8000-0000000000c7'''
\set c_jd '''10100000-0000-4000-8000-0000000000c8'''

-- One preview sandbox of each experience (a sandbox may take an inactive one). The Jain Center c_jc follows the same tradition
-- as JSH; c_jd follows the Digambar one. Active, like JSH's sandbox: since 0813 a community still onboarding is shown only to its
-- own people, and this test reads the templates without a signed-in user.
insert into app.centers (id, slug, name, environment, category_key, status, tradition) values
  (:c_chm, 'chm101-sandbox', 'Chamber 101',      'sandbox', 'chamber_of_commerce', 'active', 'other'),
  (:c_npo, 'npo101-sandbox', 'Community 101',    'sandbox', 'nonprofit_secular',   'active', 'other'),
  (:c_fth, 'fth101-sandbox', 'Faith 101',        'sandbox', 'faith_other',         'active', 'other'),
  (:c_chr, 'chr101-sandbox', 'Church 101',       'sandbox', 'church',              'active', 'other'),
  (:c_mos, 'mos101-sandbox', 'Mosque 101',       'sandbox', 'mosque',              'active', 'other'),
  (:c_swm, 'swm101-sandbox', 'Swaminarayan 101', 'sandbox', 'swaminarayan_temple', 'active', 'other'),
  (:c_jc,  'jc101-sandbox',  'Jain Center 101',  'sandbox', 'jain_center',         'active', 'shvetambar_murtipujak'),
  (:c_jd,  'jd101-sandbox',  'Jain Digambar 101', 'sandbox', 'jain_center',        'active', 'digambar');

-- ══ A. The shape check ══════════════════════════════════════════════════════
select pg_temp.assert(app.template_problems(null) = '{}' and app.template_problems('null'::jsonb) = '{}'
                      and app.template_problems('{}'::jsonb) = '{}',
  'A · nothing set (null, JSON null, {}) has nothing wrong');
select pg_temp.assert(app.template_problems('{"version":1,
    "home":{"rows":["today","special_days","events","giving","life","learn"]},
    "tabs":[{"key":"index","label":null,"icon":null,"hidden":false},{"key":"events","label":"Programs","icon":"calendar-outline","hidden":false},
            {"key":"give"},{"key":"jain-way","hidden":true},{"key":"family","label":"My business"}],
    "theme":{"primary":"#3D3BB8","accent":"#0e7c86","surface":"cool","radius":"crisp","motif":"dharma_wheel"},
    "widgets":{"today":{"variant":"service_times"}}}'::jsonb) = '{}'
                      and app.template_problems('{"theme":{"primary":null,"accent":null,"surface":null,"radius":null,"motif":null}}'::jsonb) = '{}'
                      and app.template_problems('{"theme":{"motif":"none"},"widgets":{"today":{"variant":"full"},"today_extra":{}}}'::jsonb) = '{}',
  'A · the whole contract is accepted, with every key optional and null where the contract allows it');
select pg_temp.assert(app.template_problems('{"home":{"rows":["today","zakat_reminder"]},"widgets":{"prayer_times":{"style":"compact"}}}'::jsonb) = '{}',
  'A · a row id or a widget name the database does not know is allowed (a newer app or template must not be refused)');
select pg_temp.assert(pg_temp.bad('[]') and pg_temp.bad('"text"') and pg_temp.bad('3')
                      and pg_temp.bad('{"colour":"blue"}') and pg_temp.bad('{"version":2}') and pg_temp.bad('{"version":"1"}'),
  'A · not an object, an unknown top-level key and another version are refused');
select pg_temp.assert(pg_temp.bad('{"home":[]}') and pg_temp.bad('{"home":{"rows":"today"}}') and pg_temp.bad('{"home":{"rows":[1]}}')
                      and pg_temp.bad('{"home":{"rows":["Today"]}}') and pg_temp.bad('{"home":{"rows":["today","today"]}}')
                      and pg_temp.bad('{"home":{"rows":["today"],"density":"tight"}}'),
  'A · home: rows must be a list of short lower-case names, with no repeats, and nothing else is in home');
select pg_temp.assert(pg_temp.bad('{"tabs":{}}') and pg_temp.bad('{"tabs":["index"]}') and pg_temp.bad('{"tabs":[{"label":"x"}]}')
                      and pg_temp.bad('{"tabs":[{"key":"about"}]}') and pg_temp.bad('{"tabs":[{"key":"index"},{"key":"index"}]}')
                      and pg_temp.bad('{"tabs":[{"key":"index","colour":"red"}]}') and pg_temp.bad('{"tabs":[{"key":"index","label":""}]}')
                      and pg_temp.bad('{"tabs":[{"key":"index","label":3}]}') and pg_temp.bad('{"tabs":[{"key":"index","icon":"Home Page"}]}')
                      and pg_temp.bad('{"tabs":[{"key":"index","hidden":"no"}]}'),
  'A · tabs: only the five known tab keys, each once, with a label, icon and hidden of the right kind');
select pg_temp.assert(pg_temp.bad('{"theme":[]}') and pg_temp.bad('{"theme":{"primary":"red"}}') and pg_temp.bad('{"theme":{"accent":"#12345"}}')
                      and pg_temp.bad('{"theme":{"accent":"#GGGGGG"}}') and pg_temp.bad('{"theme":{"surface":"neon"}}')
                      and pg_temp.bad('{"theme":{"radius":"round"}}') and pg_temp.bad('{"theme":{"motif":"Om"}}')
                      and pg_temp.bad('{"theme":{"motif":"om-1"}}') and pg_temp.bad('{"theme":{"motif":"abcdefghijklmnopqrstuvwxy"}}')
                      and pg_temp.bad('{"theme":{"font":"Comic Sans"}}'),
  'A · theme: #RRGGBB colours, warm/cool/plain, soft/crisp, a short motif name, nothing else');
select pg_temp.assert(pg_temp.bad('{"widgets":[]}') and pg_temp.bad('{"widgets":{"today":"full"}}') and pg_temp.bad('{"widgets":{"Today":{}}}')
                      and pg_temp.bad('{"widgets":{"today":{"variant":"huge"}}}') and pg_temp.bad('{"widgets":{"today":{"variant":3}}}'),
  'A · widgets: an object per widget; the day card''s variant is full, basic or service_times');

-- ══ B. The starter templates ════════════════════════════════════════════════
select pg_temp.assert(not exists (select 1 from app.organization_categories where template is null)
                      and not exists (select 1 from app.organization_categories where cardinality(app.template_problems(template)) > 0)
                      and (select count(*) from app.organization_categories) >= 7,
  'B · every category (active or not) has a starter template and every one passes the shape check');
select pg_temp.assert(not exists (select 1 from app.category_paths where template is not null)
                      and (select count(*) from app.category_paths where category_key = 'jain_center') = 10,
  'B · no tradition path template is seeded (the Jain paths are unchanged; no path was invented for another faith)');
select pg_temp.assert((select template from app.organization_categories where key = 'jain_center') =
  '{"version":1,
    "home":{"rows":["today","special_days","events","giving","life","learn"]},
    "tabs":[{"key":"index"},{"key":"events"},{"key":"give"},{"key":"jain-way"},{"key":"family"}],
    "theme":{"primary":null,"accent":null,"surface":null,"radius":null,"motif":null},
    "widgets":{"today":{"variant":"full"}}}'::jsonb,
  'B · the Jain Center''s template is exactly today''s layout: rows, tabs, no theme, the full day card');

-- ══ C. resolve_template for each kind of organization ═══════════════════════
select app.resolve_template(:jsh) as v_jsh \gset
select pg_temp.assert(pg_temp.rowlist(:'v_jsh'::jsonb) = 'today,special_days,events,giving,life,learn'
                      and pg_temp.tablist(:'v_jsh'::jsonb) = 'index,events,give,jain-way,family'
                      and (:'v_jsh'::jsonb) -> 'theme' = '{"primary":null,"accent":null,"surface":null,"radius":null,"motif":null}'::jsonb
                      and (:'v_jsh'::jsonb) #>> '{widgets,today,variant}' = 'full'
                      and (:'v_jsh'::jsonb) = (select template from app.organization_categories where key = 'jain_center'),
  'C · JSH resolves to the legacy layout: the six rows in today''s order, the five tabs, no theme, the full day card');
select pg_temp.assert(app.resolve_template(:c_jc) = (:'v_jsh'::jsonb) and app.resolve_template(:c_jd) = (:'v_jsh'::jsonb),
  'C · every Jain Center resolves the same while the Jain paths carry no template');
select pg_temp.assert(pg_temp.rowlist(app.resolve_template(:c_npo)) = 'today,events,giving,life,learn'
                      and app.resolve_template(:c_npo) #>> '{widgets,today,variant}' = 'basic'
                      and app.resolve_template(:c_npo) -> 'theme' = '{"accent":"#0E7C86","surface":"cool"}'::jsonb
                      and app.resolve_template(:c_npo) -> 'tabs' -> 3 = '{"key":"jain-way","hidden":true}'::jsonb,
  'C · the community organization: a basic day card, no festival days, teal on cool surfaces, no Jain Way tab');
select pg_temp.assert(pg_temp.rowlist(app.resolve_template(:c_chm)) = 'events,giving,life'
                      and pg_temp.tablist(app.resolve_template(:c_chm)) = 'index,events,give,jain-way,family'
                      and app.resolve_template(:c_chm) -> 'tabs' -> 3 = '{"key":"jain-way","hidden":true}'::jsonb
                      and app.resolve_template(:c_chm) -> 'theme' = '{"primary":"#3D3BB8"}'::jsonb,
  'C · the chamber of commerce: events, dues and payments, my business; no practice tab; its own indigo');
select pg_temp.assert(pg_temp.rowlist(app.resolve_template(:c_fth)) = 'today,events,giving,life,learn'
                      and app.resolve_template(:c_fth) #>> '{widgets,today,variant}' = 'service_times'
                      and app.resolve_template(:c_fth) -> 'tabs' -> 3 = '{"key":"jain-way","label":null}'::jsonb
                      and not (app.resolve_template(:c_fth) ? 'theme'),
  'C · the faith community: service times on the day card, the practice tab named by the category''s own words');
select pg_temp.assert(pg_temp.rowlist(app.resolve_template(:c_chr)) = 'today,events,giving,life,learn'
                      and app.resolve_template(:c_chr) #>> '{widgets,today,variant}' = 'service_times'
                      and app.resolve_template(:c_chr) -> 'theme' = '{"surface":"warm","motif":"cross"}'::jsonb
                      and app.resolve_template(:c_chr) -> 'tabs' -> 3 = '{"key":"jain-way","label":null}'::jsonb
                      and app.resolve_template(:c_mos) -> 'theme' = '{"surface":"warm","motif":"crescent"}'::jsonb
                      and app.resolve_template(:c_swm) -> 'theme' = '{"surface":"warm","motif":"om"}'::jsonb
                      and pg_temp.rowlist(app.resolve_template(:c_mos)) = 'today,events,giving,life,learn',
  'C · a church, a mosque and a Swaminarayan temple start from the faith community''s template and add their motif on warm surfaces');

-- ══ D. The reads the app makes ═════════════════════════════════════════════
select app.category_profile(:jsh) as v_prof \gset
select pg_temp.assert(pg_temp.keys(:'v_prof'::jsonb) = 'category,default_path,modules,paths,template'
                      and (:'v_prof'::jsonb) -> 'template' = (:'v_jsh'::jsonb)
                      and (:'v_prof'::jsonb) #>> '{category,key}' = 'jain_center'
                      and (:'v_prof'::jsonb) #>> '{category,terms,greeting}' = 'Jai Jinendra'
                      and (select count(*) from jsonb_object_keys((:'v_prof'::jsonb) -> 'modules')) = (select count(*) from app.modules)
                      and jsonb_array_length((:'v_prof'::jsonb) -> 'paths') = 10
                      and (:'v_prof'::jsonb) ->> 'default_path' = 'shwetambar_murtipujak',
  'D · category_profile keeps its four keys (category, modules, paths, default_path) and adds template');
select app.member_experience(:jsh) as v_me \gset
select pg_temp.assert(pg_temp.keys(:'v_me'::jsonb) = 'access,center,default_path,experience,flags,modules,paths,setup,stamp,template,topics,unchanged,updated_at'
                      and (:'v_me'::jsonb) -> 'template' = (:'v_jsh'::jsonb)
                      and (:'v_me'::jsonb) -> 'paths' = (:'v_prof'::jsonb) -> 'paths'
                      and (:'v_me'::jsonb) ->> 'default_path' = 'shwetambar_murtipujak'
                      and (:'v_me'::jsonb) #>> '{experience,key}' = 'jain_center'
                      and (:'v_me'::jsonb) #>> '{experience,terms,practice_tab}' = 'Jain Way'
                      and (:'v_me'::jsonb) #>> '{center,slug}' = 'jsh'
                      and ((:'v_me'::jsonb) ->> 'unchanged')::boolean = false,
  'D · member_experience keeps all twelve keys it had and adds template, the same value category_profile carries');
select pg_temp.assert(app.category_profile(:c_chm) -> 'template' = app.resolve_template(:c_chm)
                      and app.member_experience(:c_chm) -> 'template' = app.resolve_template(:c_chm)
                      and app.member_experience(:c_chr) -> 'template' = app.resolve_template(:c_chr),
  'D · the two reads carry the template of the community they were asked about');
set role anon;
select pg_temp.assert(app.category_profile(:jsh) -> 'template' = (:'v_jsh'::jsonb)
                      and pg_temp.keys(app.category_profile(:jsh) -> 'template') = 'home,tabs,theme,version,widgets'
                      and app.member_experience(:jsh) -> 'template' = (:'v_jsh'::jsonb)
                      and app.resolve_template(:jsh) = (:'v_jsh'::jsonb),
  'D · a guest still calls category_profile (and member_experience) and gets the template, which holds no personal data');
select pg_temp.assert_raises($$select app.category_profile('10100000-0000-4000-8000-00000000dead')$$, 'That community was not found.',
  'D · a guest asking about a community that does not exist is told so');
select pg_temp.assert_raises($$select app.resolve_template('10100000-0000-4000-8000-00000000dead')$$, 'That community was not found.',
  'D · resolve_template says the same for an unknown community');
reset role;

-- ══ E. Merge order ═════════════════════════════════════════════════════════
-- Layer 2: the Murtipujak path (JSH's tradition, and c_jc's) gets a template. c_jd (Digambar) is not on that path.
update app.category_paths set template = '{"version":1,
    "home":{"rows":["events","today"]},
    "tabs":[{"key":"events","label":"Programs"}],
    "theme":{"accent":"#112233","motif":"dharma_wheel"},
    "widgets":{"today":{"variant":"basic"}}}'::jsonb
 where category_key = 'jain_center' and key = 'shwetambar_murtipujak';
select pg_temp.assert(pg_temp.rowlist(app.resolve_template(:c_jc)) = 'events,today'
                      and pg_temp.tablist(app.resolve_template(:c_jc)) = 'index,events,give,jain-way,family'
                      and app.resolve_template(:c_jc) -> 'tabs' -> 0 = '{"key":"index"}'::jsonb
                      and app.resolve_template(:c_jc) -> 'tabs' -> 1 = '{"key":"events","label":"Programs"}'::jsonb
                      and app.resolve_template(:c_jc) -> 'theme' = '{"primary":null,"accent":"#112233","surface":null,"radius":null,"motif":"dharma_wheel"}'::jsonb
                      and app.resolve_template(:c_jc) #>> '{widgets,today,variant}' = 'basic',
  'E · the tradition path is laid over the category: rows replaced, one tab changed in place, theme and widget merged key by key');
select pg_temp.assert(app.resolve_template(:jsh) = app.resolve_template(:c_jc)
                      and app.resolve_template(:c_jd) = (:'v_jsh'::jsonb),
  'E · the path layer applies to the communities of that tradition and to no other');

select app.member_experience(:c_jc) ->> 'stamp' as s0 \gset
select pg_temp.assert((app.member_experience(:c_jc, :'s0') ->> 'unchanged')::boolean
                      and pg_temp.keys(app.member_experience(:c_jc, :'s0')) = 'stamp,unchanged,updated_at',
  'E · asking again with the stamp just received says "unchanged"');

-- Layer 3: the administrator's override, in centers.rules.home.template.
update app.centers set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('home', jsonb_build_object('template',
    '{"home":{"rows":["learn","today"]},
      "tabs":[{"key":"give","label":"Donate"},{"key":"events","hidden":true},{"key":"family","hidden":true}],
      "theme":{"primary":"#AA0000","accent":null},
      "widgets":{"today":{"variant":"service_times"}}}'::jsonb))
 where id = :c_jc;
select pg_temp.assert(pg_temp.rowlist(app.resolve_template(:c_jc)) = 'learn,today',
  'E · the administrator''s rows replace the path''s rows wholesale');
select pg_temp.assert(pg_temp.tablist(app.resolve_template(:c_jc)) = 'index,events,give,jain-way,family'
                      and app.resolve_template(:c_jc) -> 'tabs' -> 0 = '{"key":"index"}'::jsonb
                      and app.resolve_template(:c_jc) -> 'tabs' -> 1 = '{"key":"events","label":"Programs","hidden":true}'::jsonb
                      and app.resolve_template(:c_jc) -> 'tabs' -> 2 = '{"key":"give","label":"Donate"}'::jsonb
                      and app.resolve_template(:c_jc) -> 'tabs' -> 3 = '{"key":"jain-way"}'::jsonb
                      and app.resolve_template(:c_jc) -> 'tabs' -> 4 = '{"key":"family","hidden":true}'::jsonb,
  'E · tabs merge by key: an override that lists some tabs changes just those, keeps the others'' place and the path''s label');
select pg_temp.assert(app.resolve_template(:c_jc) -> 'theme' = '{"primary":"#AA0000","accent":null,"surface":null,"radius":null,"motif":"dharma_wheel"}'::jsonb
                      and app.resolve_template(:c_jc) #>> '{widgets,today,variant}' = 'service_times',
  'E · the override wins: its colour is used, its null clears the path''s accent, the path''s motif stays; its day card variant wins');
select pg_temp.assert(app.resolve_template(:jsh) <> app.resolve_template(:c_jc)
                      and pg_temp.rowlist(app.resolve_template(:jsh)) = 'events,today'
                      and app.resolve_template(:jsh) #>> '{theme,primary}' is null
                      and app.resolve_template(:jsh) #>> '{theme,accent}' = '#112233',
  'E · the override belongs to its community: JSH, on the same path, is untouched');
select pg_temp.assert(app.member_experience(:c_jc) ->> 'stamp' <> :'s0'
                      and (app.member_experience(:c_jc, :'s0') ->> 'unchanged')::boolean = false
                      and app.member_experience(:c_jc, :'s0') -> 'template' = app.resolve_template(:c_jc),
  'E · a changed template changes the stamp, so the app fetches the new one on its next refresh');

-- An override that lists every tab sets the order too.
update app.centers set rules = jsonb_build_object('home', jsonb_build_object('template',
    '{"tabs":[{"key":"family"},{"key":"give","label":"Donate"},{"key":"events"},{"key":"index"},{"key":"jain-way","hidden":true}]}'::jsonb))
 where id = :c_jd;
select pg_temp.assert(pg_temp.tablist(app.resolve_template(:c_jd)) = 'family,give,events,index,jain-way'
                      and app.resolve_template(:c_jd) -> 'tabs' -> 1 = '{"key":"give","label":"Donate"}'::jsonb
                      and app.resolve_template(:c_jd) -> 'tabs' -> 4 = '{"key":"jain-way","hidden":true}'::jsonb
                      and pg_temp.rowlist(app.resolve_template(:c_jd)) = 'today,special_days,events,giving,life,learn',
  'E · a tab list that names every tab is also the new order; the rest of the template is untouched');

-- Unknown row ids pass through (the app ignores what it does not know).
update app.centers set rules = jsonb_build_object('home', jsonb_build_object('template',
    '{"home":{"rows":["today","zakat_reminder","events"]},"widgets":{"prayer_times":{"style":"compact"}}}'::jsonb))
 where id = :c_jd;
select pg_temp.assert(pg_temp.rowlist(app.resolve_template(:c_jd)) = 'today,zakat_reminder,events'
                      and app.resolve_template(:c_jd) -> 'widgets' = '{"today":{"variant":"full"},"prayer_times":{"style":"compact"}}'::jsonb,
  'E · an unknown row id and an unknown widget are kept; widgets merge by name');

-- An invalid layer is ignored, never an error: the answer is the same as with no override at all.
do $$
declare t text;
begin
  foreach t in array array[
    '{"theme":{"primary":"red"}}',
    '{"colour":"blue"}',
    '"just some text"',
    '{"tabs":[{"key":"about"}]}',
    '{"home":{"rows":"today"}}',
    '{"home":{"rows":["events"]},"theme":{"surface":"neon"}}',
    '{"version":2}',
    'null',
    '{}'
  ] loop
    update app.centers set rules = jsonb_build_object('home', jsonb_build_object('template', t::jsonb))
     where id = '10100000-0000-4000-8000-0000000000c8';
    perform pg_temp.assert(app.resolve_template('10100000-0000-4000-8000-0000000000c8')
                             = (select template from app.organization_categories where key = 'jain_center'),
      'E · an override that is not valid is ignored as a whole: ' || t);
  end loop;
end $$;
update app.centers set rules = jsonb_build_object('home', 'not an object') where id = :c_jd;
select pg_temp.assert(app.resolve_template(:c_jd) = (:'v_jsh'::jsonb),
  'E · a home setting that is not an object does not break the read');

-- A path template that is not valid is ignored too; JSH falls back to the category's template.
update app.category_paths set template = '{"theme":{"surface":"neon"}}'::jsonb
 where category_key = 'jain_center' and key = 'shwetambar_murtipujak';
select pg_temp.assert(app.resolve_template(:jsh) = (:'v_jsh'::jsonb),
  'E · an invalid path template is ignored: JSH is back to the legacy layout');

-- ══ F. Nothing set ═════════════════════════════════════════════════════════
update app.organization_categories set template = null where key = 'nonprofit_secular';
select pg_temp.assert(app.resolve_template(:c_npo) is null
                      and app.category_profile(:c_npo) ? 'template'
                      and jsonb_typeof(app.category_profile(:c_npo) -> 'template') = 'null'
                      and jsonb_typeof(app.member_experience(:c_npo) -> 'template') = 'null',
  'F · with nothing set the answer is null, and both reads still carry the key');
update app.organization_categories set template = '{"theme":{"primary":"nope"}}'::jsonb where key = 'nonprofit_secular';
select pg_temp.assert(app.resolve_template(:c_npo) is null,
  'F · an invalid category template is ignored too');
update app.organization_categories set template = '{"home":{"rows":["events"]}}'::jsonb where key = 'faith_other';
select pg_temp.assert(pg_temp.rowlist(app.resolve_template(:c_chr)) = 'events'
                      and app.resolve_template(:c_chr) -> 'theme' = '{"surface":"warm","motif":"cross"}'::jsonb,
  'F · an experience follows its parent''s template when the parent''s changes, and keeps its own overlay on top');

-- ══ G. Who may call what ═══════════════════════════════════════════════════
select pg_temp.assert(has_function_privilege('anon', 'app.category_profile(uuid)', 'execute')
                      and has_function_privilege('anon', 'app.member_experience(uuid, text)', 'execute')
                      and has_function_privilege('anon', 'app.resolve_template(uuid)', 'execute')
                      and has_function_privilege('authenticated', 'app.resolve_template(uuid)', 'execute')
                      and has_function_privilege('service_role', 'app.category_profile(uuid)', 'execute')
                      and has_function_privilege('service_role', 'app.member_experience(uuid, text)', 'execute'),
  'G · guests and signed-in people can still call the reads');
select pg_temp.assert(not has_function_privilege('anon', 'app.template_merge(jsonb, jsonb)', 'execute')
                      and not has_function_privilege('authenticated', 'app.template_merge(jsonb, jsonb)', 'execute')
                      and not has_function_privilege('anon', 'app.template_problems(jsonb)', 'execute')
                      and has_function_privilege('authenticated', 'app.template_problems(jsonb)', 'execute'),
  'G · the merge is internal; the shape check is for signed-in callers only');
select pg_temp.assert((select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'app' and p.proname in ('resolve_template', 'category_profile', 'member_experience'))
                      and (select bool_and(array_to_string(p.proconfig, ',') like '%search_path=app, public, extensions%')
                             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'app' and p.proname in ('template_problems', 'template_merge')),
  'G · the reads are security definer, and all five functions pin the search path');

rollback;
