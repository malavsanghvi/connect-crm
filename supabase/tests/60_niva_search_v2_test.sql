-- 0573: Niva's search v2. A hyphenated question still matches any word, quoted or not; search operators narrow the
-- search without making every word required; the glossary, the prefix and the word as written catch synonyms and
-- spellings; the community's own name matches nothing (but still brings in its glossary words); the page title of an imported
-- section no longer lifts every section of the page; equal scores come back in a fixed order; a long source comes
-- back with the part that matches (or its first 4000 characters when only the heading matched); shared rows follow the community's tradition; sources waiting for approval
-- only when asked for; Guide sections and FAQ only when the community turned them on (and JSH has them on), and the
-- setting moves rules.version on; the worker's 3-argument call is unchanged.
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
grant connect_worker to postgres;

-- The worker's 3-argument call (statuses null) or the 4-argument search with the statuses given.
create or replace function pg_temp.search(p_center uuid, q text, p_statuses text[] default null, p_limit int default 6)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  if p_statuses is null then
    r := app.niva_worker_search_sources(p_center, q, p_limit);
  else
    r := app.niva_worker_search_sources(p_center, q, p_limit, p_statuses);
  end if;
  reset role;
  return r;
end $$;
-- The ids that came back, in order (optionally only those LIKE a pattern, so rows other tests leave in the
-- shared pack cannot change what is compared).
create or replace function pg_temp.ids(r jsonb, p_like text default '%') returns text[] language sql as $$
  select coalesce(array_agg(e->>'id' order by n), '{}') from jsonb_array_elements(r) with ordinality as x(e, n)
   where e->>'id' like p_like
$$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
\set c '''60000000-0000-4000-8000-0000000000c1'''
\set c2 '''60000000-0000-4000-8000-0000000000c2'''
\set c3 '''60000000-0000-4000-8000-0000000000c3'''
\set c4 '''60000000-0000-4000-8000-0000000000c4'''
\set jsh '''00000000-0000-4000-8000-000000000001'''
\set admin '''60000000-0000-4000-8000-000000000001'''
\set member '''60000000-0000-4000-8000-000000000002'''
insert into auth.users (id, email) values (:admin, 'admin60@example.com'), (:member, 'member60@example.com');
insert into app.centers (id, slug, name, short_name, state_region, status, rules) values
  (:c, 'orbit60', 'Sixty Search Sangh', 'SSS', 'TX', 'active', '{"lunch":{"slot_minutes":15},"version":4}'),
  (:c2, 'orbit60b', 'Other Sixty Sangh', 'OSS', 'TX', 'active', '{}'),
  (:c3, 'orbit60c', 'Long Text Sangh', 'LTS', 'TX', 'active', '{}'),
  (:c4, 'orbit60d', 'Sixty Jain Temple', 'SJT', 'TX', 'active', '{}');
insert into app.role_grants (center_id, user_id, role_key) values (:c, :admin, 'center_admin');
insert into app.people (id, center_id, first_name, last_name) values ('60000000-0000-4000-8000-0000000000a9', :c, 'Mira', 'Shah');
insert into app.center_users (center_id, user_id, person_id) values (:c, :member, '60000000-0000-4000-8000-0000000000a9');

insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('60000000-0000-4000-8000-000000000a01', :c, 'niva_source', 'pathshala', 'Pathshala for everyone',
   'Pathshala classes on Sunday mornings welcome every child, whether or not the family is a member yet.', 'published'),
  ('60000000-0000-4000-8000-000000000a02', :c, 'niva_source', 'donations', 'Donations and receipts',
   'Every donation is tax deductible in the US, and a receipt is emailed the same day.', 'published'),
  ('60000000-0000-4000-8000-000000000a03', :c, 'niva_source', 'derasar', 'Derasar timings',
   'Daily 7:30 AM to 6:00 PM. Aarti at 12:30 PM and 4:30 PM.', 'published'),
  ('60000000-0000-4000-8000-000000000a04', :c, 'niva_source', 'paryushan', 'Paryushan parva',
   'Paryushan is observed for eight days each year and ends with Samvatsari.', 'published'),
  ('60000000-0000-4000-8000-000000000a05', :c, 'niva_source', 'mahaparva', 'Mahaparva schedule',
   'Pratikraman during Paryushana starts at 6:30 PM in the main hall.', 'published'),
  ('60000000-0000-4000-8000-000000000a06', :c, 'niva_source', 'welcome', 'Welcome',
   'Sixty Search Sangh welcomes every family. SSS meets in Texas.', 'published'),
  ('60000000-0000-4000-8000-000000000a07', :c, 'niva_source', 'bhojanshala', 'Bhojanshala helpers',
   'The bhojanshala needs helpers every weekend.', 'in_review'),
  ('60000000-0000-4000-8000-000000000a08', :c, 'niva_source', 'bhojanshala-draft', 'Bhojanshala draft',
   'A draft about the bhojanshala.', 'draft'),
  ('60000000-0000-4000-8000-000000000a99', :c, 'sutra', 'a-sutra', 'A sutra', 'Namo arihantanam.', 'draft'),
  ('60000000-0000-4000-8000-000000000c2a', :c2, 'niva_source', 'other-bhojanshala', 'Bhojanshala at the other community',
   'The other community''s bhojanshala.', 'published');

-- Three sources that score the same; inserted out of id order. The third is touched later, so it is newer.
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('60000000-0000-4000-8000-000000000a72', :c, 'niva_source', 'shoes-2', 'Shoe rack', 'Leave your shoes on the rack by the door.', 'published'),
  ('60000000-0000-4000-8000-000000000a71', :c, 'niva_source', 'shoes-1', 'Shoe rack', 'Leave your shoes on the rack by the door.', 'published'),
  ('60000000-0000-4000-8000-000000000a73', :c, 'niva_source', 'shoes-3', 'Shoe rack', 'Leave your shoes on the rack by the door.', 'published');
update app.content_items set updated_at = now() + interval '1 minute' where id = '60000000-0000-4000-8000-000000000a73';

-- Ten imported sections of one page ("New Campus FAQs: <heading>", as worker/src/web/page_text.ts names them).
insert into app.content_items (id, center_id, kind, slug, title, body_md, status, metadata)
select ('60000000-0000-4000-8000-000000000b' || lpad(n::text, 2, '0'))::uuid, :c, 'niva_source', 'web-campus-' || lpad(n::text, 2, '0'),
       'New Campus FAQs: ' || h.heading, h.body, 'published',
       jsonb_build_object('imported', true, 'source_url', 'https://example.org/new-campus', 'page_title', 'New Campus FAQs', 'section', n)
  from (values
    (1, 'Timeline', 'The campus opens in stages over two years.'),
    (2, 'Cost', 'The campus budget is shared with the trustees each quarter.'),
    (3, 'Design', 'The campus design keeps the murtis facing east.'),
    (4, 'Rooms', 'The campus has thirteen classrooms.'),
    (5, 'Kitchen', 'The campus kitchen serves two hundred people.'),
    (6, 'Library', 'The campus library lends books for a month.'),
    (7, 'Getting there', 'Valet parking is offered on festival days.'),
    (8, 'Garden', 'The campus garden is cared for by volunteers.'),
    (9, 'Office', 'The campus office is staffed on weekends.'),
    (10, 'Questions', 'Write to the campus committee with anything else.')
  ) as h(n, heading, body);

-- FAQ items and Guide sections: offered only once the community turns them on.
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('60000000-0000-4000-8000-000000000f01', :c, 'faq', 'guests', 'Can I bring guests to the lunch?',
   'Guests are welcome at the Sunday lunch; please register them at the desk.', 'published'),
  ('60000000-0000-4000-8000-000000000f02', :c, 'faq', 'guest-pass', 'Guest passes', 'Guests need a pass (still a draft).', 'draft');
insert into app.guide_sections (id, center_id, slug, title, body_md, public) values
  ('60000000-0000-4000-8000-000000000d01', :c, 'parking', 'Parking and directions', 'Park in the north lot; the south lot is kept for seniors.', true),
  ('60000000-0000-4000-8000-000000000d02', :c, 'committee', 'Committee parking', 'Committee members park behind the hall.', false),
  ('60000000-0000-4000-8000-000000000d03', :c2, 'parking', 'Parking at the other community', 'Park anywhere on the street.', true);

