-- 0541: Niva finds sources by ANY word of the question, ranked; operators keep their meaning.
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
grant connect_worker to postgres;

\set c '''47000000-0000-4000-8000-0000000000c1'''
\set c2 '''47000000-0000-4000-8000-0000000000c2'''
insert into app.centers (id, slug, name, short_name, state_region, status) values
  (:c, 'orbit47', 'Orbit Search Community', 'OSC', 'TX', 'active'),
  (:c2, 'orbit47b', 'Other Search Community', 'OSC2', 'TX', 'active');
insert into app.content_items (id, center_id, kind, slug, title, body_md, status) values
  ('47000000-0000-4000-8000-00000000000a', :c, 'niva_source', 'why', 'Why JSH needs a new facility', 'The current building was designed for 250 members. The community has grown tenfold, so a new facility is essential.', 'published'),
  ('47000000-0000-4000-8000-00000000000b', :c, 'niva_source', 'rooms', 'Facility features', 'The new facility has 13 pathshala rooms, a main hall and a large kitchen.', 'published'),
  ('47000000-0000-4000-8000-00000000000c', :c, 'niva_source', 'tax', 'Donations and tax', 'Donations toward the new center are tax deductible. Ask your CPA about eligibility.', 'published'),
  ('47000000-0000-4000-8000-00000000000d', :c, 'niva_source', 'draft', 'Unapproved draft about relocation', 'A relocation draft nobody has approved yet.', 'draft'),
  ('47000000-0000-4000-8000-00000000000e', :c2, 'niva_source', 'other', 'Other community relocation', 'A different community talks about relocation and a new facility too.', 'published');

create or replace function pg_temp.search(q text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role connect_worker;
  r := app.niva_worker_search_sources('47000000-0000-4000-8000-0000000000c1'::uuid, q, 6);
  reset role;
  return r;
end $$;

begin;
select pg_temp.assert(pg_temp.search('why do we need to move to a new building') @> '[{"title":"Why JSH needs a new facility"}]'::jsonb,
  'a question in sentences finds the source that answers it even though "move" and "building" are not all in it');
select pg_temp.assert(pg_temp.search('how many pathshala rooms will there be') @> '[{"title":"Facility features"}]'::jsonb,
  'a "how many" question finds the source with the rooms');
select pg_temp.assert(pg_temp.search('is my donation tax deductible') @> '[{"title":"Donations and tax"}]'::jsonb, 'a keyword-style question still works');
select pg_temp.assert((pg_temp.search('new facility rooms kitchen')->0->>'title') = 'Facility features',
  'the source matching more of the words ranks first');
-- 0573: 'facility' is in two of the titles, so it no longer decides between them (the shorter source wins);
-- 'new' is in one title and in the text of all three.
select pg_temp.assert((pg_temp.search('new')->0->>'title') = 'Why JSH needs a new facility',
  'a word in the title outranks the same word once in the text');
select pg_temp.assert(pg_temp.search('quantum astrophysics blockchain') = '[]'::jsonb, 'an unrelated question matches nothing');
select pg_temp.assert(pg_temp.search('why is it being done to the') = '[]'::jsonb, 'a question made only of filler words matches nothing and does not fail');
select pg_temp.assert(pg_temp.search('') = '[]'::jsonb, 'an empty question matches nothing');
select pg_temp.assert(not (pg_temp.search('relocation facility')::text like '%nobody has approved%'), 'a draft is never offered');
select pg_temp.assert(not (pg_temp.search('relocation facility')::text like '%different community%'), 'another community''s source is never offered');
select pg_temp.assert(jsonb_array_length(pg_temp.search('new facility rooms kitchen tax donation members building')) <= 6, 'at most six sources are returned');
-- Operators keep their exact meaning.
select pg_temp.assert(pg_temp.search('"tax deductible"') @> '[{"title":"Donations and tax"}]'::jsonb, 'a quoted phrase finds the source with that phrase');
select pg_temp.assert(not (pg_temp.search('"deductible tax"')::text like '%Donations and tax%'), 'a quoted phrase in the wrong order does not match');
select pg_temp.assert(not (pg_temp.search('facility -kitchen')::text like '%Facility features%'), 'an excluded word removes the sources that have it');
commit;
