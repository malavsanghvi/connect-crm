-- 0566 / seed.sql: the JSH guide pages carry real line breaks, so the member app can read the timings table and the
-- first-steps checklist (connect-mobile src/features/guide.ts parseTimingsTable and splitSections split on "\n").
\set ON_ERROR_STOP 1
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

select pg_temp.assert(not exists (select 1 from app.guide_sections where strpos(body_md, '\n') > 0),
  'no guide page holds a literal backslash-n');

select pg_temp.assert((select body_md like E'| What | When |\n|---|---|\n| Derasar |%'
                         from app.guide_sections
                        where center_id = '00000000-0000-4000-8000-000000000001' and slug = 'timings'),
  'the timings page starts with a | What | When | table, one row per line');

select pg_temp.assert((select array_length(string_to_array(body_md, E'\n'), 1)
                         from app.guide_sections
                        where center_id = '00000000-0000-4000-8000-000000000001' and slug = 'first-steps') = 5,
  'the first-steps checklist has its five lines');

-- The repair itself: a page still holding the old text is mended, and running it again changes nothing.
begin;
update app.guide_sections set body_md = replace(body_md, E'\n', '\n')
 where center_id = '00000000-0000-4000-8000-000000000001' and slug = 'timings';
select pg_temp.assert((select strpos(body_md, '\n') > 0 from app.guide_sections
                        where center_id = '00000000-0000-4000-8000-000000000001' and slug = 'timings'),
  'set-up: the timings page holds the old literal text');
\ir ../migrations/0566_guide_seed_newlines.sql
\ir ../migrations/0566_guide_seed_newlines.sql
select pg_temp.assert((select body_md like E'| What | When |\n|---|---|\n%' and strpos(body_md, '\n') = 0
                         from app.guide_sections
                        where center_id = '00000000-0000-4000-8000-000000000001' and slug = 'timings'),
  '0566 mends the page and is safe to run twice');
rollback;
