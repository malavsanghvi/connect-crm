-- 0667: the ten Learning commands are in the activity allowlist, each as a portal action with its command, with a plain label; running
-- the migration again changes nothing; the commands of 0625, 0651, 0655 and 0663 are untouched.
-- Everything runs in one transaction that is rolled back.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

select pg_temp.assert((select count(*) = 10 from app.activity_catalog c
                        where c.surface = 'portal' and c.kind = 'action'
                          and c.commandable_key in ('learning.term_setup', 'learning.registration_checklist', 'learning.classes_needing_teachers',
                                                    'learning.waiting_counts', 'learning.fee_report', 'learning.draft_term_change',
                                                    'learning.draft_teacher_assignment', 'learning.assign_teacher', 'learning.save_class',
                                                    'learning.set_level_fees')
                          and c.key = 'assistant.' || replace(c.commandable_key, '.', '_')),
  'A · every Learning command is a portal action under assistant.<area>_<verb>, with its command');
select pg_temp.assert((select count(*) = 10 from app.activity_catalog c where c.surface = 'portal' and c.key like 'assistant.learning\_%'),
  'A · and nothing else is registered under the learning area');
select pg_temp.assert((select bool_and(char_length(c.label) between 6 and 120 and c.label !~ '[._]') from app.activity_catalog c
                        where c.surface = 'portal' and c.key like 'assistant.learning\_%'),
  'A · the labels are plain verb phrases');
select pg_temp.assert((select bool_and(c.label !~* '(learner|student|child|kid|attendance|homework)') from app.activity_catalog c
                        where c.surface = 'portal' and c.key like 'assistant.learning\_%'),
  'A · no label speaks of a learner, a child, attendance or homework (decision D2)');
select pg_temp.assert((select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.people_search' and c.surface = 'portal' and c.commandable_key = 'people.search')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.events_set_field' and c.surface = 'portal' and c.commandable_key = 'events.set_field')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.people_add_person' and c.surface = 'portal' and c.commandable_key = 'people.add_person')
                      and (select count(*) = 1 from app.activity_catalog c where c.key = 'assistant.settings_setup_status' and c.surface = 'portal' and c.commandable_key = 'settings.setup_status'),
  'A · the commands of 0625, 0651, 0655 and 0663 are untouched');

select count(*) as n_before,
       md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) as h_before
  from app.activity_catalog c \gset
\i migrations/0667_activity_learning_commands.sql
select pg_temp.assert((select count(*) = :n_before
                              and md5(string_agg(c.key || '|' || c.surface || '|' || c.kind || '|' || c.label || '|' || coalesce(c.entity_kind, '-') || '|' || coalesce(c.commandable_key, '-'), ',' order by c.key, c.surface)) = :'h_before'
                         from app.activity_catalog c),
  'B · running 0667 again leaves the allowlist exactly as it was');

rollback;
\echo 'PASS: activity Learning commands tests'
