-- 0651: the thirteen People commands are in the activity allowlist, each as a portal action with its command, with a plain
-- label; running the migration again changes nothing; the eight commands of 0625 are untouched.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

select pg_temp.assert((select count(*) = 13 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action'
                          and c.commandable_key in ('people.find_household', 'people.household_summary', 'people.pending_reviews', 'people.suggest_duplicates',
                                                    'people.add_person', 'people.update_person', 'people.move_person', 'people.update_household',
                                                    'people.merge_people', 'people.merge_households', 'people.dismiss_duplicate',
                                                    'people.decide_application', 'people.decide_household_request')
                          and c.key = 'assistant.' || replace(c.commandable_key, '.', '_')),
  'A · every People command is a portal action under assistant.<area>_<verb>, with its command');
select pg_temp.assert((select bool_and(char_length(c.label) between 6 and 120 and c.label !~ '[._]') from app.activity_catalog c
                        where c.surface = 'portal' and c.key like 'assistant.people\_%'),
  'A · the labels are plain verb phrases');
select pg_temp.assert((select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.people_search' and c.surface = 'portal' and c.commandable_key = 'people.search')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.events_set_field' and c.surface = 'portal' and c.commandable_key = 'events.set_field'),
  'A · the eight commands of 0625 are untouched');

select count(*) as n_before,
       md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) as h_before
  from app.activity_catalog c \gset
\i migrations/0651_activity_people_commands.sql
select pg_temp.assert((select count(*) = :n_before
                              and md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) = :'h_before'
                         from app.activity_catalog c),
  'B · running 0651 again leaves the allowlist exactly as it was');

rollback;
\echo 'PASS: activity People commands tests'