-- Shared rows (the platform pack): one for every tradition, and one each for two traditions.
insert into app.content_items (id, center_id, tradition, kind, slug, title, body_md, status) values
  ('60000000-0000-4000-8000-000000000e01', null, null, 'niva_source', 'ekasana-60-all', 'Ekasana (every tradition)',
   'Ekasana means eating once a day, seated.', 'published'),
  ('60000000-0000-4000-8000-000000000e02', null, 'digambar', 'niva_source', 'ekasana-60-digambar', 'Ekasana (Digambar)',
   'Ekasana as the Digambar tradition keeps it.', 'published'),
  ('60000000-0000-4000-8000-000000000e03', null, 'shvetambar_murtipujak', 'niva_source', 'ekasana-60-shvetambar', 'Ekasana (Shvetambar)',
   'Ekasana as the Shvetambar tradition keeps it.', 'published');

-- A community named for its temple: its name words match nothing, but "temple" still brings in "derasar".
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('60000000-0000-4000-8000-000000000c41', :c4, 'niva_source', 'etiquette', 'Derasar etiquette',
   'Please remove leather items before entering the derasar.', 'published'),
  ('60000000-0000-4000-8000-000000000c42', :c4, 'niva_source', 'welcome', 'Welcome',
   'Sixty Jain Temple welcomes every family.', 'published');

-- A long source whose answer sits past character 4000, and ten sources that together are far over the budget.
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('60000000-0000-4000-8000-000000000101', :c3, 'niva_source', 'long', 'Hall and kitchen',
   left(left(repeat('Members gather in the hall for the evening programme. ', 90), 4500)
        || 'The kitchen closes at 9 PM on Fridays. ' || repeat('Members gather in the hall for the evening programme. ', 40), 6000),
   'published');
insert into app.content_items (id, center_id, kind, slug, title, body_md, status)
select ('60000000-0000-4000-8000-0000000002' || lpad(n::text, 2, '0'))::uuid, :c3, 'niva_source', 'swadhyay-' || n, 'Swadhyay notes ' || n,
       'Swadhyay meets on Wednesdays. ' || left(repeat('Members gather in the hall for the evening programme. ', 80), 3870), 'published'
  from generate_series(1, 10) n;
-- Two more long sources. One is matched only by its heading (its text says "sign up", not "register"), the other
-- only in its first 1500 characters; both come back as their first 4000 characters, not 1500 plus a repeat.
insert into app.content_items (id, center_id, kind, slug, title, body_md, status, metadata) values
  ('60000000-0000-4000-8000-000000000301', :c3, 'niva_source', 'web-pathshala-registration', 'Pathshala FAQs: Registration',
   left(left(repeat('Members gather in the hall for the evening programme. ', 60), 3000)
        || 'Families sign up at the Pathshala desk on the first Sunday. ' || repeat('Members gather in the hall for the evening programme. ', 60), 6000),
   'published', '{"imported":true,"page_title":"Pathshala FAQs","source_url":"https://example.org/pathshala"}'),
  ('60000000-0000-4000-8000-000000000302', :c3, 'niva_source', 'helpers', 'Helpers',
   left('Volunteers check in at the side door. ' || repeat('Members gather in the hall for the evening programme. ', 120), 6000),
   'published', '{}');

-- ── Why 0541 missed the hyphenated question ─────────────────────────────────
select pg_temp.assert(position('<->' in websearch_to_tsquery('english', 'Can non-members attend pathshala?')::text) > 0,
  'websearch_to_tsquery turns "non-members" into a phrase (0541 then kept the AND of every word)');

begin;
-- ── Any word, even with a hyphen ───────────────────────────────────────────
select pg_temp.assert(pg_temp.search(:c, 'Can non-members attend pathshala?') @> '[{"id":"60000000-0000-4000-8000-000000000a01"}]',
  '"Can non-members attend pathshala?" finds the Pathshala source although it never says "attend" or "non-members"');
select pg_temp.assert(pg_temp.search(:c, 'is it tax-deductible?') @> '[{"id":"60000000-0000-4000-8000-000000000a02"}]',
  '"is it tax-deductible?" finds the source that says "tax deductible"');
select pg_temp.assert(pg_temp.search(:c, 'Is my donation tax-deductible, and do I get a receipt?')->0->>'id' = '60000000-0000-4000-8000-000000000a02',
  'a longer hyphenated question puts the source that answers it first');

