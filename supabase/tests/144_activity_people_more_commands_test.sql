-- 0720: the four People "More" commands (mark deceased, set primary, add and retire an identifier) are in the activity allowlist,
-- each as a portal action with its command under assistant.<area>_<verb>, and as the screen's own key (people.<verb>); the labels
-- are plain; running the migration again changes nothing; the commands of 0625 and 0651 are untouched.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

select pg_temp.assert((select count(*) = 4 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action'
                          and c.commandable_key in ('people.mark_deceased', 'people.set_primary', 'people.add_identifier', 'people.retire_identifier')
                          and c.key = 'assistant.' || replace(c.commandable_key, '.', '_')),
  'A · every command is a portal action under assistant.<area>_<verb>, with its command');
select pg_temp.assert((select count(*) = 4 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action' and c.commandable_key is null
                          and c.key in ('people.mark_deceased', 'people.set_primary', 'people.add_identifier', 'people.retire_identifier')),
  'A · the screens'' own keys are registered, so the buttons are recorded too');
select pg_temp.assert((select bool_and(char_length(c.label) between 6 and 120 and c.label !~ '[._]') from app.activity_catalog c
                        where c.surface = 'portal' and c.key in ('assistant.people_mark_deceased', 'assistant.people_set_primary', 'assistant.people_add_identifier', 'assistant.people_retire_identifier',
                                                                  'people.mark_deceased', 'people.set_primary', 'people.add_identifier', 'people.retire_identifier')),
  'A · the labels are plain verb phrases');
select pg_temp.assert((select count(*) = 13 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action' and c.key like 'assistant.people\_%' and c.commandable_key in
                              ('people.find_household', 'people.household_summary', 'people.pending_reviews', 'people.suggest_duplicates', 'people.add_person', 'people.update_person',
                               'people.move_person', 'people.update_household', 'people.merge_people', 'people.merge_households', 'people.dismiss_duplicate',
                               'people.decide_application', 'people.decide_household_request'))
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'people.update_person' and c.surface = 'portal'),
  'A · the thirteen People commands of 0651 and the screen keys of 0620 are untouched');

select count(*) as n_before,
       md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) as h_before
  from app.activity_catalog c \gset
\i migrations/0720_activity_people_more_commands.sql
select pg_temp.assert((select count(*) = :n_before
                              and md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) = :'h_before'
                         from app.activity_catalog c),
  'B · running 0720 again leaves the allowlist exactly as it was');

rollback;
\echo 'PASS: activity People more-commands tests'