-- ── Synonyms, spellings and prefixes ─────────────────────────────────────────
select pg_temp.assert(pg_temp.search(:c, 'When does the temple open?') @> '[{"title":"Derasar timings"}]',
  '"When does the temple open?" finds "Derasar timings" (glossary: temple = derasar, open = timings)');
select pg_temp.assert(pg_temp.search(:c, 'Paryushana') @> '[{"title":"Paryushan parva"}]', '"Paryushana" finds "Paryushan"');
select pg_temp.assert(pg_temp.search(:c, 'Paryushan') @> '[{"title":"Mahaparva schedule"}]', '"Paryushan" finds "Paryushana" (prefix)');
select pg_temp.assert(pg_temp.search(:c, 'Is there Sunday school?') @> '[{"title":"Pathshala for everyone"}]',
  '"Sunday school" finds Pathshala');
select pg_temp.assert(jsonb_typeof(pg_temp.search(:c, 'શું પાઠશાળા છે?')) = 'array', 'a question in Gujarati script does not fail');

-- ── The community's own name, filler words, operators ─────────────────────────
select pg_temp.assert(pg_temp.search(:c, 'Sixty Search Sangh') = '[]', 'the community''s name alone matches nothing, although a source names it');
select pg_temp.assert(pg_temp.search(:c, 'SSS') = '[]', 'the short name alone matches nothing');
select pg_temp.assert(pg_temp.search(:c, 'what is the') = '[]', 'filler words alone match nothing');
select pg_temp.assert(pg_temp.search(:c, '-kitchen') = '[]', 'an exclusion alone matches nothing');
select pg_temp.assert(pg_temp.search(:c, '"tax deductible"') @> '[{"id":"60000000-0000-4000-8000-000000000a02"}]', 'a quoted phrase still works');

-- ── Quotes and dashes narrow the search; they do not make every word required ──
select pg_temp.assert(pg_temp.search(:c, 'Can "non-members" attend pathshala?') @> '[{"id":"60000000-0000-4000-8000-000000000a01"}]',
  'with "non-members" in quotes the question still finds the Pathshala source (one quoted word is just the word)');
select pg_temp.assert(pg_temp.search(:c, 'When is the "temple" open?') @> '[{"title":"Derasar timings"}]',
  'a quoted word still brings in its glossary group');
select pg_temp.assert(pg_temp.search(:c, 'When is "derasar open?') @> '[{"title":"Derasar timings"}]', 'a quote without its pair is ignored');
select pg_temp.assert(pg_temp.search(:c, 'Is a "tax deductible" receipt emailed quickly?') @> '[{"id":"60000000-0000-4000-8000-000000000a02"}]',
  'a quoted phrase with other words: the phrase must appear, the other words need not all be there');
select pg_temp.assert(not (pg_temp.search(:c, '"tax deductible" pathshala') @> '[{"id":"60000000-0000-4000-8000-000000000a01"}]'),
  'a source without the quoted phrase is not offered');
select pg_temp.assert(pg_temp.search(:c, 'Is the derasar open Mon -Fri?') @> '[{"title":"Derasar timings"}]',
  'an excluded word does not make the rest of the question required');
select pg_temp.assert(not (pg_temp.search(:c, 'derasar timings -aarti') @> '[{"title":"Derasar timings"}]'),
  'an excluded word still removes the sources that have it');
select pg_temp.assert(position('!' in app.niva_search_tsquery(:c, 'Is the office open 9am -5pm?')::text) = 0
                      and position('!' in app.niva_search_tsquery(:c, 'Is the hall free - or booked?')::text) = 0,
  'a dash before a number, or on its own, excludes nothing');

-- ── A community named for its temple ─────────────────────────────────────────
select pg_temp.assert(pg_temp.ids(pg_temp.search(:c4, 'Where is the temple?'), '60000000-%') = array['60000000-0000-4000-8000-000000000c41'],
  'at "Sixty Jain Temple", "Where is the temple?" finds the Derasar source and not the one that only names the community');
select pg_temp.assert(not (pg_temp.search(:c4, 'Sixty Jain Temple') @> '[{"id":"60000000-0000-4000-8000-000000000c42"}]'),
  'its name alone does not bring back a source just for naming the community');

-- ── Ranking: page title, ties ────────────────────────────────────────────────
select (pg_temp.search(:c, 'New campus FAQs: is there valet parking?', null, 20)) as campus \gset
select pg_temp.assert(cardinality(pg_temp.ids(:'campus'::jsonb, '60000000-0000-4000-8000-000000000b%')) = 10
                      and (pg_temp.ids(:'campus'::jsonb, '60000000-0000-4000-8000-000000000b%'))[1] = '60000000-0000-4000-8000-000000000b07',
  'of ten sections sharing a page title, the one that holds the answer ranks first');
select pg_temp.assert((select bool_and((e->>'rank')::real < (select (f->>'rank')::real from jsonb_array_elements(:'campus'::jsonb) f
                                                             where f->>'id' = '60000000-0000-4000-8000-000000000b07'))
                         from jsonb_array_elements(:'campus'::jsonb) e
                        where e->>'id' like '60000000-0000-4000-8000-000000000b%' and e->>'id' <> '60000000-0000-4000-8000-000000000b07'),
  'it scores strictly above every other section of the page');
select pg_temp.assert(pg_temp.search(:c, 'New campus FAQs: is there valet parking?') @> '[{"id":"60000000-0000-4000-8000-000000000b07"}]',
  'and it is within the six the worker asks for');
select pg_temp.assert(pg_temp.ids(pg_temp.search(:c, 'Where do shoes go?'), '60000000-%')
                        = array['60000000-0000-4000-8000-000000000a73', '60000000-0000-4000-8000-000000000a71', '60000000-0000-4000-8000-000000000a72'],
  'equal scores: the most recently updated first, then by id');
select pg_temp.assert(pg_temp.ids(pg_temp.search(:c, 'Where do shoes go?')) = pg_temp.ids(pg_temp.search(:c, 'Where do shoes go?')),
  'the order is the same every time');

-- ── What a result carries ───────────────────────────────────────────────────
select pg_temp.assert((select e->>'kind' = 'niva_source' and e->>'source_url' = 'https://example.org/new-campus'
                              and (e->>'updated_at')::timestamptz is not null and e->>'title' = 'New Campus FAQs: Getting there'
                         from jsonb_array_elements(:'campus'::jsonb) e where e->>'id' = '60000000-0000-4000-8000-000000000b07'),
  'each result carries its kind, page address and last update');

-- ── Long sources and the budget ─────────────────────────────────────────────
select coalesce((select e->>'body_md' from jsonb_array_elements(pg_temp.search(:c3, 'When does the kitchen close on Friday?')) e
                  where e->>'id' = '60000000-0000-4000-8000-000000000101'), '(not found)') as long_body \gset
select pg_temp.assert((select position('kitchen closes' in body_md) > 4000 and char_length(body_md) = 6000
                         from app.content_items where id = '60000000-0000-4000-8000-000000000101'),
  'the long source is 6000 characters and its answer sits past character 4000');
select pg_temp.assert(:'long_body' like '%The kitchen closes at 9 PM on Fridays%',
  'a long source comes back with an excerpt that holds the answer');
select pg_temp.assert(char_length(:'long_body') < 6000 and :'long_body' like 'Members gather in the hall%',
  'it is the start of the text plus the excerpt, not the whole text');
select pg_temp.assert(position('<b>' in :'long_body') = 0, 'the excerpt carries no highlighting marks');
select coalesce((select e->>'body_md' from jsonb_array_elements(pg_temp.search(:c3, 'How do I register?')) e
                  where e->>'id' = '60000000-0000-4000-8000-000000000301'), '(not found)') as reg_body \gset
select pg_temp.assert(:'reg_body' = (select left(body_md, 4000) from app.content_items where id = '60000000-0000-4000-8000-000000000301'),
  'a long source matched only by its heading comes back as its first 4000 characters, nothing repeated');
select pg_temp.assert(:'reg_body' like '%Families sign up at the Pathshala desk%', 'so an answer past character 1500 still reaches the model');
select coalesce((select e->>'body_md' from jsonb_array_elements(pg_temp.search(:c3, 'Where do volunteers check in?')) e
                  where e->>'id' = '60000000-0000-4000-8000-000000000302'), '(not found)') as help_body \gset
select pg_temp.assert(:'help_body' = (select left(body_md, 4000) from app.content_items where id = '60000000-0000-4000-8000-000000000302'),
  'a long source matched only in its first 1500 characters comes back as its first 4000 characters');
select pg_temp.search(:c3, 'swadhyay', null, 10) as many \gset
select pg_temp.assert(jsonb_array_length(:'many'::jsonb) between 1 and 9, 'results stop before the character budget is used up (fewer than the 10 asked for)');
select pg_temp.assert((select sum(char_length(e->>'title') + char_length(e->>'body_md')) from jsonb_array_elements(:'many'::jsonb) e) <= 24000,
  'the results together stay within 24000 characters');
commit;

-- ── Statuses ─────────────────────────────────────────────────────────────────
begin;
select pg_temp.assert(not (pg_temp.search(:c, 'bhojanshala helpers') @> '[{"id":"60000000-0000-4000-8000-000000000a07"}]'),
  'a source waiting for approval is not offered to a member''s question');
select pg_temp.assert(not (pg_temp.search(:c, 'bhojanshala helpers', array['published']) @> '[{"id":"60000000-0000-4000-8000-000000000a07"}]'),
  'nor with statuses {published}');
select pg_temp.assert(pg_temp.search(:c, 'bhojanshala helpers', array['published', 'in_review']) @> '[{"id":"60000000-0000-4000-8000-000000000a07"}]',
  'it is offered when the staff test asks for {published,in_review}');
select pg_temp.assert(not (pg_temp.search(:c, 'bhojanshala helpers', array['published', 'in_review'])::text like '%000000000a08%'),
  'a draft is never offered');
select pg_temp.assert(not (pg_temp.search(:c, 'bhojanshala helpers', array['published', 'in_review'])::text like '%000000000c2a%'),
  'another community''s source is never offered');
select pg_temp.assert(not (pg_temp.search(:c, 'bhojanshala helpers', '{}'::text[]) @> '[{"id":"60000000-0000-4000-8000-000000000a07"}]'),
  'an empty statuses list means published only');
select pg_temp.assert_raises($$select pg_temp.search('60000000-0000-4000-8000-0000000000c1'::uuid, 'bhojanshala', array['draft'])$$,
  'only from published', 'any other status is refused');
commit;

-- ── Shared rows follow the community's tradition ──────────────────────────────
begin;
select pg_temp.search(:c, 'What is ekasana?') as eka \gset
select pg_temp.assert(:'eka'::jsonb @> '[{"id":"60000000-0000-4000-8000-000000000e01"}]', 'a shared row with no tradition is offered');
select pg_temp.assert(:'eka'::jsonb @> '[{"id":"60000000-0000-4000-8000-000000000e03"}]', 'a shared row of the community''s own tradition is offered');
select pg_temp.assert(not (:'eka'::jsonb @> '[{"id":"60000000-0000-4000-8000-000000000e02"}]'), 'a shared row of another tradition is not');
commit;

-- ── Guide sections and FAQ: off by default ──────────────────────────────────
begin;
select pg_temp.assert(not (pg_temp.search(:c, 'Where should I park?')::text like '%guide_section:%'), 'Guide sections are not offered by default');
select pg_temp.assert(not (pg_temp.search(:c, 'Can guests come to the lunch?')::text like '%000000000f01%'), 'FAQ items are not offered by default');
commit;

begin;
select pg_temp.sign_in(:member);
select pg_temp.assert_raises($$select app.niva_set_answer_from('60000000-0000-4000-8000-0000000000c1'::uuid, array['guide'])$$,
  'content.manage', 'a member cannot choose what Niva answers from');
commit;
begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert_raises($$select app.niva_set_answer_from('60000000-0000-4000-8000-0000000000c2'::uuid, array['guide'])$$,
  'content.manage', 'an admin of another community cannot choose for this one');
select pg_temp.assert_raises($$select app.niva_set_answer_from('60000000-0000-4000-8000-0000000000c1'::uuid, array['events'])$$,
  'is not one of them', 'an unknown kind is refused, naming it');
select pg_temp.assert(app.niva_set_answer_from(:c, array['guide']) = array['niva_source', 'guide'], 'staff turn on Guide sections');
commit;
select pg_temp.assert((select rules #> '{niva,answer_from}' = '["niva_source","guide"]' and rules #> '{lunch,slot_minutes}' = '15'
                         from app.centers where id = :c),
  'the choice is stored in rules.niva.answer_from and the community''s other rules are kept');
select pg_temp.assert((select rules -> 'version' = '5' from app.centers where id = :c),
  'the rules version moves on by one, so a rules form opened before the change cannot save over it');

begin;
select pg_temp.search(:c, 'Where should I park?') as park \gset
select pg_temp.assert(:'park'::jsonb @> '[{"id":"guide_section:60000000-0000-4000-8000-000000000d01","kind":"guide_section","title":"Parking and directions"}]',
  'a public Guide section is offered, with a guide_section: id');
select pg_temp.assert(not (:'park'::jsonb::text like '%000000000d02%'), 'a Guide section that is not public is never offered');
select pg_temp.assert(not (:'park'::jsonb::text like '%000000000d03%'), 'another community''s Guide section is never offered');
select pg_temp.assert(not (pg_temp.search(:c, 'Can guests come to the lunch?')::text like '%000000000f01%'), 'FAQ stays off until it is chosen too');
commit;

begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert(app.niva_set_answer_from(:c, array['faq', ' Guide ']) = array['niva_source', 'guide', 'faq'], 'staff turn on FAQ as well');
commit;
begin;
select pg_temp.assert(pg_temp.search(:c, 'Can guests come to the lunch?') @> '[{"id":"60000000-0000-4000-8000-000000000f01","kind":"faq"}]',
  'a published FAQ item is offered');
select pg_temp.assert(not (pg_temp.search(:c, 'Do guests need a pass?')::text like '%000000000f02%'), 'a draft FAQ item is never offered');
commit;

begin;
select pg_temp.sign_in(:admin);
select pg_temp.assert(app.niva_set_answer_from(:c, '{}'::text[]) = array['niva_source'], 'an empty choice goes back to Niva sources only');
commit;
begin;
select pg_temp.assert(not (pg_temp.search(:c, 'Where should I park?')::text like '%guide_section:%'), 'and Guide sections are no longer offered');
commit;

-- ── JSH: the owner said yes to its Guide sections and FAQ ─────────────────────
select id as jsh_timings from app.guide_sections where center_id = :jsh and slug = 'timings' \gset
select id as jsh_membership from app.guide_sections where center_id = :jsh and slug = 'membership' \gset
begin;
create temp table niva60_jsh_before as select rules -> 'version' as v from app.centers where id = :jsh;
select pg_temp.assert(app.seed_jsh_niva_answer_from() ? 'updated', 'the JSH setting runs once JSH exists');
select pg_temp.assert((select rules #> '{niva,answer_from}' = '["niva_source","guide","faq"]' from app.centers where id = :jsh),
  'JSH answers from its Guide sections and FAQ');
select pg_temp.assert((select c.rules -> 'version' is not distinct from
                               case when jsonb_typeof(b.v) = 'number' and b.v #>> '{}' ~ '^[0-9]+$'
                                    then to_jsonb((b.v #>> '{}')::bigint + 1) else b.v end
                          from app.centers c cross join niva60_jsh_before b where c.id = :jsh),
  'JSH''s rules version moves on by one when it has one, and none is made up when it has not');
select pg_temp.assert(app.seed_jsh_niva_answer_from() = '{"updated": false}', 'running it again changes nothing');
select pg_temp.assert(pg_temp.ids(pg_temp.search(:jsh, 'When does the temple open?')) @> array['guide_section:' || :'jsh_timings'],
  'JSH: "When does the temple open?" finds the Timings and visiting guide section');
select pg_temp.assert(pg_temp.ids(pg_temp.search(:jsh, 'Can non-members attend pathshala?')) @> array['guide_section:' || :'jsh_membership'],
  'JSH: "Can non-members attend pathshala?" finds the Membership guide section');
rollback;
begin;
update app.centers set rules = jsonb_set(rules, '{niva}', '{"answer_from":["niva_source"]}') where id = :jsh;
select pg_temp.assert(app.seed_jsh_niva_answer_from() = '{"updated": false}', 'a choice JSH already made is never undone');
rollback;

-- ── The stored vector ───────────────────────────────────────────────────────
select pg_temp.assert((select ts_filter(niva_tsv, '{a}') @@ to_tsquery('english', 'getting')
                              and not (ts_filter(niva_tsv, '{a}') @@ to_tsquery('english', 'campus'))
                              and ts_filter(niva_tsv, '{c}') @@ to_tsquery('english', 'campus')
                              and ts_filter(niva_tsv, '{b}') @@ to_tsquery('english', 'valet')
                         from app.content_items where id = '60000000-0000-4000-8000-000000000b07'),
  'an imported section weighs its heading (A) above its page title (C); the text is B');
select pg_temp.assert((select niva_tsv is null from app.content_items where id = '60000000-0000-4000-8000-000000000a99'),
  'other kinds of content carry no search vector');
select pg_temp.assert((select niva_tsv is not null from app.content_items where id = '60000000-0000-4000-8000-000000000f01'),
  'FAQ items carry one');
select pg_temp.assert(exists (select 1 from pg_indexes where schemaname = 'app' and indexname = 'content_items_niva_tsv_idx'),
  'the search vector is indexed');
update app.content_items set body_md = 'Daily 7:30 AM to 6:00 PM. Aarti at 12:30 PM, 4:30 PM and 7:00 PM.' where id = '60000000-0000-4000-8000-000000000a03';
select pg_temp.assert((select count(*) > 0 and bool_and(not coalesce(after ? 'niva_tsv', false)) and bool_and(not coalesce(before ? 'niva_tsv', false))
                         from app.audit_log where record_table = 'content_items' and record_id = '60000000-0000-4000-8000-000000000a03'),
  'the audit log keeps the source but not its derived search vector');

-- ── The worker's call is unchanged ──────────────────────────────────────────
begin;
set local role connect_worker;
-- Exactly what worker/src/handlers/niva.answer.ts sends (untyped parameters).
prepare niva60_worker_call as select app.niva_worker_search_sources($1, $2, 6) as r;
execute niva60_worker_call('60000000-0000-4000-8000-0000000000c1', 'When does the temple open?') \gset w_
deallocate niva60_worker_call;
select app.niva_worker_search_sources('60000000-0000-4000-8000-0000000000c1', 'derasar') as two \gset
commit;
select pg_temp.assert(:'w_r'::jsonb @> '[{"title":"Derasar timings"}]', 'the worker''s 3-argument call still works');
select pg_temp.assert(:'two'::jsonb @> '[{"title":"Derasar timings"}]', 'the limit can still be left out');
select pg_temp.assert(has_function_privilege('connect_worker', 'app.niva_worker_search_sources(uuid,text,int)', 'execute')
                      and has_function_privilege('connect_worker', 'app.niva_worker_search_sources(uuid,text,int,text[])', 'execute'),
  'connect_worker can run both forms');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_worker_search_sources(uuid,text,int,text[])', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_worker_search_sources(uuid,text,int)', 'execute'),
  'signed-in users cannot run the search');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.niva_search_tsquery(uuid,text)', 'execute')
                      and not has_function_privilege('authenticated', 'app.niva_glossary()', 'execute'),
  'nor its helpers');
select pg_temp.assert(has_function_privilege('authenticated', 'app.niva_set_answer_from(uuid,text[])', 'execute')
                      and not has_function_privilege('anon', 'app.niva_set_answer_from(uuid,text[])', 'execute'),
  'the answer-from setting is for signed-in staff (it checks content.manage)');
select pg_temp.assert(not has_function_privilege('authenticated', 'app.seed_jsh_niva_answer_from()', 'execute'),
  'the JSH one-off is not callable by users');
select pg_temp.assert((select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) as g(setting)
                                                                 where g.setting ~ '^search_path=app, *public, *extensions$'))
                         from pg_proc p where p.oid in ('app.niva_worker_search_sources(uuid,text,int)'::regprocedure,
                                                       'app.niva_worker_search_sources(uuid,text,int,text[])'::regprocedure,
                                                       'app.niva_set_answer_from(uuid,text[])'::regprocedure,
                                                       'app.seed_jsh_niva_answer_from()'::regprocedure)),
  'the security definer functions pin search_path = app, public, extensions');
